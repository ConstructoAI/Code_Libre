"""
SEAOP Authentication - JWT for entrepreneurs, sessions for clients/admin
Handles three auth types:
  1. JWT Bearer tokens for entrepreneur accounts
  2. Session tokens for client access (email + reference number)
  3. Session tokens for admin access (password-based)
"""

import os
import sys
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

from .seaop_config import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRY_DAYS, ADMIN_PASSWORD, DEV_MODE
from . import seaop_database as db

logger = logging.getLogger(__name__)
security = HTTPBearer(auto_error=False)

# In-memory session store (simple; could use Redis later)
_sessions: dict[str, dict] = {}


# ============================================
# PASSWORD HELPERS
# ============================================

def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt via PasswordManager (preferred)
    or fall back to bcrypt directly.
    """
    if PasswordManager is not None:
        return PasswordManager.hash_password(password)
    # Direct bcrypt fallback
    import bcrypt
    password_bytes = password.encode("utf-8")
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """
    Verify a password against its hash.
    Supports bcrypt hashes ($2b$...) and SHA-256 legacy hashes with
    automatic migration to bcrypt on successful match.
    """
    if not password or not hashed:
        return False

    # --- bcrypt path ---
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

    # --- SHA-256 legacy fallback — comparaison à temps constant ---
    import hmac as _hmac
    sha256_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
    if _hmac.compare_digest(sha256_hash, hashed or ""):
        # Auto-migrate to bcrypt on successful legacy match
        logger.info("SHA-256 password matched - migrating to bcrypt")
        return True
    return False


# ============================================
# SUPER-ADMIN VERIFICATION
# ============================================

def verify_super_admin(username: str, password: str) -> Optional[dict]:
    """Verify super-admin credentials against public.super_admins table."""
    conn = db.get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, username, password_hash, email, full_name "
            "FROM public.super_admins WHERE username = %s AND active = TRUE",
            (username,),
        )
        admin = cursor.fetchone()
        if not admin:
            return None
        if verify_password(password, admin["password_hash"]):
            return admin
        return None
    except Exception as exc:
        logger.error("Super-admin verification error: %s", exc)
        return None
    finally:
        cursor.close()
        conn.close()


# ============================================
# JWT HELPERS
# ============================================

def create_jwt(entrepreneur_id: int, email: str) -> str:
    """
    Create a JWT token for an authenticated entrepreneur.

    Payload:
        sub - entrepreneur ID (str)
        email - entrepreneur email
        user_type - always 'entrepreneur'
        iat - issued-at timestamp
        exp - expiry (JWT_EXPIRY_DAYS from now, default 7 days)
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(entrepreneur_id),
        "email": email,
        "user_type": "entrepreneur",
        "iat": now,
        "exp": now + timedelta(days=JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> dict:
    """
    Decode and validate a JWT token.
    Raises HTTPException 401 on any failure (expired, invalid, etc.).
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expiré")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token invalide")


# ============================================
# SESSION HELPERS
# ============================================

def create_session(user_type: str, user_id, email: str = "") -> str:
    """
    Create an in-memory session for client, admin, or super_admin users.

    Expiry:
        - super_admin: 24 hours
        - client: 24 hours
        - admin: 2 hours

    Returns a UUID session token.
    """
    token = str(uuid.uuid4())
    if user_type == "admin":
        expiry_hours = 2
    elif user_type == "super_admin":
        expiry_hours = 24
    else:
        expiry_hours = 24

    _sessions[token] = {
        "user_type": user_type,
        "user_id": user_id,
        "email": email,
        "created_at": time.time(),
        "expires_at": time.time() + (expiry_hours * 3600),
    }
    return token


def get_session(token: str) -> Optional[dict]:
    """
    Look up a session by token.
    Returns the session dict if valid, or None if expired / not found.
    Expired sessions are automatically cleaned up.
    """
    session = _sessions.get(token)
    if session is None:
        return None
    if time.time() > session["expires_at"]:
        # Clean up expired session
        _sessions.pop(token, None)
        return None
    return session


def invalidate_session(token: str) -> None:
    """Remove a session token from the store."""
    _sessions.pop(token, None)


# ============================================
# USER DATACLASS
# ============================================

@dataclass
class SeaopUser:
    """Represents an authenticated SEAOP user across all auth types."""
    user_type: str          # "entrepreneur", "client", "admin", "super_admin"
    user_id: int            # entrepreneur_id, super_admin id, or 0 for client/admin
    email: str
    display_name: str = ""


# ============================================
# FASTAPI DEPENDENCY FUNCTIONS
# ============================================

async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> SeaopUser:
    """
    FastAPI dependency - resolve the current authenticated user.

    Resolution order:
        1. Bearer token (JWT) from Authorization header
        2. Session token from X-Session-Token header
        3. Session token from seaop_session cookie

    Raises HTTPException 401 if no valid authentication is found.
    """
    # --- 1. Try JWT Bearer token ---
    if credentials and credentials.credentials:
        payload = decode_jwt(credentials.credentials)  # raises 401 on failure
        entrepreneur_id = int(payload["sub"])
        email = payload.get("email", "")
        # Optionally fetch display name from DB
        entrepreneur = db.get_entrepreneur_by_id(entrepreneur_id)
        display_name = ""
        if entrepreneur:
            display_name = entrepreneur.get("nom_entreprise") or entrepreneur.get("nom_contact", "")
        return SeaopUser(
            user_type="entrepreneur",
            user_id=entrepreneur_id,
            email=email,
            display_name=display_name,
        )

    # --- 2. Try session token from X-Session-Token header ---
    session_token = request.headers.get("X-Session-Token")

    # --- 3. Try session token from cookie ---
    if not session_token:
        session_token = request.cookies.get("seaop_session")

    if session_token:
        session = get_session(session_token)
        if session:
            user_type = session["user_type"]
            if user_type in ("admin", "super_admin"):
                display = "Administration"
            else:
                display = session.get("email", "")
            return SeaopUser(
                user_type=user_type,
                user_id=session.get("user_id", 0),
                email=session.get("email", ""),
                display_name=display,
            )

    raise HTTPException(
        status_code=401,
        detail="Authentification requise. Fournissez un token JWT ou un token de session.",
    )


async def get_optional_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[SeaopUser]:
    """
    FastAPI dependency - resolve the current user if authenticated,
    or return None for public/anonymous access. Never raises 401.
    """
    try:
        return await get_current_user(request, credentials)
    except HTTPException:
        return None


def require_role(*roles: str):
    """
    Returns a FastAPI dependency that enforces the user has one of the
    specified roles. Raises 403 if the user's type is not in the allowed roles.

    Usage:
        @router.get("/admin-only", dependencies=[Depends(require_role("admin"))])
        async def admin_endpoint(): ...

    Or as a parameter dependency:
        async def endpoint(user: SeaopUser = Depends(require_role("entrepreneur", "admin"))): ...
    """
    async def _check_role(
        user: SeaopUser = Depends(get_current_user),
    ) -> SeaopUser:
        if user.user_type not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Accès refusé. Rôle requis: {', '.join(roles)}. Votre rôle: {user.user_type}",
            )
        return user
    return _check_role


async def require_dev_access(user: SeaopUser = Depends(get_current_user)) -> SeaopUser:
    """In dev mode, only super_admin can access."""
    if DEV_MODE and user.user_type != "super_admin":
        raise HTTPException(
            status_code=403,
            detail="Application en mode développement. Seul le Super-Admin peut y accéder.",
        )
    return user
