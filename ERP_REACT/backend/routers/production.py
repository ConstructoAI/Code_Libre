"""
ERP React - Production Router
Bons de travail + Kanban board data.
Based on production_management.py (6,338 lines) + kanban.py (1,957 lines).
"""

import logging
import csv
import html as html_mod
import io
import re
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator
from typing import Optional

from ..erp_auth import get_current_user, require_role, ErpUser
from .. import erp_database as db


def _e(value) -> str:
    """HTML-escape a user-controlled string for safe interpolation in HTML output.

    Defense against stored XSS where a malicious BT name/notes/description could
    inject <script> tags that execute when the BT HTML is opened in a new tab
    (window.document.write bypasses sandbox iframe attribute). Always use this
    helper for ANY user-supplied string that goes into an HTML f-string.
    """
    if value is None:
        return ""
    return html_mod.escape(str(value), quote=True)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/production", tags=["Production"])

BT_STATUSES = ["BROUILLON", "EN_COURS", "TERMINE", "EN_PAUSE", "ANNULE"]
BT_PRIORITIES = ["BASSE", "NORMALE", "HAUTE", "URGENTE"]
OPERATION_STATUSES = ["En attente", "En cours", "Termine", "Annule"]

# RBAC: roles autorises a creer/modifier/supprimer BT, lignes, operations,
# assignations et a changer le statut. Un employe lambda peut seulement
# pointer ses heures (time_entries — module separe).
BT_WRITE_ROLES = ("admin", "super_admin", "gestionnaire", "contremaitre")

# State machine BT — transitions valides UNIQUEMENT.
# (statut_actuel) -> ensemble des statuts cibles autorises.
# - BROUILLON peut etre demarre (EN_COURS) ou annule.
# - EN_COURS peut etre mis en pause, termine, ou annule.
# - EN_PAUSE peut reprendre (EN_COURS) ou etre annule.
# - TERMINE et ANNULE sont des etats terminaux (pas de retour arriere
#   pour l'utilisateur — necessite super_admin pour overrider).
BT_STATUS_TRANSITIONS = {
    "BROUILLON": {"BROUILLON", "EN_COURS", "ANNULE"},
    "EN_COURS": {"EN_COURS", "EN_PAUSE", "TERMINE", "ANNULE"},
    "EN_PAUSE": {"EN_PAUSE", "EN_COURS", "ANNULE"},
    "TERMINE": {"TERMINE"},
    "ANNULE": {"ANNULE"},
}


def _is_super_admin(user: ErpUser) -> bool:
    """Bypass de la state machine pour super_admin (overrides ops critique)."""
    return (user.role == "super_admin") or (user.user_type == "super_admin")


# Mapping legacy: certains tenants ont des statuts heritage avec accents
# ou espaces (CHECK SQL formulaires_statut_check accepte 19 valeurs). On
# normalise vers la cle canonique avant lookup dans BT_STATUS_TRANSITIONS.
# FIX P2 (round 5): coverage etendu (BLOQUE/REPORTE/COMPLETE) pour couvrir
# les 19 valeurs CHECK SQL probables.
_STATUS_ALIASES = {
    "TERMINÉ": "TERMINE",
    "TERMINÉE": "TERMINE",
    "TERMINEE": "TERMINE",
    "COMPLETE": "TERMINE",
    "COMPLETÉ": "TERMINE",
    "COMPLETEE": "TERMINE",
    "COMPLETÉE": "TERMINE",
    "COMPLET": "TERMINE",
    "ANNULÉ": "ANNULE",
    "ANNULÉE": "ANNULE",
    "ANNULEE": "ANNULE",
    "EN COURS": "EN_COURS",
    "EN PAUSE": "EN_PAUSE",
    "BLOQUE": "EN_PAUSE",
    "BLOQUÉ": "EN_PAUSE",
    "BLOQUEE": "EN_PAUSE",
    "BLOQUÉE": "EN_PAUSE",
    "REPORTE": "EN_PAUSE",
    "REPORTÉ": "EN_PAUSE",
    "REPORTEE": "EN_PAUSE",
    "REPORTÉE": "EN_PAUSE",
    "EN ATTENTE": "BROUILLON",
    "EN_ATTENTE": "BROUILLON",
}


def _normalize_status(s: Optional[str]) -> str:
    """Normalise un statut legacy (accents/espaces) vers la cle canonique."""
    if not s:
        return "BROUILLON"
    upper = s.strip().upper()
    return _STATUS_ALIASES.get(upper, upper)


def _validate_status_transition(ancien: Optional[str], nouveau: str, user: ErpUser) -> None:
    """Raise 400 si la transition de statut est interdite.
    super_admin peut tout faire (override pour corriger des erreurs de saisie)."""
    if not nouveau or nouveau == ancien:
        return
    if _is_super_admin(user):
        return
    # FIX P1 (round 3): normaliser ancien (accents/espaces legacy) avant lookup
    # — sinon BT_STATUS_TRANSITIONS.get('TERMINÉ', set()) retourne set vide et
    # bloque toute transition pour les rows historiques avec accents.
    # FIX P2 (round 5): normaliser nouveau aussi pour eviter qu'un payload
    # client avec accent ("TERMINÉ") soit refuse alors que la semantique est OK.
    ancien_key = _normalize_status(ancien)
    nouveau_key = _normalize_status(nouveau)
    if nouveau_key == ancien_key:
        return  # transition no-op apres normalisation
    allowed = BT_STATUS_TRANSITIONS.get(ancien_key, set())
    if nouveau_key not in allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Transition de statut interdite: {ancien or 'BROUILLON'} -> {nouveau}. "
                f"Transitions autorisees depuis {ancien_key}: "
                f"{', '.join(sorted(allowed - {ancien_key})) or '(aucune)'}."
            ),
        )


def _empty_to_none(v):
    """Convert empty strings to None — used on date fields to avoid PostgreSQL
    'invalid input syntax for type date: ""' errors when frontend sends blank dates."""
    return None if isinstance(v, str) and v.strip() == "" else v


def _strip_non_empty(v):
    """Strip whitespace and reject empty strings. Passes None through.
    For optional name fields: user can omit the field entirely (None) but
    cannot send `""` or `"   "` — blocks invisible/unsearchable records."""
    if v is None:
        return v
    v = str(v).strip()
    if not v:
        raise ValueError("Ne peut pas etre vide")
    return v


class BonTravailCreate(BaseModel):
    nom: Optional[str] = None
    project_id: Optional[int] = None
    priorite: str = "NORMALE"
    date_echeance: Optional[str] = None
    date_debut: Optional[str] = None
    date_fin: Optional[str] = None
    notes: Optional[str] = None

    _nom_validator = field_validator("nom", mode="before")(_strip_non_empty)

    @field_validator("date_echeance", "date_debut", "date_fin", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class BonTravailUpdate(BaseModel):
    nom: Optional[str] = None
    statut: Optional[str] = None
    priorite: Optional[str] = None
    project_id: Optional[int] = None
    date_echeance: Optional[str] = None
    date_debut: Optional[str] = None
    date_fin: Optional[str] = None
    notes: Optional[str] = None

    _nom_validator = field_validator("nom", mode="before")(_strip_non_empty)

    @field_validator("date_echeance", "date_debut", "date_fin", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class LineItemCreate(BaseModel):
    description: str
    quantite: float = 1.0
    unite: Optional[str] = None
    prix_unitaire: float = 0.0
    produit_id: Optional[int] = None


class LineItemUpdate(BaseModel):
    description: Optional[str] = None
    quantite: Optional[float] = None
    unite: Optional[str] = None
    prix_unitaire: Optional[float] = None
    produit_id: Optional[int] = None


class AssignationCreate(BaseModel):
    employee_id: int
    role: Optional[str] = None


class CommentCreate(BaseModel):
    comment_text: str


# Whitelists pour DependencyCreate. Aligne avec frontend SuiviPage.tsx :
# 'project', 'bt', 'devis', 'bc' sont les seules sources/targets valides.
# 'finish_to_start' (FS), 'start_to_start' (SS), 'finish_to_finish' (FF),
# 'start_to_finish' (SF) sont les 4 types de dependances Gantt standard.
_GANTT_DEP_TYPES_VALID = {"project", "bt", "devis", "bc", "op", "opp"}
_GANTT_DEP_KIND_VALID = {
    "finish_to_start", "start_to_start", "finish_to_finish", "start_to_finish",
}


class DependencyCreate(BaseModel):
    source_type: str
    source_id: str
    target_type: str
    target_id: str
    dependency_type: str = "finish_to_start"
    lag_days: int = 0

    @field_validator("source_type", "target_type")
    @classmethod
    def _validate_gantt_type(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in _GANTT_DEP_TYPES_VALID:
            raise ValueError(
                f"Type Gantt invalide: '{v}'. Valeurs acceptees: "
                f"{sorted(_GANTT_DEP_TYPES_VALID)}"
            )
        return v

    @field_validator("source_id", "target_id")
    @classmethod
    def _validate_gantt_id(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("source_id et target_id ne peuvent pas etre vides.")
        if len(v) > 100:
            raise ValueError("ID trop long (max 100 caracteres).")
        # Format simple : alphanumerique + tiret/underscore (UUID, INT cast, slug)
        if not re.match(r"^[A-Za-z0-9_\-]+$", v):
            raise ValueError("ID contient des caracteres invalides.")
        return v

    @field_validator("dependency_type")
    @classmethod
    def _validate_dep_type(cls, v: str) -> str:
        # Garde explicite contre les chaines vides ('') ou None : on ne fallback
        # PAS silencieusement vers le default. Le default est applique par
        # Pydantic uniquement si le champ n'est pas fourni. Si le client envoie
        # explicitement '' ou None, c'est une erreur de validation.
        if v is None or (isinstance(v, str) and not v.strip()):
            raise ValueError("dependency_type ne peut pas etre vide.")
        v = v.strip().lower()
        if v not in _GANTT_DEP_KIND_VALID:
            raise ValueError(
                f"dependency_type invalide: '{v}'. Valeurs: "
                f"{sorted(_GANTT_DEP_KIND_VALID)}"
            )
        return v

    @field_validator("lag_days", mode="before")
    @classmethod
    def _validate_lag_days(cls, v) -> int:
        # mode='before' : on recoit la valeur AVANT toute coercion Pydantic.
        # Sans cela, Pydantic v2 coerce True->1 / False->0 / 1.5 (peut etre
        # accepte selon strict mode). On rejette explicitement les types
        # incompatibles ici pour avoir un comportement deterministe.
        if isinstance(v, bool):
            raise ValueError("lag_days doit etre un entier (pas un booleen).")
        if isinstance(v, float):
            raise ValueError("lag_days doit etre un entier (pas un float).")
        if not isinstance(v, int):
            raise ValueError("lag_days doit etre un entier.")
        if v < -3650 or v > 3650:
            raise ValueError("lag_days hors borne (-3650..+3650).")
        return v


class KanbanStatusUpdate(BaseModel):
    entity_type: str  # "project", "bt", "devis", "achat"
    entity_id: str
    new_statut: str


class AchatAssignationCreate(BaseModel):
    employee_id: int
    role: Optional[str] = None


class OperationCreate(BaseModel):
    nom: Optional[str] = None
    description: Optional[str] = None
    quantite: float = 1.0
    employee_id: Optional[int] = None
    fournisseur: str = "Interne"
    heures_prevues: float = 0.0
    statut: str = "En attente"
    date_debut: Optional[str] = None
    date_fin: Optional[str] = None
    poste_travail: Optional[str] = None

    @field_validator("date_debut", "date_fin", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class OperationUpdate(BaseModel):
    nom: Optional[str] = None
    description: Optional[str] = None
    quantite: Optional[float] = None
    employee_id: Optional[int] = None
    fournisseur: Optional[str] = None
    heures_prevues: Optional[float] = None
    heures_reelles: Optional[float] = None
    statut: Optional[str] = None
    date_debut: Optional[str] = None
    date_fin: Optional[str] = None
    poste_travail: Optional[str] = None

    @field_validator("date_debut", "date_fin", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


DEFAULT_OPERATION_TYPES = [
    "Demolition", "Decontamination", "Excavation", "Fondation/Coffrage",
    "Structure/Charpente", "Plomberie", "Electricite", "CVAC",
    "Isolation", "Gypse/Platre", "Peinture", "Toiture",
    "Revetement exterieur", "Menuiserie/Finition", "Plancher",
    "Ceramique", "Amenagement paysager", "Nettoyage final",
]


def _ensure_bt_tables(cursor):
    """Ensure bt_assignations and bt_comments tables exist (defensive migration)."""
    cursor.execute(
        "CREATE TABLE IF NOT EXISTS bt_assignations ("
        "id SERIAL PRIMARY KEY, "
        "bt_id INT NOT NULL, "
        "employee_id INT NOT NULL, "
        "role VARCHAR(100), "
        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    )
    cursor.execute(
        "CREATE TABLE IF NOT EXISTS bt_comments ("
        "id SERIAL PRIMARY KEY, "
        "bt_id INT NOT NULL, "
        "user_id VARCHAR(100), "
        "comment_text TEXT NOT NULL, "
        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    )


def _ensure_formulaire_lignes_produit_id(cursor):
    """Ensure formulaire_lignes has produit_id column (link to inventory)."""
    try:
        cursor.execute("ALTER TABLE formulaire_lignes ADD COLUMN IF NOT EXISTS produit_id INTEGER")
    except Exception:
        pass


def _ensure_operations_columns(cursor):
    """Ensure operations table has all required columns for BT operations."""
    for col, cdef in [
        ("nom", "TEXT"),
        ("employee_id", "INTEGER"),
        ("fournisseur", "TEXT DEFAULT 'Interne'"),
        ("quantite", "REAL DEFAULT 1.0"),
        ("heures_prevues", "REAL DEFAULT 0.0"),
        ("heures_reelles", "REAL DEFAULT 0.0"),
        ("updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("date_debut", "DATE"),
        ("date_fin", "DATE"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE operations ADD COLUMN IF NOT EXISTS {col} {cdef}")
        except Exception:
            pass


def _ensure_formulaires_date_columns(cursor):
    """Ensure formulaires table has date_debut / date_fin columns.

    Wraps each ALTER TABLE in a SAVEPOINT so that a transient failure (lock
    timeout, deadlock, statement_timeout) does not leave the surrounding
    transaction in an aborted state — every following SELECT in the same
    request would otherwise fail with `InFailedSqlTransaction`.

    In autocommit mode SAVEPOINT is unsupported, but each ALTER auto-commits
    independently so there is no abort-state risk. Detect and skip in that
    case.
    """
    autocommit = getattr(cursor.connection, "autocommit", False)
    for col in ("date_debut", "date_fin"):
        savepoint = f"sp_formulaires_{col}"
        try:
            if not autocommit:
                cursor.execute(f"SAVEPOINT {savepoint}")
            cursor.execute(f"ALTER TABLE formulaires ADD COLUMN IF NOT EXISTS {col} TIMESTAMP")
            if not autocommit:
                cursor.execute(f"RELEASE SAVEPOINT {savepoint}")
        except Exception:
            if not autocommit:
                try:
                    cursor.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
                except Exception:
                    pass


@router.get("/statistics")
async def get_production_statistics(user: ErpUser = Depends(get_current_user)):
    """Get production/BT statistics."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Per-status breakdown
        cursor.execute(
            "SELECT statut, COUNT(*) as count, COALESCE(SUM(montant_total), 0) as montant "
            "FROM formulaires WHERE type_formulaire = 'BON_TRAVAIL' GROUP BY statut"
        )
        par_statut = []
        total_count = 0
        en_cours = 0
        termines = 0
        montant_total = 0.0
        for row in cursor.fetchall():
            d = dict(row)
            d["montant"] = float(d["montant"])
            par_statut.append(d)
            total_count += d["count"]
            montant_total += d["montant"]
            if d["statut"] == "EN_COURS":
                en_cours = d["count"]
            elif d["statut"] == "TERMINE":
                termines = d["count"]
        # Employee assignments count
        assignations_count = 0
        try:
            cursor.execute("SELECT COUNT(*) as count FROM bt_assignations")
            assignations_count = cursor.fetchone()["count"]
        except Exception:
            pass
        return {
            "total": total_count,
            "en_cours": en_cours,
            "termines": termines,
            "montant_total": montant_total,
            "assignations_count": assignations_count,
            "par_statut": par_statut,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_production_statistics error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/work-centers")
async def list_work_centers(user: ErpUser = Depends(get_current_user)):
    """List work centers / postes de travail."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT * FROM operations ORDER BY nom")
            items = [dict(row) for row in cursor.fetchall()]
            return {"items": items}
        except Exception as exc:
            logger.warning("list_work_centers inner error: %s", exc)
            return {"items": [], "message": "Table operations non disponible"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_work_centers error: %s", exc)
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
# GANTT CHART ENDPOINTS
# ============================================

@router.get("/gantt/projects")
async def get_gantt_projects(user: ErpUser = Depends(get_current_user)):
    """Get projects formatted for Gantt chart display."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Try with progression from project_phases, fallback to simple query
        try:
            cursor.execute(
                "SELECT p.id, p.nom_projet, p.statut, p.priorite, p.date_debut_reel, p.date_fin_reel, "
                "p.budget_total, p.client_company_id, "
                "COALESCE(pp.avg_prog, 0) AS progression "
                "FROM projects p "
                "LEFT JOIN ("
                "  SELECT project_id, ROUND(AVG(COALESCE(progression, 0)), 1) AS avg_prog "
                "  FROM project_phases GROUP BY project_id"
                ") pp ON pp.project_id::text = p.id::text "
                "WHERE p.statut NOT IN ('Annule') "
                "ORDER BY p.date_debut_reel ASC NULLS LAST"
            )
        except Exception:
            conn.rollback()
            db.set_tenant(conn, user.schema)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, nom_projet, statut, priorite, date_debut_reel, date_fin_reel, "
                "budget_total, client_company_id "
                "FROM projects WHERE statut NOT IN ('Annule') "
                "ORDER BY date_debut_reel ASC NULLS LAST"
            )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            date_debut = d.get("date_debut_reel")
            date_fin = d.get("date_fin_reel")
            duree_jours = None
            if date_debut and date_fin:
                try:
                    delta = date_fin - date_debut
                    duree_jours = delta.days
                except Exception:
                    pass
            items.append({
                "id": d["id"],
                "nom": d["nom_projet"],
                "statut": d["statut"],
                "priorite": d.get("priorite"),
                "dateDebut": str(date_debut) if date_debut else None,
                "dateFin": str(date_fin) if date_fin else None,
                "budget": float(d["budget_total"]) if d.get("budget_total") else None,
                "progression": float(d.get("progression") or 0),
                "dureeJours": duree_jours,
                "clientId": d.get("client_company_id"),
            })
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_gantt_projects error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement des projets Gantt")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/gantt/devis")
async def get_gantt_devis(user: ErpUser = Depends(get_current_user)):
    """Get devis formatted for Gantt chart display."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # date_prevu = debut prevu des travaux, date_fin = fin prevue des travaux
        # Fallback: date_soumis as start if date_prevu is missing
        try:
            cursor.execute(
                "SELECT id, numero_devis, nom_projet, statut, date_soumis, date_prevu, date_fin, investissement_total "
                "FROM devis WHERE statut NOT IN ('Annule', 'Refuse') "
                "ORDER BY date_prevu ASC NULLS LAST"
            )
        except Exception:
            conn.rollback()
            db.set_tenant(conn, user.schema)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, numero_devis, nom_projet, statut, date_soumis, date_prevu, investissement_total "
                "FROM devis WHERE statut NOT IN ('Annule', 'Refuse') "
                "ORDER BY date_prevu ASC NULLS LAST"
            )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            date_debut = d.get("date_prevu") or d.get("date_soumis")
            date_fin = d.get("date_fin")
            duree_jours = None
            if date_debut and date_fin:
                try:
                    delta = date_fin - date_debut
                    duree_jours = delta.days
                except Exception:
                    pass
            items.append({
                "id": d["id"],
                "numero": d.get("numero_devis"),
                "nom": d.get("nom_projet") or f"Devis {d.get('numero_devis', '')}",
                "statut": d["statut"],
                "dateDebut": str(date_debut) if date_debut else None,
                "dateFin": str(date_fin) if date_fin else None,
                "montant": float(d["investissement_total"]) if d.get("investissement_total") else None,
                "dureeJours": duree_jours,
            })
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_gantt_devis error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement des devis Gantt")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/gantt/bons-travail")
async def get_gantt_bons_travail(user: ErpUser = Depends(get_current_user)):
    """Get real work orders (BT) with operations as sub-tasks for Gantt."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Ensure date columns exist on legacy tenants (avoids "column does not
        # exist" errors logged at DB level on every cold tenant query).
        _ensure_formulaires_date_columns(cursor)
        # Include date_debut/date_fin from BT itself (defensive: columns may not exist on old tenants)
        try:
            cursor.execute(
                "SELECT f.id, f.numero_document, f.nom, f.statut, f.priorite, "
                "f.date_echeance, f.date_debut, f.date_fin, f.montant_total, f.project_id, f.created_at, "
                "p.nom_projet "
                "FROM formulaires f "
                "LEFT JOIN projects p ON f.project_id::text = p.id::text "
                "WHERE f.type_formulaire = 'BON_TRAVAIL' AND f.statut NOT IN ('ANNULE') "
                "ORDER BY f.created_at DESC"
            )
        except Exception:
            conn.rollback()
            db.set_tenant(conn, user.schema)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT f.id, f.numero_document, f.nom, f.statut, f.priorite, "
                "f.date_echeance, f.montant_total, f.project_id, f.created_at, "
                "p.nom_projet "
                "FROM formulaires f "
                "LEFT JOIN projects p ON f.project_id::text = p.id::text "
                "WHERE f.type_formulaire = 'BON_TRAVAIL' AND f.statut NOT IN ('ANNULE') "
                "ORDER BY f.created_at DESC"
            )
        bt_rows = cursor.fetchall()
        bt_ids = [dict(r)["id"] for r in bt_rows]

        # Fetch operations for all BTs in one query
        ops_by_bt: dict = {}
        if bt_ids:
            cursor.execute(
                "SELECT o.id, o.formulaire_bt_id, o.nom, o.statut, o.date_debut, o.date_fin, "
                "o.heures_prevues, o.heures_reelles, o.employee_id, "
                "COALESCE(e.prenom || ' ' || e.nom, '') AS employee_nom "
                "FROM operations o "
                "LEFT JOIN employees e ON o.employee_id = e.id "
                "WHERE o.formulaire_bt_id = ANY(%s) "
                "ORDER BY o.formulaire_bt_id, o.id",
                (bt_ids,),
            )
            for orow in cursor.fetchall():
                od = dict(orow)
                bt_fk = od["formulaire_bt_id"]
                if bt_fk not in ops_by_bt:
                    ops_by_bt[bt_fk] = []
                progression = 0
                if od.get("heures_prevues") and od["heures_prevues"] > 0 and od.get("heures_reelles"):
                    progression = min(round(float(od["heures_reelles"]) / float(od["heures_prevues"]) * 100, 1), 100)
                ops_by_bt[bt_fk].append({
                    "id": od["id"],
                    "nom": od.get("nom") or f"Op-{od['id']}",
                    "statut": od.get("statut") or "A_FAIRE",
                    "assignee": od.get("employee_nom") or "",
                    "dateDebut": str(od["date_debut"]) if od.get("date_debut") else None,
                    "dateFin": str(od["date_fin"]) if od.get("date_fin") else None,
                    "progression": progression,
                    "ordre": od["id"],
                })

        items = []
        for row in bt_rows:
            d = dict(row)
            ops = ops_by_bt.get(d["id"], [])
            # Priority: BT explicit dates > operation dates > date_echeance > created_at
            bt_date_debut = str(d["date_debut"]) if d.get("date_debut") else None
            bt_date_fin = str(d["date_fin"]) if d.get("date_fin") else None
            date_debut = bt_date_debut
            date_fin = bt_date_fin or (str(d["date_echeance"]) if d.get("date_echeance") else None)
            if ops and not bt_date_debut:
                op_starts = [o["dateDebut"] for o in ops if o["dateDebut"]]
                op_ends = [o["dateFin"] for o in ops if o["dateFin"]]
                if op_starts:
                    date_debut = min(op_starts)
                if op_ends:
                    computed_fin = max(op_ends)
                    if not date_fin or computed_fin > str(date_fin):
                        date_fin = computed_fin
            if not date_debut:
                date_debut = str(d["created_at"])[:10] if d.get("created_at") else None

            nom_display = d.get("nom") or d.get("nom_projet") or d.get("numero_document") or f"BT-{d['id']}"
            items.append({
                "id": d["id"],
                "nomProjet": nom_display,
                "nom": nom_display,
                "numero": d.get("numero_document"),
                "statut": d["statut"],
                "priorite": d.get("priorite"),
                "dateDebut": date_debut,
                "dateFin": date_fin,
                "budget": float(d["montant_total"]) if d.get("montant_total") else None,
                "projectId": d.get("project_id"),
                "projectNom": d.get("nom_projet"),
                "phases": ops,
            })
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_gantt_bons_travail error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement des BT Gantt")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/gantt/bons-commande")
async def get_gantt_bons_commande(user: ErpUser = Depends(get_current_user)):
    """Get purchase orders for Gantt display."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT bc.id, bc.numero, bc.date_commande, bc.date_livraison_prevue, "
                "bc.statut, bc.montant_total, bc.project_id, "
                "p.nom_projet, f.nom_fournisseur AS fournisseur_nom "
                "FROM bons_commande bc "
                "LEFT JOIN projects p ON bc.project_id::text = p.id::text "
                "LEFT JOIN fournisseurs f ON bc.fournisseur_id = f.id "
                "WHERE bc.statut NOT IN ('Annule') "
                "ORDER BY bc.date_commande ASC NULLS LAST"
            )
            items = []
            for row in cursor.fetchall():
                d = dict(row)
                date_cmd = d.get("date_commande")
                date_liv = d.get("date_livraison_prevue")
                duree_jours = None
                if date_cmd and date_liv:
                    try:
                        delta = date_liv - date_cmd
                        duree_jours = delta.days
                    except Exception:
                        pass
                nom = d.get("fournisseur_nom") or d.get("numero") or f"BC-{d['id']}"
                items.append({
                    "id": d["id"],
                    "numero": d.get("numero"),
                    "nom": nom,
                    "statut": d["statut"],
                    "dateDebut": str(date_cmd) if date_cmd else None,
                    "dateFin": str(date_liv) if date_liv else None,
                    "montant": float(d["montant_total"]) if d.get("montant_total") else None,
                    "dureeJours": duree_jours,
                    "projectId": d.get("project_id"),
                    "projectNom": d.get("nom_projet"),
                    "fournisseur": d.get("fournisseur_nom"),
                })
            return {"items": items}
        except Exception as exc:
            logger.warning("get_gantt_bons_commande inner error: %s", exc)
            return {"items": []}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_gantt_bons_commande error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# Mapping type Gantt -> nom de la table tenant + colonne PK type
_GANTT_TYPE_TO_TABLE = {
    "project": ("projects", "id"),
    "bt": ("formulaires", "id"),
    "devis": ("devis", "id"),
    "bc": ("bons_commande", "id"),
    "op": ("operations", "id"),
    "opp": ("opportunities", "id"),  # ventes (CRM) -> table opportunities
}

_GANTT_DEP_ENSURED_SCHEMAS: set = set()


def _ensure_gantt_dependencies_table(cursor, schema: str = "") -> None:
    """Create gantt_dependencies (idempotent) avec contraintes + indexes.

    Aligne sur le DDL global de erp_database.py (VARCHAR 255). Ajoute
    CHECK / UNIQUE / INDEX manquants qui n'existaient pas dans le DDL
    inline original.
    Memoize par schema pour eviter le DDL a chaque requete.
    """
    if schema and schema in _GANTT_DEP_ENSURED_SCHEMAS:
        return
    cursor.execute(
        "CREATE TABLE IF NOT EXISTS gantt_dependencies ("
        "id SERIAL PRIMARY KEY, "
        "source_type VARCHAR(50) NOT NULL, "
        "source_id VARCHAR(100) NOT NULL, "
        "target_type VARCHAR(50) NOT NULL, "
        "target_id VARCHAR(100) NOT NULL, "
        "dependency_type VARCHAR(50) DEFAULT 'finish_to_start', "
        "lag_days INTEGER DEFAULT 0, "
        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        ")"
    )
    # Indexes (idempotent). Acceleration des SELECT par source/target +
    # validation de cycle via traversal.
    for ddl in (
        "CREATE INDEX IF NOT EXISTS idx_gantt_dep_source ON gantt_dependencies(source_type, source_id)",
        "CREATE INDEX IF NOT EXISTS idx_gantt_dep_target ON gantt_dependencies(target_type, target_id)",
        # Empeche les doublons (meme paire source->target) via UNIQUE composite
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_gantt_dep_source_target "
        "ON gantt_dependencies(source_type, source_id, target_type, target_id)",
    ):
        try:
            cursor.execute(ddl)
        except Exception as exc:
            logger.warning("Gantt dep index creation skipped (%s): %s", ddl[:60], exc)
    if schema:
        _GANTT_DEP_ENSURED_SCHEMAS.add(schema)


def _gantt_entity_exists(cursor, type_key: str, entity_id: str) -> bool:
    """Verifie qu'une entite (type, id) existe dans le tenant courant."""
    table_info = _GANTT_TYPE_TO_TABLE.get(type_key)
    if not table_info:
        return False
    table, pk = table_info
    try:
        # Cast cote DB pour comparer ID polymorphes (UUID vs INT). Le pk
        # est connu et constant, pas d'injection possible.
        cursor.execute(
            f"SELECT 1 FROM {table} WHERE {pk}::text = %s LIMIT 1",
            (str(entity_id),),
        )
        return cursor.fetchone() is not None
    except Exception as exc:
        logger.warning("_gantt_entity_exists(%s, %s): %s", type_key, entity_id, exc)
        return False


def _gantt_would_create_cycle(cursor, source_type: str, source_id: str,
                               target_type: str, target_id: str) -> bool:
    """Detecte si l'ajout de source -> target creerait un cycle.

    Strategy : parcours en largeur depuis target en suivant les
    dependances existantes. Si on retrouve source -> cycle.
    """
    if (source_type, source_id) == (target_type, target_id):
        return True
    visited = {(target_type, target_id)}
    queue = [(target_type, target_id)]
    safety_limit = 1000  # garde-fou anti-DoS
    iterations = 0
    while queue and iterations < safety_limit:
        iterations += 1
        cur_type, cur_id = queue.pop(0)
        try:
            cursor.execute(
                "SELECT target_type, target_id FROM gantt_dependencies "
                "WHERE source_type = %s AND source_id = %s",
                (cur_type, str(cur_id)),
            )
        except Exception:
            return False
        for r in cursor.fetchall():
            nxt = (r["target_type"], r["target_id"])
            if nxt == (source_type, source_id):
                return True
            if nxt not in visited:
                visited.add(nxt)
                queue.append(nxt)
    return False


@router.post("/gantt/dependencies")
async def create_dependency(body: DependencyCreate, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    """Create a dependency between two Gantt items.

    Validations defensives :
      1. Whitelist Pydantic (deja sur DependencyCreate) : type/id/dep_type/lag.
      2. Source != target (interdit auto-dependance).
      3. Source et target doivent exister dans le tenant courant.
      4. Pas de cycle (parcours en largeur des deps existantes).
      5. Pas de doublon (UNIQUE INDEX).
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if (body.source_type, body.source_id) == (body.target_type, body.target_id):
        raise HTTPException(status_code=400,
                            detail="Une tache ne peut pas dependre d'elle-meme.")
    conn = db.get_conn()
    cursor = None
    prev_autocommit = None
    try:
        # Force autocommit=False + advisory lock per-tenant pour serialiser
        # les creations gantt sur ce tenant. Sans cela, 2 requetes concurrentes
        # POST {A->B} et POST {B->A} pourraient passer le check cycle simultanement
        # (READ COMMITTED ne voit pas les writes non-commites de l'autre TX) puis
        # creer un cycle reel en BD. Le advisory lock est libere automatiquement
        # au commit/rollback.
        try:
            prev_autocommit = conn.autocommit
            conn.autocommit = False
        except Exception:
            prev_autocommit = None
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # statement_timeout 5s pour borner le BFS pathologique sur tenants
        # avec dependances complexes
        try:
            cursor.execute("SET LOCAL statement_timeout = '5000'")
        except Exception:
            pass
        # Lock advisory tenant-scoped (libere au commit/rollback de la TX)
        try:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s || ':gantt_dep'))",
                (user.schema,),
            )
        except Exception as exc:
            logger.warning("Gantt advisory lock acquire failed: %s", type(exc).__name__)
        _ensure_gantt_dependencies_table(cursor, user.schema)
        # Validation existence source et target
        if not _gantt_entity_exists(cursor, body.source_type, body.source_id):
            raise HTTPException(
                status_code=404,
                detail=f"Source introuvable ({body.source_type} #{body.source_id})."
            )
        if not _gantt_entity_exists(cursor, body.target_type, body.target_id):
            raise HTTPException(
                status_code=404,
                detail=f"Cible introuvable ({body.target_type} #{body.target_id})."
            )
        # Cycle detection avant INSERT (proteg par advisory lock)
        if _gantt_would_create_cycle(cursor, body.source_type, body.source_id,
                                      body.target_type, body.target_id):
            raise HTTPException(
                status_code=409,
                detail="Cette dependance creerait un cycle (boucle de dependances).",
            )
        try:
            cursor.execute(
                "INSERT INTO gantt_dependencies (source_type, source_id, target_type, target_id, "
                "dependency_type, lag_days, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP) RETURNING id",
                (body.source_type, body.source_id, body.target_type, body.target_id,
                 body.dependency_type, body.lag_days),
            )
        except db.psycopg2.errors.UniqueViolation:
            conn.rollback()
            raise HTTPException(
                status_code=409,
                detail="Cette dependance existe deja entre ces deux taches.",
            )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Dependance creee"}
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("create_dependency error: %s", type(exc).__name__)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la dependance")
    finally:
        if cursor:
            cursor.close()
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception:
                pass
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/gantt/dependencies")
async def list_dependencies(user: ErpUser = Depends(get_current_user)):
    """List all Gantt dependencies."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        try:
            _ensure_gantt_dependencies_table(cursor, user.schema)
            cursor.execute(
                "SELECT id, source_type, source_id, target_type, target_id, "
                "dependency_type, lag_days, created_at "
                "FROM gantt_dependencies ORDER BY created_at"
            )
            items = []
            for row in cursor.fetchall():
                d = dict(row)
                if d.get("created_at"):
                    d["created_at"] = str(d["created_at"])
                items.append(d)
            return {"items": items}
        except Exception as exc:
            logger.warning("list_dependencies inner error: %s", type(exc).__name__)
            return {"items": []}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_dependencies error: %s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/gantt/dependencies/{dep_id}")
async def delete_dependency(dep_id: int, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    """Delete a Gantt dependency."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_gantt_dependencies_table(cursor, user.schema)
        cursor.execute(
            "DELETE FROM gantt_dependencies WHERE id = %s", (dep_id,)
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Dependance introuvable")
        conn.commit()
        return {"message": "Dependance supprimee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_dependency error: %s", type(exc).__name__)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _gantt_cleanup_on_entity_delete(cursor, type_key: str, entity_id) -> int:
    """Helper appele par delete_project / delete_devis / delete_purchase_order
    pour supprimer toutes les dependances Gantt rattachees a cette entite.
    Retourne le nombre de dependances supprimees.
    """
    try:
        _ensure_gantt_dependencies_table(cursor)
        cursor.execute(
            "DELETE FROM gantt_dependencies "
            "WHERE (source_type = %s AND source_id = %s) "
            "   OR (target_type = %s AND target_id = %s)",
            (type_key, str(entity_id), type_key, str(entity_id)),
        )
        return cursor.rowcount
    except Exception as exc:
        logger.warning("_gantt_cleanup_on_entity_delete(%s, %s) failed: %s",
                       type_key, entity_id, type(exc).__name__)
        return 0


@router.get("/gantt/export-csv")
async def export_gantt_csv(user: ErpUser = Depends(get_current_user)):
    """Export all Gantt data as CSV."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        rows_out = []

        # Projects (with aggregate progression from phases)
        try:
            cursor.execute(
                "SELECT p.id, p.nom_projet, p.statut, p.priorite, p.date_debut_reel, p.date_fin_reel, "
                "p.budget_total, COALESCE(pp.avg_prog, 0) AS progression "
                "FROM projects p "
                "LEFT JOIN ("
                "  SELECT project_id, ROUND(AVG(COALESCE(progression, 0)), 1) AS avg_prog "
                "  FROM project_phases GROUP BY project_id"
                ") pp ON pp.project_id::text = p.id::text "
                "WHERE p.statut NOT IN ('Annule') "
                "ORDER BY p.date_debut_reel ASC NULLS LAST"
            )
        except Exception:
            conn.rollback()
            db.set_tenant(conn, user.schema)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, nom_projet, statut, priorite, date_debut_reel, date_fin_reel, "
                "budget_total FROM projects WHERE statut NOT IN ('Annule') "
                "ORDER BY date_debut_reel ASC NULLS LAST"
            )
        for row in cursor.fetchall():
            d = dict(row)
            rows_out.append({
                "Type": "Projet",
                "ID": str(d["id"]),
                "Nom": d["nom_projet"] or "",
                "Statut": d["statut"] or "",
                "Priorite": d.get("priorite") or "",
                "DateDebut": str(d["date_debut_reel"]) if d.get("date_debut_reel") else "",
                "DateFin": str(d["date_fin_reel"]) if d.get("date_fin_reel") else "",
                "Budget": str(float(d["budget_total"])) if d.get("budget_total") else "",
                "Progression": str(float(d.get("progression") or 0)),
            })

        # Bons de travail
        cursor.execute(
            "SELECT id, numero_document, nom, statut, priorite, date_echeance, montant_total "
            "FROM formulaires WHERE type_formulaire = 'BON_TRAVAIL' "
            "AND statut NOT IN ('ANNULE') "
            "ORDER BY created_at DESC"
        )
        for row in cursor.fetchall():
            d = dict(row)
            rows_out.append({
                "Type": "Bon de travail",
                "ID": d.get("numero_document") or str(d["id"]),
                "Nom": d["nom"] or "",
                "Statut": d["statut"] or "",
                "Priorite": d.get("priorite") or "",
                "DateDebut": "",
                "DateFin": str(d["date_echeance"]) if d.get("date_echeance") else "",
                "Budget": str(float(d["montant_total"])) if d.get("montant_total") else "",
                "Progression": "",
            })

        # Devis (date_prevu = debut prevu, date_fin = fin prevue)
        try:
            cursor.execute(
                "SELECT id, numero_devis, nom_projet, statut, date_soumis, date_prevu, date_fin, investissement_total "
                "FROM devis WHERE statut NOT IN ('Annule', 'Refuse') "
                "ORDER BY date_prevu ASC NULLS LAST"
            )
        except Exception:
            conn.rollback()
            db.set_tenant(conn, user.schema)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, numero_devis, nom_projet, statut, date_soumis, date_prevu, investissement_total "
                "FROM devis WHERE statut NOT IN ('Annule', 'Refuse') "
                "ORDER BY date_prevu ASC NULLS LAST"
            )
        for row in cursor.fetchall():
            d = dict(row)
            date_debut = d.get("date_prevu") or d.get("date_soumis")
            date_fin = d.get("date_fin")
            rows_out.append({
                "Type": "Devis",
                "ID": d.get("numero_devis") or str(d["id"]),
                "Nom": d.get("nom_projet") or "",
                "Statut": d["statut"] or "",
                "Priorite": "",
                "DateDebut": str(date_debut) if date_debut else "",
                "DateFin": str(date_fin) if date_fin else "",
                "Budget": str(float(d["investissement_total"])) if d.get("investissement_total") else "",
                "Progression": "",
            })

        # Bons de commande
        try:
            cursor.execute(
                "SELECT id, numero, statut, date_commande, date_livraison_prevue, montant_total "
                "FROM bons_commande WHERE statut NOT IN ('Annule') "
                "ORDER BY date_commande ASC NULLS LAST"
            )
            for row in cursor.fetchall():
                d = dict(row)
                rows_out.append({
                    "Type": "Bon de commande",
                    "ID": d.get("numero") or str(d["id"]),
                    "Nom": d.get("numero") or "",
                    "Statut": d["statut"] or "",
                    "Priorite": "",
                    "DateDebut": str(d["date_commande"]) if d.get("date_commande") else "",
                    "DateFin": str(d["date_livraison_prevue"]) if d.get("date_livraison_prevue") else "",
                    "Budget": str(float(d["montant_total"])) if d.get("montant_total") else "",
                    "Progression": "",
                })
        except Exception:
            pass  # Table may not exist

        # Dependencies
        deps_out = []
        try:
            cursor.execute(
                "SELECT id, source_type, source_id, target_type, target_id, "
                "dependency_type, lag_days, created_at "
                "FROM gantt_dependencies ORDER BY created_at"
            )
            for row in cursor.fetchall():
                d = dict(row)
                deps_out.append({
                    "Type": "Dependance",
                    "ID": str(d["id"]),
                    "Nom": f"{d['source_type']}#{d['source_id']} -> {d['target_type']}#{d['target_id']}",
                    "Statut": d.get("dependency_type") or "finish_to_start",
                    "Priorite": "",
                    "DateDebut": "",
                    "DateFin": "",
                    "Budget": "",
                    "Progression": str(d.get("lag_days") or 0),
                })
        except Exception:
            pass  # Table may not exist

        # Build CSV avec BOM UTF-8 (﻿) pour qu'Excel/LibreOffice lisent
        # correctement les caracteres accentues (sinon "Compl\xe9t\xe9" apparait
        # comme "Complét" sur Excel France/Quebec).
        output = io.StringIO()
        output.write("﻿")  # BOM UTF-8
        fieldnames = ["Type", "ID", "Nom", "Statut", "Priorite", "DateDebut", "DateFin", "Budget", "Progression"]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows_out:
            writer.writerow(r)
        for r in deps_out:
            writer.writerow(r)

        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=gantt_export.csv"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("export_gantt_csv error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'export CSV")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# KANBAN ACHATS + STATUS UPDATE
# ============================================

@router.get("/kanban/achats")
async def get_kanban_achats(user: ErpUser = Depends(get_current_user)):
    """Get purchase orders for Kanban display."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT bc.id, bc.numero, bc.fournisseur_id, bc.statut, bc.montant_total, "
                "bc.date_commande, bc.notes, "
                "bc.fournisseur_nom "
                "FROM bons_commande bc "
                "ORDER BY bc.created_at DESC LIMIT 50"
            )
            items = []
            for row in cursor.fetchall():
                d = dict(row)
                if d.get("date_commande"):
                    d["date_commande"] = str(d["date_commande"])
                if d.get("montant_total"):
                    d["montant_total"] = float(d["montant_total"])
                items.append(d)

            # Fetch achat assignees
            achat_ids = [i["id"] for i in items]
            achat_assignees: dict = {}
            if achat_ids:
                try:
                    cursor.execute(
                        "CREATE TABLE IF NOT EXISTS achat_assignations ("
                        "id SERIAL PRIMARY KEY, "
                        "achat_id INTEGER NOT NULL, "
                        "employee_id INTEGER, "
                        "role VARCHAR(100), "
                        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
                        ")"
                    )
                    cursor.execute(
                        "SELECT aa.achat_id, aa.employee_id, "
                        "e.prenom || ' ' || e.nom AS employe_nom "
                        "FROM achat_assignations aa "
                        "LEFT JOIN employees e ON e.id = aa.employee_id "
                        "WHERE aa.achat_id = ANY(%s)",
                        (achat_ids,),
                    )
                    for arow in cursor.fetchall():
                        aid = arow["achat_id"]
                        if aid not in achat_assignees:
                            achat_assignees[aid] = []
                        achat_assignees[aid].append({
                            "employeeId": arow["employee_id"],
                            "nom": arow["employe_nom"] or "Inconnu",
                        })
                except Exception:
                    pass  # Table may not exist yet

            for i in items:
                i["assignees"] = achat_assignees.get(i["id"], [])

            return {"items": items}
        except Exception as exc:
            logger.warning("get_kanban_achats inner error: %s", exc)
            return {"items": []}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_kanban_achats error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/kanban/update-status")
async def update_kanban_status(body: KanbanStatusUpdate, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    """Update status of an entity from Kanban drag-drop."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    # Map entity_type to table and constraints
    TABLE_MAP = {
        "project": {"table": "projects", "id_col": "id", "extra_where": ""},
        "bt": {"table": "formulaires", "id_col": "id", "extra_where": " AND type_formulaire = 'BON_TRAVAIL'"},
        "bon_travail": {"table": "formulaires", "id_col": "id", "extra_where": " AND type_formulaire = 'BON_TRAVAIL'"},
        "devis": {"table": "devis", "id_col": "id", "extra_where": ""},
        "achat": {"table": "bons_commande", "id_col": "id", "extra_where": ""},
        "facture": {"table": "factures", "id_col": "id", "extra_where": ""},
    }

    mapping = TABLE_MAP.get(body.entity_type)
    if not mapping:
        raise HTTPException(
            status_code=400,
            detail=f"Type d'entite invalide: {body.entity_type}. Valeurs acceptees: {list(TABLE_MAP.keys())}",
        )

    # Validate statut per entity type
    STATUT_MAP = {
        "project": None,  # projects have varied statuses
        "bt": BT_STATUSES,
        "bon_travail": BT_STATUSES,
        "devis": None,  # devis have varied statuses
        "achat": None,
        "facture": None,
    }
    allowed_statuts = STATUT_MAP.get(body.entity_type)
    if allowed_statuts and body.new_statut not in allowed_statuts:
        raise HTTPException(
            status_code=400,
            detail=f"Statut invalide: {body.new_statut}. Valeurs: {', '.join(allowed_statuts)}",
        )

    conn = db.get_conn()
    cursor = None
    prev_autocommit = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # FIX P0: state machine — pour les BT, valider la transition.
        # autocommit=False + SELECT FOR UPDATE pour eviter TOCTOU sur drag-drop
        # concurrent (2 users sur Kanban en meme temps).
        if body.entity_type in ("bt", "bon_travail"):
            try:
                prev_autocommit = conn.autocommit
            except Exception:
                prev_autocommit = None
            try:
                conn.autocommit = False
            except Exception:
                pass
            cursor.execute(
                f"SELECT statut FROM {mapping['table']} WHERE {mapping['id_col']} = %s{mapping['extra_where']} FOR UPDATE",
                (body.entity_id,),
            )
            curr = cursor.fetchone()
            if not curr:
                raise HTTPException(status_code=404, detail="Entite introuvable")
            _validate_status_transition(curr["statut"], body.new_statut, user)

        query = (
            f"UPDATE {mapping['table']} SET statut = %s, updated_at = CURRENT_TIMESTAMP "
            f"WHERE {mapping['id_col']} = %s{mapping['extra_where']}"
        )
        cursor.execute(query, (body.new_statut, body.entity_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Entite introuvable")
        conn.commit()
        return {
            "message": "Statut mis à jour",
            "entity_type": body.entity_type,
            "entity_id": body.entity_id,
            "new_statut": body.new_statut,
        }
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("update_kanban_status error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise à jour du statut")
    finally:
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception:
                pass
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/work-orders")
async def list_work_orders(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    statut: Optional[str] = None,
    priorite: Optional[str] = None,
    search: Optional[str] = None,
):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Ensure date columns exist on legacy tenants (avoids "column does not
        # exist" errors logged at DB level on every cold tenant query).
        _ensure_formulaires_date_columns(cursor)
        wheres = ["f.type_formulaire = 'BON_TRAVAIL'"]
        params = []
        if statut:
            # FIX P0 (round 5): tenants legacy peuvent stocker statuts avec
            # accents/espaces ("TERMINÉ", "EN COURS"). Si le filtre frontend
            # envoie "TERMINE" canonique, l'egalite stricte rate les rows
            # legacy. On compare via la fonction _normalize_status sur ancien
            # statut (BD) en utilisant un IN list de tous les alias matchant
            # la cle canonique demandee.
            target_key = _normalize_status(statut)
            # Construire la liste des variantes BD qui se normalisent vers target_key
            variants = {target_key}
            for alias, canon in _STATUS_ALIASES.items():
                if canon == target_key:
                    variants.add(alias)
            placeholders = ", ".join(["%s"] * len(variants))
            wheres.append(f"UPPER(TRIM(f.statut)) IN ({placeholders})")
            params.extend(sorted(variants))
        if priorite:
            wheres.append("f.priorite = %s")
            params.append(priorite)
        if search:
            wheres.append("(f.nom ILIKE %s OR f.numero_document ILIKE %s)")
            params.extend([f"%{search}%", f"%{search}%"])
        w = " AND ".join(wheres)
        cursor.execute(
            f"SELECT COUNT(*) as total FROM formulaires f WHERE {w}", params
        )
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        # Include date_debut/date_fin (defensive: may not exist on old tenants)
        date_cols = ", f.date_debut, f.date_fin"
        try:
            cursor.execute(
                f"SELECT f.id, f.numero_document, f.nom, f.statut, f.priorite, f.project_id, "
                f"f.date_echeance{date_cols}, f.montant_total, f.notes, f.created_at, f.updated_at, "
                f"p.nom_projet AS project_nom "
                f"FROM formulaires f "
                f"LEFT JOIN projects p ON p.id::text = f.project_id::text "
                f"WHERE {w} "
                f"ORDER BY f.created_at DESC LIMIT %s OFFSET %s",
                params + [per_page, offset],
            )
        except Exception:
            conn.rollback()
            db.set_tenant(conn, user.schema)
            cursor = conn.cursor()
            cursor.execute(
                f"SELECT f.id, f.numero_document, f.nom, f.statut, f.priorite, f.project_id, "
                f"f.date_echeance, f.montant_total, f.notes, f.created_at, f.updated_at, "
                f"p.nom_projet AS project_nom "
                f"FROM formulaires f "
                f"LEFT JOIN projects p ON p.id::text = f.project_id::text "
                f"WHERE {w} "
                f"ORDER BY f.created_at DESC LIMIT %s OFFSET %s",
                params + [per_page, offset],
            )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_echeance", "date_debut", "date_fin", "created_at", "updated_at"):
                if d.get(k):
                    d[k] = str(d[k])
            if d.get("montant_total"):
                d["montant_total"] = float(d["montant_total"])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_work_orders error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/work-orders")
async def create_work_order(body: BonTravailCreate, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Ensure date_debut/date_fin columns exist on formulaires (may be missing on old tenants)
        _ensure_formulaires_date_columns(cursor)
        nom = (body.nom or "").strip() or None
        if not nom and body.project_id:
            cursor.execute("SELECT nom_projet FROM projects WHERE id = %s", (body.project_id,))
            proj_row = cursor.fetchone()
            if proj_row:
                nom = proj_row["nom_projet"]
        # INSERT with temp numero, then UPDATE with ID-based unique number
        # (fixes race condition: COALESCE(MAX(id),0)+1 can produce duplicates
        # under concurrent inserts — lesson #113)
        cursor.execute(
            "INSERT INTO formulaires (type_formulaire, numero_document, nom, statut, "
            "priorite, project_id, date_echeance, date_debut, date_fin, notes, created_at, updated_at) "
            "VALUES ('BON_TRAVAIL', 'TEMP', %s, 'BROUILLON', %s, %s, %s, %s, %s, %s, "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
            (nom or 'TEMP', body.priorite, body.project_id,
             body.date_echeance, body.date_debut or None, body.date_fin or None, body.notes),
        )
        row = cursor.fetchone()
        bt_id = row["id"]
        numero = f"BT-{bt_id:05d}"
        if not nom or nom == 'TEMP':
            nom = numero
        cursor.execute(
            "UPDATE formulaires SET numero_document = %s, nom = COALESCE(NULLIF(nom, 'TEMP'), %s) WHERE id = %s",
            (numero, nom, bt_id),
        )

        # Auto-link to opportunity dossier if project has one
        if body.project_id:
            try:
                from .crm import run_opportunity_migrations
                run_opportunity_migrations(conn, user.schema)
                cursor.execute(
                    "SELECT o.dossier_id FROM projects p "
                    "JOIN opportunities o ON p.opportunity_id = o.id "
                    "WHERE p.id = %s AND o.dossier_id IS NOT NULL",
                    (body.project_id,),
                )
                dossier_row = cursor.fetchone()
                if dossier_row:
                    cursor.execute(
                        "INSERT INTO dossier_formulaires (dossier_id, formulaire_id, date_association) "
                        "VALUES (%s, %s, CURRENT_TIMESTAMP) ON CONFLICT (dossier_id, formulaire_id) DO NOTHING",
                        (dossier_row["dossier_id"], bt_id),
                    )
            except Exception:
                pass

        conn.commit()
        return {"id": bt_id, "numero": numero, "nom": nom, "message": "Bon de travail créé"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_work_order error: %s", exc)
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


@router.put("/work-orders/{bt_id}")
async def update_work_order(bt_id: int, body: BonTravailUpdate, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    ALLOWED = {"nom", "statut", "priorite", "project_id", "date_echeance", "date_debut", "date_fin", "notes"}
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k in ALLOWED}
    # Validate statut/priorite values
    if "statut" in fields and fields["statut"] not in BT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Statut invalide: {fields['statut']}. Valeurs: {', '.join(BT_STATUSES)}")
    if "priorite" in fields and fields["priorite"] not in BT_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Priorite invalide: {fields['priorite']}. Valeurs: {', '.join(BT_PRIORITIES)}")
    # Empty string dates → NULL
    for dk in ("date_echeance", "date_debut", "date_fin"):
        if fields.get(dk) == "":
            fields[dk] = None
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ")
    conn = db.get_conn()
    cursor = None
    prev_autocommit = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # FIX P0: state machine — verifier la transition de statut SI fournie.
        # Si statut fourni, autocommit=False + SELECT FOR UPDATE pour eviter
        # TOCTOU race entre 2 admins qui font des transitions concurrentes.
        if "statut" in fields:
            try:
                prev_autocommit = conn.autocommit
            except Exception:
                prev_autocommit = None
            try:
                conn.autocommit = False
            except Exception:
                pass
            cursor.execute(
                "SELECT statut FROM formulaires WHERE id = %s AND type_formulaire = 'BON_TRAVAIL' FOR UPDATE",
                (bt_id,),
            )
            curr = cursor.fetchone()
            if not curr:
                raise HTTPException(status_code=404, detail="Bon de travail introuvable")
            _validate_status_transition(curr["statut"], fields["statut"], user)
            # Business rule: cannot mark BT as TERMINE while operations are still
            # in progress or pending. Super-admins keep their override (already
            # bypass _validate_status_transition above). For everyone else, count
            # operations that are not in a terminal state.
            if _normalize_status(fields["statut"]) == "TERMINE" and not _is_super_admin(user):
                cursor.execute(
                    "SELECT COUNT(*) AS pending_count FROM operations "
                    "WHERE formulaire_bt_id = %s AND ("
                    "  statut IS NULL OR LOWER(statut) NOT IN ('termine', 'terminé', 'annule', 'annulé')"
                    ")",
                    (bt_id,),
                )
                pending_row = cursor.fetchone()
                pending = pending_row["pending_count"] if pending_row else 0
                if pending and pending > 0:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Impossible de terminer le bon de travail: {pending} "
                            f"opération(s) sont encore En attente ou En cours. "
                            f"Termine ou annule chaque opération avant de fermer le BT."
                        ),
                    )

        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [bt_id]
        cursor.execute(
            f"UPDATE formulaires SET {', '.join(set_parts)} "
            f"WHERE id = %s AND type_formulaire = 'BON_TRAVAIL'",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Bon de travail introuvable")
        conn.commit()
        return {"message": "Bon de travail mis à jour"}
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("update_work_order error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour du bon de travail")
    finally:
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception:
                pass
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# SINGLE WORK ORDER DETAIL (full)
# ============================================

@router.get("/work-orders/{bt_id}/detail")
async def get_work_order_detail(bt_id: int, user: ErpUser = Depends(get_current_user)):
    """Get complete work order detail with lines, assignations, and comments."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_bt_tables(cursor)
        # Ensure date columns exist on legacy tenants (avoids "column does not
        # exist" errors logged at DB level on every cold tenant query).
        _ensure_formulaires_date_columns(cursor)
        # 1. Fetch BT
        # Include date_debut/date_fin (defensive: columns may not exist on old tenants)
        try:
            cursor.execute(
                "SELECT f.id, f.numero_document, f.nom, f.statut, f.priorite, "
                "f.project_id, f.date_echeance, f.date_debut, f.date_fin, f.montant_total, f.notes, "
                "f.created_at, f.updated_at, "
                "p.nom_projet AS project_nom "
                "FROM formulaires f "
                "LEFT JOIN projects p ON p.id::text = f.project_id::text "
                "WHERE f.id = %s AND f.type_formulaire = 'BON_TRAVAIL'",
                (bt_id,),
            )
        except Exception:
            conn.rollback()
            db.set_tenant(conn, user.schema)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT f.id, f.numero_document, f.nom, f.statut, f.priorite, "
                "f.project_id, f.date_echeance, f.montant_total, f.notes, "
                "f.created_at, f.updated_at, "
                "p.nom_projet AS project_nom "
                "FROM formulaires f "
                "LEFT JOIN projects p ON p.id::text = f.project_id::text "
                "WHERE f.id = %s AND f.type_formulaire = 'BON_TRAVAIL'",
                (bt_id,),
            )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Bon de travail introuvable")
        bt = dict(row)
        for k in ("date_echeance", "date_debut", "date_fin", "created_at", "updated_at"):
            if bt.get(k):
                bt[k] = str(bt[k])
        if bt.get("montant_total"):
            bt["montant_total"] = float(bt["montant_total"])
        # 2. Fetch lines (with product info from inventory)
        _ensure_formulaire_lignes_produit_id(cursor)
        cursor.execute(
            "SELECT fl.id, fl.formulaire_id, fl.description, fl.quantite, fl.unite, "
            "fl.prix_unitaire, fl.montant_ligne, fl.sequence_ligne, fl.produit_id, "
            "p.nom AS produit_nom, p.code_produit AS produit_code "
            "FROM formulaire_lignes fl "
            "LEFT JOIN produits p ON p.id = fl.produit_id "
            "WHERE fl.formulaire_id = %s ORDER BY fl.sequence_ligne, fl.id",
            (bt_id,),
        )
        lignes = []
        for r in cursor.fetchall():
            d = dict(r)
            for k in ("quantite", "prix_unitaire", "montant_ligne"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            lignes.append(d)
        # 3. Fetch assignations with employee names
        cursor.execute(
            "SELECT a.id, a.bt_id, a.employee_id, a.role, a.created_at, "
            "e.prenom || ' ' || e.nom AS employee_nom "
            "FROM bt_assignations a "
            "LEFT JOIN employees e ON e.id = a.employee_id "
            "WHERE a.bt_id = %s ORDER BY a.created_at",
            (bt_id,),
        )
        assignations = []
        for r in cursor.fetchall():
            d = dict(r)
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            assignations.append(d)
        # 4. Fetch comments
        cursor.execute(
            "SELECT id, bt_id, user_id, comment_text, created_at "
            "FROM bt_comments WHERE bt_id = %s ORDER BY created_at ASC",
            (bt_id,),
        )
        comments = []
        for r in cursor.fetchall():
            d = dict(r)
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            comments.append(d)
        # 5. Fetch operations
        operations_list = []
        try:
            _ensure_operations_columns(cursor)
            cursor.execute(
                "SELECT o.id, o.formulaire_bt_id, o.nom, o.description, o.quantite, "
                "o.employee_id, o.fournisseur, o.heures_prevues, o.heures_reelles, "
                "o.statut, o.date_debut, o.date_fin, o.poste_travail, "
                "o.sequence_number, o.created_at, o.updated_at, "
                "e.prenom || ' ' || e.nom AS employee_nom "
                "FROM operations o "
                "LEFT JOIN employees e ON e.id = o.employee_id "
                "WHERE o.formulaire_bt_id = %s "
                "ORDER BY o.sequence_number, o.id",
                (bt_id,),
            )
            for r in cursor.fetchall():
                d = dict(r)
                for k in ("quantite", "heures_prevues", "heures_reelles"):
                    if d.get(k) is not None:
                        d[k] = float(d[k])
                for k in ("date_debut", "date_fin", "created_at", "updated_at"):
                    if d.get(k):
                        d[k] = str(d[k])
                operations_list.append(d)
        except Exception:
            pass
        return {
            "bt": bt,
            "lignes": lignes,
            "assignations": assignations,
            "comments": comments,
            "operations": operations_list,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_work_order_detail error: %s", exc)
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
# SINGLE WORK ORDER (basic)
# ============================================

@router.get("/work-orders/{bt_id}")
async def get_work_order(bt_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single work order with project name."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT f.id, f.numero_document, f.nom, f.statut, f.priorite, "
            "f.project_id, f.date_echeance, f.montant_total, f.notes, "
            "f.created_at, f.updated_at, "
            "p.nom_projet AS project_nom "
            "FROM formulaires f "
            "LEFT JOIN projects p ON p.id::text = f.project_id::text "
            "WHERE f.id = %s AND f.type_formulaire = 'BON_TRAVAIL'",
            (bt_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Bon de travail introuvable")
        d = dict(row)
        for k in ("date_echeance", "created_at", "updated_at"):
            if d.get(k):
                d[k] = str(d[k])
        if d.get("montant_total"):
            d["montant_total"] = float(d["montant_total"])
        return d
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_work_order error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/work-orders/{bt_id}")
async def delete_work_order(bt_id: int, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    """Suppression d'un BT - comportement dual selon le statut.

    - Si statut != ANNULE -> SOFT DELETE: passage en ANNULE + reversion stock.
      L'historique (operations/lignes/assignations/comments) est preserve.
    - Si statut == ANNULE -> HARD DELETE: suppression definitive de la ligne
      formulaires + cascade FK sur les enfants. Stock NE RE-bouge PAS (deja
      restaure lors de l'annulation precedente).

    Garde: bt_assignations / bt_comments sont supprimes manuellement avant
    le DELETE puisqu'ils n'ont pas de FK ON DELETE CASCADE (cf
    _ensure_bt_tables). formulaire_lignes a une FK CASCADE -> auto.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    prev_autocommit = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # autocommit=False pour tenir le lock pendant la cascade reversion stock
        try:
            prev_autocommit = conn.autocommit
        except Exception:
            prev_autocommit = None
        try:
            conn.autocommit = False
        except Exception:
            pass

        # Verifier l'existence + statut actuel
        cursor.execute(
            "SELECT statut, numero_document FROM formulaires "
            "WHERE id = %s AND type_formulaire = 'BON_TRAVAIL' FOR UPDATE",
            (bt_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Bon de travail non trouvé")
        ancien_statut = row["statut"]
        numero_bt = row.get("numero_document") or f"BT-{bt_id}"

        if ancien_statut == "ANNULE":
            # HARD DELETE: le BT etait deja annule (stock deja restaure) -> on
            # supprime definitivement la ligne + enfants sans FK CASCADE.
            # Cleanup gantt avant DELETE pour eviter integrite brisee.
            try:
                _gantt_cleanup_on_entity_delete(cursor, 'bt', bt_id)
            except Exception as cleanup_exc:
                logger.warning("delete_work_order (hard): gantt cleanup BT %s failed: %s",
                               bt_id, cleanup_exc)
            # Tables sans FK CASCADE -> DELETE manuel (idempotent grace au
            # to_regclass guard pour les tables absentes dans certains tenants).
            # Note: bt_avancement a deja FK CASCADE (cf erp_database.py:9300)
            # donc PAS besoin de cleanup manuel; operations utilise SET NULL
            # sur formulaire_bt_id donc cleanup optionnel mais explicite ici.
            # Schema des colonnes: (table, colonne) pour eviter les bugs de
            # mapping bt_id vs formulaire_bt_id vs formulaire_id.
            cleanup_specs = (
                ("bt_assignations", "bt_id"),
                ("bt_comments", "bt_id"),
                ("bt_reservations_postes", "bt_id"),
                ("bt_dependencies", "bt_source_id"),
                ("bt_dependencies", "bt_target_id"),
                ("operations", "formulaire_bt_id"),
                # approvisionnements peut referencer un BT via formulaire_id
                # (lien BC -> BT). FK sans CASCADE -> bloque le DELETE final
                # si non nettoye. Cleanup defensif.
                ("approvisionnements", "formulaire_id"),
            )
            for tbl, col in cleanup_specs:
                try:
                    cursor.execute(
                        "SELECT to_regclass(%s) AS reg", (tbl,),
                    )
                    reg_row = cursor.fetchone()
                    reg = reg_row.get('reg') if isinstance(reg_row, dict) else (
                        reg_row[0] if reg_row else None
                    )
                    if not reg:
                        continue
                    # Verifier l'existence de la colonne (defensif tenant legacy)
                    cursor.execute(
                        "SELECT 1 FROM information_schema.columns "
                        "WHERE table_name = %s AND column_name = %s "
                        "AND table_schema = current_schema()",
                        (tbl, col),
                    )
                    if cursor.fetchone() is None:
                        continue
                    cursor.execute(
                        f"DELETE FROM {tbl} WHERE {col} = %s", (bt_id,),
                    )
                except Exception as cleanup_exc:
                    logger.warning(
                        "delete_work_order (hard): cleanup %s.%s for BT %s failed: %s",
                        tbl, col, bt_id, cleanup_exc,
                    )
            # formulaire_lignes / formulaire_validations / formulaire_pieces_jointes
            # ont CASCADE -> supprimees automatiquement. DELETE final:
            cursor.execute(
                "DELETE FROM formulaires WHERE id = %s AND type_formulaire = 'BON_TRAVAIL'",
                (bt_id,),
            )
            conn.commit()
            return {"message": "Bon de travail supprime definitivement", "hard_deleted": True}

        # Reversion stock pour les lignes liees a un produit
        # Verifier l'existence des tables (defensif tenant legacy)
        cursor.execute(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_name = 'formulaire_lignes' AND table_schema = current_schema()"
        )
        has_lignes = cursor.fetchone() is not None
        cursor.execute(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_name = 'mouvements_stock' AND table_schema = current_schema()"
        )
        has_mouvements = cursor.fetchone() is not None

        if has_lignes:
            cursor.execute(
                "SELECT produit_id, SUM(COALESCE(quantite, 0)) AS qty_totale "
                "FROM formulaire_lignes "
                "WHERE formulaire_id = %s AND produit_id IS NOT NULL "
                "GROUP BY produit_id",
                (bt_id,),
            )
            for ligne in cursor.fetchall():
                produit_id = ligne["produit_id"]
                qty = float(ligne["qty_totale"] or 0)
                if not produit_id or qty <= 0:
                    continue
                # Lock + restaurer stock atomiquement
                cursor.execute(
                    "SELECT id FROM produits WHERE id = %s FOR UPDATE",
                    (produit_id,),
                )
                if cursor.fetchone() is None:
                    continue  # produit supprime entre temps
                cursor.execute(
                    "UPDATE produits SET stock_disponible = COALESCE(stock_disponible, 0) + %s, "
                    "updated_at = NOW() WHERE id = %s "
                    "RETURNING stock_disponible",
                    (qty, produit_id),
                )
                upd = cursor.fetchone()
                if upd and has_mouvements:
                    nouveau = float(upd["stock_disponible"] or 0)
                    avant = nouveau - qty
                    try:
                        cursor.execute(
                            "INSERT INTO mouvements_stock "
                            "(produit_id, type_mouvement, quantite, quantite_avant, quantite_apres, "
                            " reference_document, reference_type, motif, employee_id, created_at) "
                            "VALUES (%s, 'ENTREE', %s, %s, %s, %s, 'AJUSTEMENT', %s, %s, NOW())",
                            (produit_id, qty, avant, nouveau, numero_bt,
                             f"Annulation BT {numero_bt} - reversion stock",
                             user.user_id),
                        )
                    except Exception as mvt_exc:
                        logger.warning(
                            "audit mouvements_stock ENTREE (annulation BT %s) failed for produit %s: %s",
                            bt_id, produit_id, mvt_exc,
                        )

        # Marquer le BT comme ANNULE
        cursor.execute(
            "UPDATE formulaires SET statut = 'ANNULE', updated_at = CURRENT_TIMESTAMP "
            "WHERE id = %s AND type_formulaire = 'BON_TRAVAIL'",
            (bt_id,),
        )
        # Cleanup gantt_dependencies referencing this BT (source ou target).
        # Le BT reste soft-deleted mais ses dependances Gantt n'ont plus de
        # sens et polluent la BFS de detection de cycle. Les operations du BT
        # (type 'op') sont nettoyees independamment via delete_bt_operation.
        try:
            _gantt_cleanup_on_entity_delete(cursor, 'bt', bt_id)
        except Exception as cleanup_exc:
            logger.warning("delete_work_order: gantt cleanup BT %s failed: %s",
                           bt_id, cleanup_exc)
        conn.commit()
        return {"message": "Bon de travail annule (stock restaure)"}
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("delete_work_order error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de l'annulation du bon de travail")
    finally:
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception:
                pass
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/work-orders/{bt_id}/restore")
async def restore_work_order(
    bt_id: int,
    user: ErpUser = Depends(require_role(*BT_WRITE_ROLES)),
):
    """Restaure un BT annule en BROUILLON. Inverse de delete_work_order
    (chemin soft). Le stock NE re-decremente PAS (stock restaure lors de
    l'annulation reste comme tel; les lignes BT sont preservees mais le
    stock disponible reflete le re-add). Si l'utilisateur veut re-effectuer
    une consommation, il devra re-passer en EN_COURS via la state machine.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT statut FROM formulaires "
            "WHERE id = %s AND type_formulaire = 'BON_TRAVAIL' FOR UPDATE",
            (bt_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Bon de travail non trouvé")
        if row["statut"] != "ANNULE":
            raise HTTPException(
                status_code=400,
                detail="Seuls les bons de travail annules peuvent etre restaures",
            )
        cursor.execute(
            "UPDATE formulaires SET statut = 'BROUILLON', updated_at = CURRENT_TIMESTAMP "
            "WHERE id = %s AND type_formulaire = 'BON_TRAVAIL'",
            (bt_id,),
        )
        conn.commit()
        return {"message": "Bon de travail restaure (statut: BROUILLON)"}
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("restore_work_order error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la restauration du bon de travail")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# LINE ITEMS
# ============================================

@router.get("/work-orders/{bt_id}/lines")
async def list_lines(bt_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_formulaire_lignes_produit_id(cursor)
        cursor.execute(
            "SELECT fl.id, fl.formulaire_id, fl.description, fl.quantite, fl.unite, "
            "fl.prix_unitaire, fl.montant_ligne, fl.sequence_ligne, fl.produit_id, "
            "p.nom AS produit_nom, p.code_produit AS produit_code "
            "FROM formulaire_lignes fl "
            "LEFT JOIN produits p ON p.id = fl.produit_id "
            "WHERE fl.formulaire_id = %s ORDER BY fl.sequence_ligne, fl.id",
            (bt_id,),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("quantite", "prix_unitaire", "montant_ligne"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_lines error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/work-orders/{bt_id}/lines")
async def add_line(bt_id: int, body: LineItemCreate, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    prev_autocommit = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # autocommit=False pour serialiser MAX(sequence_ligne)+1 + UPDATE stock
        try:
            prev_autocommit = conn.autocommit
        except Exception:
            prev_autocommit = None
        try:
            conn.autocommit = False
        except Exception:
            pass
        _ensure_formulaire_lignes_produit_id(cursor)
        montant = body.quantite * body.prix_unitaire
        # FIX P0: race-safe sequence — lock formulaires(bt_id) puis MAX+1.
        # Sans lock, 2 inserts concurrents lisent meme MAX et generent doublons.
        cursor.execute(
            "SELECT id FROM formulaires WHERE id = %s FOR UPDATE",
            (bt_id,),
        )
        if cursor.fetchone() is None:
            raise HTTPException(status_code=404, detail="Bon de travail introuvable")
        cursor.execute(
            "SELECT COALESCE(MAX(sequence_ligne), 0) + 1 as next_ordre "
            "FROM formulaire_lignes WHERE formulaire_id = %s",
            (bt_id,),
        )
        next_ordre = cursor.fetchone()["next_ordre"]
        cursor.execute(
            "INSERT INTO formulaire_lignes (formulaire_id, description, quantite, unite, "
            "prix_unitaire, montant_ligne, sequence_ligne, produit_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (bt_id, body.description, body.quantite, body.unite,
             body.prix_unitaire, montant, next_ordre, body.produit_id),
        )
        row = cursor.fetchone()
        line_id = row["id"]
        # Recalculate total
        cursor.execute(
            "UPDATE formulaires SET montant_total = ("
            "  SELECT COALESCE(SUM(montant_ligne), 0) FROM formulaire_lignes WHERE formulaire_id = %s"
            "), updated_at = CURRENT_TIMESTAMP "
            "WHERE id = %s",
            (bt_id, bt_id),
        )
        # Auto stock movement SORTIE if linked to a product (atomic UPDATE RETURNING)
        if body.produit_id and body.quantite > 0:
            try:
                cursor.execute(
                    "UPDATE produits SET stock_disponible = stock_disponible - %s, "
                    "updated_at = CURRENT_TIMESTAMP WHERE id = %s "
                    "RETURNING stock_disponible",
                    (body.quantite, body.produit_id),
                )
                prod_row = cursor.fetchone()
                if prod_row:
                    qty_apres = float(prod_row["stock_disponible"])
                    qty_avant = qty_apres + body.quantite
                    cursor.execute("SELECT numero_document FROM formulaires WHERE id = %s", (bt_id,))
                    bt_row = cursor.fetchone()
                    bt_ref = bt_row["numero_document"] if bt_row else f"BT-{bt_id}"
                    cursor.execute(
                        "INSERT INTO mouvements_stock (produit_id, type_mouvement, quantite, "
                        "quantite_avant, quantite_apres, reference_document, motif, employee_id, created_at) "
                        "VALUES (%s, 'SORTIE', %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)",
                        (body.produit_id, body.quantite, qty_avant, qty_apres,
                         bt_ref, f"Ligne BT {bt_ref}", user.user_id),
                    )
            except Exception as exc:
                logger.warning("add_line stock movement error: %s", exc)
        conn.commit()
        return {"id": line_id, "message": "Ligne ajoutee"}
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("add_line error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de l'ajout de la ligne")
    finally:
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception:
                pass
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/work-orders/{bt_id}/lines/{line_id}")
async def update_line(bt_id: int, line_id: int, body: LineItemUpdate, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    """Update a line item on a work order and recalculate totals."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    prev_autocommit = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Run idempotent DDL BEFORE flipping to tx mode. ALTER TABLE inside an
        # autocommit=False tx would be rolled back if the update later fails,
        # causing the next request to re-attempt the DDL on a tenant where it
        # had silently disappeared (Round 11 finding #2).
        _ensure_formulaire_lignes_produit_id(cursor)
        # FIX P0: atomicite ligne+stock+total. Sans autocommit=False, si UPDATE
        # produits.stock_disponible echoue partiellement, le UPDATE formulaire_lignes
        # peut etre commite tout seul -> stock incoherent. Pattern aligne avec
        # add_line/delete_line/add_bt_operation.
        try:
            prev_autocommit = conn.autocommit
        except Exception:
            prev_autocommit = None
        try:
            conn.autocommit = False
        except Exception:
            pass
        updates = body.model_dump(exclude_unset=True)
        if not updates:
            return {"message": "Aucune modification"}
        # Fetch current line for stock delta. FOR UPDATE lock to serialize
        # concurrent edits on the same line (TOCTOU on stock delta).
        cursor.execute(
            "SELECT produit_id, quantite, prix_unitaire FROM formulaire_lignes "
            "WHERE id = %s AND formulaire_id = %s FOR UPDATE",
            (line_id, bt_id),
        )
        old_line = cursor.fetchone()
        if not old_line:
            raise HTTPException(status_code=404, detail="Ligne non trouvee")
        old_data = dict(old_line)
        # Recalculate montant_ligne if qty or price changed
        new_qty = updates.get("quantite", old_data["quantite"])
        new_prix = updates.get("prix_unitaire", old_data["prix_unitaire"])
        if new_qty is None:
            new_qty = old_data["quantite"]
        if new_prix is None:
            new_prix = old_data["prix_unitaire"]
        updates["montant_ligne"] = round(float(new_qty) * float(new_prix), 2)
        set_parts = [f"{k} = %s" for k in updates]
        values = list(updates.values()) + [line_id, bt_id]
        cursor.execute(
            f"UPDATE formulaire_lignes SET {', '.join(set_parts)} WHERE id = %s AND formulaire_id = %s",
            values,
        )
        # Recalculate BT total
        cursor.execute(
            "UPDATE formulaires SET montant_total = ("
            "  SELECT COALESCE(SUM(montant_ligne), 0) FROM formulaire_lignes WHERE formulaire_id = %s"
            "), updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (bt_id, bt_id),
        )
        # Adjust stock if qty changed and line is linked to a product. Wrap in
        # a SAVEPOINT so a failure here doesn't poison the outer tx (which
        # already committed the line/total updates conceptually). Without the
        # savepoint, the bare try/except would *appear* to log-and-continue but
        # PostgreSQL aborts the entire tx on the first error — the outer
        # commit() would then either raise InFailedSqlTransaction or roll back
        # everything (Round 11 finding scenario 8). With SAVEPOINT, only the
        # stock segment is rolled back; the line/total updates remain valid.
        old_produit_id = old_data.get("produit_id")
        old_qty = float(old_data.get("quantite") or 0)
        new_qty_f = float(new_qty)
        if old_produit_id and old_qty != new_qty_f:
            delta = new_qty_f - old_qty  # positive = more stock out
            try:
                cursor.execute("SAVEPOINT stock_adj")
                cursor.execute(
                    "UPDATE produits SET stock_disponible = stock_disponible - %s, "
                    "updated_at = CURRENT_TIMESTAMP WHERE id = %s RETURNING stock_disponible",
                    (delta, old_produit_id),
                )
                prod_row = cursor.fetchone()
                if prod_row:
                    cursor.execute("SELECT numero_document FROM formulaires WHERE id = %s", (bt_id,))
                    bt_row = cursor.fetchone()
                    bt_ref = bt_row["numero_document"] if bt_row else f"BT-{bt_id}"
                    mvt_type = "SORTIE" if delta > 0 else "ENTREE"
                    cursor.execute(
                        "INSERT INTO mouvements_stock (produit_id, type_mouvement, quantite, "
                        "reference_document, motif, employee_id, created_at) "
                        "VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)",
                        (old_produit_id, mvt_type, abs(delta), bt_ref,
                         f"Modification ligne BT {bt_ref}", user.user_id),
                    )
                cursor.execute("RELEASE SAVEPOINT stock_adj")
            except Exception as exc:
                logger.warning("update_line stock adjustment error (line update preserved): %s", exc)
                try:
                    cursor.execute("ROLLBACK TO SAVEPOINT stock_adj")
                    cursor.execute("RELEASE SAVEPOINT stock_adj")
                except Exception:
                    pass
        conn.commit()
        return {"message": "Ligne mise a jour"}
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("update_line error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        # Re-set search_path because rollback wipes it (lesson #14).
        try:
            db.set_tenant(conn, user.schema)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception:
                pass
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/work-orders/{bt_id}/lines/{line_id}")
async def delete_line(bt_id: int, line_id: int, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    prev_autocommit = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Run idempotent DDL BEFORE flipping to tx mode (cf. update_line).
        _ensure_formulaire_lignes_produit_id(cursor)
        # FIX P0: atomicite suppression+stock+total (idem update_line).
        try:
            prev_autocommit = conn.autocommit
        except Exception:
            prev_autocommit = None
        try:
            conn.autocommit = False
        except Exception:
            pass
        # Fetch line data before deletion (for stock reversal). FOR UPDATE
        # serialises concurrent delete attempts on the same line.
        cursor.execute(
            "SELECT produit_id, quantite FROM formulaire_lignes "
            "WHERE id = %s AND formulaire_id = %s FOR UPDATE",
            (line_id, bt_id),
        )
        line_data = cursor.fetchone()
        if not line_data:
            raise HTTPException(status_code=404, detail="Ligne non trouvee")
        cursor.execute(
            "DELETE FROM formulaire_lignes WHERE id = %s AND formulaire_id = %s",
            (line_id, bt_id),
        )
        cursor.execute(
            "UPDATE formulaires SET montant_total = ("
            "  SELECT COALESCE(SUM(montant_ligne), 0) FROM formulaire_lignes WHERE formulaire_id = %s"
            "), updated_at = CURRENT_TIMESTAMP "
            "WHERE id = %s",
            (bt_id, bt_id),
        )
        # Auto stock movement ENTREE (reversal) if line was linked to a product.
        # Wrap in SAVEPOINT to isolate stock failure from line deletion (cf.
        # update_line rationale — without SAVEPOINT, an UPDATE produits failure
        # poisons the entire tx and rolls back the line deletion as well).
        deleted_produit_id = line_data.get("produit_id") if isinstance(line_data, dict) else None
        deleted_qty = float(line_data.get("quantite") or 0) if isinstance(line_data, dict) else 0
        if deleted_produit_id and deleted_qty > 0:
            try:
                cursor.execute("SAVEPOINT stock_rev")
                cursor.execute(
                    "UPDATE produits SET stock_disponible = stock_disponible + %s, "
                    "updated_at = CURRENT_TIMESTAMP WHERE id = %s "
                    "RETURNING stock_disponible",
                    (deleted_qty, deleted_produit_id),
                )
                prod_row = cursor.fetchone()
                if prod_row:
                    qty_apres = float(prod_row["stock_disponible"])
                    qty_avant = qty_apres - deleted_qty
                    cursor.execute("SELECT numero_document FROM formulaires WHERE id = %s", (bt_id,))
                    bt_row = cursor.fetchone()
                    bt_ref = bt_row["numero_document"] if bt_row else f"BT-{bt_id}"
                    cursor.execute(
                        "INSERT INTO mouvements_stock (produit_id, type_mouvement, quantite, "
                        "quantite_avant, quantite_apres, reference_document, motif, employee_id, created_at) "
                        "VALUES (%s, 'ENTREE', %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)",
                        (deleted_produit_id, deleted_qty, qty_avant, qty_apres,
                         bt_ref, f"Annulation ligne BT {bt_ref}", user.user_id),
                    )
                cursor.execute("RELEASE SAVEPOINT stock_rev")
            except Exception as exc:
                logger.warning("delete_line stock reversal error (deletion preserved): %s", exc)
                try:
                    cursor.execute("ROLLBACK TO SAVEPOINT stock_rev")
                    cursor.execute("RELEASE SAVEPOINT stock_rev")
                except Exception:
                    pass
        conn.commit()
        return {"message": "Ligne supprimée"}
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("delete_line error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        # Re-set search_path because rollback wipes it (lesson #14).
        try:
            db.set_tenant(conn, user.schema)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception:
                pass
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# ASSIGNATIONS
# ============================================

@router.get("/work-orders/{bt_id}/assignations")
async def list_assignations(bt_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_bt_tables(cursor)
        cursor.execute(
            "SELECT a.id, a.bt_id, a.employee_id, a.role, a.created_at, "
            "e.prenom || ' ' || e.nom AS employee_nom "
            "FROM bt_assignations a "
            "LEFT JOIN employees e ON e.id = a.employee_id "
            "WHERE a.bt_id = %s ORDER BY a.created_at",
            (bt_id,),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            items.append(d)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_assignations error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/work-orders/{bt_id}/assignations")
async def add_assignation(bt_id: int, body: AssignationCreate, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_bt_tables(cursor)
        # Validate BT exists in this tenant. Without this guard, the bt_assignations
        # table (no FK by design — see _ensure_bt_tables) would accept orphan rows
        # for non-existent or wrong-type formulaires (DOS storage bloat).
        cursor.execute(
            "SELECT id FROM formulaires WHERE id = %s AND type_formulaire = 'BON_TRAVAIL'",
            (bt_id,),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Bon de travail introuvable")
        # Validate employee exists
        cursor.execute("SELECT id FROM employees WHERE id = %s", (body.employee_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Employe introuvable")
        # Check if already assigned
        cursor.execute(
            "SELECT id FROM bt_assignations WHERE bt_id = %s AND employee_id = %s",
            (bt_id, body.employee_id),
        )
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail="Employé déjà assigné")
        cursor.execute(
            "INSERT INTO bt_assignations (bt_id, employee_id, role, created_at) "
            "VALUES (%s, %s, %s, CURRENT_TIMESTAMP) RETURNING id",
            (bt_id, body.employee_id, body.role),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Employe assigne"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("add_assignation error: %s", exc)
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


@router.delete("/work-orders/{bt_id}/assignations/{assignation_id}")
async def remove_assignation(bt_id: int, assignation_id: int, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM bt_assignations WHERE id = %s AND bt_id = %s",
            (assignation_id, bt_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Assignation non trouvée")
        conn.commit()
        return {"message": "Assignation supprimée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("remove_assignation error: %s", exc)
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
# COMMENTS
# ============================================

@router.get("/work-orders/{bt_id}/comments")
async def list_comments(bt_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_bt_tables(cursor)
        cursor.execute(
            "SELECT id, bt_id, user_id, comment_text, created_at "
            "FROM bt_comments WHERE bt_id = %s ORDER BY created_at ASC",
            (bt_id,),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            items.append(d)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_comments error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/work-orders/{bt_id}/comments")
async def add_comment(bt_id: int, body: CommentCreate, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_bt_tables(cursor)
        # Validate BT exists in this tenant. Without this guard, the bt_comments
        # table (no FK by design — see _ensure_bt_tables) would accept orphan rows
        # for non-existent or wrong-type formulaires (DOS storage bloat).
        cursor.execute(
            "SELECT id FROM formulaires WHERE id = %s AND type_formulaire = 'BON_TRAVAIL'",
            (bt_id,),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Bon de travail introuvable")
        cursor.execute(
            "INSERT INTO bt_comments (bt_id, user_id, comment_text, created_at) "
            "VALUES (%s, %s, %s, CURRENT_TIMESTAMP) RETURNING id",
            (bt_id, user.user_id, body.comment_text),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Commentaire ajoute"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("add_comment error: %s", exc)
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


@router.get("/work-orders/{bt_id}/time-entries")
async def get_bt_time_entries(bt_id: int, user: ErpUser = Depends(get_current_user)):
    """Get time entries linked to a specific bon de travail."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT te.*, e.prenom || ' ' || e.nom as employe_nom "
            "FROM time_entries te "
            "LEFT JOIN employees e ON te.employee_id = e.id "
            "WHERE te.formulaire_bt_id = %s "
            "ORDER BY te.punch_in DESC",
            (bt_id,),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("punch_in", "punch_out", "created_at", "validated_at"):
                if d.get(k):
                    d[k] = str(d[k])
            if d.get("total_hours") is not None:
                d["total_hours"] = float(d["total_hours"])
            items.append(d)
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_bt_time_entries error: %s", exc)
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
# OPERATIONS (TASKS) FOR WORK ORDERS
# ============================================


@router.get("/operation-types")
async def list_operation_types(user: ErpUser = Depends(get_current_user)):
    """Return default operation type names for Quebec construction."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    return {"items": DEFAULT_OPERATION_TYPES}


@router.get("/operations")
async def list_all_operations(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    statut: Optional[str] = None,
):
    """List ALL operations across all BTs (global view)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_operations_columns(cursor)

        where = "WHERE o.formulaire_bt_id IS NOT NULL"
        params: list = []
        if statut:
            where += " AND o.statut = %s"
            params.append(statut)

        # Count
        cursor.execute(f"SELECT COUNT(*) FROM operations o {where}", params)
        row = cursor.fetchone()
        total = row["count"] if isinstance(row, dict) else row[0]

        # Fetch
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT o.id, o.formulaire_bt_id, o.nom, o.description, o.quantite, "
            f"o.employee_id, o.fournisseur, o.heures_prevues, o.heures_reelles, "
            f"o.statut, o.date_debut, o.date_fin, o.poste_travail, "
            f"o.sequence_number, o.created_at, o.updated_at, "
            f"e.prenom || ' ' || e.nom AS employee_nom, "
            f"f.numero_document AS bt_numero, f.nom AS bt_nom "
            f"FROM operations o "
            f"LEFT JOIN employees e ON e.id = o.employee_id "
            f"LEFT JOIN formulaires f ON f.id = o.formulaire_bt_id "
            f"{where} "
            f"ORDER BY o.created_at DESC "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("quantite", "heures_prevues", "heures_reelles"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            for k in ("date_debut", "date_fin", "created_at", "updated_at"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_all_operations error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/work-orders/{bt_id}/operations")
async def list_bt_operations(bt_id: int, user: ErpUser = Depends(get_current_user)):
    """List operations for a specific work order."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_operations_columns(cursor)
        cursor.execute(
            "SELECT o.id, o.formulaire_bt_id, o.nom, o.description, o.quantite, "
            "o.employee_id, o.fournisseur, o.heures_prevues, o.heures_reelles, "
            "o.statut, o.date_debut, o.date_fin, o.poste_travail, "
            "o.sequence_number, o.created_at, o.updated_at, "
            "e.prenom || ' ' || e.nom AS employee_nom "
            "FROM operations o "
            "LEFT JOIN employees e ON e.id = o.employee_id "
            "WHERE o.formulaire_bt_id = %s "
            "ORDER BY o.sequence_number, o.id",
            (bt_id,),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("quantite", "heures_prevues", "heures_reelles"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            for k in ("date_debut", "date_fin", "created_at", "updated_at"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_bt_operations error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/work-orders/{bt_id}/operations")
async def add_bt_operation(bt_id: int, body: OperationCreate, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    """Add an operation/task to a work order."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    prev_autocommit = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # autocommit=False pour serialiser MAX(sequence_number)+1 (race-safe)
        try:
            prev_autocommit = conn.autocommit
        except Exception:
            prev_autocommit = None
        try:
            conn.autocommit = False
        except Exception:
            pass
        _ensure_operations_columns(cursor)

        # FIX P0: Verifier BT existe + lock pour serialiser sequence_number.
        cursor.execute(
            "SELECT id FROM formulaires WHERE id = %s AND type_formulaire = 'BON_TRAVAIL' FOR UPDATE",
            (bt_id,),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Bon de travail introuvable")

        # Validate employee exists if provided
        if body.employee_id is not None:
            cursor.execute("SELECT id FROM employees WHERE id = %s", (body.employee_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Employe introuvable")

        # Validate operation statut
        if body.statut not in OPERATION_STATUSES:
            raise HTTPException(status_code=400, detail=f"Statut operation invalide: {body.statut}. Valeurs: {', '.join(OPERATION_STATUSES)}")

        # Next sequence number (lock parent BT pris ci-dessus serialise les inserts)
        cursor.execute(
            "SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq FROM operations WHERE formulaire_bt_id = %s",
            (bt_id,),
        )
        row_seq = cursor.fetchone()
        seq = row_seq["next_seq"] if isinstance(row_seq, dict) else row_seq[0]

        date_debut = body.date_debut if body.date_debut else None
        date_fin = body.date_fin if body.date_fin else None

        cursor.execute(
            "INSERT INTO operations "
            "(formulaire_bt_id, nom, description, quantite, employee_id, fournisseur, "
            "heures_prevues, statut, date_debut, date_fin, poste_travail, sequence_number, "
            "created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) "
            "RETURNING id",
            (bt_id, body.nom, body.description, body.quantite, body.employee_id,
             body.fournisseur, body.heures_prevues, body.statut,
             date_debut, date_fin, body.poste_travail, seq),
        )
        row_op = cursor.fetchone()
        op_id = row_op["id"] if isinstance(row_op, dict) else row_op[0]
        conn.commit()
        return {"id": op_id, "message": "Operation ajoutee"}
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("add_bt_operation error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de l'ajout de l'operation")
    finally:
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception:
                pass
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/work-orders/{bt_id}/operations/{op_id}")
async def update_bt_operation(bt_id: int, op_id: int, body: OperationUpdate, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    """Update an operation on a work order."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_operations_columns(cursor)

        updates = body.model_dump(exclude_unset=True)
        if not updates:
            return {"message": "Aucune modification"}

        # Validate employee exists if being changed
        if "employee_id" in updates and updates["employee_id"] is not None:
            cursor.execute("SELECT id FROM employees WHERE id = %s", (updates["employee_id"],))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Employe introuvable")

        # Validate operation statut if being changed
        if "statut" in updates and updates["statut"] not in OPERATION_STATUSES:
            raise HTTPException(status_code=400, detail=f"Statut operation invalide: {updates['statut']}. Valeurs: {', '.join(OPERATION_STATUSES)}")

        # Empty date strings → None
        for date_key in ("date_debut", "date_fin"):
            if date_key in updates and not updates[date_key]:
                updates[date_key] = None

        ALLOWED = {"nom", "description", "quantite", "employee_id", "fournisseur",
                    "heures_prevues", "heures_reelles", "statut", "date_debut", "date_fin", "poste_travail"}
        set_parts = []
        vals = []
        for k, v in updates.items():
            if k in ALLOWED:
                set_parts.append(f"{k} = %s")
                vals.append(v)
        if not set_parts:
            return {"message": "Aucune modification"}

        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        vals.extend([op_id, bt_id])

        cursor.execute(
            f"UPDATE operations SET {', '.join(set_parts)} "
            f"WHERE id = %s AND formulaire_bt_id = %s",
            vals,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Operation introuvable")
        conn.commit()
        return {"message": "Operation mise à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_bt_operation error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la mise à jour")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/work-orders/{bt_id}/operations/{op_id}")
async def delete_bt_operation(bt_id: int, op_id: int, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    """Delete an operation from a work order."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_operations_columns(cursor)
        # Cleanup Gantt dependencies attached to this operation (type='op').
        # On error: rollback first (lesson #14 — cursor.execute that raised
        # leaves the tx in InFailedSqlTransaction state, and the rollback
        # destroys search_path), THEN re-set_tenant. Without rollback, the
        # subsequent DELETE FROM operations would fail with
        # "current transaction is aborted, commands ignored until end of tx".
        try:
            cursor.execute(
                "DELETE FROM gantt_dependencies "
                "WHERE (source_type = 'op' AND source_id = %s) "
                "   OR (target_type = 'op' AND target_id = %s)",
                (str(op_id), str(op_id)),
            )
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        cursor.execute(
            "DELETE FROM operations WHERE id = %s AND formulaire_bt_id = %s",
            (op_id, bt_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Operation introuvable")
        conn.commit()
        return {"message": "Operation supprimee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_bt_operation error: %s", exc)
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


# ============================================
# CALENDAR EVENTS
# ============================================

@router.get("/calendar-events")
async def get_calendar_events(
    user: ErpUser = Depends(get_current_user),
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
):
    """Return upcoming deadlines for a given month: BT due dates, devis expirations, project milestones."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Defensive: certains tenants n'ont pas date_debut/date_fin sur formulaires
        # (ajoutes dans une migration posterieure, lecon #34)
        defensive_cols = [
            ("date_debut", "TIMESTAMP"),
            ("date_fin", "TIMESTAMP"),
            ("priorite", "TEXT"),
        ]
        for col_name, col_type in defensive_cols:
            try:
                cursor.execute(f"ALTER TABLE formulaires ADD COLUMN IF NOT EXISTS {col_name} {col_type}")
            except Exception as alter_exc:
                logger.warning("ALTER formulaires ADD %s failed: %s", col_name, alter_exc)
                try:
                    conn.rollback()
                    db.set_tenant(conn, user.schema)
                except Exception:
                    pass

        # Calculate month range
        start_date = f"{year}-{month:02d}-01"
        if month == 12:
            end_date = f"{year + 1}-01-01"
        else:
            end_date = f"{year}-{month + 1:02d}-01"

        events = []

        # Projects (spanning: date_debut_reel → date_fin_reel, overlap with month)
        try:
            cursor.execute(
                "SELECT id, nom_projet, statut, date_debut_reel, date_fin_reel, priorite "
                "FROM projects "
                "WHERE statut NOT IN ('Annule') "
                "AND (date_debut_reel IS NOT NULL OR date_fin_reel IS NOT NULL) "
                "AND COALESCE(date_debut_reel, date_fin_reel) < %s "
                "AND COALESCE(date_fin_reel, date_debut_reel) >= %s "
                "ORDER BY COALESCE(date_debut_reel, date_fin_reel) ASC",
                (end_date, start_date),
            )
            for row in cursor.fetchall():
                d = dict(row)
                events.append({
                    "id": f"project-{d['id']}",
                    "type": "project",
                    "title": d["nom_projet"],
                    "date": str(d.get("date_debut_reel") or d.get("date_fin_reel")),
                    "date_debut": str(d["date_debut_reel"]) if d.get("date_debut_reel") else None,
                    "date_fin": str(d["date_fin_reel"]) if d.get("date_fin_reel") else None,
                    "statut": d["statut"],
                    "priorite": d.get("priorite"),
                    "source_id": d["id"],
                })
        except Exception as exc:
            logger.warning("calendar projects error: %s", exc)
            try:
                conn.rollback()
                db.set_tenant(conn, user.schema)
            except Exception:
                pass

        # Work orders (spanning: date_debut → date_fin, overlap with month)
        try:
            cursor.execute(
                "SELECT id, numero_document, nom, statut, priorite, date_echeance, date_debut, date_fin "
                "FROM formulaires "
                "WHERE type_formulaire = 'BON_TRAVAIL' "
                "AND statut NOT IN ('ANNULE') "
                "AND (date_debut IS NOT NULL OR date_echeance IS NOT NULL OR date_fin IS NOT NULL) "
                "AND COALESCE(date_debut, date_echeance, date_fin) < %s "
                "AND COALESCE(date_fin, date_echeance, date_debut) >= %s "
                "ORDER BY COALESCE(date_debut, date_echeance) ASC",
                (end_date, start_date),
            )
            for row in cursor.fetchall():
                d = dict(row)
                dt_start = d.get("date_debut") or d.get("date_echeance")
                dt_end = d.get("date_fin") or d.get("date_echeance")
                events.append({
                    "id": f"bt-{d['id']}",
                    "type": "bon_travail",
                    "title": d["nom"],
                    "date": str(dt_start) if dt_start else str(dt_end),
                    "date_debut": str(d["date_debut"]) if d.get("date_debut") else None,
                    "date_fin": str(d["date_fin"]) if d.get("date_fin") else None,
                    "statut": d["statut"],
                    "priorite": d.get("priorite"),
                    "source_id": d["id"],
                    "numero": d.get("numero_document"),
                })
        except Exception as exc:
            logger.warning("calendar BT error: %s", exc)
            try:
                conn.rollback()
                db.set_tenant(conn, user.schema)
            except Exception:
                pass

        # Devis (spanning: date_soumis → date_prevu, overlap with month)
        cursor.execute(
            "SELECT id, numero_devis, nom_projet, statut, date_soumis, date_prevu, date_fin, investissement_total "
            "FROM devis "
            "WHERE statut NOT IN ('Annule', 'Refuse') "
            "AND (date_soumis IS NOT NULL OR date_prevu IS NOT NULL) "
            "AND COALESCE(date_soumis, date_prevu) < %s "
            "AND COALESCE(date_prevu, date_fin, date_soumis) >= %s "
            "ORDER BY COALESCE(date_soumis, date_prevu) ASC",
            (end_date, start_date),
        )
        for row in cursor.fetchall():
            d = dict(row)
            dt_start = d.get("date_soumis") or d.get("date_prevu")
            dt_end = d.get("date_prevu") or d.get("date_fin") or d.get("date_soumis")
            events.append({
                "id": f"devis-{d['id']}",
                "type": "devis",
                "title": f"Devis - {d['nom_projet']}" if d.get("nom_projet") else f"Devis {d['numero_devis']}",
                "date": str(dt_start) if dt_start else str(dt_end),
                "date_debut": str(d["date_soumis"]) if d.get("date_soumis") else None,
                "date_fin": str(d["date_prevu"]) if d.get("date_prevu") else None,
                "statut": d["statut"],
                "source_id": d["id"],
                "numero": d.get("numero_devis"),
                "montant": float(d["investissement_total"]) if d.get("investissement_total") else None,
            })

        # Purchase order delivery dates (bons_commande)
        try:
            cursor.execute(
                "SELECT bc.id, bc.numero, bc.statut, bc.date_livraison_prevue, bc.montant_total, "
                "f.nom_fournisseur AS fournisseur_nom "
                "FROM bons_commande bc "
                "LEFT JOIN fournisseurs f ON bc.fournisseur_id = f.id "
                "WHERE bc.date_livraison_prevue >= %s AND bc.date_livraison_prevue < %s "
                "AND bc.statut NOT IN ('Annule') "
                "ORDER BY bc.date_livraison_prevue ASC",
                (start_date, end_date),
            )
            for row in cursor.fetchall():
                d = dict(row)
                events.append({
                    "id": f"bc-{d['id']}",
                    "type": "bon_commande",
                    "title": d.get("fournisseur_nom") or d.get("numero") or f"BC-{d['id']}",
                    "date": str(d["date_livraison_prevue"]),
                    "statut": d["statut"],
                    "source_id": d["id"],
                    "numero": d.get("numero"),
                    "montant": float(d["montant_total"]) if d.get("montant_total") else None,
                })
        except Exception as exc:
            logger.warning("calendar BC error: %s", exc)

        # Invoice due dates (factures)
        try:
            cursor.execute(
                "SELECT id, numero_facture, statut, date_echeance, montant_total, "
                "project_id "
                "FROM factures "
                "WHERE date_echeance >= %s AND date_echeance < %s "
                "AND statut NOT IN ('ANNULEE') "
                "ORDER BY date_echeance ASC",
                (start_date, end_date),
            )
            for row in cursor.fetchall():
                d = dict(row)
                events.append({
                    "id": f"facture-{d['id']}",
                    "type": "facture",
                    "title": d.get("numero_facture") or f"Facture #{d['id']}",
                    "date": str(d["date_echeance"]),
                    "statut": d["statut"],
                    "source_id": d["id"],
                    "numero": d.get("numero_facture"),
                    "montant": float(d["montant_total"]) if d.get("montant_total") else None,
                })
        except Exception as exc:
            logger.warning("calendar factures error: %s", exc)

        # CRM interactions
        try:
            cursor.execute(
                "SELECT id, type_interaction, resume, date_interaction "
                "FROM interactions "
                "WHERE date_interaction::date >= %s AND date_interaction::date < %s "
                "ORDER BY date_interaction ASC",
                (start_date, end_date),
            )
            for row in cursor.fetchall():
                d = dict(row)
                events.append({
                    "id": f"interaction-{d['id']}",
                    "type": "interaction",
                    "title": d.get("resume") or d.get("type_interaction") or "Interaction",
                    "date": str(d["date_interaction"])[:10],
                    "statut": d.get("type_interaction") or "",
                    "source_id": d["id"],
                })
        except Exception as exc:
            logger.warning("calendar interactions error: %s", exc)

        # CRM activities
        try:
            cursor.execute(
                "SELECT id, type_activite, sujet, date_activite "
                "FROM crm_activities "
                "WHERE date_activite::date >= %s AND date_activite::date < %s "
                "ORDER BY date_activite ASC",
                (start_date, end_date),
            )
            for row in cursor.fetchall():
                d = dict(row)
                events.append({
                    "id": f"activite-{d['id']}",
                    "type": "activite",
                    "title": d.get("sujet") or d.get("type_activite") or "Activite",
                    "date": str(d["date_activite"])[:10],
                    "statut": d.get("type_activite") or "",
                    "source_id": d["id"],
                })
        except Exception as exc:
            logger.warning("calendar activities error: %s", exc)

        return {"events": events, "year": year, "month": month}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_calendar_events error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement des evenements")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# KANBAN BOARD
# ============================================

@router.get("/kanban")
async def get_kanban_data(user: ErpUser = Depends(get_current_user)):
    """Get kanban board data: projects, devis, BTs grouped by status."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Projects by status
        cursor.execute(
            "SELECT id, nom_projet as nom, statut, priorite, "
            "date_debut_reel, date_fin_reel, budget_total, created_at "
            "FROM projects WHERE statut NOT IN ('Annule') "
            "ORDER BY updated_at DESC NULLS LAST LIMIT 50"
        )
        projects = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_debut_reel", "date_fin_reel", "created_at"):
                if d.get(k):
                    d[k] = str(d[k])
            if d.get("budget_total"):
                d["budget_total"] = float(d["budget_total"])
            projects.append(d)

        # Devis by status
        cursor.execute(
            "SELECT id, numero_devis, nom_projet as nom, statut, "
            "investissement_total, date_prevu, created_at "
            "FROM devis WHERE statut NOT IN ('Annule', 'Expire') "
            "ORDER BY created_at DESC LIMIT 50"
        )
        devis = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_prevu", "created_at"):
                if d.get(k):
                    d[k] = str(d[k])
            if d.get("investissement_total"):
                d["investissement_total"] = float(d["investissement_total"])
            devis.append(d)

        # Work orders by status
        cursor.execute(
            "SELECT id, numero_document as numero, nom, statut, priorite, "
            "date_echeance, created_at "
            "FROM formulaires WHERE type_formulaire = 'BON_TRAVAIL' "
            "AND statut NOT IN ('ANNULE') "
            "ORDER BY created_at DESC LIMIT 50"
        )
        bons_travail = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_echeance", "created_at"):
                if d.get(k):
                    d[k] = str(d[k])
            bons_travail.append(d)

        # ---- Fetch assignees for all entities ----
        # Project assignees
        project_ids = [int(p["id"]) for p in projects]
        project_assignees: dict = {}
        if project_ids:
            try:
                cursor.execute(
                    "SELECT pa.project_id, pa.employee_id, "
                    "e.prenom || ' ' || e.nom AS employe_nom "
                    "FROM project_assignments pa "
                    "LEFT JOIN employees e ON e.id = pa.employee_id "
                    "WHERE pa.project_id = ANY(%s)",
                    (project_ids,),
                )
                for row in cursor.fetchall():
                    pid = str(row["project_id"])
                    if pid not in project_assignees:
                        project_assignees[pid] = []
                    project_assignees[pid].append({
                        "employeeId": row["employee_id"],
                        "nom": row["employe_nom"] or "Inconnu",
                    })
            except Exception:
                pass  # Table may not exist yet

        for p in projects:
            p["assignees"] = project_assignees.get(str(p["id"]), [])

        # Devis assignees
        devis_ids = [d["id"] for d in devis]
        devis_assignees: dict = {}
        if devis_ids:
            try:
                cursor.execute(
                    "CREATE TABLE IF NOT EXISTS devis_assignations ("
                    "id SERIAL PRIMARY KEY, "
                    "devis_id INT NOT NULL, "
                    "employee_id INT NOT NULL, "
                    "role VARCHAR(100), "
                    "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
                )
                cursor.execute(
                    "SELECT da.devis_id, da.employee_id, "
                    "e.prenom || ' ' || e.nom AS employe_nom "
                    "FROM devis_assignations da "
                    "LEFT JOIN employees e ON e.id = da.employee_id "
                    "WHERE da.devis_id = ANY(%s)",
                    (devis_ids,),
                )
                for row in cursor.fetchall():
                    did = row["devis_id"]
                    if did not in devis_assignees:
                        devis_assignees[did] = []
                    devis_assignees[did].append({
                        "employeeId": row["employee_id"],
                        "nom": row["employe_nom"] or "Inconnu",
                    })
            except Exception:
                pass  # Table may not exist yet

        for d in devis:
            d["assignees"] = devis_assignees.get(d["id"], [])

        # BT assignees
        bt_ids = [b["id"] for b in bons_travail]
        bt_assignees: dict = {}
        if bt_ids:
            try:
                cursor.execute(
                    "SELECT a.bt_id, a.employee_id, "
                    "e.prenom || ' ' || e.nom AS employee_nom "
                    "FROM bt_assignations a "
                    "LEFT JOIN employees e ON e.id = a.employee_id "
                    "WHERE a.bt_id = ANY(%s)",
                    (bt_ids,),
                )
                for row in cursor.fetchall():
                    bid = row["bt_id"]
                    if bid not in bt_assignees:
                        bt_assignees[bid] = []
                    bt_assignees[bid].append({
                        "employeeId": row["employee_id"],
                        "nom": row["employee_nom"] or "Inconnu",
                    })
            except Exception:
                pass

        for b in bons_travail:
            b["assignees"] = bt_assignees.get(b["id"], [])

        # Factures
        factures = []
        try:
            cursor.execute(
                "SELECT f.id, f.numero_facture, f.statut, f.montant_total, "
                "f.date_echeance, f.project_id, f.created_at, "
                "p.nom_projet "
                "FROM factures f "
                "LEFT JOIN projects p ON f.project_id::text = p.id::text "
                "WHERE f.statut NOT IN ('ANNULEE') "
                "ORDER BY f.created_at DESC LIMIT 50"
            )
            for row in cursor.fetchall():
                d = dict(row)
                factures.append({
                    "id": d["id"],
                    "numero": d.get("numero_facture"),
                    "nom": d.get("nom_projet") or d.get("numero_facture") or f"Facture #{d['id']}",
                    "statut": d["statut"],
                    "montantTotal": float(d["montant_total"]) if d.get("montant_total") else None,
                    "dateEcheance": str(d["date_echeance"]) if d.get("date_echeance") else None,
                    "createdAt": str(d["created_at"]) if d.get("created_at") else None,
                    "projectNom": d.get("nom_projet"),
                })
        except Exception as exc:
            logger.warning("kanban factures error: %s", exc)

        return {
            "projects": projects,
            "devis": devis,
            "bons_travail": bons_travail,
            "factures": factures,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_kanban_data error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement du kanban")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# ACHATS ASSIGNATIONS
# ============================================

@router.get("/achats/{achat_id}/assignations")
async def list_achat_assignations(achat_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS achat_assignations ("
            "id SERIAL PRIMARY KEY, "
            "achat_id INT NOT NULL, "
            "employee_id INT NOT NULL, "
            "role VARCHAR(100), "
            "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
        )
        cursor.execute(
            "SELECT aa.id, aa.achat_id, aa.employee_id, aa.role, aa.created_at, "
            "e.prenom || ' ' || e.nom AS employe_nom "
            "FROM achat_assignations aa "
            "LEFT JOIN employees e ON e.id = aa.employee_id "
            "WHERE aa.achat_id = %s ORDER BY aa.created_at",
            (achat_id,),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            items.append(d)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_achat_assignations error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/achats/{achat_id}/assignations")
async def add_achat_assignation(achat_id: int, body: AchatAssignationCreate, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS achat_assignations ("
            "id SERIAL PRIMARY KEY, "
            "achat_id INT NOT NULL, "
            "employee_id INT NOT NULL, "
            "role VARCHAR(100), "
            "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
        )
        cursor.execute(
            "SELECT id FROM achat_assignations WHERE achat_id = %s AND employee_id = %s",
            (achat_id, body.employee_id),
        )
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail="Employé déjà assigné")
        cursor.execute(
            "INSERT INTO achat_assignations (achat_id, employee_id, role, created_at) "
            "VALUES (%s, %s, %s, CURRENT_TIMESTAMP) RETURNING id",
            (achat_id, body.employee_id, body.role),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Employe assigne a l'achat"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("add_achat_assignation error: %s", exc)
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


@router.delete("/achats/{achat_id}/assignations/{assignation_id}")
async def remove_achat_assignation(achat_id: int, assignation_id: int, user: ErpUser = Depends(require_role(*BT_WRITE_ROLES))):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM achat_assignations WHERE id = %s AND achat_id = %s",
            (assignation_id, achat_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Assignation non trouvée")
        conn.commit()
        return {"message": "Assignation supprimée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("remove_achat_assignation error: %s", exc)
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


# ============================================================
# BON DE TRAVAIL — HTML Generation
# ============================================================

def _fmt_money(val) -> str:
    try:
        v = float(val or 0)
    except (ValueError, TypeError):
        v = 0.0
    return f"{v:,.2f} $"


BT_SAFETY = [
    "Porter les equipements de protection individuelle (EPI) requis en tout temps.",
    "Respecter les procedures de cadenassage avant toute intervention.",
    "Signaler immediatement tout danger, incident ou quasi-accident au superviseur.",
    "Maintenir l'aire de travail propre et ordonnee.",
    "Verifier l'etat des outils et equipements avant utilisation.",
]

PRIORITE_COLORS = {
    "BASSE": "#38a169", "NORMALE": "#3182ce",
    "HAUTE": "#dd6b20", "URGENTE": "#e53e3e",
}
STATUT_COLORS = {
    "BROUILLON": "#a0aec0", "EN_COURS": "#3182ce",
    "EN_PAUSE": "#d69e2e", "TERMINE": "#38a169", "ANNULE": "#e53e3e",
}


def _generate_bt_html(bt, lignes, assignations, enterprise, operations=None, theme=None):
    """Generate a professional HTML document for a bon de travail.

    `theme` is an optional tenant color palette from get_document_theme().
    Falls back to DEFAULT_DOCUMENT_THEME so rendering never breaks.

    SECURITY: All user-controlled strings (BT name, notes, line description,
    employee name, etc.) are escaped via `_e()` before HTML interpolation to
    prevent stored XSS. The HTML output is rendered both in a sandboxed iframe
    AND in `window.open(...).document.write(...)` (frontend "Open in new tab"),
    the latter without sandbox — so unescaped user input would execute scripts
    with full session cookies.
    """
    from .html_utils import DEFAULT_DOCUMENT_THEME, THEME_KEYS
    _t = dict(DEFAULT_DOCUMENT_THEME)
    if isinstance(theme, dict):
        for k in THEME_KEYS:
            v = theme.get(k)
            if isinstance(v, str) and v.strip():
                _t[k] = v
    if enterprise:
        ent_name = enterprise.get("nom", "") or enterprise.get("nom_entreprise", "") or "Entreprise"
        ent_address = enterprise.get("adresse", "")
        ent_ville = enterprise.get("ville", "")
        ent_province = enterprise.get("province", "")
        ent_cp = enterprise.get("code_postal", "")
        ent_phone = enterprise.get("telephone", "") or enterprise.get("telephone_bureau", "")
        ent_email = enterprise.get("courriel", "") or enterprise.get("email", "")
        ent_rbq = enterprise.get("rbq", "") or enterprise.get("numero_rbq", "")
        ent_neq = enterprise.get("neq", "") or enterprise.get("numero_neq", "")
    else:
        ent_name = "Entreprise"
        ent_address = ent_ville = ent_province = ent_cp = ""
        ent_phone = ent_email = ent_rbq = ent_neq = ""

    numero = bt.get("numero_document", "")
    nom = bt.get("nom", "")
    statut = bt.get("statut", "BROUILLON")
    priorite = bt.get("priorite", "NORMALE")
    projet_nom = bt.get("project_nom", "") or ""
    date_echeance = str(bt.get("date_echeance", ""))[:10] if bt.get("date_echeance") else ""
    date_creation = str(bt.get("created_at", ""))[:10]
    notes = bt.get("notes", "") or ""

    # Pre-escape all user-controlled values so the HTML interpolations below are
    # safe. Numeric values (qte, prix, montant, ops_hp, ops_hr) bypass escape
    # because they go through float() + format spec — no HTML metacharacters.
    ent_name_e = _e(ent_name)
    ent_address_e = _e(ent_address)
    ent_ville_e = _e(ent_ville)
    ent_province_e = _e(ent_province)
    ent_cp_e = _e(ent_cp)
    ent_phone_e = _e(ent_phone)
    ent_email_e = _e(ent_email)
    ent_rbq_e = _e(ent_rbq)
    ent_neq_e = _e(ent_neq)
    numero_e = _e(numero)
    nom_e = _e(nom)
    statut_e = _e(statut)
    priorite_e = _e(priorite)
    projet_nom_e = _e(projet_nom)
    date_echeance_e = _e(date_echeance)
    date_creation_e = _e(date_creation)
    notes_e = _e(notes)

    # Totals
    lignes_total = sum(float(l.get("montant_ligne", 0) or 0) for l in lignes)
    if lignes_total > 0:
        montant_total = lignes_total
    else:
        try:
            montant_total = float(bt.get("montant_total", 0) or 0)
        except (ValueError, TypeError):
            montant_total = 0.0

    # Lines HTML
    lines_html = ""
    for idx, l in enumerate(lignes, 1):
        desc = l.get("description", "")
        unite = l.get("unite", "")
        qte = float(l.get("quantite", 0) or 0)
        prix = float(l.get("prix_unitaire", 0) or 0)
        montant = float(l.get("montant_ligne", 0) or 0)
        lines_html += f"""<tr>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;color:#718096">{idx}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">{_e(desc)}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">{qte:,.2f}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center">{_e(unite)}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">{_fmt_money(prix)}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600">{_fmt_money(montant)}</td>
</tr>"""

    # Assignations HTML
    assign_html = ""
    for a in assignations:
        assign_html += f"""<tr>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">{_e(a.get('employee_nom') or 'N/A')}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">{_e(a.get('role') or '--')}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">{_e(str(a.get('created_at', ''))[:10])}</td>
</tr>"""

    # Operations HTML (from operations table)
    if operations is None:
        operations = []
    ops_html = ""
    total_h_prevues = 0.0
    total_h_reelles = 0.0
    for idx, op in enumerate(operations, 1):
        op_nom = op.get("nom", "") or op.get("description", "") or ""
        op_qte = float(op.get("quantite", 1) or 1)
        op_assign = op.get("employee_nom", "") or ""
        op_fourn = op.get("fournisseur", "") or ""
        _hp = op.get("heures_prevues")
        op_hp = float(_hp) if _hp is not None else 0.0
        _hr = op.get("heures_reelles")
        op_hr = float(_hr) if _hr is not None else 0.0
        op_statut = (op.get("statut", "") or "").replace("_", " ").capitalize()
        total_h_prevues += op_hp
        total_h_reelles += op_hr
        ops_html += f"""<tr>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;color:#718096">{idx}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">{_e(op_nom)}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center">{op_qte:g}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">{_e(op_assign)}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">{_e(op_fourn)}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">{op_hp:g}h</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">{op_hr:g}h</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center">{_e(op_statut)}</td>
</tr>"""

    # Safety HTML — BT_SAFETY is a hardcoded constant in code, not user input,
    # so escaping is purely defensive but cheap.
    safety_html = "".join(f"<li>{_e(s)}</li>" for s in BT_SAFETY)

    p_color = PRIORITE_COLORS.get(priorite, "#3182ce")
    s_color = STATUT_COLORS.get(statut, "#a0aec0")

    html = f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Bon de travail {numero_e}</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}body{{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;color:#2d3748;line-height:1.5;background:#fff}}
.page{{max-width:850px;margin:0 auto;padding:40px}}.header{{display:flex;justify-content:space-between;align-items:stretch;margin-bottom:0}}
.header-left{{display:flex;align-items:center;gap:16px;max-width:55%}}.enterprise-name{{font-size:22px;font-weight:800;color:{_t['primary']};margin-bottom:2px}}.enterprise-info{{font-size:11px;color:#64748b;line-height:1.5}}.enterprise-info .ent-nums{{color:#94a3b8;font-size:10px;margin-top:2px}}
.header-right{{background:{_t['primary']};color:{_t['header_text']};padding:20px 28px;border-radius:6px;text-align:center;display:flex;flex-direction:column;justify-content:center;min-width:180px}}.doc-label{{font-size:24px;font-weight:800;letter-spacing:2px;color:{_t['header_text']}}}.doc-sublabel{{font-size:11px;color:{_t['accent_light']};text-transform:uppercase;letter-spacing:1px}}.doc-numero{{font-size:14px;color:{_t['accent_light']};margin-top:4px;font-weight:600}}
.badge{{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;color:#fff;margin-top:6px}}
.header-separator{{height:4px;background:linear-gradient(90deg,{_t['primary']} 0%,{_t['accent']} 50%,{_t['primary']} 100%);border-radius:2px;margin:20px 0 24px}}
.info-grid{{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:30px}}.info-box{{background:{_t['info_bg']};border-radius:6px;padding:16px 20px;border-left:4px solid {_t['accent']}}}
.info-box h4{{font-size:11px;text-transform:uppercase;color:{_t['accent']};letter-spacing:1px;margin-bottom:8px;font-weight:700}}.info-box p{{font-size:13px;color:#334155}}.info-box .name{{font-size:15px;font-weight:700;color:{_t['primary']};margin-bottom:4px}}
table{{width:100%;border-collapse:collapse;margin-bottom:20px}}thead th{{background:{_t['primary']};color:{_t['header_text']};padding:10px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;text-align:left}}
tbody td{{font-size:13px}}.total-row{{text-align:right;font-size:16px;font-weight:800;color:{_t['primary']};padding:12px 0;border-top:3px solid {_t['primary']}}}
.notes{{background:#fffbeb;border:1px solid #f6e05e;border-radius:8px;padding:16px;margin-bottom:30px}}.notes h4{{font-size:12px;font-weight:700;color:#975a16;margin-bottom:6px;text-transform:uppercase}}.notes p{{font-size:12px;color:#744210}}
.safety{{background:#f0fff4;border:1px solid #9ae6b4;border-radius:8px;padding:16px;margin-bottom:30px}}.safety h4{{font-size:12px;font-weight:700;color:#276749;margin-bottom:6px;text-transform:uppercase}}.safety ul{{font-size:12px;color:#2f855a;padding-left:20px}}.safety li{{margin-bottom:3px}}
.section-title{{font-size:14px;font-weight:700;color:{_t['primary']};margin-bottom:10px;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:6px}}
.signatures{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;margin-top:40px;padding-top:20px;border-top:1px solid #e2e8f0}}.sig-block{{text-align:center}}.sig-block h4{{font-size:13px;font-weight:700;color:{_t['primary']};margin-bottom:30px}}
.sig-line{{border-top:1px solid #2d3748;padding-top:8px;font-size:12px;color:#718096}}.footer{{margin-top:40px;padding-top:15px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#a0aec0}}
@media print{{.page{{padding:20px}}body{{-webkit-print-color-adjust:exact;print-color-adjust:exact}}}}
</style></head><body><div class="page">
<div class="header"><div class="header-left"><div>
<div class="enterprise-name">{ent_name_e}</div><div class="enterprise-info">
{f'{ent_address_e}' if ent_address else ''}{f', {ent_ville_e}, {ent_province_e} {ent_cp_e}' if ent_ville else ''}<br>
{f'Tel: {ent_phone_e}' if ent_phone else ''}{f' | {ent_email_e}' if ent_email else ''}
{f'<div class="ent-nums">' + ' | '.join(filter(None, [f'RBQ: {ent_rbq_e}' if ent_rbq else '', f'NEQ: {ent_neq_e}' if ent_neq else ''])) + '</div>' if any([ent_rbq, ent_neq]) else ''}
</div></div></div><div class="header-right"><div class="doc-sublabel">Bon de travail</div><div class="doc-label">TRAVAIL</div><div class="doc-numero">{numero_e}</div>
<div class="badge" style="background:{s_color}">{statut_e}</div>
<div class="badge" style="background:{p_color};margin-left:4px">{priorite_e}</div>
</div></div>
<div class="header-separator"></div>

<div class="info-grid"><div class="info-box"><h4>Details du bon</h4><p class="name">{nom_e}</p>
{f'<p><strong>Projet:</strong> {projet_nom_e}</p>' if projet_nom else ''}
<p><strong>Cree le:</strong> {date_creation_e}</p>
{f'<p><strong>Echeance:</strong> {date_echeance_e}</p>' if date_echeance else ''}
</div><div class="info-box"><h4>Montant</h4>
<p style="font-size:24px;font-weight:800;color:{_t['primary']}">{_fmt_money(montant_total)}</p>
<p style="font-size:11px;color:#718096;margin-top:4px">{len(operations or [])} operation(s) | {len(assignations)} employe(s)</p>
</div></div>

{f'<div class="notes"><h4>Instructions / Notes</h4><p>{notes_e}</p></div>' if notes else ''}

<h3 class="section-title">Operations</h3>
<table><thead><tr><th style="width:5%;text-align:center">#</th><th style="width:25%">Operation</th><th style="width:8%;text-align:center">Qte</th><th style="width:15%">Assigne a</th><th style="width:12%">Fournisseur</th><th style="width:12%;text-align:right">H. prevues</th><th style="width:12%;text-align:right">H. reelles</th><th style="width:11%;text-align:center">Statut</th></tr></thead>
<tbody>{ops_html}{'<tr><td colspan="8" style="padding:20px;text-align:center;color:#a0aec0;font-style:italic">Aucune operation</td></tr>' if not operations else ''}</tbody></table>
{f'<div style="text-align:right;font-size:13px;color:#4a5568;margin-bottom:20px"><strong>Total heures:</strong> {total_h_prevues:g}h prevues | {total_h_reelles:g}h reelles</div>' if operations else ''}

{'<h3 class="section-title">Lignes</h3><table><thead><tr><th style="width:5%;text-align:center">#</th><th style="width:35%">Description</th><th style="width:12%;text-align:right">Quantite</th><th style="width:10%;text-align:center">Unite</th><th style="width:18%;text-align:right">Prix unitaire</th><th style="width:20%;text-align:right">Montant</th></tr></thead><tbody>' + lines_html + '</tbody></table>' if lignes else ''}
<div class="total-row">Total: {_fmt_money(montant_total)}</div>

{'<h3 class="section-title">Equipe assignee</h3><table><thead><tr><th>Employe</th><th>Role</th><th>Date assignation</th></tr></thead><tbody>' + assign_html + '</tbody></table>' if assignations else ''}

<div class="safety"><h4>Consignes de securite</h4><ul>{safety_html}</ul></div>

<div class="signatures"><div class="sig-block"><h4>Superviseur</h4><div class="sig-line">Nom: ________________________<br>Date: ________________________<br>Signature: ___________________</div></div>
<div class="sig-block"><h4>Chef d'equipe</h4><div class="sig-line">Nom: ________________________<br>Date: ________________________<br>Signature: ___________________</div></div>
<div class="sig-block"><h4>Client</h4><div class="sig-line">Nom: ________________________<br>Date: ________________________<br>Signature: ___________________</div></div></div>

<div class="footer">{ent_name_e} — Bon de travail {numero_e} — Genere le {datetime.now().strftime('%Y-%m-%d %H:%M')}</div>
</div></body></html>"""
    # Post-hoc swap of the hardcoded gray border to the tenant's theme color
    # (no-op when the tenant keeps the default). Keeps inline-preview coherent
    # with the themed SHARED_CSS used by exports.py. Also inject tbody row
    # alternation so the rendered HTML matches the frontend ThemePreview.
    html = html.replace(
        '</style>',
        f"tbody tr:nth-child(even){{background:{_t['table_row_alt']};}}</style>",
        1,
    )
    html = html.replace('#e2e8f0', _t['border'])
    return html


@router.post("/work-orders/{bt_id}/generate-html")
async def generate_bt_html(bt_id: int, user: ErpUser = Depends(get_current_user)):
    """Generate a professional HTML document for a bon de travail."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT f.*, p.nom_projet AS project_nom
            FROM formulaires f LEFT JOIN projects p ON p.id::text = f.project_id::text
            WHERE f.id = %s AND f.type_formulaire = 'BON_TRAVAIL'
        """, (bt_id,))
        bt = cursor.fetchone()
        if not bt:
            raise HTTPException(status_code=404, detail="Bon de travail non trouvé")
        bt = dict(bt)

        cursor.execute(
            "SELECT * FROM formulaire_lignes WHERE formulaire_id = %s ORDER BY sequence_ligne, id",
            (bt_id,),
        )
        lignes = [dict(r) for r in cursor.fetchall()]

        assignations = []
        try:
            cursor.execute("""
                SELECT a.*, e.prenom || ' ' || e.nom AS employee_nom
                FROM bt_assignations a LEFT JOIN employees e ON e.id = a.employee_id
                WHERE a.bt_id = %s ORDER BY a.created_at
            """, (bt_id,))
            assignations = [dict(r) for r in cursor.fetchall()]
        except Exception:
            try:
                conn.rollback()
                db.set_tenant(conn, user.schema)  # re-set search_path after rollback
            except Exception:
                pass

        operations = []
        try:
            cursor.execute("""
                SELECT o.*, e.prenom || ' ' || e.nom AS employee_nom
                FROM operations o
                LEFT JOIN employees e ON e.id = o.employee_id
                WHERE o.formulaire_bt_id = %s ORDER BY o.id
            """, (bt_id,))
            operations = [dict(r) for r in cursor.fetchall()]
        except Exception:
            try:
                conn.rollback()
                db.set_tenant(conn, user.schema)
            except Exception:
                pass

        from .html_utils import get_company_info, get_document_theme
        enterprise = get_company_info(cursor)
        theme = get_document_theme(cursor)

        html = _generate_bt_html(bt, lignes, assignations, enterprise, operations, theme=theme)
        return {"html": html, "btId": bt_id, "numero": bt.get("numero_document", "")}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("generate_bt_html error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la generation HTML")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()
