"""
ERP React Backend - Database Layer
Tenant-aware database operations using the existing database_config.py pool.
"""

import os
import sys
import logging
import re

logger = logging.getLogger(__name__)

# Import from project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

try:
    import database_config as _db_config_module
    from database_config import get_connection as _pool_get_connection

    # Override pool size for resource-constrained environments (Render Starter = 512MB)
    if os.getenv("ENVIRONMENT", "").lower() == "production":
        if hasattr(_db_config_module, "POOL_MIN_CONNECTIONS"):
            _db_config_module.POOL_MIN_CONNECTIONS = 2
        if hasattr(_db_config_module, "POOL_MAX_CONNECTIONS"):
            _db_config_module.POOL_MAX_CONNECTIONS = 10
        logger.info("Production mode: pool overridden to min=2, max=10")
except ImportError:
    logger.warning("database_config not found - using direct psycopg2 connection")
    _pool_get_connection = None

try:
    import psycopg2
    import psycopg2.extras
    from psycopg2 import sql as psql
except ImportError:
    psycopg2 = None
    psql = None


# ============================================
# CONNECTION HELPERS
# ============================================

def get_conn():
    """Get a database connection from the pool or direct."""
    if _pool_get_connection:
        return _pool_get_connection()

    # Direct fallback
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        raise RuntimeError("DATABASE_URL not set and database_config not available")
    conn = psycopg2.connect(db_url, cursor_factory=psycopg2.extras.RealDictCursor, connect_timeout=10)
    return conn


def validate_schema_name(schema: str) -> bool:
    """Validate schema name to prevent SQL injection."""
    if not schema:
        return False
    return bool(re.match(r'^tenant_[a-zA-Z0-9_]+$', schema))


def set_tenant(conn, schema: str):
    """Set the search_path to a tenant schema using safe identifiers."""
    if not validate_schema_name(schema):
        raise ValueError(f"Invalid schema name: {schema}")
    cursor = conn.cursor()
    query = psql.SQL("SET search_path TO {}, public").format(psql.Identifier(schema))
    cursor.execute(query)
    cursor.close()


def reset_tenant(conn):
    """Reset search_path to public."""
    cursor = conn.cursor()
    cursor.execute("SET search_path TO public")
    cursor.close()


# ============================================
# AUTH QUERIES
# ============================================

def get_entreprise_by_email(email: str) -> dict | None:
    """Look up an entreprise by email in public.entreprises."""
    conn = get_conn()
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM public.entreprises WHERE LOWER(email) = LOWER(%s)",
            (email.strip(),),
        )
        return cursor.fetchone()
    except Exception as exc:
        logger.error("get_entreprise_by_email error: %s", exc)
        return None
    finally:
        if cursor:
            cursor.close()
        conn.close()


def get_entreprise_by_id(entreprise_id: int) -> dict | None:
    """Look up an entreprise by ID."""
    conn = get_conn()
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM public.entreprises WHERE id = %s",
            (entreprise_id,),
        )
        return cursor.fetchone()
    except Exception as exc:
        logger.error("get_entreprise_by_id error: %s", exc)
        return None
    finally:
        if cursor:
            cursor.close()
        conn.close()


def get_user_by_username(schema: str, username: str) -> dict | None:
    """Look up a user in the tenant schema."""
    conn = get_conn()
    try:
        set_tenant(conn, schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM users WHERE LOWER(username) = LOWER(%s) AND active = TRUE",
            (username,),
        )
        result = cursor.fetchone()
        cursor.close()
        reset_tenant(conn)
        return result
    except Exception as exc:
        logger.error("get_user_by_username error: %s", exc)
        return None
    finally:
        conn.close()


def get_user_by_email(schema: str, email: str) -> dict | None:
    """Look up a user by email in the tenant schema."""
    conn = get_conn()
    try:
        set_tenant(conn, schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM users WHERE LOWER(email) = LOWER(%s) AND active = TRUE",
            (email,),
        )
        result = cursor.fetchone()
        cursor.close()
        reset_tenant(conn)
        return result
    except Exception as exc:
        logger.error("get_user_by_email error: %s", exc)
        return None
    finally:
        conn.close()


def get_user_by_id(schema: str, user_id: int) -> dict | None:
    """Look up a user by ID in the tenant schema."""
    conn = get_conn()
    try:
        set_tenant(conn, schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM users WHERE id = %s",
            (user_id,),
        )
        result = cursor.fetchone()
        cursor.close()
        reset_tenant(conn)
        return result
    except Exception as exc:
        logger.error("get_user_by_id error: %s", exc)
        return None
    finally:
        conn.close()


def get_super_admin(username: str) -> dict | None:
    """Look up a super-admin by username."""
    conn = get_conn()
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, username, password_hash, email, full_name "
            "FROM public.super_admins WHERE username = %s AND active = TRUE",
            (username,),
        )
        return cursor.fetchone()
    except Exception as exc:
        logger.error("get_super_admin error: %s", exc)
        return None
    finally:
        if cursor:
            cursor.close()
        conn.close()


def list_entreprises() -> list[dict]:
    """List all entreprises (for super-admin)."""
    conn = get_conn()
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM public.entreprises ORDER BY created_at DESC"
        )
        return cursor.fetchall()
    except Exception as exc:
        logger.error("list_entreprises error: %s", exc)
        return []
    finally:
        if cursor:
            cursor.close()
        conn.close()


# ============================================
# DASHBOARD QUERIES
# ============================================

def get_dashboard_stats(schema: str) -> dict:
    """Get consolidated dashboard KPIs for a tenant. Each query is independent."""
    conn = get_conn()
    stats = {}

    def _safe_count(cursor, query, params=None):
        """Execute a count query safely, rollback on error."""
        try:
            cursor.execute(query, params)
            return cursor.fetchone()["total"]
        except Exception:
            conn.rollback()
            set_tenant(conn, schema)
            return 0

    try:
        set_tenant(conn, schema)
        cursor = conn.cursor()

        stats["projects_total"] = _safe_count(cursor, "SELECT COUNT(*) as total FROM projects")
        stats["projects_en_cours"] = _safe_count(cursor, "SELECT COUNT(*) as total FROM projects WHERE statut IN ('En cours', 'EN_COURS')")
        stats["projects_termines"] = _safe_count(cursor, "SELECT COUNT(*) as total FROM projects WHERE statut IN ('Termine', 'TERMINE', 'Terminé')")
        stats["companies_total"] = _safe_count(cursor, "SELECT COUNT(*) as total FROM companies")
        stats["employes_actifs"] = _safe_count(cursor, "SELECT COUNT(*) as total FROM employees WHERE statut = 'ACTIF'")
        stats["devis_total"] = _safe_count(cursor, "SELECT COUNT(*) as total FROM devis")
        stats["devis_brouillon"] = _safe_count(cursor, "SELECT COUNT(*) as total FROM devis WHERE statut IN ('Brouillon', 'BROUILLON')")
        stats["devis_acceptes"] = _safe_count(cursor, "SELECT COUNT(*) as total FROM devis WHERE statut IN ('Accepte', 'ACCEPTE', 'Accepté')")
        stats["factures_total"] = _safe_count(cursor, "SELECT COUNT(*) as total FROM factures")
        stats["factures_solde_du"] = 0
        try:
            cursor.execute("SELECT COALESCE(SUM(solde_du), 0) as total FROM factures WHERE statut NOT IN ('PAYEE', 'ANNULEE')")
            stats["factures_solde_du"] = float(cursor.fetchone()["total"])
        except Exception:
            conn.rollback()
            set_tenant(conn, schema)
        stats["produits_total"] = _safe_count(cursor, "SELECT COUNT(*) as total FROM produits WHERE active = TRUE")
        stats["fournisseurs_total"] = _safe_count(cursor, "SELECT COUNT(*) as total FROM fournisseurs WHERE active = TRUE")
        stats["bt_total"] = _safe_count(cursor, "SELECT COUNT(*) as total FROM formulaires WHERE type_formulaire = 'BON_TRAVAIL'")
        stats["bt_en_cours"] = _safe_count(cursor, "SELECT COUNT(*) as total FROM formulaires WHERE type_formulaire = 'BON_TRAVAIL' AND statut = 'EN_COURS'")

        # ---------------------------------------------------
        # NEW STATS — each wrapped in try/except so failures
        # never break the existing stats above.
        # ---------------------------------------------------

        # Ventes / CRM
        try:
            stats["clients_actifs"] = _safe_count(
                cursor,
                "SELECT COUNT(*) as total FROM companies WHERE type_company = 'CLIENT'"
            )
        except Exception:
            conn.rollback(); set_tenant(conn, schema)

        try:
            stats["contacts_total"] = _safe_count(
                cursor,
                "SELECT COUNT(*) as total FROM contacts"
            )
        except Exception:
            conn.rollback(); set_tenant(conn, schema)

        try:
            stats["opportunites_ouvertes"] = _safe_count(
                cursor,
                "SELECT COUNT(*) as total FROM opportunities WHERE statut NOT IN ('GAGNEE', 'PERDUE', 'FERMEE')"
            )
        except Exception:
            conn.rollback(); set_tenant(conn, schema)

        try:
            cursor.execute(
                "SELECT COALESCE(SUM(montant_estime), 0) as total FROM opportunities "
                "WHERE statut NOT IN ('GAGNEE', 'PERDUE', 'FERMEE')"
            )
            stats["pipeline_value"] = float(cursor.fetchone()["total"])
        except Exception:
            stats.setdefault("pipeline_value", 0.0)
            conn.rollback(); set_tenant(conn, schema)

        # Devis extra
        try:
            stats["devis_en_attente"] = _safe_count(
                cursor,
                "SELECT COUNT(*) as total FROM devis WHERE statut IN ('En attente', 'EN_ATTENTE')"
            )
        except Exception:
            conn.rollback(); set_tenant(conn, schema)

        try:
            devis_total = stats.get("devis_total", 0)
            devis_acceptes = stats.get("devis_acceptes", 0)
            if devis_total > 0:
                stats["devis_taux_conversion"] = round(devis_acceptes / devis_total * 100, 1)
            else:
                stats["devis_taux_conversion"] = 0.0
        except Exception:
            stats.setdefault("devis_taux_conversion", 0.0)

        try:
            cursor.execute(
                "SELECT COALESCE(SUM(investissement_total), 0) as total FROM devis"
            )
            stats["devis_montant_total"] = float(cursor.fetchone()["total"])
        except Exception:
            stats.setdefault("devis_montant_total", 0.0)
            conn.rollback(); set_tenant(conn, schema)

        # Projets extra
        try:
            stats["projects_actifs"] = _safe_count(
                cursor,
                "SELECT COUNT(*) as total FROM projects WHERE statut IN ('En cours', 'EN_COURS', 'ACTIF')"
            )
        except Exception:
            conn.rollback(); set_tenant(conn, schema)

        try:
            cursor.execute(
                "SELECT COALESCE(AVG(pourcentage_completion), 0) as total FROM projects "
                "WHERE statut IN ('En cours', 'EN_COURS')"
            )
            stats["projects_taux_completion"] = round(float(cursor.fetchone()["total"]), 1)
        except Exception:
            stats.setdefault("projects_taux_completion", 0.0)
            conn.rollback(); set_tenant(conn, schema)

        try:
            cursor.execute(
                "SELECT COALESCE(SUM(budget_total), 0) as total FROM projects"
            )
            stats["projects_ca_total"] = float(cursor.fetchone()["total"])
        except Exception:
            stats.setdefault("projects_ca_total", 0.0)
            conn.rollback(); set_tenant(conn, schema)

        # Inventaire
        try:
            stats["inventaire_total_articles"] = _safe_count(
                cursor,
                "SELECT COUNT(*) as total FROM produits WHERE active = TRUE"
            )
        except Exception:
            conn.rollback(); set_tenant(conn, schema)

        try:
            cursor.execute(
                "SELECT COALESCE(SUM(stock_disponible), 0) as total FROM produits WHERE active = TRUE"
            )
            stats["inventaire_quantite_totale"] = int(cursor.fetchone()["total"])
        except Exception:
            stats.setdefault("inventaire_quantite_totale", 0)
            conn.rollback(); set_tenant(conn, schema)

        try:
            cursor.execute(
                "SELECT COALESCE(SUM(stock_disponible * COALESCE(cout_revient, prix_unitaire, 0)), 0) as total "
                "FROM produits WHERE active = TRUE"
            )
            stats["inventaire_valeur_stock"] = round(float(cursor.fetchone()["total"]), 2)
        except Exception:
            stats.setdefault("inventaire_valeur_stock", 0.0)
            conn.rollback(); set_tenant(conn, schema)

        try:
            stats["inventaire_stock_critique"] = _safe_count(
                cursor,
                "SELECT COUNT(*) as total FROM produits WHERE active = TRUE AND stock_disponible <= stock_minimum"
            )
        except Exception:
            conn.rollback(); set_tenant(conn, schema)

        try:
            cursor.execute(
                "SELECT COUNT(DISTINCT categorie) as total FROM produits WHERE active = TRUE AND categorie IS NOT NULL"
            )
            stats["inventaire_categories"] = int(cursor.fetchone()["total"])
        except Exception:
            stats.setdefault("inventaire_categories", 0)
            conn.rollback(); set_tenant(conn, schema)

        # RH extra
        try:
            stats["employes_total"] = _safe_count(
                cursor,
                "SELECT COUNT(*) as total FROM employees"
            )
        except Exception:
            conn.rollback(); set_tenant(conn, schema)

        try:
            cursor.execute(
                "SELECT COALESCE(AVG(salaire), 0) as total FROM employees WHERE statut = 'ACTIF' AND salaire > 0"
            )
            stats["employes_salaire_moyen"] = round(float(cursor.fetchone()["total"]), 2)
        except Exception:
            stats.setdefault("employes_salaire_moyen", 0.0)
            conn.rollback(); set_tenant(conn, schema)

        try:
            stats["employes_surcharges"] = _safe_count(
                cursor,
                "SELECT COUNT(*) as total FROM employees WHERE statut = 'ACTIF' AND charge_travail > 100"
            )
        except Exception:
            conn.rollback(); set_tenant(conn, schema)

        # Travaux extra
        try:
            stats["bt_urgents"] = _safe_count(
                cursor,
                "SELECT COUNT(*) as total FROM formulaires WHERE type_formulaire = 'BON_TRAVAIL' AND priorite = 'URGENTE'"
            )
        except Exception:
            conn.rollback(); set_tenant(conn, schema)

        try:
            stats["bt_termines"] = _safe_count(
                cursor,
                "SELECT COUNT(*) as total FROM formulaires WHERE type_formulaire = 'BON_TRAVAIL' AND statut = 'TERMINE'"
            )
        except Exception:
            conn.rollback(); set_tenant(conn, schema)

        cursor.close()
        reset_tenant(conn)
        return stats
    except Exception as exc:
        logger.error("get_dashboard_stats error: %s", exc)
        return stats
    finally:
        conn.close()


def get_dashboard_alerts(schema: str) -> list[dict]:
    """Get dashboard alerts (overdue projects, upcoming deadlines)."""
    conn = get_conn()
    try:
        set_tenant(conn, schema)
        cursor = conn.cursor()
        alerts = []

        # Overdue projects
        try:
            cursor.execute(
                "SELECT id, nom_projet, date_prevu FROM projects "
                "WHERE date_prevu < CURRENT_DATE AND statut NOT IN ('Termine', 'Annule', 'TERMINE', 'ANNULE') "
                "ORDER BY date_prevu ASC LIMIT 10"
            )
            for row in cursor.fetchall():
                alerts.append({
                    "type": "danger",
                    "title": "Projet en retard",
                    "message": f"{row['nom_projet']} - Echéance dépassée ({row['date_prevu']})",
                    "reference_id": str(row["id"]),
                    "reference_type": "project",
                })
        except Exception:
            conn.rollback()

        # Projects due within 7 days
        try:
            cursor.execute(
                "SELECT id, nom_projet, date_prevu FROM projects "
                "WHERE date_prevu BETWEEN CURRENT_DATE AND CURRENT_DATE + make_interval(days => %s) "
                "AND statut NOT IN ('Termine', 'Annule', 'TERMINE', 'ANNULE') "
                "ORDER BY date_prevu ASC LIMIT 10",
                (7,),
            )
            for row in cursor.fetchall():
                alerts.append({
                    "type": "warning",
                    "title": "Projet bientot du",
                    "message": f"{row['nom_projet']} - Echéance le {row['date_prevu']}",
                    "reference_id": str(row["id"]),
                    "reference_type": "project",
                })
        except Exception:
            conn.rollback()

        # Devis expiring soon
        try:
            cursor.execute(
                "SELECT id, date_prevu FROM devis "
                "WHERE date_prevu BETWEEN CURRENT_DATE AND CURRENT_DATE + make_interval(days => %s) "
                "AND statut IN ('Envoye', 'ENVOYE') "
                "ORDER BY date_prevu ASC LIMIT 10",
                (3,),
            )
            for row in cursor.fetchall():
                alerts.append({
                    "type": "warning",
                    "title": "Devis bientot expire",
                    "message": f"Devis #{row['id']} expire le {row['date_prevu']}",
                    "reference_id": str(row["id"]),
                    "reference_type": "devis",
                })
        except Exception:
            conn.rollback()

        cursor.close()
        reset_tenant(conn)
        return alerts
    except Exception as exc:
        logger.error("get_dashboard_alerts error: %s", exc)
        return []
    finally:
        conn.close()


def get_recent_activity(schema: str, limit: int = 20) -> list[dict]:
    """Get recent activity for the dashboard."""
    conn = get_conn()
    try:
        set_tenant(conn, schema)
        cursor = conn.cursor()

        # Get recent projects
        cursor.execute(
            "SELECT 'project' as type, id as reference_id, nom_projet as title, "
            "statut as status, updated_at as date "
            "FROM projects ORDER BY updated_at DESC NULLS LAST LIMIT %s",
            (limit,),
        )
        activities = cursor.fetchall()

        cursor.close()
        reset_tenant(conn)
        return activities
    except Exception as exc:
        logger.error("get_recent_activity error: %s", exc)
        return []
    finally:
        conn.close()


# ============================================
# ADMIN QUERIES
# ============================================

_TEST_EMAIL_FILTER = (
    "AND email NOT LIKE 'info@constructiontest%' "
    "AND email NOT LIKE 'info@constructionsl%' "
    "AND email NOT LIKE 'info@constructions%' "
    "AND email NOT LIKE 'info@constructionsdemo%' "
    "AND email NOT LIKE 'info@constructionheritage%' "
    "AND email NOT LIKE 'info@construction30%' "
    "AND email NOT LIKE 'info@construction40%' "
    "AND email NOT LIKE 'info@construction50%' "
    "AND email NOT LIKE 'sylvainleduc%@gmail.com' "
    "AND email NOT LIKE 'demo-%@%' "
    "AND nom NOT LIKE 'Construction SL%' "
    "AND nom NOT LIKE 'Construction Demo%' "
    "AND nom NOT LIKE 'Construction Test%' "
)


def get_all_entreprises_admin() -> list[dict]:
    """Get all entreprises with extra admin info (excludes test accounts)."""
    conn = get_conn()
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"SELECT * FROM public.entreprises WHERE TRUE {_TEST_EMAIL_FILTER} ORDER BY created_at DESC"
        )
        return cursor.fetchall()
    except Exception as exc:
        logger.error("get_all_entreprises_admin error: %s", exc)
        return []
    finally:
        if cursor:
            cursor.close()
        conn.close()


def toggle_entreprise_active(entreprise_id: int, active: bool) -> bool:
    """Activate or deactivate an entreprise."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE public.entreprises SET active = %s WHERE id = %s",
            (active, entreprise_id),
        )
        conn.commit()
        cursor.close()
        return True
    except Exception as exc:
        logger.error("toggle_entreprise_active error: %s", exc)
        conn.rollback()
        return False
    finally:
        conn.close()


def get_tenant_user_count(schema: str) -> int:
    """Get the number of users in a tenant."""
    conn = get_conn()
    try:
        set_tenant(conn, schema)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as count FROM users")
        result = cursor.fetchone()
        cursor.close()
        reset_tenant(conn)
        return result["count"] if result else 0
    except Exception:
        return 0
    finally:
        conn.close()


def get_all_tenant_user_counts(schemas: list[str]) -> dict[str, int]:
    """Get user counts for all tenant schemas in a single connection.

    Instead of opening one connection per tenant (N+1), this opens one
    connection and iterates through each schema using SET search_path.
    Returns a dict mapping schema name -> user count.
    """
    if not schemas:
        return {}
    conn = get_conn()
    counts: dict[str, int] = {}
    try:
        cursor = conn.cursor()
        for schema in schemas:
            if not validate_schema_name(schema):
                counts[schema] = 0
                continue
            try:
                cursor.execute(
                    psql.SQL("SET search_path TO {}, public").format(
                        psql.Identifier(schema)
                    )
                )
                cursor.execute("SELECT COUNT(*) as count FROM users")
                result = cursor.fetchone()
                counts[schema] = result["count"] if result else 0
            except Exception:
                counts[schema] = 0
                # Reset connection state after error
                try:
                    conn.rollback()
                except Exception:
                    pass
        # Reset search_path
        try:
            cursor.execute("SET search_path TO public")
        except Exception:
            pass
        cursor.close()
        return counts
    except Exception as exc:
        logger.error("get_all_tenant_user_counts error: %s", exc)
        return {s: 0 for s in schemas}
    finally:
        conn.close()
