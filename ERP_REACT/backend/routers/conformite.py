"""
ERP React - Conformite RBQ/CCQ Router
Ported from Streamlit conformite_construction.py (sessions 28+) - full feature parity.

Features:
- Licences RBQ CRUD + filters (26 categories)
- Cartes CCQ CRUD (28 trades with dynamic qualifications)
- Attestations fiscales CRUD + PDF upload (5 types)
- Statistics dashboard with score conformite
- Alerts (expiring within 30/60 days)
- 7 AI Assistant endpoints (Claude Opus 4.6): analyze, chat, verify-project, search-regulations, predict-renewals, generate-rapport, recommend-formations
- Resources (8 organismes + 6 conseils pratiques)
"""

import json
import logging
import os
import re
import time as time_module
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field, model_validator

try:
    import psycopg2  # for IntegrityError pgcode detection
except ImportError:
    psycopg2 = None

from ..erp_auth import ErpUser, get_current_user
from .. import erp_database as db
from .ai import _check_credits, _deduct_credits, check_ai_guard, track_ai_usage
from .conformite_data import (
    AI_SYSTEM_PROMPT,
    CATEGORIES_RBQ,
    CONSEILS_PRATIQUES,
    DEFAULT_ORGANISMES,
    GRAVITE_NON_CONFORMITE,
    METIERS_CCQ,
    NIVEAUX_RISQUE,
    PRIORITES,
    REGIONS_PROJET,
    STATUTS_ATTESTATION,
    STATUTS_CARTE_CCQ,
    STATUTS_LICENCE,
    TYPES_ATTESTATION,
    TYPES_PROJET,
    TYPES_PROJET_FORMATION,
    TYPES_TRAVAUX,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/conformite", tags=["Conformite RBQ/CCQ"])

# Anthropic client for AI Assistant
try:
    import anthropic
    _anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
except (ImportError, Exception) as exc:  # pragma: no cover
    _anthropic_client = None
    logger.warning("Anthropic SDK not available: %s", exc)

CONF_AI_MODEL = "claude-opus-4-7"
CONF_AI_MAX_TOKENS = 32000
# Opus 4.7 pricing with 30% markup: $15/M input, $75/M output,
# $18.75/M cache write, $1.50/M cache read.
CONF_PRICING_INPUT_PER_M = 15.0
CONF_PRICING_OUTPUT_PER_M = 75.0
CONF_PRICING_CACHE_WRITE_PER_M = 18.75
CONF_PRICING_CACHE_READ_PER_M = 1.50
CONF_PRICING_MARKUP = 1.30

# Allowed attestation document MIME types (10 MB limit)
ALLOWED_ATT_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
}
MAX_ATT_SIZE_MB = 10
MAX_ATT_SIZE_BYTES = MAX_ATT_SIZE_MB * 1024 * 1024


# ============================================
# PYDANTIC MODELS
# ============================================


# Per-item string constraint for bounded List[str] fields (prevents DoS via huge items)
ShortStr = Annotated[str, Field(min_length=1, max_length=200)]


def _validate_date_order(emission_field: str, expiration_field: str):
    """Build a model_validator that ensures emission <= expiration if both set.

    Used across licence/carte/attestation models. Raises ValueError which
    Pydantic converts to a 422 response.
    """
    def _check(self):
        emission = getattr(self, emission_field, None)
        expiration = getattr(self, expiration_field, None)
        if emission is not None and expiration is not None and emission > expiration:
            raise ValueError(
                "La date d'emission doit etre anterieure ou egale a la date d'expiration"
            )
        return self
    return _check


class LicenceRbqCreate(BaseModel):
    numero_licence: str = Field(..., min_length=1, max_length=100)
    nom_entreprise: str = Field(..., min_length=1, max_length=255)
    categories: List[ShortStr] = Field(default_factory=list, max_length=30)
    # Use native `date` type so Pydantic validates YYYY-MM-DD format
    # and rejects garbage like "2024-13-45" with a clean 422 response
    # rather than bubbling up a psycopg2 InvalidTextRepresentation as 500.
    date_emission: Optional[date] = None
    date_expiration: Optional[date] = None
    statut: Optional[str] = Field("ACTIVE", max_length=50)
    cautionnement: Optional[float] = Field(0, ge=0, le=1_000_000_000)
    assurance_responsabilite: Optional[float] = Field(0, ge=0, le=1_000_000_000)
    notes: Optional[str] = Field(None, max_length=5000)

    _check_dates = model_validator(mode="after")(
        _validate_date_order("date_emission", "date_expiration")
    )


class LicenceRbqUpdate(BaseModel):
    numero_licence: Optional[str] = Field(None, min_length=1, max_length=100)
    nom_entreprise: Optional[str] = Field(None, min_length=1, max_length=255)
    categories: Optional[List[ShortStr]] = Field(None, max_length=30)
    date_emission: Optional[date] = None
    date_expiration: Optional[date] = None
    statut: Optional[str] = Field(None, max_length=50)
    cautionnement: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    assurance_responsabilite: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    notes: Optional[str] = Field(None, max_length=5000)

    _check_dates = model_validator(mode="after")(
        _validate_date_order("date_emission", "date_expiration")
    )


class CarteCcqCreate(BaseModel):
    employee_id: int = Field(..., ge=1)
    numero_carte: str = Field(..., min_length=1, max_length=100)
    metier_principal: str = Field(..., min_length=1, max_length=100)
    qualification: Optional[str] = Field(None, max_length=100)
    metiers_additionnels: List[ShortStr] = Field(default_factory=list, max_length=30)
    heures_totales: Optional[int] = Field(0, ge=0, le=1_000_000)
    date_emission: Optional[date] = None
    date_renouvellement: Optional[date] = None
    asp_construction: Optional[bool] = False
    statut: Optional[str] = Field("ACTIVE", max_length=50)
    notes: Optional[str] = Field(None, max_length=5000)

    _check_dates = model_validator(mode="after")(
        _validate_date_order("date_emission", "date_renouvellement")
    )


class CarteCcqUpdate(BaseModel):
    numero_carte: Optional[str] = Field(None, min_length=1, max_length=100)
    metier_principal: Optional[str] = Field(None, min_length=1, max_length=100)
    qualification: Optional[str] = Field(None, max_length=100)
    metiers_additionnels: Optional[List[ShortStr]] = Field(None, max_length=30)
    heures_totales: Optional[int] = Field(None, ge=0, le=1_000_000)
    date_emission: Optional[date] = None
    date_renouvellement: Optional[date] = None
    asp_construction: Optional[bool] = None
    statut: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = Field(None, max_length=5000)

    _check_dates = model_validator(mode="after")(
        _validate_date_order("date_emission", "date_renouvellement")
    )


class AttestationCreate(BaseModel):
    type: str = Field(..., min_length=1, max_length=50)
    numero: str = Field(..., min_length=1, max_length=100)
    date_emission: Optional[date] = None
    date_expiration: Optional[date] = None
    statut: Optional[str] = Field("VALIDE", max_length=50)
    notes: Optional[str] = Field(None, max_length=5000)

    _check_dates = model_validator(mode="after")(
        _validate_date_order("date_emission", "date_expiration")
    )


class AttestationUpdate(BaseModel):
    type: Optional[str] = Field(None, min_length=1, max_length=50)
    numero: Optional[str] = Field(None, min_length=1, max_length=100)
    date_emission: Optional[date] = None
    date_expiration: Optional[date] = None
    statut: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = Field(None, max_length=5000)

    _check_dates = model_validator(mode="after")(
        _validate_date_order("date_emission", "date_expiration")
    )


class AiAnalyzeRequest(BaseModel):
    pass  # No input, uses current tenant data


class AiChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    include_context: Optional[bool] = True


class AiVerifyProjectRequest(BaseModel):
    type_projet: str = Field(..., min_length=1, max_length=100)
    valeur: float = Field(..., ge=0, le=1_000_000_000)
    region: str = Field(..., min_length=1, max_length=100)
    travaux: List[ShortStr] = Field(..., min_length=1, max_length=30)


class AiSearchRegulationsRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000)


class AiPredictRenewalsRequest(BaseModel):
    pass  # Uses current tenant data


class AiGenerateRapportRequest(BaseModel):
    pass  # Uses current tenant data


class AiRecommendFormationsRequest(BaseModel):
    projets_prevus: List[ShortStr] = Field(default_factory=list, max_length=20)


# ============================================
# HELPERS
# ============================================

def _serialize(row) -> dict:
    """Convert a DB row (dict-like) to JSON-safe dict."""
    if row is None:
        return {}
    d = dict(row)
    for key, val in list(d.items()):
        if isinstance(val, Decimal):
            d[key] = float(val)
        elif isinstance(val, (date, datetime)):
            d[key] = val.isoformat()
        elif isinstance(val, bytes):
            # Skip binary file_data blobs in serialized rows
            d[key] = None
    return d


def _parse_json_field(value):
    """Parse a JSONB field that may arrive as str or list/dict.

    psycopg2 typically returns JSONB as native Python lists/dicts, but we
    defend against legacy paths (e.g., pre-psycopg2-jsonb drivers, or fields
    stored as TEXT then upgraded) by attempting to parse strings.
    On parse failure we log a warning so data-integrity issues are visible
    rather than silently returning an empty list.
    """
    if value is None:
        return []
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning("_parse_json_field decode error: %s | value=%r", exc, value[:100])
            return []
    return []


def _require_tenant(user: ErpUser):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")


def _safe_rollback(conn) -> None:
    """Rollback a connection without propagating rollback exceptions.

    If rollback itself fails (broken connection, network partition), we log
    and swallow — the outer handler still raises HTTPException, and the
    `finally` block still calls `_close_tenant` which returns the connection
    to the pool after attempting reset_tenant.
    """
    if conn is None:
        return
    try:
        conn.rollback()
    except Exception as exc:
        logger.warning("rollback failed: %s", exc)


def _is_unique_violation(exc: Exception) -> bool:
    """Detect a PostgreSQL unique-constraint violation (SQLSTATE 23505).

    Prefer psycopg2's `pgcode` over string matching — robust across locales
    and versions.
    """
    pgcode = getattr(exc, "pgcode", None)
    if pgcode == "23505":
        return True
    # Fallback: some wrappers may not expose pgcode; check string as last resort
    msg = str(exc).lower()
    return "unique" in msg or "duplicate key" in msg


_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._\-\(\)\[\] ]+")


def _sanitize_filename(name: Optional[str], default: str = "document.pdf") -> str:
    """Return a safe filename for DB storage.

    Strips path separators, control chars, and limits length. Keeps accents
    out for maximum portability (DB has no filesystem, so the name is only
    used for Content-Disposition which is separately sanitized).
    """
    if not name:
        return default
    # Strip any directory traversal and control characters
    base = name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    cleaned = _SAFE_FILENAME_RE.sub("_", base).strip()
    if not cleaned:
        return default
    # Limit to 200 chars (DB column is TEXT but keep reasonable)
    return cleaned[:200]


def _ensure_conformite_tables(cursor, conn):
    """Create conformite tables if absent.

    Uses pg_advisory_xact_lock to serialize concurrent CREATE TABLE IF NOT EXISTS
    calls across workers (PostgreSQL catalog is not fully race-safe: concurrent
    workers hitting an endpoint simultaneously can trigger
    'duplicate key value violates unique constraint pg_type_typname_nsp_index').
    The lock is released automatically at end of transaction.
    """
    try:
        # Arbitrary bigint hash for 'conformite' (distinct from subventions hash)
        cursor.execute("SELECT pg_advisory_xact_lock(1936746615)")
    except Exception as adv_exc:
        logger.warning("pg_advisory_xact_lock(conformite) failed: %s", adv_exc)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS conformite_licences_rbq (
            id SERIAL PRIMARY KEY,
            numero_licence TEXT UNIQUE NOT NULL,
            nom_entreprise TEXT NOT NULL,
            categories JSONB DEFAULT '[]',
            date_emission DATE,
            date_expiration DATE,
            statut TEXT DEFAULT 'ACTIVE',
            cautionnement NUMERIC(15,2) DEFAULT 0,
            assurance_responsabilite NUMERIC(15,2) DEFAULT 0,
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS conformite_cartes_ccq (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL,
            numero_carte TEXT UNIQUE NOT NULL,
            metier_principal TEXT NOT NULL,
            qualification TEXT,
            metiers_additionnels JSONB DEFAULT '[]',
            heures_totales INTEGER DEFAULT 0,
            date_emission DATE,
            date_renouvellement DATE,
            asp_construction BOOLEAN DEFAULT FALSE,
            statut TEXT DEFAULT 'ACTIVE',
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS conformite_attestations (
            id SERIAL PRIMARY KEY,
            type TEXT NOT NULL,
            numero TEXT NOT NULL,
            date_emission DATE,
            date_expiration DATE,
            statut TEXT DEFAULT 'VALIDE',
            fichier_data BYTEA,
            fichier_nom TEXT,
            mime_type TEXT,
            taille INTEGER,
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uq_attestation_type_numero UNIQUE (type, numero)
        )
    """)

    # Indexes for fast expiration queries — wrapped in SAVEPOINT so a
    # concurrent pg_class race on fresh tenants does not abort the txn.
    cursor.execute("SAVEPOINT sp_conf_idx")
    try:
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_conf_licences_expiration "
            "ON conformite_licences_rbq(date_expiration)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_conf_licences_statut "
            "ON conformite_licences_rbq(statut)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_conf_cartes_renouvellement "
            "ON conformite_cartes_ccq(date_renouvellement)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_conf_cartes_employee "
            "ON conformite_cartes_ccq(employee_id)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_conf_attestations_expiration "
            "ON conformite_attestations(date_expiration)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_conf_attestations_type "
            "ON conformite_attestations(type)"
        )
        cursor.execute("RELEASE SAVEPOINT sp_conf_idx")
    except Exception as exc:
        try:
            cursor.execute("ROLLBACK TO SAVEPOINT sp_conf_idx")
        except Exception:
            pass
        _msg = str(exc).lower()
        if not any(tok in _msg for tok in ("duplicate key", "pg_class_relname", "already exists")):
            raise
        logger.warning("conformite indexes race: %s", exc)

    conn.commit()


def _get_tenant_cursor(user: ErpUser):
    """Return (conn, cursor) with tenant context set and tables ensured.

    Forces `autocommit = False` so explicit commit/rollback controls transactions
    even if the connection pool returns an autocommit connection (lecon #131).

    If any step after `db.get_conn()` fails (cursor creation, set_tenant, or
    table DDL), the connection is explicitly closed to prevent pool exhaustion
    under load. Otherwise a broken tenant (missing schema, permission error)
    would leak one connection per request until the pool is empty.
    """
    _require_tenant(user)
    conn = db.get_conn()
    try:
        try:
            conn.autocommit = False
        except Exception as exc:
            logger.warning("conn.autocommit = False failed: %s", exc)
        cursor = conn.cursor()
        db.set_tenant(conn, user.schema)
        _ensure_conformite_tables(cursor, conn)
        return conn, cursor
    except Exception:
        # Explicit cleanup on any failure post get_conn() to avoid leak
        try:
            db.reset_tenant(conn)
        except Exception as reset_exc:
            logger.warning("reset_tenant on exception failed: %s", reset_exc)
        try:
            conn.close()
        except Exception as close_exc:
            logger.warning("conn.close on exception failed: %s", close_exc)
        raise


def _close_tenant(conn, cursor):
    if cursor:
        try:
            cursor.close()
        except Exception as exc:
            logger.warning("cursor close failed: %s", exc)
    if conn:
        try:
            db.reset_tenant(conn)
        except Exception as exc:
            logger.warning("reset_tenant failed: %s", exc)
        try:
            conn.close()
        except Exception as exc:
            logger.warning("conn close failed: %s", exc)


def _serialize_licence(row: dict) -> dict:
    d = _serialize(row)
    d["categories"] = _parse_json_field(row.get("categories") if row else None)
    return d


def _serialize_carte(row: dict) -> dict:
    d = _serialize(row)
    d["metiers_additionnels"] = _parse_json_field(row.get("metiers_additionnels") if row else None)
    return d


def _table_exists(cursor, user: ErpUser, table: str) -> bool:
    cursor.execute(
        "SELECT EXISTS (SELECT FROM information_schema.tables "
        "WHERE table_schema = %s AND table_name = %s)",
        (user.schema, table),
    )
    row = cursor.fetchone()
    return bool(row and row.get("exists", False))


def _calculate_score_conformite(
    licences_actives: int,
    licences_expirees: int,
    cartes_actives: int,
    cartes_expirees: int,
    attestations_valides: int,
    attestations_expirees: int,
) -> int:
    """Compute a 0-100 compliance score.

    Logic: start at 100, subtract 10 per expired licence, 5 per expired CCQ card,
    8 per expired attestation. If nothing is recorded, return 0 (no data).
    """
    total = licences_actives + licences_expirees + cartes_actives + cartes_expirees \
        + attestations_valides + attestations_expirees
    if total == 0:
        return 0
    score = 100
    score -= licences_expirees * 10
    score -= cartes_expirees * 5
    score -= attestations_expirees * 8
    if score < 0:
        score = 0
    if score > 100:
        score = 100
    return score


# ============================================
# METADATA / CONSTANTS
# ============================================

@router.get("/constants")
async def get_constants(user: ErpUser = Depends(get_current_user)):
    """Return all enums/constants needed by the frontend."""
    _require_tenant(user)
    return {
        "statutsLicence": STATUTS_LICENCE,
        "statutsCarteCcq": STATUTS_CARTE_CCQ,
        "statutsAttestation": STATUTS_ATTESTATION,
        "niveauxRisque": NIVEAUX_RISQUE,
        "priorites": PRIORITES,
        "graviteNonConformite": GRAVITE_NON_CONFORMITE,
        "categoriesRbq": CATEGORIES_RBQ,
        "metiersCcq": METIERS_CCQ,
        "typesAttestation": TYPES_ATTESTATION,
        "typesProjet": TYPES_PROJET,
        "regions": REGIONS_PROJET,
        "typesTravaux": TYPES_TRAVAUX,
        "typesProjetFormation": TYPES_PROJET_FORMATION,
    }


@router.get("/resources")
async def get_resources(user: ErpUser = Depends(get_current_user)):
    """Return organismes + conseils pratiques."""
    _require_tenant(user)
    return {
        "organismes": DEFAULT_ORGANISMES,
        "conseils": CONSEILS_PRATIQUES,
    }


# ============================================
# LICENCES RBQ - CRUD
# ============================================

@router.get("/licences")
async def list_licences(
    user: ErpUser = Depends(get_current_user),
    statut: Optional[str] = Query(None, max_length=50),
    categorie: Optional[str] = Query(None, max_length=100),
    search: Optional[str] = Query(None, max_length=200),
):
    """List RBQ licences with optional filters.

    Filter by statut, category (JSONB containment) or text search on name/numero.
    """
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        wheres = []
        params: List = []
        if statut:
            wheres.append("statut = %s")
            params.append(statut)
        if categorie:
            wheres.append("categories @> %s::jsonb")
            params.append(json.dumps([categorie]))
        if search:
            escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            wheres.append("(nom_entreprise ILIKE %s ESCAPE '\\' OR numero_licence ILIKE %s ESCAPE '\\')")
            like = f"%{escaped}%"
            params.extend([like, like])
        where_sql = ("WHERE " + " AND ".join(wheres)) if wheres else ""
        cursor.execute(
            f"""SELECT * FROM conformite_licences_rbq
                {where_sql}
                ORDER BY date_expiration ASC NULLS LAST, id DESC""",
            tuple(params),
        )
        items = [_serialize_licence(row) for row in cursor.fetchall()]
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_licences error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la lecture des licences")
    finally:
        _close_tenant(conn, cursor)


@router.get("/licences/expiring")
async def list_expiring_licences(
    days: int = Query(60, ge=1, le=365),
    user: ErpUser = Depends(get_current_user),
):
    """List licences expiring within N days (default 60)."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            """SELECT * FROM conformite_licences_rbq
               WHERE date_expiration IS NOT NULL
                 AND date_expiration BETWEEN CURRENT_DATE AND CURRENT_DATE + (%s || ' days')::interval
               ORDER BY date_expiration ASC""",
            (str(days),),
        )
        items = [_serialize_licence(row) for row in cursor.fetchall()]
        return {"items": items, "days": days}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_expiring_licences error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        _close_tenant(conn, cursor)


@router.get("/licences/{licence_id}")
async def get_licence(licence_id: int, user: ErpUser = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute("SELECT * FROM conformite_licences_rbq WHERE id = %s", (licence_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Licence introuvable")
        return _serialize_licence(row)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_licence error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        _close_tenant(conn, cursor)


@router.post("/licences")
async def create_licence(body: LicenceRbqCreate, user: ErpUser = Depends(get_current_user)):
    if body.statut and body.statut not in STATUTS_LICENCE:
        raise HTTPException(status_code=400, detail="Statut de licence invalide")
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            """INSERT INTO conformite_licences_rbq (
                numero_licence, nom_entreprise, categories,
                date_emission, date_expiration, statut,
                cautionnement, assurance_responsabilite, notes
            ) VALUES (%s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s)
            RETURNING id""",
            (
                body.numero_licence,
                body.nom_entreprise,
                json.dumps(body.categories or []),
                body.date_emission or None,
                body.date_expiration or None,
                body.statut or "ACTIVE",
                body.cautionnement or 0,
                body.assurance_responsabilite or 0,
                body.notes,
            ),
        )
        row = cursor.fetchone()
        if not row:
            _safe_rollback(conn)
            raise HTTPException(status_code=500, detail="Erreur lors de la creation de la licence")
        conn.commit()
        return {"id": row["id"], "message": "Licence RBQ creee"}
    except HTTPException:
        raise
    except Exception as exc:
        _safe_rollback(conn)
        if _is_unique_violation(exc):
            raise HTTPException(status_code=409, detail="Numero de licence deja existant")
        logger.error("create_licence error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la licence")
    finally:
        _close_tenant(conn, cursor)


@router.put("/licences/{licence_id}")
async def update_licence(
    licence_id: int,
    body: LicenceRbqUpdate,
    user: ErpUser = Depends(get_current_user),
):
    ALLOWED_UPDATE_FIELDS = {
        "numero_licence", "nom_entreprise", "categories",
        "date_emission", "date_expiration", "statut",
        "cautionnement", "assurance_responsabilite", "notes",
    }
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        fields = {k: v for k, v in fields.items() if k in ALLOWED_UPDATE_FIELDS}
        if not fields:
            raise HTTPException(status_code=400, detail="Aucun champ valide a mettre a jour")
        if "statut" in fields and fields["statut"] not in STATUTS_LICENCE:
            raise HTTPException(status_code=400, detail="Statut de licence invalide")

        sets = []
        params: List = []
        for key, val in fields.items():
            if key == "categories":
                sets.append("categories = %s::jsonb")
                params.append(json.dumps(val or []))
            else:
                sets.append(f"{key} = %s")
                params.append(val)
        sets.append("updated_at = CURRENT_TIMESTAMP")
        params.append(licence_id)
        cursor.execute(
            f"UPDATE conformite_licences_rbq SET {', '.join(sets)} WHERE id = %s",
            tuple(params),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Licence introuvable")
        conn.commit()
        return {"id": licence_id, "updated": True}
    except HTTPException:
        raise
    except Exception as exc:
        _safe_rollback(conn)
        if _is_unique_violation(exc):
            raise HTTPException(status_code=409, detail="Numero de licence deja existant")
        logger.error("update_licence error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour")
    finally:
        _close_tenant(conn, cursor)


@router.delete("/licences/{licence_id}")
async def delete_licence(licence_id: int, user: ErpUser = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute("DELETE FROM conformite_licences_rbq WHERE id = %s", (licence_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Licence introuvable")
        conn.commit()
        return {"id": licence_id, "deleted": True}
    except HTTPException:
        raise
    except Exception as exc:
        _safe_rollback(conn)
        logger.error("delete_licence error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression")
    finally:
        _close_tenant(conn, cursor)


# ============================================
# CARTES CCQ - CRUD
# ============================================

@router.get("/cartes")
async def list_cartes(
    user: ErpUser = Depends(get_current_user),
    statut: Optional[str] = Query(None, max_length=50),
    metier: Optional[str] = Query(None, max_length=100),
    search: Optional[str] = Query(None, max_length=200),
):
    """List CCQ cards with optional filters + employee name join."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        wheres = []
        params: List = []
        if statut:
            wheres.append("c.statut = %s")
            params.append(statut)
        if metier:
            wheres.append("c.metier_principal = %s")
            params.append(metier)
        if search:
            escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            wheres.append("(c.numero_carte ILIKE %s ESCAPE '\\' OR c.metier_principal ILIKE %s ESCAPE '\\')")
            like = f"%{escaped}%"
            params.extend([like, like])
        where_sql = ("WHERE " + " AND ".join(wheres)) if wheres else ""

        # JOIN employees only if table exists (new tenants may not have it yet)
        if _table_exists(cursor, user, "employees"):
            cursor.execute(
                f"""SELECT c.*, COALESCE(e.prenom || ' ' || e.nom, '') AS employe_nom
                    FROM conformite_cartes_ccq c
                    LEFT JOIN employees e ON c.employee_id = e.id
                    {where_sql}
                    ORDER BY c.date_renouvellement ASC NULLS LAST, c.id DESC""",
                tuple(params),
            )
        else:
            cursor.execute(
                f"""SELECT *, '' AS employe_nom FROM conformite_cartes_ccq c
                    {where_sql}
                    ORDER BY date_renouvellement ASC NULLS LAST, id DESC""",
                tuple(params),
            )
        items = [_serialize_carte(row) for row in cursor.fetchall()]
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_cartes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la lecture des cartes")
    finally:
        _close_tenant(conn, cursor)


@router.get("/cartes/expiring")
async def list_expiring_cartes(
    days: int = Query(60, ge=1, le=365),
    user: ErpUser = Depends(get_current_user),
):
    """List CCQ cards expiring within N days."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        if _table_exists(cursor, user, "employees"):
            cursor.execute(
                """SELECT c.*, COALESCE(e.prenom || ' ' || e.nom, '') AS employe_nom
                   FROM conformite_cartes_ccq c
                   LEFT JOIN employees e ON c.employee_id = e.id
                   WHERE c.date_renouvellement IS NOT NULL
                     AND c.date_renouvellement BETWEEN CURRENT_DATE AND CURRENT_DATE + (%s || ' days')::interval
                   ORDER BY c.date_renouvellement ASC""",
                (str(days),),
            )
        else:
            cursor.execute(
                """SELECT *, '' AS employe_nom FROM conformite_cartes_ccq
                   WHERE date_renouvellement IS NOT NULL
                     AND date_renouvellement BETWEEN CURRENT_DATE AND CURRENT_DATE + (%s || ' days')::interval
                   ORDER BY date_renouvellement ASC""",
                (str(days),),
            )
        items = [_serialize_carte(row) for row in cursor.fetchall()]
        return {"items": items, "days": days}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_expiring_cartes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        _close_tenant(conn, cursor)


@router.get("/cartes/{carte_id}")
async def get_carte(carte_id: int, user: ErpUser = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        if _table_exists(cursor, user, "employees"):
            cursor.execute(
                """SELECT c.*, COALESCE(e.prenom || ' ' || e.nom, '') AS employe_nom
                   FROM conformite_cartes_ccq c
                   LEFT JOIN employees e ON c.employee_id = e.id
                   WHERE c.id = %s""",
                (carte_id,),
            )
        else:
            cursor.execute("SELECT *, '' AS employe_nom FROM conformite_cartes_ccq WHERE id = %s", (carte_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Carte CCQ introuvable")
        return _serialize_carte(row)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_carte error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        _close_tenant(conn, cursor)


@router.post("/cartes")
async def create_carte(body: CarteCcqCreate, user: ErpUser = Depends(get_current_user)):
    if body.statut and body.statut not in STATUTS_CARTE_CCQ:
        raise HTTPException(status_code=400, detail="Statut de carte invalide")
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        # Validate employee exists if employees table exists
        if _table_exists(cursor, user, "employees"):
            cursor.execute("SELECT 1 FROM employees WHERE id = %s", (body.employee_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Employe introuvable")

        cursor.execute(
            """INSERT INTO conformite_cartes_ccq (
                employee_id, numero_carte, metier_principal, qualification,
                metiers_additionnels, heures_totales,
                date_emission, date_renouvellement, asp_construction,
                statut, notes
            ) VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s)
            RETURNING id""",
            (
                body.employee_id,
                body.numero_carte,
                body.metier_principal,
                body.qualification,
                json.dumps(body.metiers_additionnels or []),
                body.heures_totales or 0,
                body.date_emission or None,
                body.date_renouvellement or None,
                bool(body.asp_construction),
                body.statut or "ACTIVE",
                body.notes,
            ),
        )
        row = cursor.fetchone()
        if not row:
            _safe_rollback(conn)
            raise HTTPException(status_code=500, detail="Erreur lors de la creation de la carte")
        conn.commit()
        return {"id": row["id"], "message": "Carte CCQ creee"}
    except HTTPException:
        raise
    except Exception as exc:
        _safe_rollback(conn)
        if _is_unique_violation(exc):
            raise HTTPException(status_code=409, detail="Numero de carte deja existant")
        logger.error("create_carte error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la carte")
    finally:
        _close_tenant(conn, cursor)


@router.put("/cartes/{carte_id}")
async def update_carte(
    carte_id: int,
    body: CarteCcqUpdate,
    user: ErpUser = Depends(get_current_user),
):
    ALLOWED_UPDATE_FIELDS = {
        "numero_carte", "metier_principal", "qualification", "metiers_additionnels",
        "heures_totales", "date_emission", "date_renouvellement",
        "asp_construction", "statut", "notes",
    }
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        fields = {k: v for k, v in fields.items() if k in ALLOWED_UPDATE_FIELDS}
        if not fields:
            raise HTTPException(status_code=400, detail="Aucun champ valide a mettre a jour")
        if "statut" in fields and fields["statut"] not in STATUTS_CARTE_CCQ:
            raise HTTPException(status_code=400, detail="Statut de carte invalide")

        sets = []
        params: List = []
        for key, val in fields.items():
            if key == "metiers_additionnels":
                sets.append("metiers_additionnels = %s::jsonb")
                params.append(json.dumps(val or []))
            else:
                sets.append(f"{key} = %s")
                params.append(val)
        sets.append("updated_at = CURRENT_TIMESTAMP")
        params.append(carte_id)
        cursor.execute(
            f"UPDATE conformite_cartes_ccq SET {', '.join(sets)} WHERE id = %s",
            tuple(params),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Carte CCQ introuvable")
        conn.commit()
        return {"id": carte_id, "updated": True}
    except HTTPException:
        raise
    except Exception as exc:
        _safe_rollback(conn)
        if _is_unique_violation(exc):
            raise HTTPException(status_code=409, detail="Numero de carte deja existant")
        logger.error("update_carte error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour")
    finally:
        _close_tenant(conn, cursor)


@router.delete("/cartes/{carte_id}")
async def delete_carte(carte_id: int, user: ErpUser = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute("DELETE FROM conformite_cartes_ccq WHERE id = %s", (carte_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Carte CCQ introuvable")
        conn.commit()
        return {"id": carte_id, "deleted": True}
    except HTTPException:
        raise
    except Exception as exc:
        _safe_rollback(conn)
        logger.error("delete_carte error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression")
    finally:
        _close_tenant(conn, cursor)


# ============================================
# ATTESTATIONS - CRUD + Upload PDF
# ============================================

@router.get("/attestations")
async def list_attestations(
    user: ErpUser = Depends(get_current_user),
    statut: Optional[str] = Query(None, max_length=50),
    type_attestation: Optional[str] = Query(None, alias="type", max_length=50),
):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        wheres = []
        params: List = []
        if statut:
            wheres.append("statut = %s")
            params.append(statut)
        if type_attestation:
            wheres.append("type = %s")
            params.append(type_attestation)
        where_sql = ("WHERE " + " AND ".join(wheres)) if wheres else ""
        cursor.execute(
            f"""SELECT id, type, numero, date_emission, date_expiration,
                       statut, fichier_nom, mime_type, taille, notes,
                       created_at, updated_at
                FROM conformite_attestations
                {where_sql}
                ORDER BY date_expiration ASC NULLS LAST, id DESC""",
            tuple(params),
        )
        items = [_serialize(row) for row in cursor.fetchall()]
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_attestations error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la lecture des attestations")
    finally:
        _close_tenant(conn, cursor)


@router.get("/attestations/expiring")
async def list_expiring_attestations(
    days: int = Query(30, ge=1, le=365),
    user: ErpUser = Depends(get_current_user),
):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            """SELECT id, type, numero, date_emission, date_expiration,
                      statut, fichier_nom, mime_type, taille, notes,
                      created_at, updated_at
               FROM conformite_attestations
               WHERE date_expiration IS NOT NULL
                 AND date_expiration BETWEEN CURRENT_DATE AND CURRENT_DATE + (%s || ' days')::interval
               ORDER BY date_expiration ASC""",
            (str(days),),
        )
        items = [_serialize(row) for row in cursor.fetchall()]
        return {"items": items, "days": days}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_expiring_attestations error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        _close_tenant(conn, cursor)


@router.get("/attestations/{attestation_id}")
async def get_attestation(attestation_id: int, user: ErpUser = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            """SELECT id, type, numero, date_emission, date_expiration,
                      statut, fichier_nom, mime_type, taille, notes,
                      created_at, updated_at
               FROM conformite_attestations WHERE id = %s""",
            (attestation_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Attestation introuvable")
        return _serialize(row)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_attestation error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        _close_tenant(conn, cursor)


@router.post("/attestations")
async def create_attestation(body: AttestationCreate, user: ErpUser = Depends(get_current_user)):
    if body.statut and body.statut not in STATUTS_ATTESTATION:
        raise HTTPException(status_code=400, detail="Statut d'attestation invalide")
    valid_types = {t["code"] for t in TYPES_ATTESTATION}
    if body.type not in valid_types:
        raise HTTPException(status_code=400, detail="Type d'attestation invalide")
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            """INSERT INTO conformite_attestations (
                type, numero, date_emission, date_expiration, statut, notes
            ) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
            (
                body.type,
                body.numero,
                body.date_emission or None,
                body.date_expiration or None,
                body.statut or "VALIDE",
                body.notes,
            ),
        )
        row = cursor.fetchone()
        if not row:
            _safe_rollback(conn)
            raise HTTPException(status_code=500, detail="Erreur lors de la creation de l'attestation")
        conn.commit()
        return {"id": row["id"], "message": "Attestation creee"}
    except HTTPException:
        raise
    except Exception as exc:
        _safe_rollback(conn)
        if _is_unique_violation(exc):
            raise HTTPException(
                status_code=409,
                detail="Attestation deja existante (meme type et numero)",
            )
        logger.error("create_attestation error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la creation")
    finally:
        _close_tenant(conn, cursor)


@router.put("/attestations/{attestation_id}")
async def update_attestation(
    attestation_id: int,
    body: AttestationUpdate,
    user: ErpUser = Depends(get_current_user),
):
    ALLOWED_UPDATE_FIELDS = {"type", "numero", "date_emission", "date_expiration", "statut", "notes"}
    valid_types = {t["code"] for t in TYPES_ATTESTATION}
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        fields = {k: v for k, v in fields.items() if k in ALLOWED_UPDATE_FIELDS}
        if not fields:
            raise HTTPException(status_code=400, detail="Aucun champ valide a mettre a jour")
        if "statut" in fields and fields["statut"] not in STATUTS_ATTESTATION:
            raise HTTPException(status_code=400, detail="Statut d'attestation invalide")
        if "type" in fields and fields["type"] not in valid_types:
            raise HTTPException(status_code=400, detail="Type d'attestation invalide")

        sets = [f"{k} = %s" for k in fields]
        params = list(fields.values())
        sets.append("updated_at = CURRENT_TIMESTAMP")
        params.append(attestation_id)
        cursor.execute(
            f"UPDATE conformite_attestations SET {', '.join(sets)} WHERE id = %s",
            tuple(params),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Attestation introuvable")
        conn.commit()
        return {"id": attestation_id, "updated": True}
    except HTTPException:
        raise
    except Exception as exc:
        _safe_rollback(conn)
        if _is_unique_violation(exc):
            raise HTTPException(
                status_code=409,
                detail="Attestation deja existante (meme type et numero)",
            )
        logger.error("update_attestation error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour")
    finally:
        _close_tenant(conn, cursor)


@router.delete("/attestations/{attestation_id}")
async def delete_attestation(attestation_id: int, user: ErpUser = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute("DELETE FROM conformite_attestations WHERE id = %s", (attestation_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Attestation introuvable")
        conn.commit()
        return {"id": attestation_id, "deleted": True}
    except HTTPException:
        raise
    except Exception as exc:
        _safe_rollback(conn)
        logger.error("delete_attestation error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression")
    finally:
        _close_tenant(conn, cursor)


@router.post("/attestations/{attestation_id}/upload")
async def upload_attestation_file(
    attestation_id: int,
    file: UploadFile = File(...),
    user: ErpUser = Depends(get_current_user),
):
    """Attach a PDF/image to an existing attestation."""
    # Reject MIME type + file size BEFORE reading body
    if file.content_type not in ALLOWED_ATT_MIME:
        raise HTTPException(status_code=415, detail="Type de fichier non autorise (PDF/JPG/PNG/WebP seulement)")
    if file.size is not None and file.size > MAX_ATT_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Fichier trop volumineux (max {MAX_ATT_SIZE_MB} Mo)",
        )

    conn = None
    cursor = None
    try:
        data = await file.read()
        if len(data) > MAX_ATT_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Fichier trop volumineux (max {MAX_ATT_SIZE_MB} Mo)",
            )

        # Sanitize filename before DB storage (defense in depth — download path
        # also sanitizes the Content-Disposition header, but we don't want
        # raw user input persisted either).
        safe_name = _sanitize_filename(file.filename)

        conn, cursor = _get_tenant_cursor(user)
        cursor.execute("SELECT id FROM conformite_attestations WHERE id = %s", (attestation_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Attestation introuvable")

        cursor.execute(
            """UPDATE conformite_attestations
               SET fichier_data = %s, fichier_nom = %s, mime_type = %s, taille = %s,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = %s""",
            (data, safe_name, file.content_type, len(data), attestation_id),
        )
        # Detect race: attestation deleted between SELECT and UPDATE
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Attestation introuvable")
        conn.commit()
        return {
            "id": attestation_id,
            "fichier_nom": safe_name,
            "mime_type": file.content_type,
            "taille": len(data),
            "uploaded": True,
        }
    except HTTPException:
        raise
    except Exception as exc:
        _safe_rollback(conn)
        logger.error("upload_attestation_file error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du televersement")
    finally:
        _close_tenant(conn, cursor)


@router.get("/attestations/{attestation_id}/download")
async def download_attestation_file(
    attestation_id: int,
    user: ErpUser = Depends(get_current_user),
):
    """Download the attached file of an attestation."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            """SELECT fichier_data, fichier_nom, mime_type
               FROM conformite_attestations WHERE id = %s""",
            (attestation_id,),
        )
        row = cursor.fetchone()
        # Use `is None` rather than truthiness: an empty BYTEA (b"") is
        # falsy but still a legitimate file (e.g., zero-byte placeholder).
        if not row or row.get("fichier_data") is None:
            raise HTTPException(status_code=404, detail="Fichier introuvable")

        # Re-validate MIME type at download time as defense-in-depth.
        # A stored value outside the whitelist could result from a schema
        # bypass or legacy data — serve as generic octet-stream to prevent
        # the browser from auto-executing dangerous types.
        stored_mime = row.get("mime_type") or ""
        served_mime = stored_mime if stored_mime in ALLOWED_ATT_MIME else "application/octet-stream"

        raw_name = row.get("fichier_nom") or "document.bin"
        # Sanitize filename against header injection (RFC 5987 + ASCII fallback)
        ascii_name = "".join(
            c if 32 <= ord(c) < 127 and c not in ('"', '\\', "\r", "\n") else "_"
            for c in raw_name
        ) or "document.bin"
        utf8_name = quote(raw_name, safe="")
        # `bytes(None)` raises TypeError — guard even though the NULL check
        # above already filters, in case a future refactor removes it.
        raw = row["fichier_data"]
        return Response(
            content=bytes(raw) if raw else b"",
            media_type=served_mime,
            headers={
                "Content-Disposition": (
                    f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{utf8_name}'
                )
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("download_attestation_file error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du telechargement")
    finally:
        _close_tenant(conn, cursor)


# ============================================
# STATISTICS & ALERTS
# ============================================

@router.get("/statistics")
async def get_statistics(user: ErpUser = Depends(get_current_user)):
    """Return KPIs + score conformite global + alerts."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        stats = {
            "total_licences": 0,
            "licences_actives": 0,
            "licences_expirees": 0,
            "licences_a_renouveler": 0,
            "total_cartes": 0,
            "cartes_actives": 0,
            "cartes_expirees": 0,
            "cartes_a_renouveler": 0,
            "total_attestations": 0,
            "attestations_valides": 0,
            "attestations_expirees": 0,
            "attestations_a_renouveler": 0,
            "cautionnement_total": 0.0,
            "assurance_totale": 0.0,
            "score_conformite": 0,
            "repartition_licences_categorie": [],
            "repartition_cartes_metier": [],
            "repartition_attestations_type": [],
        }

        # Licences
        cursor.execute(
            """SELECT
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN statut = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS actives,
                COALESCE(SUM(CASE WHEN statut = 'EXPIREE' OR (date_expiration IS NOT NULL AND date_expiration < CURRENT_DATE) THEN 1 ELSE 0 END), 0) AS expirees,
                COALESCE(SUM(CASE WHEN date_expiration IS NOT NULL AND date_expiration BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days' THEN 1 ELSE 0 END), 0) AS a_renouveler,
                COALESCE(SUM(cautionnement), 0) AS caut,
                COALESCE(SUM(assurance_responsabilite), 0) AS assur
               FROM conformite_licences_rbq"""
        )
        row = cursor.fetchone() or {}
        stats["total_licences"] = int(row.get("total") or 0)
        stats["licences_actives"] = int(row.get("actives") or 0)
        stats["licences_expirees"] = int(row.get("expirees") or 0)
        stats["licences_a_renouveler"] = int(row.get("a_renouveler") or 0)
        stats["cautionnement_total"] = float(row.get("caut") or 0)
        stats["assurance_totale"] = float(row.get("assur") or 0)

        # Cartes CCQ
        cursor.execute(
            """SELECT
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN statut = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS actives,
                COALESCE(SUM(CASE WHEN statut = 'EXPIREE' OR (date_renouvellement IS NOT NULL AND date_renouvellement < CURRENT_DATE) THEN 1 ELSE 0 END), 0) AS expirees,
                COALESCE(SUM(CASE WHEN date_renouvellement IS NOT NULL AND date_renouvellement BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days' THEN 1 ELSE 0 END), 0) AS a_renouveler
               FROM conformite_cartes_ccq"""
        )
        row = cursor.fetchone() or {}
        stats["total_cartes"] = int(row.get("total") or 0)
        stats["cartes_actives"] = int(row.get("actives") or 0)
        stats["cartes_expirees"] = int(row.get("expirees") or 0)
        stats["cartes_a_renouveler"] = int(row.get("a_renouveler") or 0)

        # Attestations
        cursor.execute(
            """SELECT
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN statut = 'VALIDE' THEN 1 ELSE 0 END), 0) AS valides,
                COALESCE(SUM(CASE WHEN statut = 'EXPIREE' OR (date_expiration IS NOT NULL AND date_expiration < CURRENT_DATE) THEN 1 ELSE 0 END), 0) AS expirees,
                COALESCE(SUM(CASE WHEN date_expiration IS NOT NULL AND date_expiration BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' THEN 1 ELSE 0 END), 0) AS a_renouveler
               FROM conformite_attestations"""
        )
        row = cursor.fetchone() or {}
        stats["total_attestations"] = int(row.get("total") or 0)
        stats["attestations_valides"] = int(row.get("valides") or 0)
        stats["attestations_expirees"] = int(row.get("expirees") or 0)
        stats["attestations_a_renouveler"] = int(row.get("a_renouveler") or 0)

        # Score conformite global
        stats["score_conformite"] = _calculate_score_conformite(
            stats["licences_actives"], stats["licences_expirees"],
            stats["cartes_actives"], stats["cartes_expirees"],
            stats["attestations_valides"], stats["attestations_expirees"],
        )

        # Repartition par categorie RBQ (JSONB array unnest).
        # COALESCE defends against legacy rows where categories got set to
        # NULL instead of '[]' — LATERAL with NULL yields zero rows, which
        # would silently hide those licences from the repartition count.
        cursor.execute(
            """SELECT categorie, COUNT(*) AS nombre
               FROM conformite_licences_rbq,
                    LATERAL jsonb_array_elements_text(
                        COALESCE(categories, '[]'::jsonb)
                    ) AS categorie
               GROUP BY categorie
               ORDER BY nombre DESC"""
        )
        stats["repartition_licences_categorie"] = [
            {"categorie": r["categorie"] or "Non specifie", "nombre": int(r["nombre"])}
            for r in cursor.fetchall()
        ]

        # Repartition par metier (cartes CCQ)
        cursor.execute(
            """SELECT metier_principal AS metier, COUNT(*) AS nombre
               FROM conformite_cartes_ccq
               GROUP BY metier_principal
               ORDER BY nombre DESC"""
        )
        stats["repartition_cartes_metier"] = [
            {"metier": r["metier"] or "Non specifie", "nombre": int(r["nombre"])}
            for r in cursor.fetchall()
        ]

        # Repartition par type (attestations)
        cursor.execute(
            """SELECT type, COUNT(*) AS nombre
               FROM conformite_attestations
               GROUP BY type
               ORDER BY nombre DESC"""
        )
        stats["repartition_attestations_type"] = [
            {"type": r["type"] or "Non specifie", "nombre": int(r["nombre"])}
            for r in cursor.fetchall()
        ]

        return stats
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_statistics error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du calcul des statistiques")
    finally:
        _close_tenant(conn, cursor)


@router.get("/alertes")
async def list_alertes(user: ErpUser = Depends(get_current_user)):
    """Return all active alerts (expiring licences/cards/attestations, expired items)."""
    conn = None
    cursor = None
    alertes = []
    try:
        conn, cursor = _get_tenant_cursor(user)

        # Expired licences
        cursor.execute(
            """SELECT id, numero_licence, nom_entreprise, date_expiration
               FROM conformite_licences_rbq
               WHERE date_expiration IS NOT NULL AND date_expiration < CURRENT_DATE
               ORDER BY date_expiration DESC LIMIT 20"""
        )
        for row in cursor.fetchall():
            alertes.append({
                "type": "LICENCE_EXPIREE",
                "priorite": "HAUTE",
                "item_id": row["id"],
                "message": f"Licence RBQ {row['numero_licence']} ({row['nom_entreprise']}) expiree depuis le {row['date_expiration']}",
                "date_reference": row["date_expiration"].isoformat() if row["date_expiration"] else None,
            })

        # Expiring licences (next 60 days)
        cursor.execute(
            """SELECT id, numero_licence, nom_entreprise, date_expiration
               FROM conformite_licences_rbq
               WHERE date_expiration IS NOT NULL
                 AND date_expiration BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days'
               ORDER BY date_expiration ASC LIMIT 20"""
        )
        for row in cursor.fetchall():
            alertes.append({
                "type": "LICENCE_EXPIRE_BIENTOT",
                "priorite": "MOYENNE",
                "item_id": row["id"],
                "message": f"Licence RBQ {row['numero_licence']} expire le {row['date_expiration']}",
                "date_reference": row["date_expiration"].isoformat() if row["date_expiration"] else None,
            })

        # Expired CCQ cards
        cursor.execute(
            """SELECT id, numero_carte, metier_principal, date_renouvellement
               FROM conformite_cartes_ccq
               WHERE date_renouvellement IS NOT NULL AND date_renouvellement < CURRENT_DATE
               ORDER BY date_renouvellement DESC LIMIT 20"""
        )
        for row in cursor.fetchall():
            alertes.append({
                "type": "CARTE_EXPIREE",
                "priorite": "HAUTE",
                "item_id": row["id"],
                "message": f"Carte CCQ {row['numero_carte']} ({row['metier_principal']}) expiree",
                "date_reference": row["date_renouvellement"].isoformat() if row["date_renouvellement"] else None,
            })

        # Expiring CCQ cards (next 60 days)
        cursor.execute(
            """SELECT id, numero_carte, metier_principal, date_renouvellement
               FROM conformite_cartes_ccq
               WHERE date_renouvellement IS NOT NULL
                 AND date_renouvellement BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days'
               ORDER BY date_renouvellement ASC LIMIT 20"""
        )
        for row in cursor.fetchall():
            alertes.append({
                "type": "CARTE_EXPIRE_BIENTOT",
                "priorite": "MOYENNE",
                "item_id": row["id"],
                "message": f"Carte CCQ {row['numero_carte']} a renouveler",
                "date_reference": row["date_renouvellement"].isoformat() if row["date_renouvellement"] else None,
            })

        # Expired/expiring attestations
        cursor.execute(
            """SELECT id, type, numero, date_expiration
               FROM conformite_attestations
               WHERE date_expiration IS NOT NULL AND date_expiration < CURRENT_DATE
               ORDER BY date_expiration DESC LIMIT 20"""
        )
        for row in cursor.fetchall():
            alertes.append({
                "type": "ATTESTATION_EXPIREE",
                "priorite": "HAUTE",
                "item_id": row["id"],
                "message": f"Attestation {row['type']} ({row['numero']}) expiree",
                "date_reference": row["date_expiration"].isoformat() if row["date_expiration"] else None,
            })

        cursor.execute(
            """SELECT id, type, numero, date_expiration
               FROM conformite_attestations
               WHERE date_expiration IS NOT NULL
                 AND date_expiration BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
               ORDER BY date_expiration ASC LIMIT 20"""
        )
        for row in cursor.fetchall():
            alertes.append({
                "type": "ATTESTATION_EXPIRE_BIENTOT",
                "priorite": "MOYENNE",
                "item_id": row["id"],
                "message": f"Attestation {row['type']} ({row['numero']}) expire le {row['date_expiration']}",
                "date_reference": row["date_expiration"].isoformat() if row["date_expiration"] else None,
            })

        return {"items": alertes, "total": len(alertes)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_alertes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la lecture des alertes")
    finally:
        _close_tenant(conn, cursor)


# ============================================
# AI ASSISTANT HELPERS
# ============================================

def _guard_ai(user: ErpUser):
    """Run billing guard + credit check. Raises HTTPException on failure."""
    if not _anthropic_client:
        raise HTTPException(status_code=503, detail="Service IA non disponible")
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")
    credits_ok, _balance = _check_credits(user)
    if not credits_ok:
        raise HTTPException(
            status_code=402,
            detail="Credits IA epuises. Veuillez recharger votre solde pour continuer.",
        )


def _ai_cost(
    input_tokens: int,
    output_tokens: int,
    cache_creation_tokens: int = 0,
    cache_read_tokens: int = 0,
) -> float:
    # Opus 4.7: $15/M input, $75/M output, $18.75/M cache write, $1.50/M cache read.
    return (
        input_tokens * CONF_PRICING_INPUT_PER_M / 1_000_000
        + output_tokens * CONF_PRICING_OUTPUT_PER_M / 1_000_000
        + cache_creation_tokens * CONF_PRICING_CACHE_WRITE_PER_M / 1_000_000
        + cache_read_tokens * CONF_PRICING_CACHE_READ_PER_M / 1_000_000
    ) * CONF_PRICING_MARKUP


def _call_claude_json(user: ErpUser, feature: str, prompt: str, temperature: float = 0.3) -> dict:
    """Call Claude Opus with a prompt expected to return JSON. Returns parsed dict."""
    _guard_ai(user)
    start = time_module.time()
    try:
        response = _anthropic_client.messages.create(
            model=CONF_AI_MODEL,
            max_tokens=CONF_AI_MAX_TOKENS,
            temperature=temperature,
            system=AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
    except HTTPException:
        raise
    except Exception as exc:
        msg = str(exc).lower()
        if "overload" in msg or "529" in msg:
            logger.warning("Claude overload (%s): %s", feature, exc)
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge. Reessayer dans quelques instants.")
        if "too_large" in msg or "413" in msg:
            logger.warning("Claude too_large (%s): %s", feature, exc)
            raise HTTPException(status_code=413, detail="Requete trop volumineuse pour l'IA.")
        logger.error("Claude API error (%s): %s", feature, exc)
        raise HTTPException(status_code=502, detail="Service IA temporairement indisponible")

    elapsed = time_module.time() - start
    input_tokens = getattr(response.usage, "input_tokens", 0)
    output_tokens = getattr(response.usage, "output_tokens", 0)
    cache_creation_tokens = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
    cache_read_tokens = getattr(response.usage, "cache_read_input_tokens", 0) or 0
    cost = _ai_cost(input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens)

    text = ""
    for block in response.content:
        if hasattr(block, "text"):
            text += block.text
    text = text.strip()

    # Strip markdown code block wrapper if present (``` or ```lang).
    # Handles any language identifier on the first line, not just "json",
    # e.g. ```python, ```javascript, ```c++, or even plain ``` with no tag.
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) >= 2:
            inner = parts[1]
            first_nl = inner.find("\n")
            if first_nl != -1:
                first_line = inner[:first_nl].strip()
                # Drop first line if it does NOT look like JSON/dict/array start.
                # This catches any language tag (json, python, c++, etc.) but
                # preserves content when the response has no language hint.
                if first_line and not first_line.startswith(("{", "[", '"')):
                    inner = inner[first_nl + 1:]
            text = inner.strip()

    # Validate JSON BEFORE billing (do not charge users for malformed responses).
    # Reject empty responses explicitly: previously `{}` would silently pass,
    # masking complete AI failures (Claude crashed, empty text, refused).
    if not text:
        logger.error("AI empty response (%s)", feature)
        raise HTTPException(status_code=502, detail="Reponse IA vide, veuillez reessayer")
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.error("AI JSON parse error (%s): %s | text=%r", feature, exc, text[:500])
        raise HTTPException(status_code=502, detail="Reponse IA invalide, veuillez reessayer")
    if not isinstance(parsed, dict):
        logger.error("AI JSON must be a dict (%s), got %s: %r",
                     feature, type(parsed).__name__, text[:500])
        raise HTTPException(status_code=502, detail="Reponse IA invalide (format inattendu)")

    # Track usage and deduct credits only after successful validation
    try:
        track_ai_usage(
            user, feature, input_tokens, output_tokens, cost,
            int(elapsed * 1000), success=True, model=CONF_AI_MODEL,
        )
        _deduct_credits(user, cost)
    except Exception as track_exc:
        logger.warning("track_ai_usage failed (%s): %s", feature, track_exc)

    return parsed


def _call_claude_text(user: ErpUser, feature: str, prompt: str, temperature: float = 0.3) -> str:
    """Call Claude Opus for plain text response (chat)."""
    _guard_ai(user)
    start = time_module.time()
    try:
        response = _anthropic_client.messages.create(
            model=CONF_AI_MODEL,
            max_tokens=CONF_AI_MAX_TOKENS,
            temperature=temperature,
            system=AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
    except HTTPException:
        raise
    except Exception as exc:
        msg = str(exc).lower()
        if "overload" in msg or "529" in msg:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge. Reessayer dans quelques instants.")
        if "too_large" in msg or "413" in msg:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse pour l'IA.")
        logger.error("Claude API error (%s): %s", feature, exc)
        raise HTTPException(status_code=502, detail="Service IA temporairement indisponible")

    elapsed = time_module.time() - start
    input_tokens = getattr(response.usage, "input_tokens", 0)
    output_tokens = getattr(response.usage, "output_tokens", 0)
    cache_creation_tokens = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
    cache_read_tokens = getattr(response.usage, "cache_read_input_tokens", 0) or 0
    cost = _ai_cost(input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens)

    text = ""
    for block in response.content:
        if hasattr(block, "text"):
            text += block.text
    text = text.strip()

    # Reject empty responses (Claude refused, crashed, or returned only whitespace)
    # BEFORE billing — don't charge users for a no-op response.
    if not text:
        logger.error("AI empty text response (%s)", feature)
        raise HTTPException(status_code=502, detail="Reponse IA vide, veuillez reessayer")

    try:
        track_ai_usage(
            user, feature, input_tokens, output_tokens, cost,
            int(elapsed * 1000), success=True, model=CONF_AI_MODEL,
        )
        _deduct_credits(user, cost)
    except Exception as track_exc:
        logger.warning("track_ai_usage failed (%s): %s", feature, track_exc)

    return text


def _fetch_tenant_context(cursor) -> dict:
    """Fetch current tenant licences/cartes/attestations for AI context."""
    cursor.execute(
        """SELECT numero_licence, nom_entreprise, categories, statut, date_expiration
           FROM conformite_licences_rbq ORDER BY date_expiration ASC NULLS LAST LIMIT 30"""
    )
    licences = [_serialize_licence(r) for r in cursor.fetchall()]

    cursor.execute(
        """SELECT numero_carte, metier_principal, qualification, statut, date_renouvellement
           FROM conformite_cartes_ccq ORDER BY date_renouvellement ASC NULLS LAST LIMIT 50"""
    )
    cartes = [_serialize_carte(r) for r in cursor.fetchall()]

    cursor.execute(
        """SELECT type, numero, statut, date_expiration
           FROM conformite_attestations ORDER BY date_expiration ASC NULLS LAST LIMIT 20"""
    )
    attestations = [_serialize(r) for r in cursor.fetchall()]

    return {"licences": licences, "cartes": cartes, "attestations": attestations}


# ============================================
# AI ENDPOINTS (7 features)
# ============================================

@router.post("/ai/analyze")
async def ai_analyze_conformite(user: ErpUser = Depends(get_current_user)):
    """AI: full compliance analysis with score, risks, recommendations."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        ctx = _fetch_tenant_context(cursor)
    finally:
        _close_tenant(conn, cursor)

    lic_list = ctx["licences"]
    carte_list = ctx["cartes"]
    att_list = ctx["attestations"]

    context_text = f"""ANALYSE DE CONFORMITE RBQ/CCQ

LICENCES RBQ ({len(lic_list)}):
"""
    for lic in lic_list[:10]:
        cats = ", ".join(lic.get("categories", [])[:5])
        context_text += f"- {lic.get('numero_licence', 'N/A')}: {lic.get('nom_entreprise', 'N/A')} | Categories: {cats} | Statut: {lic.get('statut', 'N/A')} | Expiration: {lic.get('date_expiration', 'N/A')}\n"

    context_text += f"\nCARTES CCQ ({len(carte_list)}):\n"
    for carte in carte_list[:15]:
        context_text += f"- {carte.get('numero_carte', 'N/A')}: {carte.get('metier_principal', 'N/A')} ({carte.get('qualification', 'N/A')}) | Statut: {carte.get('statut', 'N/A')} | Renouvellement: {carte.get('date_renouvellement', 'N/A')}\n"

    context_text += f"\nATTESTATIONS ({len(att_list)}):\n"
    for att in att_list[:10]:
        context_text += f"- {att.get('type', 'N/A')} #{att.get('numero', 'N/A')} | Statut: {att.get('statut', 'N/A')} | Expiration: {att.get('date_expiration', 'N/A')}\n"

    prompt = f"""Analyse cette situation de conformite RBQ/CCQ et fournis une evaluation complete.

{context_text}

Reponds en JSON strict (sans markdown):
{{
    "score_conformite": 0-100,
    "niveau_risque": "faible/moyen/eleve/critique",
    "resume": "Resume en 2-3 phrases",
    "points_conformes": ["point 1", "point 2"],
    "non_conformites": [
        {{"element": "description", "gravite": "mineure/majeure/critique", "action": "action corrective"}}
    ],
    "risques_identifies": [
        {{"risque": "description", "probabilite": "faible/moyenne/elevee", "impact": "description"}}
    ],
    "renouvellements_urgents": [
        {{"element": "licence/carte/attestation", "echeance": "date", "action": "action requise"}}
    ],
    "recommandations": [
        {{"priorite": "haute/moyenne/basse", "action": "description", "delai": "immediat/court terme/moyen terme"}}
    ],
    "estimation_couts_mise_conformite": "estimation si applicable"
}}"""
    return _call_claude_json(user, "conformite_analyze", prompt, temperature=0.3)


@router.post("/ai/chat")
async def ai_chat(body: AiChatRequest, user: ErpUser = Depends(get_current_user)):
    """AI: conversational chat with RBQ/CCQ expert."""
    _require_tenant(user)
    # Strip whitespace to prevent prompt padding attacks where leading/trailing
    # whitespace could be used to confuse the model about the real query start.
    question = (body.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question requise")

    context_line = ""
    if body.include_context:
        conn = None
        cursor = None
        try:
            conn, cursor = _get_tenant_cursor(user)
            cursor.execute("SELECT COUNT(*) AS n FROM conformite_licences_rbq WHERE statut = 'ACTIVE'")
            row = cursor.fetchone() or {}
            nb_lic = int(row.get("n") or 0)
            cursor.execute("SELECT COUNT(*) AS n FROM conformite_cartes_ccq WHERE statut = 'ACTIVE'")
            row = cursor.fetchone() or {}
            nb_car = int(row.get("n") or 0)
            cursor.execute("SELECT COUNT(*) AS n FROM conformite_attestations WHERE statut = 'VALIDE'")
            row = cursor.fetchone() or {}
            nb_att = int(row.get("n") or 0)
            context_line = (
                f"CONTEXTE ACTUEL DU TENANT:\n"
                f"- Licences RBQ actives: {nb_lic}\n"
                f"- Cartes CCQ actives: {nb_car}\n"
                f"- Attestations valides: {nb_att}\n\n"
            )
        finally:
            _close_tenant(conn, cursor)

    # Wrap user input in XML tags for prompt-injection defense-in-depth.
    # Anthropic's best practices recommend delimiters around untrusted input
    # so the model treats them as data rather than instructions.
    prompt = f"""{context_line}<user_question>
{question}
</user_question>

Reponds a la question ci-dessus de maniere claire, precise et professionnelle
en francais quebecois. Cite les articles de loi ou reglements pertinents si
approprie. Si la question n'est pas liee a la conformite RBQ/CCQ, redirige
poliment vers le sujet."""
    text = _call_claude_text(user, "conformite_chat", prompt, temperature=0.4)
    return {"response": text}


@router.post("/ai/verify-project")
async def ai_verify_project(body: AiVerifyProjectRequest, user: ErpUser = Depends(get_current_user)):
    """AI: verify regulatory requirements for a project."""
    _require_tenant(user)
    # Strip + XML wrap user-supplied project fields (defense-in-depth).
    # Pydantic min_length=1 allows whitespace-only strings; re-validate after
    # strip to reject empty inputs with a clean 400 rather than feeding an
    # empty field to the AI prompt.
    type_projet = (body.type_projet or "").strip()
    region = (body.region or "").strip()
    travaux_clean = [t.strip() for t in (body.travaux or []) if t and t.strip()]
    if not type_projet:
        raise HTTPException(status_code=400, detail="Type de projet requis")
    if not region:
        raise HTTPException(status_code=400, detail="Region requise")
    if not travaux_clean:
        raise HTTPException(status_code=400, detail="Au moins un type de travaux est requis")
    travaux_str = ", ".join(travaux_clean)
    prompt = f"""Analyse les exigences reglementaires RBQ/CCQ pour ce projet:

<project_details>
TYPE DE PROJET: {type_projet}
VALEUR ESTIMEE: {body.valeur:,.2f} $
REGION: {region}
TRAVAUX PREVUS: {travaux_str}
</project_details>

Determine TOUTES les exigences legales applicables.

Reponds en JSON strict (sans markdown):
{{
    "licences_rbq_requises": [
        {{"categorie": "X.X", "description": "description", "obligatoire": true}}
    ],
    "metiers_ccq_requis": [
        {{"metier": "nom", "nombre_estime": 0, "qualification": "compagnon/apprenti"}}
    ],
    "permis_requis": [
        {{"type": "permis", "organisme": "municipal/provincial", "description": "details"}}
    ],
    "attestations_requises": [
        {{"type": "attestation", "organisme": "organisme", "validite": "duree"}}
    ],
    "cautionnement_minimum": 0,
    "assurance_responsabilite_minimum": 0,
    "ratio_compagnon_apprenti": "X:X",
    "exigences_securite": ["exigence 1"],
    "inspections_prevues": ["type inspection"],
    "estimation_delai_conformite": "X semaines",
    "alertes": ["alerte si non-conformite potentielle"]
}}"""
    return _call_claude_json(user, "conformite_verify_project", prompt, temperature=0.2)


@router.post("/ai/search-regulations")
async def ai_search_regulations(body: AiSearchRegulationsRequest, user: ErpUser = Depends(get_current_user)):
    """AI: search Quebec construction regulations."""
    _require_tenant(user)
    # Strip + XML wrap user query
    query = (body.query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Recherche requise")
    prompt = f"""Recherche et explique les reglementations pertinentes pour cette requete:

<search_query>
{query}
</search_query>

Reponds en JSON strict (sans markdown). Pour tout `lien_officiel`,
n'utilise que des schemas http:// ou https://. Ne jamais retourner
de schemas javascript:, data:, file:, vbscript: ou autres.
{{
    "interpretation": "Ce que l'utilisateur recherche",
    "resultats": [
        {{
            "titre": "Titre de la reglementation",
            "source": "Loi/Reglement/Code",
            "reference": "Article X.XX",
            "resume": "Resume du contenu",
            "lien_officiel": "https://... si applicable"
        }}
    ],
    "reponse_directe": "Reponse claire a la question",
    "points_importants": ["point 1", "point 2"],
    "mises_en_garde": ["attention a..."],
    "ressources_complementaires": ["ressource 1"]
}}"""
    result = _call_claude_json(user, "conformite_search_reg", prompt, temperature=0.3)
    # Server-side URL sanitization: strip any non-http(s) URLs from resultats
    # in case Claude ignores the instruction (defense-in-depth).
    if isinstance(result.get("resultats"), list):
        for item in result["resultats"]:
            if isinstance(item, dict):
                lien = item.get("lien_officiel")
                if isinstance(lien, str) and lien and not (
                    lien.lower().startswith("http://") or lien.lower().startswith("https://")
                ):
                    item["lien_officiel"] = None
    return result


@router.post("/ai/predict-renewals")
async def ai_predict_renewals(user: ErpUser = Depends(get_current_user)):
    """AI: predict renewals calendar for next 12 months."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        ctx = _fetch_tenant_context(cursor)
    finally:
        _close_tenant(conn, cursor)

    context_text = "ELEMENTS A ANALYSER:\n\nLicences RBQ:\n"
    for lic in ctx["licences"][:15]:
        context_text += f"- {lic.get('numero_licence', 'N/A')}: Expire {lic.get('date_expiration', 'N/A')}\n"

    context_text += "\nCartes CCQ:\n"
    for carte in ctx["cartes"][:25]:
        context_text += f"- {carte.get('numero_carte', 'N/A')} ({carte.get('metier_principal', 'N/A')}): Renouvellement {carte.get('date_renouvellement', 'N/A')}\n"

    context_text += "\nAttestations:\n"
    for att in ctx["attestations"][:15]:
        context_text += f"- {att.get('type', 'N/A')}: Expire {att.get('date_expiration', 'N/A')}\n"

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    prompt = f"""Prepare un calendrier de renouvellement des licences, cartes et attestations.

{context_text}

Date d'aujourd'hui: {today}

Reponds en JSON strict (sans markdown):
{{
    "calendrier_12_mois": [
        {{
            "mois": "YYYY-MM",
            "elements": ["element 1"],
            "cout_estime": 0,
            "actions_requises": ["action 1"]
        }}
    ],
    "renouvellements_urgents": [
        {{"element": "description", "jours_restants": 0, "cout": 0, "priorite": "critique/haute/moyenne"}}
    ],
    "cout_annuel_estime": 0,
    "budget_recommande_mensuel": 0,
    "risques_expiration": [
        {{"element": "description", "consequence": "impact si non renouvele"}}
    ],
    "recommandations_planification": ["conseil 1"]
}}"""
    return _call_claude_json(user, "conformite_predict_renewals", prompt, temperature=0.3)


@router.post("/ai/generate-rapport")
async def ai_generate_rapport(user: ErpUser = Depends(get_current_user)):
    """AI: generate a professional compliance report."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        ctx = _fetch_tenant_context(cursor)

        # Compute current score for the prompt
        cursor.execute("SELECT COUNT(*) AS n FROM conformite_licences_rbq WHERE statut = 'ACTIVE'")
        lic_act = int((cursor.fetchone() or {}).get("n") or 0)
        cursor.execute(
            "SELECT COUNT(*) AS n FROM conformite_licences_rbq "
            "WHERE statut = 'EXPIREE' OR (date_expiration IS NOT NULL AND date_expiration < CURRENT_DATE)"
        )
        lic_exp = int((cursor.fetchone() or {}).get("n") or 0)
        cursor.execute("SELECT COUNT(*) AS n FROM conformite_cartes_ccq WHERE statut = 'ACTIVE'")
        car_act = int((cursor.fetchone() or {}).get("n") or 0)
        cursor.execute(
            "SELECT COUNT(*) AS n FROM conformite_cartes_ccq "
            "WHERE statut = 'EXPIREE' OR (date_renouvellement IS NOT NULL AND date_renouvellement < CURRENT_DATE)"
        )
        car_exp = int((cursor.fetchone() or {}).get("n") or 0)
        cursor.execute("SELECT COUNT(*) AS n FROM conformite_attestations WHERE statut = 'VALIDE'")
        att_val = int((cursor.fetchone() or {}).get("n") or 0)
        cursor.execute(
            "SELECT COUNT(*) AS n FROM conformite_attestations "
            "WHERE statut = 'EXPIREE' OR (date_expiration IS NOT NULL AND date_expiration < CURRENT_DATE)"
        )
        att_exp = int((cursor.fetchone() or {}).get("n") or 0)
        score = _calculate_score_conformite(lic_act, lic_exp, car_act, car_exp, att_val, att_exp)
    finally:
        _close_tenant(conn, cursor)

    # Build metier counts for ratio info
    metier_counts: dict = {}
    for carte in ctx["cartes"]:
        m = carte.get("metier_principal", "Autre")
        metier_counts[m] = metier_counts.get(m, 0) + 1
    metiers_text = "\n".join(f"- {m}: {c}" for m, c in metier_counts.items())

    context_text = f"""DONNEES DE CONFORMITE:

Score actuel: {score}%
Licences RBQ actives: {lic_act} (expirees: {lic_exp})
Cartes CCQ actives: {car_act} (expirees: {car_exp})
Attestations valides: {att_val} (expirees: {att_exp})

REPARTITION METIERS CCQ:
{metiers_text or '- Aucun'}
"""

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    prompt = f"""Tu es le responsable conformite d'une entreprise de construction au Quebec.
Genere un rapport de conformite professionnel.

{context_text}

Reponds en JSON strict (sans markdown):
{{
    "titre_rapport": "Rapport de Conformite RBQ/CCQ",
    "date_generation": "{today}",
    "periode_couverte": "description",
    "resume_executif": "Resume en 3-4 phrases",
    "score_global": {score},
    "evaluation_score": "description du score",
    "conformite_rbq": {{
        "statut": "conforme/non-conforme/partiel",
        "points_forts": ["point 1"],
        "points_amelioration": ["point 1"],
        "actions_requises": ["action 1"]
    }},
    "conformite_ccq": {{
        "statut": "conforme/non-conforme/partiel",
        "ratio_compagnon_apprenti": "X:X",
        "points_forts": ["point 1"],
        "points_amelioration": ["point 1"]
    }},
    "attestations": {{
        "statut": "a jour/expirations proches/expire",
        "details": ["detail 1"]
    }},
    "risques_identifies": [
        {{"risque": "description", "niveau": "faible/moyen/eleve", "mitigation": "action"}}
    ],
    "plan_action": [
        {{"action": "description", "responsable": "suggestion", "echeance": "delai", "priorite": "haute/moyenne/basse"}}
    ],
    "conclusion": "Conclusion generale",
    "prochaine_revision": "date suggeree"
}}"""
    return _call_claude_json(user, "conformite_generate_rapport", prompt, temperature=0.3)


@router.post("/ai/recommend-formations")
async def ai_recommend_formations(
    body: AiRecommendFormationsRequest,
    user: ErpUser = Depends(get_current_user),
):
    """AI: recommend trainings for the team."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        ctx = _fetch_tenant_context(cursor)
    finally:
        _close_tenant(conn, cursor)

    context_text = "EQUIPE ACTUELLE (cartes CCQ):\n"
    for carte in ctx["cartes"][:25]:
        context_text += f"- Carte {carte.get('numero_carte', 'N/A')}: {carte.get('metier_principal', 'N/A')} ({carte.get('qualification', 'N/A')}) - Statut: {carte.get('statut', 'N/A')}\n"

    # Strip user-supplied projet types (defense against whitespace padding)
    projets_clean = [p.strip() for p in (body.projets_prevus or []) if p and p.strip()]
    if projets_clean:
        context_text += f"\nPROJETS PREVUS: {', '.join(projets_clean)}\n"

    prompt = f"""Tu es un conseiller en developpement des competences pour la construction au Quebec.
Analyse cette equipe et recommande des formations.

{context_text}

Reponds en JSON strict (sans markdown):
{{
    "analyse_competences": {{
        "forces": ["force 1", "force 2"],
        "lacunes": ["lacune 1", "lacune 2"],
        "opportunites": ["opportunite 1"]
    }},
    "formations_recommandees": [
        {{
            "titre": "Nom de la formation",
            "organisme": "CCQ/ASP/Autre",
            "duree": "X heures/jours",
            "cout_estime": 0,
            "public_cible": ["metier 1", "metier 2"],
            "priorite": "haute/moyenne/basse",
            "benefices": ["benefice 1"]
        }}
    ],
    "certifications_suggerees": [
        {{"certification": "nom", "organisme": "organisme", "avantages": "description"}}
    ],
    "plan_developpement": [
        {{"trimestre": "Q1/Q2/Q3/Q4", "formations": ["formation 1"], "objectif": "objectif"}}
    ],
    "budget_formation_annuel_suggere": 0,
    "retour_investissement": "description du ROI attendu"
}}"""
    return _call_claude_json(user, "conformite_recommend_formations", prompt, temperature=0.4)
