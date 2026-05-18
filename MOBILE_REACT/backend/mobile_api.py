"""Mobile Pointage — Router FastAPI avec endpoints d'auth et de pointage."""

import asyncio
import base64
import csv
import io
import json
import logging
import os
import re
import unicodedata
import uuid
from urllib.parse import quote as _url_quote

import psycopg2
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from .mobile_auth import (
    get_mobile_context, get_mobile_context_or_signed,
    MobileTenantContext, create_token, create_signed_url,
)
from .mobile_models import (
    TenantLoginRequest, TenantLoginResponse, EmployeeInfo,
    PinLoginRequest, PinLoginResponse,
    WorkOrderResponse,
    PunchInRequest, PunchOutRequest, TimeEntryUpdate, TimeEntryResponse, PunchStatusResponse,
    SignatureExterneRequest,
    WeeklySummaryResponse, DailySummary,
    PhotoUploadResponse, CrewMemberStatus, CrewViewResponse,
    # Messagerie
    ChannelResponse, MessageResponse, SendMessageRequest, ReactionRequest,
    CreateChannelRequest, ChannelMemberResponse,
    DirectMessageResponse, SendDirectMessageRequest,
    ConversationSummaryResponse, UnreadCountResponse,
    # Dossiers
    DossierListResponse, DossierDetailResponse,
    DossierNoteResponse,
    DossierLienResponse, CreateDossierLienRequest, UpdateDossierLienRequest,
    # Assistant IA
    AIChatMessageRequest, AIChatMessageResponse,
    AIConversationResponse, AIConversationDetailResponse, AIQuotaResponse,
    AIPendingActionConfirmResponse,
    # Notes IA Intelligentes
    NoteAIEnrichRequest, NoteAIAnalyzePhotoRequest,
    NoteAIResponse, NoteAISummaryResponse,
    # Push Notifications
    PushSubscriptionRequest, PushUnsubscribeRequest,
    # Documents commerciaux
    DocumentLineCreate, DocumentLineUpdate,
    DevisCreateRequest, FactureCreateRequest, BonTravailCreateRequest,
    BonCommandeCreateRequest, DocumentUpdateRequest,
    DocumentEmailRequest, DocumentEmailResponse,
    # Signed URLs
    SignedUrlRequest, SignedUrlResponse,
    # Profil
    MeResponse,
    # Stripe Payment Links (Phase 3C)
    PaymentLinkResponse,
    # OCR scan recus (Phase 4A)
    OcrReceiptResponse,
    # Relances factures impayees (Phase 4B)
    OverdueFacture, OverdueBucketSummary, OverdueResponse,
    RemindersSendRequest, RemindersSendResponse, ReminderDetailItem,
    VALID_REMINDER_BUCKETS,
    # Audit log polymorphique (Phase 5D - Loi 25 Quebec / GDPR)
    AuditEventResponse, AuditEventsResponse,
    # Factures recurrentes (Phase 5C)
    RecurrentInvoiceCreateRequest, RecurrentInvoiceConfigResponse,
    RecurrentRunRequest, RecurrentRunResponse, RecurrentRunItem,
)
from . import mobile_database as db

logger = logging.getLogger(__name__)


# Note: import du router attachments en fin de fichier (juste avant app.include_router)
# pour eviter l'import circulaire — attachments_api.py importe nos helpers
# (ATTACHMENT_ALLOWED_MIMES, _detect_file_mime, etc.) qui doivent etre definis avant.


# --- Lifespan: closeall pool on shutdown ---
@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Ferme proprement le pool psycopg2 au shutdown.

    Sans ce handler, uvicorn tue le worker en laissant les connexions
    SSL ouvertes : le kernel les reape sans envoyer le PG Terminate, ce
    qui provoque "SSL error: unexpected eof while reading" cote PG a
    chaque redeploy/scale/healthcheck-fail. Voir lecon SSL EOF root cause.
    """
    yield
    try:
        db.close_pool()
    except Exception as exc:
        logger.warning("[mobile-api] close_pool failed: %s", exc)


# --- App ---
app = FastAPI(
    title="Constructo Mobile Pointage API",
    version="0.2.0",
    docs_url="/api/mobile/v1/docs",
    openapi_url="/api/mobile/v1/openapi.json",
    lifespan=_lifespan,
)

# Origines autorisees (configurable via ALLOWED_ORIGINS env var, CSV)
_default_origins = [
    "http://localhost:5175",
    "http://localhost:8003",
]
_env_origins = os.environ.get("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = (
    ["*"] if _env_origins.strip() == "*"
    else [o.strip() for o in _env_origins.split(",") if o.strip()] or _default_origins
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False if "*" in ALLOWED_ORIGINS else True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Security Headers Middleware ───────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)

        # Ne pas appliquer CSP sur les pages Swagger UI (elles chargent du JS/CSS CDN)
        path = request.url.path
        if path.startswith("/api/mobile/v1/docs") or path.startswith("/api/mobile/v1/openapi"):
            return response

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
        # Surchargez CSP_CONNECT_SRC via env (CSV) pour vos domaines push/api.
        _csp_extra = os.environ.get("CSP_CONNECT_SRC", "").strip()
        _csp_connect = (
            "connect-src 'self' "
            "https://api.open-meteo.com "
            "https://*.push.services.mozilla.com "
            "https://fcm.googleapis.com "
            "https://*.notify.windows.com "
            "https://web.push.apple.com"
        )
        if _csp_extra:
            _csp_connect = f"{_csp_connect} {_csp_extra}"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: blob: https://raw.githubusercontent.com; "
            f"{_csp_connect}; "
            "frame-src 'self' blob:"
        )
        return response


app.add_middleware(SecurityHeadersMiddleware)

router = APIRouter(prefix="/api/mobile/v1")


# ===== WEB PUSH NOTIFICATIONS (VAPID) =====

VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_CLAIMS_EMAIL = os.environ.get("VAPID_CLAIMS_EMAIL", "mailto:support@constructo.ai")

# Thread pool for sending push notifications in background (non-blocking)
_push_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="push")


def _send_push_to_subscriptions(subscriptions: list, payload: dict):
    """Envoie une notification push a une liste de subscriptions (execute en background)."""
    if not VAPID_PRIVATE_KEY or not subscriptions:
        return

    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning("[PUSH] pywebpush non installe, notifications push desactivees")
        return

    payload_str = json.dumps(payload, ensure_ascii=False)
    vapid_claims = {"sub": VAPID_CLAIMS_EMAIL}

    for sub in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
                },
                data=payload_str,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=vapid_claims,
                timeout=10,
            )
        except WebPushException as e:
            if "410" in str(e) or "404" in str(e):
                db.remove_stale_push_subscription(sub["endpoint"])
                logger.info(f"[PUSH] Subscription expiree supprimee: {sub['endpoint'][:50]}...")
            else:
                logger.warning(f"[PUSH] Erreur envoi push: {e}")
        except Exception as e:
            logger.warning(f"[PUSH] Erreur inattendue push: {e}")


def send_push_async(subscriptions: list, payload: dict):
    """Lance l'envoi push en arriere-plan sans bloquer la requete HTTP."""
    if subscriptions and VAPID_PRIVATE_KEY:
        _push_executor.submit(_send_push_to_subscriptions, subscriptions, payload)


# ===== RATE LIMITING AUTH (DB-backed, multi-worker safe) =====

_AUTH_MAX_ATTEMPTS = 5
_AUTH_WINDOW_SECONDS = 300  # 5 minutes

# Table creee automatiquement dans public schema au premier appel
_rate_limit_table_ensured = False


def _ensure_rate_limit_table():
    """Cree la table de rate limiting si elle n'existe pas."""
    global _rate_limit_table_ensured
    if _rate_limit_table_ensured:
        return
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SET search_path TO public")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS mobile_auth_rate_limit (
                    id SERIAL PRIMARY KEY,
                    client_ip VARCHAR(45) NOT NULL,
                    attempt_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_rate_limit_ip_time
                ON mobile_auth_rate_limit (client_ip, attempt_at)
            """)
        conn.commit()
        _rate_limit_table_ensured = True
    except Exception as e:
        logger.warning(f"[RATE] Erreur creation table rate_limit: {e}")
        conn.rollback()
    finally:
        db.release_connection(conn)


def _check_rate_limit(request: Request):
    """Verifie le rate limit pour les endpoints d'authentification (DB-backed)."""
    client_ip = request.client.host if request.client else "unknown"

    _ensure_rate_limit_table()

    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SET search_path TO public")

            # Nettoyer les anciennes tentatives (>5 min)
            cur.execute(
                "DELETE FROM mobile_auth_rate_limit WHERE attempt_at < NOW() - %s * INTERVAL '1 second'",
                (_AUTH_WINDOW_SECONDS,)
            )

            # Compter les tentatives recentes
            cur.execute(
                "SELECT COUNT(*) FROM mobile_auth_rate_limit WHERE client_ip = %s AND attempt_at > NOW() - %s * INTERVAL '1 second'",
                (client_ip, _AUTH_WINDOW_SECONDS)
            )
            count = cur.fetchone()[0]

            if count >= _AUTH_MAX_ATTEMPTS:
                conn.commit()
                raise HTTPException(
                    status_code=429,
                    detail=f"Trop de tentatives. Reessayez dans {_AUTH_WINDOW_SECONDS // 60} minutes."
                )

            # Enregistrer la tentative
            cur.execute(
                "INSERT INTO mobile_auth_rate_limit (client_ip) VALUES (%s)",
                (client_ip,)
            )
        conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"[RATE] Erreur rate limit (degradation gracieuse): {e}")
        try:
            conn.rollback()
        except Exception as rollback_err:
            logger.warning("[RATE] rollback secondaire echoue (connexion morte ?): %s", rollback_err)
    finally:
        db.release_connection(conn)


# ===== AUTH =====

@router.post("/auth/tenant", response_model=TenantLoginResponse)
async def auth_tenant(data: TenantLoginRequest, request: Request):
    """Etape 1: Verifier l'entreprise et retourner la liste des employes."""
    _check_rate_limit(request)
    entreprise = db.verify_entreprise(data.email, data.password)
    if not entreprise:
        raise HTTPException(status_code=401, detail="Email ou mot de passe entreprise invalide")

    employees = db.get_tenant_employees(entreprise['schema_name'])

    return TenantLoginResponse(
        tenant_id=entreprise['id'],
        tenant_nom=entreprise['nom'],
        schema_name=entreprise['schema_name'],
        employees=[
            EmployeeInfo(
                id=e['id'],
                prenom=e['prenom'],
                nom=e['nom'],
                poste=e.get('poste'),
            )
            for e in employees
        ],
    )


@router.post("/auth/pin", response_model=PinLoginResponse)
async def auth_pin(data: PinLoginRequest, request: Request):
    """Etape 2: Verifier le PIN de l'employe et retourner un JWT."""
    _check_rate_limit(request)
    # Recuperer schema_name et nom du tenant cote serveur (jamais depuis le client)
    conn = None
    try:
        conn = db.get_connection()
        with conn.cursor() as cur:
            cur.execute("SET search_path TO public")
            cur.execute(
                "SELECT schema_name, nom FROM entreprises WHERE id = %s AND active = TRUE",
                (data.tenant_id,)
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=401, detail="Tenant invalide")
            schema_name = row[0]
            tenant_nom = row[1]
    except HTTPException:
        raise
    except Exception:
        logger.error("Erreur lors de la verification du tenant", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if conn:
            db.release_connection(conn)

    employee = db.verify_pin(schema_name, data.employee_id, data.pin_code)
    if not employee:
        raise HTTPException(status_code=401, detail="PIN invalide")

    role = employee.get('role_mobile') or 'EMPLOYE'
    token = create_token(
        tenant_schema=schema_name,
        employee_id=employee['id'],
        employee_name=f"{employee['prenom']} {employee['nom']}",
        role=role,
    )

    # Audit log : trace les logins reussis (Loi 25)
    _ip, _ua = _extract_request_forensics(request)
    db.log_audit_event(
        tenant_schema=schema_name,
        employee_id=int(employee['id']),
        action='login',
        entity_type='auth',
        entity_id=int(employee['id']),
        entity_label=f"{employee['prenom']} {employee['nom']}".strip(),
        ip=_ip, ua=_ua,
        metadata={'role': role, 'tenant_nom': tenant_nom},
    )

    return PinLoginResponse(
        token=token,
        employee=EmployeeInfo(
            id=employee['id'],
            prenom=employee['prenom'],
            nom=employee['nom'],
            poste=employee.get('poste'),
        ),
        tenant_nom=tenant_nom,
        role=role,
    )


# Prefixes de paths que l'on accepte de signer (defense en profondeur).
# Les endpoints sans get_mobile_context_or_signed refuseront la signature
# meme si elle est valide, mais on limite quand meme l'aire de surface.
# IMPORTANT : tout endpoint qui accepte les signed URLs doit voir son prefix
# liste ici, sinon POST /auth/signed-url retourne 400.
_SIGNABLE_PATH_PREFIXES = (
    "/api/mobile/v1/dossiers/",                # Photos notes + documents legacy
    "/api/mobile/v1/attachments/by-id/",       # Phase 2 attachments preview + download
)


# ===== RBAC: factory de dependance par role =====

def require_role(*allowed_roles: str):
    """Factory de Depends qui exige un role minimum.

    Usage:
        @router.post("/admin/users", dependencies=[Depends(require_role("ADMIN"))])

    Note: utilise get_mobile_context (Bearer only). Les signed URLs ne portent
    pas de role et ne peuvent donc pas passer un check require_role — c'est
    intentionnel (signed URL = access temporaire a un asset, pas RBAC).
    """
    allowed = frozenset(allowed_roles)

    async def _check(ctx: MobileTenantContext = Depends(get_mobile_context)) -> MobileTenantContext:
        if ctx.role not in allowed:
            logger.info(
                "[RBAC] Acces refuse employee=%s role=%s requis=%s",
                ctx.employee_id, ctx.role, sorted(allowed),
            )
            raise HTTPException(status_code=403, detail="Permission insuffisante")
        return ctx

    return _check


# ===== AUDIT LOG HELPERS (Phase 5D) =====

def _extract_request_forensics(request: Request) -> tuple[Optional[str], Optional[str]]:
    """Extrait l'IP client et le User-Agent depuis une Request FastAPI.

    Prend en compte X-Forwarded-For (proxy Render) : la vraie IP du client
    est le premier hop, pas request.client.host (qui est le proxy interne).
    Tronqué a 64 chars (IP) et 512 chars (UA) — alignment avec les colonnes DB.
    """
    ip: Optional[str] = None
    ua: Optional[str] = None
    try:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            # XFF peut etre une liste "client, proxy1, proxy2" — on prend le 1er
            ip = xff.split(",")[0].strip()[:64] or None
        if not ip and request.client:
            ip = (request.client.host or "")[:64] or None
        ua = (request.headers.get("user-agent") or "")[:512] or None
    except Exception:
        # Forensics ne doit jamais bloquer l'audit ni l'action
        pass
    return ip, ua


@router.get("/me", response_model=MeResponse)
async def get_me(ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Retourne le profil de l'utilisateur courant (role refraichi depuis DB).

    Utile cote frontend pour rafraichir le role d'un JWT pre-migration
    sans forcer un re-login (le JWT continue de marcher, mais le frontend
    obtient son role actuel pour ajuster l'UI).
    """
    db_role = db.get_employee_role(ctx.tenant_schema, ctx.employee_id)
    return MeResponse(
        employee_id=ctx.employee_id,
        employee_name=ctx.employee_name,
        role=db_role,
        tenant_schema=ctx.tenant_schema,
    )


@router.post("/auth/signed-url", response_model=SignedUrlResponse)
async def create_signed_url_for_download(
    data: SignedUrlRequest,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Genere une URL signee HMAC pour usage dans <img src> ou <a href>.

    Le client envoie le path qu'il veut signer, le serveur retourne une URL
    avec signature HMAC TTL court (default 5 min). La signature est liee au
    path : impossible a rejouer sur un autre endpoint. Le JWT ne quitte
    jamais le Bearer header.
    """
    if not any(data.path.startswith(p) for p in _SIGNABLE_PATH_PREFIXES):
        raise HTTPException(
            status_code=400,
            detail="Path non autorise pour signed URL",
        )
    url = create_signed_url(data.path, ctx, ttl_seconds=data.ttl_seconds)
    return SignedUrlResponse(url=url, expires_in_seconds=data.ttl_seconds)


# ===== WORK ORDERS =====

@router.get("/work-orders", response_model=list[WorkOrderResponse])
async def list_work_orders(ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Retourne tous les bons de travail actifs du tenant."""
    return db.get_assigned_work_orders(ctx.tenant_schema, ctx.employee_id)


# ===== POINTAGE =====

@router.get("/punch/status", response_model=PunchStatusResponse)
async def punch_status(ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Retourne le statut de pointage actuel de l'employe."""
    active = db.get_active_punch(ctx.tenant_schema, ctx.employee_id)

    if not active:
        return PunchStatusResponse(is_punched_in=False)

    # Calculer le temps ecoule
    punch_in_time = active['punch_in']
    if punch_in_time.tzinfo is None:
        punch_in_time = punch_in_time.replace(tzinfo=timezone.utc)
    elapsed = max(0.0, (datetime.now(timezone.utc) - punch_in_time).total_seconds() / 60.0)

    return PunchStatusResponse(
        is_punched_in=True,
        active_entry=TimeEntryResponse(**active),
        elapsed_minutes=round(elapsed, 1),
    )


async def _capture_weather_async(latitude: Optional[float],
                                  longitude: Optional[float],
                                  fallback_address: Optional[str] = None) -> Optional[dict]:
    """Récupère un snapshot Open-Meteo SANS bloquer le event loop FastAPI.

    `db._fetch_current_weather()` utilise `urllib.request` (synchrone). Appelé
    directement depuis un endpoint async, il bloquerait l'event loop pendant
    jusqu'à 5s par requête, dégradant le throughput global du worker. On le
    déporte sur un thread via `asyncio.to_thread()` (Python 3.9+).

    Stratégie en 2 niveaux pour ne jamais perdre la météo :
      1. Si `latitude/longitude` (GPS de l'employé) sont fournis → météo
         précise à sa position. Source = "gps".
      2. Sinon, si `fallback_address` (adresse du chantier) est fourni →
         géocoder l'adresse via Open-Meteo Geocoding, puis météo sur ces
         coords. Source = "chantier". Utile pour les employés sur desktop
         sans GPS ou qui ont refusé la permission de géolocalisation.

    Si les deux options échouent, retourne None — la météo n'est jamais
    bloquante (cf. _fetch_current_weather docstring).
    """
    # Niveau 1 : GPS de l'employé (le plus précis)
    if latitude is not None and longitude is not None:
        try:
            return await asyncio.to_thread(
                db._fetch_current_weather, latitude, longitude, "gps"
            )
        except Exception as exc:
            logger.warning("Weather (GPS) capture failed (non-blocking): %s", exc)

    # Niveau 2 : fallback géocode adresse chantier
    if fallback_address:
        try:
            coords = await asyncio.to_thread(db._geocode_address, fallback_address)
            if coords:
                lat, lon = coords
                return await asyncio.to_thread(
                    db._fetch_current_weather, lat, lon, "chantier"
                )
        except Exception as exc:
            logger.warning(
                "Weather (chantier fallback) capture failed (non-blocking): %s", exc,
            )

    return None


@router.post("/punch/in", response_model=TimeEntryResponse)
async def do_punch_in(data: PunchInRequest, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Pointer l'entree sur un bon de travail."""
    try:
        # Si l'employé n'a pas fourni de GPS (desktop, permission refusée, etc.),
        # récupère l'adresse du chantier comme fallback géocode pour quand même
        # capturer une météo représentative du lieu de travail.
        fallback_address: Optional[str] = None
        if data.latitude is None or data.longitude is None:
            try:
                fallback_address = await asyncio.to_thread(
                    db.get_bt_chantier_address,
                    ctx.tenant_schema, data.formulaire_bt_id,
                )
            except Exception as exc:
                logger.warning("get_bt_chantier_address failed: %s", exc)

        # Snapshot météo en parallèle de la préparation du punch (non-bloquant
        # pour l'event loop, exécuté dans un thread worker).
        weather = await _capture_weather_async(
            data.latitude, data.longitude, fallback_address=fallback_address,
        )
        result = db.punch_in(
            ctx.tenant_schema, ctx.employee_id,
            data.formulaire_bt_id, data.notes,
            data.latitude, data.longitude,
            data.operation_id,
            weather_snapshot=weather,
        )
        return TimeEntryResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Erreur punch_in employee={ctx.employee_id} bt={data.formulaire_bt_id}: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors du punch in")


@router.post("/punch/out", response_model=TimeEntryResponse)
async def do_punch_out(
    data: PunchOutRequest = None,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Pointer la sortie (terminer le pointage actif)."""
    try:
        notes = data.notes if data else None
        lat = data.latitude if data else None
        lng = data.longitude if data else None

        # Si pas de GPS au punch_out, fallback : adresse du chantier du
        # punch ACTIF (pas du formulaire d'entrée car PunchOutRequest ne
        # contient pas formulaire_bt_id).
        fallback_address: Optional[str] = None
        if lat is None or lng is None:
            try:
                fallback_address = await asyncio.to_thread(
                    db.get_active_punch_chantier_address,
                    ctx.tenant_schema, ctx.employee_id,
                )
            except Exception as exc:
                logger.warning("get_active_punch_chantier_address failed: %s", exc)

        # Snapshot météo non-bloquant (cf. do_punch_in).
        weather = await _capture_weather_async(
            lat, lng, fallback_address=fallback_address,
        )
        result = db.punch_out(
            ctx.tenant_schema, ctx.employee_id, notes, lat, lng,
            weather_snapshot=weather,
        )
        if not result:
            raise HTTPException(status_code=404, detail="Aucun pointage actif trouve")
        return TimeEntryResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur punch_out employee={ctx.employee_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors du punch out")


# ===== HISTORIQUE =====

@router.get("/history", response_model=list[TimeEntryResponse])
async def get_history(limit: int = Query(default=50, ge=1, le=500), ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Retourne l'historique des pointages de l'employe."""
    return db.get_time_entries_history(ctx.tenant_schema, ctx.employee_id, limit)


# ===== MODIFIER / SUPPRIMER POINTAGE =====

def _translate_time_entry_error(exc: Exception) -> HTTPException:
    """Traduit les exceptions des helpers db.update/delete_time_entry_mobile en HTTPException."""
    if isinstance(exc, db.TimeEntryOwnershipError):
        return HTTPException(status_code=403, detail="Acces refuse")
    if isinstance(exc, db.TimeEntryLockedError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=500, detail="Erreur lors de la mise a jour du pointage")


@router.put("/time-entries/{entry_id}")
async def update_time_entry(entry_id: int, body: TimeEntryUpdate, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Modifier les notes d'un pointage (non valide et non facture)."""
    try:
        db.update_time_entry_mobile(ctx.tenant_schema, entry_id, ctx.employee_id, body.notes)
        return {"message": "Pointage modifie", "id": entry_id}
    except (db.TimeEntryOwnershipError, db.TimeEntryLockedError, ValueError) as exc:
        raise _translate_time_entry_error(exc)
    except Exception as exc:
        logger.error("update_time_entry error id=%s employee=%s: %s", entry_id, ctx.employee_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors de la modification du pointage")


@router.delete("/time-entries/{entry_id}")
async def delete_time_entry(entry_id: int, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Supprimer un pointage (non valide et non facture)."""
    try:
        db.delete_time_entry_mobile(ctx.tenant_schema, entry_id, ctx.employee_id)
        return {"message": "Pointage supprime"}
    except (db.TimeEntryOwnershipError, db.TimeEntryLockedError, ValueError) as exc:
        raise _translate_time_entry_error(exc)
    except Exception as exc:
        logger.error("delete_time_entry error id=%s employee=%s: %s", entry_id, ctx.employee_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression du pointage")


# ===== RESUME HEBDOMADAIRE =====

JOURS_FR = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
OVERTIME_DAILY = 8.0
OVERTIME_WEEKLY = 40.0


@router.get("/weekly-summary", response_model=WeeklySummaryResponse)
async def weekly_summary(
    week_offset: int = Query(default=0, ge=-52, le=0),
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Retourne le resume des heures de la semaine."""
    data = db.get_weekly_summary(ctx.tenant_schema, ctx.employee_id, week_offset)

    total_hours = sum(float(d['total_hours']) for d in data['daily']) + data['active_hours']

    jours = []
    for d in data['daily']:
        day_date = d['jour_date']
        day_hours = float(d['total_hours'])
        jours.append(DailySummary(
            date=day_date,
            jour=JOURS_FR[day_date.weekday()],
            total_hours=round(day_hours, 2),
            entries_count=d['entries_count'],
            is_overtime=day_hours > OVERTIME_DAILY,
        ))

    overtime_hours = max(0, total_hours - OVERTIME_WEEKLY)

    return WeeklySummaryResponse(
        semaine_du=data['semaine_du'],
        semaine_au=data['semaine_au'],
        total_hours=round(total_hours, 2),
        jours=jours,
        overtime_hours=round(overtime_hours, 2),
        is_overtime_week=total_hours > OVERTIME_WEEKLY,
    )


# ===== PHOTO UPLOAD =====

PHOTOS_DIR = Path(__file__).resolve().parent.parent / "photos"
PHOTOS_DIR.mkdir(exist_ok=True)
MAX_PHOTO_SIZE = 5 * 1024 * 1024  # 5 Mo


# Magic bytes pour validation du type reel des images
_IMAGE_MAGIC = {
    b'\xff\xd8\xff': 'image/jpeg',   # JPEG
    b'\x89PNG': 'image/png',         # PNG
    b'GIF8': 'image/gif',            # GIF (GIF87a / GIF89a)
    b'RIFF': 'image/webp',           # WebP (RIFF header)
}


def _detect_image_mime(data: bytes) -> Optional[str]:
    """Detecte le MIME type reel d'une image via ses magic bytes."""
    for magic, mime in _IMAGE_MAGIC.items():
        if data[:len(magic)] == magic:
            # WebP: RIFF est un conteneur generique (aussi WAV, AVI)
            # Verifier que les octets 8-12 sont 'WEBP' pour confirmer
            if magic == b'RIFF':
                if len(data) < 12 or data[8:12] != b'WEBP':
                    continue  # RIFF mais pas WebP — ignorer
            return mime
    return None


# MIME types acceptes pour les pieces jointes (whitelist serveur).
# Le serveur RE-VERIFIE le MIME via magic bytes — pas confiance au Content-Type client.
ATTACHMENT_ALLOWED_MIMES = frozenset({
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  # docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  # xlsx
})

MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024  # 10 Mo


def _detect_file_mime(data: bytes) -> Optional[str]:
    """Detecte le MIME type d'un fichier via ses magic bytes (multi-format).

    Couvre les types acceptes par le module Attachments :
    - Images : JPEG, PNG, GIF, WebP (delegated to _detect_image_mime)
    - PDF : %PDF-
    - HEIC : ftypheic / ftypheix / ftypmif1 a offset 4-12
    - DOCX / XLSX : ZIP container (PK\x03\x04) + introspection via zipfile

    Retourne le MIME standard ou None si non reconnu.
    """
    if not data or len(data) < 4:
        return None

    # 1. Images (whitelist standard)
    img = _detect_image_mime(data)
    if img:
        return img

    # 2. PDF
    if data[:4] == b'%PDF':
        return 'application/pdf'

    # 3. HEIC (Apple iOS) : ftypheic / ftypheix / ftypmif1 dans le header ISO BMFF
    # Le marker 'ftyp' est a offset 4, suivi du brand code 4 chars.
    if len(data) >= 12 and data[4:8] == b'ftyp':
        brand = data[8:12]
        if brand in (b'heic', b'heix', b'mif1', b'msf1', b'heim', b'heis'):
            return 'image/heic'

    # 4. ZIP container (DOCX / XLSX / etc.) : commence par PK\x03\x04
    if data[:4] == b'PK\x03\x04':
        # Distinction DOCX vs XLSX via introspection du contenu zip.
        # On lit les premiers ~4 KB pour eviter de charger le ZIP complet.
        try:
            import zipfile
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = set(zf.namelist())
                # DOCX : 'word/document.xml' ; XLSX : 'xl/workbook.xml'
                if 'word/document.xml' in names:
                    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                if 'xl/workbook.xml' in names:
                    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        except (zipfile.BadZipFile, Exception):
            # ZIP corrompu ou type ZIP non-Office (ODT, EPUB, etc.) — refuser
            return None

    return None


def _extract_exif_lite(data: bytes, mime: str) -> Optional[dict]:
    """Extrait les metadata EXIF importantes (geolocalisation, timestamp).

    Best-effort : depend de Pillow disponible. Retourne None si pas dispo
    ou si echec extraction. Non bloquant pour l'upload.
    """
    if not mime.startswith('image/') or mime == 'image/svg+xml':
        return None
    try:
        from PIL import Image, ExifTags
        img = Image.open(io.BytesIO(data))
        raw_exif = img._getexif() if hasattr(img, '_getexif') else None
        if not raw_exif:
            return None
        result: dict = {}
        # Mapper les tags numeriques EXIF vers leurs noms
        for tag_id, value in raw_exif.items():
            name = ExifTags.TAGS.get(tag_id, str(tag_id))
            if name in ('DateTime', 'DateTimeOriginal', 'DateTimeDigitized',
                        'Make', 'Model', 'Orientation', 'GPSInfo'):
                # Decode bytes -> str si necessaire
                if isinstance(value, bytes):
                    try:
                        value = value.decode('utf-8', errors='ignore')
                    except Exception:
                        continue
                if name == 'GPSInfo' and isinstance(value, dict):
                    # Stringify les tuples (lat/lon DMS) pour JSONifier
                    result['gps'] = {
                        ExifTags.GPSTAGS.get(k, str(k)): str(v) for k, v in value.items()
                    }
                else:
                    result[name] = str(value)[:200]  # cap par precaution
        return result or None
    except ImportError:
        return None
    except Exception as exc:
        logger.debug("[EXIF] Extraction failed (mime=%s): %s", mime, exc)
        return None


# Whitelist des MIME types pouvant etre servis en 'inline' sans risque XSS.
# Tout le reste (PDF, HTML, SVG, Office, etc.) est force en 'attachment'
# pour empecher le browser d'executer du contenu malicieux.
_SAFE_INLINE_MIMES = frozenset({
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
    'image/webp', 'image/avif',
})

# Retire path separators, control chars, et double-quote (casse Content-Disposition).
# On garde les accents francais (caracteres unicode).
_FILENAME_UNSAFE_RE = re.compile(r'[\\/\x00-\x1f"]')


def _sanitize_download_filename(name: Optional[str], fallback: str = "fichier") -> str:
    """Nettoie un nom de fichier pour usage securise dans Content-Disposition."""
    if not name:
        return fallback
    safe = _FILENAME_UNSAFE_RE.sub('_', name).strip('. ')
    return safe[:200] or fallback


def _ascii_fallback_filename(s: str, fallback: str = "fichier") -> str:
    """Translitere les caracteres non-ASCII (e -> e, c -> c) pour vieux clients.

    HTTP headers (RFC 7230) ne supportent pas les bytes >127. Pour servir un
    nom francais 'soumission_été.pdf', on emet :
      filename="soumission_ete.pdf" (ASCII fallback pour vieux clients)
      filename*=UTF-8''soumission_%C3%A9t%C3%A9.pdf (RFC 5987 pour modernes)
    """
    normalized = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode('ascii')
    return normalized.strip('. ') or fallback


def _build_download_headers(filename: Optional[str], content_type: Optional[str]) -> dict:
    """Headers securises pour un endpoint de download/preview.

    Force 'attachment' pour tout sauf images de la whitelist (anti-XSS via
    PDF/SVG/HTML malicieux). Override le Referrer-Policy global pour ne pas
    fuir l'origine quand un signed-URL est dans le path/query.
    Encode RFC 5987 si caracteres non-ASCII (accents francais) pour
    preserver le nom original cote browsers modernes.
    """
    safe_name = _sanitize_download_filename(filename)
    mime = (content_type or '').lower()
    disposition = 'inline' if mime in _SAFE_INLINE_MIMES else 'attachment'

    if any(ord(c) > 127 for c in safe_name):
        ascii_name = _ascii_fallback_filename(safe_name)
        # RFC 5987 : filename*=UTF-8''<percent-encoded>
        utf8_encoded = _url_quote(safe_name.encode('utf-8'), safe='')
        content_disposition = (
            f'{disposition}; filename="{ascii_name}"; '
            f"filename*=UTF-8''{utf8_encoded}"
        )
    else:
        content_disposition = f'{disposition}; filename="{safe_name}"'

    return {
        "Content-Disposition": content_disposition,
        "Referrer-Policy": "no-referrer",
    }


@router.post("/photo/upload", response_model=PhotoUploadResponse)
async def upload_photo(
    file: UploadFile = File(...),
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Upload une photo de chantier (punch in/out)."""
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="Le fichier doit etre une image")

    content = await file.read()
    if len(content) > MAX_PHOTO_SIZE:
        raise HTTPException(status_code=400, detail="Image trop volumineuse (max 5 Mo)")

    # Verification magic bytes — le fichier est-il vraiment une image?
    detected_mime = _detect_image_mime(content)
    if not detected_mime:
        raise HTTPException(status_code=400, detail="Le fichier n'est pas une image valide (JPEG, PNG, GIF, WebP)")

    ext = file.filename.split('.')[-1] if file.filename and '.' in file.filename else 'jpg'
    if ext not in ('jpg', 'jpeg', 'png', 'gif', 'webp'):
        ext = 'jpg'

    today = datetime.now().strftime('%Y-%m-%d')
    filename = f"{ctx.tenant_schema}_{ctx.employee_id}_{today}_{uuid.uuid4().hex[:8]}.{ext}"

    tenant_dir = PHOTOS_DIR / ctx.tenant_schema
    tenant_dir.mkdir(exist_ok=True)

    filepath = tenant_dir / filename
    with open(filepath, 'wb') as f:
        f.write(content)

    photo_url = f"/api/mobile/v1/photo/{ctx.tenant_schema}/{filename}"
    return PhotoUploadResponse(photo_url=photo_url, message="Photo enregistree")


@router.get("/photo/{tenant_schema}/{filename}")
async def get_photo(tenant_schema: str, filename: str):
    """Retourne une photo uploadee."""
    # Protection path traversal
    if '..' in tenant_schema or '/' in tenant_schema or '..' in filename or '/' in filename:
        raise HTTPException(status_code=400, detail="Parametres invalides")

    filepath = (PHOTOS_DIR / tenant_schema / filename).resolve()
    if not str(filepath).startswith(str(PHOTOS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Acces refuse")

    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="Photo introuvable")
    return FileResponse(filepath)


# ===== VUE CONTREMAITRE =====

@router.get("/crew", response_model=CrewViewResponse)
async def crew_view(ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Retourne le statut de l'equipe sur les memes projets."""
    members_data = db.get_crew_status(ctx.tenant_schema, ctx.employee_id)

    members = []
    project_nom = None
    project_id = None
    on_site = 0

    # Vérifier si l'employé connecté peut approuver
    can_approve = db.can_employee_approve(ctx.tenant_schema, ctx.employee_id)

    for m in members_data:
        is_punched = m.get('punch_in') is not None and m.get('punch_out') is None
        elapsed = None
        if is_punched and m['punch_in']:
            pin = m['punch_in']
            if pin.tzinfo is None:
                pin = pin.replace(tzinfo=timezone.utc)
            elapsed = max(0.0, round((datetime.now(timezone.utc) - pin).total_seconds() / 60.0, 1))
            on_site += 1

        if not project_nom and m.get('project_nom'):
            project_nom = m['project_nom']
            project_id = m.get('project_id')

        members.append(CrewMemberStatus(
            employee_id=m['employee_id'],
            prenom=m['prenom'],
            nom=m['nom'],
            poste=m.get('poste'),
            is_punched_in=is_punched,
            punch_in=m.get('punch_in') if is_punched else None,
            punch_out=m.get('punch_out'),
            elapsed_minutes=elapsed,
            total_hours=float(m['total_hours']) if m.get('total_hours') else None,
            numero_bt=m.get('numero_bt'),
            project_nom=m.get('project_nom'),
            time_entry_id=m.get('time_entry_id'),
            validated=bool(m.get('validated', False)),
        ))

    return CrewViewResponse(
        project_id=project_id,
        project_nom=project_nom,
        total_on_site=on_site,
        total_assigned=len(members),
        can_approve=can_approve,
        members=members,
    )


@router.post("/punch/{time_entry_id}/approve")
async def approve_timecard(
    time_entry_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Approuve un pointage (réservé aux employés avec can_approve_timecards)."""
    if not db.can_employee_approve(ctx.tenant_schema, ctx.employee_id):
        raise HTTPException(status_code=403, detail="Vous n'avez pas le droit d'approuver les pointages")

    result = db.approve_time_entry(ctx.tenant_schema, time_entry_id, ctx.employee_id)
    if not result:
        raise HTTPException(status_code=404, detail="Pointage introuvable")
    return {"success": True, "message": "Pointage approuve"}


@router.post("/punch/{time_entry_id}/signature-externe")
async def submit_signature_externe(
    time_entry_id: int,
    body: SignatureExterneRequest,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Enregistre la signature tactile d'un superviseur externe sur l'operation
    (punch) du bon de travail. L'employe presente son telephone au client/
    superviseur sur place, qui signe directement sur l'ecran sans avoir besoin
    de creer un compte ni de se connecter.

    Securite : le time_entry doit appartenir a l'employe connecte (verifie cote db).
    La signature marque le pointage comme valide (validated = TRUE, validated_by = NULL
    pour distinguer du flow d'approbation NIP interne ou validated_by != NULL).
    """
    status = db.save_signature_externe(
        ctx.tenant_schema,
        time_entry_id,
        ctx.employee_id,
        body.signature_base64,
        body.signataire_nom,
    )
    if status == 'ok':
        return {"success": True, "message": "Signature enregistree", "time_entry_id": time_entry_id}
    if status == 'not_found':
        raise HTTPException(status_code=404, detail="Pointage introuvable")
    if status == 'forbidden':
        raise HTTPException(status_code=403, detail="Ce pointage n'est pas a vous")
    if status == 'already_nip':
        raise HTTPException(status_code=409, detail="Pointage deja valide par un approbateur interne, signature externe refusee")
    # status == 'error' ou inconnu
    raise HTTPException(status_code=500, detail="Erreur lors de l'enregistrement de la signature")


# ===== MESSAGERIE CONFERENCE =====

@router.get("/channels", response_model=list[ChannelResponse])
async def list_channels(ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Retourne les canaux accessibles a l'employe."""
    return db.get_employee_channels(ctx.tenant_schema, ctx.employee_id)


@router.post("/channels", response_model=ChannelResponse)
async def create_new_channel(
    data: CreateChannelRequest,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Cree un nouveau canal."""
    try:
        result = db.create_channel(
            ctx.tenant_schema, data.name, data.description or '',
            data.channel_type, data.icon, data.is_private,
            ctx.employee_id, data.member_ids
        )
    except psycopg2.IntegrityError as exc:
        logger.warning("Conflit DB lors creation canal '%s': %s", data.name, exc)
        raise HTTPException(status_code=409, detail="Un canal avec ce nom existe deja")
    except Exception:
        logger.error("Erreur creation canal", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur creation canal")
    if not result:
        raise HTTPException(status_code=500, detail="Erreur creation canal")
    return result


@router.get("/channels/{channel_id}/messages", response_model=list[MessageResponse])
async def get_channel_messages(
    channel_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Retourne les messages d'un canal."""
    messages = db.get_channel_messages(ctx.tenant_schema, channel_id, ctx.employee_id, limit, offset)
    # Marquer comme lu seulement si l'acces est autorise (messages non vides)
    if messages:
        db.mark_channel_read(ctx.tenant_schema, channel_id, ctx.employee_id)
    return messages


@router.post("/channels/{channel_id}/messages", response_model=MessageResponse)
async def send_channel_message(
    channel_id: int,
    data: SendMessageRequest,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Envoie un message dans un canal."""
    try:
        result = db.send_conference_message(
            ctx.tenant_schema, channel_id, ctx.employee_id,
            data.message_text, data.parent_message_id
        )
    except psycopg2.IntegrityError as exc:
        logger.warning("Reference invalide envoi message canal %s: %s", channel_id, exc)
        raise HTTPException(status_code=409, detail="Reference invalide (canal ou message parent inexistant)")
    except Exception:
        logger.error("Erreur envoi message conference", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur envoi message")
    if not result:
        raise HTTPException(status_code=403, detail="Impossible d'envoyer le message")

    # Push notification aux membres du canal (en arriere-plan)
    subs = db.get_push_subscriptions_for_channel_members(
        ctx.tenant_schema, channel_id, ctx.employee_id
    )
    if subs:
        channel_name = db.get_channel_name(ctx.tenant_schema, channel_id)
        preview = data.message_text[:100] + ("..." if len(data.message_text) > 100 else "")
        send_push_async(subs, {
            "type": "channel_message",
            "title": f"#{channel_name}",
            "body": f"{ctx.employee_name}: {preview}",
            "data": {"channel_id": channel_id, "url": "/?tab=conference"},
        })

    return result


@router.get("/channels/{channel_id}/members", response_model=list[ChannelMemberResponse])
async def list_channel_members(
    channel_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Retourne les membres d'un canal."""
    return db.get_channel_members_list(ctx.tenant_schema, channel_id, ctx.employee_id)


@router.get("/messages/{message_id}/thread", response_model=list[MessageResponse])
async def get_message_thread(
    message_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Retourne les reponses d'un thread."""
    return db.get_thread_messages(ctx.tenant_schema, message_id, ctx.employee_id)


@router.post("/messages/{message_id}/reactions")
async def toggle_reaction(
    message_id: int,
    data: ReactionRequest,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Ajoute ou retire une reaction."""
    success = db.add_message_reaction(ctx.tenant_schema, message_id, ctx.employee_id, data.emoji)
    if not success:
        raise HTTPException(status_code=400, detail="Erreur reaction")
    reactions = db.get_message_reactions(ctx.tenant_schema, message_id, ctx.employee_id)
    return {"success": True, "reactions": reactions}


@router.get("/messages/{message_id}/reactions")
async def get_reactions(
    message_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Retourne les reactions d'un message."""
    return db.get_message_reactions(ctx.tenant_schema, message_id, ctx.employee_id)


# ===== MESSAGERIE DIRECTE =====

@router.get("/dm/conversations", response_model=list[ConversationSummaryResponse])
async def list_dm_conversations(
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Retourne le resume des conversations directes."""
    return db.get_dm_conversations_summary(ctx.tenant_schema, ctx.employee_id)


@router.get("/dm/inbox", response_model=list[DirectMessageResponse])
async def dm_inbox(
    include_read: bool = Query(default=True),
    limit: int = Query(default=50, ge=1, le=200),
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Retourne les messages directs recus."""
    return db.get_direct_messages_inbox(ctx.tenant_schema, ctx.employee_id, include_read, limit)


@router.get("/dm/sent", response_model=list[DirectMessageResponse])
async def dm_sent(
    limit: int = Query(default=50, ge=1, le=200),
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Retourne les messages directs envoyes."""
    return db.get_direct_messages_sent(ctx.tenant_schema, ctx.employee_id, limit)


@router.post("/dm/send", response_model=DirectMessageResponse)
async def send_dm(
    data: SendDirectMessageRequest,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Envoie un message direct."""
    try:
        result = db.send_direct_message_mobile(
            ctx.tenant_schema, ctx.employee_id, ctx.employee_name,
            recipient_type=data.recipient_type,
            recipient_employee_id=data.recipient_employee_id,
            subject=data.subject,
            message=data.message,
            message_type=data.message_type,
            conversation_id=data.conversation_id,
            parent_message_id=data.parent_message_id,
        )
    except psycopg2.IntegrityError as exc:
        logger.warning("Reference invalide envoi DM (recipient=%s, conv=%s): %s",
                       data.recipient_employee_id, data.conversation_id, exc)
        raise HTTPException(status_code=409, detail="Destinataire ou conversation invalide")
    except Exception:
        logger.error("Erreur envoi message direct", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur envoi message")
    if not result:
        raise HTTPException(status_code=500, detail="Erreur envoi message")

    # Push notification au destinataire (en arriere-plan)
    if data.recipient_employee_id:
        subs = db.get_push_subscriptions_for_employee(
            ctx.tenant_schema, data.recipient_employee_id
        )
        if subs:
            preview = data.message[:100] + ("..." if len(data.message) > 100 else "")
            title = "Message urgent" if data.message_type == "urgent" else "Message direct"
            send_push_async(subs, {
                "type": "direct_message",
                "title": f"{title} de {ctx.employee_name}",
                "body": preview,
                "data": {"url": "/?tab=messages"},
            })

    return result


@router.get("/dm/conversation/{conversation_id}", response_model=list[DirectMessageResponse])
async def get_dm_conversation(
    conversation_id: str,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Retourne l'historique d'une conversation directe."""
    db.mark_dm_conversation_read(conversation_id, ctx.employee_id, ctx.tenant_schema)
    messages = db.get_dm_conversation_history(conversation_id, ctx.tenant_schema, ctx.employee_id)
    if not messages:
        raise HTTPException(status_code=404, detail="Conversation introuvable ou acces refuse")
    return messages


@router.post("/dm/{message_id}/read")
async def mark_dm_read(
    message_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Marque un message direct comme lu."""
    db.mark_dm_as_read(message_id, ctx.employee_id, ctx.tenant_schema)
    return {"success": True}


@router.get("/dm/employees", response_model=list[EmployeeInfo])
async def list_employees_for_dm(
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Retourne les employes disponibles pour la messagerie directe."""
    employees = db.get_tenant_employees_for_dm(ctx.tenant_schema)
    return [
        EmployeeInfo(id=e['id'], prenom=e['prenom'], nom=e['nom'], poste=e.get('poste'))
        for e in employees if e['id'] != ctx.employee_id
    ]


# ===== COMPTEURS NON-LUS =====

@router.get("/messaging/unread", response_model=UnreadCountResponse)
async def get_unread_counts(
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Retourne les compteurs de messages non lus (conference + directs)."""
    conference = db.get_conference_unread_total(ctx.tenant_schema, ctx.employee_id)
    direct = db.get_dm_unread_count(ctx.tenant_schema, ctx.employee_id)
    return UnreadCountResponse(
        conference_unread=conference,
        direct_unread=direct,
        total_unread=conference + direct,
    )


# ===== DOSSIERS =====

@router.get("/dossiers", response_model=list[DossierListResponse])
async def list_dossiers(ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Retourne les dossiers lies aux projets de l'employe."""
    return db.get_employee_dossiers(ctx.tenant_schema, ctx.employee_id)


@router.get("/dossiers/{dossier_id}", response_model=DossierDetailResponse)
async def get_dossier(dossier_id: int, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Retourne le detail d'un dossier (etapes, documents, notes)."""
    result = db.get_dossier_detail(ctx.tenant_schema, dossier_id)
    if not result:
        raise HTTPException(status_code=404, detail="Dossier introuvable")
    return result


@router.post("/dossiers/{dossier_id}/notes", response_model=DossierNoteResponse)
async def add_note(
    dossier_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
    contenu: str = Form(""),
    categorie: str = Form("general"),
    photos: list[UploadFile] = File(default=[]),
):
    """Ajoute une note avec photos optionnelles a un dossier depuis le mobile."""
    accessible_dossiers = db.get_employee_dossiers(ctx.tenant_schema, ctx.employee_id)
    accessible_ids = {d['id'] for d in accessible_dossiers}
    if dossier_id not in accessible_ids:
        raise HTTPException(status_code=403, detail="Acces refuse a ce dossier")

    contenu = (contenu or "").strip()
    has_text = bool(contenu)
    has_photos = bool(photos and any(p.filename for p in photos))

    if not has_text and not has_photos:
        raise HTTPException(status_code=400, detail="Veuillez ecrire une note ou ajouter des photos")

    if has_photos and len(photos) > db.MAX_PHOTOS_PER_NOTE:
        raise HTTPException(status_code=400, detail=f"Maximum {db.MAX_PHOTOS_PER_NOTE} photos par note")

    note_text = contenu if has_text else ""
    result = db.add_dossier_note(ctx.tenant_schema, dossier_id, ctx.employee_id, note_text, categorie)
    if not result:
        raise HTTPException(status_code=500, detail="Erreur lors de l'ajout de la note")

    saved_photos = []
    if has_photos:
        for photo in photos:
            if not photo.filename:
                logger.warning("[NOTE_PHOTO] Photo ignoree: filename vide")
                continue
            photo_bytes = await photo.read()
            if len(photo_bytes) == 0:
                logger.warning(f"[NOTE_PHOTO] Photo ignoree: {photo.filename} — 0 bytes")
                continue
            if len(photo_bytes) > db.MAX_PHOTO_SIZE_BYTES:
                logger.warning(f"[NOTE_PHOTO] Photo ignoree: {photo.filename} — {len(photo_bytes)} bytes > 5 Mo")
                continue

            # Detecter le MIME reel via magic bytes (source de verite)
            detected_mime = _detect_image_mime(photo_bytes)
            if not detected_mime:
                logger.warning(f"[NOTE_PHOTO] Photo ignoree: {photo.filename} — magic bytes invalides "
                               f"(content_type={photo.content_type}, premiers octets={photo_bytes[:8].hex()})")
                continue

            # Utiliser le MIME detecte par magic bytes (fiable) plutot que le content_type du navigateur
            # Certains navigateurs mobiles envoient content_type=None ou application/octet-stream
            effective_mime = detected_mime
            if photo.content_type and photo.content_type.startswith('image/'):
                effective_mime = photo.content_type  # Le navigateur a bien detecte — on le garde
            else:
                logger.info(f"[NOTE_PHOTO] {photo.filename}: content_type navigateur={photo.content_type} "
                            f"→ corrige en {detected_mime} via magic bytes")

            try:
                photo_id = db.add_note_photo(
                    schema_name=ctx.tenant_schema,
                    note_id=result['id'],
                    fichier_nom=photo.filename,
                    fichier_type=effective_mime,
                    fichier_data=photo_bytes,
                    uploaded_by=ctx.employee_id
                )
                if photo_id:
                    saved_photos.append({
                        'id': photo_id,
                        'note_id': result['id'],
                        'fichier_nom': photo.filename,
                        'fichier_type': effective_mime,
                        'fichier_taille': len(photo_bytes),
                        'photo_url': f"/dossiers/notes/photos/{photo_id}",
                        'uploaded_at': None,
                    })
                    logger.info(f"[NOTE_PHOTO] Photo sauvegardee: {photo.filename} ({len(photo_bytes)} bytes, {effective_mime}) → id={photo_id}")
                else:
                    logger.warning(f"[NOTE_PHOTO] Photo non sauvegardee: {photo.filename} — add_note_photo retourne None")
            except Exception as e_photo:
                logger.warning(f"[NOTE_PHOTO] Erreur sauvegarde photo {photo.filename}: {e_photo}")

        if not has_text and not saved_photos:
            db.delete_dossier_note(ctx.tenant_schema, result['id'])
            raise HTTPException(status_code=400, detail="Aucune photo valide n'a pu etre sauvegardee")

    result['photos'] = saved_photos
    return result


@router.get("/dossiers/notes/photos/{photo_id}")
async def get_note_photo(
    photo_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context_or_signed),
):
    """Retourne une photo de note de dossier.

    Accepte Bearer header OU signed URL HMAC (voir POST /auth/signed-url).
    """
    # Verifier que la photo appartient a un dossier accessible par l'employe
    photo_dossier_id = db.get_photo_dossier_id(ctx.tenant_schema, photo_id)
    if photo_dossier_id is None:
        raise HTTPException(status_code=404, detail="Photo introuvable")
    accessible_dossiers = db.get_employee_dossiers(ctx.tenant_schema, ctx.employee_id)
    accessible_ids = {d['id'] for d in accessible_dossiers}
    if photo_dossier_id not in accessible_ids:
        raise HTTPException(status_code=403, detail="Acces refuse a cette photo")

    photo = db.get_note_photo_data(ctx.tenant_schema, photo_id)
    if not photo:
        raise HTTPException(status_code=404, detail="Photo introuvable")
    content_type = photo.get('fichier_type', 'image/jpeg')
    return Response(
        content=photo['fichier_data'],
        media_type=content_type,
        headers=_build_download_headers(photo.get('fichier_nom', 'photo.jpg'), content_type),
    )


@router.get("/dossiers/{dossier_id}/notes/{note_id}/attachment/{att_index}")
async def download_note_attachment(
    dossier_id: int,
    note_id: int,
    att_index: int,
    ctx: MobileTenantContext = Depends(get_mobile_context_or_signed),
):
    """Telecharge une piece jointe d'une note (stockee en base64 dans le JSON attachments).

    Accepte Bearer header OU signed URL HMAC.
    """
    accessible_dossiers = db.get_employee_dossiers(ctx.tenant_schema, ctx.employee_id)
    accessible_ids = {d['id'] for d in accessible_dossiers}
    if dossier_id not in accessible_ids:
        raise HTTPException(status_code=403, detail="Acces refuse a ce dossier")

    raw = db.get_note_attachments_raw(ctx.tenant_schema, dossier_id, note_id)
    if not raw:
        raise HTTPException(status_code=404, detail="Note ou piece jointe non trouvee")

    try:
        atts = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError) as exc:
        logger.error("Attachments JSON corrompu pour note %s (dossier %s): %s",
                     note_id, dossier_id, exc)
        raise HTTPException(status_code=500, detail="Piece jointe corrompue en base")

    if att_index < 0 or att_index >= len(atts):
        raise HTTPException(status_code=404, detail="Piece jointe non trouvee")

    att = atts[att_index]
    content = base64.b64decode(att.get("data_base64", ""))
    content_type = att.get("type", "application/octet-stream")
    return StreamingResponse(
        io.BytesIO(content),
        media_type=content_type,
        headers=_build_download_headers(att.get("nom"), content_type),
    )


@router.patch("/dossiers/{dossier_id}/etapes/{etape_id}")
async def toggle_etape_statut(
    dossier_id: int,
    etape_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
    statut: str = Query(..., pattern="^(TODO|IN_PROGRESS|DONE)$"),
):
    """Change le statut d'une etape de dossier depuis le mobile."""
    accessible_dossiers = db.get_employee_dossiers(ctx.tenant_schema, ctx.employee_id)
    accessible_ids = {d['id'] for d in accessible_dossiers}
    if dossier_id not in accessible_ids:
        raise HTTPException(status_code=403, detail="Acces refuse a ce dossier")

    result = db.update_etape_statut(ctx.tenant_schema, dossier_id, etape_id, statut)
    if not result:
        raise HTTPException(status_code=404, detail="Etape introuvable ou statut invalide")
    return result


# ============================================================================
# Liens cliquables sur dossier (mobile)
# ============================================================================

def _check_dossier_access(ctx: MobileTenantContext, dossier_id: int) -> None:
    """Verifie que l'employe a acces au dossier. Sinon 403."""
    accessible_dossiers = db.get_employee_dossiers(ctx.tenant_schema, ctx.employee_id)
    accessible_ids = {d['id'] for d in accessible_dossiers}
    if dossier_id not in accessible_ids:
        raise HTTPException(status_code=403, detail="Acces refuse a ce dossier")


@router.get("/dossiers/{dossier_id}/liens", response_model=list[DossierLienResponse])
async def list_dossier_liens(
    dossier_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Liste les liens cliquables d'un dossier."""
    _check_dossier_access(ctx, dossier_id)
    return db.list_dossier_liens(ctx.tenant_schema, dossier_id)


@router.post("/dossiers/{dossier_id}/liens", response_model=DossierLienResponse)
async def create_dossier_lien(
    dossier_id: int,
    body: CreateDossierLienRequest,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Cree un lien sur un dossier."""
    _check_dossier_access(ctx, dossier_id)
    url = db.validate_lien_url(body.url)
    if not url:
        raise HTTPException(status_code=400, detail="URL invalide. Doit commencer par http:// ou https://")
    result = db.create_dossier_lien(ctx.tenant_schema, dossier_id, url, body.description, ctx.employee_id)
    if not result:
        raise HTTPException(status_code=500, detail="Erreur lors de la creation du lien")
    return result


@router.put("/dossiers/{dossier_id}/liens/{lien_id}", response_model=DossierLienResponse)
async def update_dossier_lien(
    dossier_id: int,
    lien_id: int,
    body: UpdateDossierLienRequest,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Met a jour un lien."""
    _check_dossier_access(ctx, dossier_id)
    if body.url is None and body.description is None:
        raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
    cleaned_url = None
    if body.url is not None:
        cleaned_url = db.validate_lien_url(body.url)
        if not cleaned_url:
            raise HTTPException(status_code=400, detail="URL invalide. Doit commencer par http:// ou https://")
    result = db.update_dossier_lien(ctx.tenant_schema, dossier_id, lien_id, cleaned_url, body.description)
    if not result:
        raise HTTPException(status_code=404, detail="Lien introuvable")
    return result


@router.delete("/dossiers/{dossier_id}/liens/{lien_id}")
async def delete_dossier_lien(
    dossier_id: int,
    lien_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Supprime un lien d'un dossier."""
    _check_dossier_access(ctx, dossier_id)
    if not db.delete_dossier_lien(ctx.tenant_schema, dossier_id, lien_id):
        raise HTTPException(status_code=404, detail="Lien introuvable")
    return {"message": "Lien supprime"}


@router.get("/dossiers/{dossier_id}/documents/{document_id}/download")
async def download_document(
    dossier_id: int,
    document_id: int,
    source: str = 'dossier_documents',
    ctx: MobileTenantContext = Depends(get_mobile_context_or_signed),
):
    """Telecharge un document non confidentiel d'un dossier.

    Accepte Bearer header OU signed URL HMAC (POST /auth/signed-url).
    Le parametre source ('dossier_documents' ou 'attachments') determine la table
    source — necessaire car les IDs SERIAL peuvent collisionner entre les deux tables.
    """
    # Verifier que l'employe a acces a ce dossier
    accessible_dossiers = db.get_employee_dossiers(ctx.tenant_schema, ctx.employee_id)
    accessible_ids = {d['id'] for d in accessible_dossiers}
    if dossier_id not in accessible_ids:
        raise HTTPException(status_code=403, detail="Acces refuse a ce dossier")

    doc = db.get_dossier_document_data(ctx.tenant_schema, dossier_id, document_id, source=source)
    if not doc:
        raise HTTPException(status_code=404, detail="Document introuvable")

    content_type = doc.get('fichier_type') or 'application/octet-stream'
    filename = doc.get('fichier_nom') or 'document'

    # Streaming via memoryview pour eviter la copie bytes() et fournir
    # Content-Length au client (download progress). NOTE: la RAM reste
    # consommee tant que le generateur tient la reference au BYTEA — la
    # vraie solution streaming (SUBSTRING SQL chunks ou large objects) est
    # backlog P3 pour quand on migrera vers S3/R2.
    raw = doc['fichier_data']
    if isinstance(raw, memoryview):
        view = raw
    elif isinstance(raw, (bytes, bytearray)):
        view = memoryview(raw)
    else:
        view = memoryview(bytes(raw))
    total_size = len(view)

    def _iter_chunks(chunk_size: int = 65536):
        for offset in range(0, total_size, chunk_size):
            yield bytes(view[offset:offset + chunk_size])

    headers = _build_download_headers(filename, content_type)
    headers["Content-Length"] = str(total_size)

    return StreamingResponse(
        _iter_chunks(),
        media_type=content_type,
        headers=headers,
    )


# ===== ASSISTANT IA =====

def _raise_ai_http(result: dict) -> None:
    """Map a `{'error': ..., 'kind': ...}` payload from the AI database layer
    to the right HTTPException so the client distinguishes "out of credits"
    (402) from a real backend/Anthropic outage.

    No-op when the result has no 'error' key. Always raises when it does.
    """
    if 'error' not in result:
        return
    kind = result.get('kind')
    if kind == 'quota':
        raise HTTPException(402, result['error'])
    if kind == 'validation':
        raise HTTPException(400, result['error'])
    if kind == 'not_found':
        raise HTTPException(404, result['error'])
    if kind == 'config':
        raise HTTPException(503, result['error'])
    if kind == 'server':
        raise HTTPException(500, result['error'])
    if kind == 'upstream':
        # Explicit upstream failure (Anthropic API, network).
        raise HTTPException(502, result['error'])
    # Unknown / untagged — treat as internal server error rather than 502
    # since it's more likely a backend coding bug than an upstream gateway
    # failure (502 implies "we know the upstream failed").
    raise HTTPException(500, result['error'])


@router.get("/ai/experts")
async def list_expert_profiles(ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Retourne la liste des profils experts IA disponibles."""
    return {"profiles": db.get_expert_profiles_list()}


@router.get("/ai/quota", response_model=AIQuotaResponse)
async def get_ai_quota(ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Verifie le quota IA du tenant."""
    tenant_info = db.get_tenant_info_by_schema(ctx.tenant_schema)
    if not tenant_info:
        raise HTTPException(404, "Tenant non trouve")
    return db.check_ai_quota_mobile(tenant_info['id'])


@router.get("/ai/conversations", response_model=list[AIConversationResponse])
async def list_ai_conversations(ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Liste les conversations IA de l'employe."""
    return db.get_ai_conversations(ctx.tenant_schema, ctx.employee_id)


@router.get("/ai/conversations/{conversation_id}", response_model=AIConversationDetailResponse)
async def get_ai_conversation(conversation_id: int,
                               ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Retourne le detail d'une conversation IA."""
    result = db.get_ai_conversation_detail(ctx.tenant_schema, conversation_id, ctx.employee_id)
    if not result:
        raise HTTPException(404, "Conversation non trouvee")
    return result


@router.delete("/ai/conversations/{conversation_id}")
async def delete_conversation(conversation_id: int,
                               ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Supprime une conversation IA."""
    ok = db.delete_ai_conversation(ctx.tenant_schema, conversation_id, ctx.employee_id)
    if not ok:
        raise HTTPException(404, "Conversation non trouvee")
    return {"message": "Conversation supprimee"}


@router.post("/ai/chat", response_model=AIChatMessageResponse)
async def send_ai_chat(body: AIChatMessageRequest,
                        ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Envoie un message a l'assistant IA et retourne la reponse."""
    tenant_info = db.get_tenant_info_by_schema(ctx.tenant_schema)
    if not tenant_info:
        raise HTTPException(404, "Tenant non trouve")
    # Preparer les images si presentes
    images_data = None
    if body.images:
        images_data = [{'data': img.data, 'media_type': img.media_type} for img in body.images]

    result = db.send_ai_message(
        schema_name=ctx.tenant_schema,
        tenant_id=tenant_info['id'],
        tenant_nom=tenant_info['nom'],
        employee_id=ctx.employee_id,
        message=body.message,
        conversation_id=body.conversation_id,
        images=images_data
    )
    _raise_ai_http(result)
    return result


@router.post("/ai/pending-actions/{action_id}/confirm",
             response_model=AIPendingActionConfirmResponse)
async def confirm_ai_pending_action(action_id: int,
                                     ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Confirme et execute une action IA en attente.

    L'action doit appartenir au schema/employee courant et etre dans l'etat
    'pending' (non expiree). L'execution applique la SQL stockee avec ses
    parametres binds, sous transaction avec timeout 15s.
    """
    result = db.confirm_pending_action(action_id, ctx.tenant_schema, ctx.employee_id)
    if not result.get('success'):
        # 404 si introuvable, 409 si deja traitee/expiree, 500 si erreur SQL
        msg = result.get('result_msg', '')
        if 'introuvable' in msg.lower() or 'non autorisee' in msg.lower():
            raise HTTPException(404, msg)
        if 'deja traitee' in msg.lower() or 'expire' in msg.lower():
            raise HTTPException(409, msg)
        raise HTTPException(500, msg)
    return result


@router.post("/ai/pending-actions/{action_id}/cancel",
             response_model=AIPendingActionConfirmResponse)
async def cancel_ai_pending_action(action_id: int,
                                    ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Annule une action IA en attente sans l'executer."""
    result = db.cancel_pending_action(action_id, ctx.tenant_schema, ctx.employee_id)
    if not result.get('success'):
        msg = result.get('result_msg', '')
        if 'introuvable' in msg.lower():
            raise HTTPException(404, msg)
        raise HTTPException(409, msg)
    return result


# ===== NOTES IA INTELLIGENTES =====

@router.post("/notes/ai/enrich", response_model=NoteAIResponse)
async def ai_enrich_note_endpoint(
    body: NoteAIEnrichRequest,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Enrichit une note brute avec l'IA — structure, categorise et extrait les actions."""
    tenant_info = db.get_tenant_info_by_schema(ctx.tenant_schema)
    if not tenant_info:
        raise HTTPException(404, "Tenant non trouve")

    result = db.ai_enrich_note(
        schema_name=ctx.tenant_schema,
        tenant_id=tenant_info['id'],
        tenant_nom=tenant_info['nom'],
        employee_id=ctx.employee_id,
        contenu=body.contenu,
        dossier_titre=body.dossier_titre,
    )
    _raise_ai_http(result)
    return result


@router.post("/notes/ai/analyze-photo", response_model=NoteAIResponse)
async def ai_analyze_photo_endpoint(
    body: NoteAIAnalyzePhotoRequest,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Analyse une photo de chantier avec Claude Vision et genere une note structuree."""
    tenant_info = db.get_tenant_info_by_schema(ctx.tenant_schema)
    if not tenant_info:
        raise HTTPException(404, "Tenant non trouve")

    result = db.ai_analyze_photo(
        schema_name=ctx.tenant_schema,
        tenant_id=tenant_info['id'],
        tenant_nom=tenant_info['nom'],
        employee_id=ctx.employee_id,
        image_data=body.image_data,
        media_type=body.media_type,
        contexte=body.contexte,
        dossier_titre=body.dossier_titre,
    )
    _raise_ai_http(result)
    return result


@router.post("/dossiers/{dossier_id}/notes/ai/summary", response_model=NoteAISummaryResponse)
async def ai_summarize_notes_endpoint(
    dossier_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Resume intelligent de toutes les notes d'un dossier."""
    # Verifier acces au dossier
    accessible_dossiers = db.get_employee_dossiers(ctx.tenant_schema, ctx.employee_id)
    accessible_ids = {d['id'] for d in accessible_dossiers}
    if dossier_id not in accessible_ids:
        raise HTTPException(status_code=403, detail="Acces refuse a ce dossier")

    tenant_info = db.get_tenant_info_by_schema(ctx.tenant_schema)
    if not tenant_info:
        raise HTTPException(404, "Tenant non trouve")

    result = db.ai_summarize_dossier_notes(
        schema_name=ctx.tenant_schema,
        tenant_id=tenant_info['id'],
        tenant_nom=tenant_info['nom'],
        employee_id=ctx.employee_id,
        dossier_id=dossier_id,
    )
    _raise_ai_http(result)
    return result


# ===== OCR SCAN RECUS (Phase 4A) =====

# MIME types acceptes pour le scan de recu. HEIC inclus car les iPhones
# enregistrent souvent en HEIC par defaut (photos prises avec la camera native).
_OCR_RECEIPT_MIMES = frozenset({
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
})

# Limite plus haute que photo classique (5 MB) car les recus sont scannes
# en haute resolution pour lisibilite OCR. 10 MB aligne sur attachements.
_OCR_MAX_RECEIPT_SIZE = 10 * 1024 * 1024


@router.post("/ocr/receipt", response_model=OcrReceiptResponse)
async def ocr_scan_receipt(
    file: UploadFile = File(...),
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Analyse un recu de commerce avec Claude Vision et retourne les donnees structurees.

    Use case : ouvrier sur chantier photographie un recu Home Depot/Reno-Depot,
    l'app extrait fournisseur, items, taxes, total via Claude Sonnet 4.6 multimodal.
    L'UI propose ensuite de creer un Bon de Commande pre-rempli.

    Pipeline:
      1. Validation taille (10 MB max) + MIME via magic bytes (anti-spoofing).
      2. Encode base64.
      3. Appel Claude Vision avec prompt structure (JSON strict).
      4. Parse JSON tolerant (markdown fences, valeurs nullables).
      5. Track usage IA pour facturation tenant.

    Erreurs:
      - 400 fichier invalide (taille, MIME)
      - 503 cle API Claude absente
      - 502 erreur upstream Anthropic
      - 429 quota IA tenant epuise
    """
    # 1. Validation taille
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide")
    if len(content) > _OCR_MAX_RECEIPT_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Image trop volumineuse (max {_OCR_MAX_RECEIPT_SIZE // (1024 * 1024)} Mo)",
        )

    # 2. Detection MIME via magic bytes (pas confiance au Content-Type client)
    detected_mime = _detect_file_mime(content)
    if not detected_mime or detected_mime not in _OCR_RECEIPT_MIMES:
        raise HTTPException(
            status_code=400,
            detail="Format d'image non supporte. Utilisez JPEG, PNG, WebP ou HEIC.",
        )

    # 3. HEIC fallback : Claude Vision n'accepte pas HEIC directement, on convertit
    # en JPEG via Pillow si dispo. Sans Pillow, on rejette poliment.
    if detected_mime == 'image/heic':
        try:
            from PIL import Image
            try:
                import pillow_heif  # type: ignore
                pillow_heif.register_heif_opener()
            except ImportError:
                # Pillow seul ne lit pas HEIC sans le plugin pillow_heif
                raise HTTPException(
                    status_code=400,
                    detail="Format HEIC non supporte sur le serveur. Convertissez en JPEG/PNG cote client.",
                )
            img = Image.open(io.BytesIO(content))
            if img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGB')
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=85)
            content = buf.getvalue()
            detected_mime = 'image/jpeg'
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("[OCR] Conversion HEIC echouee: %s", e)
            raise HTTPException(
                status_code=400,
                detail="Impossible de lire l'image HEIC. Convertissez en JPEG cote client.",
            )

    # 4. Encode base64
    image_b64 = base64.b64encode(content).decode('ascii')

    # 5. Resoudre tenant_id pour tracking IA
    tenant_info = db.get_tenant_info_by_schema(ctx.tenant_schema)
    if not tenant_info:
        raise HTTPException(status_code=404, detail="Tenant non trouve")

    # 6. Appel Claude Vision (sync, peut bloquer ~3-10s)
    result = db.ai_ocr_receipt(
        schema_name=ctx.tenant_schema,
        tenant_id=tenant_info['id'],
        tenant_nom=tenant_info['nom'],
        employee_id=ctx.employee_id,
        image_data=image_b64,
        media_type=detected_mime,
    )

    # 7. Mapper les erreurs sur des codes HTTP
    if 'error' in result:
        kind = result.get('kind', '')
        if kind == 'config':
            raise HTTPException(status_code=503, detail=result['error'])
        if kind == 'quota':
            raise HTTPException(status_code=429, detail=result['error'])
        # upstream / par defaut
        raise HTTPException(status_code=502, detail=result['error'])

    return result


# ===== PUSH NOTIFICATIONS =====

@router.get("/push/vapid-public-key")
async def get_vapid_public_key():
    """Retourne la cle publique VAPID pour l'abonnement push cote client."""
    if not VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=503, detail="Push notifications non configurees")
    return {"public_key": VAPID_PUBLIC_KEY}


@router.post("/push/subscribe")
async def push_subscribe(
    data: PushSubscriptionRequest,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Enregistre un abonnement push pour l'employe connecte."""
    success = db.save_push_subscription(
        ctx.tenant_schema, ctx.employee_id,
        data.endpoint, data.keys.p256dh, data.keys.auth,
    )
    if not success:
        raise HTTPException(status_code=500, detail="Erreur enregistrement push")
    return {"success": True, "message": "Abonnement push enregistre"}


@router.post("/push/unsubscribe")
async def push_unsubscribe(
    data: PushUnsubscribeRequest,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Supprime un abonnement push."""
    db.delete_push_subscription(ctx.tenant_schema, ctx.employee_id, data.endpoint)
    return {"success": True, "message": "Abonnement push supprime"}


# ===== DOCUMENTS COMMERCIAUX =====

VALID_DOC_TYPES = {"devis", "factures", "bons-travail", "bons-commande"}


def _validate_doc_type(doc_type: str):
    if doc_type not in VALID_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Type de document invalide: {doc_type}. Valides: {', '.join(VALID_DOC_TYPES)}")


@router.get("/documents/stats")
async def get_all_documents_stats(ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Retourne les statistiques pour les 4 types de documents."""
    stats = db.get_documents_all_stats(ctx.tenant_schema)
    return stats


@router.get("/documents/lookup/companies")
async def get_companies_lookup(ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Liste les clients pour les dropdowns."""
    return db.get_companies_list(ctx.tenant_schema)


@router.get("/documents/lookup/projects")
async def get_projects_lookup(ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Liste les projets pour les dropdowns."""
    return db.get_projects_list(ctx.tenant_schema)


@router.get("/documents/{doc_type}/stats")
async def get_documents_type_stats(doc_type: str, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Retourne les statistiques pour un type de document."""
    _validate_doc_type(doc_type)
    stats = db.get_documents_stats(ctx.tenant_schema, doc_type)
    return stats


@router.get("/documents/{doc_type}")
async def list_documents(
    doc_type: str,
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    statut: Optional[str] = None,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Liste les documents d'un type."""
    _validate_doc_type(doc_type)
    docs = db.get_documents_list(ctx.tenant_schema, doc_type, limit=limit, offset=offset, statut_filter=statut)
    return docs


# ===== EXPORT CSV (Phase 5B) =====
#
# IMPORTANT : cette route DOIT etre declaree AVANT
# `/documents/{doc_type}/{doc_id}` sinon FastAPI matche `export.csv` comme
# un `doc_id` et retourne 422.

# Colonnes CSV (header FR) + cle dict pour chaque type de document.
_CSV_COLUMNS = {
    "devis": [
        ("numero", "Numero"),
        ("nom_projet", "Projet"),
        ("client_nom", "Client"),
        ("date_creation", "Date creation"),
        ("date_prevu", "Date prevue"),
        ("montant_total", "Montant total"),
        ("statut", "Statut"),
        ("priorite", "Priorite"),
    ],
    "factures": [
        ("numero", "Numero"),
        ("client_nom", "Client"),
        ("date_creation", "Date creation"),
        ("date_echeance", "Date echeance"),
        ("montant_total", "Montant total"),
        ("montant_paye", "Montant paye"),
        ("solde_du", "Solde du"),
        ("statut", "Statut"),
    ],
    "bons-travail": [
        ("numero", "Numero"),
        ("nom_projet", "Projet"),
        ("client_nom", "Client"),
        ("date_debut", "Date debut"),
        ("date_fin", "Date fin"),
        ("heures_estimees", "Heures estimees"),
        ("heures_realisees", "Heures realisees"),
        ("statut", "Statut"),
        ("priorite", "Priorite"),
    ],
    "bons-commande": [
        ("numero", "Numero"),
        ("fournisseur_nom", "Fournisseur"),
        ("project_nom", "Projet"),
        ("date_livraison_prevue", "Date livraison prevue"),
        ("montant_total", "Montant total"),
        ("statut", "Statut"),
    ],
}


def _format_csv_value(value) -> str:
    """Normalise une valeur pour le CSV : decimal -> '1234.56', date ISO
    -> 'YYYY-MM-DD' (tronquee), None -> '', autres -> str().

    Le separateur decimal reste '.' pour eviter les conflits avec ';' du
    separateur de champ ; Excel FR interprete correctement les nombres
    avec point decimal quand le separateur de champ est ';'.
    """
    if value is None:
        return ""
    # date / datetime ISO : ne garder que la partie date (10 premiers car.)
    if isinstance(value, str) and len(value) >= 10 and value[4] == "-" and value[7] == "-":
        return value[:10]
    # Decimal / float / int : str() suffit
    return str(value)


@router.get("/documents/{doc_type}/export.csv")
async def export_documents_csv(
    doc_type: str,
    statut: Optional[str] = None,
    max_rows: int = Query(5000, ge=1, le=5000),
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Exporte les documents d'un type en CSV (Excel FR Windows).

    - Encoding UTF-8 avec BOM (﻿) pour ouverture directe dans Excel FR.
    - Separateur de champ ';' (standard Excel FR).
    - Au plus `max_rows` lignes (defaut + plafond 5000).
    - Filtre optionnel par statut.
    """
    _validate_doc_type(doc_type)

    columns = _CSV_COLUMNS.get(doc_type)
    if not columns:
        # Garde-fou : ne devrait jamais arriver vu _validate_doc_type.
        raise HTTPException(status_code=400, detail="Type de document non supporte pour export CSV")

    rows = db.get_documents_for_export(
        ctx.tenant_schema, doc_type, statut_filter=statut, max_rows=max_rows
    )

    # Construire le CSV en memoire (StringIO) avec separateur ';' et
    # quoting minimal. csv.writer gere les guillemets si le champ contient
    # le separateur ou un saut de ligne.
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    writer.writerow([label for _, label in columns])
    for row in rows:
        writer.writerow([_format_csv_value(row.get(key)) for key, _ in columns])

    # BOM UTF-8 prepended pour qu'Excel FR detecte l'encoding correctement.
    body = ("﻿" + buf.getvalue()).encode("utf-8")

    # Filename : <doc_type>_YYYY-MM-DD.csv (ASCII safe).
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"{doc_type}_{today}.csv"
    quoted = _url_quote(filename)
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{filename}"; '
            f"filename*=UTF-8''{quoted}"
        ),
        "Content-Length": str(len(body)),
        "Cache-Control": "no-store",
    }
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers=headers,
    )


@router.get("/documents/{doc_type}/{doc_id}")
async def get_document_detail(doc_type: str, doc_id: int, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Retourne le detail d'un document avec ses lignes."""
    _validate_doc_type(doc_type)
    doc = db.get_document_detail(ctx.tenant_schema, doc_type, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document non trouve")
    return doc


def _audit_doc_label(doc: Optional[dict]) -> Optional[str]:
    """Extrait un label humain (numero) depuis un dict document pour l'audit."""
    if not doc:
        return None
    for key in ("numero", "numero_facture", "numero_document"):
        val = doc.get(key)
        if val:
            return str(val)[:255]
    doc_id = doc.get("id")
    return f"#{doc_id}" if doc_id else None


def _audit_create_doc(request: Request, ctx: MobileTenantContext, doc_type: str, result: dict):
    """Helper : log un evenement 'create' pour un document apres creation reussie."""
    _ip, _ua = _extract_request_forensics(request)
    db.log_audit_event(
        tenant_schema=ctx.tenant_schema,
        employee_id=ctx.employee_id,
        action='create',
        entity_type=doc_type,
        entity_id=int(result.get("id")) if result.get("id") else None,
        entity_label=_audit_doc_label(result),
        after=result,
        ip=_ip, ua=_ua,
    )


@router.post("/documents/devis", status_code=201)
async def create_devis(data: DevisCreateRequest, request: Request, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Cree un nouveau devis."""
    result = db.create_document(ctx.tenant_schema, "devis", data.model_dump(exclude_none=True))
    if not result:
        raise HTTPException(status_code=500, detail="Erreur lors de la creation du devis")
    _audit_create_doc(request, ctx, "devis", result)
    return result


@router.post("/documents/factures", status_code=201)
async def create_facture(data: FactureCreateRequest, request: Request, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Cree une nouvelle facture."""
    result = db.create_document(ctx.tenant_schema, "factures", data.model_dump(exclude_none=True))
    if not result:
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la facture")
    _audit_create_doc(request, ctx, "factures", result)
    return result


@router.post("/documents/bons-travail", status_code=201)
async def create_bon_travail(data: BonTravailCreateRequest, request: Request, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Cree un nouveau bon de travail."""
    result = db.create_document(ctx.tenant_schema, "bons-travail", data.model_dump(exclude_none=True))
    if not result:
        raise HTTPException(status_code=500, detail="Erreur lors de la creation du bon de travail")
    _audit_create_doc(request, ctx, "bons-travail", result)
    return result


@router.post("/documents/bons-commande", status_code=201)
async def create_bon_commande(data: BonCommandeCreateRequest, request: Request, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Cree un nouveau bon de commande."""
    result = db.create_document(ctx.tenant_schema, "bons-commande", data.model_dump(exclude_none=True))
    if not result:
        raise HTTPException(status_code=500, detail="Erreur lors de la creation du bon de commande")
    _audit_create_doc(request, ctx, "bons-commande", result)
    return result


@router.put("/documents/{doc_type}/{doc_id}")
async def update_document(doc_type: str, doc_id: int, data: DocumentUpdateRequest, request: Request, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Met a jour un document."""
    _validate_doc_type(doc_type)
    # Snapshot AVANT pour l'audit (Loi 25 : tracer ce qui a change)
    before_doc = None
    try:
        before_doc = db.get_document_detail(ctx.tenant_schema, doc_type, doc_id)
    except Exception:
        # Pre-snapshot ne doit pas bloquer l'update
        pass

    payload = data.model_dump(exclude_none=True)
    success = db.update_document(ctx.tenant_schema, doc_type, doc_id, payload)
    if not success:
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour")

    _ip, _ua = _extract_request_forensics(request)
    db.log_audit_event(
        tenant_schema=ctx.tenant_schema,
        employee_id=ctx.employee_id,
        action='update',
        entity_type=doc_type,
        entity_id=doc_id,
        entity_label=_audit_doc_label(before_doc),
        before=before_doc,
        after={'_changed_fields': payload},
        ip=_ip, ua=_ua,
    )
    return {"success": True, "message": "Document mis a jour"}


@router.delete("/documents/{doc_type}/{doc_id}")
async def delete_document(doc_type: str, doc_id: int, request: Request, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Supprime un document et ses lignes."""
    _validate_doc_type(doc_type)
    # Snapshot AVANT delete (Loi 25 : pouvoir reconstituer l'entite supprimee)
    before_doc = None
    try:
        before_doc = db.get_document_detail(ctx.tenant_schema, doc_type, doc_id)
    except Exception:
        pass

    deleted = db.delete_document(ctx.tenant_schema, doc_type, doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document non trouve")

    _ip, _ua = _extract_request_forensics(request)
    db.log_audit_event(
        tenant_schema=ctx.tenant_schema,
        employee_id=ctx.employee_id,
        action='delete',
        entity_type=doc_type,
        entity_id=doc_id,
        entity_label=_audit_doc_label(before_doc),
        before=before_doc,
        ip=_ip, ua=_ua,
    )
    return {"success": True, "message": "Document supprime"}


@router.post("/documents/{doc_type}/{doc_id}/duplicate", status_code=201)
async def duplicate_document(
    doc_type: str,
    doc_id: int,
    request: Request,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Duplique un document existant en BROUILLON avec un nouveau numero pro.

    Pipeline : verifie l'existence du source -> genere nouveau numero
    sequentiel -> clone client/projet/notes/lignes -> date emission = aujourd'hui
    -> date echeance = +30j (factures uniquement). N'inclut PAS la signature,
    le payment_link ni les pieces jointes (etat propre pour edition).
    """
    _validate_doc_type(doc_type)
    # Verifie d'abord l'existence pour distinguer 404 vs erreur DB
    source = db.get_document_detail(ctx.tenant_schema, doc_type, doc_id)
    if not source:
        raise HTTPException(status_code=404, detail="Document source introuvable")
    result = db.duplicate_document(ctx.tenant_schema, doc_type, doc_id)
    if not result:
        raise HTTPException(status_code=500, detail="Erreur lors de la duplication")
    # Audit Loi 25 : tracer la creation du document duplique
    _ip, _ua = _extract_request_forensics(request)
    db.log_audit_event(
        tenant_schema=ctx.tenant_schema, employee_id=ctx.employee_id,
        action='create', entity_type=doc_type, entity_id=result.get('id'),
        entity_label=result.get('numero'),
        after=result,
        metadata={"source": "duplicate", "source_id": doc_id, "source_numero": source.get('numero')},
        ip=_ip, ua=_ua,
    )
    return result


@router.post("/documents/{doc_type}/{doc_id}/lines", status_code=201)
async def add_document_line(doc_type: str, doc_id: int, data: DocumentLineCreate, request: Request, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Ajoute une ligne a un document."""
    _validate_doc_type(doc_type)
    payload = data.model_dump(exclude_none=True)
    line = db.add_document_line(ctx.tenant_schema, doc_type, doc_id, payload)
    if not line:
        raise HTTPException(status_code=500, detail="Erreur lors de l'ajout de la ligne")
    # Audit Loi 25
    _ip, _ua = _extract_request_forensics(request)
    db.log_audit_event(
        tenant_schema=ctx.tenant_schema, employee_id=ctx.employee_id,
        action='create', entity_type='document_line', entity_id=line.get('id'),
        entity_label=f"{doc_type}#{doc_id} line",
        after=line,
        metadata={"doc_type": doc_type, "doc_id": doc_id},
        ip=_ip, ua=_ua,
    )
    return line


@router.put("/documents/{doc_type}/{doc_id}/lines/{line_id}")
async def update_document_line(doc_type: str, doc_id: int, line_id: int, data: DocumentLineUpdate, request: Request, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Met a jour une ligne."""
    _validate_doc_type(doc_type)
    patch = data.model_dump(exclude_none=True)
    success = db.update_document_line(ctx.tenant_schema, doc_type, doc_id, line_id, patch)
    if not success:
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour de la ligne")
    # Audit Loi 25
    _ip, _ua = _extract_request_forensics(request)
    db.log_audit_event(
        tenant_schema=ctx.tenant_schema, employee_id=ctx.employee_id,
        action='update', entity_type='document_line', entity_id=line_id,
        entity_label=f"{doc_type}#{doc_id} line {line_id}",
        after={"_changed_fields": patch},
        metadata={"doc_type": doc_type, "doc_id": doc_id},
        ip=_ip, ua=_ua,
    )
    return {"success": True}


@router.delete("/documents/{doc_type}/{doc_id}/lines/{line_id}")
async def delete_document_line(doc_type: str, doc_id: int, line_id: int, request: Request, ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Supprime une ligne."""
    _validate_doc_type(doc_type)
    deleted = db.delete_document_line(ctx.tenant_schema, doc_type, doc_id, line_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Ligne non trouvee")
    # Audit Loi 25
    _ip, _ua = _extract_request_forensics(request)
    db.log_audit_event(
        tenant_schema=ctx.tenant_schema, employee_id=ctx.employee_id,
        action='delete', entity_type='document_line', entity_id=line_id,
        entity_label=f"{doc_type}#{doc_id} line {line_id}",
        metadata={"doc_type": doc_type, "doc_id": doc_id},
        ip=_ip, ua=_ua,
    )
    return {"success": True, "message": "Ligne supprimee"}


# ===== PDF EXPORT (Phase 3A) =====

@router.post("/documents/{doc_type}/{doc_id}/pdf")
async def export_document_pdf(
    doc_type: str,
    doc_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Genere et retourne le PDF d'un document commercial.

    Utilise WeasyPrint (HTML -> PDF) avec fallback fpdf2.
    Format : Letter, en-tete avec branding tenant, totaux Quebec
    (TPS 5 %, TVQ 9,975 %), footer avec NEQ/TPS/TVQ et conditions.
    """
    _validate_doc_type(doc_type)
    data = db.get_document_for_pdf(ctx.tenant_schema, doc_type, doc_id)
    if not data:
        raise HTTPException(status_code=404, detail="Document non trouve")

    try:
        # Import lazy : evite de planter au boot si WeasyPrint manque
        from . import mobile_pdf_service as pdf_svc
        pdf_bytes = pdf_svc.generate_document_pdf(data)
    except RuntimeError as e:
        logger.error(f"[PDF] Echec generation {doc_type}/{doc_id}: {e}")
        raise HTTPException(
            status_code=503,
            detail="Generation PDF indisponible (lib manquante)"
        )
    except Exception as e:
        logger.exception(f"[PDF] Erreur generation {doc_type}/{doc_id}: {e}")
        raise HTTPException(status_code=500, detail="Erreur generation PDF")

    filename = pdf_svc.safe_filename(
        data.get("doc_type_label") or doc_type,
        (data.get("doc") or {}).get("numero"),
    )
    quoted = _url_quote(filename)
    headers = {
        # filename* RFC 5987 pour caracteres non-ASCII safe
        "Content-Disposition": (
            f'attachment; filename="{filename}"; '
            f"filename*=UTF-8''{quoted}"
        ),
        "Content-Length": str(len(pdf_bytes)),
        "Cache-Control": "no-store",
    }
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers=headers,
    )


# ===== ENVOI PAR COURRIEL (Phase 3B) =====

def _get_smtp_config() -> dict:
    """Retourne la config SMTP courante (lue depuis env vars a chaque appel).

    Aligne sur le pattern ERP_REACT/backend/erp_config.py. Les variables peuvent
    aussi venir d'un .env charge par dotenv au demarrage.
    """
    return {
        "host": os.getenv("SMTP_HOST", "").strip(),
        "port": int(os.getenv("SMTP_PORT", "465")),
        "user": os.getenv("SMTP_USER", "").strip(),
        "password": os.getenv("SMTP_PASSWORD", ""),
        "from_name": os.getenv("SMTP_FROM_NAME", "Constructo AI"),
        "from_email": os.getenv("SMTP_FROM", os.getenv("SMTP_USER", "")).strip(),
        "use_ssl": os.getenv("SMTP_USE_SSL", "true").lower() == "true",
    }


_DOC_TYPE_LABEL_FR = {
    "devis": "Soumission",
    "factures": "Facture",
    "bons-travail": "Bon de travail",
    "bons-commande": "Bon de commande",
}


def _build_default_subject(doc_type: str, numero: Optional[str], tenant_nom: Optional[str]) -> str:
    label = _DOC_TYPE_LABEL_FR.get(doc_type, "Document")
    suffix = f" - {tenant_nom}" if tenant_nom else " - Constructo AI"
    if numero:
        return f"{label} {numero}{suffix}"
    return f"{label}{suffix}"


def _build_default_body(doc_type: str, numero: Optional[str], tenant_nom: Optional[str]) -> str:
    label = _DOC_TYPE_LABEL_FR.get(doc_type, "document")
    label_lower = label.lower()
    nom_doc = f"{label_lower} {numero}" if numero else label_lower
    expediteur = tenant_nom or "Constructo AI"
    return (
        "Bonjour,\n\n"
        f"Veuillez trouver ci-joint {nom_doc} en format PDF.\n\n"
        "N'hesitez pas a nous contacter pour toute question.\n\n"
        "Cordialement,\n"
        f"{expediteur}\n"
    )


@router.post(
    "/documents/{doc_type}/{doc_id}/email",
    response_model=DocumentEmailResponse,
)
async def send_document_by_email(
    doc_type: str,
    doc_id: int,
    body: DocumentEmailRequest,
    request: Request,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Envoie un document commercial (devis, facture, BT, BC) par courriel avec
    le PDF en piece jointe.

    Workflow :
      1. Validation du doc_type et chargement du document
      2. Generation du PDF via mobile_pdf_service (memes routines que /pdf)
      3. Construction d'un MIME multipart/mixed avec body text + PDF attache
      4. Envoi SMTP via STARTTLS (ou SMTP_SSL selon SMTP_USE_SSL env)
      5. Audit dans mobile_document_emails_log (succes ou erreur)

    Errors :
      400 -> doc_type invalide ou CRLF injection dans les headers
      404 -> document introuvable
      503 -> generation PDF indisponible (WeasyPrint/fpdf2 manquants)
      502 -> envoi SMTP echoue (config manquante ou serveur down)
    """
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.mime.application import MIMEApplication
    from email.utils import formataddr, formatdate, make_msgid

    _validate_doc_type(doc_type)

    # 1. Charger le document
    data = db.get_document_for_pdf(ctx.tenant_schema, doc_type, doc_id)
    if not data:
        raise HTTPException(status_code=404, detail="Document non trouve")

    doc_obj = data.get("doc") or {}
    numero = doc_obj.get("numero")
    tenant_info = db.get_tenant_info_by_schema(ctx.tenant_schema)
    tenant_nom = (tenant_info or {}).get("nom") if tenant_info else None

    # 2. Generer le PDF
    try:
        from . import mobile_pdf_service as pdf_svc
        pdf_bytes = pdf_svc.generate_document_pdf(data)
    except RuntimeError as e:
        logger.error(f"[EMAIL] Echec PDF {doc_type}/{doc_id}: {e}")
        db.log_document_email(
            tenant_schema=ctx.tenant_schema,
            employee_id=ctx.employee_id,
            doc_type=doc_type, doc_id=doc_id,
            to_email=str(body.to_email), cc_emails=[str(c) for c in body.cc],
            subject=body.subject, status="failed",
            error_detail=f"PDF unavailable: {type(e).__name__}",
        )
        raise HTTPException(status_code=503, detail="Generation PDF indisponible")
    except Exception as e:
        logger.exception(f"[EMAIL] Erreur PDF {doc_type}/{doc_id}: {e}")
        db.log_document_email(
            tenant_schema=ctx.tenant_schema,
            employee_id=ctx.employee_id,
            doc_type=doc_type, doc_id=doc_id,
            to_email=str(body.to_email), cc_emails=[str(c) for c in body.cc],
            subject=body.subject, status="failed",
            error_detail=f"PDF error: {type(e).__name__}",
        )
        raise HTTPException(status_code=500, detail="Erreur generation PDF")

    pdf_size = len(pdf_bytes)
    pdf_filename = pdf_svc.safe_filename(
        data.get("doc_type_label") or doc_type,
        numero,
    )

    # 3. Verification config SMTP
    smtp = _get_smtp_config()
    if not smtp["host"] or not smtp["user"] or not smtp["password"]:
        logger.warning(f"[EMAIL] SMTP non configure pour tenant {ctx.tenant_schema}")
        db.log_document_email(
            tenant_schema=ctx.tenant_schema,
            employee_id=ctx.employee_id,
            doc_type=doc_type, doc_id=doc_id,
            to_email=str(body.to_email), cc_emails=[str(c) for c in body.cc],
            subject=body.subject, status="failed",
            error_detail="SMTP not configured (env vars missing)",
            pdf_size_bytes=pdf_size,
        )
        raise HTTPException(
            status_code=502,
            detail="Serveur courriel non configure",
        )

    subject = body.subject.strip() or _build_default_subject(doc_type, numero, tenant_nom)
    text_body = body.message.strip() or _build_default_body(doc_type, numero, tenant_nom)

    # CRLF injection guard sur les headers utilisateurs
    to_email_clean = str(body.to_email).strip()
    cc_list = [str(addr).strip() for addr in body.cc if str(addr).strip()]
    for label, value in (
        ("subject", subject),
        ("to_email", to_email_clean),
        *((f"cc[{i}]", v) for i, v in enumerate(cc_list)),
    ):
        if "\r" in value or "\n" in value:
            logger.error(f"[EMAIL] Header injection rejected in {label}")
            raise HTTPException(status_code=400, detail=f"Caractere illegal dans {label}")

    # 4. Construction du MIME multipart
    msg = MIMEMultipart("mixed")
    display_from = smtp["from_email"] or smtp["user"]
    msg["From"] = formataddr((smtp["from_name"], display_from))
    msg["To"] = to_email_clean
    if cc_list:
        msg["Cc"] = ", ".join(cc_list)
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Reply-To"] = display_from
    msg["Message-ID"] = make_msgid()

    msg.attach(MIMEText(text_body, "plain", "utf-8"))

    pdf_part = MIMEApplication(pdf_bytes, _subtype="pdf")
    pdf_part.add_header(
        "Content-Disposition", "attachment",
        filename=pdf_filename,
    )
    msg.attach(pdf_part)

    recipients = [to_email_clean] + cc_list

    # 5. Envoi SMTP
    try:
        if smtp["use_ssl"]:
            with smtplib.SMTP_SSL(smtp["host"], smtp["port"], timeout=30) as server:
                server.login(smtp["user"], smtp["password"])
                server.sendmail(smtp["user"], recipients, msg.as_string())
        else:
            with smtplib.SMTP(smtp["host"], smtp["port"], timeout=30) as server:
                server.starttls()
                server.login(smtp["user"], smtp["password"])
                server.sendmail(smtp["user"], recipients, msg.as_string())
    except smtplib.SMTPException as e:
        err_type = type(e).__name__
        logger.error(f"[EMAIL] SMTP failure {doc_type}/{doc_id} -> {to_email_clean}: {err_type}")
        db.log_document_email(
            tenant_schema=ctx.tenant_schema,
            employee_id=ctx.employee_id,
            doc_type=doc_type, doc_id=doc_id,
            to_email=to_email_clean, cc_emails=cc_list,
            subject=subject, status="failed",
            error_detail=f"SMTP {err_type}",
            pdf_size_bytes=pdf_size,
        )
        raise HTTPException(
            status_code=502,
            detail=f"Echec d'envoi courriel ({err_type})",
        )
    except Exception as e:
        err_type = type(e).__name__
        logger.exception(f"[EMAIL] Erreur reseau {doc_type}/{doc_id}: {e}")
        db.log_document_email(
            tenant_schema=ctx.tenant_schema,
            employee_id=ctx.employee_id,
            doc_type=doc_type, doc_id=doc_id,
            to_email=to_email_clean, cc_emails=cc_list,
            subject=subject, status="failed",
            error_detail=f"Network {err_type}",
            pdf_size_bytes=pdf_size,
        )
        raise HTTPException(status_code=502, detail="Erreur reseau lors de l'envoi")

    # 6. Succes : audit + reponse
    message_id = msg["Message-ID"]
    sent_at = datetime.now(timezone.utc)
    db.log_document_email(
        tenant_schema=ctx.tenant_schema,
        employee_id=ctx.employee_id,
        doc_type=doc_type, doc_id=doc_id,
        to_email=to_email_clean, cc_emails=cc_list,
        subject=subject, status="sent",
        message_id=message_id, pdf_size_bytes=pdf_size,
    )
    # Audit log polymorphique : Loi 25 / GDPR (qui a envoye quoi a qui)
    _ip, _ua = _extract_request_forensics(request)
    db.log_audit_event(
        tenant_schema=ctx.tenant_schema,
        employee_id=ctx.employee_id,
        action='email_sent',
        entity_type=doc_type,
        entity_id=doc_id,
        entity_label=numero,
        after={
            'to': to_email_clean,
            'cc': cc_list,
            'subject': subject,
            'pdf_size_bytes': pdf_size,
            'message_id': message_id,
        },
        ip=_ip, ua=_ua,
    )
    logger.info(
        f"[EMAIL] {doc_type}/{doc_id} envoye a {to_email_clean} "
        f"(cc={len(cc_list)}, pdf={pdf_size}B)"
    )

    return DocumentEmailResponse(
        sent=True,
        message_id=message_id,
        to_email=to_email_clean,
        cc=cc_list,
        sent_at=sent_at,
        pdf_size_bytes=pdf_size,
    )


# ===== RELANCES FACTURES IMPAYEES (Phase 4B) =====
#
# Use case : le systeme identifie les factures non payees depassant leur date
# d'echeance, les groupe par aging buckets (J30/J60/J90/J90+), et envoie un email
# de relance au client avec PDF en piece jointe. Manuel via bouton OU automatique
# (cron quotidien 09h heure Montreal recommande ; non implemente cote serveur).
#
# Templates emails adaptes par bucket :
#  - J30  : ton courtois (rappel amical)
#  - J60  : ton ferme (deuxieme rappel important)
#  - J90  : ton urgent (mention recouvrement eventuel)
#  - J90+ : ton tres urgent (notification finale avant recouvrement)


# Mapping bucket -> sujet + corps de courriel. tenant_nom et numero sont
# interpolees au moment de l'envoi. Pas d'emojis (style courriels Constructo).
def _build_reminder_subject(bucket: str, numero: str, days: int) -> str:
    """Sujet adapte au bucket. days est inclus pour donner du contexte au client."""
    if bucket == 'J30':
        return f"Rappel : facture {numero} en retard ({days} jours)"
    if bucket == 'J60':
        return f"Important : facture {numero} non reglee depuis {days} jours"
    if bucket == 'J90':
        return f"URGENT : facture {numero} non reglee depuis plus de 90 jours"
    # J90+
    return f"NOTIFICATION FINALE : facture {numero} en retard de {days} jours"


def _build_reminder_body(
    bucket: str, numero: str, days: int, solde_du: float,
    date_echeance: str, tenant_nom: str, client_nom: str,
) -> str:
    """Corps texte adapte au bucket. Pas d'emojis, ton francais Quebec."""
    salutation = f"Bonjour {client_nom}," if client_nom else "Bonjour,"
    montant_fmt = f"{solde_du:,.2f}".replace(',', ' ').replace('.', ',') + " $"
    signature = (
        f"\n\nCordialement,\n{tenant_nom}\n"
        f"-- Message genere automatiquement par Constructo AI --\n"
    )

    if bucket == 'J30':
        return (
            f"{salutation}\n\n"
            f"Nous nous permettons de vous rappeler que la facture {numero}, "
            f"d'un montant de {montant_fmt}, etait due le {date_echeance} "
            f"(soit il y a {days} jours).\n\n"
            f"Si le paiement a deja ete effectue, veuillez ignorer ce courriel. "
            f"Dans le cas contraire, nous vous remercions de bien vouloir "
            f"regulariser votre situation des que possible.\n\n"
            f"Vous trouverez la facture en piece jointe pour reference."
            + signature
        )

    if bucket == 'J60':
        return (
            f"{salutation}\n\n"
            f"Malgre notre precedent rappel, la facture {numero} d'un montant "
            f"de {montant_fmt} demeure impayee. Elle etait due le "
            f"{date_echeance}, soit il y a {days} jours.\n\n"
            f"Nous vous demandons de proceder au reglement dans les meilleurs "
            f"delais. Si vous rencontrez des difficultes de paiement ou si vous "
            f"avez deja effectue le reglement, veuillez nous contacter rapidement "
            f"pour clarifier la situation.\n\n"
            f"La facture est jointe a ce courriel."
            + signature
        )

    if bucket == 'J90':
        return (
            f"{salutation}\n\n"
            f"La facture {numero} d'un montant de {montant_fmt} est impayee "
            f"depuis plus de 90 jours (echeance : {date_echeance}, retard : "
            f"{days} jours).\n\n"
            f"Sans reglement rapide de votre part, nous serons contraints "
            f"d'engager les demarches de recouvrement. Cela engendrera des "
            f"frais supplementaires et pourra affecter votre dossier de credit.\n\n"
            f"Nous vous prions de proceder au paiement immediatement ou de "
            f"nous contacter pour convenir d'un arrangement.\n\n"
            f"La facture est jointe a ce courriel."
            + signature
        )

    # J90+
    return (
        f"{salutation}\n\n"
        f"Ceci constitue notre derniere notification avant transfert au "
        f"recouvrement. La facture {numero} d'un montant de {montant_fmt} "
        f"est impayee depuis {days} jours (echeance : {date_echeance}).\n\n"
        f"Sans reglement integral sous 7 jours, votre dossier sera transmis "
        f"a notre service de recouvrement avec les frais et interets "
        f"applicables. Cette procedure peut affecter votre dossier de credit "
        f"et entrainer des poursuites judiciaires.\n\n"
        f"Pour eviter cette procedure, nous vous invitons a nous contacter "
        f"immediatement ou a regler la facture jointe sans delai."
        + signature
    )


@router.get("/factures/overdue", response_model=OverdueResponse)
async def list_overdue_factures(
    bucket: Optional[str] = Query(None, description="Filtre par bucket : J30 | J60 | J90 | J90+"),
    ctx: MobileTenantContext = Depends(require_role("ADMIN", "MANAGER")),
):
    """Retourne les factures en retard groupees par aging bucket.

    Si bucket est fourni, ne retourne que ce bucket. Sinon, retourne les 4 buckets
    avec leurs aggregats (count + total_solde_du) et la liste de factures.

    Reserve aux roles ADMIN et MANAGER (l'employe lambda ne doit pas voir les
    impayes du tenant). Les BROUILLON sont exclus (non envoyes au client).
    """
    if bucket and bucket not in VALID_REMINDER_BUCKETS:
        raise HTTPException(
            status_code=400,
            detail=f"Bucket invalide '{bucket}'. Valides : {sorted(VALID_REMINDER_BUCKETS)}",
        )

    factures = db.get_overdue_factures(ctx.tenant_schema, bucket=bucket)

    # Aggregation par bucket. On respecte l'ordre J30 -> J90+.
    buckets_order = ['J30', 'J60', 'J90', 'J90+']
    buckets_map: dict = {b: {'count': 0, 'total_solde_du': 0.0, 'factures': []} for b in buckets_order}

    for f in factures:
        b = f['bucket']
        if b not in buckets_map:
            continue
        buckets_map[b]['count'] += 1
        buckets_map[b]['total_solde_du'] += float(f.get('solde_du') or 0)
        buckets_map[b]['factures'].append(OverdueFacture(
            id=f['id'],
            numero=f.get('numero') or '',
            client_nom=f.get('client_nom') or '',
            client_email=f.get('client_email'),
            montant_total=float(f.get('montant_total') or 0),
            solde_du=float(f.get('solde_du') or 0),
            date_echeance=f.get('date_echeance'),
            days_overdue=int(f.get('days_overdue') or 0),
            bucket=b,
        ))

    # Si un bucket precis est demande, on filtre les autres
    if bucket:
        buckets_list = [
            OverdueBucketSummary(
                bucket=bucket,
                count=buckets_map[bucket]['count'],
                total_solde_du=round(buckets_map[bucket]['total_solde_du'], 2),
                factures=buckets_map[bucket]['factures'],
            )
        ]
    else:
        buckets_list = [
            OverdueBucketSummary(
                bucket=b,
                count=buckets_map[b]['count'],
                total_solde_du=round(buckets_map[b]['total_solde_du'], 2),
                factures=buckets_map[b]['factures'],
            )
            for b in buckets_order
        ]

    total_count = sum(b.count for b in buckets_list)
    total_amount = round(sum(b.total_solde_du for b in buckets_list), 2)

    return OverdueResponse(
        total_count=total_count,
        total_amount=total_amount,
        buckets=buckets_list,
    )


@router.post(
    "/factures/send-reminders",
    response_model=RemindersSendResponse,
)
async def send_factures_reminders(
    body: RemindersSendRequest,
    ctx: MobileTenantContext = Depends(require_role("ADMIN", "MANAGER")),
):
    """Envoie des emails de relance pour les factures en retard.

    Workflow :
      1. Charger les factures overdue (filtre buckets si fourni).
      2. Pour chaque facture :
         a) Si dry_run, log et continue sans envoi.
         b) Sinon, recuperer le client email (ou test_email si fourni).
         c) Generer le PDF de la facture (reutilise mobile_pdf_service).
         d) Construire le sujet + corps adaptes au bucket.
         e) Envoyer via SMTP (memes credentials que /documents/{type}/{id}/email).
         f) Logger dans factures_reminders_log (audit).
      3. Retourner les compteurs + details par facture.

    Performances : traite en sync (1 SMTP par facture). Si > 50 factures,
    envisager batch / background task. Le timeout HTTP est etendu cote
    proxy (Render) pour les gros volumes.

    Erreurs:
      - 400 buckets invalides
      - 403 role insuffisant (require_role ADMIN/MANAGER)
      - 502 si SMTP non configure (sauf en dry_run)
    """
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.mime.application import MIMEApplication
    from email.utils import formataddr, formatdate, make_msgid

    # 1. Recuperer les factures overdue (toutes ou filtrees par buckets)
    buckets_filter = body.buckets
    if buckets_filter:
        factures_overdue: list[dict] = []
        for b in buckets_filter:
            factures_overdue.extend(db.get_overdue_factures(ctx.tenant_schema, bucket=b))
    else:
        factures_overdue = db.get_overdue_factures(ctx.tenant_schema, bucket=None)

    if not factures_overdue:
        return RemindersSendResponse(
            sent_count=0, failed_count=0, skipped_count=0,
            dry_run=body.dry_run, total_processed=0, details=[],
        )

    # 2. Verifier SMTP si pas dry_run
    smtp = _get_smtp_config()
    if not body.dry_run:
        if not smtp["host"] or not smtp["user"] or not smtp["password"]:
            logger.warning(
                f"[REMINDERS] SMTP non configure pour tenant {ctx.tenant_schema}"
            )
            raise HTTPException(
                status_code=502,
                detail="Serveur courriel non configure (SMTP env vars manquants)",
            )

    tenant_info = db.get_tenant_info_by_schema(ctx.tenant_schema)
    tenant_nom = (tenant_info or {}).get("nom") if tenant_info else "Constructo AI"
    tenant_nom = tenant_nom or "Constructo AI"

    test_email_clean = str(body.test_email).strip() if body.test_email else None

    sent_count = 0
    failed_count = 0
    skipped_count = 0
    details: list[ReminderDetailItem] = []

    # 3. Traiter chaque facture
    for f in factures_overdue:
        fid = int(f['id'])
        numero = str(f.get('numero') or f"#{fid}")
        bucket = str(f.get('bucket') or 'J30')
        days = int(f.get('days_overdue') or 0)
        client_email = f.get('client_email')
        client_nom = str(f.get('client_nom') or '')
        solde_du = float(f.get('solde_du') or 0)
        date_echeance = str(f.get('date_echeance') or '')

        # Resolution destinataire : test_email override > client_email
        recipient = test_email_clean if test_email_clean else client_email

        # Cas skipped : pas d'email client et pas de test_email
        if not recipient:
            skipped_count += 1
            db.log_facture_reminder(
                tenant_schema=ctx.tenant_schema, facture_id=fid, numero=numero,
                bucket=bucket, days_overdue=days, to_email=None,
                status='skipped', error_detail='client_email absent',
                triggered_by_employee_id=ctx.employee_id, is_dry_run=body.dry_run,
            )
            details.append(ReminderDetailItem(
                facture_id=fid, numero=numero, bucket=bucket,
                client_email=client_email, sent_to=None, status='skipped',
                error='Email client absent',
            ))
            continue

        # Cas dry_run : log + detail sans envoi
        if body.dry_run:
            db.log_facture_reminder(
                tenant_schema=ctx.tenant_schema, facture_id=fid, numero=numero,
                bucket=bucket, days_overdue=days, to_email=recipient,
                status='dry_run', triggered_by_employee_id=ctx.employee_id,
                is_dry_run=True,
            )
            details.append(ReminderDetailItem(
                facture_id=fid, numero=numero, bucket=bucket,
                client_email=client_email, sent_to=recipient, status='dry_run',
            ))
            continue

        # Cas envoi reel : generer PDF + email + SMTP
        try:
            data = db.get_document_for_pdf(ctx.tenant_schema, 'factures', fid)
            if not data:
                raise RuntimeError("facture introuvable pour PDF")
            from . import mobile_pdf_service as pdf_svc
            pdf_bytes = pdf_svc.generate_document_pdf(data)
            pdf_filename = pdf_svc.safe_filename('Facture', numero)
        except RuntimeError as exc:
            err = f"PDF unavailable: {type(exc).__name__}"
            logger.error(f"[REMINDERS] {err} facture={fid}")
            failed_count += 1
            db.log_facture_reminder(
                tenant_schema=ctx.tenant_schema, facture_id=fid, numero=numero,
                bucket=bucket, days_overdue=days, to_email=recipient,
                status='failed', error_detail=err,
                triggered_by_employee_id=ctx.employee_id, is_dry_run=False,
            )
            details.append(ReminderDetailItem(
                facture_id=fid, numero=numero, bucket=bucket,
                client_email=client_email, sent_to=recipient, status='failed',
                error=err,
            ))
            continue
        except Exception as exc:
            err = f"PDF error: {type(exc).__name__}"
            logger.exception(f"[REMINDERS] PDF facture={fid}: {exc}")
            failed_count += 1
            db.log_facture_reminder(
                tenant_schema=ctx.tenant_schema, facture_id=fid, numero=numero,
                bucket=bucket, days_overdue=days, to_email=recipient,
                status='failed', error_detail=err,
                triggered_by_employee_id=ctx.employee_id, is_dry_run=False,
            )
            details.append(ReminderDetailItem(
                facture_id=fid, numero=numero, bucket=bucket,
                client_email=client_email, sent_to=recipient, status='failed',
                error=err,
            ))
            continue

        # Construction MIME
        subject = _build_reminder_subject(bucket, numero, days)
        text_body = _build_reminder_body(
            bucket=bucket, numero=numero, days=days, solde_du=solde_du,
            date_echeance=date_echeance, tenant_nom=tenant_nom,
            client_nom=client_nom,
        )

        # Defense en profondeur CRLF (recipient vient de la DB ou test_email
        # valide par Pydantic, mais on re-verifie le sujet construit)
        if '\r' in subject or '\n' in subject:
            err = "CRLF dans subject"
            failed_count += 1
            db.log_facture_reminder(
                tenant_schema=ctx.tenant_schema, facture_id=fid, numero=numero,
                bucket=bucket, days_overdue=days, to_email=recipient,
                status='failed', error_detail=err,
                triggered_by_employee_id=ctx.employee_id, is_dry_run=False,
            )
            details.append(ReminderDetailItem(
                facture_id=fid, numero=numero, bucket=bucket,
                client_email=client_email, sent_to=recipient, status='failed',
                error=err,
            ))
            continue

        msg = MIMEMultipart("mixed")
        display_from = smtp["from_email"] or smtp["user"]
        msg["From"] = formataddr((smtp["from_name"], display_from))
        msg["To"] = recipient
        msg["Subject"] = subject
        msg["Date"] = formatdate(localtime=True)
        msg["Reply-To"] = display_from
        msg["Message-ID"] = make_msgid()
        msg.attach(MIMEText(text_body, "plain", "utf-8"))

        pdf_part = MIMEApplication(pdf_bytes, _subtype="pdf")
        pdf_part.add_header(
            "Content-Disposition", "attachment", filename=pdf_filename,
        )
        msg.attach(pdf_part)

        # Envoi SMTP (timeout 30s par envoi, peut totaliser plusieurs minutes
        # sur gros volumes — Render proxy timeout 5 min de base)
        try:
            if smtp["use_ssl"]:
                with smtplib.SMTP_SSL(smtp["host"], smtp["port"], timeout=30) as server:
                    server.login(smtp["user"], smtp["password"])
                    server.sendmail(smtp["user"], [recipient], msg.as_string())
            else:
                with smtplib.SMTP(smtp["host"], smtp["port"], timeout=30) as server:
                    server.starttls()
                    server.login(smtp["user"], smtp["password"])
                    server.sendmail(smtp["user"], [recipient], msg.as_string())
        except smtplib.SMTPException as exc:
            err = f"SMTP {type(exc).__name__}"
            logger.error(f"[REMINDERS] {err} facture={fid} -> {recipient}")
            failed_count += 1
            db.log_facture_reminder(
                tenant_schema=ctx.tenant_schema, facture_id=fid, numero=numero,
                bucket=bucket, days_overdue=days, to_email=recipient,
                status='failed', error_detail=err,
                triggered_by_employee_id=ctx.employee_id, is_dry_run=False,
            )
            details.append(ReminderDetailItem(
                facture_id=fid, numero=numero, bucket=bucket,
                client_email=client_email, sent_to=recipient, status='failed',
                error=err,
            ))
            continue
        except Exception as exc:
            err = f"Network {type(exc).__name__}"
            logger.exception(f"[REMINDERS] {err} facture={fid}: {exc}")
            failed_count += 1
            db.log_facture_reminder(
                tenant_schema=ctx.tenant_schema, facture_id=fid, numero=numero,
                bucket=bucket, days_overdue=days, to_email=recipient,
                status='failed', error_detail=err,
                triggered_by_employee_id=ctx.employee_id, is_dry_run=False,
            )
            details.append(ReminderDetailItem(
                facture_id=fid, numero=numero, bucket=bucket,
                client_email=client_email, sent_to=recipient, status='failed',
                error=err,
            ))
            continue

        # Succes
        sent_count += 1
        db.log_facture_reminder(
            tenant_schema=ctx.tenant_schema, facture_id=fid, numero=numero,
            bucket=bucket, days_overdue=days, to_email=recipient,
            status='sent', triggered_by_employee_id=ctx.employee_id,
            is_dry_run=False,
        )
        details.append(ReminderDetailItem(
            facture_id=fid, numero=numero, bucket=bucket,
            client_email=client_email, sent_to=recipient, status='sent',
        ))

    logger.info(
        f"[REMINDERS] tenant={ctx.tenant_schema} sent={sent_count} "
        f"failed={failed_count} skipped={skipped_count} dry_run={body.dry_run}"
    )

    return RemindersSendResponse(
        sent_count=sent_count,
        failed_count=failed_count,
        skipped_count=skipped_count,
        dry_run=body.dry_run,
        total_processed=len(factures_overdue),
        details=details,
    )


# ===== FACTURES RECURRENTES (Phase 5C) =====
#
# Workflow type :
#   1. Comptable cree une facture template (FAC-2026-001, $1500/mois).
#   2. POST /factures/{id}/recurrent { frequency: 'monthly', start_date: 2026-06-01 }.
#   3. Le serveur stocke une config dans mobile_recurrent_invoices_config.
#   4. POST /factures/recurrent/run (cron ou manuel) :
#         - pour chaque config due, duplique la facture source via duplicate_document.
#         - avance next_run_at d'une periode.
#
# Limitation actuelle : pas de cron automatique. Le endpoint /run doit etre
# appele manuellement (ou via un cron Render quotidien futur).


def _recurrent_config_to_response(config: dict) -> "RecurrentInvoiceConfigResponse":
    """Convertit un dict DB en RecurrentInvoiceConfigResponse Pydantic."""
    return RecurrentInvoiceConfigResponse(
        id=int(config["id"]),
        source_facture_id=int(config["source_facture_id"]),
        source_numero=config.get("source_numero"),
        source_client_nom=config.get("source_client_nom"),
        source_montant_total=config.get("source_montant_total"),
        client_company_id=config.get("client_company_id"),
        frequency=config["frequency"],
        next_run_at=config["next_run_at"],
        last_run_at=config.get("last_run_at"),
        runs_count=int(config.get("runs_count") or 0),
        active=bool(config.get("active", True)),
        description=config.get("description"),
        created_by=config.get("created_by"),
        created_at=config.get("created_at"),
    )


@router.post(
    "/factures/{facture_id}/recurrent",
    response_model=RecurrentInvoiceConfigResponse,
    status_code=201,
)
async def create_recurrent_invoice_endpoint(
    facture_id: int,
    body: RecurrentInvoiceCreateRequest,
    ctx: MobileTenantContext = Depends(require_role("ADMIN", "MANAGER")),
):
    """Marque une facture comme template recurrent.

    La facture source ne change pas. Une config est stockee dans la table
    publique mobile_recurrent_invoices_config. A chaque appel de /recurrent/run,
    le systeme genere une nouvelle facture (duplicate_document Phase 5A) et
    avance next_run_at d'une periode.
    """
    try:
        config = db.create_recurrent_invoice_config(
            tenant_schema=ctx.tenant_schema,
            source_facture_id=facture_id,
            frequency=body.frequency,
            description=body.description,
            start_date=body.start_date,
            created_by=ctx.employee_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not config:
        raise HTTPException(status_code=404, detail="Facture source non trouvee")

    logger.info(
        "[RECURRENT] tenant=%s facture_id=%s frequency=%s next_run_at=%s created_by=%s",
        ctx.tenant_schema, facture_id, body.frequency,
        config.get("next_run_at"), ctx.employee_id,
    )
    return _recurrent_config_to_response(config)


@router.get(
    "/factures/recurrent",
    response_model=list[RecurrentInvoiceConfigResponse],
)
async def list_recurrent_invoices_endpoint(
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Liste toutes les configs de factures recurrentes pour le tenant courant."""
    configs = db.list_recurrent_invoice_configs(ctx.tenant_schema)
    return [_recurrent_config_to_response(c) for c in configs]


@router.post(
    "/factures/recurrent/run",
    response_model=RecurrentRunResponse,
)
async def run_recurrent_invoices_endpoint(
    body: Optional[RecurrentRunRequest] = None,
    ctx: MobileTenantContext = Depends(require_role("ADMIN")),
):
    """Genere les factures dues (next_run_at <= NOW()).

    Restreint au tenant courant pour ce endpoint manuel. Un cron global futur
    pourrait appeler db.list_due_recurrent_invoice_configs() sans filtre.

    Si dry_run=True, ne cree aucune facture et ne met pas a jour les configs.
    """
    dry_run = bool(body.dry_run) if body else False
    due_configs = db.list_due_recurrent_invoice_configs(ctx.tenant_schema)

    items: list[RecurrentRunItem] = []
    created_ids: list[int] = []

    for cfg in due_configs:
        config_id = int(cfg["id"])
        source_id = int(cfg["source_facture_id"])
        frequency = cfg["frequency"]
        current_next_run = cfg["next_run_at"]

        if dry_run:
            # Simulation : on calcule le nouveau next_run_at mais on ne touche rien
            try:
                simulated_next = db._compute_next_run(current_next_run, frequency)
            except Exception as e:
                items.append(RecurrentRunItem(
                    config_id=config_id,
                    source_facture_id=source_id,
                    status='failed',
                    error=f"Calcul next_run impossible: {e}",
                ))
                continue
            items.append(RecurrentRunItem(
                config_id=config_id,
                source_facture_id=source_id,
                status='dry_run',
                next_run_at=simulated_next,
            ))
            continue

        # Reel : dupliquer la facture source via Phase 5A
        try:
            new_doc = db.duplicate_document(
                ctx.tenant_schema, "factures", source_id,
            )
        except Exception as e:
            logger.error(
                "[RECURRENT] duplicate_document failed cfg=%s src=%s: %s",
                config_id, source_id, e,
            )
            items.append(RecurrentRunItem(
                config_id=config_id,
                source_facture_id=source_id,
                status='failed',
                error=f"Duplication facture echouee: {e}",
            ))
            continue

        if not new_doc:
            items.append(RecurrentRunItem(
                config_id=config_id,
                source_facture_id=source_id,
                status='failed',
                error="Facture source introuvable ou duplication retournee vide",
            ))
            continue

        # Avancer next_run_at d'une periode
        try:
            new_next_run = db._compute_next_run(current_next_run, frequency)
        except Exception as e:
            logger.error(
                "[RECURRENT] _compute_next_run failed cfg=%s freq=%s: %s",
                config_id, frequency, e,
            )
            # On a deja cree la facture - on log mais on n'avance pas next_run_at
            items.append(RecurrentRunItem(
                config_id=config_id,
                source_facture_id=source_id,
                status='failed',
                new_facture_id=int(new_doc.get("id") or 0) or None,
                new_numero=new_doc.get("numero"),
                error=f"Facture creee mais avancement next_run_at echoue: {e}",
            ))
            continue

        db.mark_recurrent_invoice_config_run(config_id, new_next_run)

        new_fid = int(new_doc.get("id") or 0)
        if new_fid:
            created_ids.append(new_fid)
        items.append(RecurrentRunItem(
            config_id=config_id,
            source_facture_id=source_id,
            status='created',
            new_facture_id=new_fid or None,
            new_numero=new_doc.get("numero"),
            next_run_at=new_next_run,
        ))

    logger.info(
        "[RECURRENT] tenant=%s processed=%s created=%s dry_run=%s",
        ctx.tenant_schema, len(due_configs), len(created_ids), dry_run,
    )

    return RecurrentRunResponse(
        processed=len(due_configs),
        created_facture_ids=created_ids,
        dry_run=dry_run,
        items=items,
    )


@router.post(
    "/factures/recurrent/{config_id}/toggle",
    response_model=RecurrentInvoiceConfigResponse,
)
async def toggle_recurrent_invoice_endpoint(
    config_id: int,
    ctx: MobileTenantContext = Depends(require_role("ADMIN", "MANAGER")),
):
    """Toggle active=NOT active. Permet de mettre en pause / reactiver."""
    config = db.toggle_recurrent_invoice_config(ctx.tenant_schema, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Config recurrente non trouvee")

    # Joindre la meta facture pour la response (toggle ne fait pas le JOIN)
    enriched = db.list_recurrent_invoice_configs(ctx.tenant_schema)
    for c in enriched:
        if int(c["id"]) == int(config_id):
            return _recurrent_config_to_response(c)
    return _recurrent_config_to_response(config)


@router.delete("/factures/recurrent/{config_id}")
async def delete_recurrent_invoice_endpoint(
    config_id: int,
    ctx: MobileTenantContext = Depends(require_role("ADMIN", "MANAGER")),
):
    """Hard delete d'une config recurrente.

    La facture source et les factures deja generees ne sont pas touchees.
    """
    deleted = db.delete_recurrent_invoice_config(ctx.tenant_schema, config_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Config recurrente non trouvee")
    return {"success": True, "message": "Config recurrente supprimee"}


# ===== SIGNATURE ELECTRONIQUE DEVIS / FACTURES =====

SIGNABLE_DOC_TYPES = {"devis", "factures"}


def _validate_signable_doc_type(doc_type: str):
    if doc_type not in SIGNABLE_DOC_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Type de document non signable: {doc_type}. Valides: {', '.join(SIGNABLE_DOC_TYPES)}",
        )


@router.get("/documents/{doc_type}/{doc_id}/signature")
async def get_document_signature_endpoint(
    doc_type: str,
    doc_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Retourne l etat de signature d un devis ou d une facture.

    Reponse :
        { signed: bool, signataire_nom: str|None,
          signed_at: str|None, signature_data_url: str|None }
    signature_data_url est un data URL pret a injecter dans <img src=...>.
    """
    _validate_signable_doc_type(doc_type)
    result = db.get_document_signature(ctx.tenant_schema, doc_type, doc_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Document non trouve")
    return result


@router.post("/documents/{doc_type}/{doc_id}/signature")
async def submit_document_signature(
    doc_type: str,
    doc_id: int,
    body: SignatureExterneRequest,
    request: Request,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Enregistre la signature tactile du client/superviseur sur un devis ou une
    facture. Le commercial presente son telephone au client qui signe directement
    sur l ecran sans avoir besoin de creer un compte Constructo AI.

    Si le document est deja signe, retourne 409 (les signatures sont immuables).
    """
    _validate_signable_doc_type(doc_type)
    status = db.save_document_signature(
        ctx.tenant_schema,
        doc_type,
        doc_id,
        body.signature_base64,
        body.signataire_nom,
    )
    if status == 'ok':
        signed_at = datetime.now(timezone.utc).isoformat()
        # Audit log : signature client (Loi 25 + valeur juridique du signataire externe)
        _ip, _ua = _extract_request_forensics(request)
        db.log_audit_event(
            tenant_schema=ctx.tenant_schema,
            employee_id=ctx.employee_id,
            action='sign',
            entity_type=doc_type,
            entity_id=doc_id,
            entity_label=None,
            after={
                'signataire_nom': body.signataire_nom,
                'signed_at': signed_at,
            },
            ip=_ip, ua=_ua,
        )
        return {
            "signed": True,
            "signed_at": signed_at,
        }
    if status == 'not_found':
        raise HTTPException(status_code=404, detail="Document non trouve")
    if status == 'already_signed':
        raise HTTPException(status_code=409, detail="Document deja signe")
    if status == 'invalid_type':
        raise HTTPException(status_code=400, detail="Type de document non signable")
    raise HTTPException(status_code=500, detail="Erreur lors de l enregistrement de la signature")


# ===== STRIPE PAYMENT LINKS (Phase 3C) =====

def _init_stripe_sdk():
    """Initialise le SDK Stripe avec la cle API. Retourne le module ou None."""
    try:
        import stripe as _stripe
    except ImportError:
        logger.warning("[STRIPE] SDK non installe — payment links indisponibles")
        return None

    secret_key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not secret_key:
        logger.warning("[STRIPE] STRIPE_SECRET_KEY non defini")
        return None

    _stripe.api_key = secret_key
    _stripe.api_version = "2023-10-16"
    return _stripe


@router.post("/documents/factures/{facture_id}/payment-link", response_model=PaymentLinkResponse)
async def create_facture_payment_link(
    facture_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Genere (ou recupere) un lien de paiement Stripe pour une facture.

    Cree un Product + Price + PaymentLink en mode one-time CAD. Stocke
    l'URL en DB (factures.stripe_payment_link_url). Si un lien existe deja
    pour cette facture, retourne le lien cache (pas de nouveau Stripe call).

    Le webhook checkout.session.completed marquera la facture PAYEE.
    """
    # 1. Recuperer la facture
    facture = db.get_facture_for_payment(ctx.tenant_schema, facture_id)
    if not facture:
        raise HTTPException(status_code=404, detail="Facture non trouvee")

    montant_ttc = float(facture["montant_ttc"] or 0)
    if montant_ttc <= 0:
        raise HTTPException(
            status_code=400,
            detail="Montant total de la facture invalide (<=0)",
        )

    # 2. Retourner le lien cache si deja genere
    existing_url = facture.get("stripe_payment_link_url")
    if existing_url:
        return PaymentLinkResponse(
            url=existing_url,
            expires_at=None,
            montant_ttc=montant_ttc,
            cached=True,
        )

    # 3. Initialiser Stripe
    stripe = _init_stripe_sdk()
    if stripe is None:
        raise HTTPException(
            status_code=503,
            detail="Service Stripe indisponible (cle API non configuree)",
        )

    # 4. Creer Product + Price + PaymentLink
    try:
        numero = facture.get("numero") or f"#{facture_id}"
        client_nom = facture.get("client_nom") or ""
        product_name = f"Facture {numero}"
        if client_nom:
            product_name += f" - {client_nom}"

        product = stripe.Product.create(
            name=product_name[:250],  # Stripe limite 250 chars
            metadata={
                "facture_id": str(facture_id),
                "tenant_schema": ctx.tenant_schema,
                "numero": numero,
            },
        )

        price = stripe.Price.create(
            product=product.id,
            unit_amount=int(round(montant_ttc * 100)),  # cents CAD
            currency="cad",
        )

        payment_link = stripe.PaymentLink.create(
            line_items=[{"price": price.id, "quantity": 1}],
            metadata={
                "facture_id": str(facture_id),
                "tenant_schema": ctx.tenant_schema,
                "numero": numero,
            },
            allow_promotion_codes=False,
            phone_number_collection={"enabled": True},
        )

        url = payment_link.url
        link_id = payment_link.id

        # 5. Persister en DB
        saved = db.save_facture_payment_link(
            ctx.tenant_schema, facture_id, url, link_id
        )
        if not saved:
            logger.warning(
                "[STRIPE] Lien cree mais persistance DB echouee facture=%s", facture_id
            )

        logger.info(
            "[STRIPE] PaymentLink cree facture=%s schema=%s montant=%.2f link=%s",
            facture_id, ctx.tenant_schema, montant_ttc, link_id,
        )

        return PaymentLinkResponse(
            url=url,
            expires_at=None,
            montant_ttc=montant_ttc,
            cached=False,
        )

    except Exception as exc:
        logger.exception(
            "[STRIPE] Echec creation PaymentLink facture=%s: %s", facture_id, exc
        )
        raise HTTPException(
            status_code=502,
            detail=f"Erreur Stripe: {str(exc)[:200]}",
        )


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """Webhook Stripe : marque la facture PAYEE quand checkout.session.completed.

    Verifie la signature avec STRIPE_WEBHOOK_SECRET. Identifie la facture
    via metadata.facture_id (mis sur PaymentLink lors de la creation).

    Retourne 200 dans tous les cas (Stripe re-essaie si != 2xx).
    """
    stripe = _init_stripe_sdk()
    if stripe is None:
        # Sans SDK, impossible de verifier la signature Stripe -> bloquer 503
        logger.error("[STRIPE] SDK indisponible — webhook bloque")
        raise HTTPException(status_code=503, detail="Stripe SDK indisponible")

    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    if not webhook_secret:
        # CRITIQUE: sans secret on ne peut PAS verifier que le payload vient
        # de Stripe. Retourner 503 pour bloquer toute exploitation par un
        # attacker qui pourrait spammer fake checkout.session.completed.
        logger.error("[STRIPE] STRIPE_WEBHOOK_SECRET non defini — webhook bloque (config requise)")
        raise HTTPException(status_code=503, detail="Stripe webhook non configure")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except ValueError:
        logger.warning("[STRIPE] Webhook: payload JSON invalide")
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:
        logger.warning("[STRIPE] Webhook: signature invalide")
        raise HTTPException(status_code=400, detail="Invalid signature")
    except Exception as exc:
        logger.error(f"[STRIPE] Webhook construct_event error: {exc}")
        raise HTTPException(status_code=400, detail="Webhook error")

    event_type = event.get("type", "")

    if event_type != "checkout.session.completed":
        # On ne traite que les paiements completes ; les autres events sont
        # ignores mais loggue pour audit Stripe (diagnostic webhook dysfonctionnel)
        logger.info("[STRIPE] Webhook event_type=%s ignored (only checkout.session.completed handled)", event_type)
        return {"received": True, "ignored": event_type}

    session = event["data"]["object"]
    metadata = session.get("metadata") or {}

    facture_id_str = metadata.get("facture_id")
    tenant_schema = metadata.get("tenant_schema")

    if not facture_id_str:
        # Metadata absente : peut etre un checkout non-facture (ex. subscription ERP)
        logger.info(
            "[STRIPE] Webhook checkout.session.completed sans facture_id (event=%s)",
            event.get("id"),
        )
        return {"received": True, "skipped": "no_facture_id"}

    try:
        facture_id = int(facture_id_str)
    except (ValueError, TypeError):
        logger.warning(f"[STRIPE] Webhook facture_id invalide: {facture_id_str}")
        return {"received": True, "error": "invalid_facture_id"}

    # Fallback : si pas de tenant_schema en metadata, on cherche
    if not tenant_schema:
        tenant_schema = db.find_tenant_schema_by_facture(facture_id)
        if not tenant_schema:
            logger.warning(
                "[STRIPE] Webhook : tenant introuvable pour facture=%s", facture_id
            )
            return {"received": True, "error": "tenant_not_found"}

    amount_total = int(session.get("amount_total") or 0)
    updated = db.mark_facture_paid_by_stripe(tenant_schema, facture_id, amount_total)

    # Audit log : trace les paiements recus via Stripe (employee_id=None car
    # action systeme / webhook automatique declenche par Stripe, pas par un user)
    if updated:
        try:
            _ip, _ua = _extract_request_forensics(request)
        except Exception:
            _ip, _ua = None, None
        currency = (session.get("currency") or "").upper()
        amount_decimal = round(amount_total / 100.0, 2) if amount_total else 0.0
        db.log_audit_event(
            tenant_schema=tenant_schema,
            employee_id=None,  # Action systeme : webhook Stripe
            action='payment_received',
            entity_type='facture',
            entity_id=facture_id,
            entity_label=metadata.get('numero'),
            after={
                'amount': amount_decimal,
                'currency': currency or 'CAD',
                'stripe_session_id': session.get('id'),
                'customer_email': session.get('customer_details', {}).get('email') if isinstance(session.get('customer_details'), dict) else None,
            },
            ip=_ip, ua=_ua,
            metadata={'stripe_event_id': event.get('id')},
        )

    return {"received": True, "facture_id": facture_id, "updated": updated}


# ===== METEO CHANTIER =====

@router.get("/weather/stations")
async def list_weather_stations(ctx: MobileTenantContext = Depends(get_mobile_context)):
    """Return available Quebec weather stations."""
    stations = [
        {"code": "YUL", "name": "Montreal", "lat": 45.5017, "lon": -73.5673},
        {"code": "YQB", "name": "Quebec", "lat": 46.8139, "lon": -71.2080},
        {"code": "YOW", "name": "Gatineau", "lat": 45.4765, "lon": -75.7013},
        {"code": "YQT", "name": "Trois-Rivieres", "lat": 46.3432, "lon": -72.5419},
        {"code": "YSH", "name": "Sherbrooke", "lat": 45.4010, "lon": -71.8884},
        {"code": "YSB", "name": "Saguenay", "lat": 48.4279, "lon": -71.0685},
        {"code": "YRI", "name": "Rimouski", "lat": 48.4489, "lon": -68.5243},
    ]
    return {"stations": stations}


@router.get("/weather/forecast")
async def get_weather_forecast(
    ctx: MobileTenantContext = Depends(get_mobile_context),
    lat: float = Query(45.5017),
    lon: float = Query(-73.5673),
):
    """Get 7-day weather forecast from Open-Meteo API."""
    try:
        import urllib.request
        url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={lat}&longitude={lon}"
            f"&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max"
            f"&timezone=America/Montreal&forecast_days=7"
        )
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
        daily = data.get("daily", {})
        forecasts = []
        dates = daily.get("time", [])
        for i, date in enumerate(dates):
            forecasts.append({
                "date": date,
                "temp_max": daily.get("temperature_2m_max", [None])[i],
                "temp_min": daily.get("temperature_2m_min", [None])[i],
                "precipitation": daily.get("precipitation_sum", [None])[i],
                "wind_max": daily.get("wind_speed_10m_max", [None])[i],
            })
        return {"forecasts": forecasts, "latitude": lat, "longitude": lon}
    except Exception as exc:
        logger.error("get_weather_forecast error: %s", exc)
        return {"forecasts": [], "error": "Erreur interne"}


# ===== AUDIT LOG (Phase 5D - Loi 25 Quebec / GDPR) =====

@router.get("/audit/events", response_model=AuditEventsResponse)
async def list_audit_events_endpoint(
    entity_type: Optional[str] = Query(None, description="Filtre par type d'entite (facture, devis, ...)"),
    entity_id: Optional[int] = Query(None, description="Filtre par id specifique"),
    employee_id: Optional[int] = Query(None, description="Filtre par employe"),
    action: Optional[str] = Query(None, description="Filtre par action (create, update, delete, login, ...)"),
    since: Optional[str] = Query(None, description="Timestamp ISO 8601 (debut, inclusif)"),
    until: Optional[str] = Query(None, description="Timestamp ISO 8601 (fin, inclusif)"),
    limit: int = Query(100, ge=1, le=500, description="Nombre d'events (max 500)"),
    offset: int = Query(0, ge=0, description="Offset pour pagination"),
    ctx: MobileTenantContext = Depends(require_role("ADMIN")),
):
    """Recherche dans le journal d'audit polymorphique du tenant.

    Conformite Loi 25 Quebec + GDPR : permet a l'admin du tenant d'auditer
    qui a fait quoi, quand, sur quelle entite. Ordre : created_at DESC.

    Reserve ADMIN. Cap a 500 events par page (pagination via offset).
    """
    result = db.list_audit_events(
        tenant_schema=ctx.tenant_schema,
        entity_type=entity_type,
        entity_id=entity_id,
        employee_id=employee_id,
        action=action,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )
    events = [AuditEventResponse(**e) for e in result["events"]]
    return AuditEventsResponse(
        events=events,
        total=result["total"],
        limit=result["limit"],
        offset=result["offset"],
    )


# ===== HEALTH =====

@router.api_route("/health", methods=["GET", "HEAD"])
async def health():
    # Accept HEAD so external uptime monitors / Render healthchecks don't get 405.
    return {"status": "ok", "service": "constructo-mobile-api", "version": "0.2.0"}


# --- Mount router ---
app.include_router(router)

# Mount du router attachments — import en bas pour eviter circular avec
# nos helpers (ATTACHMENT_ALLOWED_MIMES, _detect_file_mime, etc.).
from .attachments_api import router as attachments_router  # noqa: E402
app.include_router(attachments_router)

# --- Serve React frontend (built by Vite into frontend/dist/) ---

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if FRONTEND_DIR.is_dir():
    # Mount Vite assets (JS, CSS bundles)
    assets_dir = FRONTEND_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="static-assets")

    # Serve PWA files from public/
    @app.api_route("/manifest.json", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_manifest():
        f = FRONTEND_DIR / "manifest.json"
        if f.exists():
            return FileResponse(str(f), media_type="application/manifest+json")
        return JSONResponse(status_code=404, content={"detail": "Not found"})

    @app.api_route("/favicon.png", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_favicon():
        f = FRONTEND_DIR / "favicon.png"
        if f.exists():
            return FileResponse(str(f))
        return JSONResponse(status_code=404, content={"detail": "Not found"})

    @app.api_route("/logo.png", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_logo():
        f = FRONTEND_DIR / "logo.png"
        if f.exists():
            return FileResponse(str(f))
        return JSONResponse(status_code=404, content={"detail": "Not found"})

    logger.info("React frontend found at %s", FRONTEND_DIR)
else:
    logger.warning("React frontend build not found at %s — run 'npm run build' in frontend/", FRONTEND_DIR)

# --- SPA catch-all: serve index.html for client-side routing ---

@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
async def serve_root():
    """Serve React app or redirect to API docs.

    HEAD is supported for external uptime monitors / Render healthchecks
    (Starlette does not auto-register HEAD on `@app.get` routes).
    """
    if FRONTEND_DIR.is_dir():
        return FileResponse(str(FRONTEND_DIR / "index.html"))
    return JSONResponse(content={"detail": "Frontend not built. API docs at /api/mobile/v1/docs"})


@app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def catch_all(full_path: str):
    """Serve static files or fallback to index.html for React Router."""
    # API routes that don't match → 404
    if full_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"detail": "Endpoint not found"})

    # Try to serve the exact static file
    if FRONTEND_DIR.is_dir():
        static_file = (FRONTEND_DIR / full_path).resolve()
        if static_file.is_file() and str(static_file).startswith(str(FRONTEND_DIR.resolve())):
            return FileResponse(str(static_file))

    # Fallback: return index.html (React Router handles the route)
    if FRONTEND_DIR.is_dir():
        return FileResponse(str(FRONTEND_DIR / "index.html"))

    return JSONResponse(status_code=404, content={"detail": "Frontend not built"})
