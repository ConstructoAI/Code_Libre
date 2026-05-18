"""
Module de suivi des sessions actives - Constructo AI
Permet de voir en temps réel quelles entreprises sont connectées
"""

import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import database_config

# Fuseau horaire de Montréal
try:
    from zoneinfo import ZoneInfo
    MONTREAL_TZ = ZoneInfo("America/Toronto")
except ImportError:
    # Python < 3.9 fallback
    try:
        import pytz
        MONTREAL_TZ = pytz.timezone("America/Toronto")
    except ImportError:
        MONTREAL_TZ = None

def get_montreal_now():
    """Retourne l'heure actuelle dans le fuseau horaire de Montréal"""
    if MONTREAL_TZ:
        return datetime.now(MONTREAL_TZ)
    return datetime.now()

logger = logging.getLogger(__name__)

# Durée avant qu'une session soit considérée comme inactive (minutes)
# AUGMENTÉ à 480 minutes (8 heures) pour une journée de travail complète
SESSION_INACTIVE_THRESHOLD = 480


def init_active_sessions_table():
    """
    Crée la table active_sessions dans le schéma public si elle n'existe pas.
    Cette table stocke les sessions actives de tous les tenants.
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        # S'assurer qu'on est dans le schéma public
        cursor.execute("SET search_path TO public")

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS active_sessions (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255) UNIQUE NOT NULL,
                entreprise_id INTEGER,
                entreprise_nom VARCHAR(255),
                schema_name VARCHAR(255),
                user_id INTEGER,
                username VARCHAR(255),
                user_fullname VARCHAR(255),
                user_email VARCHAR(255),
                ip_address VARCHAR(50),
                user_agent TEXT,
                login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_super_admin BOOLEAN DEFAULT FALSE,
                product_type VARCHAR(20) DEFAULT 'ERP'
            )
        ''')

        # Migration: ajouter product_type si la table existe déjà sans cette colonne
        try:
            cursor.execute('''
                ALTER TABLE active_sessions ADD COLUMN IF NOT EXISTS product_type VARCHAR(20) DEFAULT 'ERP'
            ''')
            conn.commit()
        except Exception as e:
            logger.warning(f"[SESSIONS] Migration product_type (active_sessions) échouée: {e}")
            conn.rollback()

        # Index pour recherches rapides
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_active_sessions_entreprise ON active_sessions(entreprise_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_active_sessions_last_activity ON active_sessions(last_activity)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_active_sessions_schema ON active_sessions(schema_name)')

        conn.commit()
        logger.info("[SESSIONS] Table active_sessions initialisée")

    except Exception as e:
        logger.error(f"[SESSIONS] Erreur création table active_sessions: {e}")
        conn.rollback()
    finally:
        conn.close()


def register_session(
    session_id: str,
    entreprise_id: int = None,
    entreprise_nom: str = None,
    schema_name: str = None,
    user_id: int = None,
    username: str = None,
    user_fullname: str = None,
    user_email: str = None,
    is_super_admin: bool = False,
    product_type: str = 'ERP'
) -> bool:
    """
    Enregistre une nouvelle session active.
    Appelé lors de la connexion d'un utilisateur.
    product_type: 'ERP' ou 'EXPERTS_IA'
    """
    if not session_id:
        return False

    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        # Supprimer l'ancienne session si elle existe
        cursor.execute('DELETE FROM active_sessions WHERE session_id = %s', (session_id,))

        # Insérer la nouvelle session
        cursor.execute('''
            INSERT INTO active_sessions (
                session_id, entreprise_id, entreprise_nom, schema_name,
                user_id, username, user_fullname, user_email,
                login_time, last_activity, is_super_admin, product_type
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ''', (
            session_id, entreprise_id, entreprise_nom, schema_name,
            user_id, username, user_fullname, user_email,
            datetime.now(), datetime.now(), is_super_admin, product_type
        ))

        conn.commit()
        logger.info(f"[SESSIONS] Session enregistrée: {username} ({entreprise_nom or 'Super-Admin'})")
        return True

    except Exception as e:
        logger.error(f"[SESSIONS] Erreur enregistrement session: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


def update_session_activity(session_id: str) -> bool:
    """
    Met à jour le timestamp de dernière activité d'une session.
    Appelé périodiquement pour maintenir la session "en ligne".
    """
    if not session_id:
        return False

    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")
        cursor.execute('''
            UPDATE active_sessions
            SET last_activity = %s
            WHERE session_id = %s
        ''', (datetime.now(), session_id))

        conn.commit()
        return cursor.rowcount > 0

    except Exception as e:
        logger.error(f"[SESSIONS] Erreur mise à jour activité: {e}")
        return False
    finally:
        conn.close()


def unregister_session(session_id: str) -> bool:
    """
    Supprime une session active.
    Appelé lors de la déconnexion d'un utilisateur.
    """
    if not session_id:
        return False

    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")
        cursor.execute('DELETE FROM active_sessions WHERE session_id = %s', (session_id,))

        conn.commit()
        logger.info(f"[SESSIONS] Session supprimée: {session_id[:16]}...")
        return True

    except Exception as e:
        logger.error(f"[SESSIONS] Erreur suppression session: {e}")
        return False
    finally:
        conn.close()


def cleanup_inactive_sessions(threshold_minutes: int = SESSION_INACTIVE_THRESHOLD) -> int:
    """
    Supprime les sessions inactives depuis plus de X minutes.
    Retourne le nombre de sessions supprimées.
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        threshold_time = datetime.now() - timedelta(minutes=threshold_minutes)

        cursor.execute('''
            DELETE FROM active_sessions
            WHERE last_activity < %s
        ''', (threshold_time,))

        deleted_count = cursor.rowcount
        conn.commit()

        if deleted_count > 0:
            logger.info(f"[SESSIONS] {deleted_count} session(s) inactive(s) supprimée(s)")

        return deleted_count

    except Exception as e:
        logger.error(f"[SESSIONS] Erreur nettoyage sessions: {e}")
        return 0
    finally:
        conn.close()


def get_online_companies(product_type_filter: str = None) -> List[Dict]:
    """
    Retourne la liste des entreprises actuellement en ligne.
    Une entreprise est considérée en ligne si elle a au moins une session active
    avec une activité dans les X dernières minutes.

    product_type_filter: 'ERP', 'EXPERTS_IA' ou None pour toutes
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        # Nettoyer d'abord les sessions inactives
        cleanup_inactive_sessions()

        threshold_time = datetime.now() - timedelta(minutes=SESSION_INACTIVE_THRESHOLD)

        # Récupérer les entreprises avec sessions actives
        if product_type_filter:
            cursor.execute('''
                SELECT
                    entreprise_id,
                    entreprise_nom,
                    schema_name,
                    COUNT(*) as users_online,
                    MAX(last_activity) as derniere_activite,
                    array_agg(DISTINCT username) as utilisateurs
                FROM active_sessions
                WHERE is_super_admin = FALSE
                AND last_activity >= %s
                AND entreprise_id IS NOT NULL
                AND COALESCE(product_type, 'ERP') = %s
                GROUP BY entreprise_id, entreprise_nom, schema_name
                ORDER BY derniere_activite DESC
            ''', (threshold_time, product_type_filter))
        else:
            cursor.execute('''
                SELECT
                    entreprise_id,
                    entreprise_nom,
                    schema_name,
                    COUNT(*) as users_online,
                    MAX(last_activity) as derniere_activite,
                    array_agg(DISTINCT username) as utilisateurs
                FROM active_sessions
                WHERE is_super_admin = FALSE
                AND last_activity >= %s
                AND entreprise_id IS NOT NULL
                GROUP BY entreprise_id, entreprise_nom, schema_name
                ORDER BY derniere_activite DESC
            ''', (threshold_time,))

        results = cursor.fetchall()

        companies = []
        for row in results:
            if isinstance(row, dict):
                companies.append({
                    'entreprise_id': row['entreprise_id'],
                    'entreprise_nom': row['entreprise_nom'],
                    'schema_name': row['schema_name'],
                    'users_online': row['users_online'],
                    'derniere_activite': row['derniere_activite'],
                    'utilisateurs': row['utilisateurs']
                })
            else:
                companies.append({
                    'entreprise_id': row[0],
                    'entreprise_nom': row[1],
                    'schema_name': row[2],
                    'users_online': row[3],
                    'derniere_activite': row[4],
                    'utilisateurs': row[5]
                })

        return companies

    except Exception as e:
        logger.error(f"[SESSIONS] Erreur récupération entreprises en ligne: {e}")
        return []
    finally:
        conn.close()


def get_all_active_sessions() -> List[Dict]:
    """
    Retourne toutes les sessions actives (pour le Super-Admin).
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        # Nettoyer d'abord les sessions inactives
        cleanup_inactive_sessions()

        cursor.execute('''
            SELECT
                session_id,
                entreprise_id,
                entreprise_nom,
                schema_name,
                username,
                user_fullname,
                user_email,
                login_time,
                last_activity,
                is_super_admin,
                COALESCE(product_type, 'ERP') as product_type
            FROM active_sessions
            ORDER BY last_activity DESC
        ''')

        results = cursor.fetchall()

        sessions = []
        for row in results:
            if isinstance(row, dict):
                sessions.append(row)
            else:
                sessions.append({
                    'session_id': row[0],
                    'entreprise_id': row[1],
                    'entreprise_nom': row[2],
                    'schema_name': row[3],
                    'username': row[4],
                    'user_fullname': row[5],
                    'user_email': row[6],
                    'login_time': row[7],
                    'last_activity': row[8],
                    'is_super_admin': row[9],
                    'product_type': row[10] if len(row) > 10 else 'ERP'
                })

        return sessions

    except Exception as e:
        logger.error(f"[SESSIONS] Erreur récupération sessions: {e}")
        return []
    finally:
        conn.close()


def _get_count_value(row):
    """Helper pour extraire une valeur COUNT d'un résultat qui peut être tuple ou dict."""
    if row is None:
        return 0
    if isinstance(row, dict):
        # Si c'est un dict, prendre la première valeur
        return list(row.values())[0] if row else 0
    # Si c'est un tuple
    return row[0] if row else 0


def get_online_stats() -> Dict:
    """
    Retourne des statistiques sur les sessions en ligne.
    Inclut le décompte par product_type (ERP et EXPERTS_IA).
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        threshold_time = datetime.now() - timedelta(minutes=SESSION_INACTIVE_THRESHOLD)

        # Total sessions actives
        cursor.execute('''
            SELECT COUNT(*) as cnt FROM active_sessions WHERE last_activity >= %s
        ''', (threshold_time,))
        total_sessions = _get_count_value(cursor.fetchone())

        # Entreprises uniques en ligne (ERP)
        cursor.execute('''
            SELECT COUNT(DISTINCT entreprise_id) as cnt
            FROM active_sessions
            WHERE last_activity >= %s AND entreprise_id IS NOT NULL
            AND COALESCE(product_type, 'ERP') = 'ERP'
        ''', (threshold_time,))
        companies_online_erp = _get_count_value(cursor.fetchone())

        # Entreprises uniques en ligne (EXPERTS_IA)
        cursor.execute('''
            SELECT COUNT(DISTINCT entreprise_id) as cnt
            FROM active_sessions
            WHERE last_activity >= %s AND entreprise_id IS NOT NULL
            AND product_type = 'EXPERTS_IA'
        ''', (threshold_time,))
        companies_online_experts = _get_count_value(cursor.fetchone())

        # Super-admins en ligne
        cursor.execute('''
            SELECT COUNT(*) as cnt FROM active_sessions
            WHERE last_activity >= %s AND is_super_admin = TRUE
        ''', (threshold_time,))
        super_admins_online = _get_count_value(cursor.fetchone())

        return {
            'total_sessions': total_sessions,
            'companies_online': companies_online_erp + companies_online_experts,
            'companies_online_erp': companies_online_erp,
            'companies_online_experts': companies_online_experts,
            'super_admins_online': super_admins_online,
            'threshold_minutes': SESSION_INACTIVE_THRESHOLD
        }

    except Exception as e:
        logger.error(f"[SESSIONS] Erreur statistiques: {e}")
        return {
            'total_sessions': 0,
            'companies_online': 0,
            'companies_online_erp': 0,
            'companies_online_experts': 0,
            'super_admins_online': 0,
            'threshold_minutes': SESSION_INACTIVE_THRESHOLD
        }
    finally:
        conn.close()


def init_login_history_table():
    """
    Crée la table login_history dans le schéma public pour conserver
    l'historique de toutes les connexions (même après déconnexion).
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS login_history (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255),
                entreprise_id INTEGER,
                entreprise_nom VARCHAR(255),
                schema_name VARCHAR(255),
                user_id INTEGER,
                username VARCHAR(255),
                user_fullname VARCHAR(255),
                user_email VARCHAR(255),
                login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                logout_time TIMESTAMP,
                is_super_admin BOOLEAN DEFAULT FALSE,
                ip_address VARCHAR(50),
                user_agent TEXT,
                product_type VARCHAR(20) DEFAULT 'ERP'
            )
        ''')

        # Migration: ajouter product_type si la table existe déjà sans cette colonne
        try:
            cursor.execute('''
                ALTER TABLE login_history ADD COLUMN IF NOT EXISTS product_type VARCHAR(20) DEFAULT 'ERP'
            ''')
            conn.commit()
        except Exception as e:
            logger.warning(f"[SESSIONS] Migration product_type (login_history) échouée: {e}")
            conn.rollback()

        # Index pour recherches rapides
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_login_history_date ON login_history(login_time)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_login_history_entreprise ON login_history(entreprise_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(username)')

        conn.commit()
        logger.info("[SESSIONS] Table login_history initialisée")

    except Exception as e:
        logger.error(f"[SESSIONS] Erreur création table login_history: {e}")
        conn.rollback()
    finally:
        conn.close()


def log_login(
    session_id: str,
    entreprise_id: int = None,
    entreprise_nom: str = None,
    schema_name: str = None,
    user_id: int = None,
    username: str = None,
    user_fullname: str = None,
    user_email: str = None,
    is_super_admin: bool = False,
    product_type: str = 'ERP'
) -> bool:
    """
    Enregistre une connexion dans l'historique.
    Appelé lors de chaque login.
    product_type: 'ERP' ou 'EXPERTS_IA'
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        cursor.execute('''
            INSERT INTO login_history (
                session_id, entreprise_id, entreprise_nom, schema_name,
                user_id, username, user_fullname, user_email,
                login_time, is_super_admin, product_type
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ''', (
            session_id, entreprise_id, entreprise_nom, schema_name,
            user_id, username, user_fullname, user_email,
            get_montreal_now(), is_super_admin, product_type
        ))

        conn.commit()
        logger.info(f"[LOGIN HISTORY] Connexion enregistrée: {username} ({entreprise_nom or 'Super-Admin'})")
        return True

    except Exception as e:
        logger.error(f"[LOGIN HISTORY] Erreur enregistrement: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


def log_logout(session_id: str) -> bool:
    """
    Met à jour l'heure de déconnexion dans l'historique.
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        cursor.execute('''
            UPDATE login_history
            SET logout_time = %s
            WHERE session_id = %s AND logout_time IS NULL
        ''', (get_montreal_now(), session_id))

        conn.commit()
        return True

    except Exception as e:
        logger.error(f"[LOGIN HISTORY] Erreur mise à jour logout: {e}")
        return False
    finally:
        conn.close()


def get_today_logins() -> List[Dict]:
    """
    Retourne tous les logins de la journée en cours (heure de Montréal).
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        # Début de la journée (heure de Montréal)
        montreal_now = get_montreal_now()
        today_start = montreal_now.replace(hour=0, minute=0, second=0, microsecond=0)

        cursor.execute('''
            SELECT
                id,
                session_id,
                entreprise_id,
                entreprise_nom,
                schema_name,
                username,
                user_fullname,
                user_email,
                login_time,
                logout_time,
                is_super_admin
            FROM login_history
            WHERE login_time >= %s
            ORDER BY login_time DESC
        ''', (today_start,))

        results = cursor.fetchall()

        logins = []
        for row in results:
            if isinstance(row, dict):
                logins.append(row)
            else:
                logins.append({
                    'id': row[0],
                    'session_id': row[1],
                    'entreprise_id': row[2],
                    'entreprise_nom': row[3],
                    'schema_name': row[4],
                    'username': row[5],
                    'user_fullname': row[6],
                    'user_email': row[7],
                    'login_time': row[8],
                    'logout_time': row[9],
                    'is_super_admin': row[10]
                })

        return logins

    except Exception as e:
        logger.error(f"[LOGIN HISTORY] Erreur récupération logins du jour: {e}")
        return []
    finally:
        conn.close()


def get_logins_by_date(date) -> List[Dict]:
    """
    Retourne tous les logins d'une date spécifique.
    Accepte datetime.date ou datetime.datetime.
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        # Convertir date en datetime si nécessaire
        if isinstance(date, datetime):
            day_start = date.replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            # C'est un datetime.date, le convertir en datetime
            day_start = datetime.combine(date, datetime.min.time())
        day_end = day_start + timedelta(days=1)

        cursor.execute('''
            SELECT
                id,
                session_id,
                entreprise_id,
                entreprise_nom,
                schema_name,
                username,
                user_fullname,
                user_email,
                login_time,
                logout_time,
                is_super_admin
            FROM login_history
            WHERE login_time >= %s AND login_time < %s
            ORDER BY login_time DESC
        ''', (day_start, day_end))

        results = cursor.fetchall()

        logins = []
        for row in results:
            if isinstance(row, dict):
                logins.append(row)
            else:
                logins.append({
                    'id': row[0],
                    'session_id': row[1],
                    'entreprise_id': row[2],
                    'entreprise_nom': row[3],
                    'schema_name': row[4],
                    'username': row[5],
                    'user_fullname': row[6],
                    'user_email': row[7],
                    'login_time': row[8],
                    'logout_time': row[9],
                    'is_super_admin': row[10]
                })

        return logins

    except Exception as e:
        logger.error(f"[LOGIN HISTORY] Erreur récupération logins par date: {e}")
        return []
    finally:
        conn.close()


def get_login_stats_today() -> Dict:
    """
    Retourne les statistiques de connexion pour aujourd'hui (heure de Montréal).
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        montreal_now = get_montreal_now()
        today_start = montreal_now.replace(hour=0, minute=0, second=0, microsecond=0)

        # Total connexions aujourd'hui
        cursor.execute('''
            SELECT COUNT(*) FROM login_history WHERE login_time >= %s
        ''', (today_start,))
        total_logins = _get_count_value(cursor.fetchone())

        # Utilisateurs uniques
        cursor.execute('''
            SELECT COUNT(DISTINCT username) FROM login_history WHERE login_time >= %s
        ''', (today_start,))
        unique_users = _get_count_value(cursor.fetchone())

        # Entreprises uniques
        cursor.execute('''
            SELECT COUNT(DISTINCT entreprise_id) FROM login_history
            WHERE login_time >= %s AND entreprise_id IS NOT NULL
        ''', (today_start,))
        unique_companies = _get_count_value(cursor.fetchone())

        # Super-admin logins
        cursor.execute('''
            SELECT COUNT(*) FROM login_history
            WHERE login_time >= %s AND is_super_admin = TRUE
        ''', (today_start,))
        super_admin_logins = _get_count_value(cursor.fetchone())

        return {
            'total_logins': total_logins,
            'unique_users': unique_users,
            'unique_companies': unique_companies,
            'super_admin_logins': super_admin_logins,
            'date': today_start.strftime('%Y-%m-%d')
        }

    except Exception as e:
        logger.error(f"[LOGIN HISTORY] Erreur stats: {e}")
        return {
            'total_logins': 0,
            'unique_users': 0,
            'unique_companies': 0,
            'super_admin_logins': 0,
            'date': datetime.now().strftime('%Y-%m-%d')
        }
    finally:
        conn.close()


# Initialiser la table au chargement du module
try:
    init_active_sessions_table()
    init_login_history_table()
except Exception as e:
    logger.warning(f"[SESSIONS] Impossible d'initialiser les tables: {e}")
