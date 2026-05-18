"""
ERP React - B2B / C2B Portal Router
Complete B2B module: clients, demandes, soumissions, contrats, commandes,
catalogue, panier, favoris, messages, notifications, stats.
Tables: b2b_clients, b2b_demandes, b2b_soumissions, b2b_contrats,
        b2b_commandes, b2b_commande_lignes, b2b_paniers, b2b_panier_lignes,
        b2b_favoris, b2b_messages, b2b_notifications
"""

import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator


def _empty_to_none(v):
    """Convert empty strings to None — used on date fields to avoid PostgreSQL
    'invalid input syntax for type date: ""' errors when frontend sends blank dates."""
    return None if isinstance(v, str) and v.strip() == "" else v
from typing import Optional

from ..erp_auth import get_current_user, require_role, ErpUser
from .. import erp_database as db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/b2b", tags=["B2B Portal"])

TPS_RATE = 0.05
TVQ_RATE = 0.09975

DEMANDE_STATUTS = ("NOUVELLE", "EN_COURS", "SOUMISE", "ACCEPTEE", "REFUSEE", "ANNULEE")
CONTRAT_STATUTS = ("BROUILLON", "ACTIF", "EN_COURS", "TERMINE", "ANNULE", "SUSPENDU")
COMMANDE_STATUTS = ("EN_ATTENTE", "CONFIRMEE", "EN_PREPARATION", "EXPEDIEE", "LIVREE", "ANNULEE")
SOUMISSION_STATUTS = ("BROUILLON", "SOUMISE", "EN_EVALUATION", "ACCEPTEE", "REFUSEE", "EXPIREE")


# ============================================
# PYDANTIC MODELS
# ============================================

class B2bClientCreate(BaseModel):
    nom: str
    email: Optional[str] = None
    telephone: Optional[str] = None
    adresse: Optional[str] = None
    ville: Optional[str] = None
    province: Optional[str] = "Quebec"
    code_postal: Optional[str] = None
    contact_nom: Optional[str] = None
    secteur: Optional[str] = None


class B2bClientUpdate(BaseModel):
    nom: Optional[str] = None
    email: Optional[str] = None
    telephone: Optional[str] = None
    adresse: Optional[str] = None
    ville: Optional[str] = None
    province: Optional[str] = None
    code_postal: Optional[str] = None
    contact_nom: Optional[str] = None
    secteur: Optional[str] = None
    active: Optional[bool] = None


class B2bDemandeCreate(BaseModel):
    client_id: int
    titre: str
    description: Optional[str] = None
    categorie: Optional[str] = None
    budget_estime: Optional[float] = None
    date_limite: Optional[str] = None
    priorite: Optional[str] = "normale"
    adresse_chantier: Optional[str] = None
    ville_chantier: Optional[str] = None

    @field_validator("date_limite", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class B2bDemandeUpdate(BaseModel):
    titre: Optional[str] = None
    description: Optional[str] = None
    categorie: Optional[str] = None
    budget_estime: Optional[float] = None
    date_limite: Optional[str] = None
    statut: Optional[str] = None
    priorite: Optional[str] = None
    notes_internes: Optional[str] = None

    @field_validator("date_limite", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class B2bSoumissionCreate(BaseModel):
    demande_id: int
    montant_total: Optional[float] = None
    montant_ht: Optional[float] = None
    description: Optional[str] = None
    delai_execution_jours: Optional[int] = None
    conditions_paiement: Optional[str] = None
    garanties: Optional[str] = None
    notes: Optional[str] = None
    validite_jours: Optional[int] = 30


class B2bSoumissionUpdate(BaseModel):
    montant_total: Optional[float] = None
    montant_ht: Optional[float] = None
    description: Optional[str] = None
    delai_execution_jours: Optional[int] = None
    conditions_paiement: Optional[str] = None
    garanties: Optional[str] = None
    notes: Optional[str] = None
    statut: Optional[str] = None
    note_evaluation: Optional[int] = None
    commentaires_evaluation: Optional[str] = None


class B2bContratUpdate(BaseModel):
    titre: Optional[str] = None
    statut: Optional[str] = None
    conditions_paiement: Optional[str] = None
    date_debut: Optional[str] = None
    date_fin_prevue: Optional[str] = None
    date_fin_reelle: Optional[str] = None
    avancement_pourcentage: Optional[float] = None
    montant_paye: Optional[float] = None
    notes_internes: Optional[str] = None

    @field_validator("date_debut", "date_fin_prevue", "date_fin_reelle", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class B2bMessageCreate(BaseModel):
    demande_id: Optional[int] = None
    contrat_id: Optional[int] = None
    message: str
    sujet: Optional[str] = None


class B2bPanierItemCreate(BaseModel):
    produit_id: int
    quantite: int = 1


class B2bCommandeCreate(BaseModel):
    adresse_livraison: Optional[str] = None
    ville_livraison: Optional[str] = None
    province_livraison: Optional[str] = "Quebec"
    code_postal_livraison: Optional[str] = None
    notes_client: Optional[str] = None


# ============================================
# ENSURE TABLES
# ============================================

# Memoization: skip defensive ALTERs on `produits` table once we've run them
# for a given tenant schema. Only populated after ALL ALTERs succeed so that
# a partial failure doesn't mask missing columns on subsequent calls.
_produits_cols_ensured: set[str] = set()


def _ensure_produits_columns(cursor, schema: str) -> None:
    """Defensive ALTERs so SELECTs on `produits` don't crash on older tenant schemas."""
    if schema in _produits_cols_ensured:
        return
    all_ok = True
    # FIX P0: stock_disponible doit etre NUMERIC(15,2) pour matcher la
    # definition canonique dans erp_database.py (sinon perte de precision
    # decimale sur tenants legacy si on saisit 1.5 unite via b2b alors que
    # inventory.py traite des Decimal — divergence silencieuse).
    for col_name, col_type in (
        ("nom", "TEXT"),
        ("code_produit", "TEXT"),
        ("description", "TEXT"),
        ("categorie", "TEXT"),
        ("unite", "TEXT"),
        ("prix_unitaire", "NUMERIC(15,2)"),
        ("stock_disponible", "NUMERIC(15,2)"),
        ("active", "BOOLEAN DEFAULT TRUE"),
    ):
        try:
            cursor.execute(
                f"ALTER TABLE produits ADD COLUMN IF NOT EXISTS {col_name} {col_type}"
            )
        except Exception as exc:
            logger.warning("defensive ALTER produits.%s failed: %s", col_name, exc)
            all_ok = False

    # FIX P0 (suite): ADD COLUMN IF NOT EXISTS NE migre PAS le type d'une
    # colonne existante. Les tenants legacy peuvent avoir stock_disponible
    # INTEGER ou prix_unitaire NUMERIC(14,2). On force la migration vers
    # NUMERIC(15,2) avec USING cast (idempotent — meme type = no-op).
    for col_name in ("stock_disponible", "prix_unitaire"):
        try:
            cursor.execute(
                f"ALTER TABLE produits ALTER COLUMN {col_name} TYPE NUMERIC(15,2) "
                f"USING {col_name}::numeric"
            )
        except Exception as exc:
            # Non-bloquant: si le tenant n'a pas la colonne ou un autre conflit,
            # on garde la version compatible (ADD COLUMN au-dessus a deja gere
            # le cas absente).
            logger.warning("defensive ALTER COLUMN produits.%s TYPE failed: %s", col_name, exc)
            all_ok = False

    if all_ok:
        _produits_cols_ensured.add(schema)


def _ensure_b2b_tables(cursor):
    """Create B2B tables if they don't exist (defensive, per-tenant).

    Les SAVEPOINT plus bas (autour des CREATE INDEX safe_indexes) exigent un
    bloc transactionnel. psycopg2 pool peut retourner des connexions en
    autocommit=True (lecon #122) — dans ce mode SAVEPOINT echoue avec
    "SAVEPOINT can only be used in transaction blocks" et casse les endpoints
    get_b2b_stats, b2b_client_login, list_b2b_*, etc.

    On bascule temporairement en autocommit=False, on commit les DDL a la fin,
    et on restaure l'etat d'origine pour ne pas polluer le pool psycopg2.
    """
    conn = cursor.connection
    prev_autocommit = None
    try:
        prev_autocommit = conn.autocommit
    except Exception:
        pass

    try:
        if prev_autocommit:
            try:
                conn.autocommit = False
            except Exception:
                pass

        _run_b2b_tables_ddl(cursor)

        try:
            conn.commit()
        except Exception as commit_exc:
            try:
                conn.rollback()
            except Exception as rollback_exc:
                logger.error(
                    "b2b: commit AND rollback failed. "
                    "commit=%s | rollback=%s",
                    commit_exc, rollback_exc,
                )
            raise
    finally:
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception as restore_exc:
                logger.warning(
                    "b2b: restore conn.autocommit=%s failed: %s",
                    prev_autocommit, restore_exc,
                )


def _run_b2b_tables_ddl(cursor):
    """Body interne de _ensure_b2b_tables. Extrait pour permettre l'encadrement
    autocommit/commit/restore sans reecrire toute la logique DDL."""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS b2b_clients (
            id SERIAL PRIMARY KEY,
            company_id INTEGER,
            nom TEXT NOT NULL,
            email TEXT,
            telephone TEXT,
            adresse TEXT,
            ville TEXT,
            province TEXT DEFAULT 'Quebec',
            code_postal TEXT,
            contact_nom TEXT,
            secteur TEXT,
            active BOOLEAN DEFAULT TRUE,
            date_inscription TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Defensive migration: legacy tenant schemas may pre-date several columns
    # added to the CREATE TABLE above. ADD COLUMN IF NOT EXISTS is a no-op
    # on tenants where the table already has the column.
    for col_name, col_type in (
        ("company_id", "INTEGER"),
        ("email", "TEXT"),
        ("telephone", "TEXT"),
        ("adresse", "TEXT"),
        ("ville", "TEXT"),
        ("province", "TEXT DEFAULT 'Quebec'"),
        ("code_postal", "TEXT"),
        ("contact_nom", "TEXT"),
        ("secteur", "TEXT"),
        ("active", "BOOLEAN DEFAULT TRUE"),
        ("date_inscription", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
    ):
        try:
            cursor.execute(f"ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS {col_name} {col_type}")
        except Exception as exc:
            logger.warning("defensive ALTER b2b_clients.%s failed: %s", col_name, exc)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS b2b_demandes (
            id SERIAL PRIMARY KEY,
            company_id INTEGER,
            client_id INTEGER REFERENCES b2b_clients(id),
            titre TEXT NOT NULL,
            description TEXT,
            categorie TEXT,
            budget_estime NUMERIC(15,2),
            date_limite DATE,
            statut TEXT DEFAULT 'NOUVELLE',
            priorite TEXT DEFAULT 'normale',
            adresse_chantier TEXT,
            ville_chantier TEXT,
            notes_internes TEXT,
            nombre_soumissions INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS b2b_soumissions (
            id SERIAL PRIMARY KEY,
            demande_id INTEGER REFERENCES b2b_demandes(id),
            montant_total NUMERIC(15,2),
            montant_ht NUMERIC(15,2),
            montant_taxes NUMERIC(15,2),
            description TEXT,
            delai_execution_jours INTEGER,
            conditions_paiement TEXT,
            garanties TEXT,
            notes TEXT,
            statut TEXT DEFAULT 'BROUILLON',
            validite_jours INTEGER DEFAULT 30,
            date_expiration DATE,
            note_evaluation INTEGER,
            commentaires_evaluation TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS b2b_contrats (
            id SERIAL PRIMARY KEY,
            soumission_id INTEGER,
            demande_id INTEGER,
            client_company_id INTEGER,
            numero_contrat TEXT,
            titre TEXT,
            montant NUMERIC(15,2),
            montant_paye NUMERIC(15,2) DEFAULT 0,
            statut TEXT DEFAULT 'BROUILLON',
            date_debut DATE,
            date_fin_prevue DATE,
            date_fin_reelle DATE,
            date_signature DATE,
            conditions_paiement TEXT,
            avancement_pourcentage REAL DEFAULT 0,
            notes_internes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS b2b_messages (
            id SERIAL PRIMARY KEY,
            demande_id INTEGER,
            contrat_id INTEGER,
            sender_user_id INTEGER,
            sender_company_id INTEGER,
            message TEXT NOT NULL,
            sujet TEXT,
            lu BOOLEAN DEFAULT FALSE,
            date_lecture TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS b2b_commandes (
            id SERIAL PRIMARY KEY,
            numero TEXT,
            client_company_id INTEGER,
            adresse_livraison TEXT,
            ville_livraison TEXT,
            province_livraison TEXT DEFAULT 'Quebec',
            code_postal_livraison TEXT,
            sous_total NUMERIC(15,2) DEFAULT 0,
            tps NUMERIC(15,2) DEFAULT 0,
            tvq NUMERIC(15,2) DEFAULT 0,
            total_ttc NUMERIC(15,2) DEFAULT 0,
            statut TEXT DEFAULT 'EN_ATTENTE',
            statut_paiement TEXT DEFAULT 'NON_PAYE',
            notes_client TEXT,
            notes_internes TEXT,
            date_commande TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            date_livraison_estimee DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS b2b_commande_lignes (
            id SERIAL PRIMARY KEY,
            commande_id INTEGER REFERENCES b2b_commandes(id) ON DELETE CASCADE,
            produit_id INTEGER,
            code_produit TEXT,
            nom_produit TEXT,
            description TEXT,
            quantite INTEGER DEFAULT 1,
            unite TEXT DEFAULT 'unite',
            prix_unitaire NUMERIC(15,2),
            montant_ligne NUMERIC(15,2),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS b2b_paniers (
            id SERIAL PRIMARY KEY,
            client_company_id INTEGER,
            user_id INTEGER,
            statut TEXT DEFAULT 'actif',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS b2b_panier_lignes (
            id SERIAL PRIMARY KEY,
            panier_id INTEGER REFERENCES b2b_paniers(id) ON DELETE CASCADE,
            produit_id INTEGER,
            quantite INTEGER DEFAULT 1,
            prix_unitaire NUMERIC(15,2),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS b2b_favoris (
            id SERIAL PRIMARY KEY,
            client_company_id INTEGER,
            user_id INTEGER,
            produit_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Aligne avec le schema canonique de erp_database.py:6138-6154 (init
    # principale). Les colonnes type_notification / lien_page / priorite / lue
    # sont obligatoires pour l'INSERT depuis routers/auth.py:610 (b2b client
    # register). Les ALTER defensifs plus bas backportent ces colonnes pour
    # les tenants v7/v8 qui auraient ete crees avec l'ancien schema (`type`,
    # `lu`, sans lien_page/priorite).
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS b2b_notifications (
            id SERIAL PRIMARY KEY,
            company_id INTEGER,
            user_id INTEGER,
            type_notification TEXT,
            titre TEXT,
            message TEXT,
            lien_page TEXT,
            lien_id INTEGER,
            priorite TEXT DEFAULT 'normale',
            lue BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS b2b_client_users (
            id SERIAL PRIMARY KEY,
            client_id INTEGER NOT NULL REFERENCES b2b_clients(id) ON DELETE CASCADE,
            email TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            nom TEXT,
            telephone TEXT,
            active BOOLEAN DEFAULT TRUE,
            last_login TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Defensive migrations — columns added after initial CREATE TABLE
    # (CREATE TABLE IF NOT EXISTS ne met pas a jour le schema existant, donc
    # les tenants crees avant ces ajouts n'ont pas les colonnes)
    defensive_migrations = [
        ("b2b_demandes", "client_id", "INTEGER"),
        ("b2b_paniers", "user_id", "INTEGER"),
        ("b2b_paniers", "client_company_id", "INTEGER"),
        ("b2b_favoris", "user_id", "INTEGER"),
        ("b2b_favoris", "client_company_id", "INTEGER"),
        ("b2b_favoris", "produit_id", "INTEGER"),
        ("b2b_notifications", "user_id", "INTEGER"),
        ("b2b_notifications", "company_id", "INTEGER"),
        # Backport canonical schema columns for v7/v8 legacy tenants
        # (creees avec `type` / `lu` / sans lien_page / sans priorite).
        # ALTER IF NOT EXISTS = no-op si la colonne existe deja (init principal
        # ou nouveaux tenants qui passent par le CREATE TABLE updated ci-dessus).
        ("b2b_notifications", "type_notification", "TEXT"),
        ("b2b_notifications", "lien_page", "TEXT"),
        ("b2b_notifications", "priorite", "TEXT DEFAULT 'normale'"),
        ("b2b_notifications", "lue", "BOOLEAN DEFAULT FALSE"),
        ("b2b_messages", "contrat_id", "INTEGER"),
        ("b2b_messages", "demande_id", "INTEGER"),
        ("b2b_contrats", "client_company_id", "INTEGER"),
        ("b2b_client_users", "active", "BOOLEAN DEFAULT TRUE"),
        ("b2b_client_users", "last_login", "TIMESTAMP"),
    ]
    for table, col, coltype in defensive_migrations:
        try:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {coltype}")
        except Exception as exc:
            logger.warning("ALTER %s ADD %s failed: %s", table, col, exc)
    # Indexes (apres ALTER pour garantir que les colonnes existent)
    safe_indexes = [
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_b2b_client_users_email ON b2b_client_users(LOWER(email))",
        "CREATE INDEX IF NOT EXISTS idx_b2b_client_users_client ON b2b_client_users(client_id)",
        "CREATE INDEX IF NOT EXISTS idx_b2b_demandes_statut ON b2b_demandes(statut)",
        "CREATE INDEX IF NOT EXISTS idx_b2b_demandes_client ON b2b_demandes(client_id)",
        "CREATE INDEX IF NOT EXISTS idx_b2b_soumissions_demande ON b2b_soumissions(demande_id)",
        "CREATE INDEX IF NOT EXISTS idx_b2b_contrats_statut ON b2b_contrats(statut)",
        "CREATE INDEX IF NOT EXISTS idx_b2b_commandes_statut ON b2b_commandes(statut)",
        "CREATE INDEX IF NOT EXISTS idx_b2b_messages_demande ON b2b_messages(demande_id)",
        "CREATE INDEX IF NOT EXISTS idx_b2b_paniers_user ON b2b_paniers(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_b2b_favoris_user ON b2b_favoris(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_b2b_messages_contrat ON b2b_messages(contrat_id)",
        "CREATE INDEX IF NOT EXISTS idx_b2b_contrats_client ON b2b_contrats(client_company_id)",
    ]
    # Wrap each CREATE INDEX in a SAVEPOINT so a concurrent pg_class
    # collision (pg_class_relname_nsp_index race on fresh tenant) does not
    # abort the outer transaction — subsequent queries in this handler
    # would otherwise crash with "current transaction is aborted".
    for idx_sql in safe_indexes:
        sp = f"sp_b2b_idx_{abs(hash(idx_sql)) % 1000000}"
        cursor.execute(f"SAVEPOINT {sp}")
        try:
            cursor.execute(idx_sql)
            cursor.execute(f"RELEASE SAVEPOINT {sp}")
        except Exception as exc:
            try:
                cursor.execute(f"ROLLBACK TO SAVEPOINT {sp}")
            except Exception:
                pass
            _msg = str(exc).lower()
            if not any(tok in _msg for tok in ("duplicate key", "pg_class_relname", "already exists")):
                logger.warning("CREATE INDEX failed: %s (%s)", idx_sql[:80], exc)
                continue
            logger.warning("CREATE INDEX race: %s (%s)", idx_sql[:80], exc)


def _serialize_row(row, date_keys=None, decimal_keys=None):
    """Convert a DB row dict for JSON response."""
    d = dict(row)
    for k in (date_keys or []):
        if d.get(k):
            d[k] = str(d[k])
    for k in (decimal_keys or []):
        if d.get(k) is not None:
            d[k] = float(d[k])
    return d


DATE_KEYS = ("created_at", "updated_at", "date_limite", "date_debut",
             "date_fin_prevue", "date_fin_reelle", "date_signature", "date_commande",
             "date_livraison_estimee", "date_expiration", "date_inscription",
             "date_lecture")
DECIMAL_KEYS = ("budget_estime", "montant_total", "montant_ht", "montant_taxes",
                "montant", "montant_paye", "sous_total", "tps", "tvq", "total_ttc",
                "prix_unitaire", "montant_ligne", "avancement_pourcentage")


# ============================================
# STATS / DASHBOARD
# ============================================

@router.get("/stats")
async def get_b2b_stats(user: ErpUser = Depends(get_current_user)):
    """B2B dashboard statistics."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        stats = {}
        # Clients
        cursor.execute("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE active = TRUE) as actifs FROM b2b_clients")
        r = cursor.fetchone()
        stats["clients_total"] = r["total"]
        stats["clients_actifs"] = r["actifs"]

        # Demandes
        cursor.execute("SELECT COUNT(*) as total FROM b2b_demandes")
        stats["demandes_total"] = cursor.fetchone()["total"]
        cursor.execute("SELECT COUNT(*) as c FROM b2b_demandes WHERE statut = 'NOUVELLE'")
        stats["demandes_nouvelles"] = cursor.fetchone()["c"]
        cursor.execute("SELECT COUNT(*) as c FROM b2b_demandes WHERE statut IN ('EN_COURS', 'SOUMISE')")
        stats["demandes_en_cours"] = cursor.fetchone()["c"]

        # Soumissions
        cursor.execute("SELECT COUNT(*) as total FROM b2b_soumissions")
        stats["soumissions_total"] = cursor.fetchone()["total"]
        cursor.execute("SELECT COUNT(*) as c FROM b2b_soumissions WHERE statut = 'ACCEPTEE'")
        stats["soumissions_acceptees"] = cursor.fetchone()["c"]

        # Contrats
        cursor.execute("SELECT COUNT(*) as total FROM b2b_contrats")
        stats["contrats_total"] = cursor.fetchone()["total"]
        cursor.execute("SELECT COUNT(*) as c FROM b2b_contrats WHERE statut = 'ACTIF'")
        stats["contrats_actifs"] = cursor.fetchone()["c"]
        cursor.execute("SELECT COALESCE(SUM(montant), 0) as s FROM b2b_contrats WHERE statut IN ('ACTIF', 'EN_COURS')")
        stats["contrats_valeur"] = float(cursor.fetchone()["s"])

        # Commandes
        cursor.execute("SELECT COUNT(*) as total FROM b2b_commandes")
        stats["commandes_total"] = cursor.fetchone()["total"]
        cursor.execute("SELECT COUNT(*) as c FROM b2b_commandes WHERE statut = 'EN_ATTENTE'")
        stats["commandes_en_attente"] = cursor.fetchone()["c"]

        # Messages non lus
        cursor.execute("SELECT COUNT(*) as c FROM b2b_messages WHERE lu = FALSE")
        stats["messages_non_lus"] = cursor.fetchone()["c"]

        # Demandes par statut
        cursor.execute(
            "SELECT statut, COUNT(*) as c FROM b2b_demandes GROUP BY statut ORDER BY c DESC"
        )
        stats["demandes_par_statut"] = [dict(r) for r in cursor.fetchall()]

        # Recent activity
        cursor.execute(
            "SELECT 'demande' as type, titre as label, statut, created_at "
            "FROM b2b_demandes ORDER BY created_at DESC LIMIT 5"
        )
        recent = []
        for r in cursor.fetchall():
            d = dict(r)
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            recent.append(d)
        stats["activite_recente"] = recent

        cursor.close()
        return stats
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_b2b_stats error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement des statistiques B2B")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# B2B CLIENTS
# ============================================

@router.get("/clients")
async def list_b2b_clients(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    active: Optional[bool] = None,
):
    """List B2B clients with pagination, search, and active filter."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        where_clauses = []
        params: list = []
        if search:
            where_clauses.append("(LOWER(nom) LIKE %s OR LOWER(email) LIKE %s OR LOWER(contact_nom) LIKE %s)")
            s = f"%{search.lower()}%"
            params.extend([s, s, s])
        if active is not None:
            where_clauses.append("active = %s")
            params.append(active)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        cursor.execute(f"SELECT COUNT(*) as total FROM b2b_clients WHERE {where_sql}", params)
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT * FROM b2b_clients WHERE {where_sql} "
            f"ORDER BY created_at DESC NULLS LAST LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = [_serialize_row(r, DATE_KEYS, DECIMAL_KEYS) for r in cursor.fetchall()]
        cursor.close()
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_b2b_clients error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des clients B2B")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.get("/clients/{client_id}")
async def get_b2b_client(client_id: int, user: ErpUser = Depends(get_current_user)):
    """Get single B2B client detail."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        cursor.execute("SELECT * FROM b2b_clients WHERE id = %s", (client_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Client non trouve")

        result = _serialize_row(row, DATE_KEYS, DECIMAL_KEYS)

        # Count demandes for this client
        cursor.execute("SELECT COUNT(*) as c FROM b2b_demandes WHERE client_id = %s", (client_id,))
        result["nombre_demandes"] = cursor.fetchone()["c"]

        cursor.close()
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_b2b_client error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation du client")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.post("/clients")
async def create_b2b_client(body: B2bClientCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new B2B client."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        cursor.execute(
            "INSERT INTO b2b_clients (nom, email, telephone, adresse, ville, "
            "province, code_postal, contact_nom, secteur, active) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,TRUE) RETURNING id",
            (body.nom, body.email, body.telephone, body.adresse, body.ville,
             body.province, body.code_postal, body.contact_nom, body.secteur),
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return {"id": row["id"], "message": "Client B2B cree"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_b2b_client error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation du client B2B")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.put("/clients/{client_id}")
async def update_b2b_client(client_id: int, body: B2bClientUpdate, user: ErpUser = Depends(get_current_user)):
    """Update a B2B client."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")

        sets = []
        params = []
        for k, v in fields.items():
            sets.append(f"{k} = %s")
            params.append(v)
        sets.append("updated_at = CURRENT_TIMESTAMP")
        params.append(client_id)

        cursor.execute(
            f"UPDATE b2b_clients SET {', '.join(sets)} WHERE id = %s RETURNING id",
            params,
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Client non trouve")
        conn.commit()
        cursor.close()
        return {"message": "Client mis a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_b2b_client error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour du client")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.delete("/clients/{client_id}")
async def deactivate_b2b_client(client_id: int, user: ErpUser = Depends(get_current_user)):
    """Soft-delete (deactivate) a B2B client."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute(
            "UPDATE b2b_clients SET active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = %s RETURNING id",
            (client_id,),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Client non trouve")
        conn.commit()
        cursor.close()
        return {"message": "Client desactive"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("deactivate_b2b_client error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de la desactivation du client")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# B2B CLIENT USERS (admin creates portal access)
# ============================================

class B2bClientUserCreate(BaseModel):
    client_id: int
    email: str
    password: str
    nom: Optional[str] = None
    telephone: Optional[str] = None


@router.post("/client-users")
async def create_b2b_client_user(
    body: B2bClientUserCreate,
    user: ErpUser = Depends(get_current_user),
):
    """Create login credentials for a B2B client (admin action)."""
    from ..erp_auth import hash_password as _hash_pw
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        # Verify client exists
        cursor.execute("SELECT id, nom FROM b2b_clients WHERE id = %s", (body.client_id,))
        client = cursor.fetchone()
        if not client:
            raise HTTPException(status_code=404, detail="Client B2B non trouve")
        # Check email uniqueness within tenant
        cursor.execute("SELECT id FROM b2b_client_users WHERE LOWER(email) = LOWER(%s)", (body.email.strip(),))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Un compte avec cet email existe deja")
        pw_hash = _hash_pw(body.password)
        cursor.execute(
            """INSERT INTO b2b_client_users (client_id, email, password_hash, nom, telephone)
               VALUES (%s, %s, %s, %s, %s) RETURNING id""",
            (body.client_id, body.email.strip().lower(), pw_hash,
             body.nom or client.get("nom", ""), body.telephone),
        )
        new_id = cursor.fetchone()["id"]
        conn.commit()
        return {"id": new_id, "client_id": body.client_id, "email": body.email.strip().lower()}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_b2b_client_user error: %s", exc)
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur creation acces client")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.get("/client-users")
async def list_b2b_client_users(
    user: ErpUser = Depends(get_current_user),
    client_id: Optional[int] = None,
    active: Optional[bool] = None,
):
    """List B2B client user accounts. Filter active=false for pending approvals."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        sql = """SELECT u.id, u.client_id, u.email, u.nom, u.telephone, u.active,
                        u.last_login, u.created_at, c.nom as client_nom,
                        c.telephone as client_telephone, c.adresse as client_adresse,
                        c.ville as client_ville
                 FROM b2b_client_users u JOIN b2b_clients c ON u.client_id = c.id"""
        wheres = []
        params = []
        if client_id is not None:
            wheres.append("u.client_id = %s")
            params.append(client_id)
        if active is not None:
            wheres.append("COALESCE(u.active, TRUE) = %s")
            params.append(active)
        if wheres:
            sql += " WHERE " + " AND ".join(wheres)
        sql += " ORDER BY u.created_at DESC"
        cursor.execute(sql, params)
        rows = cursor.fetchall()
        return {"items": [_serialize_row(dict(r), date_keys=DATE_KEYS) for r in rows]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_b2b_client_users error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur liste acces clients")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.put("/client-users/{user_id}/approve")
async def approve_b2b_client_user(
    user_id: int,
    user: ErpUser = Depends(require_role("admin", "super_admin")),
):
    """Approve a pending B2B client registration (set active=TRUE).

    Pattern Streamlit: UPDATE active=TRUE. L'utilisateur peut alors se connecter
    via POST /auth/b2b-client-login avec son email + password.

    Restricted to admin/super_admin only.
    """
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        # Verifier que l'utilisateur existe et est en attente
        cursor.execute(
            "SELECT id, email, nom, active FROM b2b_client_users WHERE id = %s",
            (user_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Demande introuvable")
        if row.get("active"):
            raise HTTPException(status_code=400, detail="Ce compte est deja actif")
        cursor.execute(
            "UPDATE b2b_client_users SET active = TRUE WHERE id = %s RETURNING id",
            (user_id,),
        )
        updated = cursor.fetchone()
        if not updated:
            raise HTTPException(status_code=404, detail="Echec mise a jour")
        conn.commit()
        return {
            "id": user_id,
            "email": row["email"],
            "nom": row.get("nom"),
            "active": True,
            "message": f"Acces accorde a {row.get('nom') or row['email']}",
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("approve_b2b_client_user error: %s", exc)
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur approbation client B2B")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.put("/client-users/{user_id}/reject")
async def reject_b2b_client_user(
    user_id: int,
    user: ErpUser = Depends(require_role("admin", "super_admin")),
):
    """Reject a pending B2B client registration (DELETE row, pattern Streamlit).

    Note: le Streamlit original DELETE la row, pas d'audit trail. Ici on fait
    pareil pour rester fidele. Si besoin de garder un historique plus tard,
    ajouter une colonne rejected_at + rejection_reason.

    Restricted to admin/super_admin only.
    """
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute(
            "SELECT id, email, nom, active FROM b2b_client_users WHERE id = %s",
            (user_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Demande introuvable")
        if row.get("active"):
            raise HTTPException(
                status_code=400,
                detail="Impossible de rejeter un compte actif. Desactivez-le plutot.",
            )
        cursor.execute("DELETE FROM b2b_client_users WHERE id = %s RETURNING id", (user_id,))
        deleted = cursor.fetchone()
        if not deleted:
            raise HTTPException(status_code=404, detail="Echec suppression")
        conn.commit()
        return {
            "id": user_id,
            "email": row["email"],
            "deleted": True,
            "message": f"Demande de {row.get('nom') or row['email']} rejetee",
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("reject_b2b_client_user error: %s", exc)
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur rejet client B2B")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# B2B DEMANDES
# ============================================

@router.get("/demandes")
async def list_b2b_demandes(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    client_id: Optional[int] = None,
    statut: Optional[str] = None,
    priorite: Optional[str] = None,
    search: Optional[str] = None,
):
    """List B2B demands with filters."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        where_clauses = []
        params: list = []
        if client_id:
            where_clauses.append("d.client_id = %s")
            params.append(client_id)
        if statut:
            where_clauses.append("d.statut = %s")
            params.append(statut)
        if priorite:
            where_clauses.append("d.priorite = %s")
            params.append(priorite)
        if search:
            where_clauses.append("(LOWER(d.titre) LIKE %s OR LOWER(d.description) LIKE %s)")
            s = f"%{search.lower()}%"
            params.extend([s, s])

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        cursor.execute(f"SELECT COUNT(*) as total FROM b2b_demandes d WHERE {where_sql}", params)
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT d.*, c.nom as client_nom, c.email as client_email "
            f"FROM b2b_demandes d "
            f"LEFT JOIN b2b_clients c ON d.client_id = c.id "
            f"WHERE {where_sql} "
            f"ORDER BY d.created_at DESC NULLS LAST LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = [_serialize_row(r, DATE_KEYS, DECIMAL_KEYS) for r in cursor.fetchall()]
        cursor.close()
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_b2b_demandes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des demandes")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.get("/demandes/{demande_id}")
async def get_b2b_demande(demande_id: int, user: ErpUser = Depends(get_current_user)):
    """Get demand detail with soumissions and messages."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        cursor.execute(
            "SELECT d.*, c.nom as client_nom, c.email as client_email, c.telephone as client_telephone "
            "FROM b2b_demandes d "
            "LEFT JOIN b2b_clients c ON d.client_id = c.id "
            "WHERE d.id = %s",
            (demande_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Demande non trouvee")

        result = _serialize_row(row, DATE_KEYS, DECIMAL_KEYS)

        # Soumissions
        cursor.execute(
            "SELECT * FROM b2b_soumissions WHERE demande_id = %s ORDER BY created_at DESC",
            (demande_id,),
        )
        result["soumissions"] = [_serialize_row(r, DATE_KEYS, DECIMAL_KEYS) for r in cursor.fetchall()]

        # Messages count
        cursor.execute("SELECT COUNT(*) as c FROM b2b_messages WHERE demande_id = %s", (demande_id,))
        result["nombre_messages"] = cursor.fetchone()["c"]

        cursor.close()
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_b2b_demande error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation de la demande")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.post("/demandes")
async def create_b2b_demande(body: B2bDemandeCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new B2B demand."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)

        # Verify client exists
        cursor.execute("SELECT id FROM b2b_clients WHERE id = %s", (body.client_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Client non trouve")

        cursor.execute(
            "INSERT INTO b2b_demandes (client_id, titre, description, categorie, "
            "budget_estime, date_limite, statut, priorite, adresse_chantier, ville_chantier) "
            "VALUES (%s,%s,%s,%s,%s,%s,'NOUVELLE',%s,%s,%s) RETURNING id",
            (body.client_id, body.titre, body.description, body.categorie,
             body.budget_estime, body.date_limite or None, body.priorite,
             body.adresse_chantier, body.ville_chantier),
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return {"id": row["id"], "message": "Demande B2B creee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_b2b_demande error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la demande")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.put("/demandes/{demande_id}")
async def update_b2b_demande(demande_id: int, body: B2bDemandeUpdate, user: ErpUser = Depends(get_current_user)):
    """Update a B2B demand."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")

        if "statut" in fields and fields["statut"] not in DEMANDE_STATUTS:
            raise HTTPException(status_code=400, detail="Statut invalide")

        sets = []
        params = []
        for k, v in fields.items():
            sets.append(f"{k} = %s")
            params.append(v)
        sets.append("updated_at = CURRENT_TIMESTAMP")
        params.append(demande_id)

        cursor.execute(
            f"UPDATE b2b_demandes SET {', '.join(sets)} WHERE id = %s RETURNING id",
            params,
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Demande non trouvee")
        conn.commit()
        cursor.close()
        return {"message": "Demande mise a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_b2b_demande error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour de la demande")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# B2B SOUMISSIONS
# ============================================

@router.get("/soumissions")
async def list_b2b_soumissions(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    demande_id: Optional[int] = None,
    statut: Optional[str] = None,
):
    """List all soumissions."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        where_clauses = []
        params: list = []
        if demande_id:
            where_clauses.append("s.demande_id = %s")
            params.append(demande_id)
        if statut:
            where_clauses.append("s.statut = %s")
            params.append(statut)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        cursor.execute(f"SELECT COUNT(*) as total FROM b2b_soumissions s WHERE {where_sql}", params)
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT s.*, d.titre as demande_titre, c.nom as client_nom "
            f"FROM b2b_soumissions s "
            f"LEFT JOIN b2b_demandes d ON s.demande_id = d.id "
            f"LEFT JOIN b2b_clients c ON d.client_id = c.id "
            f"WHERE {where_sql} "
            f"ORDER BY s.created_at DESC NULLS LAST LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = [_serialize_row(r, DATE_KEYS, DECIMAL_KEYS) for r in cursor.fetchall()]
        cursor.close()
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_b2b_soumissions error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des soumissions")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.post("/soumissions")
async def create_b2b_soumission(body: B2bSoumissionCreate, user: ErpUser = Depends(get_current_user)):
    """Create a soumission for a demand."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        # Verify demande exists
        cursor.execute("SELECT id, statut FROM b2b_demandes WHERE id = %s", (body.demande_id,))
        demande = cursor.fetchone()
        if not demande:
            raise HTTPException(status_code=404, detail="Demande non trouvee")

        # Calculate taxes: HT takes priority, else derive from TTC
        if body.montant_ht is not None:
            montant_ht = body.montant_ht
            tps = montant_ht * TPS_RATE
            tvq = montant_ht * TVQ_RATE
            montant_total = montant_ht + tps + tvq
        elif body.montant_total is not None:
            montant_total = body.montant_total
            montant_ht = montant_total / (1 + TPS_RATE + TVQ_RATE)
            tps = montant_ht * TPS_RATE
            tvq = montant_ht * TVQ_RATE
        else:
            montant_ht = montant_total = tps = tvq = 0
        montant_taxes = tps + tvq

        validite = body.validite_jours if body.validite_jours is not None else 30
        cursor.execute(
            "INSERT INTO b2b_soumissions (demande_id, montant_total, montant_ht, montant_taxes, "
            "description, delai_execution_jours, conditions_paiement, garanties, notes, "
            "statut, validite_jours, date_expiration) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'BROUILLON',%s, CURRENT_DATE + %s * INTERVAL '1 day') RETURNING id",
            (body.demande_id, montant_total, montant_ht, montant_taxes,
             body.description, body.delai_execution_jours, body.conditions_paiement,
             body.garanties, body.notes, validite, validite),
        )
        row = cursor.fetchone()

        # Update demande count + status
        cursor.execute(
            "UPDATE b2b_demandes SET nombre_soumissions = nombre_soumissions + 1, "
            "statut = CASE WHEN statut = 'NOUVELLE' THEN 'EN_COURS' ELSE statut END, "
            "updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (body.demande_id,),
        )
        conn.commit()
        cursor.close()
        return {"id": row["id"], "message": "Soumission creee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_b2b_soumission error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la soumission")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.put("/soumissions/{soumission_id}")
async def update_b2b_soumission(soumission_id: int, body: B2bSoumissionUpdate, user: ErpUser = Depends(get_current_user)):
    """Update a soumission."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")

        if "statut" in fields and fields["statut"] not in SOUMISSION_STATUTS:
            raise HTTPException(status_code=400, detail="Statut invalide")

        sets = []
        params = []
        for k, v in fields.items():
            sets.append(f"{k} = %s")
            params.append(v)
        sets.append("updated_at = CURRENT_TIMESTAMP")
        params.append(soumission_id)

        cursor.execute(
            f"UPDATE b2b_soumissions SET {', '.join(sets)} WHERE id = %s RETURNING id",
            params,
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Soumission non trouvee")
        conn.commit()
        cursor.close()
        return {"message": "Soumission mise a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_b2b_soumission error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour de la soumission")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.put("/soumissions/{soumission_id}/accepter")
async def accept_b2b_soumission(soumission_id: int, user: ErpUser = Depends(get_current_user)):
    """Accept a soumission and create a contract."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        # Get soumission + demande info
        cursor.execute(
            "SELECT s.*, d.client_id, d.titre as demande_titre "
            "FROM b2b_soumissions s "
            "JOIN b2b_demandes d ON s.demande_id = d.id "
            "WHERE s.id = %s",
            (soumission_id,),
        )
        soum = cursor.fetchone()
        if not soum:
            raise HTTPException(status_code=404, detail="Soumission non trouvee")
        if soum["statut"] in ("ACCEPTEE", "REFUSEE", "EXPIREE"):
            raise HTTPException(status_code=400, detail="Soumission ne peut plus etre acceptee dans son etat actuel")

        # Accept the soumission
        cursor.execute(
            "UPDATE b2b_soumissions SET statut = 'ACCEPTEE', updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (soumission_id,),
        )

        # Update demande status
        cursor.execute(
            "UPDATE b2b_demandes SET statut = 'ACCEPTEE', updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (soum["demande_id"],),
        )

        # Refuse other soumissions for the same demande
        cursor.execute(
            "UPDATE b2b_soumissions SET statut = 'REFUSEE', updated_at = CURRENT_TIMESTAMP "
            "WHERE demande_id = %s AND id != %s AND statut NOT IN ('REFUSEE', 'EXPIREE')",
            (soum["demande_id"], soumission_id),
        )

        # Generate contract number
        cursor.execute("SELECT COUNT(*) as c FROM b2b_contrats")
        num = cursor.fetchone()["c"] + 1
        numero_contrat = f"CTR-{datetime.now().strftime('%Y%m')}-{num:04d}"

        # Create contract
        cursor.execute(
            "INSERT INTO b2b_contrats (soumission_id, demande_id, client_company_id, "
            "numero_contrat, titre, montant, statut, date_signature) "
            "VALUES (%s, %s, %s, %s, %s, %s, 'ACTIF', CURRENT_DATE) RETURNING id",
            (soumission_id, soum["demande_id"], soum["client_id"],
             numero_contrat, soum["demande_titre"],
             float(soum["montant_total"]) if soum["montant_total"] else 0),
        )
        contrat_id = cursor.fetchone()["id"]

        conn.commit()
        cursor.close()
        return {"message": "Soumission acceptee, contrat cree", "contrat_id": contrat_id, "numero_contrat": numero_contrat}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("accept_b2b_soumission error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de l'acceptation de la soumission")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.put("/soumissions/{soumission_id}/refuser")
async def refuse_b2b_soumission(soumission_id: int, user: ErpUser = Depends(get_current_user)):
    """Refuse a soumission."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute("SELECT statut FROM b2b_soumissions WHERE id = %s", (soumission_id,))
        soum = cursor.fetchone()
        if not soum:
            raise HTTPException(status_code=404, detail="Soumission non trouvee")
        if soum["statut"] in ("ACCEPTEE", "REFUSEE", "EXPIREE"):
            raise HTTPException(status_code=400, detail="Soumission ne peut plus etre refusee dans son etat actuel")
        cursor.execute(
            "UPDATE b2b_soumissions SET statut = 'REFUSEE', updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (soumission_id,),
        )
        conn.commit()
        cursor.close()
        return {"message": "Soumission refusee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("refuse_b2b_soumission error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors du refus de la soumission")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# B2B CONTRATS
# ============================================

@router.get("/contrats")
async def list_b2b_contrats(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    statut: Optional[str] = None,
):
    """List B2B contracts."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        where_clauses = []
        params: list = []
        if statut:
            where_clauses.append("ct.statut = %s")
            params.append(statut)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        cursor.execute(f"SELECT COUNT(*) as total FROM b2b_contrats ct WHERE {where_sql}", params)
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT ct.*, c.nom as client_nom "
            f"FROM b2b_contrats ct "
            f"LEFT JOIN b2b_clients c ON ct.client_company_id = c.id "
            f"WHERE {where_sql} "
            f"ORDER BY ct.created_at DESC NULLS LAST LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = [_serialize_row(r, DATE_KEYS, DECIMAL_KEYS) for r in cursor.fetchall()]
        cursor.close()
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_b2b_contrats error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des contrats")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.get("/contrats/{contrat_id}")
async def get_b2b_contrat(contrat_id: int, user: ErpUser = Depends(get_current_user)):
    """Get contract detail."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        cursor.execute(
            "SELECT ct.*, c.nom as client_nom, c.email as client_email, "
            "d.titre as demande_titre "
            "FROM b2b_contrats ct "
            "LEFT JOIN b2b_clients c ON ct.client_company_id = c.id "
            "LEFT JOIN b2b_demandes d ON ct.demande_id = d.id "
            "WHERE ct.id = %s",
            (contrat_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contrat non trouve")

        result = _serialize_row(row, DATE_KEYS, DECIMAL_KEYS)
        cursor.close()
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_b2b_contrat error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation du contrat")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.put("/contrats/{contrat_id}")
async def update_b2b_contrat(contrat_id: int, body: B2bContratUpdate, user: ErpUser = Depends(get_current_user)):
    """Update a contract."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")

        if "statut" in fields and fields["statut"] not in CONTRAT_STATUTS:
            raise HTTPException(status_code=400, detail="Statut invalide")

        sets = []
        params = []
        for k, v in fields.items():
            sets.append(f"{k} = %s")
            params.append(v)
        sets.append("updated_at = CURRENT_TIMESTAMP")
        params.append(contrat_id)

        cursor.execute(
            f"UPDATE b2b_contrats SET {', '.join(sets)} WHERE id = %s RETURNING id",
            params,
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Contrat non trouve")
        conn.commit()
        cursor.close()
        return {"message": "Contrat mis a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_b2b_contrat error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour du contrat")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# B2B COMMANDES
# ============================================

@router.get("/commandes")
async def list_b2b_commandes(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    statut: Optional[str] = None,
):
    """List B2B orders."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        where_clauses = []
        params: list = []
        if statut:
            where_clauses.append("co.statut = %s")
            params.append(statut)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        cursor.execute(f"SELECT COUNT(*) as total FROM b2b_commandes co WHERE {where_sql}", params)
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT co.* FROM b2b_commandes co "
            f"WHERE {where_sql} "
            f"ORDER BY co.date_commande DESC NULLS LAST LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = [_serialize_row(r, DATE_KEYS, DECIMAL_KEYS) for r in cursor.fetchall()]
        cursor.close()
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_b2b_commandes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des commandes")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.get("/commandes/{commande_id}")
async def get_b2b_commande(commande_id: int, user: ErpUser = Depends(get_current_user)):
    """Get order detail with line items."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        cursor.execute("SELECT * FROM b2b_commandes WHERE id = %s", (commande_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Commande non trouvee")

        result = _serialize_row(row, DATE_KEYS, DECIMAL_KEYS)

        # Get line items
        cursor.execute(
            "SELECT * FROM b2b_commande_lignes WHERE commande_id = %s ORDER BY id",
            (commande_id,),
        )
        result["lignes"] = [_serialize_row(r, DATE_KEYS, DECIMAL_KEYS) for r in cursor.fetchall()]
        cursor.close()
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_b2b_commande error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation de la commande")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.put("/commandes/{commande_id}/statut")
async def update_b2b_commande_statut(
    commande_id: int,
    statut: str = Query(...),
    user: ErpUser = Depends(get_current_user),
):
    """Update order status."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if statut not in COMMANDE_STATUTS:
        raise HTTPException(status_code=400, detail="Statut invalide")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute(
            "UPDATE b2b_commandes SET statut = %s, updated_at = CURRENT_TIMESTAMP "
            "WHERE id = %s RETURNING id",
            (statut, commande_id),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Commande non trouvee")
        conn.commit()
        cursor.close()
        return {"message": f"Statut mis a jour: {statut}"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_b2b_commande_statut error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour du statut")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# B2B CATALOGUE (reads from produits table)
# ============================================

@router.get("/catalogue")
async def list_b2b_catalogue(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    categorie: Optional[str] = None,
    search: Optional[str] = None,
):
    """List products available in the B2B catalogue."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        # Check if produits table exists
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = current_schema() AND table_name = 'produits') as ex"
        )
        if not cursor.fetchone()["ex"]:
            return {"items": [], "total": 0, "page": page, "per_page": per_page, "categories": []}

        _ensure_produits_columns(cursor, user.schema)

        where_clauses = []
        params: list = []
        if categorie:
            where_clauses.append("LOWER(categorie) = %s")
            params.append(categorie.lower())
        if search:
            where_clauses.append("(LOWER(nom) LIKE %s OR LOWER(description) LIKE %s OR LOWER(code_produit) LIKE %s)")
            s = f"%{search.lower()}%"
            params.extend([s, s, s])

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        cursor.execute(f"SELECT COUNT(*) as total FROM produits WHERE {where_sql}", params)
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT id, code_produit, nom, description, categorie, unite, "
            f"COALESCE(prix_unitaire, 0) as prix_unitaire, "
            f"COALESCE(stock_disponible, 0) as stock_disponible "
            f"FROM produits WHERE {where_sql} "
            f"ORDER BY nom ASC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = [_serialize_row(r, DATE_KEYS, DECIMAL_KEYS) for r in cursor.fetchall()]

        # Get categories
        cursor.execute(
            "SELECT DISTINCT categorie FROM produits WHERE categorie IS NOT NULL AND categorie != '' ORDER BY categorie"
        )
        categories = [r["categorie"] for r in cursor.fetchall()]

        cursor.close()
        return {"items": items, "total": total, "page": page, "per_page": per_page, "categories": categories}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_b2b_catalogue error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement du catalogue")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# B2B PANIER
# ============================================

@router.get("/panier")
async def get_b2b_panier(user: ErpUser = Depends(get_current_user)):
    """Get the active cart for the current user."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        # Get or create active cart
        cursor.execute(
            "SELECT id FROM b2b_paniers WHERE user_id = %s AND statut = 'actif' ORDER BY created_at DESC LIMIT 1",
            (user.user_id,),
        )
        panier_row = cursor.fetchone()
        if not panier_row:
            cursor.execute(
                "INSERT INTO b2b_paniers (user_id, statut) VALUES (%s, 'actif') RETURNING id",
                (user.user_id,),
            )
            panier_row = cursor.fetchone()
            conn.commit()

        panier_id = panier_row["id"]

        # Get items with product info
        cursor.execute(
            "SELECT pl.id, pl.produit_id, pl.quantite, pl.prix_unitaire, "
            "p.nom as produit_nom, p.code_produit, p.unite, "
            "COALESCE(pl.prix_unitaire, p.prix_unitaire, 0) as prix, "
            "(pl.quantite * COALESCE(pl.prix_unitaire, p.prix_unitaire, 0)) as montant_ligne "
            "FROM b2b_panier_lignes pl "
            "LEFT JOIN produits p ON pl.produit_id = p.id "
            "WHERE pl.panier_id = %s ORDER BY pl.id",
            (panier_id,),
        )
        items = [_serialize_row(r, DATE_KEYS, DECIMAL_KEYS) for r in cursor.fetchall()]

        sous_total = sum(float(i.get("montant_ligne", 0)) for i in items)
        tps = sous_total * TPS_RATE
        tvq = sous_total * TVQ_RATE
        total_ttc = sous_total + tps + tvq

        cursor.close()
        return {
            "panier_id": panier_id,
            "items": items,
            "sous_total": round(sous_total, 2),
            "tps": round(tps, 2),
            "tvq": round(tvq, 2),
            "total_ttc": round(total_ttc, 2),
            "nombre_items": len(items),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_b2b_panier error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement du panier")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.post("/panier/items")
async def add_to_panier(body: B2bPanierItemCreate, user: ErpUser = Depends(get_current_user)):
    """Add a product to the cart."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)

        # Get or create active cart
        cursor.execute(
            "SELECT id FROM b2b_paniers WHERE user_id = %s AND statut = 'actif' ORDER BY created_at DESC LIMIT 1",
            (user.user_id,),
        )
        panier_row = cursor.fetchone()
        if not panier_row:
            cursor.execute(
                "INSERT INTO b2b_paniers (user_id, statut) VALUES (%s, 'actif') RETURNING id",
                (user.user_id,),
            )
            panier_row = cursor.fetchone()

        panier_id = panier_row["id"]

        _ensure_produits_columns(cursor, user.schema)

        # Get product price
        cursor.execute("SELECT prix_unitaire FROM produits WHERE id = %s", (body.produit_id,))
        produit = cursor.fetchone()
        if not produit:
            raise HTTPException(status_code=404, detail="Produit non trouve")
        prix = float(produit["prix_unitaire"]) if produit["prix_unitaire"] else 0

        # Check if product already in cart
        cursor.execute(
            "SELECT id, quantite FROM b2b_panier_lignes WHERE panier_id = %s AND produit_id = %s",
            (panier_id, body.produit_id),
        )
        existing = cursor.fetchone()
        if existing:
            cursor.execute(
                "UPDATE b2b_panier_lignes SET quantite = quantite + %s WHERE id = %s",
                (body.quantite, existing["id"]),
            )
        else:
            cursor.execute(
                "INSERT INTO b2b_panier_lignes (panier_id, produit_id, quantite, prix_unitaire) "
                "VALUES (%s, %s, %s, %s)",
                (panier_id, body.produit_id, body.quantite, prix),
            )

        conn.commit()
        cursor.close()
        return {"message": "Produit ajoute au panier"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("add_to_panier error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de l'ajout au panier")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.delete("/panier/items/{item_id}")
async def remove_from_panier(item_id: int, user: ErpUser = Depends(get_current_user)):
    """Remove an item from the cart."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute(
            "DELETE FROM b2b_panier_lignes WHERE id = %s "
            "AND panier_id IN (SELECT id FROM b2b_paniers WHERE user_id = %s AND statut = 'actif') "
            "RETURNING id",
            (item_id, user.user_id),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Article non trouve")
        conn.commit()
        cursor.close()
        return {"message": "Article retire du panier"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("remove_from_panier error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors du retrait du panier")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.post("/panier/commander")
async def commander_panier(body: B2bCommandeCreate, user: ErpUser = Depends(get_current_user)):
    """Convert the active cart into an order."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        # Get active cart
        cursor.execute(
            "SELECT id, client_company_id FROM b2b_paniers WHERE user_id = %s AND statut = 'actif' ORDER BY created_at DESC LIMIT 1",
            (user.user_id,),
        )
        panier_row = cursor.fetchone()
        if not panier_row:
            raise HTTPException(status_code=400, detail="Aucun panier actif")

        panier_id = panier_row["id"]
        client_company_id = panier_row.get("client_company_id") or user.user_id

        _ensure_produits_columns(cursor, user.schema)

        # Get cart items
        cursor.execute(
            "SELECT pl.produit_id, pl.quantite, COALESCE(pl.prix_unitaire, 0) as prix_unitaire, "
            "p.nom, p.code_produit, p.description, p.unite "
            "FROM b2b_panier_lignes pl "
            "LEFT JOIN produits p ON pl.produit_id = p.id "
            "WHERE pl.panier_id = %s",
            (panier_id,),
        )
        items = cursor.fetchall()
        if not items:
            raise HTTPException(status_code=400, detail="Panier vide")

        # Calculate totals
        sous_total = sum(float(i["quantite"]) * float(i["prix_unitaire"]) for i in items)
        tps = round(sous_total * TPS_RATE, 2)
        tvq = round(sous_total * TVQ_RATE, 2)
        total_ttc = round(sous_total + tps + tvq, 2)

        # Generate order number
        cursor.execute("SELECT COUNT(*) as c FROM b2b_commandes")
        num = cursor.fetchone()["c"] + 1
        numero = f"CMD-{datetime.now().strftime('%Y%m%d')}-{num:04d}"

        # Create order
        cursor.execute(
            "INSERT INTO b2b_commandes (numero, client_company_id, adresse_livraison, "
            "ville_livraison, province_livraison, code_postal_livraison, "
            "sous_total, tps, tvq, total_ttc, statut, notes_client) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'EN_ATTENTE', %s) RETURNING id",
            (numero, client_company_id, body.adresse_livraison, body.ville_livraison,
             body.province_livraison, body.code_postal_livraison,
             sous_total, tps, tvq, total_ttc, body.notes_client),
        )
        commande_id = cursor.fetchone()["id"]

        # Create order lines
        for item in items:
            montant_ligne = float(item["quantite"]) * float(item["prix_unitaire"])
            cursor.execute(
                "INSERT INTO b2b_commande_lignes (commande_id, produit_id, code_produit, "
                "nom_produit, description, quantite, unite, prix_unitaire, montant_ligne) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (commande_id, item["produit_id"], item.get("code_produit"),
                 item.get("nom"), item.get("description"), item["quantite"],
                 item.get("unite", "unite"), item["prix_unitaire"], montant_ligne),
            )

        # Mark cart as converted
        cursor.execute(
            "UPDATE b2b_paniers SET statut = 'convertie', updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (panier_id,),
        )

        conn.commit()
        cursor.close()
        return {"id": commande_id, "numero": numero, "total_ttc": total_ttc, "message": "Commande creee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("commander_panier error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la commande")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# B2B FAVORIS
# ============================================

@router.get("/favoris")
async def list_b2b_favoris(user: ErpUser = Depends(get_current_user)):
    """List favorite products."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        _ensure_produits_columns(cursor, user.schema)
        conn.commit()

        cursor.execute(
            "SELECT f.id, f.produit_id, f.created_at, "
            "p.nom, p.code_produit, p.description, p.categorie, "
            "COALESCE(p.prix_unitaire, 0) as prix_unitaire "
            "FROM b2b_favoris f "
            "LEFT JOIN produits p ON f.produit_id = p.id "
            "WHERE f.user_id = %s "
            "ORDER BY f.created_at DESC",
            (user.user_id,),
        )
        items = [_serialize_row(r, DATE_KEYS, DECIMAL_KEYS) for r in cursor.fetchall()]
        cursor.close()
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_b2b_favoris error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement des favoris")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.post("/favoris/{produit_id}")
async def add_b2b_favori(produit_id: int, user: ErpUser = Depends(get_current_user)):
    """Add a product to favorites."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)

        # Check if already favorite
        cursor.execute(
            "SELECT id FROM b2b_favoris WHERE user_id = %s AND produit_id = %s",
            (user.user_id, produit_id),
        )
        if cursor.fetchone():
            cursor.close()
            return {"message": "Deja dans les favoris"}

        cursor.execute(
            "INSERT INTO b2b_favoris (user_id, produit_id) VALUES (%s, %s) RETURNING id",
            (user.user_id, produit_id),
        )
        conn.commit()
        cursor.close()
        return {"message": "Ajoute aux favoris"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("add_b2b_favori error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de l'ajout aux favoris")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.delete("/favoris/{produit_id}")
async def remove_b2b_favori(produit_id: int, user: ErpUser = Depends(get_current_user)):
    """Remove a product from favorites."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute(
            "DELETE FROM b2b_favoris WHERE user_id = %s AND produit_id = %s RETURNING id",
            (user.user_id, produit_id),
        )
        conn.commit()
        cursor.close()
        return {"message": "Retire des favoris"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("remove_b2b_favori error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors du retrait des favoris")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# B2B MESSAGES
# ============================================

@router.get("/messages")
async def list_b2b_messages(
    user: ErpUser = Depends(get_current_user),
    demande_id: Optional[int] = None,
    contrat_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
):
    """List messages for a demand or contract."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if not demande_id and not contrat_id:
        raise HTTPException(status_code=400, detail="demande_id ou contrat_id requis")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        where = "demande_id = %s" if demande_id else "contrat_id = %s"
        ref_id = demande_id or contrat_id

        cursor.execute(f"SELECT COUNT(*) as total FROM b2b_messages WHERE {where}", (ref_id,))
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT * FROM b2b_messages WHERE {where} "
            f"ORDER BY created_at ASC LIMIT %s OFFSET %s",
            (ref_id, per_page, offset),
        )
        items = [_serialize_row(r, DATE_KEYS, DECIMAL_KEYS) for r in cursor.fetchall()]
        cursor.close()
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_b2b_messages error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des messages")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.post("/messages")
async def create_b2b_message(body: B2bMessageCreate, user: ErpUser = Depends(get_current_user)):
    """Send a message on a demand or contract."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if not body.demande_id and not body.contrat_id:
        raise HTTPException(status_code=400, detail="demande_id ou contrat_id requis")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        cursor.execute(
            "INSERT INTO b2b_messages (demande_id, contrat_id, sender_user_id, message, sujet) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (body.demande_id, body.contrat_id, user.user_id, body.message, body.sujet),
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return {"id": row["id"], "message": "Message envoye"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_b2b_message error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de l'envoi du message")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# B2B NOTIFICATIONS
# ============================================

@router.get("/notifications")
async def list_b2b_notifications(
    user: ErpUser = Depends(get_current_user),
    non_lues: Optional[bool] = None,
):
    """List B2B notifications for the current user."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()

        where = "user_id = %s"
        params: list = [user.user_id]
        if non_lues:
            # `lue` est la colonne canonique (erp_database.py:6149). Les
            # tenants v7/v8 legacy avec `lu` ont aussi recu `lue` via les
            # ALTER defensifs dans _ensure_b2b_tables. COALESCE protege
            # contre les rows preexistantes ou lue=NULL (ALTER ne backfille
            # pas), traitees comme non-lues.
            where += " AND COALESCE(lue, FALSE) = FALSE"

        cursor.execute(
            f"SELECT * FROM b2b_notifications WHERE {where} ORDER BY created_at DESC LIMIT 50",
            params,
        )
        items = [_serialize_row(r, DATE_KEYS, DECIMAL_KEYS) for r in cursor.fetchall()]
        cursor.close()
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_b2b_notifications error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement des notifications")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.put("/notifications/{notif_id}/read")
async def mark_b2b_notification_read(notif_id: int, user: ErpUser = Depends(get_current_user)):
    """Mark a notification as read."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute(
            "UPDATE b2b_notifications SET lue = TRUE WHERE id = %s AND user_id = %s RETURNING id",
            (notif_id, user.user_id),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Notification non trouvee")
        conn.commit()
        cursor.close()
        return {"message": "Notification lue"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("mark_b2b_notification_read error: %s", exc)
        if conn:
            conn.rollback()
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour de la notification")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# C2B CATEGORIES CONSTRUCTION (140+ items)
# ============================================

CATEGORIES_CONSTRUCTION = {
    "0": {
        "name": "0.0 - Travaux Preparatoires et Demolition",
        "items": [
            {"id": "0-1", "title": "Permis et etudes", "description": "Permis de construction, etude geotechnique, certificat de localisation."},
            {"id": "0-2", "title": "Demolition et decontamination", "description": "Demolition de structures, decontamination, disposition des debris."},
            {"id": "0-3", "title": "Preparation du terrain", "description": "Deboisement, essouchement, nivellement, electricite temporaire, cloture."},
        ],
    },
    "1": {
        "name": "1.0 - Fondation, Infrastructure et Services",
        "items": [
            {"id": "1-1", "title": "Excavation et remblai", "description": "Excavation generale, remblai granulaire, pierre concassee, membrane geotextile."},
            {"id": "1-2", "title": "Fondation complete", "description": "Beton 30 MPA, armature 15M, coffrage, coulee, isolant R-10 sous-dalle."},
            {"id": "1-3", "title": "Drainage et impermeabilisation", "description": "Drain francais, membrane, panneau de drainage, pompe de puisard."},
            {"id": "1-4", "title": "Raccordements et services", "description": "Egout, aqueduc, pluvial, systeme septique si applicable."},
        ],
    },
    "2": {
        "name": "2.0 - Structure et Charpente",
        "items": [
            {"id": "2-1", "title": "Structure de plancher", "description": "Poutrelles ajourees, solives de rive, sous-plancher colle-visse."},
            {"id": "2-2", "title": "Murs porteurs et cloisons", "description": "Montants 2x6 murs exterieurs, 2x4 cloisons, lisses, sablieres, linteaux."},
            {"id": "2-3", "title": "Structure de toit", "description": "Fermes prefabriquees ou chevrons, contreventement, support de toit."},
            {"id": "2-4", "title": "Elements structuraux speciaux", "description": "Poutres et colonnes acier, poutres LVL, quincaillerie structurale."},
        ],
    },
    "3": {
        "name": "3.0 - Enveloppe Exterieure",
        "items": [
            {"id": "3-1", "title": "Toiture - Materiaux", "description": "Bardeaux architecturaux 30 ans, membrane autocollante, ventilation de toit."},
            {"id": "3-2", "title": "Toiture - Main-d'oeuvre", "description": "Installation bardeaux, solins, noues, gouttieres, descentes pluviales."},
            {"id": "3-3", "title": "Revetements muraux - Materiaux", "description": "Maconnerie, fibrociment, vinyle/acier, fourrures, pare-air Tyvek."},
            {"id": "3-4", "title": "Revetements muraux - Main-d'oeuvre", "description": "Installation revetements, calfeutrage, scellants, finition."},
            {"id": "3-5", "title": "Fenetres et portes exterieures", "description": "Fenetres Energy Star, porte entree, porte patio, installation, scellants."},
            {"id": "3-6", "title": "Isolation exterieure", "description": "Isolant rigide R-5 continu, pare-vapeur, ruban, mousse."},
            {"id": "3-7", "title": "Balcons et terrasses", "description": "Structure, membrane, revetement, garde-corps, escalier exterieur."},
            {"id": "3-8", "title": "Garage", "description": "Porte de garage, ouvre-porte, dalle, finition murs et plafond."},
        ],
    },
    "4": {
        "name": "4.0 - Systemes Mecaniques et Electriques",
        "items": [
            {"id": "4-1", "title": "Plomberie - Alimentation", "description": "Cuivre/PEX, robinetterie, chauffe-eau, adoucisseur si necessaire."},
            {"id": "4-2", "title": "Plomberie - Evacuation", "description": "ABS/PVC, ventilation, branchements appareils, puisard."},
            {"id": "4-3", "title": "Plomberie - Appareils", "description": "Toilettes, lavabos, bain/douche, evier cuisine, robinetterie."},
            {"id": "4-4", "title": "Electricite - Filage", "description": "Panneau 200A, circuits, cablage, boites, mises a terre."},
            {"id": "4-5", "title": "Electricite - Finition", "description": "Prises, interrupteurs, luminaires, detecteurs fumee/CO."},
            {"id": "4-6", "title": "Chauffage", "description": "Systeme chauffage central, plinthes, thermostats, conduits."},
            {"id": "4-7", "title": "Ventilation", "description": "VRC/VRE, conduits, grilles, hotte cuisine, ventilateurs salle de bain."},
            {"id": "4-8", "title": "Climatisation", "description": "Thermopompe, conduits, thermostat programmable."},
            {"id": "4-9", "title": "Systemes speciaux", "description": "Alarme, domotique, precablage son, reseau, camera."},
        ],
    },
    "5": {
        "name": "5.0 - Isolation et Etancheite",
        "items": [
            {"id": "5-1", "title": "Isolation murs exterieurs", "description": "Urethan gigle R-24.5, laine minerale, pare-vapeur."},
            {"id": "5-2", "title": "Isolation plafonds", "description": "Cellulose ou laine soufflee R-60, pare-vapeur, scellant."},
            {"id": "5-3", "title": "Isolation sous-sol", "description": "Urethan gigle murs fondation, isolant sous-dalle, pare-vapeur."},
            {"id": "5-4", "title": "Tests etancheite", "description": "Test infiltrometrie, thermographie, corrections, certification."},
        ],
    },
    "6": {
        "name": "6.0 - Finitions Interieures",
        "items": [
            {"id": "6-1", "title": "Gypse - Materiaux", "description": "Gypse 1/2 et 5/8 murs/plafonds, coins, vis, ruban."},
            {"id": "6-2", "title": "Gypse - Main-d'oeuvre", "description": "Pose, tirage joints 3 couches, sablage, retouches."},
            {"id": "6-3", "title": "Peinture", "description": "Apret, 2 couches latex, plafonds blanc, murs couleurs au choix."},
            {"id": "6-4", "title": "Revetements de sol - Materiaux", "description": "Plancher bois franc, ceramique, vinyle luxe selon pieces."},
            {"id": "6-5", "title": "Revetements de sol - Main-d'oeuvre", "description": "Installation, sous-couche, transitions, moulures de finition."},
            {"id": "6-6", "title": "Armoires cuisine", "description": "Armoires melamine/bois, comptoir, quincaillerie, installation."},
            {"id": "6-7", "title": "Armoires salle de bain", "description": "Vanite, miroir, accessoires, installation."},
            {"id": "6-8", "title": "Portes interieures et moulures", "description": "Portes moulees, cadres, poignees, plinthes, cadrages, corniches."},
            {"id": "6-9", "title": "Escalier interieur", "description": "Escalier bois/metal, rampe, garde-corps, finition."},
            {"id": "6-10", "title": "Foyer", "description": "Foyer au gaz ou electrique, manteau, finition, conduit."},
        ],
    },
    "7": {
        "name": "7.0 - Amenagement Exterieur et Garage",
        "items": [
            {"id": "7-1", "title": "Entree de cour", "description": "Asphalte ou pave, bordures, compaction, drainage."},
            {"id": "7-2", "title": "Amenagement paysager", "description": "Gazon, arbres, arbustes, plate-bandes, eclairage."},
            {"id": "7-3", "title": "Clotures et murets", "description": "Cloture bois/fer, muret pierre, portail, installation."},
            {"id": "7-4", "title": "Terrasse exterieure", "description": "Deck bois traite ou composite, structure, escalier, garde-corps."},
            {"id": "7-5", "title": "Nettoyage et livraison", "description": "Nettoyage final, verification, liste deficiences, livraison cles."},
        ],
    },
}


@router.get("/categories")
async def list_c2b_categories():
    """List all C2B construction categories (140+ items)."""
    return {"categories": CATEGORIES_CONSTRUCTION}
