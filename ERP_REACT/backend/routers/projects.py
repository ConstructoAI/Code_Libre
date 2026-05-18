"""
ERP React - Projects Router
Projets + phases + assignations.
Based on app.py show_liste_projets (~3,000 lines).
"""

import os
import sys
import json
import logging
import time
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from typing import Optional

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db
from .ai import check_ai_guard, _check_credits, _deduct_credits, track_ai_usage

# Import Anthropic client for AI categorization
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
try:
    import anthropic
    _anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
except ImportError:
    _anthropic_client = None

try:
    import httpx
except ImportError:
    httpx = None

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["Projects"])


def _call_claude(*, model="claude-opus-4-7", max_tokens=32000, system=None, messages):
    """Call Claude via streaming. Retries on transient httpx/anthropic
    connection errors and wraps raw httpx errors in
    `anthropic.APIConnectionError` so caller's `except anthropic.APIError`
    handler maps them to 503 instead of generic 500. Mirrors `devis.py`.
    """
    kwargs = {"model": model, "max_tokens": max_tokens, "messages": messages, "timeout": 600.0}
    if system:
        kwargs["system"] = system

    transient_excs = [anthropic.APIConnectionError]
    if httpx is not None:
        transient_excs.extend([httpx.RemoteProtocolError, httpx.ReadError, httpx.ReadTimeout])
    transient_excs = tuple(transient_excs)

    last_exc = None
    for attempt in range(2):
        try:
            with _anthropic_client.messages.stream(**kwargs) as stream:
                return stream.get_final_message()
        except transient_excs as exc:
            last_exc = exc
            logger.warning(
                "_call_claude transient error on attempt %d: %s — retrying",
                attempt + 1, exc,
            )
            time.sleep(0.5 * (attempt + 1))

    if isinstance(last_exc, anthropic.APIError):
        raise last_exc
    try:
        req = getattr(last_exc, "request", None)
    except Exception:
        req = None
    try:
        wrapped = anthropic.APIConnectionError(
            message=f"Anthropic connection error: {last_exc}",
            request=req,
        )
    except Exception:
        raise last_exc
    raise wrapped from last_exc

PROJECT_STATUSES = ["En attente", "En cours", "Termine", "Annule", "Suspendu"]
PROJECT_PRIORITIES = ["Basse", "Moyenne", "Haute", "Urgente"]

# Columns that create_project / duplicate_project INSERT into. Old tenants may
# be missing some (migration gap). Apply ADD COLUMN IF NOT EXISTS before INSERT
# to prevent UndefinedColumn errors on pre-existing tables.
_PROJECTS_INSERT_DEFENSIVE_COLS = [
    ("client_company_id", "INTEGER"),
    ("description", "TEXT"),
    ("priorite", "TEXT"),
    ("type_projet", "TEXT"),
    ("date_debut_reel", "DATE"),
    ("date_fin_reel", "DATE"),
    ("budget_total", "NUMERIC(14,2)"),
    ("adresse_chantier", "TEXT"),
    ("ville_chantier", "TEXT"),
    ("numero_projet", "TEXT"),
]


# Memoization cache for _ensure_projects_insert_columns. Only written on FULL
# success to avoid masking a missing column permanently if a transient ALTER
# failure poisons the cache. Thread-safe under asyncio.
_projects_cols_ensured_for: set = set()


def _ensure_projects_insert_columns(cursor, conn, schema: str) -> None:
    """Defensively ADD COLUMN IF NOT EXISTS for columns inserted by
    create_project / duplicate_project. Memoized per tenant schema.

    Also creates `subsidy_applications` defensively for legacy tenants —
    prod DB logs (~2 occurrences over 33h) showed `relation
    "subsidy_applications" does not exist` from a SELECT path that we
    couldn't locate in the current codebase (likely a residual SQL view,
    function, or external query). Creating an empty table is harmless for
    tenants that already have it (IF NOT EXISTS) and silences the noise.
    """
    if schema and schema in _projects_cols_ensured_for:
        return

    # Track ALL defensive operations (subsidy CREATE + ALTER projects). The
    # memoize cache is only set if EVERY step succeeded — otherwise a silent
    # failure (rare: permission denied, aborted txn) would never be retried
    # within this process lifetime, and the original "relation does not
    # exist" log noise would resurface.
    all_succeeded = True

    # Defensive: legacy table referenced by an external SELECT path we no
    # longer own. Wrapped in its own try/except so a failure here cannot
    # block the projects ALTER batch.
    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS subsidy_applications (
                id SERIAL PRIMARY KEY,
                project_id INTEGER,
                programme_id INTEGER,
                statut TEXT DEFAULT 'BROUILLON',
                montant_demande NUMERIC,
                montant_approuve NUMERIC,
                date_soumission DATE,
                date_decision DATE,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_subsidy_applications_project "
            "ON subsidy_applications (project_id)"
        )
    except Exception as exc:
        all_succeeded = False
        logger.warning("ensure subsidy_applications failed: %s", exc)
        try:
            conn.rollback()
            if schema:
                db.set_tenant(conn, schema)
        except Exception:
            pass

    for col, ctype in _PROJECTS_INSERT_DEFENSIVE_COLS:
        try:
            cursor.execute(
                f"ALTER TABLE projects ADD COLUMN IF NOT EXISTS {col} {ctype}"
            )
        except Exception as exc:
            all_succeeded = False
            logger.warning("ALTER projects ADD %s failed: %s", col, exc)
            try:
                conn.rollback()
                if schema:
                    db.set_tenant(conn, schema)
            except Exception:
                pass
    if schema and all_succeeded:
        _projects_cols_ensured_for.add(schema)


def _generate_numero_projet(project_id: int, year: int) -> str:
    """Format standard du numero projet : PROJ-YYYY-NNNNN.
    Base sur l'ID auto-increment du projet (race-safe vs MAX+1) et l'annee
    courante. Coherent avec DEV-YYYY-NNNNN, OPP-YYYY-NNNNN, etc."""
    return f"PROJ-{year}-{project_id:05d}"


# Memoization pour eviter le backfill repetitif sur les memes tenants.
_projects_backfilled: set = set()


def _backfill_numero_projet(cursor, conn, schema: str) -> None:
    """Backfill numero_projet pour les projets existants qui n'en ont pas.
    Utilise l'annee de created_at + l'id auto-increment. Idempotent + memoise.
    """
    if schema and schema in _projects_backfilled:
        return
    try:
        cursor.execute("""
            UPDATE projects
            SET numero_projet = 'PROJ-' || EXTRACT(YEAR FROM COALESCE(created_at, CURRENT_TIMESTAMP))::int
                                || '-' || LPAD(id::text, 5, '0')
            WHERE numero_projet IS NULL OR numero_projet = ''
        """)
        conn.commit()
        if schema:
            _projects_backfilled.add(schema)
    except Exception as exc:
        logger.warning("backfill numero_projet failed for %s: %s", schema, exc)
        try:
            conn.rollback()
            if schema:
                db.set_tenant(conn, schema)
        except Exception:
            pass


def _empty_to_none(v):
    """Convert empty strings to None — used on date fields to avoid PostgreSQL
    'invalid input syntax for type date: ""' errors when frontend sends blank dates."""
    return None if isinstance(v, str) and v.strip() == "" else v


def _strip_non_empty(v):
    """Strip whitespace and reject empty strings. Passes None through.
    Used by required-name validators to block `""` and `"   "` inputs that
    create invisible/unsearchable records in the BD."""
    if v is None:
        return v
    v = str(v).strip()
    if not v:
        raise ValueError("Ne peut pas etre vide")
    return v


class ProjectCreate(BaseModel):
    nom_projet: str
    client_company_id: Optional[int] = None
    description: Optional[str] = None
    statut: str = "En attente"
    priorite: str = "Moyenne"
    type_projet: Optional[str] = None
    date_debut_reel: Optional[str] = None
    date_fin_reel: Optional[str] = None
    budget_total: Optional[float] = None
    adresse_chantier: Optional[str] = None
    ville_chantier: Optional[str] = None

    _nom_projet_validator = field_validator("nom_projet", mode="before")(_strip_non_empty)

    @field_validator("date_debut_reel", "date_fin_reel", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class ProjectUpdate(BaseModel):
    nom_projet: Optional[str] = None
    statut: Optional[str] = None
    priorite: Optional[str] = None
    description: Optional[str] = None
    date_debut_reel: Optional[str] = None
    date_fin_reel: Optional[str] = None
    budget_total: Optional[float] = None
    adresse_chantier: Optional[str] = None
    ville_chantier: Optional[str] = None

    _nom_projet_validator = field_validator("nom_projet", mode="before")(_strip_non_empty)

    @field_validator("date_debut_reel", "date_fin_reel", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class PhaseCreate(BaseModel):
    nom: str
    description: Optional[str] = None
    ordre: Optional[int] = None
    statut: str = "En attente"
    date_debut: Optional[str] = None
    date_fin: Optional[str] = None

    @field_validator("date_debut", "date_fin", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class PhaseUpdate(BaseModel):
    nom: Optional[str] = None
    description: Optional[str] = None
    ordre: Optional[int] = None
    statut: Optional[str] = None
    date_debut: Optional[str] = None
    date_fin: Optional[str] = None
    progression: Optional[float] = None

    @field_validator("date_debut", "date_fin", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class ProjectAssignmentCreate(BaseModel):
    employee_id: int
    role_projet: Optional[str] = None


class NoteCreate(BaseModel):
    titre: str
    contenu: str
    categorie: Optional[str] = None


@router.get("")
async def list_projects(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    statut: Optional[str] = None,
    priorite: Optional[str] = None,
):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Lazy migration: garantir que la colonne numero_projet existe + backfill
        # les projets historiques qui n'ont pas de numero (1 fois par tenant).
        _ensure_projects_insert_columns(cursor, conn, user.schema)
        _backfill_numero_projet(cursor, conn, user.schema)
        wheres, params = [], []
        if search:
            wheres.append("(LOWER(p.nom_projet) LIKE %s OR LOWER(p.description) LIKE %s OR LOWER(COALESCE(p.numero_projet, '')) LIKE %s)")
            s = f"%{search.lower()}%"
            params.extend([s, s, s])
        if statut:
            # Qualify with alias — `companies` also has a `statut` column so
            # the JOIN in the SELECT below makes this reference ambiguous.
            wheres.append("p.statut = %s")
            params.append(statut)
        if priorite:
            wheres.append("p.priorite = %s")
            params.append(priorite)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(f"SELECT COUNT(*) as total FROM projects p WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT p.id, p.nom_projet, p.numero_projet, p.client_company_id, p.statut, p.priorite, "
            f"p.type_projet, p.date_debut_reel, p.date_fin_reel, p.budget_total, p.description, "
            f"p.adresse_chantier, p.ville_chantier, "
            f"p.created_at, p.updated_at, "
            f"c.nom as client_nom "
            f"FROM projects p LEFT JOIN companies c ON p.client_company_id = c.id "
            f"WHERE {w} ORDER BY p.updated_at DESC NULLS LAST LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_debut_reel", "date_fin_reel", "created_at", "updated_at"):
                if d.get(k):
                    d[k] = str(d[k])
            if d.get("budget_total"):
                d["budget_total"] = float(d["budget_total"])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except Exception as exc:
        logger.error("list_projects error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/statistics")
async def get_project_statistics(user: ErpUser = Depends(get_current_user)):
    """Get project statistics."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT statut, COUNT(*) as count, COALESCE(SUM(budget_total), 0) as budget "
            "FROM projects GROUP BY statut"
        )
        par_statut = []
        total = 0
        en_cours = 0
        termines = 0
        budget_total_all = 0
        for row in cursor.fetchall():
            d = dict(row)
            d["budget"] = float(d["budget"])
            par_statut.append(d)
            total += d["count"]
            budget_total_all += d["budget"]
            if d["statut"] == "En cours":
                en_cours = d["count"]
            elif d["statut"] == "Termine":
                termines = d["count"]
        return {
            "total": total,
            "en_cours": en_cours,
            "termines": termines,
            "budget_total": budget_total_all,
            "par_statut": par_statut,
        }
    except Exception as exc:
        logger.error("get_project_statistics error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/duplicate/{project_id}")
async def duplicate_project(project_id: str, user: ErpUser = Depends(get_current_user)):
    """Duplicate a project."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Ensure all columns we're about to INSERT exist on this tenant (lazy migration)
        _ensure_projects_insert_columns(cursor, conn, user.schema)
        cursor.execute("SELECT * FROM projects WHERE id = %s", (project_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Projet non trouvé")
        original = dict(row)
        # Fix sequence if out of sync (explicit IDs can desync SERIAL).
        # Use is_called=false + GREATEST(max, 1) to avoid "value 0 is out of bounds"
        # when projects table is empty (PostgreSQL sequence range is 1..2^31-1).
        try:
            cursor.execute(
                "SELECT setval(pg_get_serial_sequence('projects', 'id'), "
                "GREATEST(COALESCE((SELECT MAX(id) FROM projects), 0), 1), "
                "(SELECT COUNT(*) > 0 FROM projects))"
            )
        except Exception as seq_exc:
            logger.warning("setval projects_id_seq failed: %s", seq_exc)
            try:
                conn.rollback()
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        # Generer un nouveau numero_projet pour la copie (si la colonne existe).
        # Meme strategie race-safe que create_project : reserver l'id via nextval.
        new_id = None
        numero_projet = None
        try:
            cursor.execute(
                "SELECT nextval(pg_get_serial_sequence('projects', 'id')) AS next_id, "
                "EXTRACT(YEAR FROM CURRENT_TIMESTAMP)::int AS year"
            )
            seq_row = cursor.fetchone()
            new_id = int(seq_row["next_id"])
            numero_projet = _generate_numero_projet(new_id, int(seq_row["year"]))
        except Exception as seq_exc:
            logger.warning("nextval projects_id_seq failed in duplicate: %s", seq_exc)
            try:
                conn.rollback()
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        try:
            if new_id is not None:
                cursor.execute(
                    "INSERT INTO projects (id, nom_projet, numero_projet, client_company_id, description, statut, "
                    "priorite, type_projet, date_debut_reel, date_fin_reel, budget_total, adresse_chantier, "
                    "ville_chantier, created_at, updated_at) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
                    "RETURNING id",
                    (new_id, "Copie de " + (original.get("nom_projet") or ""), numero_projet,
                     original.get("client_company_id"), original.get("description"),
                     "En attente", original.get("priorite"),
                     original.get("type_projet"), original.get("date_debut_reel"),
                     original.get("date_fin_reel"), original.get("budget_total"),
                     original.get("adresse_chantier"), original.get("ville_chantier")),
                )
                new_id = int(cursor.fetchone()["id"])
            else:
                raise RuntimeError("nextval failed, fallback")
        except Exception as ins_exc:
            logger.warning("INSERT duplicate with numero_projet failed, fallback: %s", ins_exc)
            try:
                conn.rollback()
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
            cursor.execute(
                "INSERT INTO projects (nom_projet, client_company_id, description, statut, "
                "priorite, type_projet, date_debut_reel, date_fin_reel, budget_total, adresse_chantier, "
                "ville_chantier, created_at, updated_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
                "RETURNING id",
                ("Copie de " + (original.get("nom_projet") or ""),
                 original.get("client_company_id"), original.get("description"),
                 "En attente", original.get("priorite"),
                 original.get("type_projet"), original.get("date_debut_reel"),
                 original.get("date_fin_reel"), original.get("budget_total"),
                 original.get("adresse_chantier"), original.get("ville_chantier")),
            )
            new_id = int(cursor.fetchone()["id"])
            numero_projet = None
        conn.commit()
        return {"id": new_id, "numero_projet": numero_projet, "message": "Projet duplique"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("duplicate_project error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/export-csv")
async def export_projects_csv(user: ErpUser = Depends(get_current_user)):
    """Export projects as CSV."""
    from fastapi.responses import StreamingResponse
    import csv
    import io

    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Lazy migration: garantir colonne numero_projet + backfill
        _ensure_projects_insert_columns(cursor, conn, user.schema)
        _backfill_numero_projet(cursor, conn, user.schema)
        cursor.execute(
            "SELECT p.id, p.numero_projet, p.nom_projet, p.statut, p.priorite, p.type_projet, "
            "p.date_debut_reel, p.date_fin_reel, p.budget_total, p.description, "
            "p.adresse_chantier, p.ville_chantier, p.created_at, p.updated_at, "
            "c.nom as client_nom "
            "FROM projects p LEFT JOIN companies c ON p.client_company_id = c.id "
            "ORDER BY p.created_at DESC"
        )
        rows = cursor.fetchall()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "ID", "Numero Projet", "Nom Projet", "Statut", "Priorite", "Type", "Client",
            "Date Debut", "Date Fin", "Budget Total", "Description",
            "Adresse Chantier", "Ville Chantier", "Notes", "Cree le", "Modifie le",
        ])
        for row in rows:
            d = dict(row)
            writer.writerow([
                d.get("id"), d.get("numero_projet") or "", d.get("nom_projet"), d.get("statut"), d.get("priorite"),
                d.get("type_projet"), d.get("client_nom"),
                str(d["date_debut_reel"]) if d.get("date_debut_reel") else "",
                str(d["date_fin_reel"]) if d.get("date_fin_reel") else "",
                float(d["budget_total"]) if d.get("budget_total") else "",
                d.get("description") or "", d.get("adresse_chantier") or "",
                d.get("ville_chantier") or "", d.get("description") or "",
                str(d["created_at"]) if d.get("created_at") else "",
                str(d["updated_at"]) if d.get("updated_at") else "",
            ])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=projets_export.csv"},
        )
    except Exception as exc:
        logger.error("export_projects_csv error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


class BatchUpdate(BaseModel):
    project_ids: list
    statut: Optional[str] = None
    priorite: Optional[str] = None


@router.post("/batch-update")
async def batch_update_projects(body: BatchUpdate, user: ErpUser = Depends(get_current_user)):
    """Batch update multiple projects."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if not body.project_ids:
        raise HTTPException(status_code=400, detail="Aucun projet selectionne")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        updated = 0
        if body.statut:
            cursor.execute(
                "UPDATE projects SET statut = %s, updated_at = CURRENT_TIMESTAMP "
                "WHERE id = ANY(%s)",
                (body.statut, body.project_ids),
            )
            updated = cursor.rowcount
        if body.priorite:
            cursor.execute(
                "UPDATE projects SET priorite = %s, updated_at = CURRENT_TIMESTAMP "
                "WHERE id = ANY(%s)",
                (body.priorite, body.project_ids),
            )
            updated = max(updated, cursor.rowcount)
        conn.commit()
        return {"updated": updated, "message": f"{updated} projets mis à jour"}
    except Exception as exc:
        logger.error("batch_update_projects error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/gantt")
async def get_gantt_data(user: ErpUser = Depends(get_current_user)):
    """Return projects with their phases optimized for Gantt display."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Lazy: backfill numero_projet pour les vieux projets sans numero
        _ensure_projects_insert_columns(cursor, conn, user.schema)
        _backfill_numero_projet(cursor, conn, user.schema)
        cursor.execute(
            "SELECT p.id, p.nom_projet, p.numero_projet, p.statut, p.priorite, p.date_debut_reel, p.date_fin_reel, "
            "p.budget_total "
            "FROM projects p "
            "WHERE p.statut NOT IN ('Annule') "
            "ORDER BY p.date_debut_reel ASC NULLS LAST, p.nom_projet ASC "
            "LIMIT 500"
        )
        projects = []
        project_ids = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_debut_reel", "date_fin_reel"):
                if d.get(k):
                    d[k] = str(d[k])
            if d.get("budget_total"):
                d["budget_total"] = float(d["budget_total"])
            d["phases"] = []
            projects.append(d)
            project_ids.append(d["id"])

        # Fetch phases for all projects in one query
        if project_ids:
            try:
                cursor.execute(
                    "CREATE TABLE IF NOT EXISTS project_phases ("
                    "id SERIAL PRIMARY KEY, "
                    "project_id INTEGER NOT NULL, "
                    "nom VARCHAR(255) NOT NULL, "
                    "description TEXT, "
                    "ordre INT DEFAULT 0, "
                    "statut VARCHAR(50) DEFAULT 'En attente', "
                    "date_debut DATE, "
                    "date_fin DATE, "
                    "progression NUMERIC(5,2) DEFAULT 0)"
                )
                placeholders = ",".join(["%s"] * len(project_ids))
                cursor.execute(
                    f"SELECT id, project_id, nom, description, ordre, statut, "
                    f"date_debut, date_fin, progression "
                    f"FROM project_phases "
                    f"WHERE project_id IN ({placeholders}) "
                    f"ORDER BY project_id, ordre ASC",
                    project_ids,
                )
                phases_by_project = {}
                for row in cursor.fetchall():
                    pd = dict(row)
                    for k in ("date_debut", "date_fin"):
                        if pd.get(k):
                            pd[k] = str(pd[k])
                    pid = str(pd.pop("project_id"))
                    phases_by_project.setdefault(pid, []).append(pd)

                for p in projects:
                    p["phases"] = phases_by_project.get(str(p["id"]), [])
                    # Aggregate progression from phases
                    if p["phases"]:
                        total_prog = sum(float(ph.get("progression") or 0) for ph in p["phases"])
                        p["progression"] = round(total_prog / len(p["phases"]), 1)
                    else:
                        p["progression"] = 0
            except Exception:
                conn.rollback()
                db.set_tenant(conn, user.schema)

        return {"items": projects}
    except Exception as exc:
        logger.error("get_gantt_data error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement des donnees Gantt")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/{project_id}")
async def get_project(project_id: str, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Coherence avec list_projects/get_gantt_data/export_csv : garantir
        # la colonne numero_projet et backfiller les projets historiques.
        # SELECT * inclura ainsi systematiquement numero_projet meme sur
        # les tenants qui n'auraient pas encore eu d'autre interaction
        # avec /projects (ex: dossier qui charge le projet directement).
        _ensure_projects_insert_columns(cursor, conn, user.schema)
        _backfill_numero_projet(cursor, conn, user.schema)
        cursor.execute(
            "SELECT p.*, c.nom as client_nom FROM projects p "
            "LEFT JOIN companies c ON p.client_company_id = c.id WHERE p.id = %s",
            (project_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Projet non trouvé")
        d = dict(row)
        for k in ("date_debut_reel", "date_fin_reel", "created_at", "updated_at"):
            if d.get(k):
                d[k] = str(d[k])
        if d.get("budget_total"):
            d["budget_total"] = float(d["budget_total"])
        # Get phases
        try:
            cursor.execute(
                "CREATE TABLE IF NOT EXISTS project_phases ("
                "id SERIAL PRIMARY KEY, "
                "project_id INTEGER NOT NULL, "
                "nom VARCHAR(255) NOT NULL, "
                "description TEXT, "
                "ordre INT DEFAULT 0, "
                "statut VARCHAR(50) DEFAULT 'En attente', "
                "date_debut DATE, "
                "date_fin DATE, "
                "progression NUMERIC(5,2) DEFAULT 0)"
            )
            cursor.execute(
                "SELECT id, nom, description, ordre, statut, date_debut, date_fin, progression "
                "FROM project_phases WHERE project_id = %s ORDER BY ordre ASC",
                (project_id,),
            )
            phases = []
            for p in cursor.fetchall():
                pd = dict(p)
                for k in ("date_debut", "date_fin"):
                    if pd.get(k):
                        pd[k] = str(pd[k])
                phases.append(pd)
            d["phases"] = phases
        except Exception:
            conn.rollback()
            db.set_tenant(conn, user.schema)
            d["phases"] = []
        # Get assignments
        try:
            cursor.execute(
                "SELECT pa.id, pa.employee_id, pa.role_projet, pa.date_assignation, "
                "e.prenom || ' ' || e.nom as employe_nom "
                "FROM project_assignments pa "
                "LEFT JOIN employees e ON pa.employee_id = e.id "
                "WHERE pa.project_id = %s",
                (project_id,),
            )
            d["assignments"] = [dict(a) for a in cursor.fetchall()]
        except Exception:
            conn.rollback()
            db.set_tenant(conn, user.schema)
            d["assignments"] = []
        return d
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_project error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/{project_id}/financials")
async def get_project_financials(project_id: int, user: ErpUser = Depends(get_current_user)):
    """Get financial summary for a project: revenues (devis, factures), expenses (materials, labor)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Budget
        cursor.execute(
            "SELECT budget_total FROM projects WHERE id = %s", (project_id,)
        )
        proj = cursor.fetchone()
        if not proj:
            raise HTTPException(status_code=404, detail="Projet non trouve")
        budget = float(proj["budget_total"]) if proj["budget_total"] else 0.0

        # --- REVENUS ---

        # Devis acceptes lies au projet
        devis_items = []
        devis_total = 0.0
        try:
            cursor.execute(
                "SELECT id, numero_devis, nom_projet, statut, "
                "total_avant_taxes, investissement_total "
                "FROM devis WHERE project_id = %s AND UPPER(statut) IN ('ACCEPTÉ', 'ACCEPTE', 'APPROUVE', 'APPROUVÉ') "
                "ORDER BY created_at DESC",
                (project_id,),
            )
            for row in cursor.fetchall():
                d = dict(row)
                montant = float(d.get("investissement_total") or d.get("total_avant_taxes") or 0)
                devis_total += montant
                devis_items.append({
                    "id": d["id"],
                    "numero": d.get("numero_devis") or "",
                    "description": d.get("nom_projet") or "",
                    "montant": round(montant, 2),
                })
        except Exception:
            pass

        # Factures liees au projet
        factures_items = []
        factures_total = 0.0
        factures_payees = 0.0
        try:
            cursor.execute(
                "SELECT id, numero_facture, numero, client_nom, statut, "
                "montant_ttc, montant_total, montant_paye, solde_du "
                "FROM factures WHERE project_id = %s AND UPPER(statut) != 'ANNULEE' "
                "ORDER BY date_facture DESC",
                (project_id,),
            )
            for row in cursor.fetchall():
                d = dict(row)
                montant = float(d.get("montant_ttc") or d.get("montant_total") or 0)
                paye = float(d.get("montant_paye") or 0)
                factures_total += montant
                factures_payees += paye
                factures_items.append({
                    "id": d["id"],
                    "numero": d.get("numero_facture") or d.get("numero") or "",
                    "client": d.get("client_nom") or "",
                    "statut": d.get("statut") or "",
                    "montant": round(montant, 2),
                    "paye": round(paye, 2),
                    "solde": round(float(d.get("solde_du") or 0), 2),
                })
        except Exception:
            pass

        # --- DEPENSES ---

        # Bons de commande (materiaux)
        bc_items = []
        bc_total = 0.0
        try:
            cursor.execute(
                "SELECT id, numero, numero_bon, fournisseur_nom, statut, "
                "sous_total, montant_total "
                "FROM bons_commande WHERE project_id = %s AND LOWER(statut) NOT IN ('annule', 'annulee') "
                "ORDER BY date_commande DESC",
                (project_id,),
            )
            for row in cursor.fetchall():
                d = dict(row)
                montant = float(d.get("montant_total") or d.get("sous_total") or 0)
                bc_total += montant
                bc_items.append({
                    "id": d["id"],
                    "numero": d.get("numero_bon") or d.get("numero") or "",
                    "fournisseur": d.get("fournisseur_nom") or "",
                    "statut": d.get("statut") or "",
                    "montant": round(montant, 2),
                })
        except Exception:
            pass

        # Main-d'oeuvre (pointages / time_entries)
        mo_items = []
        mo_total = 0.0
        mo_heures = 0.0
        try:
            cursor.execute(
                "SELECT te.employee_id, "
                "e.prenom || ' ' || e.nom as employe_nom, "
                "e.poste, "
                "COUNT(te.id) as nb_pointages, "
                "COALESCE(SUM(te.total_hours), 0) as total_heures, "
                "COALESCE(SUM(te.total_hours * COALESCE(e.taux_horaire, e.salaire, 0)), 0) as total_cout "
                "FROM time_entries te "
                "LEFT JOIN employees e ON te.employee_id = e.id "
                "WHERE te.project_id = %s AND te.punch_out IS NOT NULL "
                "GROUP BY te.employee_id, e.prenom, e.nom, e.poste "
                "ORDER BY total_cout DESC",
                (project_id,),
            )
            for row in cursor.fetchall():
                d = dict(row)
                cout = float(d.get("total_cout") or 0)
                heures = float(d.get("total_heures") or 0)
                mo_total += cout
                mo_heures += heures
                mo_items.append({
                    "employeId": d["employee_id"],
                    "employe": d.get("employe_nom") or "",
                    "poste": d.get("poste") or "",
                    "heures": round(heures, 2),
                    "cout": round(cout, 2),
                })
        except Exception:
            pass

        # --- TOTAUX ---
        total_revenus = round(factures_total, 2)
        total_depenses = round(bc_total + mo_total, 2)
        marge = round(total_revenus - total_depenses, 2)
        marge_pct = round((marge / total_revenus * 100), 1) if total_revenus > 0 else 0.0

        return {
            "project_id": project_id,
            "budget": round(budget, 2),
            "revenus": {
                "devis": {"items": devis_items, "total": round(devis_total, 2)},
                "factures": {"items": factures_items, "total": round(factures_total, 2), "paye": round(factures_payees, 2)},
                "total": total_revenus,
            },
            "depenses": {
                "materiaux": {"items": bc_items, "total": round(bc_total, 2)},
                "main_oeuvre": {"items": mo_items, "total": round(mo_total, 2), "heures": round(mo_heures, 2)},
                "total": total_depenses,
            },
            "marge": marge,
            "marge_pct": marge_pct,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_project_financials error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("")
async def create_project(body: ProjectCreate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Ensure all columns we're about to INSERT exist on this tenant (lazy migration)
        _ensure_projects_insert_columns(cursor, conn, user.schema)
        # Fix sequence if out of sync (explicit IDs can desync SERIAL).
        # Use is_called=false + GREATEST(max, 1) to avoid "value 0 is out of bounds"
        # when projects table is empty (PostgreSQL sequence range is 1..2^31-1).
        try:
            cursor.execute(
                "SELECT setval(pg_get_serial_sequence('projects', 'id'), "
                "GREATEST(COALESCE((SELECT MAX(id) FROM projects), 0), 1), "
                "(SELECT COUNT(*) > 0 FROM projects))"
            )
        except Exception as seq_exc:
            logger.warning("setval projects_id_seq failed: %s", seq_exc)
            try:
                conn.rollback()
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        # Strategie race-safe : reserver l'id via nextval() AVANT l'INSERT,
        # puis INSERT avec id + numero_projet inclus dans la meme query.
        # Evite le pattern fragile INSERT-puis-UPDATE qui cassait la transaction
        # si le UPDATE echouait sur les tenants legacy sans la colonne.
        new_id = None
        numero_projet = None
        try:
            cursor.execute(
                "SELECT nextval(pg_get_serial_sequence('projects', 'id')) AS next_id, "
                "EXTRACT(YEAR FROM CURRENT_TIMESTAMP)::int AS year"
            )
            seq_row = cursor.fetchone()
            new_id = int(seq_row["next_id"])
            numero_projet = _generate_numero_projet(new_id, int(seq_row["year"]))
        except Exception as seq_exc:
            # Si nextval echoue (pas de sequence sur projects.id, rare), on
            # tombe sur INSERT classique sans id explicite ni numero_projet.
            logger.warning("nextval projects_id_seq failed: %s", seq_exc)
            try:
                conn.rollback()
                db.set_tenant(conn, user.schema)
            except Exception:
                pass

        try:
            if new_id is not None:
                # Chemin nominal : id + numero_projet dans le meme INSERT
                cursor.execute(
                    "INSERT INTO projects (id, nom_projet, numero_projet, client_company_id, description, statut, "
                    "priorite, type_projet, date_debut_reel, date_fin_reel, budget_total, adresse_chantier, "
                    "ville_chantier, created_at, updated_at) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
                    "RETURNING id",
                    (new_id, body.nom_projet, numero_projet, body.client_company_id, body.description,
                     body.statut, body.priorite, body.type_projet, body.date_debut_reel,
                     body.date_fin_reel, body.budget_total, body.adresse_chantier, body.ville_chantier),
                )
                row = cursor.fetchone()
                new_id = int(row["id"])
            else:
                raise RuntimeError("nextval failed, fallback")
        except Exception as insert_exc:
            # Fallback : tenant ultra-legacy sans colonne numero_projet OU
            # nextval n'a pas marche. INSERT classique sans id ni numero_projet.
            logger.warning("INSERT with numero_projet failed, fallback sans numero: %s", insert_exc)
            try:
                conn.rollback()
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
            cursor.execute(
                "INSERT INTO projects (nom_projet, client_company_id, description, statut, "
                "priorite, type_projet, date_debut_reel, date_fin_reel, budget_total, adresse_chantier, "
                "ville_chantier, created_at, updated_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
                "RETURNING id",
                (body.nom_projet, body.client_company_id, body.description,
                 body.statut, body.priorite, body.type_projet, body.date_debut_reel,
                 body.date_fin_reel, body.budget_total, body.adresse_chantier, body.ville_chantier),
            )
            new_id = int(cursor.fetchone()["id"])
            numero_projet = None
        conn.commit()
        return {"id": new_id, "numero_projet": numero_projet, "message": "Projet créé"}
    except Exception as exc:
        logger.error("create_project error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/{project_id}")
async def update_project(project_id: str, body: ProjectUpdate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    ALLOWED = {"nom_projet", "statut", "priorite", "description", "date_debut_reel", "date_fin_reel",
               "budget_total", "adresse_chantier", "ville_chantier"}
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [project_id]
        cursor.execute(f"UPDATE projects SET {', '.join(set_parts)} WHERE id = %s", values)
        conn.commit()
        return {"message": "Projet mis à jour"}
    except Exception as exc:
        logger.error("update_project error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# PROJECT → DOSSIER LINK
# ============================================

@router.get("/{project_id}/dossier")
async def get_project_dossier(project_id: str, user: ErpUser = Depends(get_current_user)):
    """Get the dossier linked to a project (via dossier_projets association table)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT d.id, d.numero_dossier, d.titre, d.statut, d.type_dossier "
                "FROM dossiers d "
                "JOIN dossier_projets dp ON dp.dossier_id = d.id "
                "WHERE dp.project_id = %s "
                "ORDER BY dp.date_association DESC LIMIT 1",
                (project_id,),
            )
            row = cursor.fetchone()
        except Exception:
            row = None
        if not row:
            return {"dossier": None}
        return {"dossier": dict(row)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_project_dossier error: %s", exc)
        return {"dossier": None}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# PROJECT PHASES
# ============================================

@router.post("/{project_id}/phases")
async def create_phase(project_id: str, body: PhaseCreate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Ensure table exists
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS project_phases ("
            "id SERIAL PRIMARY KEY, "
            "project_id INTEGER NOT NULL, "
            "nom VARCHAR(255) NOT NULL, "
            "description TEXT, "
            "ordre INT DEFAULT 0, "
            "statut VARCHAR(50) DEFAULT 'En attente', "
            "date_debut DATE, "
            "date_fin DATE, "
            "progression NUMERIC(5,2) DEFAULT 0)"
        )
        # Verify project exists
        cursor.execute("SELECT id FROM projects WHERE id = %s", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Projet non trouvé")
        # Auto-increment ordre if not provided
        ordre = body.ordre
        if ordre is None:
            cursor.execute(
                "SELECT COALESCE(MAX(ordre), 0) + 1 AS next_ordre "
                "FROM project_phases WHERE project_id = %s",
                (project_id,),
            )
            ordre = cursor.fetchone()["next_ordre"]
        cursor.execute(
            "INSERT INTO project_phases (project_id, nom, description, ordre, statut, date_debut, date_fin) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (project_id, body.nom, body.description, ordre, body.statut,
             body.date_debut, body.date_fin),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Phase créée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_phase error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/{project_id}/phases/{phase_id}")
async def update_phase(project_id: str, phase_id: int, body: PhaseUpdate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    ALLOWED = {"nom", "description", "ordre", "statut", "date_debut", "date_fin", "progression"}
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        set_parts = [f"{k} = %s" for k in fields]
        values = list(fields.values()) + [phase_id, project_id]
        cursor.execute(
            f"UPDATE project_phases SET {', '.join(set_parts)} "
            f"WHERE id = %s AND project_id = %s",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Phase non trouvée")
        conn.commit()
        return {"message": "Phase mise à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_phase error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# PROJECT NOTES (with AI categorization)
# ============================================

@router.get("/{project_id}/notes")
async def list_project_notes(project_id: str, user: ErpUser = Depends(get_current_user)):
    """List notes for a project."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, project_id, titre, contenu, categorie, categorie_ia, "
            "importance, date_creation, date_modification "
            "FROM project_notes WHERE project_id = %s "
            "ORDER BY date_creation DESC",
            (project_id,),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_creation", "date_modification"):
                if d.get(k):
                    d[k] = str(d[k])
            if d.get("importance"):
                d["importance"] = float(d["importance"])
            items.append(d)
        return {"items": items}
    except Exception as exc:
        logger.error("list_project_notes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des notes")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/{project_id}/notes")
async def create_project_note(
    project_id: str, body: NoteCreate, user: ErpUser = Depends(get_current_user)
):
    """Create a note for a project."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Verify project exists
        cursor.execute("SELECT id FROM projects WHERE id = %s", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Projet non trouvé")

        cursor.execute(
            "INSERT INTO project_notes (project_id, titre, contenu, categorie, "
            "date_creation, date_modification) "
            "VALUES (%s,%s,%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (project_id, body.titre, body.contenu, body.categorie),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Note créée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_project_note error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la création de la note")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/{project_id}/notes/{note_id}/categorize")
async def categorize_project_note(
    project_id: str, note_id: int, user: ErpUser = Depends(get_current_user)
):
    """AI categorization of a project note using Claude."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if _anthropic_client is None:
        raise HTTPException(status_code=503, detail="Service IA non disponible")

    # AI billing: guard + credit check
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")
    credits_ok, balance = _check_credits(user)
    if not credits_ok:
        raise HTTPException(status_code=402, detail="Credits IA epuises. Veuillez recharger votre solde.")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Fetch note
        cursor.execute(
            "SELECT id, titre, contenu FROM project_notes WHERE id = %s AND project_id = %s",
            (note_id, project_id),
        )
        note = cursor.fetchone()
        if not note:
            raise HTTPException(status_code=404, detail="Note non trouvée")

        note = dict(note)

        # Call Claude for categorization
        prompt = (
            "Tu es un assistant specialise dans la gestion de projets de construction au Quebec. "
            "Categorise cette note de projet. Reponds UNIQUEMENT en JSON valide avec les champs: "
            "categorie (str), categorie_ia (str), importance (float 0-1).\n\n"
            "Categories possibles: Technique, Securite, Budget, Planning, Qualite, "
            "Communication, Environnement, RH, Approvisionnement, Autre.\n\n"
            f"Titre: {note['titre']}\n"
            f"Contenu: {note['contenu']}"
        )

        response = _call_claude(
            model="claude-opus-4-7",
            max_tokens=32000,
            messages=[{"role": "user", "content": prompt}],
        )

        # AI billing: track usage + deduct credits
        # Opus 4.7: $15/M input, $75/M output, $18.75/M cache write, $1.50/M cache read
        tokens_in = response.usage.input_tokens
        tokens_out = response.usage.output_tokens
        cache_creation = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
        cost = (
            tokens_in * 15 / 1_000_000
            + tokens_out * 75 / 1_000_000
            + cache_creation * 18.75 / 1_000_000
            + cache_read * 1.50 / 1_000_000
        ) * 1.30  # 30% markup
        track_ai_usage(user, "project_categorize_note", tokens_in, tokens_out, cost, 0, True)
        _deduct_credits(user, cost)

        # Parse AI response
        ai_text = response.content[0].text.strip()
        # Remove markdown code block if present
        if ai_text.startswith("```"):
            ai_text = ai_text.split("\n", 1)[1] if "\n" in ai_text else ai_text[3:]
            if ai_text.endswith("```"):
                ai_text = ai_text[:-3].strip()

        try:
            ai_result = json.loads(ai_text)
        except json.JSONDecodeError:
            ai_result = {"categorie": "Autre", "categorie_ia": "Non classifie", "importance": 0.5}

        categorie = ai_result.get("categorie", "Autre")
        categorie_ia = ai_result.get("categorie_ia", ai_result.get("sous_categorie", ""))
        importance = min(max(float(ai_result.get("importance", ai_result.get("confidence", 0.5))), 0.0), 1.0)

        # Update note
        cursor.execute(
            "UPDATE project_notes SET categorie = %s, categorie_ia = %s, "
            "importance = %s, date_modification = CURRENT_TIMESTAMP "
            "WHERE id = %s",
            (categorie, categorie_ia, importance, note_id),
        )
        conn.commit()

        return {
            "note_id": note_id,
            "categorie": categorie,
            "categorie_ia": categorie_ia,
            "importance": importance,
            "message": "Note categorisee par IA",
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("categorize_project_note error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la categorisation IA")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# PROJECT ASSIGNMENTS
# ============================================

@router.get("/{project_id}/assignments")
async def list_project_assignments(project_id: str, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT pa.id, pa.project_id, pa.employee_id, pa.role_projet, pa.date_assignation, "
                "e.prenom || ' ' || e.nom AS employe_nom "
                "FROM project_assignments pa "
                "LEFT JOIN employees e ON e.id = pa.employee_id "
                "WHERE pa.project_id = %s ORDER BY pa.date_assignation",
                (project_id,),
            )
            items = []
            for row in cursor.fetchall():
                d = dict(row)
                if d.get("date_assignation"):
                    d["date_assignation"] = str(d["date_assignation"])
                items.append(d)
        except Exception:
            items = []
        return {"items": items}
    except Exception as exc:
        logger.error("list_project_assignments error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/{project_id}/assignments")
async def add_project_assignment(project_id: str, body: ProjectAssignmentCreate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Ensure table exists
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS project_assignments ("
            "id SERIAL PRIMARY KEY, "
            "project_id INTEGER NOT NULL, "
            "employee_id INT NOT NULL, "
            "role_projet VARCHAR(100), "
            "date_assignation TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
        )
        # Check duplicate
        cursor.execute(
            "SELECT id FROM project_assignments WHERE project_id = %s AND employee_id = %s",
            (project_id, body.employee_id),
        )
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail="Employé déjà assigné a ce projet")
        cursor.execute(
            "INSERT INTO project_assignments (project_id, employee_id, role_projet, date_assignation) "
            "VALUES (%s, %s, %s, CURRENT_TIMESTAMP) RETURNING id",
            (project_id, body.employee_id, body.role_projet),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Employe assigne au projet"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("add_project_assignment error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/{project_id}/assignments/{assignment_id}")
async def remove_project_assignment(project_id: str, assignment_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        try:
            cursor.execute(
                "DELETE FROM project_assignments WHERE id = %s AND project_id = %s",
                (assignment_id, project_id),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Assignation non trouvée")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=404, detail="Assignation non trouvée")
        conn.commit()
        return {"message": "Assignation supprimée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("remove_project_assignment error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/{project_id}")
async def delete_project(project_id: str, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("SELECT id, statut FROM projects WHERE id = %s", (project_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Projet non trouvé")
        statut = (row.get("statut") or "").lower()
        if statut == "termine":
            raise HTTPException(status_code=400, detail="Impossible de supprimer un projet termine")
        for tbl in ("project_phases", "project_assignments", "project_notes",
                     "project_note_files", "project_notes_summary", "project_attachments",
                     "project_dependencies", "journal_lines", "journal_entries",
                     "alertes_meteo", "budgets_projets", "contrats_sous_traitance",
                     "gps_geofences", "historique_meteo_chantier", "journaux_chantier",
                     "location_contrats", "location_contrats_employes",
                     "logistics_deliveries", "logistics_equipment_reservations",
                     "logistics_site_coordination", "logistics_vehicle_trips",
                     "materials", "mouvements_stock", "operations", "depenses"):
            try:
                col = "projet_id" if tbl in ("depenses", "journal_lines", "journal_entries") else "project_id"
                cursor.execute(f"DELETE FROM {tbl} WHERE {col} = %s", (project_id,))
            except Exception:
                conn.rollback()
                db.set_tenant(conn, user.schema)
        for tbl, col in (("devis", "project_id"), ("formulaires", "project_id"),
                         ("factures", "project_id"), ("time_entries", "project_id"),
                         ("bons_commande", "project_id"), ("dossiers", "project_id"),
                         ("conversations", "project_id"), ("emails", "project_id"), ("email_threads", "project_id")):
            try:
                cursor.execute(f"UPDATE {tbl} SET {col} = NULL WHERE {col} = %s", (project_id,))
            except Exception:
                conn.rollback()
                db.set_tenant(conn, user.schema)
        for tbl in ("dossier_projets", "subsidy_applications", "realestate_units"):
            try:
                # to_regclass evite les "relation does not exist" dans les
                # logs PostgreSQL pour les tenants qui n'ont pas la table
                # (ex: subsidy_applications n'est creee que pour certains
                # tenants legacy). RealDictCursor → access by key, pas index.
                cursor.execute("SELECT to_regclass(%s) AS reg", (tbl,))
                row = cursor.fetchone()
                if not row or row.get("reg") is None:
                    continue
                cursor.execute(f"DELETE FROM {tbl} WHERE project_id = %s", (project_id,))
            except Exception:
                conn.rollback()
                db.set_tenant(conn, user.schema)
        # Cleanup Gantt dependencies attached to this project (any direction)
        try:
            cursor.execute(
                "DELETE FROM gantt_dependencies "
                "WHERE (source_type = 'project' AND source_id = %s) "
                "   OR (target_type = 'project' AND target_id = %s)",
                (str(project_id), str(project_id)),
            )
        except Exception:
            conn.rollback()
            db.set_tenant(conn, user.schema)
        cursor.execute("DELETE FROM projects WHERE id = %s", (project_id,))
        conn.commit()
        return {"message": "Projet supprime"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_project error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()
