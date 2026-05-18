"""
Middleware d'authentification et sécurité pour l'API REST Constructo AI

Ce module fournit:
- Authentification par clé API (X-API-Key header)
- Rate limiting par clé API
- Logging des requêtes API
- Injection du contexte tenant dans les endpoints
"""

import time
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Callable, Any
from collections import defaultdict
import threading

from fastapi import Request, HTTPException, Depends
from fastapi.security import APIKeyHeader
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response, JSONResponse

import psycopg2
from api_auth import verify_api_key, has_permission
from api_tenant_context import TenantContext, create_tenant_context_from_api_info
import database_config

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# CONSTANTES
# ═══════════════════════════════════════════════════════════════════════════════

API_KEY_HEADER_NAME = "X-API-Key"
RATE_LIMIT_WINDOW_SECONDS = 3600  # 1 heure


# ═══════════════════════════════════════════════════════════════════════════════
# RATE LIMITER
# ═══════════════════════════════════════════════════════════════════════════════

class APIRateLimiter:
    """
    Rate limiter pour les clés API utilisant PostgreSQL pour l'état partagé.

    Utilise une table api_rate_limits avec INSERT ON CONFLICT pour des
    mises à jour atomiques du Token Bucket, partagé entre tous les workers uvicorn.
    Fallback en mémoire si la DB est indisponible.
    """

    def __init__(self):
        # Fallback in-memory si DB indisponible
        self._buckets: Dict[int, Dict[str, float]] = {}
        self._lock = threading.Lock()
        self._table_ensured = False

    def _ensure_table(self):
        """Crée la table api_rate_limits si elle n'existe pas."""
        if self._table_ensured:
            return
        try:
            conn = database_config.get_connection()
            cursor = conn.cursor()
            cursor.execute("SET search_path TO public")
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS api_rate_limits (
                    key_id INTEGER PRIMARY KEY,
                    tokens DOUBLE PRECISION NOT NULL,
                    last_update DOUBLE PRECISION NOT NULL
                )
            """)
            conn.commit()
            cursor.close()
            conn.close()
            self._table_ensured = True
        except Exception as e:
            logger.debug(f"[RateLimit] Cannot ensure table: {e}")

    def check_rate_limit(self, key_id: int, limit_per_hour: int) -> tuple[bool, int, int]:
        """
        Vérifie si une requête est autorisée (Token Bucket atomique via PostgreSQL).

        Falls back to in-memory if DB is unavailable.
        """
        self._ensure_table()

        try:
            return self._check_rate_limit_db(key_id, limit_per_hour)
        except Exception as e:
            logger.debug(f"[RateLimit] DB fallback to in-memory: {e}")
            return self._check_rate_limit_memory(key_id, limit_per_hour)

    def _check_rate_limit_db(self, key_id: int, limit_per_hour: int) -> tuple[bool, int, int]:
        """Token Bucket atomique via PostgreSQL — partagé entre workers."""
        import time as _time
        now = _time.time()
        refill_rate = limit_per_hour / RATE_LIMIT_WINDOW_SECONDS

        conn = database_config.get_connection()
        _conn_corrupted = False
        try:
            cursor = conn.cursor()
            try:
                cursor.execute("SET search_path TO public")
            except Exception:
                # Si SET search_path échoue, la connexion est dans un état incertain.
                # On la marque pour la fermer plutôt que la rendre au pool.
                _conn_corrupted = True
                raise

            # Atomic upsert + token bucket calculation in one query
            cursor.execute("""
                INSERT INTO api_rate_limits (key_id, tokens, last_update)
                VALUES (%s, %s, %s)
                ON CONFLICT (key_id) DO UPDATE SET
                    tokens = LEAST(
                        %s,
                        api_rate_limits.tokens
                        + (%s - api_rate_limits.last_update) * %s
                    ),
                    last_update = %s
                RETURNING tokens
            """, (
                key_id, float(limit_per_hour), now,
                float(limit_per_hour), now, refill_rate, now
            ))
            current_tokens = cursor.fetchone()[0]

            if current_tokens >= 1.0:
                # Consume one token
                cursor.execute(
                    "UPDATE api_rate_limits SET tokens = tokens - 1 WHERE key_id = %s",
                    (key_id,)
                )
                conn.commit()
                remaining = int(current_tokens - 1)
                tokens_needed = limit_per_hour - (current_tokens - 1)
                reset_seconds = int(tokens_needed / refill_rate) if refill_rate > 0 else RATE_LIMIT_WINDOW_SECONDS
                return True, remaining, reset_seconds
            else:
                conn.commit()
                tokens_needed = 1.0 - current_tokens
                wait_seconds = int(tokens_needed / refill_rate) if refill_rate > 0 else RATE_LIMIT_WINDOW_SECONDS
                return False, 0, wait_seconds
        finally:
            try:
                cursor.close()
            except Exception:
                pass
            # Si la connexion est en état incertain (SET search_path failed),
            # on la ferme dur plutôt que la rendre au pool avec un search_path corrompu.
            if _conn_corrupted:
                try:
                    raw_conn = getattr(conn, "raw_connection", None) or conn
                    raw_conn.close()
                except Exception:
                    pass
            else:
                conn.close()

    def _check_rate_limit_memory(self, key_id: int, limit_per_hour: int) -> tuple[bool, int, int]:
        """Fallback in-memory Token Bucket (per-worker, not shared)."""
        now = time.time()
        refill_rate = limit_per_hour / RATE_LIMIT_WINDOW_SECONDS

        with self._lock:
            if key_id not in self._buckets:
                self._buckets[key_id] = {
                    'tokens': float(limit_per_hour),
                    'last_update': now
                }

            bucket = self._buckets[key_id]
            elapsed = now - bucket['last_update']
            bucket['tokens'] = min(
                limit_per_hour,
                bucket['tokens'] + elapsed * refill_rate
            )
            bucket['last_update'] = now

            if bucket['tokens'] >= 1.0:
                bucket['tokens'] -= 1.0
                remaining = int(bucket['tokens'])
                tokens_needed = limit_per_hour - bucket['tokens']
                reset_seconds = int(tokens_needed / refill_rate) if refill_rate > 0 else RATE_LIMIT_WINDOW_SECONDS
                return True, remaining, reset_seconds
            else:
                tokens_needed = 1.0 - bucket['tokens']
                wait_seconds = int(tokens_needed / refill_rate) if refill_rate > 0 else RATE_LIMIT_WINDOW_SECONDS
                return False, 0, wait_seconds

    def get_usage(self, key_id: int) -> int:
        """Retourne le nombre estimé de requêtes utilisées."""
        try:
            conn = database_config.get_connection()
            cursor = conn.cursor()
            cursor.execute("SET search_path TO public")
            cursor.execute(
                "SELECT tokens FROM api_rate_limits WHERE key_id = %s",
                (key_id,)
            )
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            if row:
                return max(0, int(1000 - row[0]))
            return 0
        except Exception:
            with self._lock:
                if key_id not in self._buckets:
                    return 0
                return max(0, int(1000 - self._buckets[key_id]['tokens']))

    def cleanup(self):
        """Nettoie les buckets inactifs."""
        now = time.time()
        inactive_threshold = RATE_LIMIT_WINDOW_SECONDS * 2

        # Cleanup DB
        try:
            conn = database_config.get_connection()
            cursor = conn.cursor()
            cursor.execute("SET search_path TO public")
            cursor.execute(
                "DELETE FROM api_rate_limits WHERE last_update < %s",
                (now - inactive_threshold,)
            )
            conn.commit()
            cursor.close()
            conn.close()
        except Exception:
            pass

        # Cleanup in-memory fallback
        with self._lock:
            keys_to_delete = [
                key_id for key_id, bucket in self._buckets.items()
                if now - bucket['last_update'] > inactive_threshold
            ]
            for key_id in keys_to_delete:
                del self._buckets[key_id]


# Instance globale du rate limiter
rate_limiter = APIRateLimiter()


# ═══════════════════════════════════════════════════════════════════════════════
# API KEY SECURITY SCHEME
# ═══════════════════════════════════════════════════════════════════════════════

api_key_header = APIKeyHeader(
    name=API_KEY_HEADER_NAME,
    auto_error=False,
    description="Clé API Constructo AI (format: cai_live_XXXXX...)"
)


# ═══════════════════════════════════════════════════════════════════════════════
# DEPENDENCY INJECTION
# ═══════════════════════════════════════════════════════════════════════════════

async def get_api_key(api_key: Optional[str] = Depends(api_key_header)) -> str:
    """
    Dependency pour extraire et valider la présence de la clé API.

    Raises:
        HTTPException 401: Si la clé n'est pas fournie
    """
    if not api_key:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "api_key_required",
                "message": "Clé API requise. Ajoutez le header X-API-Key."
            },
            headers={"WWW-Authenticate": "ApiKey"}
        )
    return api_key


async def get_tenant_context(
    request: Request,
    api_key: str = Depends(get_api_key)
) -> TenantContext:
    """
    Dependency principale pour obtenir le contexte tenant.

    Cette fonction:
    1. Vérifie la clé API
    2. Vérifie le rate limit
    3. Crée et retourne le TenantContext

    Usage dans un endpoint:
        @app.get("/api/v1/projects")
        async def list_projects(tenant: TenantContext = Depends(get_tenant_context)):
            conn = tenant.get_connection()
            # ...

    Args:
        request: Requête FastAPI
        api_key: Clé API extraite du header

    Returns:
        TenantContext configuré pour le tenant

    Raises:
        HTTPException 401: Clé API invalide
        HTTPException 429: Rate limit dépassé
    """
    # Vérifier la clé API
    api_info = verify_api_key(api_key)

    if not api_info:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "invalid_api_key",
                "message": "Clé API invalide ou expirée."
            },
            headers={"WWW-Authenticate": "ApiKey"}
        )

    # Vérifier le rate limit
    key_id = api_info['key_id']
    limit = api_info['rate_limit_per_hour']

    allowed, remaining, reset_seconds = rate_limiter.check_rate_limit(key_id, limit)

    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": f"Limite de {limit} requêtes/heure dépassée.",
                "retry_after": reset_seconds
            },
            headers={
                "X-RateLimit-Limit": str(limit),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(reset_seconds),
                "Retry-After": str(reset_seconds)
            }
        )

    # Stocker les infos rate limit pour les headers de réponse
    request.state.rate_limit_limit = limit
    request.state.rate_limit_remaining = remaining
    request.state.rate_limit_reset = reset_seconds
    request.state.api_key_id = key_id
    request.state.entreprise_id = api_info['entreprise_id']

    # Créer et retourner le contexte tenant
    return create_tenant_context_from_api_info(api_info)


def require_permission(permission: str):
    """
    Decorator factory pour vérifier une permission spécifique.

    Usage:
        @app.get("/api/v1/invoices")
        @require_permission("invoices:read")
        async def list_invoices(tenant: TenantContext = Depends(get_tenant_context)):
            ...

    Args:
        permission: Permission requise (ex: "invoices:read")

    Returns:
        Dependency function
    """
    async def permission_checker(tenant: TenantContext = Depends(get_tenant_context)):
        if not tenant.has_permission(permission):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "permission_denied",
                    "message": f"Permission requise: {permission}",
                    "your_permissions": tenant.permissions
                }
            )
        return tenant

    return permission_checker


# ═══════════════════════════════════════════════════════════════════════════════
# MIDDLEWARE
# ═══════════════════════════════════════════════════════════════════════════════

class APILoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware pour logger les requêtes API et ajouter les headers rate limit.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Ignorer les endpoints non-API
        if not request.url.path.startswith("/api/"):
            return await call_next(request)

        start_time = time.time()

        # Exécuter la requête
        response = await call_next(request)

        # Calculer le temps de réponse
        response_time_ms = int((time.time() - start_time) * 1000)

        # Ajouter les headers rate limit si disponibles
        if hasattr(request.state, 'rate_limit_limit'):
            response.headers["X-RateLimit-Limit"] = str(request.state.rate_limit_limit)
            response.headers["X-RateLimit-Remaining"] = str(request.state.rate_limit_remaining)
            response.headers["X-RateLimit-Reset"] = str(request.state.rate_limit_reset)

        # Ajouter le temps de réponse
        response.headers["X-Response-Time"] = f"{response_time_ms}ms"

        # Logger la requête
        log_api_request(
            request=request,
            status_code=response.status_code,
            response_time_ms=response_time_ms
        )

        return response


# ═══════════════════════════════════════════════════════════════════════════════
# SECURITY HEADERS MIDDLEWARE (P2-E)
# ═══════════════════════════════════════════════════════════════════════════════

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Adds standard security headers to all API responses.
    Protects against clickjacking, MIME sniffing, and XSS.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

        # HSTS: only in production (Render provides SSL)
        import os
        if os.environ.get("ENVIRONMENT") == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        return response


# ═══════════════════════════════════════════════════════════════════════════════
# LOGGING
# ═══════════════════════════════════════════════════════════════════════════════

def log_api_request(
    request: Request,
    status_code: int,
    response_time_ms: int,
    error_message: Optional[str] = None
):
    """
    Enregistre une requête API dans la table de logs.

    Args:
        request: Requête FastAPI
        status_code: Code de réponse HTTP
        response_time_ms: Temps de réponse en ms
        error_message: Message d'erreur si applicable
    """
    try:
        # Extraire les informations de la requête
        api_key_id = getattr(request.state, 'api_key_id', None)
        entreprise_id = getattr(request.state, 'entreprise_id', None)

        # Obtenir l'IP client
        client_ip = request.client.host if request.client else None

        # User agent
        user_agent = request.headers.get("User-Agent", "")[:500]

        # Taille du body (approximative)
        content_length = request.headers.get("Content-Length", 0)

        # Enregistrer en base de données
        conn = database_config.get_connection()
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")

        cursor.execute('''
            INSERT INTO api_request_logs
            (api_key_id, entreprise_id, endpoint, method, status_code,
             response_time_ms, ip_address, user_agent, request_body_size, error_message)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ''', (
            api_key_id,
            entreprise_id,
            request.url.path,
            request.method,
            status_code,
            response_time_ms,
            client_ip,
            user_agent,
            int(content_length) if content_length else 0,
            error_message
        ))

        conn.commit()
        conn.close()

    except (psycopg2.Error, AttributeError, TypeError, ValueError) as e:
        # Ne pas faire échouer la requête si le logging échoue
        logger.warning(f"[API Middleware] Erreur logging requête: {e}")


# ═══════════════════════════════════════════════════════════════════════════════
# EXCEPTION HANDLERS
# ═══════════════════════════════════════════════════════════════════════════════

async def api_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """
    Handler personnalisé pour les exceptions API.

    Assure un format de réponse cohérent pour toutes les erreurs.
    """
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)},
            "status_code": exc.status_code,
            "timestamp": datetime.now().isoformat()
        },
        headers=exc.headers
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Handler pour les exceptions non gérées.
    """
    logger.error(f"[API] Exception non gérée: {exc}", exc_info=True)

    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "error": "internal_server_error",
                "message": "Une erreur interne s'est produite."
            },
            "status_code": 500,
            "timestamp": datetime.now().isoformat()
        }
    )


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def get_optional_tenant_context(
    api_key: Optional[str] = Depends(api_key_header)
) -> Optional[TenantContext]:
    """
    Dependency pour obtenir un contexte tenant optionnel.

    Utile pour les endpoints qui fonctionnent avec ou sans authentification.

    Returns:
        TenantContext si authentifié, None sinon
    """
    if not api_key:
        return None

    api_info = verify_api_key(api_key)
    if not api_info:
        return None

    return create_tenant_context_from_api_info(api_info)


def cleanup_tenant_context(tenant: Optional[TenantContext]):
    """
    Nettoie un contexte tenant après utilisation.

    À appeler dans un bloc finally ou avec un context manager.
    """
    if tenant:
        tenant.close()


# ═══════════════════════════════════════════════════════════════════════════════
# CORS ORIGINS
# ═══════════════════════════════════════════════════════════════════════════════

def get_allowed_origins() -> list:
    """
    Retourne la liste des origines CORS autorisées.

    En production, cette liste devrait être restreinte.
    """
    import os

    # Origines par défaut — surchargez via ALLOWED_ORIGINS (CSV) en .env
    _env_origins = os.environ.get("ALLOWED_ORIGINS", "").strip()
    if _env_origins:
        origins = [o.strip() for o in _env_origins.split(",") if o.strip()]
    else:
        origins = []

    # Ajouter localhost en développement
    env = os.environ.get("ENVIRONMENT", "local")
    if env in ("local", "development"):
        origins.extend([
            "http://localhost:8501",
            "http://localhost:8000",
            "http://127.0.0.1:8501",
            "http://127.0.0.1:8000",
        ])

    # Origines personnalisées depuis env
    custom_origins = os.environ.get("ALLOWED_ORIGINS", "")
    if custom_origins:
        origins.extend(custom_origins.split(","))

    return origins


# ═══════════════════════════════════════════════════════════════════════════════
# TEST
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=== Test Module API Middleware ===")
    print(f"API Key Header: {API_KEY_HEADER_NAME}")
    print(f"Rate Limit Window: {RATE_LIMIT_WINDOW_SECONDS}s")
    print(f"Allowed Origins: {get_allowed_origins()}")

    # Test rate limiter
    print("\n--- Test Rate Limiter ---")
    for i in range(5):
        allowed, remaining, reset = rate_limiter.check_rate_limit(999, 3)
        print(f"Request {i+1}: allowed={allowed}, remaining={remaining}")
