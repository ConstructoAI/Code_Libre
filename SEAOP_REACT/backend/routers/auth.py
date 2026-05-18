"""
SEAOP React - Authentication Router
Endpoints for entrepreneur JWT auth, client session auth, and admin session auth.
"""

import hmac
import logging
import os

from fastapi import APIRouter, HTTPException, Response, Request, Depends
from fastapi.responses import JSONResponse

from ..seaop_models import (
    EntrepreneurLogin,
    EntrepreneurRegister,
    ClientLogin,
    AdminLogin,
    AuthResponse,
    UserResponse,
)
from .. import seaop_auth as auth
from .. import seaop_database as db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])

# Cookies marqués Secure dès qu'on quitte le mode dev. Surchargeable via
# FORCE_SECURE_COOKIES=true (utile derrière un reverse-proxy HTTPS local).
_IS_PROD = os.getenv("ENVIRONMENT", "development").lower() == "production"
_COOKIE_SECURE = _IS_PROD or os.getenv("FORCE_SECURE_COOKIES", "false").lower() == "true"


# ============================================
# ENTREPRENEUR AUTH
# ============================================

@router.post("/entrepreneur/login", response_model=AuthResponse)
async def entrepreneur_login(body: EntrepreneurLogin):
    """
    Authenticate an entrepreneur with email + password.
    Returns a JWT access token and entrepreneur profile.
    """
    entrepreneur = db.get_entrepreneur_by_email(body.email)
    if not entrepreneur:
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")

    hashed = entrepreneur.get("mot_de_passe_hash", "")
    if not auth.verify_password(body.mot_de_passe, hashed):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")

    # If password was SHA-256 legacy, migrate hash to bcrypt in DB
    if not (hashed.startswith("$2b$") or hashed.startswith("$2a$")):
        try:
            new_hash = auth.hash_password(body.mot_de_passe)
            db.update_entrepreneur(entrepreneur["id"], {"mot_de_passe_hash": new_hash})
            logger.info("Migrated SHA-256 password to bcrypt for entrepreneur %s", entrepreneur["id"])
        except Exception as exc:
            logger.warning("Failed to migrate password hash: %s", exc)

    token = auth.create_jwt(entrepreneur["id"], entrepreneur["email"])

    user_data = UserResponse(
        id=entrepreneur["id"],
        email=entrepreneur["email"],
        nom_entreprise=entrepreneur.get("nom_entreprise"),
        nom_contact=entrepreneur.get("nom_contact"),
        telephone=entrepreneur.get("telephone"),
        user_type="entrepreneur",
        numero_rbq=entrepreneur.get("numero_rbq"),
        zones_desservies=entrepreneur.get("zones_desservies"),
        types_projets=entrepreneur.get("types_projets"),
        abonnement=entrepreneur.get("abonnement"),
        credits_restants=entrepreneur.get("credits_restants"),
        certifications=entrepreneur.get("certifications"),
        evaluations_moyenne=entrepreneur.get("evaluations_moyenne"),
        nombre_evaluations=entrepreneur.get("nombre_evaluations"),
        statut=entrepreneur.get("statut"),
        date_inscription=entrepreneur.get("date_inscription"),
        rbq_verifie=entrepreneur.get("rbq_verifie", False),
        categories_rbq=entrepreneur.get("categories_rbq"),
        assurance_responsabilite=entrepreneur.get("assurance_responsabilite", False),
        montant_assurance=entrepreneur.get("montant_assurance"),
        licence_valide_jusqu_au=entrepreneur.get("licence_valide_jusqu_au"),
    )

    return AuthResponse(access_token=token, user=user_data)


@router.post("/entrepreneur/register", response_model=AuthResponse)
async def entrepreneur_register(body: EntrepreneurRegister):
    """
    Register a new entrepreneur account.
    Validates uniqueness of email, hashes password, creates record, returns JWT.
    """
    # Check if email is already taken
    existing = db.get_entrepreneur_by_email(body.email)
    if existing:
        raise HTTPException(
            status_code=409,
            detail="Un compte avec cette adresse email existe déjà",
        )

    # Hash password
    hashed_password = auth.hash_password(body.mot_de_passe)

    # Build entrepreneur data dict
    entrepreneur_data = {
        "nom_entreprise": body.nom_entreprise,
        "nom_contact": body.nom_contact,
        "email": body.email,
        "telephone": body.telephone,
        "mot_de_passe_hash": hashed_password,
        "numero_rbq": body.numero_rbq,
        "zones_desservies": body.zones_desservies,
        "types_projets": body.types_projets,
        "certifications": body.certifications,
        "categories_rbq": body.categories_rbq,
        "assurance_responsabilite": body.assurance_responsabilite,
        "montant_assurance": body.montant_assurance,
        "licence_valide_jusqu_au": body.licence_valide_jusqu_au,
    }

    try:
        entrepreneur = db.create_entrepreneur(entrepreneur_data)
    except Exception as exc:
        logger.error("Failed to create entrepreneur: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la création du compte")

    token = auth.create_jwt(entrepreneur["id"], entrepreneur["email"])

    user_data = UserResponse(
        id=entrepreneur["id"],
        email=entrepreneur["email"],
        nom_entreprise=entrepreneur.get("nom_entreprise"),
        nom_contact=entrepreneur.get("nom_contact"),
        telephone=entrepreneur.get("telephone"),
        user_type="entrepreneur",
        numero_rbq=entrepreneur.get("numero_rbq"),
        zones_desservies=entrepreneur.get("zones_desservies"),
        types_projets=entrepreneur.get("types_projets"),
        certifications=entrepreneur.get("certifications"),
        statut=entrepreneur.get("statut"),
        date_inscription=entrepreneur.get("date_inscription"),
        rbq_verifie=entrepreneur.get("rbq_verifie", False),
        categories_rbq=entrepreneur.get("categories_rbq"),
        assurance_responsabilite=entrepreneur.get("assurance_responsabilite", False),
        montant_assurance=entrepreneur.get("montant_assurance"),
        licence_valide_jusqu_au=entrepreneur.get("licence_valide_jusqu_au"),
    )

    return AuthResponse(access_token=token, user=user_data)


# ============================================
# CLIENT AUTH
# ============================================

@router.post("/client/login")
async def client_login(body: ClientLogin, response: Response):
    """
    Authenticate a client with email + project reference number.
    Creates a session, sets a cookie, and returns the session token.

    Clients don't have dedicated accounts - they are identified by the email
    on their project lead and a matching reference number.
    """
    # Validate that a lead exists with this email and reference
    leads = db.get_leads_by_email(body.email)
    if not leads:
        raise HTTPException(status_code=401, detail="Aucun projet trouvé pour cette adresse email")

    matching = [l for l in leads if l.get("numero_reference") == body.numero_reference]
    if not matching:
        raise HTTPException(
            status_code=401,
            detail="Numéro de référence invalide pour cette adresse email",
        )

    # Create session
    session_token = auth.create_session(
        user_type="client",
        user_id=0,
        email=body.email,
    )

    # Set session cookie (httponly, samesite=lax for security)
    response.set_cookie(
        key="seaop_session",
        value=session_token,
        httponly=True,
        samesite="lax",
        max_age=24 * 3600,  # 24 hours
        secure=_COOKIE_SECURE,
    )

    return {
        "session_token": session_token,
        "user": {
            "user_type": "client",
            "user_id": 0,
            "email": body.email,
            "display_name": body.email,
        },
    }


# ============================================
# ADMIN AUTH
# ============================================

@router.post("/admin/login")
async def admin_login(body: AdminLogin, response: Response):
    """
    Authenticate an admin with username + password.
    Verifies against the configured ADMIN_PASSWORD.
    Creates a session with a 2-hour expiry.
    """
    from ..seaop_config import ADMIN_PASSWORD

    # Refuse l'auth si ADMIN_PASSWORD n'est pas configuré (évite login avec "")
    if not ADMIN_PASSWORD:
        logger.error("[AUTH] ADMIN_PASSWORD non configuré — login admin refusé")
        raise HTTPException(status_code=401, detail="Identifiants invalides")

    # Comparaison à temps constant pour bloquer les timing attacks
    if not hmac.compare_digest(body.password or "", ADMIN_PASSWORD):
        raise HTTPException(status_code=401, detail="Identifiants invalides")

    session_token = auth.create_session(
        user_type="admin",
        user_id=0,
        email=f"admin@{body.username}",
    )

    response.set_cookie(
        key="seaop_session",
        value=session_token,
        httponly=True,
        samesite="lax",
        max_age=2 * 3600,  # 2 hours
        secure=_COOKIE_SECURE,
    )

    return {
        "session_token": session_token,
        "user": {
            "user_type": "admin",
            "user_id": 0,
            "email": "",
            "display_name": "Administrateur",
        },
    }


# ============================================
# SUPER-ADMIN AUTH
# ============================================

@router.post("/super-admin/login")
async def login_super_admin(request: Request):
    """Super-Admin login using public.super_admins credentials."""
    data = await request.json()
    username = data.get("username", "")
    password = data.get("mot_de_passe", "")

    if not username or not password:
        raise HTTPException(400, "Nom d'utilisateur et mot de passe requis")

    admin = auth.verify_super_admin(username, password)
    if not admin:
        raise HTTPException(401, "Identifiants Super-Admin invalides")

    session_token = auth.create_session("super_admin", admin["id"], admin.get("email", ""))

    response = JSONResponse(content={
        "session_token": session_token,
        "user": {
            "user_type": "super_admin",
            "user_id": admin["id"],
            "email": admin.get("email", ""),
            "display_name": admin.get("full_name") or admin["username"],
        },
    })
    response.set_cookie(
        "seaop_session",
        session_token,
        httponly=True,
        samesite="lax",
        max_age=86400,
        secure=_COOKIE_SECURE,
    )
    return response


# ============================================
# LOGOUT
# ============================================

@router.post("/logout")
async def logout(request: Request, response: Response):
    """
    Log out the current user by invalidating their session.
    Works for session-based auth (client/admin). JWT tokens are
    stateless and cannot be revoked server-side.
    """
    # Try X-Session-Token header first
    session_token = request.headers.get("X-Session-Token")
    if not session_token:
        session_token = request.cookies.get("seaop_session")

    if session_token:
        auth.invalidate_session(session_token)

    # Clear the cookie regardless
    response.delete_cookie("seaop_session")

    return {"success": True, "message": "Déconnexion réussie"}


# ============================================
# CURRENT USER INFO
# ============================================

@router.get("/me")
async def get_me(user: auth.SeaopUser = Depends(auth.get_current_user)):
    """
    Return information about the currently authenticated user.
    Works for all auth types (JWT, session).
    """
    result = {
        "user_type": user.user_type,
        "user_id": user.user_id,
        "email": user.email,
        "display_name": "Administration" if user.user_type in ("admin", "super_admin") else (user.email or "Utilisateur"),
        "id": user.user_id,
    }

    # Enrich with full profile for entrepreneurs
    if user.user_type == "entrepreneur" and user.user_id:
        entrepreneur = db.get_entrepreneur_by_id(user.user_id)
        if entrepreneur:
            result["profile"] = UserResponse(
                id=entrepreneur["id"],
                email=entrepreneur["email"],
                nom_entreprise=entrepreneur.get("nom_entreprise"),
                nom_contact=entrepreneur.get("nom_contact"),
                telephone=entrepreneur.get("telephone"),
                user_type="entrepreneur",
                numero_rbq=entrepreneur.get("numero_rbq"),
                zones_desservies=entrepreneur.get("zones_desservies"),
                types_projets=entrepreneur.get("types_projets"),
                abonnement=entrepreneur.get("abonnement"),
                credits_restants=entrepreneur.get("credits_restants"),
                certifications=entrepreneur.get("certifications"),
                evaluations_moyenne=entrepreneur.get("evaluations_moyenne"),
                nombre_evaluations=entrepreneur.get("nombre_evaluations"),
                statut=entrepreneur.get("statut"),
                date_inscription=entrepreneur.get("date_inscription"),
                rbq_verifie=entrepreneur.get("rbq_verifie", False),
                categories_rbq=entrepreneur.get("categories_rbq"),
                assurance_responsabilite=entrepreneur.get("assurance_responsabilite", False),
                montant_assurance=entrepreneur.get("montant_assurance"),
                licence_valide_jusqu_au=entrepreneur.get("licence_valide_jusqu_au"),
            ).model_dump()

    return result
