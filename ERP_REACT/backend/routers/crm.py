"""
ERP React - CRM / Ventes Router
Opportunities pipeline, interactions tracking, and sales statistics.
Based on companies.py SEAOP pattern.
"""

import logging
import secrets
import calendar
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/crm", tags=["CRM"])

OPPORTUNITY_STATUSES = ('PROSPECTION', 'QUALIFICATION', 'PROPOSITION', 'NEGOCIATION', 'GAGNE', 'PERDU')
INTERACTION_TYPES = ('APPEL', 'EMAIL', 'REUNION', 'VISITE', 'NOTE')

# Memoization: skip le DDL ALTER CONSTRAINT lourd apres la 1re sync par tenant.
# Pattern identique a _email_tables_ensured_for (emails.py:107). Reduit la
# pression de lock ACCESS EXCLUSIVE sur les calls subsequents.
_opportunities_check_synced: set = set()


def _ensure_opportunities_statut_check(cursor, schema: str = ""):
    """Synchronize the opportunities_statut_check CHECK constraint with the
    Python OPPORTUNITY_STATUSES tuple.

    Legacy tenants were provisioned with the French/capitalized values
    ('Prospection', 'Qualification', 'Proposition', 'Négociation', 'Gagné',
    'Perdu') — see erp_database.py:9066. The current code uses uppercase
    ASCII values ('PROSPECTION', ...) which breaks the INSERT with
    `new row for relation "opportunities" violates check constraint
    "opportunities_statut_check"`. This helper drops the legacy constraint
    and re-adds it with the current Python values.

    Strategie:
    1. UPDATE existing rows: mapping explicit des valeurs legacy connues
       (FR title-case avec accents, alias EN) vers UPPER ASCII. Rapide et
       deterministe (pas besoin d'unaccent extension).
    2. ADD CONSTRAINT ... NOT VALID: applique la contrainte aux NOUVEAUX
       INSERT/UPDATE sans valider les rows existants. Cela evite
       check_violation si un tenant a des valeurs custom hors mapping
       (ex: 'Annulé', 'En attente') — la contrainte reste enforce pour
       le futur, et les rows custom existants restent intacts.

    Memoized par schema (skip DDL apres 1re sync). Idempotent.
    """
    if schema and schema in _opportunities_check_synced:
        return
    values_sql = ", ".join(f"'{v}'" for v in OPPORTUNITY_STATUSES)
    try:
        cursor.execute("""
            DO $$ BEGIN
              -- 1. Migration best-effort des valeurs legacy connues vers UPPER ASCII.
              -- ELSE statut: les valeurs custom (Annulé, En attente, etc.) restent
              -- intactes — la contrainte NOT VALID ci-dessous les laisse passer.
              UPDATE opportunities SET statut = CASE
                WHEN UPPER(statut) IN ('PROSPECTION', 'PROSPECT') THEN 'PROSPECTION'
                WHEN UPPER(statut) IN ('QUALIFICATION', 'QUALIFIE') THEN 'QUALIFICATION'
                WHEN UPPER(statut) IN ('PROPOSITION', 'OFFRE') THEN 'PROPOSITION'
                WHEN UPPER(statut) IN ('NEGOCIATION', 'NÉGOCIATION') THEN 'NEGOCIATION'
                WHEN UPPER(statut) IN ('GAGNE', 'GAGNÉ', 'WON') THEN 'GAGNE'
                WHEN UPPER(statut) IN ('PERDU', 'LOST') THEN 'PERDU'
                ELSE statut
              END
              WHERE statut IS NOT NULL
                AND statut NOT IN (""" + values_sql + """);

              -- 2. ADD CONSTRAINT NOT VALID enforce la contrainte sur les
              -- NOUVEAUX INSERT/UPDATE sans valider les rows existants.
              -- Si un tenant a des valeurs custom hors mapping, l'ancien
              -- comportement (validation totale) faisait crasher tous les
              -- INSERT subsequents. NOT VALID est compatible PG 9.2+.
              ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_statut_check;
              ALTER TABLE opportunities ADD CONSTRAINT opportunities_statut_check
                CHECK (statut IN (""" + values_sql + """)) NOT VALID;
            EXCEPTION
              WHEN undefined_table THEN NULL;
              WHEN duplicate_object THEN NULL;
            END $$;
        """)
    except Exception as exc:
        logger.warning("sync opportunities_statut_check failed: %s", exc)
        return  # don't memoize on failure
    if schema:
        _opportunities_check_synced.add(schema)


# ============================================
# PYDANTIC MODELS
# ============================================

# Allow both snake_case (API direct/curl) and camelCase (frontend Axios interceptor)
from pydantic import ConfigDict, Field, field_validator


def _empty_to_none(v):
    """Convert empty strings to None — used on date fields to avoid PostgreSQL
    'invalid input syntax for type date: ""' errors when frontend sends blank dates."""
    return None if isinstance(v, str) and v.strip() == "" else v


def _strip_non_empty(v):
    """Strip whitespace and reject empty strings. Passes None through.
    Used by required-name validators to block `""` and `"   "` inputs."""
    if v is None:
        return v
    v = str(v).strip()
    if not v:
        raise ValueError("Ne peut pas etre vide")
    return v


_CRM_DATE_FIELDS = ("date_cloture_prevue", "date_soumission", "date_debut_prevu", "date_fin_prevue")


class OpportunityCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    nom: str
    company_id: Optional[int] = Field(None, alias="companyId")
    contact_id: Optional[int] = Field(None, alias="contactId")
    client_nom_direct: Optional[str] = Field(None, alias="clientNomDirect")
    montant_estime: Optional[float] = Field(None, alias="montantEstime")
    probabilite: Optional[int] = None
    statut: str = "PROSPECTION"
    date_cloture_prevue: Optional[str] = Field(None, alias="dateCloturePrevue")
    notes: Optional[str] = None
    source: Optional[str] = None
    po_client: Optional[str] = Field(None, alias="poClient")
    priorite: Optional[str] = None
    description: Optional[str] = None
    date_soumission: Optional[str] = Field(None, alias="dateSoumission")
    date_debut_prevu: Optional[str] = Field(None, alias="dateDebutPrevu")
    date_fin_prevue: Optional[str] = Field(None, alias="dateFinPrevue")

    _nom_validator = field_validator("nom", mode="before")(_strip_non_empty)

    @field_validator(*_CRM_DATE_FIELDS, mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class OpportunityUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    nom: Optional[str] = None
    company_id: Optional[int] = Field(None, alias="companyId")
    contact_id: Optional[int] = Field(None, alias="contactId")
    client_nom_direct: Optional[str] = Field(None, alias="clientNomDirect")
    montant_estime: Optional[float] = Field(None, alias="montantEstime")
    probabilite: Optional[int] = None
    statut: Optional[str] = None
    date_cloture_prevue: Optional[str] = Field(None, alias="dateCloturePrevue")
    notes: Optional[str] = None
    source: Optional[str] = None
    po_client: Optional[str] = Field(None, alias="poClient")
    priorite: Optional[str] = None
    description: Optional[str] = None
    date_soumission: Optional[str] = Field(None, alias="dateSoumission")
    date_debut_prevu: Optional[str] = Field(None, alias="dateDebutPrevu")
    date_fin_prevue: Optional[str] = Field(None, alias="dateFinPrevue")

    _nom_validator = field_validator("nom", mode="before")(_strip_non_empty)

    @field_validator(*_CRM_DATE_FIELDS, mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class OpportunityAssignationCreate(BaseModel):
    employee_id: int
    role: Optional[str] = None


class InteractionCreate(BaseModel):
    company_id: Optional[int] = None
    contact_id: Optional[int] = None
    opportunity_id: Optional[int] = None
    type_interaction: str = "NOTE"
    resume: str
    details: Optional[str] = None
    date_interaction: Optional[str] = None
    suivi_prevu: Optional[str] = None

    @field_validator("date_interaction", "suivi_prevu", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class ActivityCreate(BaseModel):
    type_activite: str = "NOTE"  # APPEL, EMAIL, REUNION, VISITE, NOTE
    sujet: str
    description: Optional[str] = None
    date_activite: Optional[str] = None
    duree_minutes: Optional[int] = None
    company_id: Optional[int] = None
    contact_id: Optional[int] = None
    opportunity_id: Optional[int] = None

    @field_validator("date_activite", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


ACTIVITY_TYPES = ('APPEL', 'EMAIL', 'REUNION', 'VISITE', 'NOTE')


# ============================================
# DB MIGRATIONS (idempotent)
# ============================================

_migrations_run_for: set = set()

def run_opportunity_migrations(conn, schema: str = ""):
    """Run idempotent ALTER TABLE migrations for opportunity tracking.
    Safe to call from any router - runs once per process per tenant."""
    global _migrations_run_for
    if schema in _migrations_run_for:
        return
    prev_autocommit = conn.autocommit
    try:
        conn.autocommit = True
        cursor = conn.cursor()
        # opportunities columns
        opp_cols = [
            "numero_opportunite TEXT",
            "dossier_id INTEGER",
            "po_client TEXT",
            "priorite TEXT",
            "description TEXT",
            "type_projet TEXT",
            "adresse_chantier TEXT",
            "ville_chantier TEXT",
            "budget_estime REAL",
            "date_soumission TEXT",
            "date_debut_prevu TEXT",
            "date_fin_prevue TEXT",
            "client_nom_direct TEXT",
            "sort_order INTEGER DEFAULT 0",
        ]
        for col in opp_cols:
            cursor.execute(f"ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS {col}")
        cursor.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS opportunity_id INTEGER")
        cursor.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS numero_opportunite TEXT")
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS dossier_factures ("
            "id SERIAL PRIMARY KEY, "
            "dossier_id INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE, "
            "facture_id INTEGER NOT NULL REFERENCES factures(id) ON DELETE CASCADE, "
            "date_association TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
            "UNIQUE(dossier_id, facture_id))"
        )
        cursor.close()
        _migrations_run_for.add(schema)
    except Exception as exc:
        logger.warning("CRM migrations (non-critical): %s", exc)
    finally:
        conn.autocommit = prev_autocommit


# ============================================
# OPPORTUNITIES ENDPOINTS
# ============================================

@router.get("/opportunities")
async def list_opportunities(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=200),
    search: Optional[str] = None,
    statut: Optional[str] = None,
    company_id: Optional[int] = None,
):
    """List opportunities with pagination, search, and status filter."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        run_opportunity_migrations(conn, user.schema)
        cursor = conn.cursor()

        where_clauses = []
        params = []

        if search:
            where_clauses.append(
                "(LOWER(o.nom) LIKE %s OR LOWER(o.notes) LIKE %s OR LOWER(o.source) LIKE %s)"
            )
            s = f"%{search.lower()}%"
            params.extend([s, s, s])

        if statut:
            where_clauses.append("o.statut = %s")
            params.append(statut)

        if company_id:
            where_clauses.append("o.company_id = %s")
            params.append(company_id)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        # Count
        cursor.execute(
            f"SELECT COUNT(*) as total FROM opportunities o WHERE {where_sql}", params
        )
        total = cursor.fetchone()["total"]

        # Fetch page
        offset = (page - 1) * per_page
        # Defensive: la colonne `o.priorite` peut etre absente sur des tenants
        # legacy (schemas custom anterieurs au standard). On tente d'abord avec,
        # et on retombe sur la version sans en cas d'UndefinedColumn pour
        # eviter un 500 sur les comptes legacy.
        try:
            cursor.execute(
                f"SELECT o.id, o.nom, o.numero_opportunite, o.company_id, o.contact_id, o.montant_estime, "
                f"o.probabilite, o.statut, o.priorite, o.date_cloture_prevue, o.date_debut_prevu, o.date_fin_prevue, o.notes, "
                f"o.source, o.devis_id, o.projet_id, o.dossier_id, o.created_at, o.updated_at, "
                f"c.nom as company_nom "
                f"FROM opportunities o "
                f"LEFT JOIN companies c ON o.company_id = c.id "
                f"WHERE {where_sql} "
                f"ORDER BY COALESCE(o.sort_order, 999) ASC, o.updated_at DESC NULLS LAST "
                f"LIMIT %s OFFSET %s",
                params + [per_page, offset],
            )
        except Exception as exc:
            # Reset transaction puis retente sans o.priorite
            try:
                conn.rollback()
                db.set_tenant(conn, user.schema)
                cursor = conn.cursor()
            except Exception:
                pass
            logger.warning("list_opportunities: fallback SELECT sans priorite (legacy tenant): %s", exc)
            cursor.execute(
                f"SELECT o.id, o.nom, o.numero_opportunite, o.company_id, o.contact_id, o.montant_estime, "
                f"o.probabilite, o.statut, o.date_cloture_prevue, o.date_debut_prevu, o.date_fin_prevue, o.notes, "
                f"o.source, o.devis_id, o.projet_id, o.dossier_id, o.created_at, o.updated_at, "
                f"c.nom as company_nom "
                f"FROM opportunities o "
                f"LEFT JOIN companies c ON o.company_id = c.id "
                f"WHERE {where_sql} "
                f"ORDER BY COALESCE(o.sort_order, 999) ASC, o.updated_at DESC NULLS LAST "
                f"LIMIT %s OFFSET %s",
                params + [per_page, offset],
            )
        items = [dict(row) for row in cursor.fetchall()]

        for item in items:
            for k in ("date_cloture_prevue", "date_debut_prevu", "date_fin_prevue", "created_at", "updated_at"):
                if item.get(k):
                    item[k] = str(item[k])

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_opportunities error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des opportunites")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/opportunities/{opportunity_id}")
async def get_opportunity(opportunity_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single opportunity by ID with company/contact info."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT o.*, c.nom as company_nom, "
            "ct.prenom as contact_prenom, ct.nom_famille as contact_nom "
            "FROM opportunities o "
            "LEFT JOIN companies c ON o.company_id = c.id "
            "LEFT JOIN contacts ct ON o.contact_id = ct.id "
            "WHERE o.id = %s",
            (opportunity_id,),
        )
        opp = cursor.fetchone()
        if not opp:
            raise HTTPException(status_code=404, detail="Opportunité non trouvée")

        result = dict(opp)
        for k in ("date_cloture_prevue", "created_at", "updated_at"):
            if result.get(k):
                result[k] = str(result[k])

        # Get related interactions
        cursor.execute(
            "SELECT id, type_interaction, resume, details, date_interaction, "
            "suivi_prevu, created_at "
            "FROM interactions WHERE opportunity_id = %s "
            "ORDER BY date_interaction DESC NULLS LAST, created_at DESC",
            (opportunity_id,),
        )
        interactions = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_interaction", "created_at"):
                if d.get(k):
                    d[k] = str(d[k])
            interactions.append(d)

        result["interactions"] = interactions

        # Get related activities
        activities = []
        try:
            cursor.execute(
                "SELECT id, type_activite, sujet, description, date_activite, "
                "duree_minutes, statut, created_at "
                "FROM crm_activities WHERE opportunity_id = %s "
                "ORDER BY date_activite DESC NULLS LAST, created_at DESC",
                (opportunity_id,),
            )
            for row in cursor.fetchall():
                d = dict(row)
                for k in ("date_activite", "created_at"):
                    if d.get(k):
                        d[k] = str(d[k])
                activities.append(d)
        except Exception:
            pass
        result["activities"] = activities

        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_opportunity error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/opportunities")
async def create_opportunity(body: OpportunityCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new opportunity."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if body.statut not in OPPORTUNITY_STATUSES:
        raise HTTPException(status_code=400, detail=f"Statut invalide. Valeurs: {', '.join(OPPORTUNITY_STATUSES)}")

    conn = db.get_conn()
    cursor = None
    try:
        # Disable autocommit for transaction support (SAVEPOINT requires it)
        conn.autocommit = False
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Sync legacy CHECK constraint that used French/capitalized values
        # with the current uppercase ASCII OPPORTUNITY_STATUSES tuple.
        # Schema passe pour la memoization (skip DDL apres 1re sync).
        _ensure_opportunities_statut_check(cursor, user.schema)

        # Ensure numero_opportunite column exists
        cursor.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'opportunities' AND column_name = 'numero_opportunite' "
            "AND table_schema = current_schema()"
        )
        if not cursor.fetchone():
            cursor.execute("ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS numero_opportunite TEXT")

        # Ensure extra columns exist
        for col in ['po_client', 'priorite', 'description', 'date_soumission', 'date_debut_prevu', 'date_fin_prevue', 'client_nom_direct']:
            try:
                cursor.execute("SAVEPOINT add_col")
                cursor.execute(f"ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS {col} TEXT")
                cursor.execute("RELEASE SAVEPOINT add_col")
            except Exception:
                cursor.execute("ROLLBACK TO SAVEPOINT add_col")

        # Generate OPP-XXXXX number
        cursor.execute(
            "SELECT COALESCE(MAX(CAST(SUBSTRING(numero_opportunite FROM '[0-9]+') AS INTEGER)), 0) + 1 as next_num "
            "FROM opportunities WHERE numero_opportunite ~ '[0-9]+'"
        )
        next_num = cursor.fetchone()["next_num"]
        numero = f"OPP-{next_num:05d}"

        cursor.execute(
            "INSERT INTO opportunities (nom, numero_opportunite, company_id, contact_id, montant_estime, "
            "probabilite, statut, date_cloture_prevue, notes, source, "
            "po_client, priorite, description, date_soumission, date_debut_prevu, date_fin_prevue, client_nom_direct, "
            "created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.nom, numero, body.company_id, body.contact_id, body.montant_estime,
             body.probabilite, body.statut, body.date_cloture_prevue,
             body.notes, body.source,
             body.po_client, body.priorite, body.description,
             body.date_soumission, body.date_debut_prevu, body.date_fin_prevue, body.client_nom_direct),
        )
        row = cursor.fetchone()
        opp_id = row["id"]

        # Auto-create a dossier for this opportunity
        dossier_id = None
        cursor.execute("SAVEPOINT dossier_create")
        try:
            # Ensure dossiers table exists
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS dossiers (
                    id SERIAL PRIMARY KEY,
                    numero_dossier VARCHAR(50) UNIQUE NOT NULL,
                    titre TEXT NOT NULL,
                    description TEXT,
                    project_id INTEGER,
                    company_id INTEGER,
                    type_dossier TEXT DEFAULT 'PROJET',
                    statut TEXT DEFAULT 'OUVERT',
                    priorite TEXT DEFAULT 'NORMAL',
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Defensive: tenants legacy ou la table dossiers existait deja
            # avant que les colonnes type_dossier/statut/priorite/notes
            # soient ajoutees au CREATE TABLE — CREATE TABLE IF NOT EXISTS
            # ne met PAS a jour le schema existant. Sans ces ALTER, l'INSERT
            # ci-dessous crashe avec
            # "column notes of relation dossiers does not exist"
            # (1 occurrence/72h vue dans les logs).
            #
            # Chaque ALTER est encadre par un sub-savepoint pour qu'un echec
            # individuel (lock timeout, perm) n'avorte pas le SAVEPOINT
            # dossier_create englobant — sinon les ALTER suivants et
            # l'INSERT plantent tous avec "current transaction is aborted".
            for col_name, col_type in (
                ("type_dossier", "TEXT DEFAULT 'PROJET'"),
                ("statut", "TEXT DEFAULT 'OUVERT'"),
                ("priorite", "TEXT DEFAULT 'NORMAL'"),
                ("notes", "TEXT"),
                ("project_id", "INTEGER"),
                ("company_id", "INTEGER"),
            ):
                sp_col = f"sp_dossiers_col_{col_name}"
                try:
                    cursor.execute(f"SAVEPOINT {sp_col}")
                    cursor.execute(
                        f"ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS {col_name} {col_type}"
                    )
                    cursor.execute(f"RELEASE SAVEPOINT {sp_col}")
                except Exception as alter_exc:
                    try:
                        cursor.execute(f"ROLLBACK TO SAVEPOINT {sp_col}")
                    except Exception:
                        pass
                    logger.warning("dossiers.%s defensive ALTER skipped: %s", col_name, alter_exc)
            cursor.execute(
                "INSERT INTO dossiers (numero_dossier, titre, type_dossier, statut, "
                "company_id, notes, created_at, updated_at) "
                "VALUES (%s, %s, 'CLIENT', 'OUVERT', %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) "
                "RETURNING id",
                (f"DOS-{numero}", f"Dossier {numero} - {body.nom}",
                 body.company_id, f"Dossier auto-cree pour l'opportunite {numero}"),
            )
            dossier_row = cursor.fetchone()
            dossier_id = dossier_row["id"]
            # Link dossier to opportunity
            cursor.execute(
                "ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS dossier_id INTEGER"
            )
            cursor.execute(
                "UPDATE opportunities SET dossier_id = %s WHERE id = %s",
                (dossier_id, opp_id),
            )
        except Exception as dossier_exc:
            cursor.execute("ROLLBACK TO SAVEPOINT dossier_create")
            logger.warning("Auto-create dossier for opportunity failed: %s", dossier_exc)

        conn.commit()
        return {
            "id": opp_id, "numero": numero, "dossierId": dossier_id,
            "message": "Opportunité créée",
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_opportunity error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la création")
    finally:
        if cursor:
            cursor.close()
        try:
            conn.autocommit = True
        except Exception:
            pass
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


class ReorderBody(BaseModel):
    ordered_ids: list[int]


@router.put("/opportunities/reorder")
async def reorder_opportunities(body: ReorderBody, user: ErpUser = Depends(get_current_user)):
    """Reorder opportunities by setting sort_order based on position in list."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0")
        for idx, opp_id in enumerate(body.ordered_ids):
            cursor.execute(
                "UPDATE opportunities SET sort_order = %s WHERE id = %s",
                (idx, opp_id),
            )
        conn.commit()
        return {"message": "Ordre mis à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("reorder_opportunities error: %s", exc)
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


@router.put("/opportunities/{opportunity_id}")
async def update_opportunity(
    opportunity_id: int, body: OpportunityUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update an opportunity."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    ALLOWED_COLS = {"nom", "company_id", "contact_id", "montant_estime",
                     "probabilite", "statut", "date_cloture_prevue",
                     "notes", "source", "client_nom_direct", "po_client",
                     "priorite", "description", "date_soumission",
                     "date_debut_prevu", "date_fin_prevue"}
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ a modifier")

    if "statut" in fields and fields["statut"] not in OPPORTUNITY_STATUSES:
        raise HTTPException(status_code=400, detail=f"Statut invalide. Valeurs: {', '.join(OPPORTUNITY_STATUSES)}")

    conn = db.get_conn()
    cursor = None
    try:
        # Disable autocommit pour la transaction (le helper
        # _ensure_opportunities_statut_check execute des DDL via DO $$
        # qui bloquent en autocommit). Coherence avec create_opportunity.
        conn.autocommit = False
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Sync legacy CHECK constraint avant l'UPDATE (tenant legacy avec
        # valeurs francaises/capitalisees causaient violation sur upper ASCII).
        if "statut" in fields:
            _ensure_opportunities_statut_check(cursor, user.schema)

        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [opportunity_id]

        cursor.execute(
            f"UPDATE opportunities SET {', '.join(set_parts)} WHERE id = %s",
            values,
        )
        conn.commit()
        return {"message": "Opportunité mise à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_opportunity error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise à jour")
    finally:
        if cursor:
            cursor.close()
        try:
            conn.autocommit = True
        except Exception:
            pass
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/opportunities/{opportunity_id}")
async def delete_opportunity(opportunity_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete an opportunity with cascading cleanup on child tables.

    Preserves historical links by SET NULL on devis.opportunity_id and
    projects.opportunity_id (the soumission/projet stays, just detached).
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    # Pool returns connections in AUTOCOMMIT mode — disable for atomic multi-step delete.
    # Without this, each cursor.execute() commits immediately and a mid-operation failure
    # leaves orphan rows (children deleted but parent remains).
    prev_autocommit = conn.autocommit
    try:
        db.set_tenant(conn, user.schema)
        conn.autocommit = False
        cursor = conn.cursor()

        # 1. Check opportunity exists + lock the row (prevents concurrent delete race)
        cursor.execute(
            "SELECT id, nom FROM opportunities WHERE id = %s FOR UPDATE",
            (opportunity_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Opportunité introuvable")
        opp_nom = row["nom"] if isinstance(row, dict) else row[1]

        # 2. Cascade cleanup on child tables (guard information_schema for tenants without them)
        child_tables = (
            "interactions",
            "crm_activities",
            "opportunity_assignations",
            "prospect_qualifications",
        )
        for table in child_tables:
            cursor.execute(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = %s AND table_name = %s",
                (user.schema, table),
            )
            if cursor.fetchone():
                cursor.execute(
                    f"DELETE FROM {table} WHERE opportunity_id = %s",
                    (opportunity_id,),
                )

        # 3. Detach from preserved records (SET NULL on devis, projects, emails)
        for table in ("devis", "projects", "emails"):
            cursor.execute(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = %s AND table_name = %s AND column_name = 'opportunity_id'",
                (user.schema, table),
            )
            if cursor.fetchone():
                cursor.execute(
                    f"UPDATE {table} SET opportunity_id = NULL WHERE opportunity_id = %s",
                    (opportunity_id,),
                )

        # 4. Cleanup Gantt dependencies attached to this opportunity (type 'opp')
        try:
            cursor.execute(
                "DELETE FROM gantt_dependencies "
                "WHERE (source_type = 'opp' AND source_id = %s) "
                "   OR (target_type = 'opp' AND target_id = %s)",
                (str(opportunity_id), str(opportunity_id)),
            )
        except Exception:
            db.set_tenant(conn, user.schema)

        # 5. Delete the opportunity itself
        cursor.execute("DELETE FROM opportunities WHERE id = %s", (opportunity_id,))
        conn.commit()
        logger.info("Opportunity %s (%s) deleted by user %s", opportunity_id, opp_nom, user.user_id)
        return {"message": "Opportunité supprimée", "id": opportunity_id}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        logger.error("delete_opportunity error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression de l'opportunité")
    finally:
        if cursor:
            cursor.close()
        try:
            conn.autocommit = prev_autocommit
        except Exception:
            pass
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# INTERACTIONS ENDPOINTS
# ============================================

@router.get("/interactions")
async def list_interactions(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    company_id: Optional[int] = None,
    opportunity_id: Optional[int] = None,
    type_interaction: Optional[str] = None,
):
    """List interactions with optional filters."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        where_clauses = []
        params = []

        if company_id:
            where_clauses.append("i.company_id = %s")
            params.append(company_id)

        if opportunity_id:
            where_clauses.append("i.opportunity_id = %s")
            params.append(opportunity_id)

        if type_interaction:
            where_clauses.append("i.type_interaction = %s")
            params.append(type_interaction)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        cursor.execute(
            f"SELECT COUNT(*) as total FROM interactions i WHERE {where_sql}", params
        )
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT i.id, i.company_id, i.contact_id, i.opportunity_id, "
            f"i.type_interaction, i.resume, i.details, i.date_interaction, "
            f"i.suivi_prevu, i.created_at, "
            f"c.nom as company_nom, "
            f"o.nom as opportunity_nom "
            f"FROM interactions i "
            f"LEFT JOIN companies c ON i.company_id = c.id "
            f"LEFT JOIN opportunities o ON i.opportunity_id = o.id "
            f"WHERE {where_sql} "
            f"ORDER BY i.date_interaction DESC NULLS LAST, i.created_at DESC "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_interaction", "created_at"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_interactions error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des interactions")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/interactions")
async def create_interaction(body: InteractionCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new interaction."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if body.type_interaction not in INTERACTION_TYPES:
        raise HTTPException(status_code=400, detail=f"Type invalide. Valeurs: {', '.join(INTERACTION_TYPES)}")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "INSERT INTO interactions (company_id, contact_id, opportunity_id, "
            "type_interaction, resume, details, date_interaction, "
            "suivi_prevu, created_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,COALESCE(%s, CURRENT_TIMESTAMP),%s,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.company_id, body.contact_id, body.opportunity_id,
             body.type_interaction, body.resume, body.details,
             body.date_interaction, body.suivi_prevu),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Interaction créée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_interaction error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la création")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# PIPELINE & STATS ENDPOINTS
# ============================================

@router.get("/pipeline")
async def get_pipeline(user: ErpUser = Depends(get_current_user)):
    """Get pipeline stats: count + total amount by status."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT statut, COUNT(*) as count, "
            "COALESCE(SUM(montant_estime), 0) as total_montant, "
            "COALESCE(AVG(probabilite), 0) as avg_probabilite "
            "FROM opportunities "
            "GROUP BY statut "
            "ORDER BY CASE statut "
            "  WHEN 'PROSPECTION' THEN 1 "
            "  WHEN 'QUALIFICATION' THEN 2 "
            "  WHEN 'PROPOSITION' THEN 3 "
            "  WHEN 'NEGOCIATION' THEN 4 "
            "  WHEN 'GAGNE' THEN 5 "
            "  WHEN 'PERDU' THEN 6 "
            "  ELSE 7 END"
        )
        stages = []
        for row in cursor.fetchall():
            d = dict(row)
            d["total_montant"] = float(d["total_montant"])
            d["avg_probabilite"] = float(d["avg_probabilite"])
            stages.append(d)

        return {"stages": stages}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_pipeline error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation du pipeline")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# CRM-DEVIS INTEGRATION
# ============================================

@router.post("/opportunities/{opportunity_id}/create-devis")
async def create_devis_from_opportunity(opportunity_id: int, user: ErpUser = Depends(get_current_user)):
    """Create a devis from an opportunity. Copies client, montant, and links them."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        conn.autocommit = False
        db.set_tenant(conn, user.schema)
        # Make sure the devis table has the columns added by the devis router's
        # defensive migration (in particular `type_soumission`). Without this,
        # a brand-new tenant whose first action is "convert opportunity →
        # devis" would INSERT via this route before `devis.py`'s
        # `_ensure_devis_pct_columns` ever runs, and we'd be relying on
        # columns that don't yet exist.
        from .devis import _ensure_devis_pct_columns as _ensure_devis_cols
        _ensure_devis_cols(conn, user.schema)
        cursor = conn.cursor()

        # Fetch opportunity
        cursor.execute(
            "SELECT id, nom, numero_opportunite, company_id, contact_id, montant_estime, notes, devis_id, dossier_id "
            "FROM opportunities WHERE id = %s",
            (opportunity_id,),
        )
        opp = cursor.fetchone()
        if not opp:
            raise HTTPException(status_code=404, detail="Opportunité non trouvée")

        opp = dict(opp)

        # Check if already converted
        if opp.get("devis_id"):
            raise HTTPException(status_code=400, detail=f"Opportunité déjà convertie en devis #{opp['devis_id']}")

        # Lookup client name from companies
        client_nom_cache = None
        if opp.get("company_id"):
            cursor.execute("SELECT nom FROM companies WHERE id = %s", (opp["company_id"],))
            comp = cursor.fetchone()
            if comp:
                client_nom_cache = comp["nom"]

        # Calculate taxes if montant provided
        montant = opp.get("montant_estime") or 0
        administration = round(montant * 0.03, 2)
        contingences = round(montant * 0.12, 2)
        profit = round(montant * 0.15, 2)
        total_avant_taxes = round(montant + administration + contingences + profit, 2)
        tps = round(total_avant_taxes * 0.05, 2)
        tvq = round(total_avant_taxes * 0.09975, 2)
        total_ttc = round(total_avant_taxes + tps + tvq, 2)

        # Create devis with TEMP numero, then UPDATE with proper format (same as POST /devis)
        token = secrets.token_urlsafe(32)
        year = datetime.now().year
        cursor.execute(
            "INSERT INTO devis (numero_devis, nom_projet, client_company_id, client_contact_id, "
            "client_nom_cache, total_travaux, statut, description, opportunity_id, "
            "administration, contingences, profit, total_avant_taxes, "
            "tps, tvq, investissement_total, "
            "type_soumission, "
            "created_at, updated_at, validation_token) "
            "VALUES ('TEMP', %s, %s, %s, %s, %s, 'Brouillon', %s, %s, "
            "%s, %s, %s, %s, "
            "%s, %s, %s, "
            "'Détaillée', "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, %s) "
            "RETURNING id",
            (f"Devis - {opp['nom']}",
             opp.get("company_id"),
             opp.get("contact_id"),
             client_nom_cache,
             montant,
             opp.get("notes"),
             opportunity_id,
             administration, contingences, profit, total_avant_taxes,
             tps, tvq, total_ttc,
             token),
        )
        devis_row = cursor.fetchone()
        devis_id = devis_row["id"]
        numero = f"DEV-{year}-{devis_id:03d}"
        cursor.execute("UPDATE devis SET numero_devis = %s WHERE id = %s", (numero, devis_id))

        # Update opportunity: link devis_id + change statut to PROPOSITION
        cursor.execute(
            "UPDATE opportunities SET devis_id = %s, statut = 'PROPOSITION', "
            "updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (devis_id, opportunity_id),
        )

        # Link dossier to devis if dossier exists (SAVEPOINT protects main transaction)
        dossier_id = opp.get("dossier_id")
        if dossier_id:
            cursor.execute("SAVEPOINT dossier_devis_link")
            try:
                cursor.execute(
                    "INSERT INTO dossier_devis (dossier_id, devis_id, date_association) "
                    "VALUES (%s, %s, CURRENT_TIMESTAMP) "
                    "ON CONFLICT (dossier_id, devis_id) DO NOTHING",
                    (dossier_id, devis_id),
                )
            except Exception:
                # Table may not exist on old tenants — rollback to SAVEPOINT preserves main transaction
                cursor.execute("ROLLBACK TO SAVEPOINT dossier_devis_link")

        conn.commit()

        return {
            "devis_id": devis_id,
            "devis_numero": numero,
            "opportunity_id": opportunity_id,
            "numero_opportunite": opp.get("numero_opportunite"),
            "message": "Devis créé à partir de l'opportunité, statut mis à jour",
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_devis_from_opportunity error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la création du devis")
    finally:
        try:
            conn.autocommit = True
        except Exception:
            pass
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/stats")
async def get_stats(user: ErpUser = Depends(get_current_user)):
    """Get CRM statistics: conversion rates, top clients, avg time to close."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Total opportunities & conversion rate
        cursor.execute(
            "SELECT COUNT(*) as total, "
            "COUNT(CASE WHEN statut = 'GAGNE' THEN 1 END) as gagnes, "
            "COUNT(CASE WHEN statut = 'PERDU' THEN 1 END) as perdus, "
            "COUNT(CASE WHEN statut NOT IN ('GAGNE','PERDU') THEN 1 END) as en_cours, "
            "COALESCE(SUM(CASE WHEN statut = 'GAGNE' THEN montant_estime END), 0) as montant_gagne, "
            "COALESCE(SUM(CASE WHEN statut NOT IN ('GAGNE','PERDU') THEN montant_estime END), 0) as montant_en_cours "
            "FROM opportunities"
        )
        summary = dict(cursor.fetchone())
        summary["montant_gagne"] = float(summary["montant_gagne"])
        summary["montant_en_cours"] = float(summary["montant_en_cours"])

        total_closed = summary["gagnes"] + summary["perdus"]
        summary["taux_conversion"] = round(
            (summary["gagnes"] / total_closed * 100) if total_closed > 0 else 0, 1
        )

        # Average time to close (GAGNE only)
        cursor.execute(
            "SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400), 0) as avg_jours "
            "FROM opportunities WHERE statut = 'GAGNE'"
        )
        avg_row = cursor.fetchone()
        summary["delai_moyen_jours"] = round(float(avg_row["avg_jours"]), 1)

        # Top clients by revenue (GAGNE)
        cursor.execute(
            "SELECT c.id, c.nom, COUNT(o.id) as nb_opportunites, "
            "COALESCE(SUM(o.montant_estime), 0) as montant_total "
            "FROM opportunities o "
            "JOIN companies c ON o.company_id = c.id "
            "WHERE o.statut = 'GAGNE' "
            "GROUP BY c.id, c.nom "
            "ORDER BY montant_total DESC "
            "LIMIT 10"
        )
        top_clients = []
        for row in cursor.fetchall():
            d = dict(row)
            d["montant_total"] = float(d["montant_total"])
            top_clients.append(d)

        # Recent activity (interactions count last 30 days)
        cursor.execute(
            "SELECT COUNT(*) as interactions_30j "
            "FROM interactions "
            "WHERE created_at >= CURRENT_DATE - make_interval(days => %s)",
            (30,),
        )
        activity = dict(cursor.fetchone())

        return {
            "summary": summary,
            "top_clients": top_clients,
            "activity": activity,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_stats error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des statistiques")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# ACTIVITIES ENDPOINTS
# ============================================

def _ensure_activities_table(cursor):
    """Create crm_activities table if it does not exist."""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS crm_activities (
            id SERIAL PRIMARY KEY,
            type_activite VARCHAR(20) NOT NULL DEFAULT 'NOTE',
            sujet VARCHAR(255) NOT NULL,
            description TEXT,
            date_activite TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            duree_minutes INTEGER,
            company_id INTEGER,
            contact_id INTEGER,
            opportunity_id INTEGER,
            created_by VARCHAR(100),
            statut VARCHAR(20) DEFAULT 'PLANIFIE',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)


@router.get("/activities")
async def list_activities(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """List CRM activities (calls, meetings, emails)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_activities_table(cursor)
        conn.commit()

        cursor.execute("SELECT COUNT(*) as total FROM crm_activities")
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            "SELECT a.id, a.type_activite, a.sujet, a.description, a.date_activite, "
            "a.duree_minutes, a.company_id, a.contact_id, a.opportunity_id, "
            "a.created_by, a.statut, a.created_at, "
            "c.nom as company_nom "
            "FROM crm_activities a "
            "LEFT JOIN companies c ON a.company_id = c.id "
            "ORDER BY a.date_activite DESC NULLS LAST, a.created_at DESC "
            "LIMIT %s OFFSET %s",
            (per_page, offset),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_activite", "created_at"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_activities error: %s", exc)
        return {"items": [], "total": 0, "page": page, "per_page": per_page}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/activities")
async def create_activity(body: ActivityCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new CRM activity."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if body.type_activite not in ACTIVITY_TYPES:
        raise HTTPException(status_code=400, detail=f"Type invalide. Valeurs: {', '.join(ACTIVITY_TYPES)}")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_activities_table(cursor)

        cursor.execute(
            "INSERT INTO crm_activities (type_activite, sujet, description, "
            "date_activite, duree_minutes, company_id, contact_id, opportunity_id, "
            "created_by, statut, created_at) "
            "VALUES (%s, %s, %s, COALESCE(%s, CURRENT_TIMESTAMP), %s, %s, %s, %s, %s, 'PLANIFIE', CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.type_activite, body.sujet, body.description,
             body.date_activite, body.duree_minutes,
             body.company_id, body.contact_id, body.opportunity_id,
             # `created_by` may be INTEGER or TEXT depending on the tenant
             # schema (CREATE TABLE says VARCHAR but some legacy tenants have
             # INTEGER). `str(...)` sends the value as a PG `unknown` literal
             # that casts cleanly into both column types.
             str(user.user_id)),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Activité créée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_activity error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la création de l'activite")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# CALENDAR ENDPOINT
# ============================================

@router.get("/calendar")
async def get_crm_calendar(
    user: ErpUser = Depends(get_current_user),
    year: int = Query(...),
    month: int = Query(...),
):
    """Get CRM events for calendar display."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    # Compute month boundaries
    start_date = f"{year}-{month:02d}-01"
    last_day = calendar.monthrange(year, month)[1]
    end_date = f"{year}-{month:02d}-{last_day:02d}"

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        events = []

        # 1) Interactions in the month
        cursor.execute(
            "SELECT id, type_interaction, resume, date_interaction "
            "FROM interactions "
            "WHERE date_interaction::date BETWEEN %s AND %s "
            "ORDER BY date_interaction",
            (start_date, end_date),
        )
        for row in cursor.fetchall():
            d = dict(row)
            events.append({
                "type": "interaction",
                "title": d["resume"] or "Interaction",
                "date": str(d["date_interaction"]),
                "source_id": d["id"],
                "sous_type": d["type_interaction"],
            })

        # 2) Activities in the month
        try:
            _ensure_activities_table(cursor)
            conn.commit()
            cursor.execute(
                "SELECT id, type_activite, sujet, date_activite "
                "FROM crm_activities "
                "WHERE date_activite::date BETWEEN %s AND %s "
                "ORDER BY date_activite",
                (start_date, end_date),
            )
            for row in cursor.fetchall():
                d = dict(row)
                events.append({
                    "type": "activite",
                    "title": d["sujet"] or "Activite",
                    "date": str(d["date_activite"]),
                    "source_id": d["id"],
                    "sous_type": d["type_activite"],
                })
        except Exception:
            pass  # table may not exist yet

        # 3) Opportunities closing in the month
        cursor.execute(
            "SELECT id, nom, date_cloture_prevue "
            "FROM opportunities "
            "WHERE date_cloture_prevue::date BETWEEN %s AND %s",
            (start_date, end_date),
        )
        for row in cursor.fetchall():
            d = dict(row)
            events.append({
                "type": "opportunite",
                "title": f"Cloture: {d['nom']}",
                "date": str(d["date_cloture_prevue"]),
                "source_id": d["id"],
                "sous_type": "CLOTURE",
            })

        return {"events": events}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_crm_calendar error: %s", exc)
        return {"events": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# TIMELINE ENDPOINT
# ============================================

@router.get("/timeline")
async def get_crm_timeline(
    user: ErpUser = Depends(get_current_user),
    company_id: Optional[int] = None,
    limit: int = Query(50, ge=1, le=200),
):
    """Get chronological timeline of CRM activities."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        where_interaction = "TRUE"
        where_activity = "TRUE"
        params_interaction = []
        params_activity = []

        if company_id:
            where_interaction = "i.company_id = %s"
            params_interaction = [company_id]
            where_activity = "a.company_id = %s"
            params_activity = [company_id]

        # Build UNION query
        parts = []

        # Interactions
        parts.append(
            f"SELECT 'interaction' as type, i.id, i.resume as titre, "
            f"i.date_interaction as date, i.type_interaction as sous_type, "
            f"i.company_id, c.nom as company_nom "
            f"FROM interactions i "
            f"LEFT JOIN companies c ON i.company_id = c.id "
            f"WHERE {where_interaction}"
        )

        # Activities (try/except for table existence)
        has_activities = False
        try:
            _ensure_activities_table(cursor)
            conn.commit()
            has_activities = True
        except Exception:
            pass

        if has_activities:
            parts.append(
                f"SELECT 'activite' as type, a.id, a.sujet as titre, "
                f"a.date_activite as date, a.type_activite as sous_type, "
                f"a.company_id, c.nom as company_nom "
                f"FROM crm_activities a "
                f"LEFT JOIN companies c ON a.company_id = c.id "
                f"WHERE {where_activity}"
            )

        union_sql = " UNION ALL ".join(parts)
        full_sql = f"SELECT * FROM ({union_sql}) combined ORDER BY date DESC NULLS LAST LIMIT %s"

        all_params = params_interaction
        if has_activities:
            all_params = all_params + params_activity
        all_params.append(limit)

        cursor.execute(full_sql, all_params)
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("date"):
                d["date"] = str(d["date"])
            items.append(d)

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_crm_timeline error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# QUALIFICATION (LEAD SCORING) ENDPOINT
# ============================================

@router.get("/qualification")
async def get_qualifications(user: ErpUser = Depends(get_current_user)):
    """Get lead qualification scores for opportunities."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Fetch open opportunities (not GAGNE/PERDU)
        cursor.execute(
            "SELECT o.id, o.nom, o.company_id, o.contact_id, o.montant_estime, "
            "o.probabilite, o.source, o.statut, o.updated_at, o.created_at, "
            "c.nom as company_nom "
            "FROM opportunities o "
            "LEFT JOIN companies c ON o.company_id = c.id "
            "WHERE o.statut NOT IN ('GAGNE', 'PERDU') "
            "ORDER BY o.updated_at DESC NULLS LAST"
        )
        opportunities = [dict(row) for row in cursor.fetchall()]

        # Get interaction counts per opportunity
        cursor.execute(
            "SELECT opportunity_id, COUNT(*) as cnt "
            "FROM interactions "
            "WHERE opportunity_id IS NOT NULL "
            "GROUP BY opportunity_id"
        )
        interaction_counts = {row["opportunity_id"]: row["cnt"] for row in cursor.fetchall()}

        now = datetime.utcnow()
        items = []
        for opp in opportunities:
            score = 0
            details = []

            # Has montant_estime > 0: +20
            if opp.get("montant_estime") and opp["montant_estime"] > 0:
                score += 20
                details.append("Montant estime (+20)")

            # Has company_id: +15
            if opp.get("company_id"):
                score += 15
                details.append("Entreprise liee (+15)")

            # Has contact_id: +10
            if opp.get("contact_id"):
                score += 10
                details.append("Contact lie (+10)")

            # probabilite > 50: +20
            if opp.get("probabilite") and opp["probabilite"] > 50:
                score += 20
                details.append(f"Probabilite {opp['probabilite']}% (+20)")

            # Has interactions: +15
            opp_interactions = interaction_counts.get(opp["id"], 0)
            if opp_interactions > 0:
                score += 15
                details.append(f"{opp_interactions} interaction(s) (+15)")

            # Source is not null: +10
            if opp.get("source"):
                score += 10
                details.append("Source identifiee (+10)")

            # Not stale (updated < 30 days): +10
            updated = opp.get("updated_at") or opp.get("created_at")
            if updated:
                try:
                    if isinstance(updated, str):
                        updated = datetime.fromisoformat(updated.replace('Z', '+00:00').replace('+00:00', ''))
                    days_since = (now - updated).days
                    if days_since < 30:
                        score += 10
                        details.append("Mise a jour recente (+10)")
                    else:
                        details.append(f"Inactif depuis {days_since}j")
                except Exception:
                    pass

            # Categorize
            if score >= 70:
                categorie = "HOT"
            elif score >= 40:
                categorie = "WARM"
            else:
                categorie = "COLD"

            items.append({
                "opportunity_id": opp["id"],
                "nom": opp["nom"],
                "company_nom": opp.get("company_nom"),
                "montant_estime": float(opp["montant_estime"]) if opp.get("montant_estime") else None,
                "probabilite": opp.get("probabilite"),
                "statut": opp.get("statut"),
                "score": score,
                "categorie": categorie,
                "details": details,
            })

        # Sort by score descending
        items.sort(key=lambda x: x["score"], reverse=True)

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_qualifications error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# B.A.T. QUALIFICATION (Grille de pointage)
# ============================================

class BATQualificationCreate(BaseModel):
    opportunity_id: int
    score_budget: int = 0
    score_autorite: int = 0
    score_timing: int = 0
    score_compatibilite: int = 0
    score_total: int = 0
    categorie: str = "C"
    reponses_grille: Optional[dict] = None
    notes_qualification: Optional[str] = None


def _ensure_qualification_table(cursor):
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS prospect_qualifications (
            id SERIAL PRIMARY KEY,
            opportunity_id INTEGER NOT NULL,
            score_budget INTEGER DEFAULT 0,
            score_autorite INTEGER DEFAULT 0,
            score_timing INTEGER DEFAULT 0,
            score_compatibilite INTEGER DEFAULT 0,
            score_total INTEGER DEFAULT 0,
            categorie TEXT DEFAULT 'C',
            reponses_grille JSONB DEFAULT '{}',
            notes_qualification TEXT,
            qualifie_par INTEGER,
            statut TEXT DEFAULT 'COMPLETE',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)


@router.get("/qualification/bat/all")
async def get_all_bat_qualifications(user: ErpUser = Depends(get_current_user)):
    """Get all B.A.T. qualifications (batch)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_qualification_table(cursor)
        cursor.execute(
            "SELECT opportunity_id, score_budget, score_autorite, score_timing, "
            "score_compatibilite, score_total, categorie "
            "FROM prospect_qualifications ORDER BY updated_at DESC"
        )
        items = {}
        for row in cursor.fetchall():
            d = dict(row)
            opp_id = d["opportunity_id"]
            if opp_id not in items:
                items[opp_id] = {
                    "scoreTotal": d["score_total"],
                    "categorie": d["categorie"],
                    "scoreBudget": d["score_budget"],
                    "scoreAutorite": d["score_autorite"],
                    "scoreTiming": d["score_timing"],
                    "scoreCompatibilite": d["score_compatibilite"],
                }
        return {"scores": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_all_bat_qualifications error: %s", exc)
        return {"scores": {}}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/qualification/bat/{opportunity_id}")
async def get_bat_qualification(opportunity_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_qualification_table(cursor)
        cursor.execute(
            "SELECT * FROM prospect_qualifications "
            "WHERE opportunity_id = %s ORDER BY updated_at DESC LIMIT 1",
            (opportunity_id,),
        )
        row = cursor.fetchone()
        if not row:
            return {"exists": False}
        d = dict(row)
        for k in ("created_at", "updated_at"):
            if d.get(k):
                d[k] = str(d[k])
        d["exists"] = True
        return d
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_bat_qualification error: %s", exc)
        return {"exists": False}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/qualification/bat")
async def save_bat_qualification(body: BATQualificationCreate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_qualification_table(cursor)

        import json
        reponses_json = json.dumps(body.reponses_grille) if body.reponses_grille else '{}'

        cursor.execute(
            "SELECT id FROM prospect_qualifications WHERE opportunity_id = %s",
            (body.opportunity_id,),
        )
        existing = cursor.fetchone()

        if existing:
            cursor.execute(
                "UPDATE prospect_qualifications SET "
                "score_budget=%s, score_autorite=%s, score_timing=%s, "
                "score_compatibilite=%s, score_total=%s, categorie=%s, "
                "reponses_grille=%s::jsonb, notes_qualification=%s, "
                "qualifie_par=%s, statut='COMPLETE', updated_at=CURRENT_TIMESTAMP "
                "WHERE opportunity_id=%s",
                (body.score_budget, body.score_autorite, body.score_timing,
                 body.score_compatibilite, body.score_total, body.categorie,
                 reponses_json, body.notes_qualification,
                 str(user.user_id), body.opportunity_id),
            )
            qual_id = existing["id"]
        else:
            cursor.execute(
                "INSERT INTO prospect_qualifications "
                "(opportunity_id, score_budget, score_autorite, score_timing, "
                "score_compatibilite, score_total, categorie, "
                "reponses_grille, notes_qualification, qualifie_par, statut, "
                "created_at, updated_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,'COMPLETE',"
                "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id",
                (body.opportunity_id, body.score_budget, body.score_autorite,
                 body.score_timing, body.score_compatibilite, body.score_total,
                 body.categorie, reponses_json, body.notes_qualification,
                 str(user.user_id)),
            )
            qual_id = cursor.fetchone()["id"]

        conn.commit()
        return {
            "id": qual_id,
            "score_total": body.score_total,
            "categorie": body.categorie,
            "message": "Qualification enregistree",
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("save_bat_qualification error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la sauvegarde")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# OPPORTUNITY ASSIGNATIONS
# ============================================

_OPP_ASSIGN_DDL = (
    "CREATE TABLE IF NOT EXISTS opportunity_assignations ("
    "id SERIAL PRIMARY KEY, "
    "opportunity_id INT NOT NULL, "
    "employee_id INT NOT NULL, "
    "role VARCHAR(100), "
    "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
    "UNIQUE(opportunity_id, employee_id))"
)


@router.get("/opportunities/{opp_id}/assignations")
async def list_opportunity_assignations(opp_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(_OPP_ASSIGN_DDL)
        cursor.execute(
            "SELECT oa.id, oa.opportunity_id, oa.employee_id, oa.role, oa.created_at, "
            "e.prenom || ' ' || e.nom AS employe_nom "
            "FROM opportunity_assignations oa "
            "LEFT JOIN employees e ON e.id = oa.employee_id "
            "WHERE oa.opportunity_id = %s ORDER BY oa.created_at",
            (opp_id,),
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
        logger.error("list_opportunity_assignations error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/opportunities/{opp_id}/assignations")
async def add_opportunity_assignation(opp_id: int, body: OpportunityAssignationCreate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(_OPP_ASSIGN_DDL)
        cursor.execute(
            "SELECT id FROM opportunity_assignations WHERE opportunity_id = %s AND employee_id = %s",
            (opp_id, body.employee_id),
        )
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail="Employe deja assigne")
        cursor.execute(
            "INSERT INTO opportunity_assignations (opportunity_id, employee_id, role, created_at) "
            "VALUES (%s, %s, %s, CURRENT_TIMESTAMP) RETURNING id",
            (opp_id, body.employee_id, body.role),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Employe assigne a l'opportunite"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("add_opportunity_assignation error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/opportunities/{opp_id}/assignations/{assignation_id}")
async def remove_opportunity_assignation(opp_id: int, assignation_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM opportunity_assignations WHERE id = %s AND opportunity_id = %s",
            (assignation_id, opp_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Assignation non trouvee")
        conn.commit()
        return {"message": "Assignation supprimee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("remove_opportunity_assignation error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()
