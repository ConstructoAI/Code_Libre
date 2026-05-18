"""
Configuration de la base de données PostgreSQL
Gère la connexion PostgreSQL pour tous les environnements

VERSION POSTGRESQL UNIQUEMENT
- Production sur Render avec PostgreSQL
- Développement local avec PostgreSQL
- Support multi-environnement: local, Render, Hugging Face
- CONNECTION POOLING pour optimiser les performances
"""

import os
import sys
import logging
import re
import threading

try:
    import psycopg2
    import psycopg2.extensions
    # Force PostgreSQL NUMERIC/DECIMAL columns to return Python float instead of Decimal.
    # This prevents TypeError when mixing float and Decimal in arithmetic operations.
    DEC2FLOAT = psycopg2.extensions.new_type(
        psycopg2.extensions.DECIMAL.values,
        'DEC2FLOAT',
        lambda value, curs: float(value) if value is not None else None)
    psycopg2.extensions.register_type(DEC2FLOAT)
except ImportError:
    psycopg2 = None  # Will be available at runtime when DB operations are called

logger = logging.getLogger(__name__)

# ============================================
# CONNECTION POOL GLOBAL
# ============================================
_connection_pool = None
_pool_lock = threading.Lock()
_pool_initialized = False

# Configuration du pool - OPTIMISÉ pour performance
POOL_MIN_CONNECTIONS = 10  # Augmenté: connexions prêtes au démarrage
POOL_MAX_CONNECTIONS = 75  # Augmenté: supporte plus d'utilisateurs simultanés
POOL_ENABLED = True  # Peut être désactivé si problèmes
POOL_RECYCLE_SECONDS = 1800  # Recycler les connexions après 30 min (évite stale connections)
POOL_PRE_PING = True  # Vérifier les connexions avant utilisation


# ============================================
# POOLED CONNECTION WRAPPER
# ============================================
class PooledConnection:
    """
    Wrapper pour les connexions du pool.
    Intercepte close() pour retourner la connexion au pool au lieu de la fermer.
    """

    def __init__(self, conn, pool, is_from_pool=True):
        self._conn = conn
        self._pool = pool
        self._is_from_pool = is_from_pool
        self._closed = False

    def close(self):
        """Retourne la connexion au pool au lieu de la fermer"""
        if self._closed:
            return

        self._closed = True

        if self._is_from_pool and self._pool:
            # SÉCURITÉ MULTI-TENANT: Reset search_path à public AVANT de retourner au pool
            # Si le reset échoue, DÉTRUIRE la connexion pour éviter fuite de données inter-tenant
            search_path_reset_ok = False
            try:
                cursor = self._conn.cursor()
                cursor.execute("SET search_path TO public")
                cursor.close()
                search_path_reset_ok = True
            except (psycopg2.Error, OSError) as reset_err:
                logger.critical(f"[SECURITY] search_path reset FAILED - destroying connection to prevent cross-tenant data leak: {reset_err}")

            if search_path_reset_ok:
                # Search_path correctement réinitialisé - retourner au pool
                try:
                    self._pool.putconn(self._conn)
                except (psycopg2.Error, OSError) as e:
                    logger.warning(f"[Database] Erreur retour connexion au pool: {e}")
                    try:
                        self._conn.close()
                    except (psycopg2.Error, OSError) as close_err:
                        logger.debug(f"[Database] Erreur fermeture connexion fallback: {close_err}")
            else:
                # SÉCURITÉ: NE PAS retourner au pool - fermer physiquement
                try:
                    self._conn.close()
                except (psycopg2.Error, OSError) as close_err:
                    logger.debug(f"[Database] Erreur fermeture connexion corrompue: {close_err}")
        else:
            # Connexion directe (fallback) - fermer normalement
            try:
                self._conn.close()
            except (psycopg2.Error, OSError) as close_err:
                logger.debug(f"[Database] Erreur fermeture connexion directe: {close_err}")

    def cursor(self, *args, **kwargs):
        """Proxy pour cursor() - force RealDictCursor par défaut"""
        # Importer ici pour éviter import circulaire
        from psycopg2.extras import RealDictCursor
        # Si cursor_factory n'est pas spécifié, utiliser RealDictCursor
        if 'cursor_factory' not in kwargs and not args:
            kwargs['cursor_factory'] = RealDictCursor
        return self._conn.cursor(*args, **kwargs)

    def commit(self):
        """Proxy pour commit()"""
        return self._conn.commit()

    def rollback(self):
        """Proxy pour rollback()"""
        return self._conn.rollback()

    def set_isolation_level(self, level):
        """Proxy pour set_isolation_level()"""
        return self._conn.set_isolation_level(level)

    @property
    def closed(self):
        """Proxy pour closed"""
        return self._closed or self._conn.closed

    @property
    def autocommit(self):
        """Proxy pour autocommit"""
        return self._conn.autocommit

    @autocommit.setter
    def autocommit(self, value):
        """Proxy pour autocommit setter"""
        self._conn.autocommit = value

    def __enter__(self):
        """Support context manager"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Support context manager - retourne au pool"""
        self.close()
        return False

    def __del__(self):
        """Détecteur de fuites: log un warning si la connexion n'a pas été fermée proprement"""
        if not self._closed and self._conn and not self._conn.closed:
            logger.warning(
                f"[Database] RESOURCE LEAK: PooledConnection garbage collected without close(). "
                f"Use 'with get_connection() as conn:' to prevent leaks."
            )
            # Tenter de fermer proprement
            try:
                self.close()
            except (Exception,):
                # Destructor: must never raise - silently ignore all errors
                pass

    def __getattr__(self, name):
        """Proxy pour tous les autres attributs"""
        return getattr(self._conn, name)


def validate_schema_name(schema_name: str) -> bool:
    """
    Valide qu'un nom de schéma est sécurisé (protection contre SQL Injection).

    Args:
        schema_name: Nom du schéma à valider

    Returns:
        bool: True si le schéma est valide et sécurisé
    """
    if not schema_name:
        return False
    # Autoriser uniquement: tenant_xxx, public, ou schémas alphanumériques avec underscores
    # Pattern strict: commence par une lettre, contient uniquement lettres, chiffres, underscores
    pattern = r'^[a-zA-Z][a-zA-Z0-9_]*$'
    if not re.match(pattern, schema_name):
        logger.warning(f"[Security] Nom de schéma invalide rejeté: {schema_name}")
        return False
    # Longueur maximale pour PostgreSQL
    if len(schema_name) > 63:
        logger.warning(f"[Security] Nom de schéma trop long rejeté: {schema_name}")
        return False
    return True


def set_search_path_secure(cursor, schema_name: str) -> bool:
    """
    Configure le search_path de manière sécurisée (protection SQL Injection).

    Args:
        cursor: Curseur psycopg2
        schema_name: Nom du schéma

    Returns:
        bool: True si succès
    """
    if not validate_schema_name(schema_name):
        logger.error(f"[Security] Tentative de SET search_path avec schéma invalide: {schema_name}")
        raise ValueError(f"Nom de schéma invalide: {schema_name}")

    # Utilisation OBLIGATOIRE de sql.Identifier pour échapper le nom du schéma.
    # Pas de fallback f-string : la validation regex ci-dessus n'est pas suffisante
    # à elle seule pour garantir l'absence d'injection sur les identifiants SQL.
    from psycopg2 import sql
    query = sql.SQL("SET search_path TO {}, public").format(sql.Identifier(schema_name))
    cursor.execute(query)
    return True

def safe_print(*args, **kwargs):
    """Print sécurisé qui ne crash pas si stdout est fermé (problème Streamlit)"""
    try:
        print(*args, **kwargs)
    except (ValueError, AttributeError, OSError):
        # Si print échoue (stdout fermé), utiliser logger à la place
        try:
            message = ' '.join(str(arg) for arg in args)
            logger.info(message)
        except (ValueError, AttributeError, OSError):
            # Si même le logger échoue, ignorer silencieusement (stdout fermé)
            pass

def detect_environment():
    """
    Détecte l'environnement d'exécution
    """
    if os.environ.get('RENDER'):
        return 'RENDER'
    elif os.environ.get('SPACE_ID') or '/home/user' in os.getcwd() or 'spaces' in os.getcwd().lower():
        return 'HUGGINGFACE'
    else:
        return 'LOCAL'

def get_database_type():
    """
    Retourne le type de base de données (toujours PostgreSQL)

    Returns:
        str: 'postgresql'
    """
    return 'postgresql'

def get_placeholder():
    """
    Retourne le placeholder SQL pour PostgreSQL

    Returns:
        str: '%s'
    """
    return '%s'

def get_database_url():
    """
    Retourne l'URL de connexion à la base de données PostgreSQL

    Returns:
        str: URL de connexion PostgreSQL
    """
    database_url = os.environ.get('DATABASE_URL', '')

    if not database_url:
        raise ValueError("DATABASE_URL non défini. Veuillez configurer la variable d'environnement DATABASE_URL pour PostgreSQL.")

    # Fix pour Heroku/Render: postgres:// → postgresql://
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql://', 1)

    logger.info("[Database] Type: PostgreSQL")
    if '@' in database_url:
        # SÉCURITÉ: Masquer les détails du host (ne pas exposer dans les logs)
        try:
            host_part = database_url.split('@')[1].split('/')[0]
            # Afficher seulement les 4 premiers et 4 derniers caractères
            if len(host_part) > 12:
                masked_host = host_part[:4] + '***' + host_part[-4:]
            else:
                masked_host = '***'
            logger.debug(f"[Database] Host: {masked_host}")
        except (IndexError, ValueError):
            logger.debug("[Database] Host: configured")

    return database_url

def _init_connection_pool():
    """
    Initialise le pool de connexions PostgreSQL (appelé une seule fois)
    """
    global _connection_pool, _pool_initialized

    if _pool_initialized:
        return _connection_pool

    with _pool_lock:
        # Double-check après acquisition du lock
        if _pool_initialized:
            return _connection_pool

        try:
            from psycopg2 import pool
            database_url = get_database_url()

            # TCP keepalives reduce "SSL error: unexpected eof while reading"
            # noise observed in DB logs (~93 occurrences over 33h on Render):
            # idle pool connections silently dropped by NAT/firewall before
            # psycopg2 noticed. keepalives_idle=60 sends a probe after 60s
            # idle; keepalives_interval=10s + keepalives_count=3 = ~30s to
            # detect a dead peer cleanly via FIN/RST instead of EOF.
            _connection_pool = pool.ThreadedConnectionPool(
                POOL_MIN_CONNECTIONS,
                POOL_MAX_CONNECTIONS,
                database_url,
                keepalives=1,
                keepalives_idle=60,
                keepalives_interval=10,
                keepalives_count=3,
            )
            _pool_initialized = True
            logger.info(f"[Database] ✅ Pool de connexions initialisé (min={POOL_MIN_CONNECTIONS}, max={POOL_MAX_CONNECTIONS})")
            return _connection_pool

        except Exception as e:
            logger.error(f"[Database] ❌ Erreur initialisation pool: {e}")
            raise


def get_connection():
    """
    Obtient une connexion depuis le pool PostgreSQL.
    OPTIMISÉ: Réutilise les connexions au lieu d'en créer de nouvelles.

    IMPORTANT: La connexion retournée est un PooledConnection wrapper.
    Appeler close() retourne la connexion au pool (au lieu de la fermer).

    Returns:
        PooledConnection: Wrapper de connexion psycopg2 depuis le pool
    """
    global _connection_pool

    try:
        import psycopg2
        from psycopg2.extras import RealDictCursor
        from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

        # Initialiser le pool si nécessaire
        if not _pool_initialized:
            _init_connection_pool()

        # Obtenir une connexion du pool
        if _connection_pool:
            try:
                conn = _connection_pool.getconn()
                if conn:
                    # Configurer la connexion
                    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)

                    # Configurer le fuseau horaire
                    cursor = conn.cursor(cursor_factory=RealDictCursor)
                    cursor.execute("SET TIMEZONE TO 'America/Montreal'")
                    cursor.close()

                    # Configuration multi-tenant
                    _configure_tenant_schema(conn)

                    # Retourner le wrapper qui gère le retour au pool
                    return PooledConnection(conn, _connection_pool, is_from_pool=True)
            except (psycopg2.Error, OSError, KeyError) as pool_error:
                logger.warning(f"[Database] Pool error, fallback to direct connection: {pool_error}")

        # Fallback: connexion directe si le pool échoue
        database_url = get_database_url()
        # Same TCP keepalives as the pool path (see _init_connection_pool).
        conn = psycopg2.connect(
            database_url,
            cursor_factory=RealDictCursor,
            keepalives=1,
            keepalives_idle=60,
            keepalives_interval=10,
            keepalives_count=3,
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)

        cursor = conn.cursor()
        cursor.execute("SET TIMEZONE TO 'America/Montreal'")
        cursor.close()

        _configure_tenant_schema(conn)

        logger.info("[Database] Connexion PostgreSQL établie (fallback direct)")
        # Wrapper sans pool (ferme vraiment la connexion)
        return PooledConnection(conn, None, is_from_pool=False)

    except ImportError:
        logger.error("[Database] psycopg2 non installé! Installez: pip install psycopg2-binary")
        raise
    except Exception as e:
        logger.error(f"[Database] Erreur connexion PostgreSQL: {e}")
        raise


def release_connection(conn):
    """
    Retourne une connexion au pool.
    NOTE: Avec le nouveau PooledConnection wrapper, appeler conn.close() suffit.
    Cette fonction est conservée pour compatibilité.

    Args:
        conn: Connexion (ou PooledConnection) à retourner au pool
    """
    if conn:
        try:
            # PooledConnection.close() gère le retour au pool automatiquement
            conn.close()
        except (psycopg2.Error, OSError) as e:
            logger.warning(f"[Database] Erreur release_connection: {e}")


def _has_streamlit_context():
    """
    Vérifie si le code s'exécute dans un contexte Streamlit valide
    (thread principal avec ScriptRunContext).
    Évite le spam 'missing ScriptRunContext' dans les threads secondaires
    (migrations, background tasks, etc.).
    """
    try:
        # Étape 1: Vérifier si le runtime Streamlit est actif (sans warning)
        from streamlit.runtime import exists as _runtime_exists
        if not _runtime_exists():
            return False
        # Étape 2: Runtime actif -> vérifier le contexte du thread courant
        # IMPORTANT: suppress_warning=True évite le log "missing ScriptRunContext"
        # quand on est dans un thread secondaire (Thread-6 migrations, etc.)
        from streamlit.runtime.scriptrunner import get_script_run_ctx
        return get_script_run_ctx(suppress_warning=True) is not None
    except (ImportError, RuntimeError, AttributeError):
        return False


def _configure_tenant_schema(conn):
    """
    Configure le search_path selon le tenant connecté.

    Args:
        conn: Connexion PostgreSQL
    """
    try:
        from psycopg2.extras import RealDictCursor

        tenant_schema = None

        # Accéder à st.session_state UNIQUEMENT si on est dans un contexte Streamlit valide
        # Sinon on génère des warnings "missing ScriptRunContext" dans les threads (migrations, etc.)
        if _has_streamlit_context():
            import streamlit as st
            tenant_schema = st.session_state.get('tenant_schema', None)

        if tenant_schema and tenant_schema != 'public':
            if validate_schema_name(tenant_schema):
                cursor = conn.cursor(cursor_factory=RealDictCursor)
                try:
                    set_search_path_secure(cursor, tenant_schema)
                    # DEBUG level pour éviter spam dans les logs (appelé à chaque connexion)
                    logger.debug(f"[Database] Isolation multi-tenant: search_path = '{tenant_schema}'")
                except (psycopg2.Error, ValueError) as e:
                    # STRIPE-03: Reset search_path to public on failure to prevent cross-tenant data leak
                    try:
                        cursor.execute("SET search_path TO public")
                    except (psycopg2.Error, OSError) as reset_err:
                        logger.warning(f"[Database] Erreur reset search_path apres echec: {reset_err}")
                    raise
                finally:
                    cursor.close()
            else:
                logger.error(f"[Database] SECURITE: Schema invalide detecte: '{tenant_schema}'")
                raise ValueError(f"Schéma tenant invalide: {tenant_schema}")
        else:
            # IMPORTANT: Reset explicite à public pour éviter les problèmes de cache du pool
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            try:
                cursor.execute("SET search_path TO public")
                # DEBUG level pour éviter spam dans les logs
                logger.debug("[Database] Mode public actif: search_path = 'public'")
            finally:
                cursor.close()

    except ImportError:
        # Pas de contexte Streamlit - forcer search_path = public
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute("SET search_path TO public")
            cursor.close()
        except (psycopg2.Error, ImportError, OSError) as fallback_err:
            logger.debug(f"[Database] Fallback search_path echoue: {fallback_err}")
        logger.debug("[Database] Pas de contexte Streamlit, search_path = 'public'")
    except ValueError as ve:
        raise ve
    except (psycopg2.Error, RuntimeError, AttributeError) as e:
        # Erreur - forcer search_path = public pour sécurité
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute("SET search_path TO public")
            cursor.close()
        except (psycopg2.Error, ImportError, OSError) as fallback_err:
            logger.debug(f"[Database] Fallback search_path echoue: {fallback_err}")
        logger.debug(f"[Database] Erreur configuration tenant: {e}, search_path = 'public'")


def close_connection_pool():
    """
    Ferme proprement le pool de connexions.
    À appeler lors de l'arrêt de l'application.
    """
    global _connection_pool, _pool_initialized

    with _pool_lock:
        if _connection_pool:
            try:
                _connection_pool.closeall()
                logger.info("[Database] ✅ Pool de connexions fermé proprement")
            except (psycopg2.Error, OSError) as e:
                logger.warning(f"[Database] Erreur fermeture pool: {e}")
            finally:
                _connection_pool = None
                _pool_initialized = False


def get_pool_status():
    """
    Retourne le statut du pool de connexions.

    Returns:
        dict: Informations sur le pool
    """
    global _connection_pool, _pool_initialized

    return {
        'initialized': _pool_initialized,
        'pool_exists': _connection_pool is not None,
        'min_connections': POOL_MIN_CONNECTIONS,
        'max_connections': POOL_MAX_CONNECTIONS
    }

def get_attachments_path():
    """
    Retourne le chemin correct pour les pièces jointes
    """
    environment = detect_environment()

    if environment == 'RENDER':
        base_dir = "/opt/render/project/data"
    elif environment == 'HUGGINGFACE':
        # Utiliser le répertoire de l'app
        if os.access(os.getcwd(), os.W_OK):
            base_dir = os.getcwd()
        else:
            base_dir = "/tmp"
            safe_print("[Attachments] Utilisation stockage temporaire pour pièces jointes")
    else:  # LOCAL
        base_dir = "."

    attachments_dir = os.path.join(base_dir, "attachments")
    try:
        os.makedirs(attachments_dir, exist_ok=True)
    except PermissionError:
        safe_print(f"[Attachments] Erreur permission: {attachments_dir}, utilisation /tmp")
        attachments_dir = "/tmp/attachments"
        os.makedirs(attachments_dir, exist_ok=True)

    return attachments_dir

def get_backup_path():
    """
    Retourne le chemin correct pour les sauvegardes
    """
    environment = detect_environment()

    if environment == 'RENDER':
        base_dir = "/opt/render/project/data"
    elif environment == 'HUGGINGFACE':
        # Utiliser le répertoire de l'app
        if os.access(os.getcwd(), os.W_OK):
            base_dir = os.getcwd()
        else:
            base_dir = "/tmp"
            safe_print("[Backups] Utilisation stockage temporaire pour sauvegardes")
    else:  # LOCAL
        base_dir = "."

    backup_dir = os.path.join(base_dir, "backups")
    try:
        os.makedirs(backup_dir, exist_ok=True)
    except PermissionError:
        safe_print(f"[Backups] Erreur permission: {backup_dir}, utilisation /tmp")
        backup_dir = "/tmp/backups"
        os.makedirs(backup_dir, exist_ok=True)

    return backup_dir

def get_database():
    """
    Retourne une instance de ERPDatabase.
    Fonction utilitaire pour éviter les imports circulaires.
    """
    from erp_database import ERPDatabase
    return ERPDatabase()


def fetchone_value(row, index_or_key, default=None):
    """
    Extrait une valeur d'un résultat fetchone() qui peut être tuple ou dict.

    Args:
        row: Résultat de cursor.fetchone() (tuple, dict, ou None)
        index_or_key: Index (int) pour tuple ou clé (str) pour dict
        default: Valeur par défaut si row est None ou index invalide

    Returns:
        La valeur extraite ou default
    """
    if row is None:
        return default

    try:
        if isinstance(row, dict):
            # Pour les curseurs dict (RealDictCursor)
            if isinstance(index_or_key, int):
                # Si on passe un index, récupérer la Nième valeur
                keys = list(row.keys())
                if index_or_key < len(keys):
                    return row.get(keys[index_or_key], default)
                return default
            else:
                return row.get(index_or_key, default)
        else:
            # Pour les tuples standard
            if isinstance(index_or_key, int) and index_or_key < len(row):
                return row[index_or_key]
            return default
    except (IndexError, KeyError, TypeError):
        return default


# Variables globales
DATABASE_TYPE = 'postgresql'
DATABASE_URL = get_database_url() if os.environ.get('DATABASE_URL') else None

# Test au chargement du module
if __name__ == "__main__":
    safe_print("=== Configuration Base de Données PostgreSQL ===")
    environment = detect_environment()

    safe_print(f"Environnement: {environment}")
    safe_print(f"Type de base: POSTGRESQL")
    safe_print(f"Répertoire de travail: {os.getcwd()}")

    try:
        db_url = get_database_url()
        # Masquer le mot de passe
        safe_url = db_url.split('@')[1] if '@' in db_url else db_url
        safe_print(f"PostgreSQL Host: {safe_url}")
        safe_print(f"Configuration PostgreSQL détectée")
    except ValueError as e:
        safe_print(f"Erreur: {e}")

    safe_print(f"\nChemin pièces jointes: {get_attachments_path()}")
    safe_print(f"Chemin sauvegardes: {get_backup_path()}")

    # Test de connexion
    safe_print("\n=== Test de connexion ===")
    try:
        conn = get_connection()
        safe_print(f"Connexion PostgreSQL réussie!")
        conn.close()
    except Exception as e:
        safe_print(f"Erreur connexion: {e}")
