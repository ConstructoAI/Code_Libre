"""
SEAOP React - FastAPI Application
Main entry point that mounts all routers and configures middleware.
"""

import os
import sys
import logging
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

# Import from project root for database_config
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from .seaop_config import VERSION, API_PREFIX, ALLOWED_ORIGINS, DEV_MODE
from . import seaop_database as db_module

logger = logging.getLogger(__name__)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


# ============================================
# LIFESPAN (startup / shutdown)
# ============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler - runs on startup and shutdown."""
    # --- Startup ---
    logger.info("SEAOP React API v%s starting up...", VERSION)

    # Bootstrap the legacy SEAOP schema (CREATE TABLE IF NOT EXISTS) so that
    # a fresh deployment without the Streamlit app running first still has
    # the base tables. The SEAOP_REACT migration (ensure_schema) then adds
    # the additional columns the wizard needs. Non-fatal on failure.
    try:
        from modules.seaop.seaop_db_postgres import init_seaop_tables
        init_seaop_tables()
        logger.info("SEAOP legacy tables bootstrap: OK")
    except Exception as exc:
        logger.warning("SEAOP legacy tables bootstrap skipped: %s", exc)

    # Retry the SEAOP_REACT column-migration now that the base tables exist.
    # ensure_schema() is idempotent and returns early if already applied.
    try:
        db_module.ensure_schema()
    except Exception as exc:
        logger.warning("SEAOP schema migration retry failed: %s", exc)

    # Warn if the PDF plan upload directory lives inside the project —
    # on Render without an attached Disk, every redeploy wipes it.
    # Set SEAOP_ESTIMATION_PLAN_ROOT_ACK=1 to silence this once acknowledged.
    try:
        from .seaop_config import ESTIMATION_PLAN_ROOT
        project_root = Path(__file__).resolve().parent.parent
        plan_root = Path(ESTIMATION_PLAN_ROOT).resolve()
        try:
            plan_root.relative_to(project_root)
            ack_value = (os.environ.get("SEAOP_ESTIMATION_PLAN_ROOT_ACK") or "").strip().lower()
            if ack_value in {"1", "true", "yes", "on"}:
                logger.info(
                    "ESTIMATION_PLAN_ROOT=%s (in-project, acknowledged via SEAOP_ESTIMATION_PLAN_ROOT_ACK)",
                    plan_root,
                )
            else:
                logger.warning(
                    "ESTIMATION_PLAN_ROOT=%s lives inside the project — uploaded "
                    "plans will be lost at every redeploy. Mount a persistent disk, "
                    "set SEAOP_ESTIMATION_PLAN_ROOT to a stable path, or set "
                    "SEAOP_ESTIMATION_PLAN_ROOT_ACK=1 to silence.",
                    plan_root,
                )
        except ValueError:
            logger.info("ESTIMATION_PLAN_ROOT=%s (external path)", plan_root)
    except Exception as exc:
        logger.warning("Could not evaluate ESTIMATION_PLAN_ROOT safety: %s", exc)

    # Verify DB connection and tables
    try:
        conn = db_module.get_conn()
        cursor = conn.cursor()
        # Check that core tables exist
        tables = ["seaop_entrepreneurs", "seaop_leads", "seaop_soumissions", "seaop_messages", "seaop_notifications"]
        for table in tables:
            cursor.execute(
                "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = %s)",
                (table,),
            )
            row = cursor.fetchone()
            exists = row.get("exists", False) if row else False
            if exists:
                logger.info("  Table %s: OK", table)
            else:
                logger.warning("  Table %s: NOT FOUND", table)
        cursor.close()
        conn.close()
        logger.info("Database connection verified.")
    except Exception as exc:
        logger.error("Database connection failed on startup: %s", exc)
        logger.warning("API will start but database operations may fail.")

    logger.info("SEAOP React API v%s ready at %s", VERSION, API_PREFIX)

    yield

    # --- Shutdown ---
    # Close DB pool cleanly so libpq sends PG Terminate to every pooled conn,
    # avoiding "SSL error: unexpected eof while reading" floods on redeploy.
    try:
        import database_config as _dbcfg
        _dbcfg.close_connection_pool()
    except Exception as exc:
        logger.warning("close_connection_pool failed: %s", exc)
    logger.info("SEAOP React API shutting down.")


# ============================================
# FASTAPI APP
# ============================================

app = FastAPI(
    title="SEAOP React API",
    description="Systeme Electronique d'Appels d'Offres Publics - Backend API",
    version=VERSION,
    docs_url=f"{API_PREFIX}/docs",
    redoc_url=f"{API_PREFIX}/redoc",
    openapi_url=f"{API_PREFIX}/openapi.json",
    lifespan=lifespan,
)


# ============================================
# CORS MIDDLEWARE
# ============================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Session-Token"],
)


# ============================================
# DEV MODE GUARD MIDDLEWARE
# ============================================

@app.middleware("http")
async def dev_mode_guard(request: Request, call_next):
    """Block non-super-admin access to API DATA endpoints in dev mode.

    The frontend (HTML/JS/CSS) is always accessible so the user can
    reach the login page. Only /api/ data endpoints are protected.
    """
    if DEV_MODE:
        path = request.url.path
        # Only guard API data endpoints — let frontend pages through
        if path.startswith("/api/"):
            # Allow auth endpoints, health check, docs, and the PUBLIC estimation
            # wizard (POST /services/estimation + GET /services/estimation/meta)
            # so visitors can submit quote requests without a super-admin session.
            PUBLIC_ALLOWLIST = (
                "/auth/",
                "/health",
                "/docs",
                "/openapi.json",
                "/redoc",
                "/services/estimation/meta",
            )
            is_public_estimation_submit = (
                request.method == "POST"
                and path.endswith("/services/estimation")
            )
            is_public_plan_upload = (
                request.method == "POST"
                and path.endswith("/services/estimation/plans")
            )
            if (
                is_public_estimation_submit
                or is_public_plan_upload
                or any(p in path for p in PUBLIC_ALLOWLIST)
            ):
                return await call_next(request)

            # Check for super-admin session
            session_token = request.headers.get("X-Session-Token") or request.cookies.get("seaop_session")
            if session_token:
                from .seaop_auth import get_session
                session = get_session(session_token)
                if session and session.get("user_type") == "super_admin":
                    return await call_next(request)
            return JSONResponse(
                status_code=403,
                content={"detail": "Application en mode développement. Connexion Super-Admin requise."},
            )

    return await call_next(request)


# ============================================
# SECURITY HEADERS MIDDLEWARE
# ============================================

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Add security headers to every response."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    # Surchargez CSP_CONNECT_SRC via env (CSV de domaines) pour vos propres origines.
    _csp_connect_extra = os.getenv("CSP_CONNECT_SRC", "").strip()
    _csp_connect = "connect-src 'self'"
    if _csp_connect_extra:
        _csp_connect = f"{_csp_connect} {_csp_connect_extra}"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        # blob: is required for the admin PDF plan download, which uses
        # URL.createObjectURL(blob) to trigger a <a download> click.
        "img-src 'self' data: https: blob:; "
        "font-src 'self' https:; "
        f"{_csp_connect}"
    )
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


# ============================================
# GLOBAL EXCEPTION HANDLER
# ============================================

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch unhandled exceptions and return a JSON error response."""
    logger.error("Unhandled exception on %s %s: %s", request.method, request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Erreur interne du serveur",
            "error": str(exc) if os.getenv("SEAOP_DEBUG") else "Internal Server Error",
        },
    )


# ============================================
# HEALTH CHECK
# ============================================

@app.api_route(f"{API_PREFIX}/health", methods=["GET", "HEAD"], tags=["Health"])
async def health_check():
    """Health check endpoint for monitoring and load balancers (GET + HEAD)."""
    db_ok = False
    try:
        conn = db_module.get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT 1 AS ok")
        row = cursor.fetchone()
        db_ok = bool(row)
        cursor.close()
        conn.close()
    except Exception:
        db_ok = False

    return {
        "status": "healthy" if db_ok else "degraded",
        "version": VERSION,
        "database": "connected" if db_ok else "disconnected",
    }


# ============================================
# SERVE REACT FRONTEND (production build)
# ============================================

# Path to the built React frontend
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if FRONTEND_DIR.is_dir():
    # Serve static assets (JS, CSS, images) from /assets/
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="static-assets")

    # Serve other static files (favicon, logo, etc.)
    @app.api_route("/logo.png", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_logo():
        logo = FRONTEND_DIR / "logo.png"
        if logo.exists():
            return FileResponse(str(logo))
        return JSONResponse(status_code=404, content={"detail": "Not found"})

    @app.api_route("/favicon.ico", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_favicon():
        # Fallback vers favicon.png si .ico absent (le repo n'a que .png).
        for name in ("favicon.ico", "favicon.png"):
            f = FRONTEND_DIR / name
            if f.exists():
                return FileResponse(str(f))
        return JSONResponse(status_code=204, content=None)

    @app.api_route("/manifest.json", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_manifest():
        manifest = FRONTEND_DIR / "manifest.json"
        if manifest.exists():
            return FileResponse(str(manifest), media_type="application/manifest+json")
        return JSONResponse(status_code=404, content={"detail": "Not found"})

    @app.api_route("/sw.js", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_sw():
        sw = FRONTEND_DIR / "sw.js"
        if sw.exists():
            return FileResponse(str(sw), media_type="application/javascript",
                                headers={"Service-Worker-Allowed": "/"})
        return JSONResponse(status_code=404, content={"detail": "Not found"})

    logger.info("React frontend found at %s — serving static files.", FRONTEND_DIR)
else:
    logger.warning("React frontend build not found at %s — run 'npm run build' in frontend/", FRONTEND_DIR)


# ============================================
# CATCH-ALL: Serve React index.html for client-side routing
# (must be defined AFTER all API routes)
# ============================================

@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
async def serve_root():
    """Serve React app or redirect to docs if no build."""
    if FRONTEND_DIR.is_dir():
        return FileResponse(str(FRONTEND_DIR / "index.html"))
    return RedirectResponse(url=f"{API_PREFIX}/docs")


# ============================================
# MOUNT ROUTERS - Phase 1
# ============================================

from .routers.auth import router as auth_router
from .routers.leads import router as leads_router

app.include_router(auth_router, prefix=API_PREFIX)
app.include_router(leads_router, prefix=API_PREFIX)

# ============================================
# Phase 2 routers (Soumissions + Messaging + Evaluations)
# ============================================
from .routers.soumissions import router as soumissions_router
from .routers.messages import router as messages_router
from .routers.evaluations import router as evaluations_router

app.include_router(soumissions_router, prefix=API_PREFIX)
app.include_router(messages_router, prefix=API_PREFIX)
app.include_router(evaluations_router, prefix=API_PREFIX)

# ============================================
# Phase 3 routers (Notifications + Chat Room + Uploads)
# ============================================
from .routers.notifications import router as notifications_router
from .routers.chat_room import router as chat_room_router
from .routers.uploads import router as uploads_router

app.include_router(notifications_router, prefix=API_PREFIX)
app.include_router(chat_room_router, prefix=API_PREFIX)
app.include_router(uploads_router, prefix=API_PREFIX)

# ============================================
# Phase 4 routers (Services professionnels + Admin dashboard)
# ============================================
from .routers.services import router as services_router
from .routers.admin import router as admin_router

app.include_router(services_router, prefix=API_PREFIX)
app.include_router(admin_router, prefix=API_PREFIX)


# ============================================
# CATCH-ALL: React client-side routing
# Must be LAST — catches all non-API paths and serves index.html
# so React Router can handle the route client-side.
# ============================================

@app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def catch_all(full_path: str):
    """Serve React index.html for any non-API route (client-side routing)."""
    # Don't catch API routes
    if full_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"detail": "Endpoint not found"})
    # Serve static file if it exists (e.g., logo.png, manifest.json)
    static_file = FRONTEND_DIR / full_path
    if FRONTEND_DIR.is_dir() and static_file.is_file():
        return FileResponse(str(static_file))
    # Otherwise serve index.html for React Router
    if FRONTEND_DIR.is_dir():
        return FileResponse(str(FRONTEND_DIR / "index.html"))
    return JSONResponse(status_code=404, content={"detail": "Frontend not built"})
