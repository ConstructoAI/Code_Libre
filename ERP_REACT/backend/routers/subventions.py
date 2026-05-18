"""
ERP React - Subventions (Grants & Subsidies) Router
Ported from Streamlit subventions_manager.py — full feature parity.

Features:
- Catalogue programmes (40+ seeded, filters, search)
- Demandes CRUD + soumettre + documents upload
- Eligibility checker (algorithmic scoring)
- AI Assistant (Claude Opus 4.6): suggest, chat, checklist, analyze-demande, analyze-eligibility
- Statistics dashboard
- Resources (8 organismes + Plan PME 2025-2028 + conseils)
"""

import json
import logging
import os
import time as time_module
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, field_validator

from ..erp_auth import ErpUser, get_current_user
from .. import erp_database as db
from .ai import _check_credits, _deduct_credits, check_ai_guard, track_ai_usage
from .subventions_data import (
    AI_SYSTEM_PROMPT,
    CONSEILS_PRATIQUES,
    DEFAULT_CATEGORIES,
    DEFAULT_ORGANISMES,
    DEFAULT_PROGRAMMES,
    NIVEAUX_DIFFICULTE,
    NIVEAUX_GOUVERNEMENT,
    NIVEAUX_URGENCE,
    PLAN_PME_2025_2028,
    REGIONS_QUEBEC,
    SECTEURS_ACTIVITE,
    STATUTS_DEMANDE,
    STATUTS_DOCUMENT,
    TAILLES_ENTREPRISE,
    TYPES_AIDE,
    TYPES_PROJET,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/subventions", tags=["Subventions"])

# Anthropic client for AI Assistant
try:
    import anthropic
    _anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
except (ImportError, Exception) as exc:  # pragma: no cover
    _anthropic_client = None
    logger.warning("Anthropic SDK not available: %s", exc)

SUBV_AI_MODEL = "claude-opus-4-7"
SUBV_AI_MAX_TOKENS = 32000
# Opus 4.7 pricing with 30% markup: $15/M input, $75/M output,
# $18.75/M cache write, $1.50/M cache read.
SUBV_PRICING_INPUT_PER_M = 15.0
SUBV_PRICING_OUTPUT_PER_M = 75.0
SUBV_PRICING_CACHE_WRITE_PER_M = 18.75
SUBV_PRICING_CACHE_READ_PER_M = 1.50
SUBV_PRICING_MARKUP = 1.30

# Allowed subsidy document MIME types for upload (10 MB limit)
ALLOWED_DOC_MIME = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/plain",
    "text/csv",
}
MAX_DOC_SIZE_MB = 10
MAX_DOC_SIZE_BYTES = MAX_DOC_SIZE_MB * 1024 * 1024


# ============================================
# PYDANTIC MODELS
# ============================================

def _empty_to_none(v):
    """Convert empty strings to None — used on date fields to avoid PostgreSQL
    'invalid input syntax for type date: ""' errors when frontend sends blank dates."""
    return None if isinstance(v, str) and v.strip() == "" else v


class DemandeCreate(BaseModel):
    programme_id: int
    projet_id: Optional[int] = None
    company_id: Optional[int] = None
    montant_demande: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    notes: Optional[str] = Field(None, max_length=5000)


class DemandeUpdate(BaseModel):
    programme_id: Optional[int] = None
    projet_id: Optional[int] = None
    company_id: Optional[int] = None
    montant_demande: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    montant_accorde: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    statut: Optional[str] = None
    date_soumission: Optional[str] = None
    date_decision: Optional[str] = None
    date_versement: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=5000)
    motif_refus: Optional[str] = Field(None, max_length=2000)
    reference_externe: Optional[str] = Field(None, max_length=255)

    @field_validator("date_soumission", "date_decision", "date_versement", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class EligibilityProfile(BaseModel):
    taille: Optional[str] = Field(None, max_length=100)
    secteurs: List[str] = Field(default_factory=list, max_length=50)
    region: Optional[str] = Field(None, max_length=100)
    types_projet: List[str] = Field(default_factory=list, max_length=50)
    budget: Optional[float] = Field(0, ge=0, le=1_000_000_000)
    urgence: Optional[str] = Field(None, max_length=100)


class AiSuggestRequest(BaseModel):
    description_projet: str = Field(..., min_length=1, max_length=5000)
    budget: Optional[float] = Field(None, ge=0, le=1_000_000_000)


class AiChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    context: Optional[str] = Field("", max_length=10000)


class AiChecklistRequest(BaseModel):
    programme_id: int


class AiAnalyzeDemandeRequest(BaseModel):
    demande_id: int


class AiAnalyzeEligibilityRequest(BaseModel):
    secteur: Optional[str] = Field(None, max_length=100)
    taille: Optional[str] = Field(None, max_length=100)
    region: Optional[str] = Field(None, max_length=100)
    chiffre_affaires: Optional[float] = Field(0, ge=0, le=1_000_000_000_000)
    employes: Optional[int] = Field(0, ge=0, le=1_000_000)
    projets_prevus: List[str] = Field(default_factory=list, max_length=50)


class DocumentStatusUpdate(BaseModel):
    statut: str = Field(..., max_length=50)


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
            # Skip binary data in serialized rows (file_data stays server-side)
            d[key] = None
    return d


def _parse_json_field(value):
    """Parse a JSONB field that may arrive as str or list/dict."""
    if value is None:
        return []
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, ValueError):
            return []
    return []


def _require_tenant(user: ErpUser):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")


def _ensure_subventions_tables(cursor, conn):
    """Create subventions tables if absent, and seed defaults on first run.

    Uses pg_advisory_xact_lock to serialize concurrent CREATE TABLE IF NOT EXISTS
    calls across workers (PostgreSQL catalog is not fully race-safe: concurrent
    workers hitting an endpoint simultaneously can trigger
    'duplicate key value violates unique constraint pg_class_relname_nsp_index').
    The lock is released automatically at end of transaction.
    """
    try:
        # Arbitrary bigint hash for 'subventions' (first 8 chars of SHA-256 mod 2^63)
        cursor.execute("SELECT pg_advisory_xact_lock(1936746614)")
    except Exception as adv_exc:
        logger.warning("pg_advisory_xact_lock(subventions) failed: %s", adv_exc)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS subventions_categories (
            id SERIAL PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            nom TEXT NOT NULL,
            description TEXT,
            ordre_affichage INTEGER DEFAULT 0,
            actif BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS subventions_programmes (
            id SERIAL PRIMARY KEY,
            categorie_id INTEGER REFERENCES subventions_categories(id),
            code TEXT,
            nom TEXT NOT NULL,
            organisme TEXT,
            description TEXT,
            type_aide TEXT,
            niveau_gouvernement TEXT,
            montant_min NUMERIC(15,2),
            montant_max NUMERIC(15,2),
            pourcentage_aide NUMERIC(5,2),
            secteurs_admissibles JSONB DEFAULT '[]',
            criteres_eligibilite TEXT,
            documents_requis TEXT,
            url_programme TEXT,
            telephone TEXT,
            email TEXT,
            date_debut DATE,
            date_fin DATE,
            difficulte TEXT DEFAULT 'MOYEN',
            actif BOOLEAN DEFAULT TRUE,
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS subventions_demandes (
            id SERIAL PRIMARY KEY,
            programme_id INTEGER,
            projet_id INTEGER,
            company_id INTEGER,
            reference_interne TEXT,
            reference_externe TEXT,
            montant_demande NUMERIC(15,2),
            montant_accorde NUMERIC(15,2),
            statut TEXT DEFAULT 'BROUILLON',
            date_soumission DATE,
            date_decision DATE,
            date_versement DATE,
            responsable_id INTEGER,
            notes TEXT,
            motif_refus TEXT,
            created_by INTEGER,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS subventions_documents (
            id SERIAL PRIMARY KEY,
            demande_id INTEGER REFERENCES subventions_demandes(id) ON DELETE CASCADE,
            nom TEXT NOT NULL,
            type_document TEXT,
            fichier_data BYTEA,
            mime_type TEXT,
            taille INTEGER,
            statut TEXT DEFAULT 'FOURNI',
            notes TEXT,
            uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            uploaded_by INTEGER
        )
    """)

    # Indexes — wrapped in SAVEPOINT so a concurrent pg_class race on
    # fresh tenants does not abort the outer transaction.
    cursor.execute("SAVEPOINT sp_subv_idx")
    try:
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subv_prog_categorie ON subventions_programmes(categorie_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subv_prog_actif ON subventions_programmes(actif)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subv_prog_date_fin ON subventions_programmes(date_fin)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subv_demandes_statut ON subventions_demandes(statut)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subv_demandes_programme ON subventions_demandes(programme_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subv_docs_demande ON subventions_documents(demande_id)")
        # Partial unique index on programme code (for idempotent seeding)
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_subv_prog_code_unique "
            "ON subventions_programmes(code) WHERE code IS NOT NULL"
        )
        cursor.execute("RELEASE SAVEPOINT sp_subv_idx")
    except Exception as exc:
        try:
            cursor.execute("ROLLBACK TO SAVEPOINT sp_subv_idx")
        except Exception:
            pass
        _msg = str(exc).lower()
        if not any(tok in _msg for tok in ("duplicate key", "pg_class_relname", "already exists")):
            raise
        import logging
        logging.getLogger(__name__).warning("subventions indexes race: %s", exc)

    conn.commit()

    # Seed defaults if categories table empty
    cursor.execute("SELECT COUNT(*) AS n FROM subventions_categories")
    row = cursor.fetchone()
    count = row["n"] if row else 0
    if count == 0:
        _seed_defaults(cursor, conn)


def _seed_defaults(cursor, conn):
    """Seed default categories and programmes on first tenant access."""
    try:
        # Categories
        code_to_id = {}
        for cat in DEFAULT_CATEGORIES:
            cursor.execute(
                """INSERT INTO subventions_categories (code, nom, description, ordre_affichage, actif)
                   VALUES (%s, %s, %s, %s, TRUE)
                   ON CONFLICT (code) DO UPDATE SET nom = EXCLUDED.nom
                   RETURNING id""",
                (cat["code"], cat["nom"], cat["description"], cat["ordre_affichage"]),
            )
            row = cursor.fetchone()
            if row:
                code_to_id[cat["code"]] = row["id"]

        # Programmes (idempotent via ON CONFLICT on the partial unique index)
        for prog in DEFAULT_PROGRAMMES:
            cat_id = code_to_id.get(prog.get("categorie_code"))
            cursor.execute(
                """INSERT INTO subventions_programmes (
                    categorie_id, code, nom, organisme, description,
                    type_aide, niveau_gouvernement,
                    montant_min, montant_max, pourcentage_aide,
                    secteurs_admissibles, url_programme, telephone,
                    date_debut, date_fin, difficulte, actif
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, TRUE)
                ON CONFLICT (code) WHERE code IS NOT NULL DO NOTHING""",
                (
                    cat_id,
                    prog.get("code"),
                    prog.get("nom"),
                    prog.get("organisme"),
                    prog.get("description"),
                    prog.get("type_aide"),
                    prog.get("niveau_gouvernement"),
                    prog.get("montant_min"),
                    prog.get("montant_max"),
                    prog.get("pourcentage_aide"),
                    json.dumps(prog.get("secteurs_admissibles", [])),
                    prog.get("url_programme"),
                    prog.get("telephone"),
                    prog.get("date_debut"),
                    prog.get("date_fin"),
                    prog.get("difficulte", "MOYEN"),
                ),
            )
        conn.commit()
        logger.info("Subventions defaults seeded: %d categories, %d programmes",
                    len(DEFAULT_CATEGORIES), len(DEFAULT_PROGRAMMES))
    except Exception as exc:
        conn.rollback()
        logger.error("Subventions seed error: %s", exc)


def _get_tenant_cursor(user: ErpUser):
    """Return (conn, cursor) with tenant context set and tables ensured.

    Forces `autocommit = False` so explicit commit/rollback controls transactions
    even if the connection pool returns an autocommit connection (lecon #131).
    """
    _require_tenant(user)
    conn = db.get_conn()
    try:
        conn.autocommit = False
    except Exception as exc:
        logger.warning("conn.autocommit = False failed: %s", exc)
    cursor = conn.cursor()
    db.set_tenant(conn, user.schema)
    _ensure_subventions_tables(cursor, conn)
    return conn, cursor


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


def _serialize_programme(row: dict) -> dict:
    """Serialize a programme row with JSONB fields parsed."""
    d = _serialize(row)
    d["secteurs_admissibles"] = _parse_json_field(row.get("secteurs_admissibles") if row else None)
    return d


# ============================================
# METADATA / CONSTANTS
# ============================================

@router.get("/constants")
async def get_constants(user: ErpUser = Depends(get_current_user)):
    """Return all enums needed by the frontend (statuts, types, niveaux, listes)."""
    _require_tenant(user)
    return {
        "statutsDemande": STATUTS_DEMANDE,
        "statutsDocument": STATUTS_DOCUMENT,
        "typesAide": TYPES_AIDE,
        "niveauxGouvernement": NIVEAUX_GOUVERNEMENT,
        "niveauxDifficulte": NIVEAUX_DIFFICULTE,
        "secteursActivite": SECTEURS_ACTIVITE,
        "regions": REGIONS_QUEBEC,
        "taillesEntreprise": TAILLES_ENTREPRISE,
        "typesProjet": TYPES_PROJET,
        "niveauxUrgence": NIVEAUX_URGENCE,
    }


# ============================================
# CATEGORIES
# ============================================

@router.get("/categories")
async def list_categories(user: ErpUser = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            "SELECT id, code, nom, description, ordre_affichage "
            "FROM subventions_categories WHERE actif = TRUE ORDER BY ordre_affichage ASC"
        )
        items = [_serialize(row) for row in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_categories error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la lecture des categories")
    finally:
        _close_tenant(conn, cursor)


# ============================================
# PROGRAMMES
# ============================================

@router.get("/programmes")
async def list_programmes(
    user: ErpUser = Depends(get_current_user),
    categorie_id: Optional[int] = None,
    type_aide: Optional[str] = None,
    niveau_gouvernement: Optional[str] = None,
    difficulte: Optional[str] = None,
    secteur: Optional[str] = None,
    search: Optional[str] = None,
):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        wheres = ["p.actif = TRUE"]
        params: List = []
        if categorie_id:
            wheres.append("p.categorie_id = %s")
            params.append(categorie_id)
        if type_aide:
            wheres.append("p.type_aide = %s")
            params.append(type_aide)
        if niveau_gouvernement:
            wheres.append("p.niveau_gouvernement = %s")
            params.append(niveau_gouvernement)
        if difficulte:
            wheres.append("p.difficulte = %s")
            params.append(difficulte)
        if secteur:
            # JSONB containment: fast indexed lookup, exact match (no LIKE injection)
            wheres.append("p.secteurs_admissibles @> %s::jsonb")
            params.append(json.dumps([secteur.upper()]))
        if search:
            # Escape LIKE wildcards in user input (defense against DoS via _ or %)
            escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            wheres.append(
                "(p.nom ILIKE %s ESCAPE '\\' OR p.organisme ILIKE %s ESCAPE '\\' "
                "OR p.description ILIKE %s ESCAPE '\\')"
            )
            like = f"%{escaped}%"
            params.extend([like, like, like])

        where_sql = " AND ".join(wheres)
        cursor.execute(
            f"""SELECT p.*, c.nom AS categorie_nom, c.code AS categorie_code
               FROM subventions_programmes p
               LEFT JOIN subventions_categories c ON c.id = p.categorie_id
               WHERE {where_sql}
               ORDER BY p.nom ASC""",
            tuple(params),
        )
        items = [_serialize_programme(row) for row in cursor.fetchall()]
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_programmes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la lecture des programmes")
    finally:
        _close_tenant(conn, cursor)


@router.get("/programmes/expiring")
async def list_expiring_programmes(
    days: int = Query(30, ge=1, le=365),
    user: ErpUser = Depends(get_current_user),
):
    """Programmes whose date_fin falls within the next N days."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            """SELECT p.*, c.nom AS categorie_nom
               FROM subventions_programmes p
               LEFT JOIN subventions_categories c ON c.id = p.categorie_id
               WHERE p.actif = TRUE
                 AND p.date_fin IS NOT NULL
                 AND p.date_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + (%s || ' days')::interval
               ORDER BY p.date_fin ASC""",
            (str(days),),
        )
        items = [_serialize_programme(row) for row in cursor.fetchall()]
        return {"items": items, "days": days}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_expiring_programmes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        _close_tenant(conn, cursor)


@router.get("/programmes/{programme_id}")
async def get_programme(programme_id: int, user: ErpUser = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            """SELECT p.*, c.nom AS categorie_nom, c.code AS categorie_code
               FROM subventions_programmes p
               LEFT JOIN subventions_categories c ON c.id = p.categorie_id
               WHERE p.id = %s""",
            (programme_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Programme introuvable")
        return _serialize_programme(row)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_programme error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        _close_tenant(conn, cursor)


# ============================================
# DEMANDES (Applications)
# ============================================

@router.get("/demandes")
async def list_demandes(
    user: ErpUser = Depends(get_current_user),
    statut: Optional[str] = None,
):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        wheres = []
        params: List = []
        if statut:
            wheres.append("d.statut = %s")
            params.append(statut)
        where_sql = ("WHERE " + " AND ".join(wheres)) if wheres else ""
        cursor.execute(
            f"""SELECT d.*, p.nom AS programme_nom, p.organisme, p.type_aide,
                      p.niveau_gouvernement, p.montant_max AS programme_montant_max
               FROM subventions_demandes d
               LEFT JOIN subventions_programmes p ON p.id = d.programme_id
               {where_sql}
               ORDER BY d.created_at DESC""",
            tuple(params),
        )
        items = [_serialize(row) for row in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_demandes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        _close_tenant(conn, cursor)


@router.get("/demandes/{demande_id}")
async def get_demande(demande_id: int, user: ErpUser = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            """SELECT d.*, p.nom AS programme_nom, p.organisme, p.type_aide,
                      p.niveau_gouvernement, p.montant_max AS programme_montant_max,
                      p.criteres_eligibilite, p.documents_requis
               FROM subventions_demandes d
               LEFT JOIN subventions_programmes p ON p.id = d.programme_id
               WHERE d.id = %s""",
            (demande_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Demande introuvable")
        demande = _serialize(row)

        cursor.execute(
            """SELECT id, nom, type_document, mime_type, taille, statut, uploaded_at, uploaded_by
               FROM subventions_documents WHERE demande_id = %s ORDER BY uploaded_at DESC""",
            (demande_id,),
        )
        documents = [_serialize(r) for r in cursor.fetchall()]
        demande["documents"] = documents
        return demande
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_demande error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        _close_tenant(conn, cursor)


def _table_exists(cursor, user: ErpUser, table: str) -> bool:
    cursor.execute(
        "SELECT EXISTS (SELECT FROM information_schema.tables "
        "WHERE table_schema = %s AND table_name = %s)",
        (user.schema, table),
    )
    row = cursor.fetchone()
    return bool(row and row.get("exists", False))


@router.post("/demandes")
async def create_demande(body: DemandeCreate, user: ErpUser = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)

        # Verify programme exists
        cursor.execute("SELECT id FROM subventions_programmes WHERE id = %s", (body.programme_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Programme introuvable")

        # Validate optional FK references if present (guard tables that may not exist on new tenants)
        if body.projet_id is not None and _table_exists(cursor, user, "projects"):
            cursor.execute("SELECT 1 FROM projects WHERE id = %s", (body.projet_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Projet introuvable")
        if body.company_id is not None and _table_exists(cursor, user, "companies"):
            cursor.execute("SELECT 1 FROM companies WHERE id = %s", (body.company_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Entreprise introuvable")

        # Use INSERT RETURNING id pattern (lecon #123) then UPDATE reference_interne
        cursor.execute(
            """INSERT INTO subventions_demandes (
                programme_id, projet_id, company_id, montant_demande,
                notes, statut, responsable_id, created_by
            ) VALUES (%s, %s, %s, %s, %s, 'BROUILLON', %s, %s)
            RETURNING id, created_at""",
            (
                body.programme_id,
                body.projet_id,
                body.company_id,
                body.montant_demande,
                body.notes,
                user.user_id,
                user.user_id,
            ),
        )
        row = cursor.fetchone()
        demande_id = row["id"]
        created_at = row["created_at"]
        # Always use UTC for reference timestamps (consistent across timezones)
        timestamp = (created_at or datetime.now(timezone.utc)).strftime("%Y%m%d%H%M%S")
        reference = f"SUB-{timestamp}-{demande_id:05d}"
        cursor.execute(
            "UPDATE subventions_demandes SET reference_interne = %s WHERE id = %s",
            (reference, demande_id),
        )
        conn.commit()
        return {"id": demande_id, "reference_interne": reference, "statut": "BROUILLON"}
    except HTTPException:
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.error("create_demande error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la demande")
    finally:
        _close_tenant(conn, cursor)


@router.put("/demandes/{demande_id}")
async def update_demande(
    demande_id: int,
    body: DemandeUpdate,
    user: ErpUser = Depends(get_current_user),
):
    # Whitelist for defense in depth even though Pydantic already filters unknown keys
    ALLOWED_UPDATE_FIELDS = {
        "programme_id", "projet_id", "company_id",
        "montant_demande", "montant_accorde", "statut",
        "date_soumission", "date_decision", "date_versement",
        "notes", "motif_refus", "reference_externe",
    }
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")

        # Defense in depth: drop any field not in the whitelist
        fields = {k: v for k, v in fields.items() if k in ALLOWED_UPDATE_FIELDS}
        if not fields:
            raise HTTPException(status_code=400, detail="Aucun champ valide a mettre a jour")

        # Validate statut if present
        if "statut" in fields and fields["statut"] not in STATUTS_DEMANDE:
            raise HTTPException(status_code=400, detail="Statut invalide")

        sets = []
        params = []
        for key, val in fields.items():
            sets.append(f"{key} = %s")
            params.append(val)
        sets.append("updated_at = CURRENT_TIMESTAMP")
        params.append(demande_id)
        cursor.execute(
            f"UPDATE subventions_demandes SET {', '.join(sets)} WHERE id = %s",
            tuple(params),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Demande introuvable")
        conn.commit()
        return {"id": demande_id, "updated": True}
    except HTTPException:
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.error("update_demande error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour")
    finally:
        _close_tenant(conn, cursor)


@router.post("/demandes/{demande_id}/soumettre")
async def soumettre_demande(demande_id: int, user: ErpUser = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            "SELECT statut FROM subventions_demandes WHERE id = %s",
            (demande_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Demande introuvable")
        if row["statut"] not in ("BROUILLON", "EN_PREPARATION"):
            raise HTTPException(status_code=400, detail="La demande ne peut pas etre soumise dans son statut actuel")
        cursor.execute(
            """UPDATE subventions_demandes
               SET statut = 'SOUMISE', date_soumission = CURRENT_DATE,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = %s""",
            (demande_id,),
        )
        conn.commit()
        return {"id": demande_id, "statut": "SOUMISE"}
    except HTTPException:
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.error("soumettre_demande error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la soumission")
    finally:
        _close_tenant(conn, cursor)


@router.delete("/demandes/{demande_id}")
async def delete_demande(demande_id: int, user: ErpUser = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute("SELECT statut FROM subventions_demandes WHERE id = %s", (demande_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Demande introuvable")
        if row["statut"] in ("APPROUVEE", "VERSEE"):
            raise HTTPException(status_code=400, detail="Impossible de supprimer une demande approuvee ou versee")
        cursor.execute("DELETE FROM subventions_demandes WHERE id = %s", (demande_id,))
        conn.commit()
        return {"id": demande_id, "deleted": True}
    except HTTPException:
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.error("delete_demande error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression")
    finally:
        _close_tenant(conn, cursor)


# ============================================
# DOCUMENTS
# ============================================

@router.post("/demandes/{demande_id}/documents")
async def upload_demande_document(
    demande_id: int,
    file: UploadFile = File(...),
    type_document: Optional[str] = None,
    user: ErpUser = Depends(get_current_user),
):
    conn = None
    cursor = None
    try:
        # Early MIME validation (before reading bytes into memory)
        mime = (file.content_type or "application/octet-stream").lower()
        if mime not in ALLOWED_DOC_MIME:
            raise HTTPException(status_code=415, detail="Type de fichier non supporte")
        # Early size check via UploadFile.size when available (avoids reading oversized uploads)
        if getattr(file, "size", None) is not None and file.size > MAX_DOC_SIZE_BYTES:
            raise HTTPException(status_code=413, detail=f"Fichier trop volumineux (max {MAX_DOC_SIZE_MB} MB)")
        content = await file.read()
        size = len(content)
        if size == 0:
            raise HTTPException(status_code=400, detail="Fichier vide")
        if size > MAX_DOC_SIZE_BYTES:
            raise HTTPException(status_code=413, detail=f"Fichier trop volumineux (max {MAX_DOC_SIZE_MB} MB)")

        conn, cursor = _get_tenant_cursor(user)
        cursor.execute("SELECT id FROM subventions_demandes WHERE id = %s", (demande_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Demande introuvable")

        cursor.execute(
            """INSERT INTO subventions_documents (
                demande_id, nom, type_document, fichier_data, mime_type,
                taille, statut, uploaded_by
            ) VALUES (%s, %s, %s, %s, %s, %s, 'FOURNI', %s)
            RETURNING id, demande_id, nom, type_document, mime_type, taille,
                      statut, uploaded_at, uploaded_by""",
            (demande_id, file.filename, type_document, content, mime, size, user.user_id),
        )
        row = cursor.fetchone()
        conn.commit()
        return _serialize(row)
    except HTTPException:
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.error("upload_demande_document error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du televersement")
    finally:
        _close_tenant(conn, cursor)


@router.get("/documents/{document_id}/download")
async def download_document(document_id: int, user: ErpUser = Depends(get_current_user)):
    from fastapi.responses import Response
    from urllib.parse import quote
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            "SELECT nom, fichier_data, mime_type FROM subventions_documents WHERE id = %s",
            (document_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Document introuvable")
        data = row["fichier_data"]
        if isinstance(data, memoryview):
            data = bytes(data)
        # Sanitize filename against header injection (RFC 5987 + ASCII fallback)
        raw_name = row.get("nom") or "document.bin"
        ascii_name = "".join(
            c if 32 <= ord(c) < 127 and c not in ('"', '\\', "\r", "\n") else "_"
            for c in raw_name
        ) or "document.bin"
        utf8_name = quote(raw_name, safe="")
        return Response(
            content=data or b"",
            media_type=row.get("mime_type") or "application/octet-stream",
            headers={
                "Content-Disposition": (
                    f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{utf8_name}'
                )
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("download_document error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du telechargement")
    finally:
        _close_tenant(conn, cursor)


@router.put("/documents/{document_id}/status")
async def update_document_status(
    document_id: int,
    body: DocumentStatusUpdate,
    user: ErpUser = Depends(get_current_user),
):
    """Update the tracking status of a document (A_FOURNIR/FOURNI/VALIDE/REJETE)."""
    if body.statut not in STATUTS_DOCUMENT:
        raise HTTPException(status_code=400, detail="Statut de document invalide")
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            "UPDATE subventions_documents SET statut = %s WHERE id = %s",
            (body.statut, document_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Document introuvable")
        conn.commit()
        return {"id": document_id, "statut": body.statut}
    except HTTPException:
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.error("update_document_status error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour du statut")
    finally:
        _close_tenant(conn, cursor)


@router.delete("/documents/{document_id}")
async def delete_document(document_id: int, user: ErpUser = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute("DELETE FROM subventions_documents WHERE id = %s", (document_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Document introuvable")
        conn.commit()
        return {"id": document_id, "deleted": True}
    except HTTPException:
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.error("delete_document error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression")
    finally:
        _close_tenant(conn, cursor)


# ============================================
# STATISTICS
# ============================================

@router.get("/statistics")
async def get_statistics(user: ErpUser = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)

        stats = {
            "total_programmes": 0,
            "total_demandes": 0,
            "montant_total_demande": 0.0,
            "montant_total_accorde": 0.0,
            "demandes_par_statut": {},
            "programmes_par_categorie": [],
            "programmes_par_niveau": [],
            "programmes_par_type": [],
        }

        cursor.execute("SELECT COUNT(*) AS n FROM subventions_programmes WHERE actif = TRUE")
        row = cursor.fetchone()
        stats["total_programmes"] = row["n"] if row else 0

        cursor.execute("SELECT COUNT(*) AS n FROM subventions_demandes")
        row = cursor.fetchone()
        stats["total_demandes"] = row["n"] if row else 0

        cursor.execute(
            """SELECT COALESCE(SUM(montant_demande), 0) AS md,
                      COALESCE(SUM(montant_accorde), 0) AS ma
               FROM subventions_demandes
               WHERE statut IN ('APPROUVEE', 'VERSEE')"""
        )
        row = cursor.fetchone() or {}
        stats["montant_total_demande"] = float(row.get("md") or 0)
        stats["montant_total_accorde"] = float(row.get("ma") or 0)

        cursor.execute(
            "SELECT statut, COUNT(*) AS n FROM subventions_demandes GROUP BY statut"
        )
        stats["demandes_par_statut"] = {r["statut"]: r["n"] for r in cursor.fetchall()}

        cursor.execute(
            """SELECT c.nom AS categorie, COUNT(p.id) AS n
               FROM subventions_categories c
               LEFT JOIN subventions_programmes p ON p.categorie_id = c.id AND p.actif = TRUE
               GROUP BY c.nom, c.ordre_affichage
               ORDER BY c.ordre_affichage ASC"""
        )
        stats["programmes_par_categorie"] = [
            {"categorie": r["categorie"], "nombre": r["n"]} for r in cursor.fetchall()
        ]

        cursor.execute(
            """SELECT niveau_gouvernement AS niveau, COUNT(*) AS n
               FROM subventions_programmes
               WHERE actif = TRUE AND niveau_gouvernement IS NOT NULL
               GROUP BY niveau_gouvernement"""
        )
        stats["programmes_par_niveau"] = [
            {"niveau": r["niveau"], "nombre": r["n"]} for r in cursor.fetchall()
        ]

        cursor.execute(
            """SELECT type_aide AS type, COUNT(*) AS n
               FROM subventions_programmes
               WHERE actif = TRUE AND type_aide IS NOT NULL
               GROUP BY type_aide"""
        )
        stats["programmes_par_type"] = [
            {"type": r["type"], "nombre": r["n"]} for r in cursor.fetchall()
        ]

        return stats
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_statistics error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du calcul des statistiques")
    finally:
        _close_tenant(conn, cursor)


# ============================================
# RESOURCES (Organismes + Plan PME + Conseils)
# ============================================

@router.get("/resources")
async def get_resources(user: ErpUser = Depends(get_current_user)):
    _require_tenant(user)
    return {
        "organismes": DEFAULT_ORGANISMES,
        "planPme": PLAN_PME_2025_2028,
        "conseils": CONSEILS_PRATIQUES,
    }


# ============================================
# ELIGIBILITY CHECKER (Algorithmic, no AI)
# ============================================

@router.post("/eligibility-check")
async def check_eligibility(
    body: EligibilityProfile,
    user: ErpUser = Depends(get_current_user),
):
    """Score each active programme against the user profile.
    Returns top matches with score > 0.

    Scoring (ported from Streamlit):
    - +20 per sector match (case-insensitive)
    - +15 if programme_montant_max >= 10% of project_budget
    - +25 bonus if Construction/Renovation sector and programme has CONSTRUCTION
    """
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            """SELECT p.*, c.nom AS categorie_nom
               FROM subventions_programmes p
               LEFT JOIN subventions_categories c ON c.id = p.categorie_id
               WHERE p.actif = TRUE"""
        )
        programmes = [_serialize_programme(row) for row in cursor.fetchall()]

        user_sectors_upper = {s.upper() for s in (body.secteurs or [])}
        budget = float(body.budget or 0)
        has_construction = any(s in ("CONSTRUCTION", "RENOVATION") for s in user_sectors_upper)

        matches = []
        for prog in programmes:
            score = 0
            prog_sectors = prog.get("secteurs_admissibles") or []
            prog_sectors_upper = {str(s).upper() for s in prog_sectors}

            # +20 per sector match
            score += 20 * len(user_sectors_upper & prog_sectors_upper)

            # +15 if budget fit (exact Streamlit parity — treats 0 as valid value)
            raw_max = prog.get("montant_max")
            if raw_max is not None and float(raw_max) >= budget * 0.1:
                score += 15

            # +25 construction bonus
            if has_construction and "CONSTRUCTION" in prog_sectors_upper:
                score += 25

            if score > 0:
                matches.append({**prog, "score_eligibilite": score})

        matches.sort(key=lambda p: p["score_eligibilite"], reverse=True)
        top = matches[:10]

        return {
            "total_eligible": len(matches),
            "top_matches": top,
            "profile": body.model_dump(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("check_eligibility error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du calcul d'eligibilite")
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
        input_tokens * SUBV_PRICING_INPUT_PER_M / 1_000_000
        + output_tokens * SUBV_PRICING_OUTPUT_PER_M / 1_000_000
        + cache_creation_tokens * SUBV_PRICING_CACHE_WRITE_PER_M / 1_000_000
        + cache_read_tokens * SUBV_PRICING_CACHE_READ_PER_M / 1_000_000
    ) * SUBV_PRICING_MARKUP


def _call_claude_json(user: ErpUser, feature: str, prompt: str, temperature: float = 0.3) -> dict:
    """Call Claude Opus with a prompt expected to return JSON. Returns parsed dict.
    Handles billing, tracking, and error wrapping.
    """
    _guard_ai(user)
    start = time_module.time()
    try:
        response = _anthropic_client.messages.create(
            model=SUBV_AI_MODEL,
            max_tokens=SUBV_AI_MAX_TOKENS,
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

    # Extract text
    text = ""
    for block in response.content:
        if hasattr(block, "text"):
            text += block.text
    text = text.strip()

    # Strip markdown code block wrapper if present
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) >= 2:
            text = parts[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()

    # Validate JSON BEFORE billing so users aren't charged for malformed responses
    try:
        parsed = json.loads(text) if text else {}
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
            int(elapsed * 1000), success=True, model=SUBV_AI_MODEL,
        )
        _deduct_credits(user, cost)
    except Exception as track_exc:
        logger.warning("track_ai_usage failed (%s): %s", feature, track_exc)

    return parsed


def _call_claude_text(user: ErpUser, feature: str, prompt: str, temperature: float = 0.3) -> str:
    """Call Claude Opus for plain text response (chat, checklist)."""
    _guard_ai(user)
    start = time_module.time()
    try:
        response = _anthropic_client.messages.create(
            model=SUBV_AI_MODEL,
            max_tokens=SUBV_AI_MAX_TOKENS,
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

    try:
        track_ai_usage(
            user, feature, input_tokens, output_tokens, cost,
            int(elapsed * 1000), success=True, model=SUBV_AI_MODEL,
        )
        _deduct_credits(user, cost)
    except Exception as track_exc:
        logger.warning("track_ai_usage failed (%s): %s", feature, track_exc)

    return text


# ============================================
# AI ENDPOINTS
# ============================================

@router.post("/ai/suggest")
async def ai_suggest_programmes(
    body: AiSuggestRequest,
    user: ErpUser = Depends(get_current_user),
):
    """AI: suggest matching programmes based on free-form project description."""
    _require_tenant(user)
    if not body.description_projet or not body.description_projet.strip():
        raise HTTPException(status_code=400, detail="Description de projet requise")

    budget_str = f"{body.budget:,.0f} $" if body.budget else "Non specifie"
    prompt = f"""Suggere les meilleurs programmes de subventions pour ce projet:

DESCRIPTION DU PROJET:
{body.description_projet}

BUDGET ESTIME: {budget_str}

Base sur ta connaissance des programmes quebecois et canadiens 2025, suggere les programmes les plus pertinents.

Reponds en JSON strict (sans markdown, sans texte supplementaire):
{{
    "programmes_federaux": [
        {{"nom": "nom", "organisme": "org", "pertinence": "explication", "montant_possible": "X$"}}
    ],
    "programmes_provinciaux": [
        {{"nom": "nom", "organisme": "org", "pertinence": "explication", "montant_possible": "X$"}}
    ],
    "credits_impot": [
        {{"nom": "nom", "description": "desc", "economie_potentielle": "X$"}}
    ],
    "autres_aides": [
        {{"type": "type", "description": "desc"}}
    ],
    "montant_total_potentiel": "estimation totale",
    "strategie_financement": "conseil strategique",
    "attention": "points a surveiller"
}}"""
    return _call_claude_json(user, "subventions_suggest", prompt, temperature=0.4)


@router.post("/ai/chat")
async def ai_chat(
    body: AiChatRequest,
    user: ErpUser = Depends(get_current_user),
):
    """AI: conversational chat with subsidy expert."""
    _require_tenant(user)
    if not body.question or not body.question.strip():
        raise HTTPException(status_code=400, detail="Question requise")

    prompt = body.question
    if body.context:
        prompt = f"""CONTEXTE:
{body.context}

QUESTION:
{body.question}

Reponds de maniere claire et actionnable en francais quebecois."""
    text = _call_claude_text(user, "subventions_chat", prompt, temperature=0.4)
    return {"response": text}


@router.post("/ai/checklist")
async def ai_generate_checklist(
    body: AiChecklistRequest,
    user: ErpUser = Depends(get_current_user),
):
    """AI: generate preparation checklist (Markdown) for a specific programme."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            """SELECT nom, organisme, type_aide, criteres_eligibilite, documents_requis
               FROM subventions_programmes WHERE id = %s""",
            (body.programme_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Programme introuvable")
        programme = _serialize(row)
    finally:
        _close_tenant(conn, cursor)

    prompt = f"""Genere une checklist complete pour preparer une demande a ce programme:

PROGRAMME: {programme.get('nom', 'N/A')}
ORGANISME: {programme.get('organisme', 'N/A')}
TYPE: {programme.get('type_aide', 'N/A')}
CRITERES: {programme.get('criteres_eligibilite') or 'Non specifies'}
DOCUMENTS MENTIONNES: {programme.get('documents_requis') or 'Non specifies'}

Genere une checklist Markdown complete avec exactement 5 sections:
1. Documents a rassembler
2. Informations a preparer
3. Elements de la demande
4. Etapes chronologiques
5. Conseils pour maximiser les chances

La checklist doit etre pratique et directement utilisable. Utilise des cases a cocher `- [ ]`."""
    text = _call_claude_text(user, "subventions_checklist", prompt, temperature=0.3)
    return {"programme": programme, "checklist": text}


@router.post("/ai/analyze-demande")
async def ai_analyze_demande(
    body: AiAnalyzeDemandeRequest,
    user: ErpUser = Depends(get_current_user),
):
    """AI: analyze a submitted application and return advice."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            """SELECT d.*, p.nom AS programme_nom, p.organisme, p.type_aide,
                      p.montant_max AS programme_montant_max,
                      p.criteres_eligibilite, p.documents_requis
               FROM subventions_demandes d
               LEFT JOIN subventions_programmes p ON p.id = d.programme_id
               WHERE d.id = %s""",
            (body.demande_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Demande introuvable")
        demande = _serialize(row)
    finally:
        _close_tenant(conn, cursor)

    programme_max = demande.get("programme_montant_max") or 0
    montant = demande.get("montant_demande") or 0

    prompt = f"""Analyse cette demande de subvention et fournis des conseils:

PROGRAMME VISE:
- Nom: {demande.get('programme_nom') or 'N/A'}
- Organisme: {demande.get('organisme') or 'N/A'}
- Type d'aide: {demande.get('type_aide') or 'N/A'}
- Montant max: {programme_max:,.0f} $
- Criteres: {demande.get('criteres_eligibilite') or 'Non specifies'}
- Documents requis: {demande.get('documents_requis') or 'Non specifies'}

DEMANDE:
- Montant demande: {montant:,.0f} $
- Statut actuel: {demande.get('statut') or 'BROUILLON'}
- Notes: {demande.get('notes') or 'Aucune'}

Produis une analyse en JSON strict (sans markdown):
{{
    "score_preparation": 0-100,
    "points_forts": ["point 1", "point 2"],
    "points_a_ameliorer": ["point 1", "point 2"],
    "documents_manquants_probables": ["doc 1", "doc 2"],
    "conseils_redaction": ["conseil 1", "conseil 2"],
    "risques_refus": ["risque 1 si applicable"],
    "estimation_delai_traitement": "X semaines/mois",
    "conseil_global": "conseil detaille"
}}"""
    return _call_claude_json(user, "subventions_analyze_demande", prompt, temperature=0.3)


@router.post("/ai/analyze-eligibility")
async def ai_analyze_eligibility(
    body: AiAnalyzeEligibilityRequest,
    user: ErpUser = Depends(get_current_user),
):
    """AI: deep eligibility analysis given a full company profile."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            """SELECT nom, type_aide, niveau_gouvernement, montant_min, montant_max,
                      pourcentage_aide, secteurs_admissibles
               FROM subventions_programmes
               WHERE actif = TRUE
               ORDER BY nom ASC
               LIMIT 40"""
        )
        programmes = [_serialize_programme(r) for r in cursor.fetchall()]
    finally:
        _close_tenant(conn, cursor)

    programmes_str = "\n".join([
        f"- {p.get('nom', 'N/A')}: {p.get('type_aide', 'N/A')}, "
        f"Montant: {float(p.get('montant_min') or 0):,.0f}$ - {float(p.get('montant_max') or 0):,.0f}$, "
        f"Secteurs: {p.get('secteurs_admissibles', [])}"
        for p in programmes[:20]
    ]) or "(Aucun programme actif)"

    ca = body.chiffre_affaires or 0
    emp = body.employes or 0
    projets = ", ".join(body.projets_prevus) if body.projets_prevus else "Non specifie"

    prompt = f"""Analyse l'eligibilite de cette entreprise aux programmes de subventions disponibles:

PROFIL DE L'ENTREPRISE:
- Secteur d'activite: {body.secteur or 'Non specifie'}
- Taille: {body.taille or 'PME'}
- Region: {body.region or 'Quebec'}
- Chiffre d'affaires annuel: {ca:,.0f} $
- Nombre d'employes: {emp}
- Projets prevus: {projets}

PROGRAMMES DISPONIBLES (extrait):
{programmes_str}

Produis une analyse en JSON strict (sans markdown, sans texte supplementaire):
{{
    "programmes_recommandes": [
        {{
            "nom": "nom du programme",
            "score_compatibilite": 0-100,
            "raison": "pourquoi ce programme convient",
            "montant_potentiel": 0,
            "difficulte_obtention": "facile/moyen/difficile",
            "actions_requises": ["action 1", "action 2"]
        }}
    ],
    "programmes_a_eviter": [
        {{"nom": "nom programme", "raison": "pourquoi pas adapte"}}
    ],
    "strategie_recommandee": "conseil strategique global",
    "montant_total_potentiel": 0,
    "prochaines_etapes": ["etape 1", "etape 2", "etape 3"]
}}"""
    return _call_claude_json(user, "subventions_eligibility", prompt, temperature=0.3)
