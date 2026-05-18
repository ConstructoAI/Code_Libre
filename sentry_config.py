# -*- coding: utf-8 -*-
"""
Configuration Sentry - Monitoring des erreurs en production
===========================================================

Pour activer Sentry:
1. Créer un compte sur https://sentry.io
2. Créer un projet Python
3. Ajouter SENTRY_DSN dans les variables d'environnement Render

Variables d'environnement requises:
- SENTRY_DSN: URL de votre projet Sentry (ex: https://xxx@sentry.io/123)

Optionnel:
- SENTRY_ENVIRONMENT: production, staging, development
- SENTRY_RELEASE: version de l'application
"""

import os
import re
import logging
import subprocess

logger = logging.getLogger(__name__)


def _get_release_version():
    """
    Determine the release version dynamically.
    Priority: SENTRY_RELEASE env var > VERSION file > git commit hash > 'unknown'
    """
    # 1. Explicit env var
    env_release = os.getenv("SENTRY_RELEASE", "")
    if env_release:
        return env_release

    # 2. VERSION file in project root
    version_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "VERSION")
    try:
        with open(version_file, "r") as f:
            version = f.read().strip()
            if version:
                return version
    except (FileNotFoundError, OSError):
        pass

    # 3. Git commit hash
    try:
        git_hash = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
            timeout=5,
            cwd=os.path.dirname(os.path.abspath(__file__))
        ).decode("utf-8").strip()
        if git_hash:
            return f"git-{git_hash}"
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass

    return "unknown"


# Configuration par défaut
SENTRY_DSN = os.getenv("SENTRY_DSN", "")
SENTRY_ENABLED = bool(SENTRY_DSN)
SENTRY_ENVIRONMENT = os.getenv("SENTRY_ENVIRONMENT", "production")
SENTRY_RELEASE = _get_release_version()
SENTRY_SAMPLE_RATE = float(os.getenv("SENTRY_SAMPLE_RATE", "0.1"))


def init_sentry():
    """
    Initialise Sentry pour le monitoring des erreurs.

    Returns:
        bool: True si Sentry est initialisé, False sinon
    """
    global SENTRY_ENABLED

    if not SENTRY_DSN:
        logger.info("[Sentry] DSN non configuré - monitoring désactivé")
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.logging import LoggingIntegration

        # Configuration du logging pour Sentry
        sentry_logging = LoggingIntegration(
            level=logging.INFO,        # Capturer INFO et plus
            event_level=logging.ERROR  # Envoyer ERROR et plus comme events
        )

        # Initialisation Sentry
        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment=SENTRY_ENVIRONMENT,
            release=SENTRY_RELEASE,
            integrations=[sentry_logging],

            # Performance monitoring (configurable via SENTRY_SAMPLE_RATE env var)
            traces_sample_rate=SENTRY_SAMPLE_RATE,

            # Filtrer les données sensibles
            send_default_pii=False,

            # Avant d'envoyer un event
            before_send=filter_sensitive_data,
        )

        SENTRY_ENABLED = True
        logger.info(f"[Sentry] ✅ Initialisé - Env: {SENTRY_ENVIRONMENT}")
        return True

    except ImportError:
        logger.warning("[Sentry] Module sentry-sdk non installé")
        return False
    except Exception as e:
        logger.error(f"[Sentry] Erreur initialisation: {e}")
        return False


def filter_sensitive_data(event, hint):
    """
    Filtre les données sensibles avant envoi à Sentry.

    Args:
        event: Event Sentry
        hint: Informations supplémentaires

    Returns:
        event filtré ou None pour ignorer
    """
    # Liste des mots-clés sensibles à masquer
    sensitive_keys = [
        'password', 'passwd', 'pwd',
        'secret', 'token', 'api_key', 'apikey',
        'authorization', 'auth',
        'credit_card', 'card_number',
        'ssn', 'social_security',
        'database_url', 'db_url', 'dsn', 'connection_string',
    ]

    # Regex patterns for sensitive values in strings (database URLs, API keys)
    _sensitive_patterns = [
        # PostgreSQL / database connection URLs
        re.compile(r'(postgres(?:ql)?://)\S+@\S+', re.IGNORECASE),
        # Generic database URLs (mysql, redis, etc.)
        re.compile(r'((?:mysql|redis|mongodb|amqp)://)\S+@\S+', re.IGNORECASE),
        # API keys / tokens (long hex or base64 strings preceded by key-like identifiers)
        re.compile(r'((?:api[_-]?key|token|secret|authorization)[=:"\s]+)\S{16,}', re.IGNORECASE),
        # Anthropic API keys
        re.compile(r'sk-ant-[a-zA-Z0-9_-]+', re.IGNORECASE),
        # Generic secret-looking keys (sk-, pk-, etc.)
        re.compile(r'\b(sk|pk|key)-[a-zA-Z0-9]{20,}\b'),
    ]

    def scrub_string(s):
        """Remove sensitive patterns from a string value."""
        if not isinstance(s, str):
            return s
        for pattern in _sensitive_patterns:
            s = pattern.sub('[FILTERED]', s)
        return s

    def scrub_dict(d):
        """Masque les valeurs sensibles dans un dictionnaire."""
        if not isinstance(d, dict):
            return d

        result = {}
        for key, value in d.items():
            key_lower = key.lower()
            if any(sensitive in key_lower for sensitive in sensitive_keys):
                result[key] = "[FILTERED]"
            elif isinstance(value, dict):
                result[key] = scrub_dict(value)
            elif isinstance(value, list):
                result[key] = [scrub_dict(item) if isinstance(item, dict) else item for item in value]
            elif isinstance(value, str):
                result[key] = scrub_string(value)
            else:
                result[key] = value
        return result

    # Filtrer les données de la requête
    if 'request' in event:
        if 'data' in event['request']:
            event['request']['data'] = scrub_dict(event['request'].get('data', {}))
        if 'headers' in event['request']:
            event['request']['headers'] = scrub_dict(event['request'].get('headers', {}))

    # Filtrer les extras
    if 'extra' in event:
        event['extra'] = scrub_dict(event['extra'])

    # Filtrer les arguments d'exception (stacktrace values)
    if 'exception' in event and 'values' in event.get('exception', {}):
        for exc_info in event['exception']['values']:
            # Scrub exception message/value
            if 'value' in exc_info and isinstance(exc_info['value'], str):
                exc_info['value'] = scrub_string(exc_info['value'])
            # Scrub stacktrace frame variables
            if 'stacktrace' in exc_info and 'frames' in exc_info.get('stacktrace', {}):
                for frame in exc_info['stacktrace']['frames']:
                    if 'vars' in frame and isinstance(frame['vars'], dict):
                        frame['vars'] = scrub_dict(frame['vars'])

    # Filtrer les breadcrumbs
    if 'breadcrumbs' in event:
        breadcrumb_list = event['breadcrumbs']
        # Sentry sends breadcrumbs as {'values': [...]} or as a list
        if isinstance(breadcrumb_list, dict) and 'values' in breadcrumb_list:
            breadcrumb_list = breadcrumb_list['values']
        if isinstance(breadcrumb_list, list):
            for breadcrumb in breadcrumb_list:
                if isinstance(breadcrumb, dict):
                    if 'message' in breadcrumb and isinstance(breadcrumb['message'], str):
                        breadcrumb['message'] = scrub_string(breadcrumb['message'])
                    if 'data' in breadcrumb and isinstance(breadcrumb['data'], dict):
                        breadcrumb['data'] = scrub_dict(breadcrumb['data'])

    return event


def capture_exception(exception, **kwargs):
    """
    Capture une exception et l'envoie à Sentry.

    Args:
        exception: L'exception à capturer
        **kwargs: Données supplémentaires (tags, extra, etc.)
    """
    if not SENTRY_ENABLED:
        logger.error(f"Exception non envoyée à Sentry: {exception}")
        return

    try:
        import sentry_sdk
        sentry_sdk.capture_exception(exception)
    except Exception as e:
        logger.error(f"Erreur capture Sentry: {e}")


def capture_message(message, level="info", **kwargs):
    """
    Capture un message et l'envoie à Sentry.

    Args:
        message: Le message à capturer
        level: Niveau (info, warning, error)
        **kwargs: Données supplémentaires
    """
    if not SENTRY_ENABLED:
        return

    try:
        import sentry_sdk
        sentry_sdk.capture_message(message, level=level)
    except Exception as e:
        logger.error(f"Erreur capture message Sentry: {e}")


def set_user_context(user_id=None, email=None, entreprise_id=None):
    """
    Définit le contexte utilisateur pour Sentry.

    Args:
        user_id: ID de l'utilisateur
        email: Email (sera hashé)
        entreprise_id: ID de l'entreprise
    """
    if not SENTRY_ENABLED:
        return

    try:
        import sentry_sdk
        import hashlib

        user_data = {}
        if user_id:
            user_data['id'] = str(user_id)
        if email:
            # Hasher l'email pour la confidentialité
            user_data['email_hash'] = hashlib.sha256(email.encode()).hexdigest()[:12]
        if entreprise_id:
            user_data['entreprise_id'] = str(entreprise_id)

        sentry_sdk.set_user(user_data)
    except Exception as e:
        logger.error(f"Erreur set_user Sentry: {e}")


def set_tenant_context(tenant_schema, entreprise_id=None, user_id=None):
    """
    Attach multi-tenant context to all subsequent Sentry events.

    Sets tags for filtering/searching in the Sentry dashboard and
    associates user identity so errors can be traced back to a specific
    tenant, company, and user.

    Should be called after successful login, once tenant_schema is known.

    Args:
        tenant_schema: The PostgreSQL schema name for this tenant (e.g. 'tenant_acme')
        entreprise_id: Optional entreprise / company ID
        user_id: Optional user ID within the tenant
    """
    if not SENTRY_ENABLED:
        return

    try:
        import sentry_sdk

        # Tags are indexed and searchable in Sentry
        sentry_sdk.set_tag("tenant_schema", tenant_schema)
        if entreprise_id is not None:
            sentry_sdk.set_tag("entreprise_id", str(entreprise_id))
        if user_id is not None:
            sentry_sdk.set_tag("user_id", str(user_id))

        # Also set user context so Sentry can group issues per tenant/user
        user_data = {"id": str(user_id) if user_id else f"tenant:{tenant_schema}"}
        if entreprise_id is not None:
            user_data["entreprise_id"] = str(entreprise_id)
        user_data["tenant_schema"] = tenant_schema
        sentry_sdk.set_user(user_data)

        logger.debug(f"[Sentry] Tenant context set: schema={tenant_schema}, "
                     f"entreprise_id={entreprise_id}, user_id={user_id}")
    except Exception as e:
        logger.error(f"Erreur set_tenant_context Sentry: {e}")


def add_breadcrumb(message, category="info", level="info", data=None):
    """
    Ajoute un breadcrumb pour le debugging.

    Args:
        message: Message du breadcrumb
        category: Catégorie (http, navigation, user, etc.)
        level: Niveau (debug, info, warning, error)
        data: Données supplémentaires
    """
    if not SENTRY_ENABLED:
        return

    try:
        import sentry_sdk
        sentry_sdk.add_breadcrumb(
            message=message,
            category=category,
            level=level,
            data=data or {}
        )
    except Exception:
        pass


# ============================================================================
# Décorateur pour capturer les erreurs automatiquement
# ============================================================================

def sentry_trace(func):
    """
    Décorateur pour tracer une fonction avec Sentry.

    Usage:
        @sentry_trace
        def ma_fonction():
            ...
    """
    def wrapper(*args, **kwargs):
        add_breadcrumb(
            message=f"Appel: {func.__name__}",
            category="function",
            level="info"
        )
        try:
            return func(*args, **kwargs)
        except Exception as e:
            capture_exception(e)
            raise

    wrapper.__name__ = func.__name__
    wrapper.__doc__ = func.__doc__
    return wrapper


# ============================================================================
# Initialisation automatique au chargement du module
# ============================================================================

# Initialiser Sentry automatiquement si DSN configuré
if SENTRY_DSN:
    init_sentry()
