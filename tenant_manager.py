"""
Gestionnaire Multi-Tenant pour Constructo AI
Gère les entreprises, schémas PostgreSQL et isolation des données

Architecture:
- Schema 'public' : Tables système (entreprises, super_admins)
- Schema 'tenant_XXX' : Tables de chaque entreprise (users, projects, etc.)

Fix 2025-12-03: Nettoyage auto email (https:// prefix) + bcrypt error handling
"""

import hmac
import os
import logging
import threading
import bcrypt
from datetime import datetime
from typing import Optional, Dict, Any, List
try:
    import streamlit as st  # noqa: F401 — kept for legacy Streamlit callers
except Exception:
    st = None
import psycopg2
from psycopg2 import sql

logger = logging.getLogger(__name__)

# Process-local dedup state for log warnings. Replaces `st.session_state` use
# from Streamlit, which raises "missing ScriptRunContext" warnings when this
# module is invoked from FastAPI workers and never dedups (each request gets a
# fresh context, so the warning would fire on every call).
_TENANT_WARN_LOCK = threading.Lock()
_TENANT_WARN_LOGGED: set = set()


def _warn_once(key: str, message: str) -> None:
    """Log `message` at WARNING level at most once per process for `key`."""
    with _TENANT_WARN_LOCK:
        if key in _TENANT_WARN_LOGGED:
            return
        _TENANT_WARN_LOGGED.add(key)
    logger.warning(message)

# Import de database_config
import database_config
from database_config import validate_schema_name, set_search_path_secure

def safe_print(*args, **kwargs):
    """Print sécurisé"""
    try:
        print(*args, **kwargs)
    except (ValueError, AttributeError, OSError):
        pass


class TenantManager:
    """Gestionnaire des entreprises (tenants) et schémas PostgreSQL"""

    def __init__(self):
        """Initialise le gestionnaire de tenants"""
        pass

    def init_system_tables(self):
        """
        Initialise les tables système dans le schéma public
        - entreprises : Liste des entreprises enregistrées
        - super_admins : Super-administrateurs système
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()

        try:
            # Table des entreprises
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS entreprises (
                    id SERIAL PRIMARY KEY,
                    nom TEXT NOT NULL,
                    schema_name TEXT UNIQUE NOT NULL,
                    slug TEXT UNIQUE NOT NULL,
                    password_hash VARCHAR(255),
                    logo TEXT,
                    email TEXT UNIQUE,
                    phone TEXT,
                    address TEXT,
                    active BOOLEAN DEFAULT TRUE,
                    type_industrie TEXT DEFAULT 'CONSTRUCTION',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Ajouter colonne type_industrie si elle n'existe pas (migration)
            try:
                cursor.execute('''
                    ALTER TABLE entreprises
                    ADD COLUMN IF NOT EXISTS type_industrie TEXT DEFAULT 'CONSTRUCTION'
                ''')
            except psycopg2.Error:
                pass  # Colonne existe déjà

            # Ajouter colonne product_type pour distinguer ERP vs EXPERTS_IA
            try:
                cursor.execute('''
                    ALTER TABLE entreprises
                    ADD COLUMN IF NOT EXISTS product_type TEXT DEFAULT 'ERP'
                ''')
            except psycopg2.Error:
                pass  # Colonne existe déjà

            # Ajouter colonnes Stripe et abonnement pour EXPERTS_IA
            try:
                cursor.execute('''
                    ALTER TABLE entreprises
                    ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
                    ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
                    ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active',
                    ADD COLUMN IF NOT EXISTS plan_type TEXT,
                    ADD COLUMN IF NOT EXISTS trial_end_date TIMESTAMP
                ''')
            except psycopg2.Error:
                pass  # Colonnes existent déjà

            # Migration: S'assurer que la contrainte UNIQUE sur email existe
            # (la table peut avoir été créée avant l'ajout du UNIQUE dans le CREATE TABLE)
            try:
                cursor.execute('''
                    CREATE UNIQUE INDEX IF NOT EXISTS entreprises_email_unique_idx
                    ON entreprises (LOWER(email))
                ''')
            except psycopg2.Error:
                pass  # Contrainte existe déjà

            # Table des super-admins
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS super_admins (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(255) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    full_name VARCHAR(255),
                    email VARCHAR(255),
                    active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMP
                )
            ''')

            # Index
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_entreprises_schema_name ON entreprises(schema_name)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_entreprises_slug ON entreprises(slug)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_super_admins_username ON super_admins(username)')

            # ═══ TABLE API KEYS POUR INTÉGRATIONS EXTERNES ═══
            # Clés API pour QuickBooks, Sage, n8n et autres intégrations
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS api_keys (
                    id SERIAL PRIMARY KEY,
                    entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
                    key_hash VARCHAR(255) NOT NULL,
                    key_prefix VARCHAR(24) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    permissions TEXT DEFAULT '["read"]',
                    rate_limit_per_hour INTEGER DEFAULT 1000,
                    is_active BOOLEAN DEFAULT TRUE,
                    last_used_at TIMESTAMP,
                    expires_at TIMESTAMP,
                    created_by INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    revoked_at TIMESTAMP
                )
            ''')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_api_keys_entreprise ON api_keys(entreprise_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active)')

            # ═══ TABLE WEBHOOKS POUR NOTIFICATIONS SORTANTES ═══
            # Webhooks pour notifier n8n et autres systèmes
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS webhooks (
                    id SERIAL PRIMARY KEY,
                    entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
                    url TEXT NOT NULL,
                    secret VARCHAR(255) NOT NULL,
                    events TEXT NOT NULL,
                    is_active BOOLEAN DEFAULT TRUE,
                    last_triggered_at TIMESTAMP,
                    last_success_at TIMESTAMP,
                    last_error TEXT,
                    failure_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_webhooks_entreprise ON webhooks(entreprise_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(is_active)')

            # ═══ TABLE LOGS API POUR AUDIT ET MONITORING ═══
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS api_request_logs (
                    id SERIAL PRIMARY KEY,
                    api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
                    entreprise_id INTEGER,
                    endpoint TEXT NOT NULL,
                    method VARCHAR(10) NOT NULL,
                    status_code INTEGER,
                    response_time_ms INTEGER,
                    ip_address VARCHAR(50),
                    user_agent TEXT,
                    request_body_size INTEGER,
                    error_message TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_api_logs_key ON api_request_logs(api_key_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_api_logs_entreprise ON api_request_logs(entreprise_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_api_logs_created ON api_request_logs(created_at)')

            # ═══ CHAMPS CRM POUR GESTION PROSPECTS/ABONNÉS ═══
            # Migration: Ajouter les colonnes CRM si elles n'existent pas
            # SÉCURITÉ: Les colonnes password_clear et admin_password_clear ont été supprimées
            # Les mots de passe ne doivent JAMAIS être stockés en clair
            crm_columns = [
                ("statut_abonne", "TEXT DEFAULT 'Prospect'"),
                ("type_abonnement", "TEXT DEFAULT 'Testeur'"),
                ("contact_nom", "TEXT"),
                ("demo_limite", "DATE"),
                ("admin_username", "TEXT"),
                ("deleted_at", "TIMESTAMP DEFAULT NULL"),  # Soft delete
            ]
            for col_name, col_type in crm_columns:
                try:
                    # SECURITE: Utiliser sql.Identifier pour le nom de colonne
                    # col_type est safe car hardcode dans crm_columns ci-dessus
                    query = sql.SQL("ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS {} " + col_type).format(
                        sql.Identifier(col_name)
                    )
                    cursor.execute(query)
                except psycopg2.Error:
                    pass  # Colonne existe deja

            # Migration: Élargir key_prefix pour api_keys (VARCHAR(16) → VARCHAR(24))
            # Le format cai_test_XXXXXXXX fait 17 caractères
            try:
                cursor.execute("ALTER TABLE api_keys ALTER COLUMN key_prefix TYPE VARCHAR(24)")
            except psycopg2.Error:
                pass  # Déjà la bonne taille ou table n'existe pas

            # ═══ TABLE PARAMÈTRES ADMIN ═══
            # Table pour stocker les paramètres globaux (frais infra, etc.)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS admin_settings (
                    key VARCHAR(100) PRIMARY KEY,
                    value TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Migration: S'assurer qu'un index UNIQUE existe sur admin_settings.key
            # CREATE UNIQUE INDEX IF NOT EXISTS est idempotent (pas d'erreur/log si déjà présent)
            cursor.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_settings_key ON admin_settings (key)"
            )

            # Valeurs par défaut pour les paramètres financiers
            cursor.execute('''
                INSERT INTO admin_settings (key, value, updated_at)
                VALUES ('frais_infrastructure_mensuel', '300', NOW())
                ON CONFLICT (key) DO NOTHING
            ''')
            cursor.execute('''
                INSERT INTO admin_settings (key, value, updated_at)
                VALUES ('croissance_clients_mensuel', '5', NOW())
                ON CONFLICT (key) DO NOTHING
            ''')

            conn.commit()

            # Créer ou mettre à jour le super-admin par défaut
            self._ensure_default_super_admin(cursor)
            conn.commit()

            conn.close()
            safe_print("[TENANT] Tables système initialisées")

        except (psycopg2.Error, ValueError) as e:
            logger.error(f"[TENANT] Erreur initialisation tables système: {e}")
            conn.rollback()
            conn.close()
            raise

    def _ensure_default_super_admin(self, cursor):
        """Crée ou met à jour le super-admin par défaut"""
        ph = database_config.get_placeholder()

        # Vérifier si le super-admin par défaut existe
        cursor.execute(f'SELECT id FROM super_admins WHERE username = {ph}', ('admin',))
        existing = cursor.fetchone()

        # SÉCURITÉ: Mot de passe depuis variable d'environnement (obligatoire)
        default_password = os.environ.get('DEFAULT_SUPER_ADMIN_PASSWORD')
        if not default_password:
            # Si le super-admin existe déjà, pas besoin de warning (il a déjà un mot de passe)
            if existing:
                return
            # Ne loguer le warning qu'une seule fois par process pour éviter le spam
            _warn_once(
                'super_admin_password_warning',
                "[TENANT] DEFAULT_SUPER_ADMIN_PASSWORD non défini - super-admin non créé/mis à jour",
            )
            return

        salt = bcrypt.gensalt(rounds=14)  # Augmenté de 12 à 14 rounds
        password_hash = bcrypt.hashpw(default_password.encode('utf-8'), salt).decode('utf-8')

        now = datetime.now().isoformat()

        if existing:
            # Mettre à jour le mot de passe du super-admin existant
            admin_id = existing['id']

            cursor.execute(f'''
                UPDATE super_admins
                SET password_hash = {ph}, active = {ph}
                WHERE id = {ph}
            ''', (password_hash, True, admin_id))

            safe_print("[TENANT] Super-admin par défaut mis à jour: Sylvainleduc")
        else:
            # Créer le super-admin
            cursor.execute(f'''
                INSERT INTO super_admins (username, password_hash, full_name, email, active, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            ''', ('admin', password_hash, 'Sylvain Leduc', 'sylvain@constructoai.ca', True, now))

            safe_print("[TENANT] Super-admin par défaut créé: Sylvainleduc")

    def authenticate_super_admin(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        """
        Authentifie un super-admin

        Returns:
            Dict avec infos super-admin ou None
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            cursor.execute(
                f'SELECT id, username, password_hash, full_name, email, active FROM super_admins WHERE username = {ph}',
                (username,)
            )

            row = cursor.fetchone()

            if not row:
                conn.close()
                return None

            # Extraire données
            user_id = row['id']
            db_username = row['username']
            password_hash = row['password_hash']
            full_name = row['full_name']
            email = row['email']
            active = row['active']

            if not active:
                conn.close()
                return None

            # Vérifier mot de passe
            if not bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8')):
                conn.close()
                return None

            # Mettre à jour last_login
            now = datetime.now().isoformat()
            cursor.execute(
                f'UPDATE super_admins SET last_login = {ph} WHERE id = {ph}',
                (now, user_id)
            )
            conn.commit()
            conn.close()

            return {
                'user_id': user_id,
                'username': db_username,
                'full_name': full_name,
                'email': email,
                'is_super_admin': True
            }

        except (psycopg2.Error, ValueError, KeyError) as e:
            logger.error(f"[TENANT] Erreur authentification super-admin: {e}")
            conn.close()
            return None

    def create_entreprise(self, nom: str, password: str, email: str,
                         telephone: str = "", adresse: str = "",
                         representant_code: str = "",
                         type_industrie: str = "CONSTRUCTION",
                         product_type: str = "ERP",
                         stripe_customer_id: str = None,
                         stripe_subscription_id: str = None,
                         password_already_hashed: bool = False) -> Optional[int]:
        """
        Crée une nouvelle entreprise et son schéma

        Args:
            representant_code: Code ou nom du représentant Constructo AI (pour le suivi des ventes)
            type_industrie: Type d'industrie ('CONSTRUCTION' ou 'FABRICATION')
            product_type: Type de produit ('ERP' ou 'EXPERTS_IA')
            stripe_customer_id: ID client Stripe (optionnel)
            stripe_subscription_id: ID abonnement Stripe (optionnel)
        """
        import uuid

        conn = database_config.get_connection()
        conn.autocommit = False
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            # Générer le code automatiquement depuis le domaine email
            email_domain = email.split('@')[1].split('.')[0] if '@' in email else 'entreprise'
            base_code = email_domain.upper().replace('-', '').replace('_', '')[:10]

            # Ajouter un suffixe unique pour éviter les doublons
            unique_suffix = uuid.uuid4().hex[:6].upper()
            code = f"{base_code}_{unique_suffix}"

            # Générer le slug du schéma
            slug = f"tenant_{code.lower()}"

            # NOTE: Pas de SELECT préalable sur l'email — on s'appuie sur ON CONFLICT
            # pour éviter la race condition (double-clic / requêtes concurrentes).

            # Hash du mot de passe (bcrypt avec 14 rounds pour sécurité renforcée)
            if password_already_hashed:
                password_hash = password  # Déjà hashé par l'appelant (ex: pending_signups)
            else:
                salt = bcrypt.gensalt(rounds=14)
                password_hash = bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

            # Créer l'entrée entreprise
            # SÉCURITÉ: Ne jamais stocker le mot de passe en clair (password_clear supprimé)
            now = datetime.now().isoformat()

            # Migration défensive: colonne representant peut ne pas exister sur les anciennes BD
            try:
                cursor.execute("ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS representant TEXT")
            except Exception:
                pass

            cursor.execute(f'''
                INSERT INTO entreprises (nom, schema_name, slug, password_hash, email, phone, address, active, created_at, representant_code, representant, statut_abonne, type_abonnement, type_industrie, product_type, stripe_customer_id, stripe_subscription_id, subscription_status)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                ON CONFLICT DO NOTHING
                RETURNING id
            ''', (nom, slug, slug, password_hash, email, telephone, adresse, True, now, representant_code, representant_code, 'Prospect', 'Testeur', type_industrie, product_type, stripe_customer_id, stripe_subscription_id, 'active' if stripe_subscription_id else None))

            row = cursor.fetchone()
            if row:
                entreprise_id = row['id'] if isinstance(row, dict) else row[0]

                # SÉCURITÉ: Utiliser sql.Identifier pour échapper le nom du schéma (protection injection SQL)
                # BUG FIX: CREATE SCHEMA dans la même transaction que l'INSERT
                # pour garantir l'atomicité — si CREATE SCHEMA échoue, l'INSERT est rollback aussi.
                if not validate_schema_name(slug):
                    raise ValueError(f"Nom de schéma invalide: {slug}")
                cursor.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(slug)))

                conn.commit()
                conn.close()
            else:
                # Email déjà existant (race condition double-clic) — récupérer l'entreprise existante
                cursor.execute(f'SELECT id, schema_name FROM entreprises WHERE LOWER(email) = LOWER({ph})', (email,))
                existing = cursor.fetchone()
                if existing:
                    entreprise_id = existing['id'] if isinstance(existing, dict) else existing[0]
                    slug = existing['schema_name'] if isinstance(existing, dict) else existing[1]
                    logger.info(f"[TENANT] Entreprise déjà existante pour {email}, ID={entreprise_id}")
                    conn.commit()
                    conn.close()
                    # Compléter les tables si le tenant est incomplet
                    # (cas où la 1ère tentative a créé l'entreprise mais pas toutes les tables)
                    try:
                        self._complete_tenant_tables(slug)
                    except (psycopg2.Error, ValueError) as e_complete:
                        logger.warning(f"[TENANT] Erreur complétion tables existante '{slug}': {e_complete}")
                    return entreprise_id
                else:
                    conn.close()
                    logger.error(f"[TENANT] ON CONFLICT déclenché mais entreprise introuvable pour {email}")
                    return None

        except (psycopg2.Error, ValueError) as e:
            conn.rollback()
            conn.close()

            # Race condition double-clic: l'entreprise existe déjà (duplicate key)
            # Récupérer l'ID existant au lieu de retourner None
            if 'entreprises_email_key' in str(e) or 'entreprises_email_unique_idx' in str(e) or 'duplicate key' in str(e).lower():
                logger.warning(f"[TENANT] Entreprise déjà existante (race condition double-clic) pour {email}")
                try:
                    conn2 = database_config.get_connection()
                    cursor2 = conn2.cursor()
                    cursor2.execute("SET search_path TO public")
                    cursor2.execute(f'SELECT id, schema_name FROM entreprises WHERE LOWER(email) = LOWER({ph})', (email,))
                    existing = cursor2.fetchone()
                    conn2.close()
                    if existing:
                        entreprise_id = existing['id'] if isinstance(existing, dict) else existing[0]
                        slug = existing['schema_name'] if isinstance(existing, dict) else existing[1]
                        logger.info(f"[TENANT] Récupéré entreprise existante ID={entreprise_id}, slug={slug}")
                        # Compléter les tables si le tenant est incomplet
                        try:
                            self._complete_tenant_tables(slug)
                        except (psycopg2.Error, ValueError) as e_comp:
                            logger.warning(f"[TENANT] Erreur complétion tables race-condition '{slug}': {e_comp}")
                    else:
                        logger.error(f"[TENANT] Duplicate key mais entreprise introuvable pour {email}")
                        return None
                except (psycopg2.Error, KeyError) as e2:
                    logger.error(f"[TENANT] Erreur récupération entreprise existante: {e2}")
                    return None
            else:
                logger.error(f"[TENANT] Erreur création entreprise: {e}")
                return None

        # === L'entreprise est commitée en DB à partir d'ici ===
        # Les étapes suivantes ne doivent PAS empêcher le retour de entreprise_id

        # Initialiser les tables de l'entreprise selon le type de produit
        try:
            if product_type == 'EXPERTS_IA':
                # 1. Créer les tables spécifiques EXPERTS IA (soumissions, clients, etc.)
                self._init_experts_ia_tables(slug)
                # 2. Créer aussi les tables ERP complètes (160+ tables)
                #    pour que tous les modules fonctionnent correctement
                try:
                    from erp_database import ERPDatabase
                    try:
                        erp_db = ERPDatabase()
                    except (psycopg2.Error, RuntimeError) as e_init:
                        logger.warning(f"[TENANT] ERPDatabase init public échoué (non-bloquant): {e_init}")
                        erp_db = object.__new__(ERPDatabase)
                    erp_db.init_database_for_tenant(slug)
                    logger.info(f"[TENANT] Tables ERP initialisées pour tenant EXPERTS_IA {slug}")
                except (psycopg2.Error, ImportError, RuntimeError) as e_erp:
                    logger.error(f"[TENANT] Erreur init tables ERP pour EXPERTS_IA '{slug}': {e_erp}")
                # 2b. Appliquer toutes les migrations de schéma (v1→v34)
                try:
                    from erp_database import ERPDatabase
                    try:
                        erp_db_migrate = ERPDatabase()
                    except (psycopg2.Error, RuntimeError) as e_init:
                        erp_db_migrate = object.__new__(ERPDatabase)
                    erp_db_migrate.set_tenant_schema(slug)
                    erp_db_migrate.check_and_upgrade_schema()
                    logger.info(f"[TENANT] Migrations schéma appliquées pour EXPERTS_IA {slug}")
                except (psycopg2.Error, ImportError, RuntimeError) as e_mig:
                    logger.error(f"[TENANT] Erreur migrations schéma EXPERTS_IA '{slug}': {e_mig}")
                # 3. Créer les tables Métré PDF
                try:
                    from METRE_PDF.backend.metre_database import run_migration as metre_run_migration
                    metre_run_migration(slug)
                    logger.info(f"[TENANT] Tables Métré PDF initialisées pour EXPERTS_IA {slug}")
                except (psycopg2.Error, ImportError, RuntimeError) as e:
                    logger.error(f"[TENANT] Erreur init tables Métré PDF EXPERTS_IA '{slug}': {e}")
                # 4. Compléter les tables manquantes depuis un tenant de référence
                try:
                    self._complete_tenant_tables(slug)
                except (psycopg2.Error, ValueError) as e_complete:
                    logger.warning(f"[TENANT] Erreur complétion tables EXPERTS_IA '{slug}': {e_complete}")
                # 4b. Initialiser le plan comptable (34 comptes standard construction Québec)
                try:
                    self._seed_plan_comptable(slug)
                except (psycopg2.Error, ValueError) as e_seed:
                    logger.warning(f"[TENANT] Erreur seed plan comptable EXPERTS_IA '{slug}': {e_seed}")
                # 4c. Fix colonnes manquantes (contourne bug set_tenant_schema)
                try:
                    self._fix_missing_columns(slug)
                except (psycopg2.Error, ValueError) as e_fix:
                    logger.warning(f"[TENANT] Erreur fix colonnes EXPERTS_IA '{slug}': {e_fix}")
                # 5. Installer les vues comptables (vue_balance_generale, etc.)
                conn_views = None
                try:
                    from audit_comptable_triggers import install_comptabilite_triggers
                    conn_views = database_config.get_connection()
                    conn_views.autocommit = False
                    cur_views = conn_views.cursor()
                    set_search_path_secure(cur_views, slug)
                    install_comptabilite_triggers(cur_views)
                    conn_views.commit()
                    logger.info(f"[TENANT] Vues comptables installées pour EXPERTS_IA {slug}")
                except (psycopg2.Error, ImportError, RuntimeError) as e_views:
                    logger.warning(f"[TENANT] Erreur installation vues comptables EXPERTS_IA '{slug}': {e_views}")
                    if conn_views:
                        try:
                            conn_views.rollback()
                        except (psycopg2.Error, OSError):
                            pass
                finally:
                    if conn_views:
                        try:
                            conn_views.close()
                        except (psycopg2.Error, OSError):
                            pass
            else:
                self._init_tenant_tables(slug)
        except (psycopg2.Error, ValueError, ImportError) as init_error:
            logger.critical(f"[TENANT] ÉCHEC CRITIQUE initialisation tables pour '{slug}': {init_error} — le tenant nécessite une réparation manuelle")
            # Marquer l'entreprise comme nécessitant une réparation dans les métadonnées
            try:
                conn_flag = database_config.get_connection()
                cursor_flag = conn_flag.cursor()
                cursor_flag.execute(
                    f"UPDATE entreprises SET subscription_status = 'init_failed' WHERE schema_name = {ph}",
                    (slug,)
                )
                conn_flag.commit()
                conn_flag.close()
            except (psycopg2.Error, Exception) as flag_err:
                logger.critical(f"[TENANT] Impossible de marquer le tenant '{slug}' comme échoué: {flag_err}")
            # Continue - l'entreprise existe, les tables pourront être initialisées plus tard

        # Créer l'utilisateur maître Sylvainleduc dans cette entreprise
        try:
            self._create_master_user(slug)
        except (psycopg2.Error, ValueError) as master_error:
            logger.warning(f"[TENANT] Échec création utilisateur maître pour '{slug}': {master_error} — le tenant fonctionnera sans compte support")

        safe_print(f"[TENANT] Entreprise '{nom}' créée avec schéma '{slug}' (type: {product_type})")

        # Envoyer l'email de bienvenue avec les informations de connexion
        # Note: L'envoi d'email ne doit pas bloquer l'inscription si ça échoue
        try:
            from modules.email_manager.email_sender import send_registration_email_standalone
            email_sent = send_registration_email_standalone(
                email_address=email,
                company_name=nom,
                password=password  # Mot de passe original (avant hachage)
            )
            if email_sent:
                safe_print(f"[TENANT] Email de bienvenue envoyé à '{email}'")
            else:
                logger.warning(f"[TENANT] Échec envoi email de bienvenue à '{email}' - compte créé quand même")
        except (ImportError, ConnectionError, OSError, RuntimeError) as email_error:
            logger.warning(f"[TENANT] Impossible d'envoyer l'email de bienvenue: {email_error}")
            # Ne pas échouer la création du compte si l'email échoue

        return entreprise_id

    def _create_master_user(self, schema: str):
        """
        Crée l'utilisateur maître Sylvainleduc dans le schéma spécifié
        SÉCURITÉ: Le mot de passe est lu depuis la variable d'environnement
        """
        # SÉCURITÉ: Mot de passe depuis variable d'environnement (obligatoire)
        master_password = os.environ.get('DEFAULT_SUPER_ADMIN_PASSWORD')
        if not master_password:
            # Ne loguer le warning qu'une seule fois par process pour éviter le spam
            _warn_once(
                f'master_user_password_warning_{schema}',
                f"[TENANT] DEFAULT_SUPER_ADMIN_PASSWORD non défini - utilisateur maître non créé dans '{schema}'",
            )
            return

        success = self.create_tenant_admin(
            schema=schema,
            username='admin',
            password=master_password,
            full_name='Sylvain Leduc (Support)',
            email='sylvain@constructoai.ca',
            is_primary_admin=False  # C'est le support, pas l'admin principal
        )

        if success:
            safe_print(f"[TENANT] Utilisateur maître 'admin' créé dans '{schema}'")
        else:
            logger.warning(f"[TENANT] Échec création utilisateur maître 'admin' dans '{schema}' — create_tenant_admin a retourné False")

    def _init_tenant_tables(self, schema: str):
        """
        Initialise toutes les tables pour un tenant (schéma)
        Tables adaptées pour Constructo AI (ERP)
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()

        try:
            # SÉCURITÉ: Utiliser set_search_path_secure pour échapper le nom du schéma
            set_search_path_secure(cursor, schema)

            # Table users (spécifique au multi-tenant)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(255) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    full_name VARCHAR(255),
                    email VARCHAR(255),
                    role VARCHAR(50) DEFAULT 'user',
                    is_admin BOOLEAN DEFAULT FALSE,
                    active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMP
                )
            ''')

            # Migration: Ajouter colonne role si elle n'existe pas
            try:
                cursor.execute('''
                    ALTER TABLE users
                    ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user'
                ''')
            except psycopg2.Error as e:
                logger.warning(f"[TENANT] Migration colonne role: {e}")

            # Table entreprise_config (spécifique au tenant)
            # Structure alignée avec entreprise_config_erp.py
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS entreprise_config (
                    id SERIAL PRIMARY KEY,
                    config_data TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Migration: Si l'ancienne structure existe (cle/valeur), migrer in-place
            try:
                cursor.execute(sql.SQL('''
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = {}
                    AND table_name = 'entreprise_config'
                    AND column_name = 'cle'
                ''').format(sql.Literal(schema)))
                old_structure = cursor.fetchone() is not None

                if old_structure:
                    logger.warning(f"[TENANT] Ancienne structure entreprise_config détectée dans {schema}, migration in-place...")
                    cursor.execute('ALTER TABLE entreprise_config ADD COLUMN IF NOT EXISTS config_data TEXT')
                    cursor.execute("UPDATE entreprise_config SET config_data = '{}' WHERE config_data IS NULL")
                    cursor.execute('ALTER TABLE entreprise_config ALTER COLUMN config_data SET NOT NULL')
                    for old_col in ('cle', 'valeur', 'description', 'categorie'):
                        try:
                            cursor.execute(sql.SQL('ALTER TABLE entreprise_config DROP COLUMN IF EXISTS {}').format(
                                sql.Identifier(old_col)))
                        except psycopg2.Error:
                            pass
                    logger.info(f"[TENANT] Migration entreprise_config terminée pour {schema}")
            except psycopg2.Error as e:
                logger.debug(f"[TENANT] Check ancienne structure entreprise_config: {e}")

            # Remettre le search_path par défaut
            cursor.execute('SET search_path TO public')

            conn.commit()

            # Créer les tables ERP complètes dans ce schéma
            try:
                from erp_database import ERPDatabase
                # IMPORTANT: ERPDatabase() appelle init_database() (public schema)
                # Si init_database() échoue, il ne faut PAS bloquer init_database_for_tenant()
                try:
                    erp_db = ERPDatabase()
                except (psycopg2.Error, RuntimeError) as e_init:
                    logger.warning(f"[TENANT] ERPDatabase init public échoué (non-bloquant): {e_init}")
                    erp_db = object.__new__(ERPDatabase)
                erp_db.init_database_for_tenant(schema)
                logger.info(f"[TENANT] Tables ERP initialisées pour {schema}")
            except (psycopg2.Error, ImportError, RuntimeError) as e:
                logger.error(f"[TENANT] Erreur init tables ERP: {e}")
                # On continue même si les tables ERP échouent - les tables de base sont créées

            # Appliquer toutes les migrations de schéma (v1→v34)
            # Crée les 28 tables manquantes + seed data + colonnes additionnelles
            try:
                from erp_database import ERPDatabase
                try:
                    erp_db_migrate = ERPDatabase()
                except (psycopg2.Error, RuntimeError) as e_init:
                    erp_db_migrate = object.__new__(ERPDatabase)
                erp_db_migrate.set_tenant_schema(schema)
                erp_db_migrate.check_and_upgrade_schema()
                logger.info(f"[TENANT] Migrations schéma appliquées pour {schema}")
            except (psycopg2.Error, ImportError, RuntimeError) as e:
                logger.error(f"[TENANT] Erreur migrations schéma pour '{schema}': {e}")

            # Créer les tables Métré PDF dans ce schéma
            try:
                from METRE_PDF.backend.metre_database import run_migration as metre_run_migration
                metre_run_migration(schema)
                logger.info(f"[TENANT] Tables Métré PDF initialisées pour {schema}")
            except (psycopg2.Error, ImportError, RuntimeError) as e:
                logger.error(f"[TENANT] Erreur init tables Métré PDF: {e}")

            # Créer les tables EXPERTS_IA (clients, soumissions, evenements, historique_fournisseurs)
            # Ces tables sont utiles pour tous les tenants (ERP et EXPERTS_IA)
            try:
                self._create_experts_ia_specific_tables(schema)
            except (psycopg2.Error, ValueError) as e_experts:
                logger.warning(f"[TENANT] Erreur création tables EXPERTS_IA pour '{schema}': {e_experts}")

            # Compléter les tables manquantes depuis un tenant de référence
            try:
                self._complete_tenant_tables(schema)
            except (psycopg2.Error, ValueError) as e_complete:
                logger.warning(f"[TENANT] Erreur complétion tables pour '{schema}': {e_complete}")

            # Initialiser le plan comptable (34 comptes standard construction Québec)
            try:
                self._seed_plan_comptable(schema)
            except (psycopg2.Error, ValueError) as e_seed:
                logger.warning(f"[TENANT] Erreur seed plan comptable pour '{schema}': {e_seed}")

            # Fix colonnes manquantes (contourne bug set_tenant_schema/check_and_upgrade_schema)
            try:
                self._fix_missing_columns(schema)
            except (psycopg2.Error, ValueError) as e_fix:
                logger.warning(f"[TENANT] Erreur fix colonnes pour '{schema}': {e_fix}")

            # Installer les vues comptables (vue_balance_generale, vue_controle_balance, etc.)
            conn_views = None
            try:
                from audit_comptable_triggers import install_comptabilite_triggers
                conn_views = database_config.get_connection()
                conn_views.autocommit = False
                cur_views = conn_views.cursor()
                set_search_path_secure(cur_views, schema)
                install_comptabilite_triggers(cur_views)
                conn_views.commit()
                logger.info(f"[TENANT] Vues comptables installées pour {schema}")
            except (psycopg2.Error, ImportError, RuntimeError) as e_views:
                logger.warning(f"[TENANT] Erreur installation vues comptables pour '{schema}': {e_views}")
                if conn_views:
                    try:
                        conn_views.rollback()
                    except (psycopg2.Error, OSError):
                        pass
            finally:
                if conn_views:
                    try:
                        conn_views.close()
                    except (psycopg2.Error, OSError):
                        pass

            conn.close()
            safe_print(f"[TENANT] Tables initialisées pour schéma '{schema}'")

        except (psycopg2.Error, ValueError) as e:
            logger.error(f"[TENANT] Erreur initialisation tables tenant: {e}")
            conn.rollback()
            conn.close()
            raise

    def _complete_tenant_tables(self, schema: str):
        """
        Complète les tables et views manquantes d'un tenant en copiant les structures
        depuis le tenant le plus complet, tous types confondus (ERP ou EXPERTS_IA).

        Utilise CREATE TABLE (LIKE ref INCLUDING ALL) pour copier fidèlement
        la structure complète : colonnes, defaults, contraintes et indexes.

        Cela garantit que les tables de modules secondaires (seaop, ref, fp, immo, etc.)
        sont présentes même si leurs modules spécifiques n'ont pas été initialisés.
        """
        conn = database_config.get_connection()
        conn.autocommit = False
        cursor = conn.cursor()

        try:
            # SÉCURITÉ: Valider le nom du schéma
            if not validate_schema_name(schema):
                raise ValueError(f"Nom de schéma invalide: {schema}")

            # Trouver le tenant avec le plus de tables (référence dynamique, tous types)
            cursor.execute('''
                SELECT e.schema_name, COUNT(t.table_name) as nb_tables
                FROM public.entreprises e
                JOIN information_schema.tables t
                    ON t.table_schema = e.schema_name AND t.table_type = 'BASE TABLE'
                WHERE e.active = TRUE
                    AND e.schema_name != %s
                    AND e.deleted_at IS NULL
                GROUP BY e.schema_name
                ORDER BY nb_tables DESC
                LIMIT 1
            ''', (schema,))
            ref_row = cursor.fetchone()
            if not ref_row:
                logger.warning(f"[TENANT] Aucun tenant de référence trouvé — le tenant '{schema}' pourrait être incomplet (tables de modules secondaires manquantes)")
                conn.close()
                return

            ref_schema = ref_row[0] if not isinstance(ref_row, dict) else ref_row['schema_name']

            # --- Compléter les tables manquantes ---
            cursor.execute(
                'SELECT table_name FROM information_schema.tables WHERE table_schema = %s AND table_type = %s',
                (ref_schema, 'BASE TABLE')
            )
            ref_tables = set(r[0] if not isinstance(r, dict) else r['table_name'] for r in cursor.fetchall())

            cursor.execute(
                'SELECT table_name FROM information_schema.tables WHERE table_schema = %s AND table_type = %s',
                (schema, 'BASE TABLE')
            )
            existing_tables = set(r[0] if not isinstance(r, dict) else r['table_name'] for r in cursor.fetchall())

            missing_tables = ref_tables - existing_tables
            tables_created = 0

            for table_name in sorted(missing_tables):
                try:
                    cursor.execute("SAVEPOINT sp_tbl")
                    # SÉCURITÉ: sql.Identifier pour échapper schema et table_name
                    create_query = sql.SQL(
                        'CREATE TABLE {}.{} (LIKE {}.{} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)'
                    ).format(
                        sql.Identifier(schema), sql.Identifier(table_name),
                        sql.Identifier(ref_schema), sql.Identifier(table_name)
                    )
                    cursor.execute(create_query)
                    cursor.execute("RELEASE SAVEPOINT sp_tbl")
                    tables_created += 1
                except psycopg2.Error as e_table:
                    cursor.execute("ROLLBACK TO SAVEPOINT sp_tbl")
                    logger.warning(f"[TENANT] Erreur création table {table_name} dans '{schema}': {e_table}")

            # --- Fix colonnes copiées depuis une référence non migrée ---
            # CREATE TABLE LIKE copie les types de la référence. Si la référence
            # a pin_code VARCHAR(4), le nouveau tenant hériterait du mauvais type.
            try:
                set_search_path_secure(cursor, schema)
                cursor.execute("ALTER TABLE employees ALTER COLUMN pin_code TYPE VARCHAR(72)")
            except Exception:
                pass  # Table employees peut ne pas exister dans ce schema

            # --- Compléter les views manquantes ---
            cursor.execute(
                'SELECT table_name FROM information_schema.views WHERE table_schema = %s',
                (ref_schema,)
            )
            ref_views = set(r[0] if not isinstance(r, dict) else r['table_name'] for r in cursor.fetchall())

            cursor.execute(
                'SELECT table_name FROM information_schema.views WHERE table_schema = %s',
                (schema,)
            )
            existing_views = set(r[0] if not isinstance(r, dict) else r['table_name'] for r in cursor.fetchall())

            missing_views = ref_views - existing_views
            views_created = 0

            for view_name in sorted(missing_views):
                try:
                    cursor.execute("SAVEPOINT sp_vw")
                    cursor.execute(
                        'SELECT definition FROM pg_views WHERE schemaname = %s AND viewname = %s',
                        (ref_schema, view_name)
                    )
                    vw_row = cursor.fetchone()
                    if vw_row:
                        view_def = vw_row[0] if not isinstance(vw_row, dict) else vw_row['definition']
                        # Définir le search_path pour que les références non-qualifiées
                        # dans la view pointent vers le bon schéma
                        set_search_path_secure(cursor, schema)
                        create_vw = sql.SQL('CREATE OR REPLACE VIEW {}.{} AS ').format(
                            sql.Identifier(schema), sql.Identifier(view_name)
                        )
                        cursor.execute(create_vw.as_string(cursor) + view_def)
                        cursor.execute('SET search_path TO public')
                        views_created += 1
                    cursor.execute("RELEASE SAVEPOINT sp_vw")
                except psycopg2.Error as e_view:
                    cursor.execute("ROLLBACK TO SAVEPOINT sp_vw")
                    logger.warning(f"[TENANT] Erreur création view {view_name} dans '{schema}': {e_view}")

            conn.commit()

            total_missing = len(missing_tables) + len(missing_views)
            total_created = tables_created + views_created
            if total_created > 0:
                safe_print(f"[TENANT] {tables_created}/{len(missing_tables)} tables + {views_created}/{len(missing_views)} views créées pour '{schema}' (ref: {ref_schema})")
            else:
                logger.info(f"[TENANT] Aucune table/view manquante pour '{schema}'")

            conn.close()

        except (psycopg2.Error, ValueError) as e:
            logger.error(f"[TENANT] Erreur complétion tables: {e}")
            try:
                conn.rollback()
                conn.close()
            except (psycopg2.Error, OSError):
                pass

    def _fix_missing_columns(self, schema: str):
        """
        Ajoute les colonnes manquantes sur les tables existantes.
        Contourne le bug set_tenant_schema où check_and_upgrade_schema()
        perd le search_path et execute les ALTER TABLE contre public.
        Appelé automatiquement lors de la création d'un nouveau tenant.
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()
        try:
            set_search_path_secure(cursor, schema)

            # Colonnes connues comme manquantes sur les nouveaux tenants
            # (normalement ajoutées par check_and_upgrade_schema mais migration échoue)
            fixes = [
                'ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS project_id INTEGER',
                'ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS company_id INTEGER',
                'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS metadata TEXT',
            ]
            for fix_sql in fixes:
                try:
                    cursor.execute(fix_sql)
                except psycopg2.Error:
                    pass  # Table ou colonne n'existe pas encore

            # FK et indexes (silencieux si déjà existants)
            extras = [
                'CREATE INDEX IF NOT EXISTS idx_dossiers_project ON dossiers(project_id)',
                'CREATE INDEX IF NOT EXISTS idx_dossiers_company ON dossiers(company_id)',
            ]
            for extra_sql in extras:
                try:
                    cursor.execute(extra_sql)
                except psycopg2.Error:
                    pass

            cursor.execute('SET search_path TO public')
            conn.commit()
            conn.close()
            logger.info(f"[TENANT] Colonnes manquantes vérifiées pour '{schema}'")

        except (psycopg2.Error, ValueError) as e:
            logger.warning(f"[TENANT] Erreur fix colonnes pour '{schema}': {e}")
            try:
                conn.rollback()
                conn.close()
            except (psycopg2.Error, OSError):
                pass

    def _seed_plan_comptable(self, schema: str):
        """
        Insère les 34 comptes standard du plan comptable québécois construction
        si la table plan_comptable est vide.
        Appelé automatiquement lors de la création d'un nouveau tenant.
        """
        conn = database_config.get_connection()
        conn.autocommit = False
        cursor = conn.cursor()
        try:
            set_search_path_secure(cursor, schema)

            # Vérifier si la table existe et est vide
            try:
                cursor.execute("SELECT COUNT(*) as cnt FROM plan_comptable")
                row = cursor.fetchone()
                count = row['cnt'] if isinstance(row, dict) else row[0]
                if count > 0:
                    logger.info(f"[TENANT] Plan comptable déjà peuplé ({count} comptes) pour '{schema}'")
                    cursor.execute('SET search_path TO public')
                    conn.close()
                    return
            except psycopg2.Error:
                # Table n'existe pas encore — on skip silencieusement
                logger.debug(f"[TENANT] Table plan_comptable absente pour '{schema}', seed ignoré")
                conn.rollback()
                conn.close()
                return

            # 34 comptes standard construction Québec (identiques au tenant de référence)
            # Colonnes: code, nom, type, classe, solde_normal
            # Les autres colonnes utilisent les defaults: niveau=1, est_detail=true, actif=true
            comptes = [
                ('1010', 'Encaisse generale', 'ACTIF', 1, 'DEBIT'),
                ('1100', 'Comptes clients', 'ACTIF', 1, 'DEBIT'),
                ('1200', 'TPS a recevoir', 'ACTIF', 1, 'DEBIT'),
                ('1210', 'TVQ a recevoir', 'ACTIF', 1, 'DEBIT'),
                ('1300', 'Stocks et materiaux', 'ACTIF', 1, 'DEBIT'),
                ('1500', 'Equipements', 'ACTIF', 1, 'DEBIT'),
                ('1510', 'Amortissement cumule - Equipements', 'ACTIF', 1, 'CREDIT'),
                ('1600', 'Vehicules', 'ACTIF', 1, 'DEBIT'),
                ('2100', 'Comptes fournisseurs', 'PASSIF', 2, 'CREDIT'),
                ('2200', 'TPS a payer', 'PASSIF', 2, 'CREDIT'),
                ('2210', 'TVQ a payer', 'PASSIF', 2, 'CREDIT'),
                ('2300', 'Salaires a payer', 'PASSIF', 2, 'CREDIT'),
                ('2310', 'Retenues a la source a payer', 'PASSIF', 2, 'CREDIT'),
                ('2320', 'CNESST a payer', 'PASSIF', 2, 'CREDIT'),
                ('2400', 'Emprunt bancaire', 'PASSIF', 2, 'CREDIT'),
                ('3100', 'Capital', 'CAPITAUX', 3, 'CREDIT'),
                ('3200', 'Benefices non repartis', 'CAPITAUX', 3, 'CREDIT'),
                ('4100', 'Revenus de construction', 'REVENU', 4, 'CREDIT'),
                ('4200', 'Revenus de services', 'REVENU', 4, 'CREDIT'),
                ('4900', 'Autres revenus', 'REVENU', 4, 'CREDIT'),
                ('5100', 'Cout des materiaux', 'CHARGE', 5, 'DEBIT'),
                ('5200', "Cout de la main-d oeuvre", 'CHARGE', 5, 'DEBIT'),
                ('5300', 'Cout de sous-traitance', 'CHARGE', 5, 'DEBIT'),
                ('5400', 'Location equipements', 'CHARGE', 5, 'DEBIT'),
                ('5500', 'Frais de chantier', 'CHARGE', 5, 'DEBIT'),
                ('6100', 'Salaires administration', 'CHARGE', 6, 'DEBIT'),
                ('6200', 'Loyer', 'CHARGE', 6, 'DEBIT'),
                ('6300', 'Assurances', 'CHARGE', 6, 'DEBIT'),
                ('6400', 'Frais de bureau', 'CHARGE', 6, 'DEBIT'),
                ('6500', 'Telecommunications', 'CHARGE', 6, 'DEBIT'),
                ('6600', 'Frais de vehicules', 'CHARGE', 6, 'DEBIT'),
                ('6700', 'Honoraires professionnels', 'CHARGE', 6, 'DEBIT'),
                ('6800', 'Amortissement', 'CHARGE', 6, 'DEBIT'),
                ('6900', 'Frais financiers', 'CHARGE', 6, 'DEBIT'),
            ]

            ph = database_config.get_placeholder()
            for code, nom, type_compte, classe, solde_normal in comptes:
                cursor.execute(
                    f'''INSERT INTO plan_comptable (code, nom, type, classe, solde_normal)
                        VALUES ({ph}, {ph}, {ph}, {ph}, {ph})
                        ON CONFLICT (code) DO NOTHING''',
                    (code, nom, type_compte, classe, solde_normal)
                )

            cursor.execute('SET search_path TO public')
            conn.commit()
            conn.close()
            safe_print(f"[TENANT] Plan comptable initialisé (34 comptes) pour '{schema}'")

        except (psycopg2.Error, ValueError) as e:
            logger.warning(f"[TENANT] Erreur seed plan comptable pour '{schema}': {e}")
            try:
                conn.rollback()
                conn.close()
            except (psycopg2.Error, OSError):
                pass

    def _create_experts_ia_specific_tables(self, schema: str):
        """
        Crée les 4 tables spécifiques EXPERTS_IA dans un tenant ERP.
        Ces tables (clients, soumissions, evenements, historique_fournisseurs) sont utiles
        pour tous les tenants car _complete_tenant_tables() les copie depuis la référence.
        Les créer explicitement évite la dépendance circulaire sur le tenant de référence.
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()
        try:
            set_search_path_secure(cursor, schema)

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS soumissions (
                    id SERIAL PRIMARY KEY,
                    numero_soumission TEXT UNIQUE,
                    client_id INTEGER,
                    client_nom TEXT,
                    projet_description TEXT,
                    projet_type TEXT,
                    projet_superficie REAL,
                    conversation_id INTEGER,
                    expert_profile TEXT,
                    type TEXT DEFAULT 'IA',
                    total_travaux REAL,
                    administration REAL,
                    contingences REAL,
                    profit REAL,
                    total_avant_taxes REAL,
                    tps REAL,
                    tvq REAL,
                    investissement_total REAL,
                    data_json TEXT,
                    html_content TEXT,
                    signature_client TEXT,
                    signature_date TIMESTAMP,
                    token_public TEXT UNIQUE,
                    statut TEXT DEFAULT 'Brouillon',
                    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    date_modification TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    date_expiration TIMESTAMP,
                    tokens_utilises INTEGER,
                    tokens_limite INTEGER
                )
            ''')

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS clients (
                    id SERIAL PRIMARY KEY,
                    nom TEXT NOT NULL,
                    email TEXT,
                    telephone TEXT,
                    entreprise TEXT,
                    adresse_rue TEXT,
                    adresse_ville TEXT,
                    adresse_province TEXT DEFAULT 'QC',
                    adresse_code_postal TEXT,
                    type_client TEXT DEFAULT 'Particulier',
                    statut TEXT DEFAULT 'ACTIF',
                    notes TEXT,
                    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    date_modification TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    nombre_soumissions INTEGER DEFAULT 0,
                    dernier_contact TIMESTAMP
                )
            ''')

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS historique_fournisseurs (
                    id SERIAL PRIMARY KEY,
                    entite_type TEXT NOT NULL,
                    entite_id INTEGER,
                    action TEXT NOT NULL,
                    utilisateur_id INTEGER,
                    details TEXT,
                    date_action TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS evenements (
                    id SERIAL PRIMARY KEY,
                    titre TEXT NOT NULL,
                    description TEXT,
                    date_debut TIMESTAMP,
                    date_fin TIMESTAMP,
                    type_event TEXT,
                    source_id INTEGER,
                    source_type TEXT,
                    rappel_j INTEGER DEFAULT 0,
                    statut TEXT DEFAULT 'Planifie',
                    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            cursor.execute('SET search_path TO public')
            conn.commit()
            conn.close()
            logger.info(f"[TENANT] Tables EXPERTS_IA spécifiques créées pour {schema}")
        except (psycopg2.Error, ValueError) as e:
            logger.warning(f"[TENANT] Erreur création tables EXPERTS_IA spécifiques pour '{schema}': {e}")
            try:
                conn.rollback()
                conn.close()
            except (psycopg2.Error, OSError):
                pass

    def _init_experts_ia_tables(self, schema: str):
        """
        Initialise les tables pour un tenant EXPERTS IA
        Tables adaptées pour la plateforme EXPERTS IA (soumissions, conversations, etc.)
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()

        try:
            # SÉCURITÉ: Utiliser set_search_path_secure pour échapper le nom du schéma
            set_search_path_secure(cursor, schema)

            # Table users (spécifique au multi-tenant)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(255) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    full_name VARCHAR(255),
                    email VARCHAR(255),
                    role VARCHAR(50) DEFAULT 'user',
                    is_admin BOOLEAN DEFAULT FALSE,
                    active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMP
                )
            ''')

            # Table soumissions
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS soumissions (
                    id SERIAL PRIMARY KEY,
                    numero_soumission TEXT UNIQUE,
                    client_id INTEGER,
                    client_nom TEXT,
                    projet_description TEXT,
                    projet_type TEXT,
                    projet_superficie REAL,
                    conversation_id INTEGER,
                    expert_profile TEXT,
                    type TEXT DEFAULT 'IA',
                    total_travaux REAL,
                    administration REAL,
                    contingences REAL,
                    profit REAL,
                    total_avant_taxes REAL,
                    tps REAL,
                    tvq REAL,
                    investissement_total REAL,
                    data_json TEXT,
                    html_content TEXT,
                    signature_client TEXT,
                    signature_date TIMESTAMP,
                    token_public TEXT UNIQUE,
                    statut TEXT DEFAULT 'Brouillon',
                    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    date_modification TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    date_expiration TIMESTAMP,
                    tokens_utilises INTEGER,
                    tokens_limite INTEGER
                )
            ''')

            # Table clients
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS clients (
                    id SERIAL PRIMARY KEY,
                    nom TEXT NOT NULL,
                    email TEXT,
                    telephone TEXT,
                    entreprise TEXT,
                    adresse_rue TEXT,
                    adresse_ville TEXT,
                    adresse_province TEXT DEFAULT 'QC',
                    adresse_code_postal TEXT,
                    type_client TEXT DEFAULT 'Particulier',
                    statut TEXT DEFAULT 'ACTIF',
                    notes TEXT,
                    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    date_modification TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    nombre_soumissions INTEGER DEFAULT 0,
                    dernier_contact TIMESTAMP
                )
            ''')

            # Table fournisseurs — NE PAS créer ici.
            # erp_database.py.init_database_for_tenant() crée la table avec le
            # schéma ERP complet (company_id, categorie_produits, etc.).
            # L'ancienne définition simplifiée causait un conflit de schéma:
            # CREATE TABLE IF NOT EXISTS était un no-op et les colonnes ERP
            # manquaient (company_id, categorie_produits, etc.) → crash index/requêtes.

            # Table historique_fournisseurs
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS historique_fournisseurs (
                    id SERIAL PRIMARY KEY,
                    entite_type TEXT NOT NULL,
                    entite_id INTEGER,
                    action TEXT NOT NULL,
                    utilisateur_id INTEGER,
                    details TEXT,
                    date_action TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Table conversations
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS conversations (
                    id SERIAL PRIMARY KEY,
                    name TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    messages TEXT
                )
            ''')

            # Table entreprise_config (même structure que entreprise_config_erp.py)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS entreprise_config (
                    id SERIAL PRIMARY KEY,
                    config_data TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Table calendrier/événements
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS evenements (
                    id SERIAL PRIMARY KEY,
                    titre TEXT NOT NULL,
                    description TEXT,
                    date_debut TIMESTAMP,
                    date_fin TIMESTAMP,
                    type_event TEXT,
                    source_id INTEGER,
                    source_type TEXT,
                    rappel_j INTEGER DEFAULT 0,
                    statut TEXT DEFAULT 'Planifie',
                    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Table bons_commande
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS bons_commande (
                    id SERIAL PRIMARY KEY,
                    numero TEXT UNIQUE,
                    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    fournisseur_nom TEXT,
                    fournisseur_telephone TEXT,
                    client_nom TEXT,
                    projet_nom TEXT,
                    description TEXT,
                    items_json TEXT,
                    sous_total REAL,
                    tps REAL,
                    tvq REAL,
                    total REAL,
                    statut TEXT DEFAULT 'ACTIF',
                    date_livraison_prevue TIMESTAMP,
                    token_public TEXT UNIQUE,
                    date_modification TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Table notifications
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS notifications (
                    id SERIAL PRIMARY KEY,
                    utilisateur_id INTEGER,
                    titre TEXT NOT NULL,
                    message TEXT,
                    type TEXT DEFAULT 'info',
                    lu BOOLEAN DEFAULT FALSE,
                    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Remettre le search_path par défaut
            cursor.execute('SET search_path TO public')

            conn.commit()
            conn.close()
            safe_print(f"[TENANT] Tables EXPERTS IA initialisées pour schéma '{schema}'")

        except (psycopg2.Error, ValueError) as e:
            logger.error(f"[TENANT] Erreur initialisation tables EXPERTS IA: {e}")
            conn.rollback()
            conn.close()
            raise

    def get_entreprise_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Récupère une entreprise par son email"""
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            cursor.execute(
                f'SELECT id, nom, schema_name, slug, email, phone, address, active FROM entreprises WHERE LOWER(email) = LOWER({ph})',
                (email.strip(),)
            )

            row = cursor.fetchone()

            if not row:
                conn.close()
                return None

            entreprise = dict(row)

            conn.close()
            return entreprise

        except (psycopg2.Error, KeyError) as e:
            logger.error(f"[TENANT] Erreur récupération entreprise par email: {e}")
            conn.close()
            return None

    def verify_entreprise_password(self, email: str, password: str) -> Optional[Dict[str, Any]]:
        """
        Vérifie le mot de passe d'une entreprise
        Protection anti-brute force (5 tentatives max, blocage 15 min)
        """
        # NETTOYAGE EMAIL: Supprimer préfixes http/https et slashes (bug navigateur auto-complete)
        original_email = email
        email = email.strip()
        if email.startswith('https://'):
            email = email[8:]
        elif email.startswith('http://'):
            email = email[7:]
        email = email.rstrip('/')

        if original_email != email:
            logger.warning(f"[TENANT] Email nettoyé: '{original_email}' -> '{email}'")

        # PROTECTION ANTI-BRUTE FORCE: DÉSACTIVÉE TEMPORAIREMENT
        # is_blocked, remaining_seconds = self.check_login_blocked('entreprise', email, None)
        # if is_blocked:
        #     minutes = remaining_seconds // 60
        #     seconds = remaining_seconds % 60
        #     logger.warning(f"🔒 Entreprise bloquée: {email} (encore {minutes}m {seconds}s)")
        #     return None

        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            # IMPORTANT: Forcer search_path = public pour éviter problèmes de cache du pool
            cursor.execute("SET search_path TO public")

            cursor.execute(
                f'SELECT id, nom, schema_name, slug, password_hash, email, phone, address, active FROM public.entreprises WHERE LOWER(email) = LOWER({ph})',
                (email.strip(),)
            )

            row = cursor.fetchone()

            if not row:
                conn.close()
                # PROTECTION ANTI-BRUTE FORCE: DÉSACTIVÉE
                # self.record_failed_attempt('entreprise', email, None)
                return None

            password_hash = row['password_hash']
            active = row['active']  # Correction: utiliser 'active' au lieu de 'actif'
            entreprise = dict(row)

            conn.close()

            # DEBUG: Logs sécurisés (sans exposer secrets)
            logger.debug(f"[LOGIN] Tentative connexion: {email}")
            logger.debug(f"[LOGIN] Entreprise: {entreprise.get('nom', 'N/A')}, Active: {active}")
            logger.debug(f"[LOGIN] Credentials présents: hash={bool(password_hash)}, pwd={bool(password)}")

            if not active:
                logger.warning(f"[TENANT-DEBUG] REJET: Compte non actif")
                return None

            if not password_hash:
                logger.warning(f"[TENANT-DEBUG] REJET: Pas de hash")
                return None

            # Vérification bcrypt avec gestion d'erreur
            try:
                is_valid = bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))
                logger.debug(f"[LOGIN] Vérification bcrypt: {'succès' if is_valid else 'échec'}")
            except (ValueError, TypeError) as bcrypt_error:
                logger.error(f"[TENANT] Erreur bcrypt pour {email}: {bcrypt_error}")
                return None

            if not is_valid:
                logger.debug(f"[LOGIN] REJET: Mot de passe incorrect pour {email}")
                return None

            # PROTECTION ANTI-BRUTE FORCE: DÉSACTIVÉE

            del entreprise['password_hash']
            return entreprise

        except (psycopg2.Error, KeyError, ValueError) as e:
            logger.error(f"[TENANT] Erreur vérification mot de passe entreprise: {e}")
            conn.close()
            return None

    def get_tenant_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """
        Récupère un tenant (entreprise) par son email
        Utilisé pour l'authentification B2B client (étape 1)
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            # IMPORTANT: Forcer search_path = public
            cursor.execute("SET search_path TO public")

            cursor.execute(
                f'SELECT id, nom, schema_name, slug, email, phone, address, active FROM public.entreprises WHERE LOWER(email) = LOWER({ph}) AND active = TRUE',
                (email.strip(),)
            )

            row = cursor.fetchone()
            conn.close()

            if not row:
                return None

            return dict(row)

        except (psycopg2.Error, KeyError) as e:
            logger.error(f"[TENANT] Erreur récupération tenant par email: {e}")
            conn.close()
            return None

    def authenticate_b2b_client(self, tenant_id: int, email: str, password: str) -> Optional[Dict[str, Any]]:
        """
        Authentifie un client B2B dans le schéma du tenant
        Le client B2B est stocké dans la table 'companies' avec type_b2b = 'client_b2b'
        """
        # Normaliser le mot de passe (strip whitespace)
        password = password.strip() if password else ''

        # Récupérer le schéma du tenant
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            # Récupérer le schema_name du tenant
            cursor.execute(
                f'SELECT schema_name FROM entreprises WHERE id = {ph}',
                (tenant_id,)
            )
            row = cursor.fetchone()

            if not row:
                conn.close()
                return None

            schema_name = row['schema_name']

            # SÉCURITÉ: Valider le nom du schéma avant utilisation
            if not validate_schema_name(schema_name):
                logger.error(f"[TENANT] Schéma invalide pour B2B auth: {schema_name}")
                conn.close()
                return None

            # Chercher le client B2B dans la table companies du schéma tenant
            # Note: La table utilise 'nom' et 'mot_de_passe_hash' au lieu de 'name' et 'password_hash'
            # SÉCURITÉ: Utiliser sql.Identifier pour le nom du schéma
            query = sql.SQL('''SELECT c.id, c.nom as name, c.email, c.mot_de_passe_hash, c.active
                    FROM {}.companies c
                    WHERE LOWER(c.email) = LOWER(%s)
                    AND c.type_b2b = 'client_b2b' ''').format(sql.Identifier(schema_name))
            cursor.execute(query, (email.strip(),))

            client_row = cursor.fetchone()
            conn.close()

            if not client_row:
                logger.warning(f"[B2B-AUTH] Client non trouvé pour tenant={tenant_id}")
                return None

            # Vérifier si le compte est actif
            if not client_row.get('active', False):
                logger.warning(f"[B2B-AUTH] Compte inactif (tenant={tenant_id})")
                return None

            password_hash = client_row['mot_de_passe_hash']

            if not password_hash:
                logger.warning(f"[B2B-AUTH] Pas de hash pour client (tenant={tenant_id})")
                return None

            # Vérifier le mot de passe (supporte bcrypt et SHA256 legacy)
            password_valid = False

            # Essayer bcrypt d'abord
            try:
                if bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8')):
                    password_valid = True
            except (ValueError, TypeError) as bcrypt_err:
                logger.warning(f"[B2B-AUTH] bcrypt invalide (tenant={tenant_id}): {bcrypt_err.__class__.__name__}")

            # Essayer SHA256 legacy si bcrypt échoue
            if not password_valid:
                import hashlib
                sha256_hash = hashlib.sha256(password.encode()).hexdigest()
                if hmac.compare_digest(sha256_hash, password_hash):
                    password_valid = True
                    logger.info(f"[B2B-AUTH] SHA256 legacy match — migration bcrypt recommandée")

            if not password_valid:
                logger.warning(f"[B2B-AUTH] Mot de passe invalide (tenant={tenant_id})")
                return None

            # Retourner les données du client sans le hash
            client = dict(client_row)
            if 'mot_de_passe_hash' in client:
                del client['mot_de_passe_hash']
            return client

        except (psycopg2.Error, KeyError, ValueError) as e:
            logger.error(f"[TENANT] Erreur authentification client B2B: {e}")
            try:
                conn.close()
            except (psycopg2.Error, OSError):
                pass
            return None

    def create_b2b_client_request(self, tenant_id: int, company_name: str, contact_name: str,
                                   email: str, phone: str = None, password: str = None,
                                   message: str = None, source_acquisition: str = None,
                                   representant_code: str = None):
        """
        Crée une demande d'inscription client B2B
        Le client est créé avec active=FALSE jusqu'à validation par le tenant

        Args:
            source_acquisition: Comment le client a connu Constructo AI
            representant_code: Nom ou code du représentant si référé

        Returns:
            tuple: (success: bool, error_message: str or None)
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()
        schema_name = None

        try:
            # IMPORTANT: Forcer search_path = public pour accéder à la table entreprises
            cursor.execute("SET search_path TO public")

            # Récupérer le schema_name du tenant
            cursor.execute(
                f'SELECT schema_name FROM public.entreprises WHERE id = {ph}',
                (tenant_id,)
            )
            row = cursor.fetchone()

            if not row:
                conn.close()
                logger.warning(f"[B2B] Tenant ID={tenant_id} introuvable dans public.entreprises")
                return (False, "Entreprise partenaire introuvable. Vérifiez l'email du partenaire.")

            # row peut être un tuple ou un dict selon le cursor utilisé
            schema_name = row['schema_name'] if isinstance(row, dict) else row[0]

            # SÉCURITÉ: Valider le nom du schéma avant utilisation
            if not validate_schema_name(schema_name):
                logger.error(f"[TENANT] Schéma invalide pour B2B request: {schema_name}")
                conn.close()
                return (False, "Erreur de configuration du partenaire. Contactez le support.")

            # S'assurer que les colonnes B2B existent dans le schéma tenant
            try:
                ensure_query = sql.SQL("ALTER TABLE {}.companies ADD COLUMN IF NOT EXISTS mot_de_passe_hash TEXT").format(sql.Identifier(schema_name))
                cursor.execute(ensure_query)
                ensure_query = sql.SQL("ALTER TABLE {}.companies ADD COLUMN IF NOT EXISTS type_b2b TEXT DEFAULT 'prospect'").format(sql.Identifier(schema_name))
                cursor.execute(ensure_query)
            except psycopg2.Error as col_err:
                logger.warning(f"[B2B] Vérification colonnes B2B (non-bloquant): {col_err}")

            # Hasher le mot de passe avec bcrypt
            password = password.strip() if password else ''
            salt = bcrypt.gensalt()
            password_hash = bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

            # Vérifier si le client existe déjà
            # SÉCURITÉ: Utiliser sql.Identifier pour le nom du schéma
            check_query = sql.SQL('''SELECT id FROM {}.companies
                    WHERE LOWER(email) = LOWER(%s)''').format(sql.Identifier(schema_name))
            cursor.execute(check_query, (email.strip(),))
            existing = cursor.fetchone()

            if existing:
                conn.close()
                logger.warning(f"[B2B] Client déjà existant: {email} dans schéma {schema_name}")
                return (False, "Un compte avec cet email existe déjà. Utilisez 'Se connecter' pour accéder à votre compte.")

            # Construire les notes avec les informations de source
            notes_parts = []
            if contact_name and contact_name != company_name:
                notes_parts.insert(0, f"Contact: {contact_name}")
            if message:
                notes_parts.append(f"Message: {message}")
            if source_acquisition:
                notes_parts.append(f"Source: {source_acquisition}")
            if representant_code:
                notes_parts.append(f"Représentant: {representant_code}")
            notes_text = " | ".join(notes_parts) if notes_parts else None

            # SÉCURITÉ: Utiliser sql.Identifier pour le nom du schéma
            insert_query = sql.SQL('''INSERT INTO {}.companies
                    (nom, email, telephone, mot_de_passe_hash, type_b2b, active, notes)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)''').format(sql.Identifier(schema_name))
            cursor.execute(insert_query,
                (company_name, email, phone, password_hash, 'client_b2b', False, notes_text)
            )

            conn.commit()
            conn.close()

            logger.info(f"[B2B] Demande d'inscription créée: {email} pour tenant {tenant_id} (schéma {schema_name})")
            return (True, None)

        except (psycopg2.Error, KeyError, ValueError) as e:
            import traceback
            logger.error(f"[TENANT] Erreur création demande B2B: {e}")
            logger.error(f"[TENANT] Traceback: {traceback.format_exc()}")
            logger.error(f"[B2B] Schema: {schema_name or 'N/A'}, Email: {email}, Tenant: {tenant_id}")
            try:
                conn.rollback()
                conn.close()
            except (psycopg2.Error, OSError):
                pass
            return (False, "Erreur technique lors de la création du compte. Veuillez réessayer.")

    def update_entreprise_password(self, entreprise_id: int, new_password: str) -> bool:
        """Met à jour le mot de passe d'une entreprise"""
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            # IMPORTANT: Forcer search_path = public car entreprises est dans le schéma public
            cursor.execute("SET search_path TO public")

            salt = bcrypt.gensalt()
            password_hash = bcrypt.hashpw(new_password.encode('utf-8'), salt).decode('utf-8')

            cursor.execute(
                f'UPDATE public.entreprises SET password_hash = {ph}, updated_at = {ph} WHERE id = {ph}',
                (password_hash, datetime.now().isoformat(), entreprise_id)
            )

            if cursor.rowcount == 0:
                logger.warning(f"[TENANT] Aucune entreprise trouvée avec id={entreprise_id}")
                conn.close()
                return False

            conn.commit()
            conn.close()
            logger.info(f"[TENANT] Mot de passe entreprise {entreprise_id} mis à jour avec succès")
            return True

        except (psycopg2.Error, ValueError) as e:
            logger.error(f"[TENANT] Erreur mise à jour mot de passe entreprise {entreprise_id}: {e}")
            conn.rollback()
            conn.close()
            return False

    def get_all_entreprises(self, include_inactive: bool = False, product_type: str = None) -> List[Dict[str, Any]]:
        """Récupère toutes les entreprises

        Args:
            include_inactive: Si True, inclut les entreprises désactivées
            product_type: Filtre par type de produit ('ERP', 'EXPERTS_IA'). None = tous.
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()

        try:
            # IMPORTANT: Forcer search_path = public car entreprises est dans le schéma public
            cursor.execute("SET search_path TO public")

            base_query = """SELECT id, nom, schema_name, slug, email, phone, active, created_at,
                           representant_code, COALESCE(type_industrie, 'CONSTRUCTION') as type_industrie,
                           subscription_status, COALESCE(product_type, 'ERP') as product_type
                           FROM public.entreprises"""

            conditions = []
            params = []

            if not include_inactive:
                conditions.append("active = TRUE")

            if product_type:
                conditions.append("COALESCE(product_type, 'ERP') = %s")
                params.append(product_type)

            if conditions:
                base_query += " WHERE " + " AND ".join(conditions)

            base_query += " ORDER BY nom"

            cursor.execute(base_query, params)

            entreprises = []

            for row in cursor.fetchall():
                entreprise = dict(row)
                entreprises.append(entreprise)

            conn.close()
            return entreprises

        except (psycopg2.Error, KeyError) as e:
            logger.error(f"[TENANT] Erreur récupération entreprises: {e}")
            conn.close()
            return []

    def update_entreprise(self, entreprise_id: int, **kwargs) -> bool:
        """Met à jour une entreprise"""
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            # IMPORTANT: Forcer search_path = public car entreprises est dans le schéma public
            cursor.execute("SET search_path TO public")

            # Mapping des champs anciens vers nouveaux
            field_mapping = {
                'telephone': 'phone',
                'adresse': 'address',
                'actif': 'active'
            }

            allowed_fields = ['nom', 'email', 'phone', 'address', 'active', 'subscription_status']
            updates = []
            params = []

            for field, value in kwargs.items():
                # Convertir les anciens noms de champs vers les nouveaux
                db_field = field_mapping.get(field, field)

                if db_field in allowed_fields:
                    updates.append(f"{db_field} = {ph}")
                    params.append(value)

            if not updates:
                conn.close()
                return True

            updates.append(f"updated_at = {ph}")
            params.append(datetime.now().isoformat())

            params.append(entreprise_id)

            query = f"UPDATE public.entreprises SET {', '.join(updates)} WHERE id = {ph}"
            cursor.execute(query, params)

            conn.commit()
            conn.close()
            return True

        except (psycopg2.Error, KeyError) as e:
            logger.error(f"[TENANT] Erreur mise à jour entreprise: {e}")
            conn.rollback()
            conn.close()
            return False

    def get_tenant_users(self, schema: str) -> list:
        """Récupère tous les utilisateurs d'une entreprise"""
        conn = database_config.get_connection()
        cursor = conn.cursor()

        try:
            set_search_path_secure(cursor, schema)
            cursor.execute('''
                SELECT id, username, full_name, email, is_admin, active, created_at, last_login
                FROM users
                ORDER BY is_admin DESC, username ASC
            ''')

            rows = cursor.fetchall()

            users = []
            for row in rows:
                users.append({
                    'id': row['id'],
                    'username': row['username'],
                    'full_name': row['full_name'],
                    'email': row['email'],
                    'is_admin': row['is_admin'],
                    'active': row['active'],
                    'created_at': row['created_at'],
                    'last_login': row['last_login']
                })

            cursor.execute('SET search_path TO public')

            conn.close()
            return users

        except (psycopg2.Error, KeyError, ValueError) as e:
            logger.error(f"[TENANT] Erreur récupération utilisateurs: {e}")
            conn.close()
            return []

    def create_tenant_admin(self, schema: str, username: str, password: str = None,
                           full_name: str = "", email: str = "",
                           is_primary_admin: bool = True, password_hash: str = None) -> bool:
        """
        Crée un admin pour une entreprise (tenant)

        Args:
            is_primary_admin: Si True, met à jour admin_username dans entreprises
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            # Utiliser le hash fourni directement ou hasher le mot de passe
            if not password_hash:
                if not password:
                    logger.error(f"[TENANT] create_tenant_admin: ni password ni password_hash fourni pour {schema}")
                    conn.close()
                    return False
                # SÉCURITÉ: bcrypt avec 14 rounds pour sécurité renforcée
                salt = bcrypt.gensalt(rounds=14)
                password_hash = bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

            now = datetime.now().isoformat()

            set_search_path_secure(cursor, schema)

            # Filet de sécurité: créer la table users si elle n'existe pas
            # (peut arriver si _init_tenant_tables a échoué lors de la création)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(255) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    full_name VARCHAR(255),
                    email VARCHAR(255),
                    role VARCHAR(50) DEFAULT 'user',
                    is_admin BOOLEAN DEFAULT FALSE,
                    active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMP
                )
            ''')

            cursor.execute(f'''
                INSERT INTO users (username, password_hash, full_name, email, role, is_admin, active, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                ON CONFLICT (username) DO UPDATE SET
                    password_hash = EXCLUDED.password_hash,
                    role = 'admin',
                    is_admin = TRUE,
                    active = TRUE
            ''', (username, password_hash, full_name, email, 'admin', True, True, now))

            cursor.execute('SET search_path TO public')

            # Mettre à jour le username admin dans la table entreprises (pour CRM)
            # SÉCURITÉ: Ne jamais stocker le mot de passe en clair (admin_password_clear supprimé)
            # Seulement pour l'admin principal (pas pour Sylvainleduc support)
            if is_primary_admin and username != 'admin':
                cursor.execute(f'''
                    UPDATE entreprises
                    SET admin_username = {ph}
                    WHERE schema_name = {ph}
                ''', (username, schema))

            conn.commit()
            conn.close()

            safe_print(f"[TENANT] Admin '{username}' créé pour schéma '{schema}'")
            return True

        except (psycopg2.Error, ValueError) as e:
            logger.error(f"[TENANT] Erreur création admin tenant: {e}")
            conn.rollback()
            conn.close()
            return False

    # ============================================================================
    # GESTION DES TENTATIVES DE CONNEXION (Protection anti-brute force)
    # ============================================================================

    def check_login_blocked(self, login_type: str, identifier: str,
                           schema_name: str = None) -> tuple[bool, int]:
        """
        Vérifie si un compte est bloqué suite à trop de tentatives

        Args:
            login_type: 'entreprise' ou 'user'
            identifier: email pour entreprise, username pour user
            schema_name: nom du schema pour les users, None pour entreprises

        Returns:
            (is_blocked, remaining_seconds)
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            # Vérifier si un blocage actif existe
            if schema_name:
                cursor.execute(f'''
                    SELECT blocked_until FROM public.login_attempts
                    WHERE login_type = {ph} AND identifier = {ph} AND schema_name = {ph}
                    AND blocked_until > NOW()
                    ORDER BY blocked_until DESC LIMIT 1
                ''', (login_type, identifier, schema_name))
            else:
                cursor.execute(f'''
                    SELECT blocked_until FROM public.login_attempts
                    WHERE login_type = {ph} AND identifier = {ph} AND schema_name IS NULL
                    AND blocked_until > NOW()
                    ORDER BY blocked_until DESC LIMIT 1
                ''', (login_type, identifier))

            result = cursor.fetchone()

            if result and result['blocked_until']:
                # Calculer le temps restant en secondes
                from datetime import datetime
                blocked_until = result['blocked_until']
                if isinstance(blocked_until, str):
                    blocked_until = datetime.fromisoformat(blocked_until)
                remaining_seconds = int((blocked_until - datetime.now()).total_seconds())
                conn.close()
                return (True, max(0, remaining_seconds))

            # Compter les tentatives récentes (dernières 15 minutes)
            if schema_name:
                cursor.execute(f'''
                    SELECT COUNT(*) as count FROM public.login_attempts
                    WHERE login_type = {ph} AND identifier = {ph} AND schema_name = {ph}
                    AND attempt_time > NOW() - INTERVAL '15 minutes'
                    AND blocked_until IS NULL
                ''', (login_type, identifier, schema_name))
            else:
                cursor.execute(f'''
                    SELECT COUNT(*) as count FROM public.login_attempts
                    WHERE login_type = {ph} AND identifier = {ph} AND schema_name IS NULL
                    AND attempt_time > NOW() - INTERVAL '15 minutes'
                    AND blocked_until IS NULL
                ''', (login_type, identifier))

            count_result = cursor.fetchone()
            attempts_count = count_result['count'] if count_result else 0

            conn.close()

            # Si 5 tentatives ou plus, bloquer pour 15 minutes
            if attempts_count >= 5:
                self.block_account(login_type, identifier, schema_name, duration_minutes=15)
                return (True, 15 * 60)  # 15 minutes en secondes

            return (False, 0)

        except (psycopg2.Error, KeyError, TypeError) as e:
            logger.error(f"[SECURITY] Erreur vérification blocage: {e}")
            conn.close()
            return (False, 0)

    def record_failed_attempt(self, login_type: str, identifier: str,
                             schema_name: str = None, ip_address: str = None):
        """
        Enregistre une tentative de connexion échouée

        Args:
            login_type: 'entreprise' ou 'user'
            identifier: email pour entreprise, username pour user
            schema_name: nom du schema pour les users, None pour entreprises
            ip_address: adresse IP (optionnel)
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            cursor.execute(f'''
                INSERT INTO public.login_attempts
                (login_type, identifier, schema_name, attempt_time, ip_address)
                VALUES ({ph}, {ph}, {ph}, NOW(), {ph})
            ''', (login_type, identifier, schema_name, ip_address))

            conn.commit()
            conn.close()

            safe_print(f"[SECURITY] Tentative échouée enregistrée: {login_type}/{identifier}")

        except psycopg2.Error as e:
            logger.error(f"[SECURITY] Erreur enregistrement tentative: {e}")
            conn.rollback()
            conn.close()

    def clear_login_attempts(self, login_type: str, identifier: str,
                            schema_name: str = None):
        """
        Efface les tentatives de connexion (après connexion réussie)

        Args:
            login_type: 'entreprise' ou 'user'
            identifier: email pour entreprise, username pour user
            schema_name: nom du schema pour les users, None pour entreprises
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            if schema_name:
                cursor.execute(f'''
                    DELETE FROM public.login_attempts
                    WHERE login_type = {ph} AND identifier = {ph} AND schema_name = {ph}
                ''', (login_type, identifier, schema_name))
            else:
                cursor.execute(f'''
                    DELETE FROM public.login_attempts
                    WHERE login_type = {ph} AND identifier = {ph} AND schema_name IS NULL
                ''', (login_type, identifier))

            conn.commit()
            conn.close()

            safe_print(f"[SECURITY] Tentatives effacées: {login_type}/{identifier}")

        except psycopg2.Error as e:
            logger.error(f"[SECURITY] Erreur effacement tentatives: {e}")
            conn.rollback()
            conn.close()

    def block_account(self, login_type: str, identifier: str,
                     schema_name: str = None, duration_minutes: int = 15):
        """
        Bloque un compte pour une durée déterminée

        Args:
            login_type: 'entreprise' ou 'user'
            identifier: email pour entreprise, username pour user
            schema_name: nom du schema pour les users, None pour entreprises
            duration_minutes: durée du blocage en minutes (défaut: 15)
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            cursor.execute(f'''
                INSERT INTO public.login_attempts
                (login_type, identifier, schema_name, attempt_time, blocked_until)
                VALUES ({ph}, {ph}, {ph}, NOW(), NOW() + INTERVAL '{duration_minutes} minutes')
            ''', (login_type, identifier, schema_name))

            conn.commit()
            conn.close()

            safe_print(f"[SECURITY] Compte bloqué pour {duration_minutes} min: {login_type}/{identifier}")

        except psycopg2.Error as e:
            logger.error(f"[SECURITY] Erreur blocage compte: {e}")
            conn.rollback()
            conn.close()

    def update_user_password(self, schema: str, username: str, new_password: str) -> bool:
        """
        Met à jour le mot de passe d'un utilisateur dans un tenant
        (Utilisé par le Super Admin pour réinitialiser les mots de passe)

        Args:
            schema: schéma du tenant
            username: nom d'utilisateur
            new_password: nouveau mot de passe

        Returns:
            True si succès, False sinon
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            # Hash du nouveau mot de passe
            salt = bcrypt.gensalt()
            password_hash = bcrypt.hashpw(new_password.encode('utf-8'), salt).decode('utf-8')

            # Mettre à jour dans le schéma du tenant
            set_search_path_secure(cursor, schema)

            cursor.execute(f'''
                UPDATE users
                SET password_hash = {ph}, updated_at = NOW()
                WHERE username = {ph}
            ''', (password_hash, username))

            cursor.execute('SET search_path TO public')

            if cursor.rowcount == 0:
                conn.close()
                return False

            conn.commit()
            conn.close()

            safe_print(f"[TENANT] Mot de passe mis à jour pour '{username}' dans '{schema}'")
            return True

        except (psycopg2.Error, ValueError) as e:
            logger.error(f"[TENANT] Erreur mise à jour mot de passe: {e}")
            conn.rollback()
            conn.close()
            return False

    # ============================================================================
    # GESTION PARAMÈTRES ADMIN
    # ============================================================================

    def get_admin_setting(self, key: str, default: str = None) -> str:
        """
        Récupère un paramètre admin depuis la base de données.

        Args:
            key: Clé du paramètre
            default: Valeur par défaut si non trouvé

        Returns:
            Valeur du paramètre ou default
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()

        try:
            # S'assurer que la table existe
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS admin_settings (
                    key VARCHAR(100) PRIMARY KEY,
                    value TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            conn.commit()

            cursor.execute('SELECT value FROM admin_settings WHERE key = %s', (key,))
            row = cursor.fetchone()
            conn.close()

            if row:
                return row[0] if not hasattr(row, 'get') else row.get('value')
            return default

        except (psycopg2.Error, KeyError) as e:
            logger.error(f"[TENANT] Erreur lecture paramètre '{key}': {e}")
            conn.close()
            return default

    def set_admin_setting(self, key: str, value: str) -> bool:
        """
        Définit un paramètre admin dans la base de données.

        Args:
            key: Clé du paramètre
            value: Valeur à stocker

        Returns:
            True si succès, False sinon
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()

        try:
            # S'assurer que la table existe
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS admin_settings (
                    key VARCHAR(100) PRIMARY KEY,
                    value TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            cursor.execute('''
                INSERT INTO admin_settings (key, value, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            ''', (key, value))

            conn.commit()
            conn.close()

            logger.info(f"[TENANT] Paramètre '{key}' mis à jour: {value}")
            return True

        except psycopg2.Error as e:
            logger.error(f"[TENANT] Erreur écriture paramètre '{key}': {e}")
            conn.rollback()
            conn.close()
            return False

    # ============================================================================
    # GESTION CRM - PROSPECTS/ABONNÉS
    # ============================================================================

    def get_all_entreprises_crm(self) -> List[Dict[str, Any]]:
        """
        Récupère toutes les entreprises avec les champs CRM pour le tableau de bord.
        Inclut aussi le premier admin de chaque entreprise et les données Stripe.
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()

        try:
            # S'assurer que la colonne deleted_at existe
            try:
                cursor.execute("ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL")
                conn.commit()
            except psycopg2.Error:
                conn.rollback()  # Ignorer si erreur

            # SÉCURITÉ: password_clear et admin_password_clear supprimés (ne pas stocker mots de passe en clair)
            # JOIN avec subscriptions pour récupérer les données Stripe
            cursor.execute('''
                SELECT
                    e.id, e.nom, e.schema_name, e.slug, e.email, e.phone, e.address, e.active,
                    e.representant_code, e.created_at,
                    e.statut_abonne, e.type_abonnement, e.contact_nom, e.demo_limite,
                    e.admin_username,
                    s.status AS stripe_status,
                    s.trial_end AS stripe_trial_end,
                    s.current_period_end AS stripe_period_end,
                    s.created_at AS stripe_created_at,
                    s.stripe_subscription_id,
                    s.stripe_customer_id,
                    s.price_monthly,
                    s.plan_name
                FROM entreprises e
                LEFT JOIN public.subscriptions s ON e.id = s.company_id
                WHERE e.deleted_at IS NULL
                ORDER BY e.created_at DESC
            ''')

            entreprises = [dict(row) for row in cursor.fetchall()]
            conn.close()
            return entreprises

        except (psycopg2.Error, KeyError) as e:
            logger.error(f"[TENANT] Erreur récupération CRM: {e}")
            conn.close()
            return []

    def update_entreprise_crm(self, entreprise_id: int, **kwargs) -> bool:
        """
        Met à jour les champs CRM d'une entreprise.

        Champs supportés:
            - statut_abonne: 'Inscrit', 'Non-inscrit', 'Pas essayé', 'Prospect'
            - type_abonnement: 'Client', 'Démo', 'Testeur'
            - representant_code: Nom du vendeur
            - contact_nom: Nom du contact principal
            - demo_limite: Date limite de la démo (YYYY-MM-DD)
            - admin_username: Username admin principal
            - nom, email, phone, address, active

        SÉCURITÉ: Les champs password_clear et admin_password_clear ont été supprimés.
        Les mots de passe ne doivent jamais être stockés en clair.
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        # Champs autorisés pour la mise à jour
        # SÉCURITÉ: password_clear et admin_password_clear retirés (ne pas stocker en clair)
        allowed_fields = [
            'statut_abonne', 'type_abonnement', 'representant_code',
            'contact_nom', 'demo_limite', 'admin_username',
            'nom', 'email', 'phone', 'address', 'active'
        ]

        # Filtrer les champs valides
        updates = {k: v for k, v in kwargs.items() if k in allowed_fields}

        if not updates:
            conn.close()
            return False

        try:
            # Vérifier si l'entreprise a un nom NULL et le corriger d'abord
            cursor.execute(f'''
                SELECT nom, slug, schema_name, contact_nom
                FROM entreprises WHERE id = {ph}
            ''', (entreprise_id,))
            row = cursor.fetchone()

            if row:
                current_nom = row[0]
                # Si nom est NULL, utiliser un fallback (slug, schema_name ou contact_nom)
                if current_nom is None and 'nom' not in updates:
                    fallback_nom = row[1] or row[2] or row[3] or f"Entreprise #{entreprise_id}"
                    updates['nom'] = fallback_nom
                    logger.info(f"[TENANT] Correction nom NULL -> '{fallback_nom}' pour entreprise #{entreprise_id}")

            # Construire la requête UPDATE
            set_clauses = []
            values = []
            for field, value in updates.items():
                set_clauses.append(f"{field} = {ph}")
                values.append(value)

            values.append(entreprise_id)

            query = f'''
                UPDATE entreprises
                SET {', '.join(set_clauses)}, updated_at = NOW()
                WHERE id = {ph}
            '''

            cursor.execute(query, tuple(values))
            conn.commit()
            conn.close()

            safe_print(f"[TENANT] CRM mis à jour pour entreprise #{entreprise_id}")
            return True

        except (psycopg2.Error, KeyError) as e:
            logger.error(f"[TENANT] Erreur mise à jour CRM: {e}")
            conn.rollback()
            conn.close()
            return False

    def soft_delete_entreprise(self, entreprise_id: int) -> bool:
        """
        Désactivation d'une entreprise (soft delete).
        L'entreprise est marquée comme désactivée mais reste dans la base de données.
        Elle n'apparaîtra plus dans les listes et calculs.

        Args:
            entreprise_id: ID de l'entreprise à désactiver

        Returns:
            True si succès, False sinon
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            # S'assurer que la colonne deleted_at existe
            try:
                cursor.execute("ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL")
                conn.commit()
            except psycopg2.Error:
                conn.rollback()  # Ignorer si la colonne existe déjà ou autre erreur

            # Vérifier que l'entreprise existe
            cursor.execute(f'''
                SELECT nom FROM entreprises WHERE id = {ph}
            ''', (entreprise_id,))
            row = cursor.fetchone()

            if not row:
                logger.warning(f"[TENANT] Entreprise #{entreprise_id} non trouvée")
                conn.close()
                return False

            nom_entreprise = row['nom'] if isinstance(row, dict) else row[0]

            # Marquer comme désactivée (active = FALSE + deleted_at = NOW())
            cursor.execute(f'''
                UPDATE entreprises
                SET deleted_at = NOW(), active = FALSE
                WHERE id = {ph}
            ''', (entreprise_id,))

            conn.commit()
            conn.close()

            safe_print(f"[TENANT] Entreprise '{nom_entreprise}' (#{entreprise_id}) désactivée (soft delete)")
            return True

        except Exception as e:
            logger.error(f"[TENANT] Erreur soft delete entreprise #{entreprise_id}: {e}")
            import traceback
            logger.error(f"[TENANT] Traceback: {traceback.format_exc()}")
            conn.rollback()
            conn.close()
            return False

    def restore_entreprise(self, entreprise_id: int) -> bool:
        """
        Restaure une entreprise désactivée (annule le soft delete).
        Remet active = TRUE et deleted_at = NULL.

        Args:
            entreprise_id: ID de l'entreprise à restaurer

        Returns:
            True si succès, False sinon
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()
        ph = database_config.get_placeholder()

        try:
            # Vérifier que l'entreprise existe et est bien désactivée
            cursor.execute(f'''
                SELECT nom, active, deleted_at FROM entreprises WHERE id = {ph}
            ''', (entreprise_id,))
            row = cursor.fetchone()

            if not row:
                logger.warning(f"[TENANT] Entreprise #{entreprise_id} non trouvée pour restauration")
                conn.close()
                return False

            nom_entreprise = row['nom'] if isinstance(row, dict) else row[0]

            # Restaurer l'entreprise (active = TRUE + deleted_at = NULL)
            cursor.execute(f'''
                UPDATE entreprises
                SET active = TRUE, deleted_at = NULL
                WHERE id = {ph}
            ''', (entreprise_id,))

            conn.commit()
            conn.close()

            safe_print(f"[TENANT] Entreprise '{nom_entreprise}' (#{entreprise_id}) restaurée avec succès")
            return True

        except Exception as e:
            logger.error(f"[TENANT] Erreur restauration entreprise #{entreprise_id}: {e}")
            import traceback
            logger.error(f"[TENANT] Traceback: {traceback.format_exc()}")
            conn.rollback()
            conn.close()
            return False

    def get_deleted_entreprises(self) -> list:
        """
        Récupère les entreprises désactivées (soft deleted).

        Returns:
            Liste de dicts avec id, nom, email, schema_name, deleted_at
        """
        conn = database_config.get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute('''
                SELECT id, nom, email, schema_name, deleted_at, created_at
                FROM entreprises
                WHERE deleted_at IS NOT NULL
                ORDER BY deleted_at DESC
            ''')

            entreprises = [dict(row) for row in cursor.fetchall()]
            conn.close()
            return entreprises

        except Exception as e:
            logger.error(f"[TENANT] Erreur récupération entreprises désactivées: {e}")
            conn.close()
            return []

    def update_entreprises_crm_batch(self, updates: List[Dict[str, Any]]) -> int:
        """
        Met à jour plusieurs entreprises en lot.

        Args:
            updates: Liste de dicts avec 'id' et les champs à mettre à jour

        Returns:
            Nombre d'entreprises mises à jour avec succès
        """
        success_count = 0
        for update in updates:
            entreprise_id = update.pop('id', None)
            if entreprise_id:
                if self.update_entreprise_crm(entreprise_id, **update):
                    success_count += 1
        return success_count


def get_tenant_connection(schema: str = None):
    """Retourne une connexion configurée pour un tenant spécifique"""
    if schema is None:
        schema = st.session_state.get('tenant_schema', 'public')

    conn = database_config.get_connection()

    if schema != 'public':
        cursor = conn.cursor()
        try:
            # SÉCURITÉ: Utiliser set_search_path_secure pour échapper le nom du schéma
            set_search_path_secure(cursor, schema)
        finally:
            cursor.close()  # Toujours fermer le curseur

    return conn


def get_current_schema():
    """Retourne le schéma du tenant courant"""
    return st.session_state.get('tenant_schema', 'public')


def set_current_tenant(entreprise: Dict[str, Any]):
    """Définit le tenant courant dans la session"""
    st.session_state.tenant_id = entreprise['id']
    st.session_state.tenant_nom = entreprise['nom']
    st.session_state.tenant_schema = entreprise.get('schema_name', entreprise.get('slug', ''))
    # Pour compatibilité descendante, garder aussi tenant_code pointant vers schema_name
    st.session_state.tenant_code = entreprise.get('schema_name', entreprise.get('slug', ''))


# Instance globale (lazy loading)
_tenant_manager_instance = None

def get_tenant_manager():
    """Retourne l'instance du gestionnaire de tenants"""
    global _tenant_manager_instance
    if _tenant_manager_instance is None:
        _tenant_manager_instance = TenantManager()
    return _tenant_manager_instance


def init_test_enterprises():
    """
    Initialise des entreprises de demo pour le développement local.

    SÉCURITÉ : cette fonction ne crée AUCUNE donnée si la variable d'environnement
    INIT_DEMO_ENTERPRISES=true n'est pas explicitement définie. Les mots de passe
    sont lus depuis DEMO_TENANT_PASSWORD ; aucun mot de passe par défaut n'est utilisé.
    """
    if os.getenv("INIT_DEMO_ENTERPRISES", "false").lower() != "true":
        logger.info("[DEMO] init_test_enterprises ignoré (INIT_DEMO_ENTERPRISES != true)")
        return

    demo_password = os.getenv("DEMO_TENANT_PASSWORD")
    if not demo_password:
        logger.error("[DEMO] DEMO_TENANT_PASSWORD requis pour initialiser les tenants de demo")
        return

    tm = get_tenant_manager()

    # Tenants de demo — emails example.com pour éviter toute collision avec un domaine réel.
    test_enterprises = [
        {
            'nom': 'Demo Construction A',
            'email': 'demo-a@example.com',
            'password': demo_password,
            'telephone': '555-0100',
            'adresse': 'Demo City',
            'admin_username': 'demo_admin_a',
            'admin_password': demo_password,
            'admin_fullname': 'Admin Demo A',
            'admin_email': 'admin-a@example.com'
        },
        {
            'nom': 'Demo Construction B',
            'email': 'demo-b@example.com',
            'password': demo_password,
            'telephone': '555-0101',
            'adresse': 'Demo City',
            'admin_username': 'demo_admin_b',
            'admin_password': demo_password,
            'admin_fullname': 'Admin Demo B',
            'admin_email': 'admin-b@example.com'
        }
    ]

    conn = database_config.get_connection()
    cursor = conn.cursor()
    ph = database_config.get_placeholder()

    for enterprise in test_enterprises:
        try:
            # Vérifier si l'entreprise existe déjà
            cursor.execute(f'SELECT id, slug FROM entreprises WHERE LOWER(email) = LOWER({ph})', (enterprise['email'],))
            result = cursor.fetchone()

            if result:
                # L'entreprise existe déjà
                slug = result['slug']
                safe_print(f"[TEST] Entreprise '{enterprise['nom']}' existe déjà (schéma: {slug})")

                # Vérifier si l'admin existe
                # SÉCURITÉ: Utiliser set_search_path_secure pour échapper le nom du schéma
                set_search_path_secure(cursor, slug)
                cursor.execute(f'SELECT id FROM users WHERE username = {ph}', (enterprise['admin_username'],))
                if not cursor.fetchone():
                    # Créer l'admin
                    tm.create_tenant_admin(
                        schema=slug,
                        username=enterprise['admin_username'],
                        password=enterprise['admin_password'],
                        full_name=enterprise['admin_fullname'],
                        email=enterprise['admin_email']
                    )
                    safe_print(f"[TEST] Admin '{enterprise['admin_username']}' créé pour '{enterprise['nom']}'")
                cursor.execute('SET search_path TO public')
            else:
                # Créer l'entreprise
                entreprise_id = tm.create_entreprise(
                    nom=enterprise['nom'],
                    password=enterprise['password'],
                    email=enterprise['email'],
                    telephone=enterprise['telephone'],
                    adresse=enterprise['adresse']
                )

                if entreprise_id:
                    # Récupérer le slug
                    cursor.execute(f'SELECT slug FROM entreprises WHERE id = {ph}', (entreprise_id,))
                    result = cursor.fetchone()
                    slug = result['slug']

                    # Créer l'admin personnalisé
                    tm.create_tenant_admin(
                        schema=slug,
                        username=enterprise['admin_username'],
                        password=enterprise['admin_password'],
                        full_name=enterprise['admin_fullname'],
                        email=enterprise['admin_email']
                    )

                    safe_print(f"[TEST] Entreprise '{enterprise['nom']}' créée avec admin '{enterprise['admin_username']}'")
                else:
                    safe_print(f"[TEST] Échec création entreprise '{enterprise['nom']}'")

        except (psycopg2.Error, ValueError, KeyError) as e:
            logger.error(f"[TEST] Erreur création entreprise test '{enterprise['nom']}': {e}")
            safe_print(f"[TEST] Erreur: {e}")

    conn.close()
    safe_print("[TEST] Initialisation entreprises de test terminée")
