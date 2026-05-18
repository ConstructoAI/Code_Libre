"""
ERP React Authentication - Multi-tenant JWT + Sessions
Handles three auth layers:
  1. Tenant auth: entreprise email + password → tenant context
  2. User auth: username + password within tenant → JWT token
  3. Super-Admin auth: username + password → session token
"""

import os
import sys
import json
import logging
import uuid
import time
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional
from dataclasses import dataclass

import jwt  # PyJWT
from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# Import from project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
try:
    from security_utils import PasswordManager
except ImportError:
    PasswordManager = None

from .erp_config import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRY_DAYS, DEV_MODE
from . import erp_database as db

logger = logging.getLogger(__name__)
security = HTTPBearer(auto_error=False)


# ============================================
# PASSWORD HELPERS
# ============================================

def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    if PasswordManager is not None:
        return PasswordManager.hash_password(password)
    import bcrypt
    password_bytes = password.encode("utf-8")
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """Verify a password against its hash (bcrypt or SHA-256 legacy)."""
    if not password or not hashed:
        return False

    # bcrypt path
    if hashed.startswith("$2b$") or hashed.startswith("$2a$"):
        if PasswordManager is not None:
            return PasswordManager.verify_password(password, hashed)
        import bcrypt
        try:
            return bcrypt.checkpw(
                password.encode("utf-8"),
                hashed.encode("utf-8"),
            )
        except Exception as exc:
            logger.error("bcrypt verification error: %s", exc)
            return False

    # SHA-256 legacy fallback — comparaison à temps constant pour éviter
    # toute fuite par timing même si la pré-comparaison est rapide.
    import hmac as _hmac
    sha256_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
    if _hmac.compare_digest(sha256_hash, hashed or ""):
        logger.info("SHA-256 password matched - should migrate to bcrypt")
        return True
    return False


# ============================================
# SUPER-ADMIN VERIFICATION
# ============================================

def verify_super_admin(username: str, password: str) -> Optional[dict]:
    """Verify super-admin credentials against public.super_admins table."""
    admin = db.get_super_admin(username)
    if not admin:
        return None
    if verify_password(password, admin["password_hash"]):
        return admin
    return None


# ============================================
# JWT HELPERS
# ============================================

def create_jwt(user_id: int, email: str, schema: str, role: str = "admin") -> str:
    """Create a JWT token for an authenticated ERP user."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "schema": schema,
        "role": role,
        "user_type": "user",
        "iat": now,
        "exp": now + timedelta(days=JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_b2b_client_jwt(client_user_id: int, email: str, schema: str,
                          client_id: int) -> str:
    """Create a JWT token for an authenticated B2B client user."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(client_user_id),
        "email": email,
        "schema": schema,
        "role": "b2b_client",
        "user_type": "b2b_client",
        "client_id": client_id,
        "iat": now,
        "exp": now + timedelta(days=JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> dict:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expire")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token invalide")


# ============================================
# SESSION HELPERS (database-backed via public.active_sessions)
# ============================================

def create_session(user_type: str, user_id, email: str = "",
                   schema: str = "", display_name: str = "") -> str:
    """Create a DB-backed session in public.active_sessions."""
    token = str(uuid.uuid4())
    expiry_hours = 24 if user_type == "super_admin" else 8

    session_data = {
        "user_type": user_type,
        "user_id": user_id,
        "email": email,
        "schema": schema,
        "display_name": display_name,
        "created_at": time.time(),
        "source": "erp_react",
    }

    conn = db.get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")
        cursor.execute(
            """
            INSERT INTO active_sessions
                (session_id, session_token, session_data, expires_at,
                 login_time, last_activity, is_super_admin,
                 username, user_email)
            VALUES
                (%s, %s, %s, NOW() + make_interval(hours => %s),
                 NOW(), NOW(), %s, %s, %s)
            """,
            (
                token, token, json.dumps(session_data), expiry_hours,
                user_type == "super_admin",
                display_name or email, email,
            ),
        )
        conn.commit()
        cursor.close()
    except Exception as exc:
        logger.error("Failed to create DB session: %s", exc)
        conn.rollback()
    finally:
        conn.close()

    return token


def get_session(token: str) -> Optional[dict]:
    """Look up a session by token from the database."""
    if not token:
        return None

    conn = db.get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")
        cursor.execute(
            """
            SELECT session_data, expires_at
            FROM active_sessions
            WHERE session_token = %s
              AND (expires_at IS NULL OR expires_at > NOW())
            """,
            (token,),
        )
        row = cursor.fetchone()
        if not row:
            cursor.close()
            return None

        # Update last_activity
        cursor.execute(
            "UPDATE active_sessions SET last_activity = NOW() WHERE session_token = %s",
            (token,),
        )
        conn.commit()
        cursor.close()

        data = row["session_data"]
        if isinstance(data, str):
            data = json.loads(data)
        return data
    except Exception as exc:
        logger.error("get_session error: %s", exc)
        return None
    finally:
        conn.close()


def register_erp_session(user_id: int, username: str, email: str,
                         schema: str, entreprise_id: int = None,
                         entreprise_nom: str = "") -> None:
    """Register an ERP user session in active_sessions for admin monitoring."""
    session_id = f"erp_{schema}_{user_id}"
    conn = db.get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")
        # Upsert: if same user re-logs, update the session
        cursor.execute(
            """
            INSERT INTO active_sessions
                (session_id, entreprise_id, entreprise_nom, schema_name,
                 user_id, username, user_email,
                 login_time, last_activity, is_super_admin, product_type)
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW(), FALSE, 'ERP')
            ON CONFLICT (session_id) DO UPDATE SET
                last_activity = NOW(),
                login_time = NOW(),
                username = EXCLUDED.username,
                entreprise_nom = EXCLUDED.entreprise_nom
            """,
            (session_id, entreprise_id, entreprise_nom, schema,
             user_id, username, email),
        )
        conn.commit()
        cursor.close()
    except Exception as exc:
        logger.error("register_erp_session error: %s", exc)
        conn.rollback()
    finally:
        conn.close()


def unregister_erp_session(user_id: int, schema: str) -> None:
    """Remove an ERP user session from active_sessions."""
    session_id = f"erp_{schema}_{user_id}"
    conn = db.get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")
        cursor.execute(
            "DELETE FROM active_sessions WHERE session_id = %s",
            (session_id,),
        )
        conn.commit()
        cursor.close()
    except Exception as exc:
        logger.error("unregister_erp_session error: %s", exc)
    finally:
        conn.close()


def touch_erp_session(user_id: int, schema: str) -> None:
    """Update last_activity for an ERP user session."""
    session_id = f"erp_{schema}_{user_id}"
    conn = db.get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")
        cursor.execute(
            "UPDATE active_sessions SET last_activity = NOW() WHERE session_id = %s",
            (session_id,),
        )
        conn.commit()
        cursor.close()
    except Exception as exc:
        logger.error("touch_erp_session error: %s", exc)
    finally:
        conn.close()


def invalidate_session(token: str) -> None:
    """Remove a session from the database."""
    if not token:
        return

    conn = db.get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")
        cursor.execute(
            "DELETE FROM active_sessions WHERE session_token = %s",
            (token,),
        )
        conn.commit()
        cursor.close()
    except Exception as exc:
        logger.error("invalidate_session error: %s", exc)
    finally:
        conn.close()


# Track last touch time per user to avoid DB write on every request
_last_touch: dict[str, float] = {}
_TOUCH_INTERVAL = 300  # 5 minutes


# ============================================
# USER DATACLASS
# ============================================

@dataclass
class ErpUser:
    """Represents an authenticated ERP user."""
    user_type: str       # "user", "super_admin"
    user_id: int
    email: str
    display_name: str = ""
    schema: str = ""     # tenant schema (e.g., "tenant_xxx")
    role: str = ""       # "admin", "employee", "super_admin"


@dataclass
class B2bClientUser:
    """Represents an authenticated B2B client user."""
    user_type: str = "b2b_client"
    user_id: int = 0       # b2b_client_users.id
    client_id: int = 0     # b2b_clients.id
    email: str = ""
    display_name: str = ""
    schema: str = ""       # tenant schema


# ============================================
# FASTAPI DEPENDENCY FUNCTIONS
# ============================================

async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> ErpUser:
    """
    Resolve the current authenticated user.
    Resolution order:
        1. Bearer token (JWT) from Authorization header
        2. Session token from X-Session-Token header
        3. Session token from erp_session cookie
    """
    # --- 1. Try JWT Bearer token ---
    if credentials and credentials.credentials:
        payload = decode_jwt(credentials.credentials)
        # Reject B2B client tokens — they must use get_current_b2b_client()
        if payload.get("user_type") == "b2b_client":
            raise HTTPException(status_code=403, detail="Acces reserve aux utilisateurs ERP")
        user_id = int(payload["sub"])
        email = payload.get("email", "")
        schema = payload.get("schema", "")
        role = payload.get("role", "user")

        # Fetch display name
        display_name = email
        if schema:
            user = db.get_user_by_id(schema, user_id)
            if user:
                display_name = user.get("full_name") or user.get("username", email)

        # Touch session activity (throttled to avoid DB write on every request)
        touch_key = f"erp_{schema}_{user_id}"
        now = time.time()
        if now - _last_touch.get(touch_key, 0) > _TOUCH_INTERVAL:
            _last_touch[touch_key] = now
            touch_erp_session(user_id, schema)

        return ErpUser(
            user_type="user",
            user_id=user_id,
            email=email,
            display_name=display_name,
            schema=schema,
            role=role,
        )

    # --- 2. Try session token from header ---
    session_token = request.headers.get("X-Session-Token")

    # --- 3. Try session token from cookie ---
    if not session_token:
        session_token = request.cookies.get("erp_session")

    if session_token:
        session = get_session(session_token)
        if session:
            user_type = session["user_type"]
            return ErpUser(
                user_type=user_type,
                user_id=session.get("user_id", 0),
                email=session.get("email", ""),
                display_name=session.get("display_name", ""),
                schema=session.get("schema", ""),
                role=user_type,
            )

    raise HTTPException(
        status_code=401,
        detail="Authentification requise. Fournissez un token JWT ou un token de session.",
    )


async def get_optional_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[ErpUser]:
    """Resolve the current user or return None for anonymous access."""
    try:
        return await get_current_user(request, credentials)
    except HTTPException:
        return None


async def get_current_b2b_client(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> B2bClientUser:
    """Resolve the current B2B client user from JWT."""
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Token B2B requis")
    payload = decode_jwt(credentials.credentials)
    if payload.get("user_type") != "b2b_client":
        raise HTTPException(status_code=403, detail="Acces reserve aux clients B2B")
    client_id = int(payload.get("client_id", 0))
    if client_id <= 0:
        raise HTTPException(status_code=401, detail="Token B2B invalide")
    schema = payload.get("schema", "")
    if not schema:
        raise HTTPException(status_code=401, detail="Token B2B invalide")
    return B2bClientUser(
        user_type="b2b_client",
        user_id=int(payload["sub"]),
        client_id=client_id,
        email=payload.get("email", ""),
        display_name=payload.get("email", ""),
        schema=schema,
    )


def require_role(*roles: str):
    """Returns a dependency that enforces the user has one of the specified roles."""
    async def _check_role(
        user: ErpUser = Depends(get_current_user),
    ) -> ErpUser:
        if user.role not in roles and user.user_type not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Acces refuse. Role requis: {', '.join(roles)}. Votre role: {user.role}",
            )
        return user
    return _check_role


async def require_dev_access(user: ErpUser = Depends(get_current_user)) -> ErpUser:
    """In dev mode, only super_admin can access."""
    if DEV_MODE and user.user_type != "super_admin":
        raise HTTPException(
            status_code=403,
            detail="Application en mode developpement. Seul le Super-Admin peut y acceder.",
        )
    return user
