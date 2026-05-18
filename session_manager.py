"""
Session Manager - ERP Constructo AI
=============================
Gestion sécurisée des sessions utilisateur avec Streamlit.

Fonctionnalités :
- Timeout automatique désactivable (DISABLE_SESSION_TIMEOUT)
- Tokens CSRF
- Renouvellement automatique d'activité
- Validation de session
- Détection d'inactivité (si timeout activé)
- Nettoyage automatique sessions expirées

Auteur: Constructo AI
Date: Janvier 2025
Version: 1.1.0 - Timeout désactivable

CONFIGURATION:
- DISABLE_SESSION_TIMEOUT = True : Session infinie (déconnexion manuelle uniquement)
- DISABLE_SESSION_TIMEOUT = False : Timeout après X minutes d'inactivité
"""

import time
import streamlit as st
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from security_utils import TokenGenerator

logger = logging.getLogger(__name__)

# ===== CONFIGURATION TIMEOUT =====
# Mettre à True pour désactiver complètement le timeout de session
# L'utilisateur reste connecté indéfiniment jusqu'à déconnexion manuelle
DISABLE_SESSION_TIMEOUT = False


class SessionManager:
    """
    Gestionnaire de sessions sécurisé pour Streamlit.

    Configuration par défaut :
    - Timeout: 480 minutes (8 heures) d'inactivité
    - Renouvellement automatique de l'activité
    - Tokens CSRF pour protection
    """

    # Configuration timeout (minutes) - 8 heures pour une journée de travail complète
    DEFAULT_TIMEOUT_MINUTES = 480
    MAX_TIMEOUT_MINUTES = 480  # 8 heures max

    def __init__(self, timeout_minutes: int = DEFAULT_TIMEOUT_MINUTES):
        """
        Initialise le gestionnaire de sessions.

        Args:
            timeout_minutes: Durée d'inactivité avant expiration (minutes)
        """
        self.timeout_minutes = min(timeout_minutes, self.MAX_TIMEOUT_MINUTES)
        self.timeout_seconds = self.timeout_minutes * 60

        logger.info(f"SessionManager initialisé: timeout {self.timeout_minutes} minutes")

    @staticmethod
    def initialize_session():
        """
        Initialise une nouvelle session utilisateur.

        Appelé après authentification réussie.
        """
        # Timestamp dernière activité
        st.session_state.last_activity = time.time()

        # ID de session unique
        if 'session_id' not in st.session_state:
            st.session_state.session_id = TokenGenerator.generate_session_id()

        # Token CSRF
        if 'csrf_token' not in st.session_state:
            st.session_state.csrf_token = TokenGenerator.generate_csrf_token()

        # Marquer session comme initialisée
        st.session_state.session_initialized = True

        logger.info(
            f"Session initialisée: ID={st.session_state.session_id[:16]}..."
        )

    def check_session_timeout(self) -> bool:
        """
        Vérifie si la session est expirée (inactivité).

        Returns:
            True si session valide, False si expirée

        Usage:
            if not session_manager.check_session_timeout():
                # Session expirée, déconnecter
                logout()

        Note:
            Si DISABLE_SESSION_TIMEOUT = True, retourne toujours True
            (session infinie jusqu'à déconnexion manuelle)
        """
        # Si timeout désactivé, session toujours valide
        if DISABLE_SESSION_TIMEOUT:
            # Mettre à jour last_activity pour le tracking (optionnel)
            if st.session_state.get('admin_authenticated', False):
                st.session_state.last_activity = time.time()
            return True

        # Si pas de session active, retourner False
        if not st.session_state.get('admin_authenticated', False):
            return False

        # Vérifier si last_activity existe
        if 'last_activity' not in st.session_state:
            st.session_state.last_activity = time.time()
            return True

        # Calculer temps écoulé
        now = time.time()
        elapsed_seconds = now - st.session_state.last_activity

        # Vérifier timeout
        if elapsed_seconds > self.timeout_seconds:
            # Session expirée
            elapsed_minutes = int(elapsed_seconds / 60)

            logger.warning(
                f"Session expirée: {elapsed_minutes} min d'inactivité "
                f"(user: {st.session_state.get('admin_username', 'unknown')})"
            )

            return False

        # Session valide, renouveler activité
        st.session_state.last_activity = now

        return True

    def get_remaining_time(self) -> int:
        """
        Obtient le temps restant avant expiration (secondes).

        Returns:
            Secondes restantes (0 si expiré ou pas de session)
            -1 si timeout désactivé (session infinie)
        """
        # Si timeout désactivé, retourner -1 (infini)
        if DISABLE_SESSION_TIMEOUT:
            return -1

        if 'last_activity' not in st.session_state:
            return 0

        now = time.time()
        elapsed = now - st.session_state.last_activity
        remaining = self.timeout_seconds - elapsed

        return max(0, int(remaining))

    def get_remaining_time_formatted(self) -> str:
        """
        Obtient le temps restant formaté (HH:MM:SS).

        Returns:
            String formaté ex: "25:30" ou "∞" si timeout désactivé
        """
        remaining_seconds = self.get_remaining_time()

        # Timeout désactivé = session infinie
        if remaining_seconds == -1:
            return "∞"

        if remaining_seconds == 0:
            return "00:00"

        minutes = remaining_seconds // 60
        seconds = remaining_seconds % 60

        return f"{minutes:02d}:{seconds:02d}"

    def renew_activity(self):
        """
        Renouvelle manuellement le timestamp d'activité.

        À appeler sur interactions importantes de l'utilisateur.
        """
        st.session_state.last_activity = time.time()

    def logout(self):
        """
        Déconnecte l'utilisateur et nettoie la session.
        """
        username = st.session_state.get('admin_username', 'unknown')

        # Logger la déconnexion
        logger.info(f"Déconnexion utilisateur: {username}")

        # Nettoyer toutes les clés de session
        keys_to_clear = [
            'admin_authenticated',
            'admin_username',
            'admin_login_time',
            'admin_permissions',
            'user_role',
            'last_activity',
            'session_id',
            'csrf_token',
            'session_initialized'
        ]

        for key in keys_to_clear:
            if key in st.session_state:
                del st.session_state[key]

        logger.info(f"Session nettoyée pour: {username}")

    def force_logout_with_message(self, message: str = "Session expirée"):
        """
        Force la déconnexion avec un message d'information.

        Args:
            message: Message à afficher
        """
        self.logout()

        st.warning(f"⏱️ {message}")
        st.info("Veuillez vous reconnecter pour continuer.")

        # Forcer rechargement page
        time.sleep(2)
        st.rerun()

    @staticmethod
    def validate_csrf_token(token: str) -> bool:
        """
        Valide un token CSRF.

        Args:
            token: Token à valider

        Returns:
            True si valide, False sinon
        """
        if 'csrf_token' not in st.session_state:
            logger.warning("Tentative validation CSRF sans token session")
            return False

        import hmac as _hmac
        # Comparaison à temps constant pour bloquer les timing attacks.
        is_valid = _hmac.compare_digest(token or "", st.session_state.csrf_token or "")

        if not is_valid:
            logger.warning(
                f"Token CSRF invalide pour user: "
                f"{st.session_state.get('admin_username', 'unknown')}"
            )

        return is_valid

    @staticmethod
    def get_csrf_token() -> str:
        """
        Obtient le token CSRF de la session actuelle.

        Returns:
            Token CSRF (génère un nouveau si n'existe pas)
        """
        if 'csrf_token' not in st.session_state:
            st.session_state.csrf_token = TokenGenerator.generate_csrf_token()

        return st.session_state.csrf_token

    @staticmethod
    def regenerate_csrf_token():
        """
        Régénère un nouveau token CSRF (après actions sensibles).
        """
        st.session_state.csrf_token = TokenGenerator.generate_csrf_token()
        logger.info("Token CSRF régénéré")

    @staticmethod
    def require_csrf_validation(token: str):
        """
        Validates a CSRF token and raises an error if invalid.

        This is a convenience wrapper around validate_csrf_token for calling
        code that wants to enforce CSRF validation with a single call.

        Args:
            token: The CSRF token to validate.

        Raises:
            PermissionError: If the token is invalid or missing.
        """
        if not SessionManager.validate_csrf_token(token):
            raise PermissionError("CSRF token validation failed: invalid or missing token")

    @staticmethod
    def regenerate_session_id():
        """
        Regenerates the session ID while preserving all other session data.

        Should be called after successful authentication to prevent
        session fixation attacks.
        """
        old_id = st.session_state.get('session_id', 'N/A')
        st.session_state.session_id = TokenGenerator.generate_session_id()
        logger.info(
            f"Session ID regenerated: old={old_id[:16]}... "
            f"new={st.session_state.session_id[:16]}..."
        )

    def get_session_info(self) -> Dict[str, Any]:
        """
        Obtient les informations de la session actuelle.

        Returns:
            Dictionnaire avec infos session
        """
        if not st.session_state.get('admin_authenticated', False):
            return {'authenticated': False}

        login_time = st.session_state.get('admin_login_time')
        if login_time:
            session_duration = datetime.now() - login_time
            session_duration_minutes = int(session_duration.total_seconds() / 60)
        else:
            session_duration_minutes = 0

        return {
            'authenticated': True,
            'username': st.session_state.get('admin_username', 'unknown'),
            'role': st.session_state.get('user_role', 'user'),
            'login_time': login_time,
            'session_duration_minutes': session_duration_minutes,
            'remaining_time_seconds': self.get_remaining_time(),
            'remaining_time_formatted': self.get_remaining_time_formatted(),
            'session_id': st.session_state.get('session_id', 'N/A')[:16] + '...',
            'permissions': st.session_state.get('admin_permissions', [])
        }

    def display_session_info_widget(self):
        """
        Affiche un widget avec infos session (pour sidebar).
        """
        info = self.get_session_info()

        if not info['authenticated']:
            return

        with st.sidebar:
            st.markdown("---")
            st.markdown("### 👤 Session")

            # Afficher info utilisateur
            st.text(f"Utilisateur: {info['username']}")
            st.text(f"Rôle: {info['role']}")

            # Afficher temps restant ou session permanente
            if DISABLE_SESSION_TIMEOUT:
                # Session permanente - pas d'expiration
                st.success("✅ Session permanente")
            else:
                remaining_minutes = info['remaining_time_seconds'] // 60

                if remaining_minutes < 5:
                    # Avertir si < 5 minutes
                    st.warning(
                        f"⏱️ Expiration dans {info['remaining_time_formatted']}"
                    )
                else:
                    st.text(f"Expiration: {info['remaining_time_formatted']}")

                # Bouton renouveler (seulement si timeout activé)
                if st.button("🔄 Renouveler session", key="renew_session_btn"):
                    self.renew_activity()
                    st.success("✅ Session renouvelée!")
                    st.rerun()

            # Durée session
            st.text(f"Connecté: {info['session_duration_minutes']} min")

    @staticmethod
    def is_authenticated() -> bool:
        """
        Vérifie si l'utilisateur est authentifié.

        Returns:
            True si authentifié, False sinon
        """
        return st.session_state.get('admin_authenticated', False)

    @staticmethod
    def get_current_username() -> Optional[str]:
        """
        Obtient le nom d'utilisateur de la session actuelle.

        Returns:
            Username ou None si pas authentifié
        """
        if not SessionManager.is_authenticated():
            return None

        return st.session_state.get('admin_username')

    @staticmethod
    def get_current_role() -> Optional[str]:
        """
        Obtient le rôle de l'utilisateur actuel.

        Returns:
            Rôle ou None si pas authentifié
        """
        if not SessionManager.is_authenticated():
            return None

        return st.session_state.get('user_role', 'user')

    @staticmethod
    def has_permission(permission: str) -> bool:
        """
        Vérifie si l'utilisateur a une permission spécifique.

        Args:
            permission: Permission à vérifier (ex: "projects", "employees")

        Returns:
            True si l'utilisateur a la permission, False sinon
        """
        if not SessionManager.is_authenticated():
            return False

        permissions = st.session_state.get('admin_permissions', [])

        # Admin ALL a toutes les permissions
        if "ALL" in permissions:
            return True

        return permission in permissions


# ===== INSTANCE GLOBALE =====
# Instance par défaut avec timeout 480 minutes (8 heures)
session_manager = SessionManager(timeout_minutes=480)


# ===== DÉCORATEUR POUR PROTÉGER LES PAGES =====

def require_authentication(func):
    """
    Décorateur pour protéger une fonction/page.

    Usage:
        @require_authentication
        def protected_page():
            st.write("Contenu protégé")
    """
    def wrapper(*args, **kwargs):
        if not SessionManager.is_authenticated():
            st.error("🔒 Accès refusé: Authentification requise")
            st.stop()

        return func(*args, **kwargs)

    return wrapper


def require_permission(permission: str):
    """
    Décorateur pour protéger une fonction/page avec permission spécifique.

    Usage:
        @require_permission("projects")
        def projects_page():
            st.write("Gestion projets")
    """
    def decorator(func):
        def wrapper(*args, **kwargs):
            if not SessionManager.is_authenticated():
                st.error("🔒 Accès refusé: Authentification requise")
                st.stop()

            if not SessionManager.has_permission(permission):
                st.error(
                    f"🔒 Accès refusé: Permission '{permission}' requise"
                )
                st.stop()

            return func(*args, **kwargs)

        return wrapper
    return decorator


# ===== FONCTIONS UTILITAIRES =====

def check_and_logout_if_expired():
    """
    Vérifie le timeout et déconnecte si expiré.

    À appeler au début de app.py.

    Note:
        Si DISABLE_SESSION_TIMEOUT = True, cette fonction ne fait rien
        (la session reste active indéfiniment)
    """
    # Si timeout désactivé, ne rien faire
    if DISABLE_SESSION_TIMEOUT:
        return

    if SessionManager.is_authenticated():
        if not session_manager.check_session_timeout():
            session_manager.force_logout_with_message(
                f"Session expirée après {session_manager.timeout_minutes} minutes d'inactivité"
            )


def display_session_timer():
    """
    Affiche un timer de session dans la sidebar.
    """
    session_manager.display_session_info_widget()


# ===== TESTS UNITAIRES INTÉGRÉS =====

if __name__ == "__main__":
    print("=== Tests Session Manager ===\n")

    # Note: Ces tests sont limités car ils nécessitent Streamlit
    # Tests complets doivent être faits dans l'application

    print("Test 1: Configuration Timeout")
    print(f"  DISABLE_SESSION_TIMEOUT: {DISABLE_SESSION_TIMEOUT}")
    if DISABLE_SESSION_TIMEOUT:
        print("  → Session PERMANENTE (pas d'expiration automatique)")
    else:
        print(f"  → Timeout après inactivité activé")
    print()

    print("Test 2: Initialisation Session Manager")
    sm = SessionManager(timeout_minutes=480)
    print(f"  Timeout configuré: {sm.timeout_minutes} minutes")
    print(f"  Timeout en secondes: {sm.timeout_seconds}")
    print()

    print("Test 3: Génération tokens")
    csrf_token = TokenGenerator.generate_csrf_token()
    session_id = TokenGenerator.generate_session_id()
    print(f"  CSRF Token: {csrf_token[:30]}...")
    print(f"  Session ID: {session_id[:30]}...")
    print()

    print("Test 4: Configuration timeout min/max")
    sm_short = SessionManager(timeout_minutes=5)
    sm_long = SessionManager(timeout_minutes=1000)  # Sera limité à 480
    print(f"  Timeout court: {sm_short.timeout_minutes} min")
    print(f"  Timeout long (limité): {sm_long.timeout_minutes} min")
    print()

    print("✅ Tests basiques terminés!")
    print("\n💡 Configuration actuelle:")
    if DISABLE_SESSION_TIMEOUT:
        print("   ✅ Session permanente activée")
        print("   → L'utilisateur reste connecté jusqu'à déconnexion manuelle")
    else:
        print(f"   ⏱️ Timeout: {sm.timeout_minutes} minutes d'inactivité")
        print("   → Tester timeout après inactivité")
        print("   → Tester renouvellement activité")
