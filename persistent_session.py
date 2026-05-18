"""
Persistent Session Manager - Constructo AI
==========================================
Permet aux utilisateurs de rester connectés après un redéploiement Render.

Architecture:
- Cookie côté client contient un session_token unique
- PostgreSQL stocke les données de session complètes
- Lecture directe du cookie via streamlit-cookies-controller (pas de redirection JS)
- Au démarrage, restauration automatique depuis le token

Auteur: Constructo AI
Date: Décembre 2024
Mise à jour: Février 2026 - Migration vers streamlit-cookies-controller
"""

import os
import json
import logging
import secrets
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import streamlit as st
import streamlit.components.v1 as components

import database_config

logger = logging.getLogger(__name__)

# Durée de validité du cookie (jours)
SESSION_COOKIE_DAYS = 7
SESSION_COOKIE_NAME = "constructo_session"

# Clé secrète pour signer les tokens — JAMAIS de valeur par défaut hardcodée.
# En prod : doit être défini via env var, sinon le module refuse de fonctionner.
# En dev : clé aléatoire générée pour le processus (sessions perdues au redémarrage).
SESSION_SECRET = os.environ.get('SESSION_SECRET')
if not SESSION_SECRET:
    if os.environ.get('ENVIRONMENT', 'development').lower() == 'production':
        raise RuntimeError(
            "SESSION_SECRET doit être défini en production. "
            "Générer avec: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )
    import secrets as _secrets
    SESSION_SECRET = _secrets.token_urlsafe(64)
    import logging as _logging
    _logging.getLogger(__name__).warning(
        "SESSION_SECRET non défini — clé aléatoire générée. "
        "Les sessions ne survivront pas au redémarrage du processus."
    )

# ============================================
# GESTION DES COOKIES (streamlit-cookies-controller)
# ============================================

# IMPORTANT: NE PAS utiliser de variable globale pour le cookie manager!
# Chaque session Streamlit doit avoir sa propre instance pour éviter
# le partage de cookies entre utilisateurs différents.
# BUG CORRIGÉ le 2026-02-04: La variable globale _cookie_manager causait
# une fuite de session où tous les visiteurs héritaient du cookie du
# dernier utilisateur connecté (bug critique de sécurité).

# Flag pour savoir si les packages sont disponibles (peut être global car statique)
_cookie_packages_checked = False
_cookie_package_available = None  # 'streamlit_cookies_controller', 'extra_streamlit_components', ou None


def _get_cookie_manager():
    """
    Obtient une NOUVELLE instance du cookie manager pour chaque appel.

    CRITIQUE: Ne PAS mettre en cache l'instance du cookie manager!
    Chaque utilisateur doit avoir sa propre instance pour lire son propre cookie.
    Le CookieController lit les cookies côté client via JavaScript, et l'instance
    garde en mémoire les valeurs lues. Si on partage l'instance entre utilisateurs,
    ils héritent tous du cookie du premier utilisateur (fuite de session).
    """
    global _cookie_packages_checked, _cookie_package_available

    # Vérifier les packages disponibles une seule fois
    if not _cookie_packages_checked:
        _cookie_packages_checked = True

        # Essayer streamlit-cookies-controller d'abord
        try:
            from streamlit_cookies_controller import CookieController
            _cookie_package_available = 'streamlit_cookies_controller'
            logger.info("[PERSISTENT] Package streamlit-cookies-controller disponible")
        except ImportError:
            # Essayer extra-streamlit-components
            try:
                import extra_streamlit_components as stx
                _cookie_package_available = 'extra_streamlit_components'
                logger.info("[PERSISTENT] Package extra-streamlit-components disponible")
            except ImportError:
                _cookie_package_available = None
                logger.warning("[PERSISTENT] Aucun package cookie disponible")

    # Si aucun package disponible, retourner None
    if _cookie_package_available is None:
        return None

    # Créer une NOUVELLE instance à chaque appel (PAS de cache!)
    try:
        if _cookie_package_available == 'streamlit_cookies_controller':
            from streamlit_cookies_controller import CookieController
            return CookieController()
        elif _cookie_package_available == 'extra_streamlit_components':
            import extra_streamlit_components as stx
            return stx.CookieManager()
    except Exception as e:
        logger.warning(f"[PERSISTENT] Erreur création cookie manager: {e}")

    return None


def get_cookie(name: str) -> Optional[str]:
    """
    Lit un cookie de façon robuste.
    Priorité: st.context.cookies (synchrone) > CookieController > query params.
    """
    # Méthode 1: st.context.cookies (Streamlit 1.37+) — SYNCHRONE, premier render
    # Lit directement les cookies HTTP de la requête, pas besoin de JS
    try:
        cookies = st.context.cookies
        if cookies and name in cookies:
            value = cookies[name]
            if value:
                logger.debug(f"[PERSISTENT] Cookie lu via st.context.cookies: {name}")
                return value
    except Exception as e:
        logger.debug(f"[PERSISTENT] st.context.cookies non disponible: {e}")

    # Méthode 2: Cookie manager (fallback pour anciennes versions)
    cookie_manager = _get_cookie_manager()
    if cookie_manager:
        try:
            if hasattr(cookie_manager, 'get'):
                value = cookie_manager.get(name)
                if value:
                    logger.debug(f"[PERSISTENT] Cookie lu via manager: {name}")
                    return value
        except Exception as e:
            logger.debug(f"[PERSISTENT] Erreur lecture cookie manager: {e}")

    # Méthode 3: Query params (fallback pour anciens cookies avec redirection JS)
    try:
        token = st.query_params.get('session_token')
        if token:
            logger.debug(f"[PERSISTENT] Token lu via query_params")
            return token
    except Exception:
        pass

    return None


def set_cookie(name: str, value: str, days: int = SESSION_COOKIE_DAYS) -> bool:
    """
    Définit un cookie de façon robuste.
    Utilise le cookie manager + fallback JavaScript.
    """
    success = False

    # Méthode 1: Cookie manager
    cookie_manager = _get_cookie_manager()
    if cookie_manager:
        try:
            expires = datetime.now() + timedelta(days=days)

            # streamlit-cookies-controller utilise .set()
            if hasattr(cookie_manager, 'set'):
                cookie_manager.set(name, value, expires=expires)
                logger.debug(f"[PERSISTENT] Cookie défini via manager: {name}")
                success = True
        except Exception as e:
            logger.debug(f"[PERSISTENT] Erreur set cookie manager: {e}")

    # Méthode 2: JavaScript (toujours exécuté comme backup)
    try:
        js_code = f"""
        <script>
        (function() {{
            const date = new Date();
            date.setTime(date.getTime() + ({days} * 24 * 60 * 60 * 1000));
            const expires = "expires=" + date.toUTCString();
            document.cookie = "{name}={value};" + expires + ";path=/;SameSite=Lax";
            console.log('[PERSISTENT] Cookie JS défini: {name}');
        }})();
        </script>
        """
        components.html(js_code, height=0)
        success = True
    except Exception as e:
        logger.debug(f"[PERSISTENT] Erreur set cookie JS: {e}")

    return success


def delete_cookie(name: str) -> bool:
    """
    Supprime un cookie de façon robuste.
    """
    success = False

    # Méthode 1: Cookie manager
    cookie_manager = _get_cookie_manager()
    if cookie_manager:
        try:
            # streamlit-cookies-controller utilise .remove()
            if hasattr(cookie_manager, 'remove'):
                cookie_manager.remove(name)
                success = True
            # extra-streamlit-components utilise .delete()
            elif hasattr(cookie_manager, 'delete'):
                cookie_manager.delete(name)
                success = True
        except Exception as e:
            logger.debug(f"[PERSISTENT] Erreur delete cookie manager: {e}")

    # Méthode 2: JavaScript (toujours exécuté comme backup)
    try:
        js_code = f"""
        <script>
        (function() {{
            document.cookie = "{name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;";
            console.log('[PERSISTENT] Cookie JS supprimé: {name}');

            // Nettoyer l'URL si session_token présent
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('session_token')) {{
                urlParams.delete('session_token');
                const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
                window.history.replaceState({{}}, '', newUrl);
            }}
        }})();
        </script>
        """
        components.html(js_code, height=0)
        success = True
    except Exception as e:
        logger.debug(f"[PERSISTENT] Erreur delete cookie JS: {e}")

    return success


# ============================================
# FONCTIONS LEGACY (compatibilité)
# ============================================

def inject_cookie_script():
    """
    LEGACY: Injecte un script JavaScript pour la redirection.
    Gardé pour compatibilité mais plus nécessaire avec le cookie manager.
    """
    # Ne rien faire - le cookie manager lit directement
    pass


def set_cookie_js(token: str):
    """
    LEGACY: Définit un cookie via JavaScript.
    Utilise maintenant set_cookie() qui est plus robuste.
    """
    set_cookie(SESSION_COOKIE_NAME, token, SESSION_COOKIE_DAYS)


def delete_cookie_js():
    """
    LEGACY: Supprime le cookie via JavaScript.
    Utilise maintenant delete_cookie() qui est plus robuste.
    """
    delete_cookie(SESSION_COOKIE_NAME)


# ============================================
# BASE DE DONNÉES
# ============================================

def _get_connection():
    """Obtient une connexion à la base de données."""
    return database_config.get_connection()


def init_persistent_sessions_table():
    """
    Crée/met à jour la table pour les sessions persistantes.
    """
    conn = _get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        # Vérifier si la table existe, sinon la créer
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS active_sessions (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(64),
                username VARCHAR(100),
                user_id INTEGER,
                entreprise_id INTEGER,
                entreprise_nom VARCHAR(255),
                schema_name VARCHAR(100),
                is_super_admin BOOLEAN DEFAULT FALSE,
                login_time TIMESTAMP DEFAULT NOW(),
                last_activity TIMESTAMP DEFAULT NOW()
            )
        """)

        # Ajouter les colonnes pour la persistance si elles n'existent pas
        columns_to_add = [
            ("session_token", "VARCHAR(255) UNIQUE"),
            ("session_data", "JSONB"),
            ("user_role", "VARCHAR(50)"),
            ("permissions", "TEXT[]"),
            ("expires_at", "TIMESTAMP"),
            # Colonnes requises par active_sessions_tracker
            ("user_fullname", "VARCHAR(255)"),
            ("user_email", "VARCHAR(255)"),
            ("ip_address", "VARCHAR(50)"),
            ("user_agent", "TEXT"),
            ("product_type", "VARCHAR(20) DEFAULT 'ERP'"),
        ]

        for col_name, col_type in columns_to_add:
            try:
                cursor.execute(f'''
                    ALTER TABLE active_sessions
                    ADD COLUMN IF NOT EXISTS {col_name} {col_type}
                ''')
                logger.info(f"[PERSISTENT] Colonne {col_name} vérifiée/ajoutée")
            except Exception as e:
                logger.warning(f"[PERSISTENT] Colonne {col_name}: {e}")

        # Index sur session_token pour recherche rapide
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_active_sessions_token
            ON active_sessions(session_token)
        ''')

        conn.commit()
        logger.info("[PERSISTENT] Table active_sessions initialisée pour persistance")

    except Exception as e:
        logger.error(f"[PERSISTENT] Erreur init: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()


def generate_session_token() -> str:
    """
    Génère un token de session sécurisé et unique.
    """
    random_part = secrets.token_hex(32)
    timestamp = str(datetime.now().timestamp())
    combined = f"{random_part}:{timestamp}:{SESSION_SECRET}"
    return hashlib.sha256(combined.encode()).hexdigest()


def create_persistent_session(
    session_id: str,
    username: str,
    user_id: int,
    user_role: str,
    permissions: list,
    entreprise_id: int = None,
    entreprise_nom: str = None,
    schema_name: str = None,
    is_super_admin: bool = False,
    extra_data: dict = None
) -> Optional[str]:
    """
    Crée une session persistante et retourne le token.
    """
    logger.info(f"[PERSISTENT] Création session pour {username} (session_id={session_id})")

    conn = _get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        # Générer un token unique
        session_token = generate_session_token()
        logger.info(f"[PERSISTENT] Token généré: {session_token[:16]}...")

        # Calculer expiration
        expires_at = datetime.now() + timedelta(days=SESSION_COOKIE_DAYS)

        # Préparer les données de session en JSON
        session_data = {
            "username": username,
            "user_id": user_id,
            "user_role": user_role,
            "permissions": permissions,
            "entreprise_id": entreprise_id,
            "entreprise_nom": entreprise_nom,
            "schema_name": schema_name,
            "is_super_admin": is_super_admin,
            "created_at": datetime.now().isoformat(),
            **(extra_data or {})
        }

        # Supprimer l'ancienne session si elle existe
        cursor.execute(
            'DELETE FROM active_sessions WHERE session_id = %s OR username = %s',
            (session_id, username)
        )
        deleted_count = cursor.rowcount
        if deleted_count > 0:
            logger.info(f"[PERSISTENT] {deleted_count} ancienne(s) session(s) supprimée(s)")

        # Insérer la nouvelle session
        cursor.execute('''
            INSERT INTO active_sessions (
                session_id, session_token, username, user_id, user_role,
                permissions, entreprise_id, entreprise_nom, schema_name,
                is_super_admin, session_data, login_time, last_activity, expires_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
        ''', (
            session_id,
            session_token,
            username,
            user_id,
            user_role,
            permissions,
            entreprise_id,
            entreprise_nom,
            schema_name,
            is_super_admin,
            json.dumps(session_data),
            datetime.now(),
            datetime.now(),
            expires_at
        ))

        conn.commit()
        logger.info(f"[PERSISTENT] Session créée pour {username} (expire: {expires_at})")

        return session_token

    except Exception as e:
        logger.error(f"[PERSISTENT] Erreur création session pour {username}: {e}")
        import traceback
        logger.error(f"[PERSISTENT] Traceback: {traceback.format_exc()}")
        conn.rollback()
        return None
    finally:
        cursor.close()
        conn.close()


def get_session_by_token(session_token: str) -> Optional[Dict[str, Any]]:
    """
    Récupère une session à partir de son token.
    """
    if not session_token:
        return None

    conn = _get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        cursor.execute('''
            SELECT
                session_id, username, user_id, user_role, permissions,
                entreprise_id, entreprise_nom, schema_name, is_super_admin,
                session_data, login_time, last_activity, expires_at
            FROM active_sessions
            WHERE session_token = %s
            AND (expires_at IS NULL OR expires_at > NOW())
        ''', (session_token,))

        row = cursor.fetchone()

        if not row:
            logger.debug("[PERSISTENT] Token non trouvé ou expiré")
            return None

        # Mettre à jour last_activity
        cursor.execute('''
            UPDATE active_sessions
            SET last_activity = %s
            WHERE session_token = %s
        ''', (datetime.now(), session_token))
        conn.commit()

        # Construire le résultat
        session_data = row['session_data'] or {}
        if isinstance(session_data, str):
            session_data = json.loads(session_data)

        result = {
            'session_id': row['session_id'],
            'username': row['username'],
            'user_id': row['user_id'],
            'user_role': row['user_role'],
            'permissions': row['permissions'] or [],
            'entreprise_id': row['entreprise_id'],
            'entreprise_nom': row['entreprise_nom'],
            'schema_name': row['schema_name'],
            'is_super_admin': row['is_super_admin'],
            'login_time': row['login_time'],
            'last_activity': row['last_activity'],
            'expires_at': row['expires_at'],
            **session_data
        }

        logger.info(f"[PERSISTENT] Session restaurée pour {row['username']}")
        return result

    except Exception as e:
        logger.error(f"[PERSISTENT] Erreur lecture session: {e}")
        return None
    finally:
        cursor.close()
        conn.close()


def delete_session_by_token(session_token: str) -> bool:
    """
    Supprime une session (logout).
    """
    if not session_token:
        return False

    conn = _get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")
        cursor.execute(
            'DELETE FROM active_sessions WHERE session_token = %s',
            (session_token,)
        )
        conn.commit()
        logger.info("[PERSISTENT] Session supprimée de la BD")
        return True
    except Exception as e:
        logger.error(f"[PERSISTENT] Erreur suppression: {e}")
        return False
    finally:
        cursor.close()
        conn.close()


def cleanup_expired_sessions() -> int:
    """
    Nettoie les sessions expirées.
    """
    conn = _get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")
        cursor.execute('''
            DELETE FROM active_sessions
            WHERE expires_at IS NOT NULL AND expires_at < NOW()
        ''')
        deleted = cursor.rowcount
        conn.commit()

        if deleted > 0:
            logger.info(f"[PERSISTENT] {deleted} session(s) expirée(s) supprimée(s)")

        return deleted
    except Exception as e:
        logger.error(f"[PERSISTENT] Erreur cleanup: {e}")
        return 0
    finally:
        cursor.close()
        conn.close()


# ============================================
# FONCTIONS PRINCIPALES POUR APP.PY
# ============================================

def try_restore_session() -> bool:
    """
    Tente de restaurer une session existante depuis le cookie.
    À appeler au début de app.py, avant l'affichage du login.

    Utilise st.context.cookies (Streamlit 1.37+) pour lecture synchrone
    des cookies HTTP — fonctionne dès le premier render, sans JS.
    Fallback sur CookieController si st.context.cookies non disponible.

    Returns:
        True si une session a été restaurée, False sinon
    """
    # Si déjà authentifié, ne rien faire
    if st.session_state.get('admin_authenticated', False):
        return True

    # Vérifier si on a déjà échoué la restauration (éviter boucle infinie)
    if st.session_state.get('_restore_failed', False):
        return False

    try:
        # Lire le token depuis le cookie (st.context.cookies = synchrone!)
        token = get_cookie(SESSION_COOKIE_NAME)

        if not token:
            logger.debug("[PERSISTENT] Pas de cookie de session trouvé")
            st.session_state._restore_failed = True
            return False

        logger.info(f"[PERSISTENT] Token trouvé, tentative de restauration...")

        # Récupérer la session depuis PostgreSQL
        session_data = get_session_by_token(token)

        if not session_data:
            # Session invalide ou expirée - supprimer le cookie
            logger.info("[PERSISTENT] Session invalide/expirée, suppression du cookie")
            delete_cookie(SESSION_COOKIE_NAME)
            return False

        # Restaurer la session dans st.session_state
        st.session_state.admin_authenticated = True
        st.session_state.admin_username = session_data['username']
        st.session_state.username = session_data['username']
        st.session_state.user_id = session_data['user_id']
        st.session_state.user_role = session_data['user_role']
        st.session_state.admin_permissions = session_data['permissions']
        st.session_state.app_mode = "erp"

        # Restaurer les infos tenant si disponibles
        if session_data.get('entreprise_id'):
            st.session_state.entreprise_id = session_data['entreprise_id']
            st.session_state.tenant_id = session_data['entreprise_id']
        if session_data.get('entreprise_nom'):
            st.session_state.entreprise_nom = session_data['entreprise_nom']
            st.session_state.tenant_nom = session_data['entreprise_nom']
        if session_data.get('schema_name'):
            st.session_state.tenant_schema = session_data['schema_name']
        if session_data.get('is_super_admin'):
            st.session_state.is_super_admin = session_data['is_super_admin']

        # Restaurer is_admin
        st.session_state.is_admin = session_data.get('is_super_admin', False) or session_data.get('user_role') == 'admin'

        # Marquer comme authentifié pour le système multi-tenant
        st.session_state.authenticated = True

        # Restaurer le temps de login
        if session_data.get('login_time'):
            st.session_state.admin_login_time = session_data['login_time']

        # Stocker le token pour logout ultérieur
        st.session_state._persistent_token = token

        logger.info(f"[PERSISTENT] Session restaurée pour {session_data['username']} (tenant: {session_data.get('entreprise_nom', 'N/A')})")

        return True

    except Exception as e:
        logger.error(f"[PERSISTENT] Erreur restauration: {e}")
        import traceback
        logger.error(f"[PERSISTENT] Traceback: {traceback.format_exc()}")
        return False


def save_current_session() -> Optional[str]:
    """
    Sauvegarde la session actuelle pour persistance.
    À appeler après un login réussi.

    Returns:
        Token de session ou None si erreur
    """
    if not st.session_state.get('admin_authenticated', False) and not st.session_state.get('authenticated', False):
        logger.debug("[PERSISTENT] Pas de session à sauvegarder")
        return None

    try:
        # Générer un session_id si pas déjà présent
        if 'session_id' not in st.session_state:
            st.session_state.session_id = generate_session_token()[:32]

        # Récupérer les infos de session
        username = st.session_state.get('admin_username') or st.session_state.get('username', '')
        user_id = st.session_state.get('user_id', 0)
        user_role = st.session_state.get('user_role', 'user')
        permissions = st.session_state.get('admin_permissions', [])

        # Créer la session persistante dans PostgreSQL
        token = create_persistent_session(
            session_id=st.session_state.session_id,
            username=username,
            user_id=user_id,
            user_role=user_role,
            permissions=permissions,
            entreprise_id=st.session_state.get('entreprise_id') or st.session_state.get('tenant_id'),
            entreprise_nom=st.session_state.get('entreprise_nom') or st.session_state.get('tenant_nom'),
            schema_name=st.session_state.get('tenant_schema'),
            is_super_admin=st.session_state.get('is_super_admin', False)
        )

        if token:
            # Définir le cookie (via cookie manager + JS backup)
            set_cookie(SESSION_COOKIE_NAME, token, SESSION_COOKIE_DAYS)

            # Stocker le token dans session_state pour logout
            st.session_state._persistent_token = token
            logger.info(f"[PERSISTENT] Session persistée pour {username}")

        return token

    except Exception as e:
        logger.error(f"[PERSISTENT] Erreur sauvegarde: {e}")
        import traceback
        logger.error(f"[PERSISTENT] Traceback: {traceback.format_exc()}")
        return None


def logout_persistent():
    """
    Déconnexion complète avec suppression de la session persistante.
    """
    try:
        # Supprimer de PostgreSQL
        token = st.session_state.get('_persistent_token')
        if token:
            delete_session_by_token(token)

        # Supprimer le cookie
        delete_cookie(SESSION_COOKIE_NAME)

    except Exception as e:
        logger.error(f"[PERSISTENT] Erreur logout: {e}")

    # Nettoyer session_state
    keys_to_clear = [
        'admin_authenticated', 'admin_username', 'username', 'user_id',
        'admin_login_time', 'admin_permissions', 'user_role', 'app_mode',
        'entreprise_id', 'entreprise_nom', 'tenant_schema', 'is_super_admin',
        'session_id', '_persistent_token', 'authenticated', 'tenant_id', 'tenant_nom',
        '_restore_attempted', '_restore_failed', '_restore_attempts', 'is_admin'
    ]

    for key in keys_to_clear:
        if key in st.session_state:
            del st.session_state[key]

    logger.info("[PERSISTENT] Déconnexion complète effectuée")


# ============================================
# INITIALISATION AU CHARGEMENT DU MODULE
# ============================================

try:
    init_persistent_sessions_table()
except Exception as e:
    logger.warning(f"[PERSISTENT] Impossible d'initialiser: {e}")
