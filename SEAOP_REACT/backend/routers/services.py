"""
SEAOP React - Service d'Estimation Router
Endpoints publics + admin pour les demandes d'estimation professionnelles.

Flow:
  1. Un client remplit le wizard public /services/estimation (sans auth).
  2. Le backend valide, stocke en BD, envoie un courriel d'alerte a l'admin
     (info@constructoai.ca) + un courriel de confirmation au client.
  3. L'admin Sylvain traite la demande et renvoie une estimation manuelle
     par courriel dans les 24-48h.

L'ancien routeur multi-services (technologue / architecture / ingenieur)
a ete retire — un seul service est desormais expose.
"""

import json as _json
import logging
import os
import re
import shutil
import uuid
from collections import defaultdict
from datetime import date as date_cls, datetime, timedelta
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from psycopg2.extras import Json as PgJson
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from .. import seaop_database as db
from .. import seaop_email as email
from ..seaop_auth import SeaopUser, require_role
from .. import seaop_config as cfg
from ..seaop_config import (
    ADMIN_NOTIFICATION_EMAIL,
    CORPS_METIERS,
    ESTIMATION_PLAN_PENDING_TTL_HOURS,
    ESTIMATION_PLAN_ROOT,
    MAX_ESTIMATION_PLAN_SIZE,
    MAX_ESTIMATION_PLANS,
    SECTEURS,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/services", tags=["Service d'estimation"])

# Valid enums (kept singular since only estimation remains)
VALID_URGENCE = {"normal", "urgent"}
VALID_DISPONIBILITE = {"des_que_possible", "date_specifique"}
VALID_STATUT = {"nouvelle", "en_analyse", "estimation_envoyee", "refusee", "archivee"}

# Anti-spam rate limiter: max N submissions per hour per client IP.
# In-memory sliding window — resets on process restart, which is fine for
# this volume. If scaling to multi-worker, move to Redis.
RATE_LIMIT_MAX = 5
RATE_LIMIT_WINDOW = timedelta(hours=1)
_rate_limit_buckets: dict[str, list[datetime]] = defaultdict(list)

# Safeguards on unbounded user-controlled fields. The frontend enforces a
# combined photos+plans budget of MAX_DOCS (10); we mirror that here by
# allowing each bucket to hold up to MAX_DOCS, and a model_validator on
# EstimationRequestCreate rejects payloads where the combined total
# exceeds MAX_DOCS. Keeping each individual ceiling equal to MAX_DOCS
# avoids rejecting a legitimate "10 photos, 0 plans" submission.
MAX_DOCS_COMBINED = 10
MAX_PHOTOS = MAX_DOCS_COMBINED
# Each photo is base64 (~1.37x binary size). Client caps binary at 5 MB, so a
# legitimate base64 string peaks around 7 MB. We cap at 15 MB per string to
# tolerate headers + minor overhead while blocking 100 MB payloads.
MAX_PHOTO_STRING_BYTES = 15 * 1024 * 1024
MAX_QUESTIONS_JSON_BYTES = 10 * 1024  # 10 KB serialized

# PDF plan uploads (150 MB each, up to 5). Files live on disk, not the DB —
# the `plans` JSONB column stores only metadata + a pending file_id that maps
# to `{ESTIMATION_PLAN_ROOT}/{ref}/{plan_id}.pdf` once the request is saved.
_PENDING_DIR = Path(ESTIMATION_PLAN_ROOT) / "pending"
_PLAN_ID_RE = re.compile(r"^[a-f0-9]{32}$")  # uuid4().hex
# numero_reference is generated server-side as EST-YYYYMMDD-XXXXXXXX; validate
# strictly before using it as a filesystem path segment (defense-in-depth
# against any future code path that lets an attacker control the value).
_REF_RE = re.compile(r"^EST-\d{8}-[A-F0-9]{8}$")
UPLOAD_RATE_LIMIT_MAX = 10  # per IP per hour
_upload_rate_buckets: dict[str, list[datetime]] = defaultdict(list)

# Test-email endpoint: small per-user rate limit so a compromised admin
# account can't use the SMTP relay to spam arbitrary addresses.
TEST_EMAIL_RATE_LIMIT_MAX = 5  # per admin user per hour
_test_email_rate_buckets: dict[str, list[datetime]] = defaultdict(list)

# Rate limit on "resend client confirmation" — prevents a compromised admin
# account from harassing a client by spamming repeated emails. Keyed by
# (admin_identity, estimation_request_id) so the cap is per client request,
# not per admin in absolute — so an admin with many clients isn't unduly
# throttled across the whole inbox.
RESEND_CLIENT_RATE_LIMIT_MAX = 3  # per admin per estimation per hour
_resend_client_rate_buckets: dict[str, list[datetime]] = defaultdict(list)


def _client_ip(request: Request) -> str:
    """Extract the client IP, preferring X-Forwarded-For behind a proxy."""
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(request: Request) -> None:
    """Throttle submissions: 5 per IP per hour. Raises 429 on breach."""
    ip = _client_ip(request)
    now = datetime.now()
    cutoff = now - RATE_LIMIT_WINDOW
    bucket = [t for t in _rate_limit_buckets[ip] if t > cutoff]
    if len(bucket) >= RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail=(
                "Vous avez atteint la limite de soumissions par heure. "
                "Veuillez réessayer plus tard ou nous écrire à info@constructoai.ca."
            ),
        )
    bucket.append(now)
    _rate_limit_buckets[ip] = bucket


def _check_upload_rate_limit(request: Request) -> None:
    """Throttle PDF plan uploads: 10 per IP per hour."""
    ip = _client_ip(request)
    now = datetime.now()
    cutoff = now - RATE_LIMIT_WINDOW
    bucket = [t for t in _upload_rate_buckets[ip] if t > cutoff]
    if len(bucket) >= UPLOAD_RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail="Trop de téléversements. Veuillez patienter et réessayer.",
        )
    bucket.append(now)
    _upload_rate_buckets[ip] = bucket


def _sanitize_filename(name: str) -> str:
    """Keep the display name safe: strip path separators and control chars."""
    if not name:
        return "plan.pdf"
    base = os.path.basename(name).strip()
    base = re.sub(r"[\x00-\x1f\x7f]", "", base)
    # Limit length but preserve extension
    if len(base) > 200:
        root, ext = os.path.splitext(base)
        base = root[: 200 - len(ext)] + ext
    return base or "plan.pdf"


def _safe_estimation_dir(ref: str) -> Path:
    """
    Validate `ref` looks like an estimation reference, then resolve the
    per-request upload directory under ESTIMATION_PLAN_ROOT. Defense against
    path traversal if a future code path ever feeds attacker-controlled
    numero_reference values into the filesystem layer.
    """
    if not isinstance(ref, str) or not _REF_RE.match(ref):
        logger.error("Rejected invalid estimation reference for disk path: %r", ref)
        raise HTTPException(status_code=500, detail="Référence d'estimation invalide.")
    root = Path(ESTIMATION_PLAN_ROOT).resolve()
    dest = (root / ref).resolve()
    try:
        dest.relative_to(root)
    except ValueError:
        logger.error("Path traversal attempt blocked: ref=%r resolved to %s", ref, dest)
        raise HTTPException(status_code=500, detail="Chemin invalide.")
    return dest


def _check_test_email_rate_limit(user_id: str) -> None:
    """Throttle admin test-email sends: 5 per admin per hour."""
    now = datetime.now()
    cutoff = now - RATE_LIMIT_WINDOW
    bucket = [t for t in _test_email_rate_buckets[user_id] if t > cutoff]
    if len(bucket) >= TEST_EMAIL_RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail="Trop d'envois de test. Réessayez dans une heure.",
        )
    bucket.append(now)
    _test_email_rate_buckets[user_id] = bucket


def _check_resend_client_rate_limit(user_id: str, request_id: int) -> None:
    """
    Throttle the "resend client confirmation" action: at most
    RESEND_CLIENT_RATE_LIMIT_MAX (3) per admin per estimation per hour.
    Scoping by (admin, request_id) stops an admin from re-sending the same
    email a dozen times to harass a single client, while still allowing
    them to process many different clients without being throttled.
    """
    now = datetime.now()
    cutoff = now - RATE_LIMIT_WINDOW
    key = f"{user_id}:{request_id}"
    bucket = [t for t in _resend_client_rate_buckets[key] if t > cutoff]
    if len(bucket) >= RESEND_CLIENT_RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail=(
                "Trop de renvois pour cette demande. "
                f"Maximum {RESEND_CLIENT_RATE_LIMIT_MAX} par heure."
            ),
        )
    bucket.append(now)
    _resend_client_rate_buckets[key] = bucket


def _pending_pdf_path(plan_id: str) -> Path:
    """Resolve a pending plan_id to its on-disk path. Raises on bad id.

    Validation : regex stricte + resolve() pour empêcher path traversal et
    symlink-out attacks (le fichier final doit rester sous _PENDING_DIR).
    """
    if not _PLAN_ID_RE.match(plan_id):
        raise HTTPException(status_code=400, detail="plan_id invalide.")
    base = _PENDING_DIR.resolve()
    candidate = (base / f"{plan_id}.pdf").resolve()
    try:
        candidate.relative_to(base)
    except ValueError:
        raise HTTPException(status_code=400, detail="plan_id invalide.")
    return candidate


def _pending_meta_path(plan_id: str) -> Path:
    """Sidecar JSON file that stores the original filename + size for a pending upload."""
    if not _PLAN_ID_RE.match(plan_id):
        raise HTTPException(status_code=400, detail="plan_id invalide.")
    base = _PENDING_DIR.resolve()
    candidate = (base / f"{plan_id}.json").resolve()
    try:
        candidate.relative_to(base)
    except ValueError:
        raise HTTPException(status_code=400, detail="plan_id invalide.")
    return candidate


def _gc_pending_uploads() -> None:
    """
    Delete pending/*.pdf + .json files older than ESTIMATION_PLAN_PENDING_TTL_HOURS.
    Called lazily on each upload (cheap — only stats files in pending/).
    Prevents abandoned uploads from accumulating indefinitely on disk.
    """
    try:
        if not _PENDING_DIR.is_dir():
            return
        cutoff = datetime.now() - timedelta(hours=ESTIMATION_PLAN_PENDING_TTL_HOURS)
        for p in _PENDING_DIR.iterdir():
            try:
                if datetime.fromtimestamp(p.stat().st_mtime) < cutoff:
                    p.unlink(missing_ok=True)
            except OSError:
                pass
    except Exception as exc:
        logger.warning("Pending uploads GC failed: %s", exc)


def _move_pending_plans_to_permanent(ref: str, plan_ids: List[str]) -> List[dict]:
    """
    Move each pending/{plan_id}.pdf to {ESTIMATION_PLAN_ROOT}/{ref}/{plan_id}.pdf.
    Returns the list of metadata dicts to store in the `plans` JSONB column.
    Silently skips missing files (client may have re-uploaded or uploaded nothing).
    """
    if not plan_ids:
        return []
    dest_dir = _safe_estimation_dir(ref)
    dest_dir.mkdir(parents=True, exist_ok=True)
    out: List[dict] = []
    for plan_id in plan_ids:
        if not _PLAN_ID_RE.match(plan_id):
            continue
        src = _pending_pdf_path(plan_id)
        meta_src = _pending_meta_path(plan_id)
        if not src.is_file():
            logger.warning("Pending plan %s not found on disk (skipping)", plan_id)
            continue
        dst = dest_dir / f"{plan_id}.pdf"
        try:
            shutil.move(str(src), str(dst))
        except OSError as exc:
            logger.error("Failed to move pending plan %s: %s", plan_id, exc)
            continue
        # Load sidecar metadata (filename, original size) if present
        filename = f"{plan_id}.pdf"
        size = dst.stat().st_size
        if meta_src.is_file():
            try:
                meta = _json.loads(meta_src.read_text(encoding="utf-8"))
                filename = _sanitize_filename(meta.get("filename", filename))
                size = int(meta.get("size", size))
            except (ValueError, OSError):
                pass
            meta_src.unlink(missing_ok=True)
        out.append(
            {
                "id": plan_id,
                "filename": filename,
                "size": size,
                "uploaded_at": datetime.now().isoformat(),
            }
        )
    return out


# ============================================
# REQUEST / RESPONSE MODELS
# ============================================

class EstimationRequestCreate(BaseModel):
    # Reject any field the client sends that is not declared below. Prevents
    # privilege escalation via hidden fields (statut, estimation_html, etc.).
    model_config = ConfigDict(extra="forbid")

    # Contact (required)
    prenom: str = Field(min_length=1, max_length=100)
    nom: str = Field(min_length=1, max_length=100)
    email: EmailStr
    telephone: str = Field(min_length=1, max_length=40)
    # Contact (optional)
    entreprise: Optional[str] = Field(default=None, max_length=200)

    # Projet (required)
    corps_metier: str = Field(min_length=1, max_length=120)
    secteur: str = Field(min_length=1, max_length=60)
    description: str = Field(min_length=10, max_length=5000)

    # Projet (optional)
    type_projet: Optional[str] = Field(default=None, max_length=200)
    superficie: Optional[str] = Field(default=None, max_length=100)
    budget_estime: Optional[str] = Field(default=None, max_length=100)
    delai: Optional[str] = Field(default=None, max_length=100)

    # Urgence / disponibilite
    urgence: str = "normal"
    disponibilite: str = "des_que_possible"
    date_souhaitee: Optional[date_cls] = None

    # Localisation
    code_postal: Optional[str] = Field(default=None, max_length=20)
    localisation: Optional[str] = Field(default=None, max_length=300)

    # Divers
    documents: Optional[str] = Field(default=None, max_length=2000)
    # Cap list length to avoid OOM on giant base64 payloads. Each string is
    # also bounded; see validator below. Per-photo size cap is enforced
    # client-side (5 MB) + whatever the HTTP body limit of the hosting layer.
    photos: Optional[List[str]] = Field(default=None, max_length=MAX_PHOTOS)
    # plan_ids: references to PDF files previously uploaded via
    # POST /services/estimation/plans. The files live on disk; metadata is
    # persisted in the `plans` JSONB column at submit time.
    plan_ids: Optional[List[str]] = Field(default=None, max_length=MAX_ESTIMATION_PLANS)
    questions_specifiques: Optional[dict] = None

    @field_validator("corps_metier")
    @classmethod
    def _check_corps_metier(cls, v: str) -> str:
        if v not in CORPS_METIERS:
            raise ValueError(
                f"Corps de métier invalide. Valeurs acceptées : {', '.join(CORPS_METIERS)}"
            )
        return v

    @field_validator("secteur")
    @classmethod
    def _check_secteur(cls, v: str) -> str:
        if v not in SECTEURS:
            raise ValueError(
                f"Secteur invalide. Valeurs acceptées : {', '.join(SECTEURS)}"
            )
        return v

    @field_validator("urgence")
    @classmethod
    def _check_urgence(cls, v: str) -> str:
        if v not in VALID_URGENCE:
            raise ValueError(f"Urgence invalide. Acceptées : {', '.join(sorted(VALID_URGENCE))}")
        return v

    @field_validator("disponibilite")
    @classmethod
    def _check_dispo(cls, v: str) -> str:
        if v not in VALID_DISPONIBILITE:
            raise ValueError(
                f"Disponibilité invalide. Acceptées : {', '.join(sorted(VALID_DISPONIBILITE))}"
            )
        return v

    @field_validator("questions_specifiques")
    @classmethod
    def _check_questions(cls, v: Optional[dict]) -> Optional[dict]:
        """Reject deeply nested or oversized dicts stored as JSONB."""
        if v is None:
            return v
        try:
            serialized = _json.dumps(v)
        except (TypeError, ValueError):
            raise ValueError("questions_specifiques contient des types non sérialisables.")
        if len(serialized) > MAX_QUESTIONS_JSON_BYTES:
            raise ValueError(
                f"questions_specifiques trop volumineux (max {MAX_QUESTIONS_JSON_BYTES // 1024} KB)."
            )
        return v

    @field_validator("photos")
    @classmethod
    def _check_photos(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        """Reject oversized individual photos to prevent OOM via giant base64."""
        if v is None:
            return v
        mb = MAX_PHOTO_STRING_BYTES // (1024 * 1024)
        for i, photo in enumerate(v):
            if not isinstance(photo, str):
                raise ValueError(f"La photo #{i + 1} doit être une chaîne base64.")
            if len(photo) > MAX_PHOTO_STRING_BYTES:
                raise ValueError(
                    f"La photo #{i + 1} est trop volumineuse (max {mb} Mo)."
                )
        return v

    @field_validator("plan_ids")
    @classmethod
    def _check_plan_ids(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        """plan_ids must be uuid4 hex strings (32 lowercase hex chars)."""
        if v is None:
            return v
        for plan_id in v:
            if not isinstance(plan_id, str) or not _PLAN_ID_RE.match(plan_id):
                raise ValueError("plan_id invalide.")
        return v

    @model_validator(mode="after")
    def _check_combined_docs(self) -> "EstimationRequestCreate":
        """Enforce the combined photos + plans ceiling (MAX_DOCS_COMBINED).

        The frontend exposes a single 'Documents (N/10)' budget that mixes
        images and PDFs — mirror that on the server so a client bypassing
        the UI can't sneak in 10 photos + 10 plans.
        """
        photo_count = len(self.photos or [])
        plan_count = len(self.plan_ids or [])
        if photo_count + plan_count > MAX_DOCS_COMBINED:
            raise ValueError(
                f"Maximum {MAX_DOCS_COMBINED} documents au total "
                f"(photos + plans). Reçu : {photo_count} photo(s) + "
                f"{plan_count} plan(s)."
            )
        return self


class TestEmailRequest(BaseModel):
    """Payload for the admin email-diagnostic endpoint."""
    model_config = ConfigDict(extra="forbid")

    to_email: EmailStr


class EstimationRequestUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    statut: Optional[str] = None
    notes_internes: Optional[str] = Field(default=None, max_length=5000)
    estimation_resultat: Optional[str] = Field(default=None, max_length=20000)
    estimation_html: Optional[str] = Field(default=None, max_length=100000)
    montant_estime: Optional[float] = None
    estimateur_id: Optional[int] = None

    @field_validator("statut")
    @classmethod
    def _check_statut(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_STATUT:
            raise ValueError(f"Statut invalide. Acceptés : {', '.join(sorted(VALID_STATUT))}")
        return v


# ============================================
# CREATE — PUBLIC (no auth)
# ============================================

@router.post("/estimation", status_code=201)
async def create_estimation_request(request: Request, body: EstimationRequestCreate):
    """
    Cree une nouvelle demande d'estimation.

    Endpoint public (pas d'authentification requise). Envoie un courriel
    d'alerte a l'admin + un courriel de confirmation au client. Rate-limited
    a 5 soumissions par IP par heure pour eviter le spam.
    """
    _check_rate_limit(request)
    payload = body.model_dump(exclude_none=True)

    # Pop plan_ids from the payload — they're not a DB column. We'll move the
    # pending files to a permanent directory AFTER the INSERT succeeds and
    # persist the resulting metadata in the `plans` JSONB column.
    plan_ids: List[str] = payload.pop("plan_ids", None) or []

    # Convert date to ISO string for psycopg2 (it handles dates but isoformat is safer)
    if isinstance(payload.get("date_souhaitee"), date_cls):
        payload["date_souhaitee"] = payload["date_souhaitee"].isoformat()

    # Wrap list/dict in psycopg2's Json adapter so they are stored as proper
    # JSONB values (and returned as native Python list/dict on SELECT).
    if payload.get("photos") is not None:
        payload["photos"] = PgJson(payload["photos"])
    if payload.get("questions_specifiques") is not None:
        payload["questions_specifiques"] = PgJson(payload["questions_specifiques"])

    payload["date_creation"] = datetime.now().isoformat()
    payload["statut"] = "nouvelle"

    try:
        result = db.create_estimation_request(payload)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error creating estimation request: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Erreur lors de la création de la demande d'estimation",
        )

    # Move pending PDF plans to their permanent location, then persist the
    # metadata. We do this AFTER the row is created so the reference number
    # is available. Failures here don't fail the submission — plans can be
    # re-uploaded via admin if needed.
    if plan_ids:
        ref = result.get("numero_reference") or f"id-{result.get('id')}"
        plans_meta: list[dict] = []
        try:
            plans_meta = _move_pending_plans_to_permanent(ref, plan_ids)
        except Exception as exc:
            # Log the plan_ids so the admin can manually recover orphan files
            # from uploads/estimations/{ref}/ if the move partially succeeded.
            logger.error(
                "Failed to move pending plans for ref=%s plan_ids=%s: %s",
                ref, plan_ids, exc,
            )
        if plans_meta:
            try:
                updated = db.update_estimation_request(
                    result["id"],
                    {"plans": PgJson(plans_meta)},
                )
                if updated:
                    result = updated
            except Exception as exc:
                # Files are already on disk under {ESTIMATION_PLAN_ROOT}/{ref}/
                # but the DB column is empty — surface enough context for the
                # admin to manually insert the metadata and recover the plans.
                logger.error(
                    "Persisted files but DB update failed for ref=%s "
                    "estimation_id=%s plans_meta=%s: %s",
                    ref, result.get("id"), plans_meta, exc,
                )

    # Fire-and-forget notifications. We capture their boolean result so the
    # response can tell the frontend whether email delivery actually happened
    # (vs. silently failing because SMTP is unconfigured).
    admin_email_sent = False
    client_email_sent = False
    try:
        admin_email_sent = bool(email.send_estimation_admin_notification(result))
    except Exception as exc:
        logger.warning("Admin notification email failed for estimation %s: %s", result.get("id"), exc)

    try:
        client_email_sent = bool(email.send_estimation_client_confirmation(result))
    except Exception as exc:
        logger.warning("Client confirmation email failed for estimation %s: %s", result.get("id"), exc)

    # Create an in-app admin notification as well (visible in the admin panel)
    try:
        db.create_notification({
            "utilisateur_type": "admin",
            "user_id": 0,
            "type_notification": "nouvelle_estimation",
            "titre": f"Nouvelle demande d'estimation — {result.get('numero_reference', '?')}",
            "message": (
                f"{payload.get('corps_metier', '')} ({payload.get('secteur', '')}) — "
                f"de {payload.get('email', '')}"
            ),
            "lien_id": result.get("id"),
        })
    except Exception as exc:
        logger.warning("Failed to create admin in-app notification for estimation: %s", exc)

    # Redact sensitive fields from public response (we only need to echo the ref)
    return {
        "message": "Votre demande a été reçue. Vous recevrez une estimation par courriel dans les 24-48h.",
        "data": {
            "id": result.get("id"),
            "numero_reference": result.get("numero_reference"),
            "admin_email_sent": admin_email_sent,
            "client_email_sent": client_email_sent,
        },
    }


# ============================================
# ADMIN — LIST
# ============================================

@router.get("/estimation/admin")
async def admin_list_estimation_requests(
    statut: Optional[str] = Query(default=None),
    user: SeaopUser = Depends(require_role("admin", "super_admin")),
):
    """Liste toutes les demandes d'estimation. Admin uniquement."""
    try:
        requests = db.list_estimation_requests(statut=statut)
    except Exception as exc:
        logger.error("Error fetching estimation requests: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Erreur lors de la récupération des demandes",
        )
    return {"data": requests, "total": len(requests)}


# ============================================
# ADMIN — DETAIL
# ============================================

@router.get("/estimation/admin/{request_id}")
async def admin_get_estimation_request(
    request_id: int,
    user: SeaopUser = Depends(require_role("admin", "super_admin")),
):
    """Detail d'une demande d'estimation. Admin uniquement."""
    try:
        result = db.get_estimation_request(request_id)
    except Exception as exc:
        logger.error("Error fetching estimation request %s: %s", request_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la récupération")

    if not result:
        raise HTTPException(status_code=404, detail="Demande non trouvée")

    return {"data": result}


# ============================================
# ADMIN — UPDATE
# ============================================

@router.put("/estimation/admin/{request_id}")
async def admin_update_estimation_request(
    request_id: int,
    body: EstimationRequestUpdate,
    user: SeaopUser = Depends(require_role("admin", "super_admin")),
):
    """Mettre a jour statut, notes, estimation. Admin uniquement."""
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    if not data:
        raise HTTPException(status_code=422, detail="Aucune donnée de mise à jour fournie")

    data["updated_at"] = datetime.now().isoformat()
    if "statut" in data and data["statut"] != "nouvelle":
        data["date_traitement"] = datetime.now().isoformat()

    try:
        result = db.update_estimation_request(request_id, data)
    except Exception as exc:
        logger.error("Error updating estimation request %s: %s", request_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise à jour")

    if not result:
        raise HTTPException(status_code=404, detail="Demande non trouvée")

    return {"message": "Demande mise à jour avec succès", "data": result}


# ============================================
# PUBLIC — METADATA (trades + sectors for the wizard dropdown)
# ============================================

@router.get("/estimation/meta")
async def get_estimation_metadata() -> dict:
    """
    Retourne les listes de corps de metier et secteurs disponibles.
    Endpoint public (utilise par le wizard pour remplir les dropdowns).
    """
    return {
        "corps_metiers": CORPS_METIERS,
        "secteurs": SECTEURS,
        "urgences": sorted(VALID_URGENCE),
        "disponibilites": sorted(VALID_DISPONIBILITE),
        "max_plan_size_mb": MAX_ESTIMATION_PLAN_SIZE // (1024 * 1024),
        "max_plans": MAX_ESTIMATION_PLANS,
    }


# ============================================
# PUBLIC — PDF PLAN UPLOAD (multipart, 150 MB max per file, PDF only)
# ============================================
#
# Two-phase upload: the client uploads each PDF individually to receive a
# plan_id, then includes the list of plan_ids in the final estimation submit.
# The actual files never touch the database — they live on disk, and the
# estimation row's `plans` JSONB column stores only metadata + plan_id.
# This keeps the JSON submit payload small (critical for the reverse proxy's
# body size limits) and enables efficient streaming downloads for the admin.

@router.post("/estimation/plans", status_code=201)
async def upload_estimation_plan(
    request: Request,
    file: UploadFile = File(...),
):
    """
    Receive a single PDF plan (max 150 MB). Stores it under pending/ and
    returns {plan_id, filename, size}. The caller keeps the plan_id and
    passes it in plan_ids[] of POST /services/estimation.

    Endpoint public — no auth required. Rate-limited per IP.
    """
    _check_upload_rate_limit(request)
    _gc_pending_uploads()

    filename = _sanitize_filename(file.filename or "plan.pdf")

    # Content-type check is cheap; we also validate the magic bytes below.
    ct = (file.content_type or "").lower()
    if ct and ct not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(
            status_code=400,
            detail=f"Seuls les fichiers PDF sont acceptés (reçu: {ct}).",
        )

    _PENDING_DIR.mkdir(parents=True, exist_ok=True)
    plan_id = uuid.uuid4().hex
    dest = _pending_pdf_path(plan_id)

    # Stream to disk in chunks to keep peak memory bounded. Abort early if
    # the aggregate size exceeds MAX_ESTIMATION_PLAN_SIZE.
    CHUNK = 1024 * 1024  # 1 MB
    total = 0
    try:
        with dest.open("wb") as fh:
            while True:
                chunk = await file.read(CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_ESTIMATION_PLAN_SIZE:
                    fh.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"Fichier trop volumineux (max "
                            f"{MAX_ESTIMATION_PLAN_SIZE // (1024 * 1024)} Mo)."
                        ),
                    )
                fh.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed writing plan upload %s: %s", plan_id, exc)
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Erreur lors du téléversement.")

    # Validate PDF magic bytes (%PDF-) at the start of the file. Catches
    # mislabeled uploads and crude content-type spoofing.
    try:
        with dest.open("rb") as fh:
            header = fh.read(5)
    except OSError:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Erreur lors du téléversement.")

    if header != b"%PDF-":
        dest.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail="Le fichier n'est pas un PDF valide.",
        )

    # Sidecar metadata so the submit endpoint can preserve the original filename
    try:
        _pending_meta_path(plan_id).write_text(
            _json.dumps({"filename": filename, "size": total}),
            encoding="utf-8",
        )
    except OSError as exc:
        logger.warning("Could not write sidecar for plan %s: %s", plan_id, exc)

    # plan_id + size at INFO for operational visibility; filename at DEBUG
    # to avoid leaking user-supplied strings in the default log stream.
    logger.info("Plan uploaded (pending): %s (%d bytes)", plan_id, total)
    logger.debug("Plan upload filename for %s: %s", plan_id, filename)
    return {"plan_id": plan_id, "filename": filename, "size": total}


# ============================================
# ADMIN — EMAIL DIAGNOSTIC
# ============================================
#
# Lets the super-admin verify SMTP configuration from the browser without
# needing Render shell access. Returns the config status and, if a test
# address is provided, attempts an actual send so the admin can see whether
# messages reach their inbox (and whether Gmail/Outlook file them as spam).

@router.get("/estimation/admin/email-status")
async def admin_email_status(
    user: SeaopUser = Depends(require_role("admin", "super_admin")),
):
    """
    Report SMTP configuration without exposing secrets. Admins + super-admins
    can read this so they can self-diagnose email delivery issues (SMTP auth
    rejected, host unreachable, etc.) without needing Render log access. The
    `smtp_password_set` flag is a boolean — the actual password is never
    returned.
    """
    return {
        "smtp_host": cfg.SMTP_HOST or None,
        "smtp_port": cfg.SMTP_PORT,
        "smtp_user": cfg.SMTP_USER or None,
        "smtp_from_name": cfg.SMTP_FROM_NAME,
        "smtp_use_ssl": cfg.SMTP_USE_SSL,
        "smtp_password_set": bool(cfg.SMTP_PASSWORD),
        "admin_notification_email": ADMIN_NOTIFICATION_EMAIL,
        "configured": bool(cfg.SMTP_HOST and cfg.SMTP_USER and cfg.SMTP_PASSWORD),
    }


@router.post("/estimation/admin/test-email")
async def admin_send_test_email(
    body: TestEmailRequest,
    user: SeaopUser = Depends(require_role("admin", "super_admin")),
):
    """
    Send a minimal test email to the provided address. Returns the SMTP
    outcome so the admin can diagnose delivery problems from the UI.
    Rate-limited (5 per user per hour) so a compromised account can't use
    the SMTP relay to spam arbitrary inboxes.
    """
    _check_test_email_rate_limit(str(user.email or user.user_id or "anon"))

    if not (cfg.SMTP_HOST and cfg.SMTP_USER and cfg.SMTP_PASSWORD):
        return {
            "success": False,
            "detail": (
                "SMTP non configuré. Définissez SMTP_HOST, SMTP_USER et "
                "SMTP_PASSWORD dans les variables d'environnement du service."
            ),
            "configured": False,
        }

    subject = "Test courriel — Constructo AI SEAOP"
    html_body = (
        "<p>Ceci est un courriel de test envoyé depuis le panneau "
        "d'administration SEAOP.</p>"
        f"<p>Si vous le recevez, la configuration SMTP fonctionne.</p>"
        f"<p><small>Déclenché par : {html_escape_or(user.email)}</small></p>"
    )
    text_body = (
        "Ceci est un courriel de test envoye depuis le panneau "
        "d'administration SEAOP. Si vous le recevez, SMTP fonctionne."
    )
    try:
        sent = bool(email.send_email(str(body.to_email), subject, html_body, text_body))
    except Exception as exc:
        logger.error("Test email exception: %s", exc)
        return {"success": False, "detail": f"Erreur SMTP : {exc}", "configured": True}
    if not sent:
        return {
            "success": False,
            "detail": (
                "L'envoi a échoué. Vérifiez les logs du service pour l'erreur "
                "SMTP exacte (authentification, port, etc.)."
            ),
            "configured": True,
        }
    return {
        "success": True,
        "detail": f"Courriel envoyé à {body.to_email}. Vérifiez aussi votre dossier indésirables.",
        "configured": True,
    }


def html_escape_or(value: Optional[str]) -> str:
    """Tiny helper: escape an email address for safe inclusion in the test mail body."""
    import html as _html
    return _html.escape(str(value)) if value else "—"


# ============================================
# ADMIN — PLAN DOWNLOAD
# ============================================

@router.get("/estimation/admin/{request_id}/plans/{plan_id}")
async def admin_download_estimation_plan(
    request_id: int,
    plan_id: str,
    user: SeaopUser = Depends(require_role("admin", "super_admin")),
):
    """
    Stream a PDF plan back to the admin. Verifies the plan belongs to the
    requested estimation before reading from disk.
    """
    if not _PLAN_ID_RE.match(plan_id):
        raise HTTPException(status_code=400, detail="plan_id invalide.")

    record = db.get_estimation_request(request_id)
    if not record:
        raise HTTPException(status_code=404, detail="Demande non trouvée")

    plans = record.get("plans") or []
    if not isinstance(plans, list):
        plans = []
    match = next((p for p in plans if isinstance(p, dict) and p.get("id") == plan_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Plan non trouvé pour cette demande.")

    ref = record.get("numero_reference")
    if not ref:
        logger.error("Estimation %s has no numero_reference — cannot resolve plan path", request_id)
        raise HTTPException(status_code=500, detail="Référence d'estimation introuvable.")
    pdf_path = _safe_estimation_dir(ref) / f"{plan_id}.pdf"
    if not pdf_path.is_file():
        logger.error("Plan file missing on disk: %s", pdf_path)
        raise HTTPException(status_code=410, detail="Fichier introuvable sur le serveur.")

    filename = _sanitize_filename(str(match.get("filename") or f"{plan_id}.pdf"))
    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        filename=filename,
    )


# ============================================
# ADMIN — RESEND CLIENT EMAIL
# ============================================

@router.post("/estimation/admin/{request_id}/resend-client-email")
async def admin_resend_client_email(
    request_id: int,
    user: SeaopUser = Depends(require_role("admin", "super_admin")),
):
    """
    Re-send the estimation confirmation email to the client. Useful when the
    initial send was silently dropped by the provider (Gmail spam, SPF/DKIM
    issues, etc.) or the client reports they never received it.

    Returns {sent: bool, email: str} so the admin UI can show a clear status.
    The admin can then check their SMTP logs if sent=False.

    Rate-limited to RESEND_CLIENT_RATE_LIMIT_MAX per admin per estimation
    per hour — prevents a compromised admin account from harassing a client
    with repeated emails to the same address.
    """
    _check_resend_client_rate_limit(
        str(user.email or user.user_id or "anon"),
        request_id,
    )

    record = db.get_estimation_request(request_id)
    if not record:
        raise HTTPException(status_code=404, detail="Demande non trouvée")

    client_email = record.get("email")
    if not client_email:
        raise HTTPException(
            status_code=400,
            detail="Cette demande n'a pas d'adresse email client.",
        )

    try:
        sent = bool(email.send_estimation_client_confirmation(record))
    except Exception:
        logger.exception(
            "Resend client confirmation failed for estimation id=%s email=%s",
            request_id,
            client_email,
        )
        sent = False

    logger.info(
        "Admin %s resent client email for estimation id=%s to %s — sent=%s",
        user.email or f"user#{user.user_id}",
        request_id,
        client_email,
        sent,
    )
    return {"sent": sent, "email": client_email}
