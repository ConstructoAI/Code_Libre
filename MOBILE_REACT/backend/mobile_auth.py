"""Auth JWT multi-tenant pour l'app Mobile Pointage."""

import hashlib
import hmac
import os
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger(__name__)

JWT_SECRET = os.environ.get("JWT_SECRET_KEY")
if not JWT_SECRET:
    import secrets
    if os.environ.get("ENVIRONMENT", "development").lower() == "production":
        raise RuntimeError(
            "JWT_SECRET_KEY doit etre defini en production. "
            "Generez une cle avec: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )
    JWT_SECRET = secrets.token_urlsafe(64)
    logger.warning(
        "JWT_SECRET_KEY non defini. Cle aleatoire generee pour ce processus uniquement. "
        "Les sessions ne survivront pas au redemarrage. Definissez JWT_SECRET_KEY dans .env."
    )
JWT_ALGORITHM = "HS256"
# Expiration courte pour mobile : un téléphone volé/perdu doit invalider rapidement.
# Surchargeable via JWT_EXPIRATION_HOURS pour les tenants exigeant un usage prolongé.
JWT_EXPIRATION_HOURS = int(os.environ.get("JWT_EXPIRATION_HOURS", "4"))

security = HTTPBearer(auto_error=False)


# VALID_ROLES_MOBILE est la source de verite — importee depuis mobile_database
# pour eviter la duplication. L'alias local est conserve pour les imports existants.
from .mobile_database import VALID_ROLES_MOBILE  # noqa: E402


class MobileTenantContext:
    """Contexte du tenant extrait du JWT mobile."""

    def __init__(
        self,
        tenant_schema: str,
        employee_id: int,
        employee_name: str = "",
        role: str = "EMPLOYE",
    ):
        self.tenant_schema = tenant_schema
        self.employee_id = employee_id
        self.employee_name = employee_name
        # Fallback safe pour JWT pre-migration sans champ role
        self.role = role if role in VALID_ROLES_MOBILE else "EMPLOYE"


def create_token(
    tenant_schema: str,
    employee_id: int,
    employee_name: str,
    role: str = "EMPLOYE",
) -> str:
    """Cree un JWT pour un employe authentifie par PIN.

    Le role est inclus pour eviter une requete DB par check de permission.
    Les JWT pre-migration sans role sont traites comme EMPLOYE cote decode.
    """
    safe_role = role if role in VALID_ROLES_MOBILE else "EMPLOYE"
    now = datetime.now(timezone.utc)
    payload = {
        "tenant_schema": tenant_schema,
        "employee_id": employee_id,
        "employee_name": employee_name,
        "role": safe_role,
        "exp": now + timedelta(hours=JWT_EXPIRATION_HOURS),
        "iat": now,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode et valide un JWT."""
    try:
        payload = jwt.decode(
            token, JWT_SECRET, algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "tenant_schema", "employee_id"]}
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expire")
    except jwt.InvalidTokenError as e:
        logger.warning("Token invalide: %s", e)
        raise HTTPException(status_code=401, detail="Token invalide")


async def get_mobile_context(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> MobileTenantContext:
    """Dependance FastAPI standard pour extraire le contexte tenant du JWT mobile.

    Accepte uniquement le Bearer header — pas de fallback query token (deprecated
    pour eviter fuite via logs/referrer/history). Pour les endpoints de download
    necessitant <img src> ou <a href>, utiliser get_mobile_context_or_signed et
    POST /auth/signed-url cote client.
    """
    if not credentials:
        # Le token ne doit JAMAIS transiter en query string (logs serveur, referer,
        # historique navigateur). Pour les téléchargements depuis <img>/<a>, utilisez
        # POST /auth/signed-url côté client et un cookie/header.
        raise HTTPException(status_code=401, detail="Token d'authentification requis")

    payload = decode_token(credentials.credentials)
    return _payload_to_context(payload)


def _payload_to_context(payload: dict) -> MobileTenantContext:
    """Convertit un payload JWT decode en MobileTenantContext (avec validations).

    JWT pre-migration sans champ 'role' → fallback 'EMPLOYE' (pas de
    deconnexion forcee apres deploiement de la fonctionnalite roles).
    """
    tenant_schema = payload.get("tenant_schema")
    employee_id = payload.get("employee_id")
    if not tenant_schema or not employee_id:
        raise HTTPException(status_code=401, detail="Token incomplet")
    return MobileTenantContext(
        tenant_schema=tenant_schema,
        employee_id=int(employee_id),
        employee_name=payload.get("employee_name", ""),
        role=payload.get("role", "EMPLOYE"),
    )


# ============================================================================
# SIGNED URLs HMAC (pour <img src> et <a href> sans exposer le JWT)
# ============================================================================

SIGNED_URL_DEFAULT_TTL = 300  # 5 minutes
# Limite TTL accepte pour eviter les URL eternelles
SIGNED_URL_MAX_TTL = 3600  # 1 heure max


def create_signed_url(path: str, ctx: MobileTenantContext, ttl_seconds: int = SIGNED_URL_DEFAULT_TTL) -> str:
    """Genere une URL signee HMAC-SHA256 pour un download (TTL court).

    La signature est liee au path exact + tenant + employee + expiration —
    impossible a rejouer sur un autre endpoint. JWT_SECRET sert de cle HMAC,
    rotation du secret invalide toutes les URLs en cours.

    Args:
        path: Chemin API absolu (ex: /api/mobile/v1/dossiers/123/documents/456/download)
        ctx: Contexte tenant deja authentifie via Bearer
        ttl_seconds: Duree de validite (default 5 min, max 1 heure)

    Returns:
        URL avec query params exp/eid/t/sig appendus.
    """
    ttl = max(60, min(int(ttl_seconds), SIGNED_URL_MAX_TTL))
    exp = int(time.time()) + ttl
    # NULL byte (\x00) comme separateur : interdit dans URL path et donc
    # impossible a injecter via tenant_schema/path/exp. Evite la collision
    # de separateur (path contenant '|' aurait pu permettre forge de signature).
    msg = b"\x00".join([
        path.encode("utf-8"),
        ctx.tenant_schema.encode("utf-8"),
        str(ctx.employee_id).encode("utf-8"),
        str(exp).encode("utf-8"),
    ])
    sig = hmac.new(JWT_SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    sep = '&' if '?' in path else '?'
    return f"{path}{sep}exp={exp}&eid={ctx.employee_id}&t={ctx.tenant_schema}&sig={sig}"


def verify_signed_url(request: Request) -> Optional[MobileTenantContext]:
    """Verifie une URL signee. Renvoie le contexte si valide, sinon None.

    Comparaison constant-time via hmac.compare_digest pour eviter timing attacks.
    """
    qp = request.query_params
    sig = qp.get("sig")
    exp = qp.get("exp")
    eid = qp.get("eid")
    tenant = qp.get("t")

    if not (sig and exp and eid and tenant):
        return None

    try:
        exp_int = int(exp)
        eid_int = int(eid)
    except (ValueError, TypeError):
        return None

    if exp_int < int(time.time()):
        return None

    # Defense en profondeur: rejeter les paths suspicieux (double slash,
    # path traversal). Le path doit etre normalise par Starlette/Uvicorn
    # mais on revalide ici car la signature est bind a ce path exact.
    norm_path = request.url.path
    if "//" in norm_path or "/.." in norm_path or "\x00" in norm_path:
        logger.warning("[SIGNED-URL] Path suspect rejete: %r", norm_path)
        return None

    # Rebuild le message attendu (bind par path) — meme encoding que create_signed_url
    msg = b"\x00".join([
        norm_path.encode("utf-8"),
        tenant.encode("utf-8"),
        str(eid_int).encode("utf-8"),
        str(exp_int).encode("utf-8"),
    ])
    expected_sig = hmac.new(JWT_SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(sig, expected_sig):
        return None

    # Note: signed URL ne porte pas le role — fallback 'EMPLOYE'.
    # require_role utilise get_mobile_context (Bearer only), donc les
    # endpoints RBAC ne sont jamais accessibles via signed URL.
    return MobileTenantContext(tenant_schema=tenant, employee_id=eid_int, role="EMPLOYE")


async def get_mobile_context_or_signed(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> MobileTenantContext:
    """Dependance pour endpoints download : accepte Bearer header OU signed URL.

    Ordre : Bearer header > signed URL HMAC. Le fallback historique ?token=JWT
    a été retiré pour éviter les fuites de token via logs serveur, referer et
    historique navigateur. Les clients doivent utiliser POST /auth/signed-url.
    """
    # Bearer header en premier (le plus securise)
    if credentials:
        payload = decode_token(credentials.credentials)
        return _payload_to_context(payload)

    # Signed URL HMAC (pour <img src> et <a href>)
    signed_ctx = verify_signed_url(request)
    if signed_ctx:
        return signed_ctx

    raise HTTPException(status_code=401, detail="Token d'authentification requis")
