"""
SEAOP React Backend - Database Access Layer
All PostgreSQL queries for the SEAOP API.
Uses RealDictCursor (via PooledConnection) for clean dict results.
Uses parameterized queries (%s) everywhere.
"""

import logging
import os
import sys
import uuid
from datetime import datetime
from typing import Optional

# Add project root to path so we can import database_config
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from database_config import get_connection as get_pg_connection

from .seaop_config import T

logger = logging.getLogger(__name__)


# ============================================
# CONNECTION HELPER
# ============================================

def get_conn():
    """
    Get PostgreSQL connection from pool.
    Returns a PooledConnection that defaults to RealDictCursor.
    """
    return get_pg_connection()


# ============================================
# SCHEMA MIGRATION
# ============================================

_schema_ensured = False


def ensure_schema():
    """
    Run once at startup to add any missing columns/tables.
    Uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so it is safe to call repeatedly.
    """
    global _schema_ensured
    if _schema_ensured:
        return
    conn = get_conn()
    try:
        cursor = conn.cursor()

        # --- Entrepreneurs: RBQ verification columns ---
        for stmt in [
            f"ALTER TABLE {T}entrepreneurs ADD COLUMN IF NOT EXISTS rbq_verifie BOOLEAN DEFAULT FALSE",
            f"ALTER TABLE {T}entrepreneurs ADD COLUMN IF NOT EXISTS categories_rbq TEXT",
            f"ALTER TABLE {T}entrepreneurs ADD COLUMN IF NOT EXISTS assurance_responsabilite BOOLEAN DEFAULT FALSE",
            f"ALTER TABLE {T}entrepreneurs ADD COLUMN IF NOT EXISTS montant_assurance NUMERIC(12,2)",
            f"ALTER TABLE {T}entrepreneurs ADD COLUMN IF NOT EXISTS licence_valide_jusqu_au DATE",
        ]:
            cursor.execute(stmt)

        # --- Soumissions: cautionnement columns ---
        for stmt in [
            f"ALTER TABLE {T}soumissions ADD COLUMN IF NOT EXISTS cautionnement_inclus BOOLEAN DEFAULT FALSE",
            f"ALTER TABLE {T}soumissions ADD COLUMN IF NOT EXISTS montant_cautionnement NUMERIC(12,2)",
            f"ALTER TABLE {T}soumissions ADD COLUMN IF NOT EXISTS type_cautionnement VARCHAR(50)",
        ]:
            cursor.execute(stmt)

        # --- Addenda table ---
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS {T}addenda (
                id SERIAL PRIMARY KEY,
                lead_id INTEGER NOT NULL,
                numero INTEGER NOT NULL,
                titre VARCHAR(200) NOT NULL,
                description TEXT NOT NULL,
                date_creation TIMESTAMP DEFAULT NOW(),
                auteur_email VARCHAR(200)
            )
        """)

        # --- Demandes d'estimation: columns required by the React wizard ---
        # The legacy table (modules/seaop/seaop_db_postgres.py) was minimal; the
        # SEAOP React wizard needs additional columns. Add them if missing so
        # the INSERT in create_estimation_request() succeeds on legacy DBs.
        for stmt in [
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS prenom TEXT",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS entreprise TEXT",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS corps_metier TEXT",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS secteur TEXT",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS urgence TEXT DEFAULT 'normal'",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS disponibilite TEXT DEFAULT 'des_que_possible'",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS date_souhaitee DATE",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS code_postal TEXT",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS localisation TEXT",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS numero_reference TEXT",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS photos JSONB",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS plans JSONB",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS questions_specifiques JSONB",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS montant_estime NUMERIC(12,2)",
            f"ALTER TABLE {T}demandes_estimation ADD COLUMN IF NOT EXISTS estimation_html TEXT",
        ]:
            cursor.execute(stmt)

        # type_projet was NOT NULL in the legacy schema; relax it since the
        # wizard treats it as optional (corps_metier is the required field now).
        try:
            cursor.execute(
                f"ALTER TABLE {T}demandes_estimation ALTER COLUMN type_projet DROP NOT NULL"
            )
        except Exception:
            pass  # already nullable on newer installs
        # Same for nom (now we collect prenom/nom separately; old "nom" stays for back-compat)
        try:
            cursor.execute(
                f"ALTER TABLE {T}demandes_estimation ALTER COLUMN nom DROP NOT NULL"
            )
        except Exception:
            pass

        conn.commit()
        cursor.close()
        _schema_ensured = True
        logger.info("SEAOP schema migration completed successfully")
    except Exception as exc:
        conn.rollback()
        logger.error("SEAOP schema migration failed: %s", exc)
    finally:
        conn.close()


# Run migration on module import
try:
    ensure_schema()
except Exception as exc:
    logger.warning("Schema migration skipped (DB may not be ready): %s", exc)


# ============================================
# SCHEMA MIGRATIONS
# ============================================

def ensure_compliance_columns():
    """
    Ensure the leads table has CNESST/compliance columns.
    Uses ADD COLUMN IF NOT EXISTS so it is safe to call multiple times.
    """
    conn = get_conn()
    try:
        cursor = conn.cursor()
        columns = [
            ("rbq_requis", "BOOLEAN DEFAULT FALSE"),
            ("categories_rbq_requises", "TEXT"),
            ("cnesst_requis", "BOOLEAN DEFAULT FALSE"),
            ("assurance_requise", "BOOLEAN DEFAULT FALSE"),
            ("montant_assurance_min", "NUMERIC"),
            ("cautionnement_requis", "BOOLEAN DEFAULT FALSE"),
            ("pourcentage_cautionnement", "NUMERIC"),
        ]
        for col_name, col_type in columns:
            cursor.execute(
                f"ALTER TABLE {T}leads ADD COLUMN IF NOT EXISTS {col_name} {col_type}"
            )
        conn.commit()
        cursor.close()
        logger.info("Compliance columns ensured on %sleads table", T)
    except Exception as exc:
        conn.rollback()
        logger.error("Error ensuring compliance columns: %s", exc)
    finally:
        conn.close()


# Run migration on module import
ensure_compliance_columns()


# ============================================
# ENTREPRENEUR FUNCTIONS
# ============================================

def get_entrepreneur_by_email(email: str) -> Optional[dict]:
    """Fetch an entrepreneur by email address."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"SELECT * FROM {T}entrepreneurs WHERE email = %s",
            (email,)
        )
        row = cursor.fetchone()
        cursor.close()
        return dict(row) if row else None
    finally:
        conn.close()


def create_entrepreneur(data: dict) -> dict:
    """Insert a new entrepreneur and return the created record."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""INSERT INTO {T}entrepreneurs
                (nom_entreprise, nom_contact, email, telephone,
                 mot_de_passe_hash, numero_rbq, zones_desservies,
                 types_projets, certifications,
                 categories_rbq, assurance_responsabilite,
                 montant_assurance, licence_valide_jusqu_au)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *""",
            (
                data["nom_entreprise"],
                data["nom_contact"],
                data["email"],
                data["telephone"],
                data["mot_de_passe_hash"],
                data.get("numero_rbq"),
                data.get("zones_desservies"),
                data.get("types_projets"),
                data.get("certifications"),
                data.get("categories_rbq"),
                data.get("assurance_responsabilite", False),
                data.get("montant_assurance"),
                data.get("licence_valide_jusqu_au"),
            )
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_entrepreneur_by_id(id: int) -> Optional[dict]:
    """Fetch an entrepreneur by ID."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"SELECT * FROM {T}entrepreneurs WHERE id = %s",
            (id,)
        )
        row = cursor.fetchone()
        cursor.close()
        return dict(row) if row else None
    finally:
        conn.close()


def update_entrepreneur(id: int, data: dict) -> Optional[dict]:
    """Update an entrepreneur's fields. Returns updated record or None."""
    if not data:
        return get_entrepreneur_by_id(id)
    conn = get_conn()
    try:
        set_clauses = []
        values = []
        for key, value in data.items():
            set_clauses.append(f"{key} = %s")
            values.append(value)
        values.append(id)
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE {T}entrepreneurs SET {', '.join(set_clauses)} WHERE id = %s RETURNING *",
            tuple(values)
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(row) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ============================================
# LEAD FUNCTIONS
# ============================================

def generate_reference_number() -> str:
    """Generate a unique reference number: SEAOP-YYYYMMDD-XXXXXXXX."""
    date_str = datetime.now().strftime("%Y%m%d")
    random_hex = uuid.uuid4().hex[:8].upper()
    return f"SEAOP-{date_str}-{random_hex}"


def get_available_leads(
    page: int = 1,
    per_page: int = 20,
    type_projet: Optional[str] = None,
    recherche: Optional[str] = None,
    trier_par: str = "date_desc",
    region: Optional[str] = None,
) -> tuple[list[dict], int]:
    """
    Fetch available leads with pagination, filtering, and sorting.
    Returns (list_of_leads, total_count).
    Each lead includes nb_soumissions via a COUNT subquery.
    """
    # Mapping of region slug to postal code prefixes for Quebec regions
    REGION_POSTAL_PREFIXES: dict[str, list[str]] = {
        "montreal": ["H1", "H2", "H3", "H4", "H5"],
        "laval": ["H7"],
        "longueuil": ["J4"],
        "quebec": ["G1", "G2", "G3"],
        "gatineau": ["J8", "J9"],
        "sherbrooke": ["J1"],
        "trois-rivieres": ["G8", "G9"],
        "saguenay": ["G7"],
        "laurentides": ["J0R", "J7"],
        "lanaudiere": ["J0K", "J5", "J6"],
        "monteregie": ["J0", "J2", "J3"],
        "chaudiere-appalaches": ["G0R", "G0S", "G6"],
        "bas-saint-laurent": ["G0K", "G0L", "G5"],
        "abitibi": ["J0Y", "J0Z", "J9"],
        "cote-nord": ["G0G", "G0H", "G4", "G5"],
        "gaspesie": ["G0C", "G0E", "G4"],
        "nord-du-quebec": ["G0W", "J0Y"],
        "centre-du-quebec": ["G0P", "G0Z", "J1", "J2"],
    }

    conn = get_conn()
    try:
        cursor = conn.cursor()

        # Build WHERE conditions
        conditions = [
            f"l.visible_entrepreneurs = TRUE",
            f"l.accepte_soumissions = TRUE",
        ]
        params: list = []

        if type_projet:
            conditions.append("l.type_projet = %s")
            params.append(type_projet)

        if recherche:
            conditions.append(
                "(l.nom ILIKE %s OR l.description ILIKE %s "
                "OR l.type_projet ILIKE %s OR l.code_postal ILIKE %s "
                "OR l.numero_reference ILIKE %s)"
            )
            like_val = f"%{recherche}%"
            params.extend([like_val, like_val, like_val, like_val, like_val])

        if region and region in REGION_POSTAL_PREFIXES:
            prefixes = REGION_POSTAL_PREFIXES[region]
            like_clauses = ["UPPER(l.code_postal) LIKE %s" for _ in prefixes]
            conditions.append("(" + " OR ".join(like_clauses) + ")")
            params.extend([f"{p.upper()}%" for p in prefixes])

        where_clause = " AND ".join(conditions)

        # Sorting
        order_map = {
            "date_desc": "l.date_creation DESC",
            "date_asc": "l.date_creation ASC",
            "budget_desc": "l.budget DESC",
            "budget_asc": "l.budget ASC",
            "urgence": "CASE l.niveau_urgence WHEN 'urgent' THEN 1 WHEN 'haute' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END ASC",
        }
        order_by = order_map.get(trier_par, "l.date_creation DESC")

        # Total count
        cursor.execute(
            f"SELECT COUNT(*) AS total FROM {T}leads l WHERE {where_clause}",
            tuple(params)
        )
        total = cursor.fetchone()["total"]

        # Paginated results with nb_soumissions subquery
        offset = (page - 1) * per_page
        cursor.execute(
            f"""SELECT l.*,
                    (SELECT COUNT(*) FROM {T}soumissions s WHERE s.lead_id = l.id) AS nb_soumissions
                FROM {T}leads l
                WHERE {where_clause}
                ORDER BY {order_by}
                LIMIT %s OFFSET %s""",
            tuple(params) + (per_page, offset)
        )
        rows = cursor.fetchall()
        cursor.close()
        return ([dict(r) for r in rows], total)
    finally:
        conn.close()


def get_leads_by_email(email: str) -> list[dict]:
    """Fetch all leads belonging to a client email."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""SELECT l.*,
                    (SELECT COUNT(*) FROM {T}soumissions s WHERE s.lead_id = l.id) AS nb_soumissions
                FROM {T}leads l
                WHERE l.email = %s
                ORDER BY l.date_creation DESC""",
            (email,)
        )
        rows = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_lead_by_id(id: int) -> Optional[dict]:
    """Fetch a single lead by ID, including nb_soumissions."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""SELECT l.*,
                    (SELECT COUNT(*) FROM {T}soumissions s WHERE s.lead_id = l.id) AS nb_soumissions
                FROM {T}leads l
                WHERE l.id = %s""",
            (id,)
        )
        row = cursor.fetchone()
        cursor.close()
        return dict(row) if row else None
    finally:
        conn.close()


def create_lead(data: dict) -> dict:
    """Insert a new lead and return the created record."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        ref = data.get("numero_reference") or generate_reference_number()
        cursor.execute(
            f"""INSERT INTO {T}leads
                (nom, email, telephone, code_postal, type_projet, description,
                 budget, delai_realisation, date_limite_soumissions,
                 date_debut_souhaite, niveau_urgence, photos, plans,
                 documents, numero_reference,
                 rbq_requis, categories_rbq_requises, cnesst_requis,
                 assurance_requise, montant_assurance_min,
                 cautionnement_requis, pourcentage_cautionnement)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s)
            RETURNING *""",
            (
                data["nom"],
                data["email"],
                data["telephone"],
                data["code_postal"],
                data["type_projet"],
                data["description"],
                data["budget"],
                data["delai_realisation"],
                data.get("date_limite_soumissions"),
                data.get("date_debut_souhaite"),
                data.get("niveau_urgence", "normal"),
                data.get("photos"),
                data.get("plans"),
                data.get("documents"),
                ref,
                data.get("rbq_requis", False),
                data.get("categories_rbq_requises"),
                data.get("cnesst_requis", False),
                data.get("assurance_requise", False),
                data.get("montant_assurance_min"),
                data.get("cautionnement_requis", False),
                data.get("pourcentage_cautionnement"),
            )
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        result = dict(row)
        result["nb_soumissions"] = 0
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def update_lead(id: int, data: dict) -> Optional[dict]:
    """Update a lead's fields. Returns updated record or None."""
    if not data:
        return get_lead_by_id(id)
    conn = get_conn()
    try:
        set_clauses = []
        values = []
        for key, value in data.items():
            set_clauses.append(f"{key} = %s")
            values.append(value)
        values.append(id)
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE {T}leads SET {', '.join(set_clauses)} WHERE id = %s RETURNING *",
            tuple(values)
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        if row:
            result = dict(row)
            # Fetch nb_soumissions separately
            lead = get_lead_by_id(id)
            result["nb_soumissions"] = lead.get("nb_soumissions", 0) if lead else 0
            return result
        return None
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ============================================
# SOUMISSION FUNCTIONS
# ============================================

def get_soumissions_for_lead(lead_id: int) -> list[dict]:
    """Fetch all soumissions for a given lead, with entrepreneur info joined."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""SELECT s.*,
                    e.nom_entreprise,
                    e.nom_contact,
                    e.email AS entrepreneur_email,
                    e.telephone AS entrepreneur_telephone,
                    e.evaluations_moyenne,
                    e.numero_rbq,
                    e.rbq_verifie,
                    e.assurance_responsabilite
                FROM {T}soumissions s
                LEFT JOIN {T}entrepreneurs e ON s.entrepreneur_id = e.id
                WHERE s.lead_id = %s
                ORDER BY s.date_creation DESC""",
            (lead_id,)
        )
        rows = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_soumissions_by_entrepreneur(entrepreneur_id: int) -> list[dict]:
    """Fetch all soumissions submitted by an entrepreneur."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""SELECT s.*,
                    l.nom AS lead_nom,
                    l.type_projet AS lead_type_projet,
                    l.numero_reference AS lead_numero_reference
                FROM {T}soumissions s
                LEFT JOIN {T}leads l ON s.lead_id = l.id
                WHERE s.entrepreneur_id = %s
                ORDER BY s.date_creation DESC""",
            (entrepreneur_id,)
        )
        rows = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def create_soumission(data: dict) -> dict:
    """Insert a new soumission and return the created record."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""INSERT INTO {T}soumissions
                (lead_id, entrepreneur_id, montant, description_travaux,
                 delai_execution, validite_offre, inclusions, exclusions,
                 conditions, documents,
                 cautionnement_inclus, montant_cautionnement, type_cautionnement)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *""",
            (
                data["lead_id"],
                data["entrepreneur_id"],
                data["montant"],
                data["description_travaux"],
                data["delai_execution"],
                data["validite_offre"],
                data.get("inclusions"),
                data.get("exclusions"),
                data.get("conditions"),
                data.get("documents"),
                data.get("cautionnement_inclus", False),
                data.get("montant_cautionnement"),
                data.get("type_cautionnement"),
            )
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_soumission_by_id(id: int) -> Optional[dict]:
    """Fetch a single soumission by ID, with entrepreneur info joined."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""SELECT s.*,
                    e.nom_entreprise,
                    e.nom_contact,
                    e.email AS entrepreneur_email,
                    e.telephone AS entrepreneur_telephone,
                    e.evaluations_moyenne,
                    e.numero_rbq,
                    e.rbq_verifie,
                    e.assurance_responsabilite
                FROM {T}soumissions s
                LEFT JOIN {T}entrepreneurs e ON s.entrepreneur_id = e.id
                WHERE s.id = %s""",
            (id,)
        )
        row = cursor.fetchone()
        cursor.close()
        return dict(row) if row else None
    finally:
        conn.close()


def update_soumission(id: int, data: dict) -> Optional[dict]:
    """Update a soumission's editable fields. Returns updated record or None."""
    if not data:
        return get_soumission_by_id(id)
    conn = get_conn()
    try:
        set_clauses = []
        values = []
        for key, value in data.items():
            set_clauses.append(f"{key} = %s")
            values.append(value)
        set_clauses.append("date_modification = CURRENT_TIMESTAMP")
        values.append(id)
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE {T}soumissions SET {', '.join(set_clauses)} WHERE id = %s RETURNING *",
            tuple(values)
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(row) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def update_soumission_status(id: int, statut: str) -> Optional[dict]:
    """Update a soumission's status and modification date."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""UPDATE {T}soumissions
                SET statut = %s, date_modification = CURRENT_TIMESTAMP
                WHERE id = %s
                RETURNING *""",
            (statut, id)
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(row) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ============================================
# MESSAGE FUNCTIONS
# ============================================

def get_conversation(lead_id: int, entrepreneur_id: int) -> list[dict]:
    """Fetch all messages in a conversation between client and entrepreneur for a lead."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""SELECT * FROM {T}messages
                WHERE lead_id = %s AND entrepreneur_id = %s
                ORDER BY date_envoi ASC""",
            (lead_id, entrepreneur_id)
        )
        rows = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_conversations_for_user(user_type: str, user_id: int) -> list[dict]:
    """
    Fetch conversation summaries for a user.
    Returns a list of dicts with lead info, other party info,
    last message, and unread count.
    """
    conn = get_conn()
    try:
        cursor = conn.cursor()

        if user_type == "entrepreneur":
            cursor.execute(
                f"""SELECT
                        m.lead_id,
                        m.entrepreneur_id,
                        l.nom AS other_party_name,
                        l.email AS other_party_email,
                        l.type_projet AS lead_type_projet,
                        l.numero_reference AS lead_numero_reference,
                        (SELECT msg.message FROM {T}messages msg
                         WHERE msg.lead_id = m.lead_id AND msg.entrepreneur_id = m.entrepreneur_id
                         ORDER BY msg.date_envoi DESC LIMIT 1) AS last_message,
                        (SELECT msg.date_envoi FROM {T}messages msg
                         WHERE msg.lead_id = m.lead_id AND msg.entrepreneur_id = m.entrepreneur_id
                         ORDER BY msg.date_envoi DESC LIMIT 1) AS last_message_date,
                        (SELECT COUNT(*) FROM {T}messages msg
                         WHERE msg.lead_id = m.lead_id AND msg.entrepreneur_id = m.entrepreneur_id
                         AND msg.lu = FALSE AND msg.destinataire_id = %s) AS unread_count
                    FROM {T}messages m
                    JOIN {T}leads l ON m.lead_id = l.id
                    WHERE m.entrepreneur_id = %s
                    GROUP BY m.lead_id, m.entrepreneur_id,
                             l.nom, l.email, l.type_projet, l.numero_reference
                    ORDER BY last_message_date DESC""",
                (user_id, user_id)
            )
        else:
            # Client: group by entrepreneur
            cursor.execute(
                f"""SELECT
                        m.lead_id,
                        m.entrepreneur_id,
                        e.nom_entreprise AS other_party_name,
                        e.email AS other_party_email,
                        l.type_projet AS lead_type_projet,
                        l.numero_reference AS lead_numero_reference,
                        (SELECT msg.message FROM {T}messages msg
                         WHERE msg.lead_id = m.lead_id AND msg.entrepreneur_id = m.entrepreneur_id
                         ORDER BY msg.date_envoi DESC LIMIT 1) AS last_message,
                        (SELECT msg.date_envoi FROM {T}messages msg
                         WHERE msg.lead_id = m.lead_id AND msg.entrepreneur_id = m.entrepreneur_id
                         ORDER BY msg.date_envoi DESC LIMIT 1) AS last_message_date,
                        (SELECT COUNT(*) FROM {T}messages msg
                         WHERE msg.lead_id = m.lead_id AND msg.entrepreneur_id = m.entrepreneur_id
                         AND msg.lu = FALSE AND msg.destinataire_id = %s) AS unread_count
                    FROM {T}messages m
                    JOIN {T}leads l ON m.lead_id = l.id
                    LEFT JOIN {T}entrepreneurs e ON m.entrepreneur_id = e.id
                    WHERE m.lead_id IN (SELECT id FROM {T}leads WHERE email = (
                        SELECT email FROM {T}leads WHERE id = m.lead_id LIMIT 1
                    ))
                    AND (m.expediteur_id = %s OR m.destinataire_id = %s)
                    GROUP BY m.lead_id, m.entrepreneur_id,
                             e.nom_entreprise, e.email, l.type_projet, l.numero_reference
                    ORDER BY last_message_date DESC""",
                (user_id, user_id, user_id)
            )

        rows = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def create_message(data: dict) -> dict:
    """Insert a new message and return the created record."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""INSERT INTO {T}messages
                (lead_id, entrepreneur_id, expediteur_type, expediteur_id,
                 destinataire_id, message, pieces_jointes)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING *""",
            (
                data["lead_id"],
                data.get("entrepreneur_id"),
                data["expediteur_type"],
                data["expediteur_id"],
                data["destinataire_id"],
                data["message"],
                data.get("pieces_jointes"),
            )
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def mark_messages_read(lead_id: int, entrepreneur_id: int, reader_id: int) -> None:
    """Mark all messages in a conversation as read for the given reader."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""UPDATE {T}messages
                SET lu = TRUE
                WHERE lead_id = %s AND entrepreneur_id = %s
                AND destinataire_id = %s AND lu = FALSE""",
            (lead_id, entrepreneur_id, reader_id)
        )
        conn.commit()
        cursor.close()
    finally:
        conn.close()


# ============================================
# NOTIFICATION FUNCTIONS
# ============================================

def get_notifications(
    user_type: str, user_id: int, limit: int = 20, offset: int = 0
) -> list[dict]:
    """Fetch notifications for a user, ordered by most recent."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""SELECT * FROM {T}notifications
                WHERE utilisateur_type = %s AND user_id = %s
                ORDER BY date_creation DESC
                LIMIT %s OFFSET %s""",
            (user_type, user_id, limit, offset)
        )
        rows = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def count_unread_notifications(user_type: str, user_id: int) -> int:
    """Count unread notifications for a user."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""SELECT COUNT(*) AS cnt FROM {T}notifications
                WHERE utilisateur_type = %s AND user_id = %s AND lu = FALSE""",
            (user_type, user_id)
        )
        row = cursor.fetchone()
        cursor.close()
        return row["cnt"] if row else 0
    finally:
        conn.close()


def mark_notification_read(id: int) -> None:
    """Mark a single notification as read."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE {T}notifications SET lu = TRUE WHERE id = %s",
            (id,)
        )
        conn.commit()
        cursor.close()
    finally:
        conn.close()


def mark_all_notifications_read(user_type: str, user_id: int) -> None:
    """Mark all notifications as read for a user."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""UPDATE {T}notifications SET lu = TRUE
                WHERE utilisateur_type = %s AND user_id = %s AND lu = FALSE""",
            (user_type, user_id)
        )
        conn.commit()
        cursor.close()
    finally:
        conn.close()


def create_notification(data: dict) -> dict:
    """Insert a new notification and return the created record."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        # Defensive: handle legacy tables that have utilisateur_id NOT NULL instead of user_id
        cursor.execute(
            """SELECT column_name FROM information_schema.columns
               WHERE table_name = 'seaop_notifications'
               AND column_name = 'utilisateur_id'"""
        )
        has_utilisateur_id = cursor.fetchone() is not None
        if has_utilisateur_id:
            # Legacy table: set both utilisateur_id and user_id
            cursor.execute(
                f"""INSERT INTO {T}notifications
                    (utilisateur_type, user_id, utilisateur_id, type_notification,
                     titre, message, lien_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *""",
                (
                    data["utilisateur_type"],
                    data["user_id"],
                    data["user_id"],
                    data["type_notification"],
                    data["titre"],
                    data["message"],
                    data.get("lien_id"),
                )
            )
        else:
            cursor.execute(
                f"""INSERT INTO {T}notifications
                    (utilisateur_type, user_id, type_notification,
                     titre, message, lien_id)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING *""",
                (
                    data["utilisateur_type"],
                    data["user_id"],
                    data["type_notification"],
                    data["titre"],
                    data["message"],
                    data.get("lien_id"),
                )
            )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ============================================
# EVALUATION FUNCTIONS
# ============================================

def create_evaluation(data: dict) -> dict:
    """Insert a new evaluation and return the created record."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""INSERT INTO {T}evaluations
                (soumission_id, evaluateur_type, note, commentaire)
            VALUES (%s, %s, %s, %s)
            RETURNING *""",
            (
                data["soumission_id"],
                data["evaluateur_type"],
                data["note"],
                data.get("commentaire"),
            )
        )
        row = cursor.fetchone()
        conn.commit()

        # Update entrepreneur's average rating
        cursor.execute(
            f"""SELECT entrepreneur_id FROM {T}soumissions WHERE id = %s""",
            (data["soumission_id"],)
        )
        soum = cursor.fetchone()
        if soum:
            eid = soum["entrepreneur_id"]
            cursor.execute(
                f"""UPDATE {T}entrepreneurs
                    SET evaluations_moyenne = (
                        SELECT AVG(ev.note) FROM {T}evaluations ev
                        JOIN {T}soumissions so ON ev.soumission_id = so.id
                        WHERE so.entrepreneur_id = %s
                    ),
                    nombre_evaluations = (
                        SELECT COUNT(*) FROM {T}evaluations ev
                        JOIN {T}soumissions so ON ev.soumission_id = so.id
                        WHERE so.entrepreneur_id = %s
                    )
                    WHERE id = %s""",
                (eid, eid, eid)
            )
            conn.commit()

        cursor.close()
        return dict(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_evaluations_for_soumission(soumission_id: int) -> list[dict]:
    """Fetch evaluations for a given soumission."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"SELECT * FROM {T}evaluations WHERE soumission_id = %s ORDER BY date_evaluation DESC",
            (soumission_id,)
        )
        rows = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_evaluations_for_entrepreneur(entrepreneur_id: int, limit: int = 10) -> dict:
    """
    Fetch evaluation stats and recent comments for an entrepreneur.
    Returns: { moyenne, count, evaluations: [...] }
    """
    conn = get_conn()
    try:
        cursor = conn.cursor()
        # Aggregate stats
        cursor.execute(
            f"""SELECT
                    COALESCE(AVG(ev.note), 0) AS moyenne,
                    COUNT(*) AS count
                FROM {T}evaluations ev
                JOIN {T}soumissions s ON ev.soumission_id = s.id
                WHERE s.entrepreneur_id = %s""",
            (entrepreneur_id,)
        )
        stats = cursor.fetchone()

        # Recent evaluations with comments
        cursor.execute(
            f"""SELECT ev.*, s.lead_id
                FROM {T}evaluations ev
                JOIN {T}soumissions s ON ev.soumission_id = s.id
                WHERE s.entrepreneur_id = %s
                ORDER BY ev.date_evaluation DESC
                LIMIT %s""",
            (entrepreneur_id, limit)
        )
        rows = cursor.fetchall()
        cursor.close()

        return {
            "moyenne": float(stats["moyenne"]) if stats else 0,
            "count": stats["count"] if stats else 0,
            "evaluations": [dict(r) for r in rows],
        }
    finally:
        conn.close()


# ============================================
# ADDENDA FUNCTIONS
# ============================================

def create_addendum(lead_id: int, data: dict) -> dict:
    """Insert a new addendum for a lead. Auto-calculates the next numero."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        # Get next addendum number
        cursor.execute(
            f"SELECT COALESCE(MAX(numero), 0) + 1 AS next_num FROM {T}addenda WHERE lead_id = %s",
            (lead_id,)
        )
        next_num = cursor.fetchone()["next_num"]

        cursor.execute(
            f"""INSERT INTO {T}addenda
                (lead_id, numero, titre, description, auteur_email)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *""",
            (
                lead_id,
                next_num,
                data["titre"],
                data["description"],
                data.get("auteur_email"),
            )
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_addenda(lead_id: int) -> list[dict]:
    """Fetch all addenda for a lead, ordered by numero."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"SELECT * FROM {T}addenda WHERE lead_id = %s ORDER BY numero ASC",
            (lead_id,)
        )
        rows = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ============================================
# CHAT ROOM FUNCTIONS
# ============================================

def get_chat_messages(pinned: bool = False, limit: int = 50, offset: int = 0) -> list[dict]:
    """Get chat room messages. If pinned=True, only pinned messages."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        if pinned:
            cursor.execute(
                f"""SELECT * FROM {T}chat_room
                    WHERE is_pinned = TRUE AND is_deleted = FALSE
                    ORDER BY created_at DESC"""
            )
        else:
            cursor.execute(
                f"""SELECT * FROM {T}chat_room
                    WHERE is_deleted = FALSE AND is_pinned = FALSE
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s""",
                (limit, offset)
            )
        rows = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def create_chat_message(data: dict) -> dict:
    """Insert a new chat room message and return the created record."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""INSERT INTO {T}chat_room
                (user_type, user_name, user_email, user_id, message, parent_id, user_badge)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING *""",
            (
                data["user_type"],
                data["user_name"],
                data["user_email"],
                data.get("user_id"),
                data["message"],
                data.get("parent_id"),
                data.get("user_badge"),
            )
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def toggle_chat_like(message_id: int, user_email: str) -> bool:
    """Toggle like on a chat message. Returns True if liked, False if unliked."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        # Check if already liked
        cursor.execute(
            f"SELECT id FROM {T}chat_room_likes WHERE message_id = %s AND user_email = %s",
            (message_id, user_email)
        )
        existing = cursor.fetchone()
        if existing:
            cursor.execute(
                f"DELETE FROM {T}chat_room_likes WHERE message_id = %s AND user_email = %s",
                (message_id, user_email)
            )
            cursor.execute(
                f"UPDATE {T}chat_room SET likes = GREATEST(likes - 1, 0) WHERE id = %s",
                (message_id,)
            )
            conn.commit()
            cursor.close()
            return False
        else:
            cursor.execute(
                f"INSERT INTO {T}chat_room_likes (message_id, user_email) VALUES (%s, %s)",
                (message_id, user_email)
            )
            cursor.execute(
                f"UPDATE {T}chat_room SET likes = likes + 1 WHERE id = %s",
                (message_id,)
            )
            conn.commit()
            cursor.close()
            return True
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def toggle_chat_pin(message_id: int) -> bool:
    """Toggle pin on a chat message. Returns new pinned state."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE {T}chat_room SET is_pinned = NOT is_pinned WHERE id = %s RETURNING is_pinned",
            (message_id,)
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return row["is_pinned"] if row else False
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def delete_chat_message(message_id: int, deleted_by: str) -> None:
    """Soft-delete a chat message by marking is_deleted=TRUE."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE {T}chat_room SET is_deleted = TRUE, deleted_by = %s WHERE id = %s",
            (deleted_by, message_id)
        )
        conn.commit()
        cursor.close()
    finally:
        conn.close()


def get_online_users(minutes: int = 5) -> list[dict]:
    """Get users who have been active in the last N minutes."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""SELECT * FROM {T}chat_room_online
                WHERE last_seen > NOW() - make_interval(mins => %s)
                ORDER BY last_seen DESC
                LIMIT 20""",
            (minutes,)
        )
        rows = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def update_online_status(
    user_type: str, user_name: str, user_email: str, is_typing: bool = False
) -> None:
    """Insert or update user presence in the online users table."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""INSERT INTO {T}chat_room_online
                (user_type, user_name, user_email, last_seen, is_typing)
            VALUES (%s, %s, %s, NOW(), %s)
            ON CONFLICT (user_email) DO UPDATE
                SET last_seen = NOW(), is_typing = %s, user_name = %s""",
            (user_type, user_name, user_email, is_typing, is_typing, user_name)
        )
        conn.commit()
        cursor.close()
    finally:
        conn.close()


def get_chat_stats() -> dict:
    """Get chat room statistics: total messages and unique participants."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"SELECT COUNT(*) AS total FROM {T}chat_room WHERE is_deleted = FALSE"
        )
        total = cursor.fetchone()["total"]
        cursor.execute(
            f"SELECT COUNT(DISTINCT user_email) AS participants FROM {T}chat_room WHERE is_deleted = FALSE"
        )
        participants = cursor.fetchone()["participants"]
        cursor.close()
        return {"total_messages": total, "total_participants": participants}
    finally:
        conn.close()


def get_user_likes(user_email: str, message_ids: list[int]) -> set[int]:
    """Get which messages the user has liked from a list of message IDs."""
    if not message_ids:
        return set()
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""SELECT message_id FROM {T}chat_room_likes
                WHERE user_email = %s AND message_id = ANY(%s)""",
            (user_email, message_ids)
        )
        rows = cursor.fetchall()
        cursor.close()
        return {row["message_id"] for row in rows}
    finally:
        conn.close()


def upsert_evaluation(data: dict) -> dict:
    """
    Insert or update an evaluation (one per soumission per evaluateur_type).
    Also updates the entrepreneur's average rating.
    Returns the created/updated evaluation record.
    """
    conn = get_conn()
    try:
        cursor = conn.cursor()
        # Check if evaluation already exists for this soumission
        cursor.execute(
            f"""SELECT id FROM {T}evaluations
                WHERE soumission_id = %s AND evaluateur_type = %s""",
            (data["soumission_id"], data["evaluateur_type"])
        )
        existing = cursor.fetchone()

        if existing:
            # Update existing evaluation
            cursor.execute(
                f"""UPDATE {T}evaluations
                    SET note = %s, commentaire = %s, date_evaluation = CURRENT_TIMESTAMP
                    WHERE id = %s
                    RETURNING *""",
                (data["note"], data.get("commentaire"), existing["id"])
            )
        else:
            # Insert new evaluation
            cursor.execute(
                f"""INSERT INTO {T}evaluations
                    (soumission_id, evaluateur_type, note, commentaire)
                VALUES (%s, %s, %s, %s)
                RETURNING *""",
                (
                    data["soumission_id"],
                    data["evaluateur_type"],
                    data["note"],
                    data.get("commentaire"),
                )
            )
        row = cursor.fetchone()
        conn.commit()

        # Update entrepreneur's average rating
        cursor.execute(
            f"SELECT entrepreneur_id FROM {T}soumissions WHERE id = %s",
            (data["soumission_id"],)
        )
        soum = cursor.fetchone()
        if soum:
            eid = soum["entrepreneur_id"]
            cursor.execute(
                f"""UPDATE {T}entrepreneurs
                    SET evaluations_moyenne = (
                        SELECT AVG(ev.note) FROM {T}evaluations ev
                        JOIN {T}soumissions so ON ev.soumission_id = so.id
                        WHERE so.entrepreneur_id = %s
                    ),
                    nombre_evaluations = (
                        SELECT COUNT(*) FROM {T}evaluations ev
                        JOIN {T}soumissions so ON ev.soumission_id = so.id
                        WHERE so.entrepreneur_id = %s
                    )
                    WHERE id = %s""",
                (eid, eid, eid)
            )
            conn.commit()

        cursor.close()
        return dict(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ============================================
# PROFESSIONAL SERVICES
# ============================================

def create_service_request(service_type: str, data: dict) -> dict:
    """Create a service request. service_type: estimation, technologue, architecture, ingenieur"""
    table_map = {
        'estimation': f'{T}demandes_estimation',
        'technologue': f'{T}demandes_technologue',
        'architecture': f'{T}demandes_architecture',
        'ingenieur': f'{T}demandes_ingenieur',
    }
    table = table_map.get(service_type)
    if not table:
        raise ValueError(f"Unknown service type: {service_type}")
    conn = get_conn()
    try:
        cursor = conn.cursor()
        # Generate reference number
        ref = generate_reference_number()
        data['numero_reference'] = ref
        cols = ', '.join(data.keys())
        placeholders = ', '.join(['%s'] * len(data))
        cursor.execute(f"INSERT INTO {table} ({cols}) VALUES ({placeholders}) RETURNING *", list(data.values()))
        result = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(result)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_service_requests_by_email(service_type: str, email: str) -> list[dict]:
    """Fetch service requests by client email."""
    table_map = {
        'estimation': f'{T}demandes_estimation',
        'technologue': f'{T}demandes_technologue',
        'architecture': f'{T}demandes_architecture',
        'ingenieur': f'{T}demandes_ingenieur',
    }
    table = table_map.get(service_type)
    if not table:
        return []
    email_col = 'email' if service_type == 'estimation' else 'email_client'
    conn = get_conn()
    try:
        cursor = conn.cursor()
        # Legacy tables may not have date_demande — fall back to id ordering.
        try:
            cursor.execute(
                f"SELECT * FROM {table} WHERE {email_col} = %s "
                "ORDER BY date_demande DESC NULLS LAST, id DESC",
                (email,)
            )
        except Exception as exc:
            msg = str(exc).lower()
            if "date_demande" not in msg:
                raise
            conn.rollback()
            # Fresh cursor after rollback: reusing a cursor whose last execute
            # errored is undefined behaviour on some psycopg2/pgbouncer combos.
            try:
                cursor.close()
            except Exception:
                pass
            cursor = conn.cursor()
            cursor.execute(
                f"SELECT * FROM {table} WHERE {email_col} = %s ORDER BY id DESC",
                (email,)
            )
        rows = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_all_service_requests(service_type: str, statut: str = None) -> list[dict]:
    """Fetch all service requests, optionally filtered by status. Admin use."""
    table_map = {
        'estimation': f'{T}demandes_estimation',
        'technologue': f'{T}demandes_technologue',
        'architecture': f'{T}demandes_architecture',
        'ingenieur': f'{T}demandes_ingenieur',
    }
    table = table_map.get(service_type)
    if not table:
        return []
    conn = get_conn()
    try:
        cursor = conn.cursor()
        if statut:
            cursor.execute(f"SELECT * FROM {table} WHERE statut = %s ORDER BY id DESC", (statut,))
        else:
            cursor.execute(f"SELECT * FROM {table} ORDER BY id DESC")
        rows = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def update_service_request(service_type: str, request_id: int, data: dict) -> dict:
    """Update a service request's fields. Returns updated record."""
    table_map = {
        'estimation': f'{T}demandes_estimation',
        'technologue': f'{T}demandes_technologue',
        'architecture': f'{T}demandes_architecture',
        'ingenieur': f'{T}demandes_ingenieur',
    }
    table = table_map.get(service_type)
    if not table:
        raise ValueError(f"Unknown service type: {service_type}")
    conn = get_conn()
    try:
        cursor = conn.cursor()
        set_clause = ', '.join([f"{k} = %s" for k in data.keys()])
        values = list(data.values()) + [request_id]
        cursor.execute(f"UPDATE {table} SET {set_clause} WHERE id = %s RETURNING *", values)
        result = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(result) if result else None
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ============================================
# ESTIMATION REQUESTS (simplified single-type API)
# ============================================
# These functions are the new entry points for the redesigned public
# Estimation wizard. They operate on seaop_demandes_estimation only and
# supersede the generic create_service_request / get_all_service_requests
# for this specific flow.

def _generate_estimation_reference() -> str:
    """Generate a unique reference number: EST-YYYYMMDD-XXXXXXXX."""
    date_str = datetime.now().strftime("%Y%m%d")
    random_hex = uuid.uuid4().hex[:8].upper()
    return f"EST-{date_str}-{random_hex}"


def _normalize_estimation_row(row: dict) -> dict:
    """
    Ensure JSONB columns (photos, plans, questions_specifiques) come back as
    Python objects regardless of psycopg2's default-jsonb registration state.
    If the column is returned as a JSON-encoded string (older psycopg2), parse
    it once here so the rest of the app always sees list/dict.
    """
    import json as _json
    if not row:
        return row
    for key, fallback in (("photos", []), ("plans", []), ("questions_specifiques", {})):
        value = row.get(key)
        if isinstance(value, (bytes, memoryview)):
            try:
                value = bytes(value).decode("utf-8")
            except Exception:
                value = fallback
                row[key] = value
                continue
        if isinstance(value, str):
            try:
                row[key] = _json.loads(value) if value else fallback
            except (ValueError, TypeError):
                row[key] = fallback
        elif value is None:
            row[key] = fallback
    return row


def create_estimation_request(data: dict) -> dict:
    """
    Insert a new row in seaop_demandes_estimation and return the full record.
    Generates numero_reference automatically if not provided.
    """
    payload = dict(data)  # shallow copy (don't mutate caller's dict)
    payload.setdefault("numero_reference", _generate_estimation_reference())

    conn = get_conn()
    try:
        cursor = conn.cursor()
        cols = ", ".join(payload.keys())
        placeholders = ", ".join(["%s"] * len(payload))
        cursor.execute(
            f"INSERT INTO {T}demandes_estimation ({cols}) VALUES ({placeholders}) RETURNING *",
            list(payload.values()),
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return _normalize_estimation_row(dict(row))
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def list_estimation_requests(statut: Optional[str] = None) -> list[dict]:
    """List all estimation requests (admin)."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        if statut:
            cursor.execute(
                f"SELECT * FROM {T}demandes_estimation WHERE statut = %s ORDER BY id DESC",
                (statut,),
            )
        else:
            cursor.execute(f"SELECT * FROM {T}demandes_estimation ORDER BY id DESC")
        rows = cursor.fetchall()
        cursor.close()
        return [_normalize_estimation_row(dict(r)) for r in rows]
    finally:
        conn.close()


def get_estimation_request(request_id: int) -> Optional[dict]:
    """Fetch a single estimation request by id."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"SELECT * FROM {T}demandes_estimation WHERE id = %s",
            (request_id,),
        )
        row = cursor.fetchone()
        cursor.close()
        return _normalize_estimation_row(dict(row)) if row else None
    finally:
        conn.close()


def update_estimation_request(request_id: int, data: dict) -> Optional[dict]:
    """Update fields on an estimation request (admin)."""
    if not data:
        return get_estimation_request(request_id)

    conn = get_conn()
    try:
        cursor = conn.cursor()
        set_clause = ", ".join([f"{k} = %s" for k in data.keys()])
        values = list(data.values()) + [request_id]
        cursor.execute(
            f"UPDATE {T}demandes_estimation SET {set_clause} WHERE id = %s RETURNING *",
            values,
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return _normalize_estimation_row(dict(row)) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ============================================
# ADMIN STATS
# ============================================

def get_admin_stats() -> dict:
    """Get dashboard statistics for admin panel."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        stats = {}
        cursor.execute(f"SELECT COUNT(*) as c FROM {T}leads")
        stats['total_projets'] = cursor.fetchone()['c']
        cursor.execute(f"SELECT COUNT(*) as c FROM {T}entrepreneurs")
        stats['total_entrepreneurs'] = cursor.fetchone()['c']
        cursor.execute(f"SELECT COUNT(*) as c FROM {T}soumissions")
        stats['total_soumissions'] = cursor.fetchone()['c']
        cursor.execute(f"SELECT COALESCE(SUM(montant), 0) as total FROM {T}soumissions WHERE statut = 'acceptee'")
        stats['ca_total'] = float(cursor.fetchone()['total'])
        # Top 5 entrepreneurs
        cursor.execute(f"""
            SELECT e.id, e.nom_entreprise, e.evaluations_moyenne, e.nombre_evaluations,
                   COUNT(s.id) as nb_soumissions,
                   COUNT(CASE WHEN s.statut = 'acceptee' THEN 1 END) as nb_acceptees,
                   COALESCE(SUM(CASE WHEN s.statut = 'acceptee' THEN s.montant ELSE 0 END), 0) as revenus
            FROM {T}entrepreneurs e
            LEFT JOIN {T}soumissions s ON s.entrepreneur_id = e.id
            GROUP BY e.id, e.nom_entreprise, e.evaluations_moyenne, e.nombre_evaluations
            ORDER BY nb_acceptees DESC, revenus DESC
            LIMIT 5
        """)
        rows = cursor.fetchall()
        stats['top_entrepreneurs'] = [dict(r) for r in rows]
        # Monthly project creation (last 6 months)
        cursor.execute(f"""
            SELECT DATE_TRUNC('month', date_creation) as mois, COUNT(*) as total
            FROM {T}leads
            WHERE date_creation > NOW() - INTERVAL '6 months'
            GROUP BY mois ORDER BY mois
        """)
        rows = cursor.fetchall()
        stats['evolution_projets'] = [dict(r) for r in rows]
        cursor.close()
        return stats
    finally:
        conn.close()


def get_all_entrepreneurs(statut: str = None) -> list[dict]:
    """Fetch all entrepreneurs, optionally filtered by status. Admin use."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        if statut:
            cursor.execute(f"SELECT * FROM {T}entrepreneurs WHERE statut = %s ORDER BY id DESC", (statut,))
        else:
            cursor.execute(f"SELECT * FROM {T}entrepreneurs ORDER BY id DESC")
        rows = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_all_soumissions_admin() -> list[dict]:
    """Fetch recent soumissions with entrepreneur and lead info. Admin use."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(f"""
            SELECT s.*, e.nom_entreprise, e.numero_rbq, l.type_projet, l.numero_reference as lead_reference
            FROM {T}soumissions s
            LEFT JOIN {T}entrepreneurs e ON e.id = s.entrepreneur_id
            LEFT JOIN {T}leads l ON l.id = s.lead_id
            ORDER BY s.date_creation DESC NULLS LAST, s.id DESC
            LIMIT 100
        """)
        rows = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def update_entrepreneur_admin(entrepreneur_id: int, data: dict) -> dict:
    """Admin update of entrepreneur fields (status, credits, subscription)."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        set_clause = ', '.join([f"{k} = %s" for k in data.keys()])
        values = list(data.values()) + [entrepreneur_id]
        cursor.execute(
            f"UPDATE {T}entrepreneurs SET {set_clause} WHERE id = %s RETURNING *",
            values
        )
        result = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(result) if result else None
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def verify_entrepreneur_rbq(entrepreneur_id: int) -> dict:
    """Set rbq_verifie=TRUE for an entrepreneur and return the updated record."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE {T}entrepreneurs SET rbq_verifie = TRUE WHERE id = %s RETURNING *",
            (entrepreneur_id,)
        )
        result = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(result) if result else None
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
