# auth_config_secure.py - Configuration d'Authentification SÉCURISÉE
# ERP Production DG Inc. - Version avec bcrypt OBLIGATOIRE

import os
import hmac
import secrets
import hashlib
import logging
from typing import Dict, Optional, Any

logger = logging.getLogger(__name__)

# ===============================================
# BCRYPT OBLIGATOIRE - Sécurité non négociable
# ===============================================

try:
    import bcrypt
    BCRYPT_AVAILABLE = True
except ImportError:
    BCRYPT_AVAILABLE = False
    logger.critical("[SECURITY] CRITIQUE: bcrypt non installé!")
    logger.critical("[SECURITY] Installez avec: pip install bcrypt>=4.0.0")
    # En production, on devrait lever une exception ici
    # raise ImportError("bcrypt est OBLIGATOIRE pour la sécurité. Installez avec: pip install bcrypt>=4.0.0")

# ===============================================
# CONFIGURATION DES MOTS DE PASSE ADMINISTRATEURS
# ===============================================

# SÉCURITÉ: Les mots de passe DOIVENT être définis via variables d'environnement
# Ne JAMAIS utiliser de valeurs par défaut en production!

def _get_admin_password(username: str, env_var: str) -> Optional[str]:
    """Récupère un mot de passe admin depuis les variables d'environnement uniquement"""
    password = os.environ.get(env_var)
    if not password:
        logger.warning(f"[SECURITY] Variable {env_var} non définie pour {username}")
    return password

# Récupérer les mots de passe UNIQUEMENT depuis les variables d'environnement
ADMIN_PASSWORDS = {}

# Charger les mots de passe depuis l'environnement
_admin_env_vars = {
    "admin": "ADMIN_PASSWORD",
    "dg_admin": "DG_ADMIN_PASSWORD",
    "superviseur": "SUPERVISEUR_PASSWORD",
    "direction": "DIRECTION_PASSWORD",
}

for username, env_var in _admin_env_vars.items():
    password = os.environ.get(env_var)
    if password:
        ADMIN_PASSWORDS[username] = password

# Avertir si aucun mot de passe n'est configuré
if not ADMIN_PASSWORDS:
    logger.warning("[SECURITY] Aucun mot de passe admin configuré via variables d'environnement!")
    logger.warning("[SECURITY] Définissez: ADMIN_PASSWORD, DG_ADMIN_PASSWORD, SUPERVISEUR_PASSWORD, DIRECTION_PASSWORD")

# ===============================================
# FONCTIONS DE HACHAGE ET VÉRIFICATION SÉCURISÉES
# ===============================================

def hash_password(password: str) -> str:
    """
    Hache un mot de passe avec bcrypt (OBLIGATOIRE)

    Args:
        password (str): Mot de passe en clair

    Returns:
        str: Mot de passe haché avec bcrypt

    Raises:
        RuntimeError: Si bcrypt n'est pas disponible
    """
    if not BCRYPT_AVAILABLE:
        logger.error("[SECURITY] Tentative de hachage sans bcrypt!")
        raise RuntimeError(
            "bcrypt est OBLIGATOIRE pour le hachage des mots de passe. "
            "Installez avec: pip install bcrypt>=4.0.0"
        )

    # Utiliser bcrypt avec salt automatique (12 rounds = bon compromis sécurité/performance)
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def verify_password(username: str, password: str, stored_hash: Optional[str] = None) -> bool:
    """
    Vérifie si le mot de passe correspond pour un utilisateur donné

    Args:
        username (str): Nom d'utilisateur
        password (str): Mot de passe fourni
        stored_hash (str, optional): Hash stocké (si None, utilise ADMIN_PASSWORDS)

    Returns:
        bool: True si le mot de passe est correct, False sinon
    """
    # Si pas de hash fourni, vérification contre les mots de passe admin (dev/test uniquement)
    if stored_hash is None:
        if username not in ADMIN_PASSWORDS:
            return False
        expected_password = ADMIN_PASSWORDS[username]

        # Utiliser compare_digest pour éviter les timing attacks
        if hmac.compare_digest(password, expected_password):
            logger.debug(f"[AUTH] Authentification admin réussie pour {username}")
            return True
        return False

    # Vérification avec hash bcrypt (méthode RECOMMANDÉE)
    if BCRYPT_AVAILABLE and stored_hash:
        try:
            # Les hashes bcrypt commencent par $2b$ ou $2a$
            if stored_hash.startswith('$2'):
                result = bcrypt.checkpw(password.encode('utf-8'), stored_hash.encode('utf-8'))
                if result:
                    logger.debug(f"[AUTH] Vérification bcrypt réussie pour {username}")
                return result
        except Exception as e:
            logger.warning(f"[AUTH] Erreur vérification bcrypt pour {username}: {e}")

    # Fallback SHA-256 pour rétrocompatibilité avec anciens hashes
    # NOTE: Ces hashes devraient être migrés vers bcrypt au prochain login
    if stored_hash and '$' in stored_hash and not stored_hash.startswith('$2'):
        try:
            salt, expected_hash = stored_hash.split('$', 1)
            salted_password = password + salt
            computed_hash = hashlib.sha256(salted_password.encode()).hexdigest()
            # Utiliser compare_digest pour éviter les timing attacks
            result = hmac.compare_digest(computed_hash, expected_hash)
            if result:
                logger.warning(f"[SECURITY] Hash SHA-256 détecté pour {username} - Migration vers bcrypt recommandée!")
            return result
        except Exception as e:
            logger.warning(f"[AUTH] Erreur vérification SHA-256 pour {username}: {e}")

    return False

def get_user_permissions(username: str) -> Dict[str, bool]:
    """
    Retourne les permissions d'un utilisateur

    Args:
        username (str): Nom d'utilisateur

    Returns:
        Dict[str, bool]: Dictionnaire des permissions
    """
    # Permissions par défaut
    default_permissions = {
        "view_projects": True,
        "edit_projects": True,
        "delete_projects": False,
        "manage_employees": False,
        "view_financials": True,
        "admin_settings": False,
        "manage_users": False,
        "view_timetracker": True,
        "manage_formulaires": True,
        "manage_fournisseurs": True,
        "use_assistant_ia": True,
    }

    # Permissions spécifiques par utilisateur
    user_permissions = {
        "admin": {
            **default_permissions,
            "delete_projects": True,
            "manage_employees": True,
            "admin_settings": True,
            "manage_users": True,
        },
        "dg_admin": {
            **default_permissions,
            "delete_projects": True,
            "manage_employees": True,
            "admin_settings": True,
        },
        "superviseur": {
            **default_permissions,
            "manage_employees": True,
        },
        "direction": {
            **default_permissions,
            "delete_projects": True,
            "manage_employees": True,
            "view_financials": True,
            "admin_settings": True,
        }
    }

    return user_permissions.get(username, default_permissions)

def is_admin_user(username: str) -> bool:
    """
    Vérifie si un utilisateur est administrateur

    Args:
        username (str): Nom d'utilisateur

    Returns:
        bool: True si l'utilisateur est admin
    """
    return username in ADMIN_PASSWORDS

def get_user_display_name(username: str) -> str:
    """
    Retourne le nom d'affichage d'un utilisateur

    Args:
        username (str): Nom d'utilisateur

    Returns:
        str: Nom d'affichage
    """
    display_names = {
        "admin": "Administrateur Principal",
        "dg_admin": "Admin DG Inc.",
        "superviseur": "Superviseur Production",
        "direction": "Direction Générale"
    }

    return display_names.get(username, username.title())

# ===============================================
# FONCTIONS DE SÉCURITÉ ADDITIONNELLES
# ===============================================

def check_password_strength(password: str) -> Dict[str, bool]:
    """
    Vérifie la force d'un mot de passe

    Args:
        password (str): Mot de passe à vérifier

    Returns:
        Dict[str, bool]: Critères de sécurité
    """
    checks = {
        "min_length": len(password) >= 8,
        "has_uppercase": any(c.isupper() for c in password),
        "has_lowercase": any(c.islower() for c in password),
        "has_digit": any(c.isdigit() for c in password),
        "has_special": any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in password),
    }

    checks["is_strong"] = all(checks.values())

    return checks

def generate_session_token(username: str) -> str:
    """
    Génère un token de session sécurisé

    Args:
        username (str): Nom d'utilisateur

    Returns:
        str: Token de session (URL-safe)
    """
    # Utiliser secrets au lieu de MD5
    return secrets.token_urlsafe(32)  # 32 bytes = 256 bits de sécurité

# ===============================================
# CONFIGURATION DE SÉCURITÉ
# ===============================================

# Nombre maximum de tentatives de connexion
MAX_LOGIN_ATTEMPTS = 3

# Durée de blocage après échec (en secondes)
LOCKOUT_DURATION = 300  # 5 minutes

# Durée de validité d'une session (en secondes)
SESSION_TIMEOUT = 3600  # 1 heure

# ===============================================
# CONFIGURATION API CLAUDE IA
# ===============================================

# Clé API Claude pour l'assistant IA
# Priorité: ANTHROPIC_API_KEY (Hugging Face) > CLAUDE_API_KEY (local)
CLAUDE_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "") or os.environ.get("CLAUDE_API_KEY", "")

# Modèle Claude à utiliser
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-4-7")

# Paramètres de l'assistant IA
IA_CONFIG = {
    "model": CLAUDE_MODEL,
    "max_tokens": 1500,
    "temperature": 0.7,
    "enabled": bool(CLAUDE_API_KEY),
    "max_history": 50,  # Nombre max de messages dans l'historique
    "timeout": 30,      # Timeout en secondes
}

def get_claude_api_key() -> str:
    """Récupère la clé API Claude (ANTHROPIC_API_KEY ou CLAUDE_API_KEY)"""
    return CLAUDE_API_KEY

def is_ia_enabled() -> bool:
    """Vérifie si l'assistant IA est activé"""
    return IA_CONFIG["enabled"]

def get_ia_config() -> Dict[str, Any]:
    """Retourne la configuration de l'assistant IA"""
    return IA_CONFIG.copy()

# ===============================================
# VALIDATION AU DÉMARRAGE
# ===============================================

def validate_auth_config() -> bool:
    """
    Valide la configuration d'authentification

    Returns:
        bool: True si la configuration est valide
    """
    errors = []
    warnings = []

    # Vérifier bcrypt (OBLIGATOIRE)
    if not BCRYPT_AVAILABLE:
        errors.append("bcrypt non installé - OBLIGATOIRE pour la sécurité!")

    # Vérifier qu'il y a au moins un admin configuré via env
    if not ADMIN_PASSWORDS:
        warnings.append("Aucun mot de passe admin configuré via variables d'environnement")

    # Vérifier la force des mots de passe configurés
    for username, password in ADMIN_PASSWORDS.items():
        strength = check_password_strength(password)
        if not strength['is_strong']:
            issues = [k for k, v in strength.items() if not v and k != 'is_strong']
            warnings.append(f"Mot de passe faible pour {username}: manque {issues}")

    # Logger les erreurs
    if errors:
        for error in errors:
            logger.error(f"[SECURITY] {error}")
        return False

    if warnings:
        for warning in warnings:
            logger.warning(f"[SECURITY] {warning}")

    return True

# ===============================================
# MESSAGES D'INFORMATION
# ===============================================

def get_security_info() -> Dict[str, str]:
    """
    Retourne des informations sur la configuration de sécurité

    Returns:
        Dict[str, str]: Informations de sécurité
    """
    return {
        "total_admins": str(len(ADMIN_PASSWORDS)),
        "hashing_method": "bcrypt" if BCRYPT_AVAILABLE else "SHA-256+salt",
        "session_token": "secrets.token_urlsafe(32)",
        "env_configured": "OUI" if any(key.endswith("_PASSWORD") for key in os.environ.keys()) else "NON",
        "session_timeout": f"{SESSION_TIMEOUT // 60} minutes",
        "max_attempts": str(MAX_LOGIN_ATTEMPTS),
    }

# Validation automatique au chargement du module
if __name__ == "__main__":
    # Configuration du logging pour le test
    logging.basicConfig(level=logging.INFO)

    logger.info("[SECURE AUTH] Configuration d'authentification SECURISEE - ERP DG Inc.")
    logger.info("=" * 60)

    # Validation
    is_valid = validate_auth_config()

    # Informations de sécurité
    security_info = get_security_info()
    logger.info("Informations de securite:")
    for key, value in security_info.items():
        logger.info(f"  {key}: {value}")

    # Test des fonctions
    if BCRYPT_AVAILABLE:
        logger.info("Test des fonctions:")
        test_password = "TestP@ssw0rd!2025"
        try:
            hashed = hash_password(test_password)
            logger.info(f"  Hash bcrypt: {hashed[:30]}...")
        except RuntimeError as e:
            logger.error(f"  Erreur hachage: {e}")

        # Test vérification
        if ADMIN_PASSWORDS:
            admin_user = list(ADMIN_PASSWORDS.keys())[0]
            result = verify_password(admin_user, ADMIN_PASSWORDS[admin_user])
            logger.info(f"  Verification {admin_user}: {'OK' if result else 'FAIL'}")

        # Test token
        token = generate_session_token('testuser')
        logger.info(f"  Token session: {token[:20]}... (longueur: {len(token)})")
    else:
        logger.error("bcrypt non disponible - tests ignorés")

    logger.info("Module de securite charge!")
else:
    # Validation silencieuse lors de l'import
    validate_auth_config()
