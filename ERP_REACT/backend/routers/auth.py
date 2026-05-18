"""
ERP React - Auth Router
Multi-tenant authentication: tenant login → user login → /me
"""

import logging
import os
import re
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Request

from ..erp_auth import (
    verify_password, verify_super_admin, hash_password,
    create_jwt, create_b2b_client_jwt, decode_jwt,
    create_session, invalidate_session,
    register_erp_session, unregister_erp_session,
    get_current_user, get_current_b2b_client,
    ErpUser, B2bClientUser,
)
from ..erp_models import (
    TenantLoginRequest, UserLoginRequest, SuperAdminLoginRequest,
    TenantLoginResponse, UserLoginResponse, SessionLoginResponse, MeResponse, AuthUser,
    RegisterRequest,
)
from .. import erp_database as db
from ..erp_stripe import is_subscription_active, create_signup_checkout_session
from ..erp_config import DEV_MODE

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/tenant-login", response_model=TenantLoginResponse)
async def tenant_login(body: TenantLoginRequest):
    """
    Step 1: Authenticate the entreprise (tenant).
    Returns the entreprise info and schema name for step 2.
    """
    # Message d'erreur unifié pour éviter l'énumération de comptes.
    _bad_creds = HTTPException(status_code=401, detail="Identifiants invalides")
    entreprise = db.get_entreprise_by_email(body.email)
    if not entreprise:
        # Délai constant minimal pour égaliser le timing avec un vrai check bcrypt.
        verify_password("dummy", "$2b$12$" + "0" * 53)
        raise _bad_creds

    if not verify_password(body.password, entreprise.get("password_hash", "")):
        raise _bad_creds

    if not entreprise.get("active", False):
        raise HTTPException(status_code=403, detail="Ce compte entreprise est desactive")

    # Check subscription only for Stripe-managed accounts.
    # Accounts without Stripe (test/demo/manual) pass if active=True (checked above).
    has_stripe = bool(
        entreprise.get("stripe_customer_id") or entreprise.get("stripe_subscription_id")
    )
    if not DEV_MODE and has_stripe and not is_subscription_active(entreprise.get("subscription_status")):
        raise HTTPException(
            status_code=403,
            detail="Abonnement inactif. Veuillez renouveler votre abonnement.",
        )

    slug = entreprise.get('slug')
    if not slug:
        raise HTTPException(status_code=404, detail="Entreprise introuvable — identifiant manquant")
    schema = slug if slug.startswith("tenant_") else f"tenant_{slug}"
    return TenantLoginResponse(
        entreprise_id=entreprise["id"],
        entreprise_nom=entreprise["nom"],
        schema_name=schema,
    )


@router.post("/user-login", response_model=UserLoginResponse)
async def user_login(body: UserLoginRequest):
    """
    Step 2: Authenticate a user within a tenant.
    Returns a JWT token.
    """
    # Get the entreprise to find the schema
    entreprise = db.get_entreprise_by_id(body.entreprise_id)
    if not entreprise:
        raise HTTPException(status_code=401, detail="Entreprise non trouvée")

    slug = entreprise.get('slug')
    if not slug:
        raise HTTPException(status_code=404, detail="Entreprise introuvable — identifiant manquant")
    schema = slug if slug.startswith("tenant_") else f"tenant_{slug}"

    # Message d'erreur unifié pour éviter l'énumération de comptes.
    _bad_creds = HTTPException(status_code=401, detail="Identifiants invalides")

    # Authenticate user within tenant (accept username OR email)
    user = db.get_user_by_username(schema, body.username)
    if not user and "@" in body.username:
        user = db.get_user_by_email(schema, body.username)
    if not user:
        verify_password("dummy", "$2b$12$" + "0" * 53)
        raise _bad_creds

    if not verify_password(body.password, user.get("password_hash", "")):
        raise _bad_creds

    if not user.get("active", False):
        raise HTTPException(status_code=403, detail="Ce compte utilisateur est desactive")

    # Create JWT
    role = user.get("role", "employee")
    token = create_jwt(
        user_id=user["id"],
        email=user.get("email", ""),
        schema=schema,
        role=role,
    )

    # Register session for admin monitoring
    register_erp_session(
        user_id=user["id"],
        username=user.get("full_name", user.get("username", "")),
        email=user.get("email", ""),
        schema=schema,
        entreprise_id=entreprise.get("id"),
        entreprise_nom=entreprise.get("nom", ""),
    )

    return UserLoginResponse(
        access_token=token,
        user=AuthUser(
            user_type="user",
            user_id=user["id"],
            email=user.get("email", ""),
            display_name=user.get("full_name", user.get("username", "")),
            schema_name=schema,
            role=role,
        ),
    )


@router.post("/super-admin-login", response_model=SessionLoginResponse)
async def super_admin_login(body: SuperAdminLoginRequest):
    """Authenticate super-admin. Returns a session token."""
    admin = verify_super_admin(body.username, body.password)
    if not admin:
        raise HTTPException(status_code=401, detail="Identifiants super-admin invalides")

    session_token = create_session(
        user_type="super_admin",
        user_id=admin["id"],
        email=admin.get("email", ""),
        display_name=admin.get("full_name", admin.get("username", "Super Admin")),
    )

    return SessionLoginResponse(
        session_token=session_token,
        user=AuthUser(
            user_type="super_admin",
            user_id=admin["id"],
            email=admin.get("email", ""),
            display_name=admin.get("full_name", admin.get("username", "Super Admin")),
            role="super_admin",
        ),
    )


@router.get("/me", response_model=MeResponse)
async def get_me(user: ErpUser = Depends(get_current_user)):
    """Get the current authenticated user's info."""
    entreprise_nom = ""
    if user.schema:
        slug = user.schema if user.schema.startswith("tenant_") else f"tenant_{user.schema}"
        # Look up entreprise by slug
        conn = db.get_conn()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT nom FROM public.entreprises WHERE slug = %s", (slug,)
            )
            row = cursor.fetchone()
            if row:
                entreprise_nom = row["nom"]
            cursor.close()
        except Exception:
            pass
        finally:
            conn.close()

    return MeResponse(
        user_type=user.user_type,
        user_id=user.user_id,
        email=user.email,
        display_name=user.display_name,
        schema_name=user.schema,
        role=user.role,
        entreprise_nom=entreprise_nom,
    )


@router.post("/register")
async def register(body: RegisterRequest):
    """
    Register a new company: validate email, hash password,
    save pending signup, create Stripe Checkout session.
    Returns the Stripe Checkout URL for payment.
    """
    # Check email not already in use
    existing = db.get_entreprise_by_email(body.email)
    if existing:
        raise HTTPException(status_code=409, detail="Cet email est déjà utilisé par une entreprise existante")

    # Hash the password (will be retrieved by webhook after payment)
    pw_hash = hash_password(body.password)

    # Build success/cancel URLs (override via APP_BASE_URL in .env)
    _checkout_base = os.getenv("APP_BASE_URL", "http://localhost:5174").rstrip("/")
    success_url = body.success_url or f"{_checkout_base}/login?checkout=success"
    cancel_url = body.cancel_url or f"{_checkout_base}/register?checkout=cancel"

    # Create Stripe Checkout session
    try:
        result = create_signup_checkout_session(
            email=body.email,
            company_name=body.company_name,
            plan_type=body.plan_type,
            success_url=success_url,
            cancel_url=cancel_url,
        )
    except ValueError as exc:
        logger.warning("create_signup_checkout_session config error: %s", exc)
        raise HTTPException(
            status_code=400,
            detail="Plan d'abonnement non disponible. Contactez le support.",
        )

    if not result:
        raise HTTPException(
            status_code=502,
            detail="Impossible de creer la session de paiement. Verifiez la configuration Stripe.",
        )

    # Save to pending_signups so the webhook can retrieve the password hash
    conn = db.get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS public.pending_signups (
                id SERIAL PRIMARY KEY,
                checkout_session_id TEXT NOT NULL UNIQUE,
                company_name TEXT NOT NULL,
                email TEXT NOT NULL,
                password_hash TEXT,
                telephone TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                representant_code TEXT,
                type_industrie TEXT DEFAULT 'CONSTRUCTION'
            )
        """)
        # Ensure password_hash column exists (table may predate this column)
        cursor.execute("""
            ALTER TABLE public.pending_signups
            ADD COLUMN IF NOT EXISTS password_hash TEXT
        """)
        cursor.execute("""
            INSERT INTO public.pending_signups
                (checkout_session_id, company_name, email, password_hash, representant_code)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (checkout_session_id) DO UPDATE SET
                company_name = EXCLUDED.company_name,
                email = EXCLUDED.email,
                password_hash = EXCLUDED.password_hash,
                representant_code = EXCLUDED.representant_code
        """, (result["session_id"], body.company_name, body.email, pw_hash, body.representant or None))
        conn.commit()
        cursor.close()
        logger.info("Pending signup saved: email=%s session=%s", body.email, result["session_id"])
    except Exception as exc:
        logger.error("Failed to save pending signup: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur interne lors de l'inscription")
    finally:
        conn.close()

    return {"checkout_url": result["url"], "message": "Redirection vers le paiement"}


@router.post("/logout")
async def logout(request: Request):
    """Logout - invalidate session token and/or ERP session tracking."""
    # Invalidate super-admin session token
    session_token = request.headers.get("X-Session-Token") or request.cookies.get("erp_session")
    if session_token:
        invalidate_session(session_token)

    # Unregister ERP user session tracking (decode JWT directly)
    try:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            payload = decode_jwt(auth_header[7:])
            user_id = int(payload["sub"])
            schema = payload.get("schema", "")
            if schema:
                unregister_erp_session(user_id, schema)
    except Exception:
        pass  # Token may be expired or invalid

    return {"message": "Deconnexion reussie"}


@router.get("/representants")
async def public_list_representants():
    """Public endpoint: list active representants for registration form."""
    conn = db.get_conn()
    cursor = None
    try:
        cursor = conn.cursor()
        # Ensure table exists
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS public.representants (
                id SERIAL PRIMARY KEY,
                nom TEXT NOT NULL,
                email TEXT,
                telephone TEXT,
                actif BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
        cursor.execute("SELECT id, nom FROM public.representants WHERE actif = TRUE ORDER BY nom")
        return {"items": cursor.fetchall()}
    except Exception as exc:
        logger.error("public_list_representants error: %s", exc)
        return {"items": []}
    finally:
        if cursor: cursor.close()
        conn.close()


# ============================================
# B2B CLIENT AUTHENTICATION
# ============================================

from pydantic import BaseModel as _BM


class _B2bTenantLookup(_BM):
    email: str


class _B2bClientLogin(_BM):
    email: str
    password: str
    schema_name: str


class _B2bClientRegister(_BM):
    schema_name: str  # tenant du fournisseur (obtenu via b2b-tenant-lookup)
    email: str        # email du client (unique par tenant)
    password: str     # mot de passe du client
    nom: str          # nom complet du contact
    telephone: Optional[str] = None
    company_nom: str  # nom de l'entreprise du client (pour b2b_clients)
    adresse: Optional[str] = None
    ville: Optional[str] = None
    province: Optional[str] = None
    code_postal: Optional[str] = None


@router.post("/b2b-tenant-lookup")
async def b2b_tenant_lookup(body: _B2bTenantLookup):
    """Step 1: Identify the tenant company (no password required)."""
    conn = None
    try:
        conn = db.get_conn()
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")
        cursor.execute(
            "SELECT id, nom, slug, active FROM entreprises WHERE LOWER(email) = LOWER(%s)",
            (body.email.strip(),),
        )
        ent = cursor.fetchone()
        if not ent:
            raise HTTPException(status_code=404, detail="Entreprise non trouvee")
        if not ent.get("active", False):
            raise HTTPException(status_code=403, detail="Ce compte entreprise est desactive")
        slug = ent.get("slug", "")
        schema = slug if slug.startswith("tenant_") else f"tenant_{slug}"
        return {
            "entreprise_id": ent["id"],
            "entreprise_nom": ent["nom"],
            "schema_name": schema,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("b2b_tenant_lookup error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur recherche entreprise")
    finally:
        if conn:
            conn.close()


@router.post("/b2b-client-login")
async def b2b_client_login(body: _B2bClientLogin):
    """Step 2: Authenticate B2B client user within tenant."""
    from .b2b import _ensure_b2b_tables
    schema = body.schema_name
    if not schema or not schema.startswith("tenant_"):
        raise HTTPException(status_code=400, detail="Schema invalide")
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute("""
            SELECT u.id, u.client_id, u.email, u.password_hash, u.nom,
                   u.active, c.nom as company_nom
            FROM b2b_client_users u
            JOIN b2b_clients c ON u.client_id = c.id
            WHERE LOWER(u.email) = LOWER(%s)
        """, (body.email.strip(),))
        user_row = cursor.fetchone()
        if not user_row:
            raise HTTPException(status_code=401, detail="Identifiants invalides")
        if not user_row.get("active", False):
            raise HTTPException(status_code=403, detail="Compte desactive")
        if not verify_password(body.password, user_row["password_hash"]):
            raise HTTPException(status_code=401, detail="Identifiants invalides")
        # Update last_login
        cursor.execute("UPDATE b2b_client_users SET last_login = NOW() WHERE id = %s", (user_row["id"],))
        conn.commit()
        token = create_b2b_client_jwt(
            client_user_id=user_row["id"],
            email=user_row["email"],
            schema=schema,
            client_id=user_row["client_id"],
        )
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "user_type": "b2b_client",
                "user_id": user_row["id"],
                "client_id": user_row["client_id"],
                "email": user_row["email"],
                "display_name": user_row.get("nom") or user_row.get("company_nom", ""),
                "company_nom": user_row.get("company_nom", ""),
                "schema_name": schema,
                "role": "b2b_client",
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("b2b_client_login error: %s", exc)
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur connexion B2B")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.post("/b2b-client-register")
async def b2b_client_register(body: _B2bClientRegister):
    """
    Public self-registration B2B client (no JWT required).

    Flow (fidele au Streamlit legacy):
    1. Valide le schema du fournisseur
    2. Cree row dans {schema}.b2b_clients (ou reutilise si company_nom existe)
    3. Cree row dans {schema}.b2b_client_users avec active=FALSE (en attente approbation)
    4. Cree notification dans {schema}.b2b_notifications pour admins du tenant
    5. Retourne success message (pas de JWT, client ne peut pas se connecter)

    L'admin du tenant doit ensuite approuver via PUT /b2b/client-users/{id}/approve.
    """
    from .b2b import _ensure_b2b_tables
    schema = (body.schema_name or "").strip().lower()
    if not schema or not schema.startswith("tenant_"):
        raise HTTPException(status_code=400, detail="Schema invalide")
    # Strict slug validation: alphanumeric + dash + underscore only, no re-prefixing.
    # Reject slug_clean that re-starts with "tenant_" to prevent double-prefix exploit
    # (ex: "tenant_tenant_victim" -> slug_clean="tenant_victim" matching a real tenant).
    slug_clean = schema[len("tenant_"):]
    if (
        not slug_clean
        or slug_clean.startswith("tenant_")
        or not re.match(r'^[a-z0-9_-]+$', slug_clean)
    ):
        raise HTTPException(status_code=400, detail="Schema invalide")

    # Normalize inputs (strip + required checks).
    email_norm = (body.email or "").strip().lower()
    nom_norm = (body.nom or "").strip()
    company_nom_norm = (body.company_nom or "").strip()
    if not email_norm or not body.password or not nom_norm or not company_nom_norm:
        raise HTTPException(status_code=400, detail="Champs requis manquants")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Le mot de passe doit contenir au moins 6 caracteres")
    # Basic email format sanity check (defense in depth on top of HTML5).
    if "@" not in email_norm or "." not in email_norm.split("@", 1)[-1]:
        raise HTTPException(status_code=400, detail="Email invalide")

    telephone_norm = body.telephone.strip() if body.telephone and body.telephone.strip() else None
    adresse_norm = body.adresse.strip() if body.adresse and body.adresse.strip() else None
    ville_norm = body.ville.strip() if body.ville and body.ville.strip() else None
    province_norm = body.province.strip() if body.province and body.province.strip() else "Quebec"
    code_postal_norm = body.code_postal.strip() if body.code_postal and body.code_postal.strip() else None

    conn = None
    try:
        # Verifier que l'entreprise fournisseur existe et est active.
        # Match by slug exactly (accepting both forms: "tenant_foo" or "foo").
        conn = db.get_conn()
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")
        cursor.execute(
            "SELECT id, nom, active FROM entreprises WHERE LOWER(slug) = %s OR LOWER(slug) = %s",
            (schema, slug_clean),
        )
        ent = cursor.fetchone()
        if not ent:
            raise HTTPException(status_code=404, detail="Fournisseur introuvable")
        if not ent.get("active", False):
            raise HTTPException(status_code=403, detail="Ce fournisseur est desactive")
        entreprise_nom = ent["nom"]

        # Set tenant pour creer les donnees dans le bon schema
        db.set_tenant(conn, schema)
        _ensure_b2b_tables(cursor)
        conn.commit()

        # Verifier si l'email est deja utilise dans ce tenant
        cursor.execute(
            "SELECT id, active FROM b2b_client_users WHERE LOWER(email) = LOWER(%s)",
            (email_norm,),
        )
        existing = cursor.fetchone()
        if existing:
            if existing.get("active"):
                raise HTTPException(
                    status_code=400,
                    detail="Un compte approuve existe deja avec cet email. Utilisez la connexion.",
                )
            else:
                raise HTTPException(
                    status_code=400,
                    detail="Une demande est deja en attente pour cet email. Patientez l'approbation du fournisseur.",
                )

        # Creer ou reutiliser le b2b_client (entite entreprise cliente)
        cursor.execute(
            "SELECT id FROM b2b_clients WHERE LOWER(nom) = LOWER(%s) AND LOWER(COALESCE(email, '')) = LOWER(%s)",
            (company_nom_norm, email_norm),
        )
        client_row = cursor.fetchone()
        if client_row:
            client_id = client_row["id"]
        else:
            cursor.execute(
                """INSERT INTO b2b_clients (nom, email, telephone, adresse, ville, province, code_postal, active)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE) RETURNING id""",
                (
                    company_nom_norm,
                    email_norm,
                    telephone_norm,
                    adresse_norm,
                    ville_norm,
                    province_norm,
                    code_postal_norm,
                ),
            )
            client_id = cursor.fetchone()["id"]

        # Creer le b2b_client_user avec active=FALSE (en attente approbation).
        # TOCTOU protection: catch UniqueViolation on race condition.
        pw_hash = hash_password(body.password)
        try:
            cursor.execute(
                """INSERT INTO b2b_client_users (client_id, email, password_hash, nom, telephone, active)
                   VALUES (%s, %s, %s, %s, %s, FALSE) RETURNING id""",
                (client_id, email_norm, pw_hash, nom_norm, telephone_norm),
            )
            new_user_id = cursor.fetchone()["id"]
        except Exception as insert_exc:
            # UniqueViolation from concurrent inscription attempt (TOCTOU).
            try:
                conn.rollback()
            except Exception:
                pass
            if "unique" in str(insert_exc).lower() or "duplicate" in str(insert_exc).lower():
                raise HTTPException(
                    status_code=400,
                    detail="Une demande est deja en attente pour cet email. Patientez l'approbation du fournisseur.",
                )
            raise

        # Creer notification pour les admins du tenant (pattern Streamlit: dashboard seulement).
        # Si aucun admin n'existe, on rollback pour eviter un compte orphelin que personne
        # ne verrait jamais. Si la notification echoue, meme comportement.
        try:
            cursor.execute("SELECT id FROM users WHERE role IN ('admin', 'super_admin')")
            admins = cursor.fetchall()
            if not admins:
                try:
                    conn.rollback()
                except Exception:
                    pass
                raise HTTPException(
                    status_code=503,
                    detail="Aucun administrateur configure pour ce fournisseur. Contactez-le directement.",
                )
            for admin in admins:
                # NOTE priorite: deux CHECK constraints coexistent en BD selon
                # l'historique migration du tenant:
                #   - inline (v7/v8): {urgente, elevee, normale, faible}
                #   - chk_notif_priorite (ALTER):  {basse, normale, haute, urgente}
                # Cumulatif (AND) sur tenants legacy → seules 'urgente' et
                # 'normale' passent les deux. On omet la colonne pour laisser
                # le DEFAULT 'normale' s'appliquer (universellement valide).
                cursor.execute(
                    """INSERT INTO b2b_notifications
                          (user_id, type_notification, titre, message, lien_page, lien_id)
                       VALUES (%s, 'nouvelle_demande', %s, %s, 'b2b_admin', %s)""",
                    (
                        admin["id"],
                        "Nouvelle demande d'inscription B2B",
                        f"{company_nom_norm} ({nom_norm}) demande un acces au portail client",
                        new_user_id,
                    ),
                )
        except HTTPException:
            raise
        except Exception as notif_exc:
            logger.error("create notification (b2b register) failed — rolling back: %s", notif_exc)
            try:
                conn.rollback()
            except Exception:
                pass
            raise HTTPException(
                status_code=500,
                detail="Erreur creation notification. Veuillez reessayer plus tard.",
            )

        conn.commit()

        return {
            "success": True,
            "message": f"Demande envoyee a {entreprise_nom}. En attente d'approbation.",
            "user_id": new_user_id,
            "client_id": client_id,
            "pending_approval": True,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("b2b_client_register error: %s", exc)
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation du compte")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.get("/b2b-me")
async def b2b_get_me(client: B2bClientUser = Depends(get_current_b2b_client)):
    """Get the current B2B client user info."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT c.nom as company_nom, u.nom as user_nom, u.email, u.telephone
            FROM b2b_client_users u
            JOIN b2b_clients c ON u.client_id = c.id
            WHERE u.id = %s
        """, (client.user_id,))
        row = cursor.fetchone()
        return {
            "user_type": "b2b_client",
            "user_id": client.user_id,
            "client_id": client.client_id,
            "email": client.email,
            "display_name": row.get("user_nom", "") if row else "",
            "company_nom": row.get("company_nom", "") if row else "",
            "schema_name": client.schema,
            "role": "b2b_client",
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("b2b_get_me error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur profil B2B")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()
