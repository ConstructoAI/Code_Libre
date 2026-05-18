"""
Validation des variables d'environnement au demarrage
Verifie que toutes les variables critiques sont configurees

Couvre toutes les variables referenciees dans le codebase:
- os.environ.get() et os.getenv() dans *.py
- Voir .env.example pour la liste complete et la documentation
"""

import os
import re
import logging
from typing import Dict, List, Tuple, Optional

logger = logging.getLogger(__name__)


class EnvValidator:
    """Validateur de variables d'environnement pour production"""

    # Variables CRITIQUES (app ne demarre pas sans)
    CRITICAL_VARS = [
        ('DATABASE_URL', 'URL de connexion PostgreSQL (postgresql://user:pass@host:port/db)'),
        ('ANTHROPIC_API_KEY', 'Cle API Anthropic Claude pour IA (https://console.anthropic.com/)'),
    ]

    # Variables IMPORTANTES (fonctionnalites reduites sans)
    IMPORTANT_VARS = [
        ('SECRET_KEY', 'Cle secrete pour sessions Streamlit'),
        ('DEFAULT_SUPER_ADMIN_PASSWORD', 'Mot de passe super admin (obligatoire en production)'),
        ('ENVIRONMENT', 'Environnement (local/production/staging)'),
    ]

    # Variables de SECURITE (auth admin - au moins un mecanisme requis en prod)
    SECURITY_VARS = [
        ('ADMIN_PASSWORD_HASH', 'Hash bcrypt du mot de passe admin'),
        ('ADMIN_PASSWORD', 'Mot de passe admin (fallback si hash non defini)'),
        ('SESSION_SECRET', 'Cle secrete pour sessions persistantes'),
        ('EMAIL_SECRET_KEY', 'Cle secrete pour chiffrement emails'),
        ('API_SECRET_KEY', 'Cle secrete pour l\'API REST'),
    ]

    # Variables d'INTEGRATION (services externes optionnels)
    INTEGRATION_VARS = [
        ('STRIPE_SECRET_KEY', 'Cle API Stripe pour paiements'),
        ('STRIPE_PUBLISHABLE_KEY', 'Cle publique Stripe (frontend)'),
        ('STRIPE_WEBHOOK_SECRET', 'Secret webhook Stripe'),
        ('STRIPE_PRICE_ID', 'ID du plan ERP Complet Stripe'),
        ('STRIPE_EXPERTS_IA_PRICE_ID', 'ID du plan EXPERTS IA Stripe'),
        ('GITHUB_TOKEN', 'Token GitHub pour backups automatiques'),
        ('GITHUB_REPO', 'Depot GitHub pour backups (owner/repo)'),
        ('SENTRY_DSN', 'DSN Sentry pour monitoring d\'erreurs'),
        ('SMTP_HOST', 'Serveur SMTP pour envoi d\'emails'),
        ('SMTP_USER', 'Utilisateur SMTP'),
        ('SMTP_EMAIL_PASSWORD', 'Mot de passe SMTP'),
    ]

    # Variables OPTIONNELLES (avec valeurs par defaut sensibles)
    OPTIONAL_VARS = [
        ('CLAUDE_API_KEY', 'Cle API Claude (alternative a ANTHROPIC_API_KEY)'),
        ('CLAUDE_MODEL', 'Modele Claude (defaut: claude-opus-4-7)'),
        ('PORT', 'Port serveur (defaut: 8501)'),
        ('APP_URL', 'URL publique de l\'application'),
        ('DEBUG', 'Mode debug (defaut: True en local)'),
        ('ALLOWED_ORIGINS', 'Origines CORS autorisees (virgules separees)'),
        ('RATE_LIMIT_DEFAULT', 'Limite de requetes par heure (defaut: 1000)'),
        ('GITHUB_BACKUP_ENABLED', 'Activer backups GitHub (defaut: false)'),
        ('SKIP_STARTUP_MIGRATIONS', 'Ignorer migrations au demarrage (defaut: false)'),
        ('RESET_DATABASE', 'Reinitialiser la BD (DANGER, defaut: false)'),
        ('MIGRATE_ALL_TENANTS', 'Migrer tous les tenants (defaut: false)'),
        ('FORCE_DB_REPAIR', 'Forcer reparation BD (defaut: false)'),
        ('DB_MIGRATION_NEEDED', 'Signaler migration necessaire (defaut: false)'),
        ('SENTRY_ENVIRONMENT', 'Environnement Sentry (defaut: production)'),
        ('SENTRY_SAMPLE_RATE', 'Taux echantillonnage Sentry (defaut: 0.1)'),
        ('SENTRY_RELEASE', 'Version Sentry (optionnel)'),
        ('ATTACHMENTS_PATH', 'Chemin pieces jointes (optionnel)'),
        ('ATTACHMENTS_DIR', 'Repertoire pieces jointes (optionnel)'),
        ('DATA_PATH', 'Chemin de donnees generique (optionnel)'),
        ('DATA_DIR', 'Repertoire de donnees EXPERTS_AI (defaut: data)'),
        ('BACKUP_PATH', 'Chemin backups (optionnel)'),
        ('BACKUP_LOCAL_DIR', 'Repertoire local backups (defaut: /opt/render/project/data/backups)'),
        ('KEEP_LOCAL_BACKUPS', 'Nombre de backups locaux (defaut: 5)'),
        ('KEEP_GITHUB_RELEASES', 'Nombre de releases GitHub (defaut: 10)'),
        ('MAX_BACKUP_SIZE_MB', 'Taille max backup en Mo (defaut: 100)'),
        ('BACKUP_SCHEDULE_MINUTES', 'Intervalle backup en minutes (defaut: 120)'),
        ('FORCE_BACKUP_ON_START', 'Forcer backup au demarrage (defaut: false)'),
        ('DEBUG_GITHUB_BACKUP', 'Debug backups GitHub (defaut: false)'),
        ('AI_GUARD_EXEMPT_IDS', 'IDs entreprise exemptes de la garde IA (virgules separees)'),
        ('PIPELINE_COST_CEILING', 'Plafond cout pipeline IA en $ CAD (defaut: 5.00)'),
        ('MCP_PORT', 'Port du serveur MCP (defaut: 8100)'),
        ('MCP_TENANT_SCHEMA', 'Schema tenant pour le serveur MCP'),
        ('C2B_PATH', 'Chemin vers le module C2B (defaut: ../C2B-main)'),
        ('LOGIN_URL', 'URL de connexion dans les emails (defaut: https://app.constructoai.ca)'),
        ('SUPPORT_EMAIL', 'Email support dans les emails (defaut: support@constructoai.ca)'),
        ('DEFAULT_ADMIN_PASSWORD', 'Mot de passe admin par defaut (creation utilisateurs)'),
        ('ADMIN_DEFAULT_PASSWORD', 'Mot de passe admin par defaut (EXPERTS_AI)'),
        ('SYLVAIN_DEFAULT_PASSWORD', 'Mot de passe par defaut compte Sylvain'),
    ]

    # Variables PLATFORM (definies automatiquement par la plateforme, ne pas definir manuellement)
    PLATFORM_VARS = [
        ('RENDER', 'Indicateur plateforme Render (auto)'),
        ('RENDER_EXTERNAL_URL', 'URL publique du service Render (auto)'),
        ('RENDER_DATABASE_URL', 'URL BD interne Render (auto)'),
        ('RENDER_PERSISTENT_DISK_PATH', 'Chemin disque persistant Render (auto)'),
        ('RENDER_SERVICE_ID', 'ID du service Render (auto)'),
        ('RENDER_GIT_COMMIT', 'Hash du commit deploye (auto)'),
        ('RENDER_DEPLOY_ID', 'ID du deploiement Render (auto)'),
        ('SPACE_ID', 'ID de l\'espace Hugging Face (auto)'),
        ('SPACE_HOST', 'Host de l\'espace Hugging Face (auto)'),
        ('SPACE_AUTHOR_NAME', 'Auteur de l\'espace Hugging Face (auto)'),
        ('SPACE_REPO_NAME', 'Nom du repo Hugging Face (auto)'),
        ('PERSISTENT_STORAGE_PATH', 'Chemin stockage persistant HF (auto)'),
    ]

    def __init__(self):
        self.errors: List[str] = []
        self.warnings: List[str] = []
        self.info: List[str] = []

    def _validate_database_url(self, value: str) -> bool:
        """Valide le format de DATABASE_URL."""
        if not (value.startswith('postgresql://') or value.startswith('postgres://')):
            self.errors.append(
                "CRITIQUE: DATABASE_URL doit commencer par postgresql:// ou postgres://"
            )
            return False
        # Verifier qu'il y a un host apres le ://
        pattern = r'^postgres(ql)?://[^@]+@[^/]+/.+'
        if not re.match(pattern, value):
            self.warnings.append(
                "IMPORTANT: DATABASE_URL semble mal formee "
                "(format attendu: postgresql://user:pass@host:port/dbname)"
            )
        return True

    def _validate_anthropic_key(self, value: str) -> bool:
        """Valide le format de la cle API Anthropic."""
        if not value.startswith('sk-ant-'):
            self.warnings.append(
                "IMPORTANT: ANTHROPIC_API_KEY devrait commencer par 'sk-ant-' "
                "(format Anthropic standard)"
            )
            return False
        return True

    def _validate_stripe_keys_consistency(self):
        """Verifie que les cles Stripe sont coherentes (toutes ou aucune)."""
        stripe_vars = ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY']
        defined = [v for v in stripe_vars if os.environ.get(v)]
        if 0 < len(defined) < len(stripe_vars):
            missing = [v for v in stripe_vars if v not in defined]
            self.warnings.append(
                f"IMPORTANT: Configuration Stripe incomplete - "
                f"defini: {defined}, manquant: {missing}"
            )

    def _validate_smtp_consistency(self):
        """Verifie que la config SMTP est coherente."""
        smtp_vars = ['SMTP_HOST', 'SMTP_USER', 'SMTP_EMAIL_PASSWORD']
        defined = [v for v in smtp_vars if os.environ.get(v)]
        if 0 < len(defined) < len(smtp_vars):
            missing = [v for v in smtp_vars if v not in defined]
            self.warnings.append(
                f"IMPORTANT: Configuration SMTP incomplete - "
                f"defini: {defined}, manquant: {missing}"
            )

    def _validate_dangerous_flags(self):
        """Alerte sur les drapeaux dangereux actifs en production."""
        env = os.environ.get('ENVIRONMENT', 'local')
        if env == 'production':
            if os.environ.get('RESET_DATABASE', '').lower() == 'true':
                self.errors.append(
                    "CRITIQUE: RESET_DATABASE=true en PRODUCTION! "
                    "Cela va detruire toutes les donnees!"
                )
            if os.environ.get('FORCE_DB_REPAIR', '').lower() == 'true':
                self.warnings.append(
                    "IMPORTANT: FORCE_DB_REPAIR=true en production - "
                    "assurez-vous que c'est intentionnel"
                )
            if os.environ.get('DEBUG', '').lower() == 'true':
                self.warnings.append(
                    "IMPORTANT: DEBUG=true en production - "
                    "desactivez pour la securite et la performance"
                )

    def _validate_security_in_production(self):
        """Verifie que les variables de securite sont definies en production."""
        env = os.environ.get('ENVIRONMENT', 'local')
        if env != 'production':
            return

        # En production, au moins un mecanisme d'auth admin doit etre defini
        has_admin_auth = any([
            os.environ.get('ADMIN_PASSWORD_HASH'),
            os.environ.get('ADMIN_PASSWORD'),
            os.environ.get('DEFAULT_SUPER_ADMIN_PASSWORD'),
        ])
        if not has_admin_auth:
            self.warnings.append(
                "IMPORTANT: Aucun mecanisme d'authentification admin configure en production. "
                "Definissez ADMIN_PASSWORD_HASH ou DEFAULT_SUPER_ADMIN_PASSWORD"
            )

        if not os.environ.get('SECRET_KEY'):
            self.warnings.append(
                "IMPORTANT: SECRET_KEY non defini en production - "
                "les sessions ne seront pas securisees"
            )

    def _detect_platform(self) -> str:
        """Detecte la plateforme de deploiement."""
        if os.environ.get('RENDER'):
            return 'render'
        if os.environ.get('SPACE_ID') or os.environ.get('SPACE_HOST'):
            return 'huggingface'
        return 'local'

    def validate_all(self) -> Tuple[bool, Dict]:
        """
        Valide toutes les variables d'environnement.

        Returns:
            Tuple[bool, Dict]: (succes, details)
        """
        self.errors = []
        self.warnings = []
        self.info = []

        platform = self._detect_platform()
        self.info.append(f"Plateforme detectee: {platform}")

        # Valider variables critiques
        for var_name, description in self.CRITICAL_VARS:
            value = os.environ.get(var_name)
            if not value:
                # ANTHROPIC_API_KEY a un fallback vers CLAUDE_API_KEY
                if var_name == 'ANTHROPIC_API_KEY' and os.environ.get('CLAUDE_API_KEY'):
                    self.info.append(
                        f"OK {var_name}: Non defini mais CLAUDE_API_KEY present (fallback)"
                    )
                    continue
                self.errors.append(
                    f"CRITIQUE: {var_name} non defini ({description})"
                )
            else:
                if var_name == 'DATABASE_URL':
                    self._validate_database_url(value)
                elif var_name == 'ANTHROPIC_API_KEY':
                    self._validate_anthropic_key(value)
                self.info.append(f"OK {var_name}: Configure")

        # Valider variables importantes
        for var_name, description in self.IMPORTANT_VARS:
            value = os.environ.get(var_name)
            if not value:
                self.warnings.append(
                    f"IMPORTANT: {var_name} non defini ({description})"
                )
            else:
                self.info.append(f"OK {var_name}: Configure")

        # Valider variables optionnelles
        for var_name, description in self.OPTIONAL_VARS:
            value = os.environ.get(var_name)
            if not value:
                self.info.append(f"OPTIONNEL: {var_name} non defini ({description})")
            else:
                self.info.append(f"OK {var_name}: Configure")

        # Validations croisees
        self._validate_stripe_keys_consistency()
        self._validate_smtp_consistency()
        self._validate_dangerous_flags()
        self._validate_security_in_production()

        # Info sur les variables plateforme detectees
        for var_name, description in self.PLATFORM_VARS:
            value = os.environ.get(var_name)
            if value:
                self.info.append(f"PLATEFORME {var_name}: Detecte")

        success = len(self.errors) == 0

        return success, {
            'success': success,
            'errors': self.errors,
            'warnings': self.warnings,
            'info': self.info,
            'platform': platform,
            'critical_count': len([e for e in self.errors if 'CRITIQUE' in e]),
            'warning_count': len(self.warnings),
            'env_summary': {
                'database': bool(os.environ.get('DATABASE_URL')),
                'ai_api': bool(
                    os.environ.get('ANTHROPIC_API_KEY')
                    or os.environ.get('CLAUDE_API_KEY')
                ),
                'stripe': bool(os.environ.get('STRIPE_SECRET_KEY')),
                'sentry': bool(os.environ.get('SENTRY_DSN')),
                'smtp': bool(os.environ.get('SMTP_USER')),
                'github_backup': bool(os.environ.get('GITHUB_TOKEN')),
                'environment': os.environ.get('ENVIRONMENT', 'local'),
            },
        }

    def log_validation_results(self) -> bool:
        """
        Valide et log les resultats.

        Returns:
            bool: True si toutes les variables critiques sont presentes
        """
        success, details = self.validate_all()

        logger.info("=" * 60)
        logger.info("[ENV-VALIDATOR] Validation des variables d'environnement")
        logger.info("[ENV-VALIDATOR] Plateforme: %s | Environnement: %s",
                     details['platform'],
                     details['env_summary']['environment'])
        logger.info("=" * 60)

        # Log des erreurs critiques
        for error in details['errors']:
            logger.error("[ENV-VALIDATOR] %s", error)

        # Log des warnings
        for warning in details['warnings']:
            logger.warning("[ENV-VALIDATOR] %s", warning)

        # Log des infos (niveau DEBUG pour eviter spam)
        for info in details['info']:
            logger.debug("[ENV-VALIDATOR] %s", info)

        # Resume des services
        summary = details['env_summary']
        services = []
        if summary['database']:
            services.append('PostgreSQL')
        if summary['ai_api']:
            services.append('Claude AI')
        if summary['stripe']:
            services.append('Stripe')
        if summary['sentry']:
            services.append('Sentry')
        if summary['smtp']:
            services.append('SMTP')
        if summary['github_backup']:
            services.append('GitHub Backup')

        logger.info("[ENV-VALIDATOR] Services actifs: %s",
                     ', '.join(services) if services else 'Aucun')

        if success:
            logger.info("[ENV-VALIDATOR] Validation reussie - Variables critiques OK")
        else:
            logger.error(
                "[ENV-VALIDATOR] Validation echouee - %d erreurs critiques!",
                details['critical_count']
            )

        logger.info("=" * 60)

        return success

    @staticmethod
    def get_safe_database_info() -> Optional[str]:
        """
        Retourne les informations de connexion DB de maniere securisee (sans mot de passe).

        Returns:
            str: Host/DB info ou None si non configure
        """
        db_url = os.environ.get('DATABASE_URL', '')
        if not db_url:
            return None

        try:
            # Extraire host sans credentials
            if '@' in db_url:
                after_at = db_url.split('@')[1]
                host_db = after_at.split('?')[0] if '?' in after_at else after_at
                return host_db
            return 'localhost'
        except Exception:
            return 'unknown'

    @staticmethod
    def get_missing_vars_report() -> Dict[str, List[str]]:
        """
        Genere un rapport des variables manquantes par categorie.

        Returns:
            Dict avec cles: critical, important, security, integration, optional
        """
        validator = EnvValidator()
        report = {
            'critical': [],
            'important': [],
            'security': [],
            'integration': [],
            'optional': [],
        }

        for var_name, desc in validator.CRITICAL_VARS:
            if not os.environ.get(var_name):
                # Gerer le fallback ANTHROPIC_API_KEY -> CLAUDE_API_KEY
                if var_name == 'ANTHROPIC_API_KEY' and os.environ.get('CLAUDE_API_KEY'):
                    continue
                report['critical'].append(f"{var_name}: {desc}")

        for var_name, desc in validator.IMPORTANT_VARS:
            if not os.environ.get(var_name):
                report['important'].append(f"{var_name}: {desc}")

        for var_name, desc in validator.SECURITY_VARS:
            if not os.environ.get(var_name):
                report['security'].append(f"{var_name}: {desc}")

        for var_name, desc in validator.INTEGRATION_VARS:
            if not os.environ.get(var_name):
                report['integration'].append(f"{var_name}: {desc}")

        for var_name, desc in validator.OPTIONAL_VARS:
            if not os.environ.get(var_name):
                report['optional'].append(f"{var_name}: {desc}")

        return report


def validate_environment_on_startup() -> bool:
    """
    Fonction utilitaire pour valider l'environnement au demarrage.
    A appeler depuis app.py.

    Returns:
        bool: True si validation reussie
    """
    validator = EnvValidator()
    return validator.log_validation_results()


# Auto-validation si execute directement
if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)
    success = validate_environment_on_startup()

    # Afficher le rapport detaille
    report = EnvValidator.get_missing_vars_report()
    print(f"\n{'='*60}")
    print(f"Resultat: {'SUCCES' if success else 'ECHEC'}")
    print(f"{'='*60}")

    for category, missing in report.items():
        if missing:
            print(f"\n[{category.upper()}] Variables manquantes ({len(missing)}):")
            for var in missing:
                print(f"  - {var}")

    print()
