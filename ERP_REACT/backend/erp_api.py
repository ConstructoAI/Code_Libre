"""
ERP React - FastAPI Application
Main entry point that mounts all routers and configures middleware.
"""

import os
import sys
import time
import logging
from collections import defaultdict
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, FileResponse
from fastapi.staticfiles import StaticFiles

# Import from project root for database_config
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from .erp_config import VERSION, API_PREFIX, ALLOWED_ORIGINS, DEV_MODE, JWT_SECRET
from . import erp_database as db_module
# IMPORTANT: import anthropic_compat AVANT les routers pour appliquer le
# monkey-patch global sur l'SDK Anthropic. Tous les clients crees ensuite
# auront leurs kwargs deprecies (ex: `temperature` pour Opus 4.7) strippes
# automatiquement. Evite les erreurs 400 "X is deprecated for this model".
from . import anthropic_compat  # noqa: F401 (import side-effect)

logger = logging.getLogger(__name__)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


# Suppress health check logs (Render polls every 5s, floods the logs)
class _HealthCheckFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return "/health" not in msg


logging.getLogger("uvicorn.access").addFilter(_HealthCheckFilter())


# Silence Streamlit's "missing ScriptRunContext" / "Session state does not function"
# warnings emitted when legacy modules (tenant_manager, login_page_multitenant) are
# pulled transitively from FastAPI handlers (eg. Stripe webhook -> stripe_manager
# -> tenant_manager -> `import streamlit as st`). The FastAPI process never runs
# Streamlit, so these warnings are pure noise polluting Render logs.
#
# Approach: defense-in-depth, three layers, robust to streamlit version drift.
#
# 1. Filters on KNOWN child loggers (current production paths). Filters on the
#    originating logger ARE applied via Logger.handle() before propagation, so
#    these short-circuit the warning at source for the loggers we know about.
# 2. setLevel(ERROR) on the streamlit parent — best-effort, in case streamlit's
#    set_log_level() at import time doesn't run (older versions / different
#    init paths).
# 3. Monkey-patch logging.Logger.addHandler so any handler attached to a logger
#    in the streamlit.* namespace automatically inherits our filter. This
#    catches WARNINGs from CURRENTLY UNKNOWN streamlit child loggers (future
#    streamlit versions may move script_run_context to a different module path)
#    when they propagate to streamlit's StreamHandler. Handler-level filters DO
#    run during propagation, unlike logger-level filters.
class _DropStreamlitWarnings(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno >= logging.ERROR


_streamlit_filter = _DropStreamlitWarnings()

# Layer 1: known child loggers (covers the production logs sample 2026-04-27).
for _logger_name in (
    "streamlit",
    "streamlit.runtime",
    "streamlit.runtime.scriptrunner_utils",
    "streamlit.runtime.scriptrunner_utils.script_run_context",
    "streamlit.runtime.state",
    "streamlit.runtime.state.session_state_proxy",
):
    logging.getLogger(_logger_name).addFilter(_streamlit_filter)

# Layer 2: best-effort level cap on parent.
logging.getLogger("streamlit").setLevel(logging.ERROR)

# Layer 3: auto-attach our filter to ANY handler bound to a streamlit.* logger.
# Idempotency guard: skip re-wrapping if the module is imported twice in the
# same interpreter (relevant under uvicorn --reload / pytest; production
# `--workers 2` uses forked processes, unaffected).
if not getattr(logging.Logger.addHandler, "_streamlit_wrapped", False):
    _orig_add_handler = logging.Logger.addHandler

    def _add_handler_with_streamlit_filter(self, hdlr):
        _orig_add_handler(self, hdlr)
        if self.name == "streamlit" or self.name.startswith("streamlit."):
            hdlr.addFilter(_streamlit_filter)

    _add_handler_with_streamlit_filter._streamlit_wrapped = True  # type: ignore[attr-defined]
    logging.Logger.addHandler = _add_handler_with_streamlit_filter


# ============================================
# LIFESPAN (startup / shutdown)
# ============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("ERP React API v%s starting up...", VERSION)

    # Verify DB connection
    conn = None
    try:
        conn = db_module.get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT 1 AS ok")
        cursor.fetchone()
        cursor.close()
        logger.info("Database connection verified.")
    except Exception as exc:
        logger.error("Database connection failed on startup: %s", exc)
        logger.warning("API will start but database operations may fail.")
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

    # Auto-repair tenant schemas: compare active tenants against reference
    # and copy any missing tables/views. Runs once at startup, non-blocking.
    # The module is at the repo root (../../../auto_repair_tenants_startup.py)
    # and auto-executes auto_repair_tenants() on import.
    try:
        import sys as _sys
        import os as _os
        _root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
        if _root not in _sys.path:
            _sys.path.insert(0, _root)
        import auto_repair_tenants_startup  # noqa: F401 - import triggers repair
        logger.info("auto_repair_tenants executed")
    except Exception as exc_repair:
        logger.warning("auto_repair_tenants skipped: %s", exc_repair)

    logger.info("ERP React API v%s ready at %s", VERSION, API_PREFIX)
    yield
    # Close DB pool cleanly so libpq sends PG Terminate to every pooled conn,
    # avoiding "SSL error: unexpected eof while reading" floods on redeploy.
    try:
        import database_config as _dbcfg
        _dbcfg.close_connection_pool()
    except Exception as exc:
        logger.warning("close_connection_pool failed: %s", exc)
    logger.info("ERP React API shutting down.")


# ============================================
# FASTAPI APP
# ============================================

app = FastAPI(
    title="Constructo AI ERP React API",
    description="ERP pour la construction au Quebec - Backend API React",
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
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Session-Token", "X-Requested-With"],
    expose_headers=["X-Session-Token"],
)


# ============================================
# RATE LIMITING MIDDLEWARE
# ============================================

_rate_limit_store: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_WINDOW = 60  # seconds
# 1500 req/min ≈ 25 req/s — sized for ERP corporate deployments where 20–40 employees
# share the same public IP behind NAT or VPN. Still blocks basic DDoS bots (30+ req/s).
# Migration to Redis + per-user keys (see redis_client.py) is planned for true multi-tenant scale.
_RATE_LIMIT_GENERAL = 1500  # requests per window for data endpoints
_RATE_LIMIT_AUTH = 10  # requests per window for auth endpoints (anti brute-force)
# Le chat public Sylvain est anonyme et couteux (~$0.01/echange avec cache Anthropic).
# 10 req/min/IP = max 600 req/heure = ~$6/heure si abus soutenu. Combine avec le
# cap IP/jour de 50 dans public_chat.py, un attaquant est triple-borne.
_RATE_LIMIT_PUBLIC_CHAT = 10
# Paths skipped entirely — healthchecks, static assets, and high-frequency read-only endpoints
# that populate dashboards (polled when switching modules/tabs).
_RATE_LIMIT_SKIP_PREFIXES = ("/assets", "/api/erp/v1/notifications/count")
_RATE_LIMIT_SKIP_SUFFIXES = ("/health", "/statistics", "/stats", "/dashboard", "/alerts")


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Basic rate limiting by IP address."""
    path = request.url.path
    if (any(path.startswith(p) for p in _RATE_LIMIT_SKIP_PREFIXES)
            or any(path.endswith(s) for s in _RATE_LIMIT_SKIP_SUFFIXES)):
        return await call_next(request)

    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    window_start = now - _RATE_LIMIT_WINDOW

    # Determine limit based on path (most specific first)
    is_public_chat = "/public/sylvain-chat" in path
    is_auth = "/auth/" in path
    if is_public_chat:
        limit = _RATE_LIMIT_PUBLIC_CHAT
        key = f"{client_ip}:public_chat"
    elif is_auth:
        limit = _RATE_LIMIT_AUTH
        key = f"{client_ip}:auth"
    else:
        limit = _RATE_LIMIT_GENERAL
        key = client_ip

    # Clean old entries and check
    _rate_limit_store[key] = [t for t in _rate_limit_store[key] if t > window_start]
    if len(_rate_limit_store[key]) >= limit:
        return JSONResponse(
            status_code=429,
            content={"detail": "Trop de requetes. Reessayez dans une minute."},
            headers={"Retry-After": "60"},
        )

    _rate_limit_store[key].append(now)
    return await call_next(request)


# ============================================
# DEV MODE GUARD MIDDLEWARE
# ============================================

@app.middleware("http")
async def dev_mode_guard(request: Request, call_next):
    """Block non-super-admin access to API DATA endpoints in dev mode."""
    if DEV_MODE:
        path = request.url.path
        if path.startswith("/api/"):
            if not any(p in path for p in ["/auth/", "/health", "/docs", "/openapi.json", "/redoc", "/public/"]):
                session_token = request.headers.get("X-Session-Token") or request.cookies.get("erp_session")
                if session_token:
                    from .erp_auth import get_session
                    session = get_session(session_token)
                    if session and session.get("user_type") == "super_admin":
                        return await call_next(request)

                # Also check JWT for super-admin access only
                auth_header = request.headers.get("Authorization", "")
                if auth_header.startswith("Bearer "):
                    try:
                        from .erp_auth import decode_jwt
                        payload = decode_jwt(auth_header[7:])
                        if payload.get("user_type") == "super_admin":
                            return await call_next(request)
                    except Exception:
                        pass

                return JSONResponse(
                    status_code=403,
                    content={"detail": "Application en mode developpement. Connexion Super-Admin requise."},
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
    # Surchargez CSP_CONNECT_SRC via env (CSV) pour ajouter vos propres domaines.
    _csp_connect_extra = os.getenv("CSP_CONNECT_SRC", "").strip()
    _csp_connect = "connect-src 'self' blob: https://*.stripe.com"
    if _csp_connect_extra:
        _csp_connect = f"{_csp_connect} {_csp_connect_extra}"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self' blob:; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: https:; "
        "font-src 'self' https:; "
        "frame-src 'self' blob:; "
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
            "error": str(exc) if os.getenv("ERP_DEBUG") else "Internal Server Error",
        },
    )


# ============================================
# HEALTH CHECK
# ============================================

@app.api_route(f"{API_PREFIX}/health", methods=["GET", "HEAD"], tags=["Health"])
async def health_check():
    """Health check endpoint (GET + HEAD pour Render uptime monitor)."""
    db_ok = False
    conn = None
    try:
        conn = db_module.get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT 1 AS ok")
        cursor.fetchone()
        cursor.close()
        db_ok = True
    except Exception:
        db_ok = False
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

    return {
        "status": "healthy" if db_ok else "degraded",
        "version": VERSION,
        "database": "connected" if db_ok else "disconnected",
        "service": "erp-react",
    }


# ============================================
# MOUNT ROUTERS
# ============================================

from .routers.auth import router as auth_router
from .routers.dashboard import router as dashboard_router
from .routers.admin import router as admin_router
from .routers.analytics import router as analytics_router
from .routers.companies import router as companies_router
from .routers.messaging import router as messaging_router
from .routers.suppliers import router as suppliers_router
from .routers.inventory import router as inventory_router
from .routers.documents import router as documents_router
from .routers.projects import router as projects_router
from .routers.devis import router as devis_router
from .routers.devis_manuel_template import router as devis_manuel_template_router
from .routers.production import router as production_router
from .routers.accounting import router as accounting_router
from .routers.employees import router as employees_router
from .routers.ai import router as ai_router
from .routers.secondary import router as secondary_router
from .routers.calculators import router as calculators_router
from .routers.config import router as config_router
from .routers.emails import router as emails_router
from .routers.crm import router as crm_router
from .routers.exports import router as exports_router
from .routers.stripe_routes import router as stripe_router
from .routers.payroll import router as payroll_router
from .routers.b2b import router as b2b_router
from .routers.b2b_portal import router as b2b_portal_router
from .routers.gps import router as gps_router
from .routers.metre_pdf import router as metre_pdf_router
from .routers.immobilier import router as immobilier_router
from .routers.fonds_prevoyance import router as fonds_prevoyance_router
from .routers.integration import router as integration_router
from .routers.web import router as web_router
from .routers.subventions import router as subventions_router
from .routers.conformite import router as conformite_router
from .routers.public_chat import router as public_chat_router

app.include_router(auth_router, prefix=API_PREFIX)
app.include_router(dashboard_router, prefix=API_PREFIX)
app.include_router(admin_router, prefix=API_PREFIX)
app.include_router(analytics_router, prefix=API_PREFIX)
app.include_router(companies_router, prefix=API_PREFIX)
app.include_router(messaging_router, prefix=API_PREFIX)
app.include_router(suppliers_router, prefix=API_PREFIX)
app.include_router(inventory_router, prefix=API_PREFIX)
app.include_router(documents_router, prefix=API_PREFIX)
app.include_router(projects_router, prefix=API_PREFIX)
# IMPORTANT: devis_manuel_template_router MUST be included BEFORE devis_router.
# Reason: devis_router has dynamic routes like POST /devis/{devis_id}/lignes where {devis_id} is an int.
# FastAPI matches routes in registration order. If devis_router comes first, a request to
# POST /devis/manuel-template/lignes captures devis_id="manuel-template" which fails int coercion → 422.
# By registering the literal-prefix manuel-template router first, those exact paths win.
app.include_router(devis_manuel_template_router, prefix=API_PREFIX)
app.include_router(devis_router, prefix=API_PREFIX)
app.include_router(production_router, prefix=API_PREFIX)
app.include_router(accounting_router, prefix=API_PREFIX)
app.include_router(employees_router, prefix=API_PREFIX)
app.include_router(ai_router, prefix=API_PREFIX)
app.include_router(secondary_router, prefix=API_PREFIX)
app.include_router(calculators_router, prefix=API_PREFIX)
app.include_router(config_router, prefix=API_PREFIX)
app.include_router(emails_router, prefix=API_PREFIX)
app.include_router(crm_router, prefix=API_PREFIX)
app.include_router(exports_router, prefix=API_PREFIX)
app.include_router(stripe_router, prefix=API_PREFIX)
app.include_router(payroll_router, prefix=API_PREFIX)
app.include_router(b2b_router, prefix=API_PREFIX)
app.include_router(b2b_portal_router, prefix=API_PREFIX)
app.include_router(gps_router, prefix=API_PREFIX)
app.include_router(metre_pdf_router, prefix=API_PREFIX)
app.include_router(immobilier_router, prefix=API_PREFIX)
app.include_router(fonds_prevoyance_router, prefix=API_PREFIX)
app.include_router(integration_router, prefix=API_PREFIX)
app.include_router(web_router, prefix=API_PREFIX)
app.include_router(subventions_router, prefix=API_PREFIX)
app.include_router(conformite_router, prefix=API_PREFIX)
app.include_router(public_chat_router, prefix=API_PREFIX)


# ============================================
# STRIPE WEBHOOK (no API_PREFIX – Stripe needs a fixed URL)
# ============================================

try:
    import stripe as _stripe_mod
except ImportError:
    _stripe_mod = None
    logger.warning("Stripe SDK not installed – /webhooks/stripe will be a no-op")

STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")


@app.post("/webhooks/stripe", tags=["Webhooks"], include_in_schema=False)
async def stripe_webhook(request: Request):
    """Receive Stripe webhook events and update subscription status."""
    if _stripe_mod is None:
        logger.warning("Stripe webhook received but stripe SDK is not installed – ignoring")
        return JSONResponse(content={"status": "ignored", "reason": "stripe SDK unavailable"}, status_code=200)

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    if not STRIPE_WEBHOOK_SECRET:
        logger.error("STRIPE_WEBHOOK_SECRET not configured – cannot verify webhook")
        return JSONResponse(content={"error": "webhook secret not configured"}, status_code=400)

    try:
        event = _stripe_mod.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except ValueError:
        logger.warning("Stripe webhook: invalid payload")
        return JSONResponse(content={"error": "invalid payload"}, status_code=400)
    except _stripe_mod.error.SignatureVerificationError:
        logger.warning("Stripe webhook: signature verification failed")
        return JSONResponse(content={"error": "signature verification failed"}, status_code=400)

    event_type = event.get("type", "")
    event_id = event.get("id", "")
    data_object = event.get("data", {}).get("object", {})
    logger.info("Stripe webhook received: %s (id=%s)", event_type, event_id)

    # ── Deduplication: skip already-processed events ──
    if event_id:
        try:
            dedup_conn = db_module.get_conn()
            dedup_cur = dedup_conn.cursor()
            dedup_cur.execute(
                "CREATE TABLE IF NOT EXISTS public.stripe_webhook_events ("
                "  event_id TEXT PRIMARY KEY,"
                "  event_type TEXT,"
                "  processed_at TIMESTAMP DEFAULT NOW()"
                ")"
            )
            dedup_cur.execute(
                "INSERT INTO public.stripe_webhook_events (event_id, event_type) "
                "VALUES (%s, %s) ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
                (event_id, event_type),
            )
            row = dedup_cur.fetchone()
            dedup_conn.commit()
            dedup_cur.close()
            dedup_conn.close()
            if row is None:
                logger.info("Stripe webhook event %s already processed — skipping", event_id)
                return JSONResponse(content={"status": "duplicate"}, status_code=200)
        except Exception as exc:
            logger.warning("Stripe webhook dedup check failed (proceeding anyway): %s", exc)
            try:
                dedup_conn.close()
            except Exception:
                pass

    # Determine the customer id to find the matching entreprise
    customer_id = data_object.get("customer")

    # ── checkout.session.completed: new company signup ──
    if event_type == "checkout.session.completed":
        metadata = data_object.get("metadata", {})
        if metadata.get("signup_flow") == "new_company":
            try:
                from stripe_manager import _create_company_from_signup
                subscription_id = data_object.get("subscription")
                if subscription_id:
                    subscription_id = str(subscription_id)
                new_id = _create_company_from_signup(
                    company_name=metadata.get("company_name", ""),
                    email=metadata.get("email", ""),
                    customer_id=str(customer_id) if customer_id else "",
                    subscription_id=subscription_id or "",
                    checkout_session_id=data_object.get("id", ""),
                )
                if new_id:
                    logger.info("Signup completed via webhook: company_id=%s", new_id)
                else:
                    logger.error("Signup failed for email=%s", metadata.get("email"))
            except ImportError:
                logger.error("stripe_manager not importable — cannot process new company signup")
            except Exception as exc:
                logger.error("Error processing checkout.session.completed signup: %s", exc)
        else:
            logger.info("checkout.session.completed for existing company (customer=%s)", customer_id)
        return JSONResponse(content={"status": "ok"}, status_code=200)

    # ── subscription / invoice events: update status ──
    new_status = None
    if event_type == "customer.subscription.updated":
        new_status = data_object.get("status", "active")
        # If subscription is set to cancel at period end, mark as 'canceling'
        if data_object.get("cancel_at_period_end") and new_status == "active":
            new_status = "canceling"
    elif event_type == "customer.subscription.deleted":
        new_status = "canceled"
    elif event_type == "invoice.payment_failed":
        new_status = "past_due"
    elif event_type == "invoice.paid":
        new_status = "active"

    if new_status and customer_id:
        conn = None
        try:
            conn = db_module.get_conn()
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE public.entreprises SET subscription_status = %s WHERE stripe_customer_id = %s",
                (new_status, customer_id),
            )
            conn.commit()
            cursor.close()
            logger.info("Updated subscription_status=%s for stripe customer %s", new_status, customer_id)
        except Exception as exc:
            logger.error("Failed to update subscription status: %s", exc)
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
    elif new_status:
        logger.warning("Stripe webhook %s: no customer_id found in event data", event_type)

    return JSONResponse(content={"status": "ok"}, status_code=200)


# ============================================
# SERVE REACT FRONTEND (production build)
# ============================================

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if FRONTEND_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="static-assets")

    @app.api_route("/logo.png", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_logo():
        logo = FRONTEND_DIR / "logo.png"
        if logo.exists():
            return FileResponse(str(logo))
        return JSONResponse(status_code=404, content={"detail": "Not found"})

    @app.api_route("/favicon.ico", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_favicon():
        # Fallback vers favicon.png si .ico absent (cas typique React/Vite —
        # le repo n'a que favicon.png). Evite les 404 sur le sondage browser.
        for name in ("favicon.ico", "favicon.png"):
            f = FRONTEND_DIR / name
            if f.exists():
                return FileResponse(str(f))
        return JSONResponse(status_code=204, content=None)

    logger.info("React frontend found at %s", FRONTEND_DIR)
else:
    logger.warning("React frontend build not found at %s", FRONTEND_DIR)


# ============================================
# CATCH-ALL: React client-side routing
# ============================================

@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
async def serve_root():
    """Serve React app or redirect to docs (GET + HEAD pour uptime monitor)."""
    if FRONTEND_DIR.is_dir():
        return FileResponse(str(FRONTEND_DIR / "index.html"))
    return RedirectResponse(url=f"{API_PREFIX}/docs")


@app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def catch_all(full_path: str):
    """Serve React index.html for client-side routing."""
    if full_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"detail": "Endpoint not found"})
    if full_path.startswith("_stcore/"):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    static_file = (FRONTEND_DIR / full_path).resolve()
    # Prevent path traversal
    if FRONTEND_DIR.is_dir() and static_file.is_file() and str(static_file).startswith(str(FRONTEND_DIR.resolve())):
        return FileResponse(str(static_file))
    if FRONTEND_DIR.is_dir():
        return FileResponse(str(FRONTEND_DIR / "index.html"))
    return JSONResponse(status_code=404, content={"detail": "Frontend not built"})
