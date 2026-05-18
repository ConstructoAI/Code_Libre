"""
Module de suivi d'utilisation IA - Constructo AI
Permet de tracker l'utilisation des fonctionnalites IA par entreprise pour facturation
"""

import logging
from datetime import datetime, date, timedelta
from typing import List, Dict, Optional
import database_config

logger = logging.getLogger(__name__)

# Types de fonctionnalites IA disponibles - ERP
AI_FEATURE_DEVIS_ESTIMATION = 'devis_estimation'
AI_FEATURE_GANTT_OPTIMIZATION = 'gantt_optimization'
AI_FEATURE_ASSISTANT_IA = 'assistant_ia'
AI_FEATURE_DOCUMENT_ANALYZER = 'document_analyzer'
AI_FEATURE_WEB_SEARCH = 'web_search'

# Types de fonctionnalites IA - EXPERTS IA
AI_FEATURE_EXPERTS_CONVERSATION = 'experts_conversation'
AI_FEATURE_EXPERTS_DOCUMENT = 'experts_document_analysis'
AI_FEATURE_EXPERTS_WEB_SEARCH = 'experts_web_search'
AI_FEATURE_EXPERTS_WEB_FETCH = 'experts_web_fetch'
AI_FEATURE_EXPERTS_MEMORY = 'experts_memory_conversation'
AI_FEATURE_EXPERTS_SOUMISSION = 'experts_soumission_extraction'
AI_FEATURE_EXPERTS_PDF_IMPORT = 'experts_pdf_import'

# Types de produits
PRODUCT_TYPE_ERP = 'ERP'
PRODUCT_TYPE_EXPERTS_IA = 'EXPERTS_IA'

# Limites mensuelles par defaut (USD) — aucune IA incluse, tout est prepaye
DEFAULT_MONTHLY_LIMIT_ERP = 0.00
DEFAULT_MONTHLY_LIMIT_EXPERTS_IA = 0.00

# Limite quotidienne pour les abonnements en essai (trialing) - USD — aucune IA gratuite
DEFAULT_TRIAL_DAILY_LIMIT = 0.00

# Montant de recharge credits IA prepayes (USD) — facture a la carte Stripe
PREPAID_CREDIT_AMOUNT = 10.00


def get_entreprise_product_type(entreprise_id: int) -> str:
    """
    Detecte le product_type reel d'une entreprise depuis la table entreprises.
    Retourne 'ERP' par defaut si non trouve.
    """
    if not entreprise_id:
        return PRODUCT_TYPE_ERP
    conn = database_config.get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SET search_path TO public")
        cursor.execute(
            "SELECT product_type FROM entreprises WHERE id = %s",
            (entreprise_id,)
        )
        row = cursor.fetchone()
        if row:
            val = row[0] if not isinstance(row, dict) else row.get('product_type')
            if val in (PRODUCT_TYPE_ERP, PRODUCT_TYPE_EXPERTS_IA):
                return val
        return PRODUCT_TYPE_ERP
    except Exception as e:
        logger.warning(f"[AI_USAGE] Impossible de detecter product_type pour entreprise {entreprise_id}: {e}")
        return PRODUCT_TYPE_ERP
    finally:
        conn.close()


def init_ai_usage_table():
    """
    Cree la table ai_usage_tracking dans le schema public si elle n'existe pas.
    Stocke l'utilisation IA par entreprise, fonctionnalite, date.
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        # Table principale de tracking
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS ai_usage_tracking (
                id SERIAL PRIMARY KEY,
                entreprise_id INTEGER,
                entreprise_nom VARCHAR(255),
                schema_name VARCHAR(255),
                user_id INTEGER,
                username VARCHAR(255),
                feature VARCHAR(100) NOT NULL,
                product_type VARCHAR(50) DEFAULT 'ERP',
                tokens_input INTEGER DEFAULT 0,
                tokens_output INTEGER DEFAULT 0,
                tokens_total INTEGER DEFAULT 0,
                estimated_cost_usd DECIMAL(10, 6) DEFAULT 0,
                request_count INTEGER DEFAULT 1,
                model VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                request_date DATE DEFAULT CURRENT_DATE
            )
        ''')

        # Migration: ajouter product_type si la table existait deja
        cursor.execute('''
            ALTER TABLE ai_usage_tracking
            ADD COLUMN IF NOT EXISTS product_type VARCHAR(50) DEFAULT 'ERP'
        ''')

        # Table agregee journaliere pour rapports rapides
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS ai_usage_daily (
                id SERIAL PRIMARY KEY,
                entreprise_id INTEGER,
                entreprise_nom VARCHAR(255),
                schema_name VARCHAR(255),
                feature VARCHAR(100) NOT NULL,
                product_type VARCHAR(50) DEFAULT 'ERP',
                usage_date DATE NOT NULL,
                total_requests INTEGER DEFAULT 0,
                total_tokens_input INTEGER DEFAULT 0,
                total_tokens_output INTEGER DEFAULT 0,
                total_tokens INTEGER DEFAULT 0,
                total_cost_usd DECIMAL(10, 4) DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(entreprise_id, feature, usage_date, product_type)
            )
        ''')

        # Migration: ajouter product_type si la table existait deja
        cursor.execute('''
            ALTER TABLE ai_usage_daily
            ADD COLUMN IF NOT EXISTS product_type VARCHAR(50) DEFAULT 'ERP'
        ''')

        # Migration: mettre a jour la contrainte UNIQUE pour inclure product_type
        # (necessaire pour les tables existantes creees avant cette migration)
        cursor.execute('''
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'ai_usage_daily_entreprise_id_feature_usage_date_key'
                    AND connamespace = 'public'::regnamespace
                ) THEN
                    ALTER TABLE ai_usage_daily
                        DROP CONSTRAINT ai_usage_daily_entreprise_id_feature_usage_date_key;
                END IF;
            END $$
        ''')
        cursor.execute('''
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'ai_usage_daily_entreprise_id_feature_usage_date_product_key'
                    AND connamespace = 'public'::regnamespace
                ) THEN
                    ALTER TABLE ai_usage_daily
                        ADD CONSTRAINT ai_usage_daily_entreprise_id_feature_usage_date_product_key
                        UNIQUE (entreprise_id, feature, usage_date, product_type);
                END IF;
            END $$
        ''')

        # Table agregee mensuelle pour rapports et facturation
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS ai_usage_monthly (
                id SERIAL PRIMARY KEY,
                entreprise_id INTEGER,
                entreprise_nom VARCHAR(255),
                schema_name VARCHAR(255),
                feature VARCHAR(100) NOT NULL,
                product_type VARCHAR(50) DEFAULT 'ERP',
                usage_year INTEGER NOT NULL,
                usage_month INTEGER NOT NULL,
                total_requests INTEGER DEFAULT 0,
                total_tokens_input INTEGER DEFAULT 0,
                total_tokens_output INTEGER DEFAULT 0,
                total_tokens INTEGER DEFAULT 0,
                total_cost_usd DECIMAL(10, 4) DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(entreprise_id, feature, usage_year, usage_month, product_type)
            )
        ''')

        # Migration: ajouter product_type si la table existait deja
        cursor.execute('''
            ALTER TABLE ai_usage_monthly
            ADD COLUMN IF NOT EXISTS product_type VARCHAR(50) DEFAULT 'ERP'
        ''')

        # Migration: mettre a jour la contrainte UNIQUE pour inclure product_type
        cursor.execute('''
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'ai_usage_monthly_entreprise_id_feature_usage_year_usage_mon_key'
                    AND connamespace = 'public'::regnamespace
                ) THEN
                    ALTER TABLE ai_usage_monthly
                        DROP CONSTRAINT ai_usage_monthly_entreprise_id_feature_usage_year_usage_mon_key;
                END IF;
            END $$
        ''')
        cursor.execute('''
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'ai_usage_monthly_entreprise_id_feature_year_month_product_key'
                    AND connamespace = 'public'::regnamespace
                ) THEN
                    ALTER TABLE ai_usage_monthly
                        ADD CONSTRAINT ai_usage_monthly_entreprise_id_feature_year_month_product_key
                        UNIQUE (entreprise_id, feature, usage_year, usage_month, product_type);
                END IF;
            END $$
        ''')

        # Index pour recherches rapides
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ai_usage_entreprise ON ai_usage_tracking(entreprise_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ai_usage_feature ON ai_usage_tracking(feature)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ai_usage_date ON ai_usage_tracking(request_date)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_tracking(created_at)')

        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ai_daily_entreprise ON ai_usage_daily(entreprise_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ai_daily_date ON ai_usage_daily(usage_date)')

        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ai_monthly_entreprise ON ai_usage_monthly(entreprise_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ai_monthly_period ON ai_usage_monthly(usage_year, usage_month)')

        # Index pour filtrage par product_type
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ai_usage_product ON ai_usage_tracking(product_type)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ai_daily_product ON ai_usage_daily(product_type)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ai_monthly_product ON ai_usage_monthly(product_type)')

        # Table des limites de facturation par entreprise
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS ai_billing_limits (
                id SERIAL PRIMARY KEY,
                entreprise_id INTEGER NOT NULL,
                entreprise_nom VARCHAR(255),
                product_type VARCHAR(50) NOT NULL DEFAULT 'ERP',
                monthly_limit_usd DECIMAL(10, 2) NOT NULL DEFAULT 50.00,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(entreprise_id, product_type)
            )
        ''')

        cursor.execute('CREATE INDEX IF NOT EXISTS idx_billing_limits_entreprise ON ai_billing_limits(entreprise_id)')

        # Migration: ajouter trial_daily_limit_usd si la table existait deja
        cursor.execute('''
            ALTER TABLE ai_billing_limits
            ADD COLUMN IF NOT EXISTS trial_daily_limit_usd DECIMAL(10, 2) DEFAULT 5.00
        ''')

        # Table des credits IA prepayes (recharge automatique par tranches via Stripe)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS ai_prepaid_credits (
                id SERIAL PRIMARY KEY,
                entreprise_id INTEGER NOT NULL,
                entreprise_nom VARCHAR(255),
                product_type VARCHAR(50) NOT NULL DEFAULT 'ERP',
                balance_usd DECIMAL(10, 4) NOT NULL DEFAULT 0.00,
                total_charged_usd DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                total_consumed_usd DECIMAL(10, 4) NOT NULL DEFAULT 0.00,
                charges_count INTEGER NOT NULL DEFAULT 0,
                last_charge_stripe_id TEXT,
                last_charge_at TIMESTAMP,
                billing_year INTEGER NOT NULL,
                billing_month INTEGER NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(entreprise_id, product_type, billing_year, billing_month)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_prepaid_credits_entreprise ON ai_prepaid_credits(entreprise_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_prepaid_credits_period ON ai_prepaid_credits(billing_year, billing_month)')

        conn.commit()
        logger.info("[AI_USAGE] Tables ai_usage initialisees")

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur creation tables: {e}")
        conn.rollback()
    finally:
        conn.close()


def track_ai_usage(
    feature: str,
    tokens_input: int = 0,
    tokens_output: int = 0,
    model_used: str = None,
    entreprise_id: int = None,
    entreprise_nom: str = None,
    schema_name: str = None,
    user_id: int = None,
    username: str = None,
    product_type: str = None
) -> bool:
    """
    Enregistre une utilisation d'une fonctionnalite IA.

    Args:
        feature: Type de fonctionnalite (devis_estimation, assistant_ia, etc.)
        tokens_input: Nombre de tokens en entree
        tokens_output: Nombre de tokens en sortie
        model_used: Modele utilise (claude-sonnet-4-5, claude-opus-4-7, etc.)
        entreprise_id: ID de l'entreprise
        entreprise_nom: Nom de l'entreprise
        schema_name: Schema de l'entreprise
        user_id: ID de l'utilisateur
        username: Nom de l'utilisateur
        product_type: Type de produit (ERP ou EXPERTS_IA) — auto-detecte si None

    Returns:
        True si succes, False sinon
    """
    # Auto-detection du product_type depuis la table entreprises
    if product_type is None:
        product_type = get_entreprise_product_type(entreprise_id)

    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        tokens_total = tokens_input + tokens_output

        # Estimation du cout (prix Claude Opus 4.6 - mars 2026)
        # Opus 4.6: $15/1M input, $75/1M output
        cost_per_input = 15.0 / 1000000
        cost_per_output = 75.0 / 1000000

        estimated_cost = ((tokens_input * cost_per_input) + (tokens_output * cost_per_output)) * 1.30  # 30% markup

        today = date.today()

        # 1. Inserer dans la table detaillee
        cursor.execute('''
            INSERT INTO ai_usage_tracking (
                entreprise_id, entreprise_nom, schema_name,
                user_id, username, feature, product_type,
                tokens_input, tokens_output, tokens_total,
                estimated_cost_usd, model, request_date
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ''', (
            entreprise_id, entreprise_nom, schema_name,
            user_id, username, feature, product_type,
            tokens_input, tokens_output, tokens_total,
            estimated_cost, model_used, today
        ))

        # 2. Mettre a jour l'agregation journaliere
        cursor.execute('''
            INSERT INTO ai_usage_daily (
                entreprise_id, entreprise_nom, schema_name, feature, product_type, usage_date,
                total_requests, total_tokens_input, total_tokens_output, total_tokens, total_cost_usd
            ) VALUES (%s, %s, %s, %s, %s, %s, 1, %s, %s, %s, %s)
            ON CONFLICT (entreprise_id, feature, usage_date, product_type)
            DO UPDATE SET
                total_requests = ai_usage_daily.total_requests + 1,
                total_tokens_input = ai_usage_daily.total_tokens_input + EXCLUDED.total_tokens_input,
                total_tokens_output = ai_usage_daily.total_tokens_output + EXCLUDED.total_tokens_output,
                total_tokens = ai_usage_daily.total_tokens + EXCLUDED.total_tokens,
                total_cost_usd = ai_usage_daily.total_cost_usd + EXCLUDED.total_cost_usd,
                updated_at = CURRENT_TIMESTAMP
        ''', (
            entreprise_id, entreprise_nom, schema_name, feature, product_type, today,
            tokens_input, tokens_output, tokens_total, estimated_cost
        ))

        # 3. Mettre a jour l'agregation mensuelle
        cursor.execute('''
            INSERT INTO ai_usage_monthly (
                entreprise_id, entreprise_nom, schema_name, feature, product_type,
                usage_year, usage_month,
                total_requests, total_tokens_input, total_tokens_output, total_tokens, total_cost_usd
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, 1, %s, %s, %s, %s)
            ON CONFLICT (entreprise_id, feature, usage_year, usage_month, product_type)
            DO UPDATE SET
                total_requests = ai_usage_monthly.total_requests + 1,
                total_tokens_input = ai_usage_monthly.total_tokens_input + EXCLUDED.total_tokens_input,
                total_tokens_output = ai_usage_monthly.total_tokens_output + EXCLUDED.total_tokens_output,
                total_tokens = ai_usage_monthly.total_tokens + EXCLUDED.total_tokens,
                total_cost_usd = ai_usage_monthly.total_cost_usd + EXCLUDED.total_cost_usd,
                updated_at = CURRENT_TIMESTAMP
        ''', (
            entreprise_id, entreprise_nom, schema_name, feature, product_type,
            today.year, today.month,
            tokens_input, tokens_output, tokens_total, estimated_cost
        ))

        # 4. Deduction automatique des credits prepayes si le cout mensuel depasse le montant inclus
        if entreprise_id and estimated_cost > 0:
            try:
                cursor.execute('''
                    SELECT COALESCE(SUM(total_cost_usd), 0) AS total_cost
                    FROM ai_usage_monthly
                    WHERE entreprise_id = %s AND usage_year = %s AND usage_month = %s
                    AND product_type = %s
                ''', (entreprise_id, today.year, today.month, product_type))
                mc_row = cursor.fetchone()
                monthly_cost_after = float(mc_row['total_cost']) if mc_row else 0.0

                cursor.execute('''
                    SELECT monthly_limit_usd FROM ai_billing_limits
                    WHERE entreprise_id = %s AND product_type = %s
                ''', (entreprise_id, product_type))
                bl_row = cursor.fetchone()
                if bl_row:
                    included = float(bl_row['monthly_limit_usd'])
                elif product_type == PRODUCT_TYPE_EXPERTS_IA:
                    included = DEFAULT_MONTHLY_LIMIT_EXPERTS_IA
                else:
                    included = DEFAULT_MONTHLY_LIMIT_ERP

                if monthly_cost_after > included:
                    # Ne deduire que la portion excedentaire (pas le cout complet)
                    # Ex: seuil 10$, cout mensuel apres 10.30$, cout requete 0.80$ -> deduire 0.30$
                    overage = min(estimated_cost, monthly_cost_after - included)
                    if overage > 0:
                        # Deduction FIFO: deduire du solde le plus ancien avec balance > 0
                        cursor.execute('''
                            UPDATE ai_prepaid_credits
                            SET balance_usd = balance_usd - %s,
                                total_consumed_usd = total_consumed_usd + %s,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = (
                                SELECT id FROM ai_prepaid_credits
                                WHERE entreprise_id = %s AND product_type = %s
                                AND balance_usd > 0
                                ORDER BY billing_year, billing_month
                                LIMIT 1
                            )
                        ''', (overage, overage, entreprise_id, product_type))
            except Exception as deduct_err:
                logger.warning(f"[AI_USAGE] Deduction prepaid non bloquante: {deduct_err}")

        conn.commit()
        logger.debug(f"[AI_USAGE] Tracked: {feature} - {tokens_total} tokens - {entreprise_nom or 'Unknown'}")

        return True

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur tracking: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


def get_daily_usage(
    entreprise_id: int = None,
    feature: str = None,
    start_date: date = None,
    end_date: date = None,
    product_type: str = None
) -> List[Dict]:
    """
    Recupere l'utilisation journaliere.

    Args:
        entreprise_id: Filtrer par entreprise (optionnel)
        feature: Filtrer par fonctionnalite (optionnel)
        start_date: Date de debut (defaut: 30 derniers jours)
        end_date: Date de fin (defaut: aujourd'hui)
        product_type: Filtrer par type de produit (ERP, EXPERTS_IA, ou None pour tout)

    Returns:
        Liste des utilisations journalieres
    """
    if not start_date:
        start_date = date.today() - timedelta(days=30)
    if not end_date:
        end_date = date.today()

    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        query = '''
            SELECT
                entreprise_id, entreprise_nom, schema_name, feature, usage_date,
                total_requests, total_tokens_input, total_tokens_output,
                total_tokens, total_cost_usd
            FROM ai_usage_daily
            WHERE usage_date BETWEEN %s AND %s
        '''
        params = [start_date, end_date]

        if product_type:
            query += ' AND product_type = %s'
            params.append(product_type)

        if entreprise_id:
            query += ' AND entreprise_id = %s'
            params.append(entreprise_id)

        if feature:
            query += ' AND feature = %s'
            params.append(feature)

        query += ' ORDER BY usage_date DESC, entreprise_nom'

        cursor.execute(query, params)
        results = cursor.fetchall()

        usage_list = []
        for row in results:
            if isinstance(row, dict):
                usage_list.append({
                    'entreprise_id': row['entreprise_id'],
                    'entreprise_nom': row['entreprise_nom'],
                    'schema_name': row['schema_name'],
                    'feature': row['feature'],
                    'usage_date': row['usage_date'],
                    'total_requests': int(row['total_requests'] or 0),
                    'total_tokens_input': int(row['total_tokens_input'] or 0),
                    'total_tokens_output': int(row['total_tokens_output'] or 0),
                    'total_tokens': int(row['total_tokens'] or 0),
                    'total_cost_usd': float(row['total_cost_usd'] or 0)
                })
            else:
                usage_list.append({
                    'entreprise_id': row[0],
                    'entreprise_nom': row[1],
                    'schema_name': row[2],
                    'feature': row[3],
                    'usage_date': row[4],
                    'total_requests': int(row[5] or 0),
                    'total_tokens_input': int(row[6] or 0),
                    'total_tokens_output': int(row[7] or 0),
                    'total_tokens': int(row[8] or 0),
                    'total_cost_usd': float(row[9]) if row[9] else 0
                })

        return usage_list

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur get_daily_usage: {e}")
        return []
    finally:
        conn.close()


def get_monthly_usage(
    entreprise_id: int = None,
    feature: str = None,
    year: int = None,
    month: int = None,
    product_type: str = None
) -> List[Dict]:
    """
    Recupere l'utilisation mensuelle.

    Args:
        entreprise_id: Filtrer par entreprise (optionnel)
        feature: Filtrer par fonctionnalite (optionnel)
        year: Annee (defaut: annee courante)
        month: Mois (optionnel, si non specifie retourne tous les mois de l'annee)
        product_type: Filtrer par type de produit (ERP, EXPERTS_IA, ou None pour tout)

    Returns:
        Liste des utilisations mensuelles
    """
    if not year:
        year = date.today().year

    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        query = '''
            SELECT
                entreprise_id, entreprise_nom, schema_name, feature,
                usage_year, usage_month,
                total_requests, total_tokens_input, total_tokens_output,
                total_tokens, total_cost_usd
            FROM ai_usage_monthly
            WHERE usage_year = %s
        '''
        params = [year]

        if month:
            query += ' AND usage_month = %s'
            params.append(month)

        if product_type:
            query += ' AND product_type = %s'
            params.append(product_type)

        if entreprise_id:
            query += ' AND entreprise_id = %s'
            params.append(entreprise_id)

        if feature:
            query += ' AND feature = %s'
            params.append(feature)

        query += ' ORDER BY usage_year DESC, usage_month DESC, entreprise_nom'

        cursor.execute(query, params)
        results = cursor.fetchall()

        usage_list = []
        for row in results:
            if isinstance(row, dict):
                usage_list.append({
                    'entreprise_id': row['entreprise_id'],
                    'entreprise_nom': row['entreprise_nom'],
                    'schema_name': row['schema_name'],
                    'feature': row['feature'],
                    'usage_year': row['usage_year'],
                    'usage_month': row['usage_month'],
                    'total_requests': int(row['total_requests'] or 0),
                    'total_tokens_input': int(row['total_tokens_input'] or 0),
                    'total_tokens_output': int(row['total_tokens_output'] or 0),
                    'total_tokens': int(row['total_tokens'] or 0),
                    'total_cost_usd': float(row['total_cost_usd'] or 0)
                })
            else:
                usage_list.append({
                    'entreprise_id': row[0],
                    'entreprise_nom': row[1],
                    'schema_name': row[2],
                    'feature': row[3],
                    'usage_year': row[4],
                    'usage_month': row[5],
                    'total_requests': int(row[6] or 0),
                    'total_tokens_input': int(row[7] or 0),
                    'total_tokens_output': int(row[8] or 0),
                    'total_tokens': int(row[9] or 0),
                    'total_cost_usd': float(row[10]) if row[10] else 0
                })

        return usage_list

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur get_monthly_usage: {e}")
        return []
    finally:
        conn.close()


def get_company_summary(entreprise_id: int = None, month: int = None, year: int = None, product_type: str = None) -> List[Dict]:
    """
    Recupere un resume d'utilisation par entreprise pour le mois courant ou specifie.

    Args:
        entreprise_id: Filtrer par entreprise (optionnel)
        month: Mois (defaut: mois courant)
        year: Annee (defaut: annee courante)
        product_type: Filtrer par type de produit (ERP, EXPERTS_IA, ou None pour tout)

    Returns:
        Liste des resumes par entreprise
    """
    if not year:
        year = date.today().year
    if not month:
        month = date.today().month

    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        query = '''
            SELECT
                entreprise_id,
                entreprise_nom,
                schema_name,
                SUM(total_requests) as total_requests,
                SUM(total_tokens) as total_tokens,
                SUM(total_cost_usd) as total_cost_usd,
                STRING_AGG(DISTINCT feature, ', ') as features_used
            FROM ai_usage_monthly
            WHERE usage_year = %s AND usage_month = %s
        '''
        params = [year, month]

        if product_type:
            query += ' AND product_type = %s'
            params.append(product_type)

        if entreprise_id:
            query += ' AND entreprise_id = %s'
            params.append(entreprise_id)

        query += ' GROUP BY entreprise_id, entreprise_nom, schema_name'
        query += ' ORDER BY total_cost_usd DESC'

        cursor.execute(query, params)
        results = cursor.fetchall()

        summaries = []
        for row in results:
            if isinstance(row, dict):
                summaries.append({
                    'entreprise_id': row['entreprise_id'],
                    'entreprise_nom': row['entreprise_nom'],
                    'schema_name': row['schema_name'],
                    'total_requests': int(row['total_requests'] or 0),
                    'total_tokens': int(row['total_tokens'] or 0),
                    'total_cost_usd': float(row['total_cost_usd'] or 0),
                    'features_used': row['features_used'] or ''
                })
            else:
                summaries.append({
                    'entreprise_id': row[0],
                    'entreprise_nom': row[1],
                    'schema_name': row[2],
                    'total_requests': int(row[3] or 0),
                    'total_tokens': int(row[4] or 0),
                    'total_cost_usd': float(row[5]) if row[5] else 0,
                    'features_used': row[6] or ''
                })

        return summaries

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur get_company_summary: {e}")
        return []
    finally:
        conn.close()


def get_global_stats(month: int = None, year: int = None, product_type: str = None) -> Dict:
    """
    Recupere les statistiques globales d'utilisation IA.

    Args:
        month: Mois (defaut: mois courant)
        year: Annee (defaut: annee courante)
        product_type: Filtrer par type de produit (ERP, EXPERTS_IA, ou None pour tout)

    Returns:
        Dictionnaire avec statistiques globales
    """
    if not year:
        year = date.today().year
    if not month:
        month = date.today().month

    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        # Stats du mois
        query_monthly = '''
            SELECT
                COUNT(DISTINCT entreprise_id) as companies_using,
                SUM(total_requests) as total_requests,
                SUM(total_tokens) as total_tokens,
                SUM(total_cost_usd) as total_cost_usd
            FROM ai_usage_monthly
            WHERE usage_year = %s AND usage_month = %s
        '''
        params_monthly = [year, month]

        if product_type:
            query_monthly += ' AND product_type = %s'
            params_monthly.append(product_type)

        cursor.execute(query_monthly, params_monthly)

        row = cursor.fetchone()
        if row:
            if isinstance(row, dict):
                monthly_stats = {
                    'companies_using': int(row['companies_using'] or 0),
                    'total_requests': int(row['total_requests'] or 0),
                    'total_tokens': int(row['total_tokens'] or 0),
                    'total_cost_usd': float(row['total_cost_usd'] or 0)
                }
            else:
                monthly_stats = {
                    'companies_using': int(row[0] or 0),
                    'total_requests': int(row[1] or 0),
                    'total_tokens': int(row[2] or 0),
                    'total_cost_usd': float(row[3]) if row[3] else 0
                }
        else:
            monthly_stats = {
                'companies_using': 0,
                'total_requests': 0,
                'total_tokens': 0,
                'total_cost_usd': 0
            }

        # Stats par feature
        query_feature = '''
            SELECT
                feature,
                SUM(total_requests) as requests,
                SUM(total_tokens) as tokens,
                SUM(total_cost_usd) as cost
            FROM ai_usage_monthly
            WHERE usage_year = %s AND usage_month = %s
        '''
        params_feature = [year, month]

        if product_type:
            query_feature += ' AND product_type = %s'
            params_feature.append(product_type)

        query_feature += ' GROUP BY feature ORDER BY cost DESC'

        cursor.execute(query_feature, params_feature)

        by_feature = []
        for row in cursor.fetchall():
            if isinstance(row, dict):
                by_feature.append({
                    'feature': row['feature'],
                    'requests': int(row['requests'] or 0),
                    'tokens': int(row['tokens'] or 0),
                    'cost': float(row['cost'] or 0)
                })
            else:
                by_feature.append({
                    'feature': row[0],
                    'requests': int(row[1] or 0),
                    'tokens': int(row[2] or 0),
                    'cost': float(row[3]) if row[3] else 0
                })

        # Stats aujourd'hui
        today = date.today()
        query_today = '''
            SELECT
                COUNT(DISTINCT entreprise_id) as companies_today,
                SUM(total_requests) as requests_today,
                SUM(total_tokens) as tokens_today,
                SUM(total_cost_usd) as cost_today
            FROM ai_usage_daily
            WHERE usage_date = %s
        '''
        params_today = [today]

        if product_type:
            query_today += ' AND product_type = %s'
            params_today.append(product_type)

        cursor.execute(query_today, params_today)

        row = cursor.fetchone()
        if row:
            if isinstance(row, dict):
                today_stats = {
                    'companies_today': int(row['companies_today'] or 0),
                    'requests_today': int(row['requests_today'] or 0),
                    'tokens_today': int(row['tokens_today'] or 0),
                    'cost_today': float(row['cost_today'] or 0)
                }
            else:
                today_stats = {
                    'companies_today': int(row[0] or 0),
                    'requests_today': int(row[1] or 0),
                    'tokens_today': int(row[2] or 0),
                    'cost_today': float(row[3]) if row[3] else 0
                }
        else:
            today_stats = {
                'companies_today': 0,
                'requests_today': 0,
                'tokens_today': 0,
                'cost_today': 0
            }

        return {
            'month': month,
            'year': year,
            'monthly': monthly_stats,
            'today': today_stats,
            'by_feature': by_feature
        }

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur get_global_stats: {e}")
        return {
            'month': month,
            'year': year,
            'monthly': {'companies_using': 0, 'total_requests': 0, 'total_tokens': 0, 'total_cost_usd': 0},
            'today': {'companies_today': 0, 'requests_today': 0, 'tokens_today': 0, 'cost_today': 0},
            'by_feature': []
        }
    finally:
        conn.close()


def get_recent_usage(limit: int = 50, product_type: str = None) -> List[Dict]:
    """
    Recupere les utilisations recentes (pour monitoring).

    Args:
        limit: Nombre maximum d'enregistrements
        product_type: Filtrer par type de produit (ERP, EXPERTS_IA, ou None pour tout)

    Returns:
        Liste des utilisations recentes
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        query = '''
            SELECT
                id, entreprise_id, entreprise_nom, schema_name,
                user_id, username, feature, product_type,
                tokens_input, tokens_output, tokens_total,
                estimated_cost_usd, model, created_at
            FROM ai_usage_tracking
        '''
        params = []

        if product_type:
            query += ' WHERE product_type = %s'
            params.append(product_type)

        query += ' ORDER BY created_at DESC LIMIT %s'
        params.append(limit)

        cursor.execute(query, params)

        results = cursor.fetchall()

        usage_list = []
        for row in results:
            if isinstance(row, dict):
                usage_list.append({
                    'id': row['id'],
                    'entreprise_id': row['entreprise_id'],
                    'entreprise_nom': row['entreprise_nom'],
                    'schema_name': row['schema_name'],
                    'user_id': row['user_id'],
                    'username': row['username'],
                    'feature': row['feature'],
                    'product_type': row['product_type'],
                    'tokens_input': int(row['tokens_input'] or 0),
                    'tokens_output': int(row['tokens_output'] or 0),
                    'tokens_total': int(row['tokens_total'] or 0),
                    'estimated_cost_usd': float(row['estimated_cost_usd'] or 0),
                    'model_used': row['model'],
                    'created_at': row['created_at']
                })
            else:
                usage_list.append({
                    'id': row[0],
                    'entreprise_id': row[1],
                    'entreprise_nom': row[2],
                    'schema_name': row[3],
                    'user_id': row[4],
                    'username': row[5],
                    'feature': row[6],
                    'product_type': row[7],
                    'tokens_input': int(row[8] or 0),
                    'tokens_output': int(row[9] or 0),
                    'tokens_total': int(row[10] or 0),
                    'estimated_cost_usd': float(row[11]) if row[11] else 0,
                    'model_used': row[12],
                    'created_at': row[13]
                })

        return usage_list

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur get_recent_usage: {e}")
        return []
    finally:
        conn.close()


def get_billing_limit(entreprise_id: int, product_type: str = 'ERP') -> float:
    """
    Recupere la limite mensuelle pour une entreprise et un produit.
    Retourne la limite personnalisee si elle existe, sinon la limite par defaut.
    """
    default = DEFAULT_MONTHLY_LIMIT_ERP if product_type == 'ERP' else DEFAULT_MONTHLY_LIMIT_EXPERTS_IA

    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")
        cursor.execute('''
            SELECT monthly_limit_usd FROM ai_billing_limits
            WHERE entreprise_id = %s AND product_type = %s
        ''', (entreprise_id, product_type))

        row = cursor.fetchone()
        if row:
            return float(row[0]) if not isinstance(row, dict) else float(row['monthly_limit_usd'])

        return default

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur get_billing_limit: {e}")
        return default
    finally:
        conn.close()


def set_billing_limit(entreprise_id: int, product_type: str, monthly_limit_usd: float, entreprise_nom: str = None) -> bool:
    """
    Definit une limite mensuelle personnalisee pour une entreprise.
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")
        cursor.execute('''
            INSERT INTO ai_billing_limits (entreprise_id, entreprise_nom, product_type, monthly_limit_usd)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (entreprise_id, product_type) DO UPDATE SET
                monthly_limit_usd = EXCLUDED.monthly_limit_usd,
                entreprise_nom = COALESCE(EXCLUDED.entreprise_nom, ai_billing_limits.entreprise_nom),
                updated_at = CURRENT_TIMESTAMP
        ''', (entreprise_id, entreprise_nom, product_type, monthly_limit_usd))

        conn.commit()
        return True

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur set_billing_limit: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


def get_companies_over_limit(month: int = None, year: int = None) -> List[Dict]:
    """
    Recupere toutes les entreprises qui depassent leur limite mensuelle.
    Retourne les infos de depassement pour ERP et EXPERTS IA separement.

    Returns:
        Liste de dicts avec: entreprise_id, entreprise_nom, product_type,
        total_cost_usd, monthly_limit, overage_amount, usage_percent
    """
    if not year:
        year = date.today().year
    if not month:
        month = date.today().month

    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        # Recuperer le cout mensuel par entreprise et par produit
        cursor.execute('''
            SELECT
                entreprise_id,
                entreprise_nom,
                product_type,
                SUM(total_cost_usd) as total_cost_usd,
                SUM(total_requests) as total_requests
            FROM ai_usage_monthly
            WHERE usage_year = %s AND usage_month = %s
                AND entreprise_id IS NOT NULL
            GROUP BY entreprise_id, entreprise_nom, product_type
            ORDER BY total_cost_usd DESC
        ''', (year, month))

        results = cursor.fetchall()

        # Recuperer toutes les limites personnalisees
        cursor.execute('SELECT entreprise_id, product_type, monthly_limit_usd FROM ai_billing_limits')
        custom_limits = {}
        for row in cursor.fetchall():
            if isinstance(row, dict):
                key = (row['entreprise_id'], row['product_type'])
                custom_limits[key] = float(row['monthly_limit_usd'])
            else:
                key = (row[0], row[1])
                custom_limits[key] = float(row[2])

        companies = []
        for row in results:
            if isinstance(row, dict):
                eid = row['entreprise_id']
                enom = row['entreprise_nom']
                ptype = row['product_type']
                cost = float(row['total_cost_usd']) if row['total_cost_usd'] else 0
                requests = row['total_requests'] or 0
            else:
                eid = row[0]
                enom = row[1]
                ptype = row[2]
                cost = float(row[3]) if row[3] else 0
                requests = row[4] or 0

            # Determiner la limite applicable
            if (eid, ptype) in custom_limits:
                limit_usd = custom_limits[(eid, ptype)]
            elif ptype == PRODUCT_TYPE_EXPERTS_IA:
                limit_usd = DEFAULT_MONTHLY_LIMIT_EXPERTS_IA
            else:
                limit_usd = DEFAULT_MONTHLY_LIMIT_ERP

            overage = max(0, cost - limit_usd)
            usage_pct = (cost / limit_usd * 100) if limit_usd > 0 else 0

            companies.append({
                'entreprise_id': eid,
                'entreprise_nom': enom or 'N/A',
                'product_type': ptype or 'ERP',
                'total_cost_usd': cost,
                'total_requests': requests,
                'monthly_limit': limit_usd,
                'overage_amount': overage,
                'usage_percent': usage_pct
            })

        return companies

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur get_companies_over_limit: {e}")
        return []
    finally:
        conn.close()


def get_today_cost(entreprise_id: int, product_type: str = None) -> float:
    """
    Recupere le cout IA total pour aujourd'hui pour une entreprise.
    Somme toutes les features du jour pour le product_type donne (ou tous).

    Returns:
        Cout total en USD pour aujourd'hui
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        query = '''
            SELECT COALESCE(SUM(total_cost_usd), 0)
            FROM ai_usage_daily
            WHERE entreprise_id = %s AND usage_date = %s
        '''
        params = [entreprise_id, date.today()]

        if product_type:
            query += ' AND product_type = %s'
            params.append(product_type)

        cursor.execute(query, params)
        row = cursor.fetchone()

        if row:
            return float(row[0]) if not isinstance(row, dict) else float(row[list(row.keys())[0]])
        return 0.0

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur get_today_cost: {e}")
        return 0.0
    finally:
        conn.close()


def get_trial_daily_limit(entreprise_id: int) -> float:
    """
    Recupere la limite quotidienne pour un tenant en essai.
    Retourne la limite personnalisee si elle existe, sinon DEFAULT_TRIAL_DAILY_LIMIT.
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")
        cursor.execute('''
            SELECT trial_daily_limit_usd FROM ai_billing_limits
            WHERE entreprise_id = %s
            LIMIT 1
        ''', (entreprise_id,))

        row = cursor.fetchone()
        if row:
            val = row[0] if not isinstance(row, dict) else row.get('trial_daily_limit_usd')
            if val is not None:
                return float(val)

        return DEFAULT_TRIAL_DAILY_LIMIT

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur get_trial_daily_limit: {e}")
        return DEFAULT_TRIAL_DAILY_LIMIT
    finally:
        conn.close()


def set_trial_daily_limit(entreprise_id: int, daily_limit_usd: float, entreprise_nom: str = None) -> bool:
    """
    Definit la limite quotidienne pour les essais d'une entreprise.
    Met a jour toutes les lignes de cette entreprise dans ai_billing_limits,
    ou en cree une par defaut (product_type ERP) si aucune n'existe.
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")

        # Verifier si l'entreprise a deja des lignes
        cursor.execute(
            'SELECT COUNT(*) FROM ai_billing_limits WHERE entreprise_id = %s',
            (entreprise_id,)
        )
        row = cursor.fetchone()
        count = int(row[0]) if not isinstance(row, dict) else int(row[list(row.keys())[0]])

        if count > 0:
            # Mettre a jour toutes les lignes de cette entreprise
            cursor.execute('''
                UPDATE ai_billing_limits
                SET trial_daily_limit_usd = %s, updated_at = CURRENT_TIMESTAMP
                WHERE entreprise_id = %s
            ''', (daily_limit_usd, entreprise_id))
        else:
            # Creer une ligne par defaut
            cursor.execute('''
                INSERT INTO ai_billing_limits (entreprise_id, entreprise_nom, product_type, monthly_limit_usd, trial_daily_limit_usd)
                VALUES (%s, %s, 'ERP', %s, %s)
            ''', (entreprise_id, entreprise_nom, DEFAULT_MONTHLY_LIMIT_ERP, daily_limit_usd))

        conn.commit()
        return True

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur set_trial_daily_limit: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


def _get_subscription_status(entreprise_id: int) -> Optional[str]:
    """
    Recupere le statut d'abonnement Stripe d'une entreprise depuis la table public.entreprises.
    Retourne 'trialing', 'active', 'canceled', etc. ou None si non trouve.
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET search_path TO public")
        cursor.execute(
            'SELECT subscription_status FROM entreprises WHERE id = %s',
            (entreprise_id,)
        )
        row = cursor.fetchone()
        if row:
            return row[0] if not isinstance(row, dict) else row.get('subscription_status')
        return None

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur _get_subscription_status: {e}")
        return None
    finally:
        conn.close()


def get_current_month_cost(entreprise_id: int, product_type: str = None) -> float:
    """
    Recupere le cout IA total du mois courant pour une entreprise.
    Somme toutes les features du mois pour le product_type donne (ou tous).
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SET search_path TO public")
        today = date.today()
        query = '''
            SELECT COALESCE(SUM(total_cost_usd), 0) AS total_cost
            FROM ai_usage_monthly
            WHERE entreprise_id = %s AND usage_year = %s AND usage_month = %s
        '''
        params = [entreprise_id, today.year, today.month]
        if product_type:
            query += ' AND product_type = %s'
            params.append(product_type)
        cursor.execute(query, params)
        row = cursor.fetchone()
        if not row:
            return 0.0
        return float(row['total_cost']) if isinstance(row, dict) else float(row[0])
    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur get_current_month_cost: {e}")
        return 0.0
    finally:
        conn.close()


def get_prepaid_balance(entreprise_id: int, product_type: str = None) -> float:
    """
    Recupere le solde TOTAL de credits prepayes IA (tous mois confondus).
    Les credits non utilises des mois precedents sont reportes (rollover).
    Retourne 0.0 si aucun credit disponible.
    """
    if product_type is None:
        product_type = get_entreprise_product_type(entreprise_id)
    conn = database_config.get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SET search_path TO public")
        cursor.execute('''
            SELECT COALESCE(SUM(balance_usd), 0) AS total_balance
            FROM ai_prepaid_credits
            WHERE entreprise_id = %s AND product_type = %s
        ''', (entreprise_id, product_type))
        row = cursor.fetchone()
        if row:
            return float(row[0]) if not isinstance(row, dict) else float(row['total_balance'])
        return 0.0
    except Exception as e:
        logger.error(f"[AI_CREDITS] Erreur get_prepaid_balance: {e}")
        return 0.0
    finally:
        conn.close()


def add_prepaid_credit(entreprise_id: int, product_type: str, amount: float,
                       stripe_id: str = None, entreprise_nom: str = None) -> bool:
    """
    Ajoute un credit prepaye apres une charge Stripe reussie.
    Cree la ligne si elle n'existe pas pour le mois courant, sinon ajoute au solde.
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SET search_path TO public")
        # Ensure the UNIQUE constraint exists before the ON CONFLICT upsert.
        # The table may have been created by a code path that omitted the constraint.
        cursor.execute('''
            CREATE UNIQUE INDEX IF NOT EXISTS
            uq_ai_prepaid_credits_ent_prod_year_month
            ON ai_prepaid_credits
            (entreprise_id, product_type, billing_year, billing_month)
        ''')
        today = date.today()
        cursor.execute('''
            INSERT INTO ai_prepaid_credits (
                entreprise_id, entreprise_nom, product_type,
                balance_usd, total_charged_usd, charges_count,
                last_charge_stripe_id, last_charge_at,
                billing_year, billing_month
            ) VALUES (%s, %s, %s, %s, %s, 1, %s, CURRENT_TIMESTAMP, %s, %s)
            ON CONFLICT (entreprise_id, product_type, billing_year, billing_month)
            DO UPDATE SET
                balance_usd = ai_prepaid_credits.balance_usd + EXCLUDED.balance_usd,
                total_charged_usd = ai_prepaid_credits.total_charged_usd + EXCLUDED.total_charged_usd,
                charges_count = ai_prepaid_credits.charges_count + 1,
                last_charge_stripe_id = EXCLUDED.last_charge_stripe_id,
                last_charge_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
        ''', (entreprise_id, entreprise_nom, product_type, amount, amount,
              stripe_id, today.year, today.month))
        conn.commit()
        logger.info(f"[AI_CREDITS] +{amount:.2f}$ credit ajoute pour entreprise {entreprise_id} ({product_type})")
        return True
    except Exception as e:
        logger.error(f"[AI_CREDITS] Erreur add_prepaid_credit: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


def deduct_prepaid_credit(entreprise_id: int, product_type: str, amount: float) -> bool:
    """
    Deduit un montant du solde de credits prepayes.
    Deduction FIFO: commence par le mois le plus ancien avec solde positif (rollover).
    """
    conn = database_config.get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SET search_path TO public")
        remaining = amount
        # Lock rows with FOR UPDATE to prevent concurrent reads of stale balances
        cursor.execute('''
            SELECT id, balance_usd FROM ai_prepaid_credits
            WHERE entreprise_id = %s AND product_type = %s AND balance_usd > 0
            ORDER BY billing_year, billing_month
            FOR UPDATE
        ''', (entreprise_id, product_type))
        rows = cursor.fetchall()
        for row in rows:
            if remaining <= 0:
                break
            credit_id = row[0] if not isinstance(row, dict) else row['id']
            balance = float(row[1] if not isinstance(row, dict) else row['balance_usd'])
            deduction = min(remaining, balance)
            # Atomic update with GREATEST to prevent negative balance
            cursor.execute('''
                UPDATE ai_prepaid_credits
                SET balance_usd = GREATEST(0, balance_usd - %s),
                    total_consumed_usd = total_consumed_usd + %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = %s AND balance_usd > 0
                RETURNING balance_usd
            ''', (deduction, deduction, credit_id))
            result = cursor.fetchone()
            if result is not None:
                # Row was updated; compute actual deduction from returned balance
                new_balance = float(result[0] if not isinstance(result, dict) else result['balance_usd'])
                remaining -= (balance - new_balance)
            # If result is None, row was already drained by another path; skip it
        conn.commit()
        return remaining <= 0
    except Exception as e:
        logger.error(f"[AI_CREDITS] Erreur deduct_prepaid_credit: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


def check_ai_quota(entreprise_id: int, product_type: str = None) -> Dict:
    """
    Verifie si une entreprise peut utiliser l'IA.

    Logique unifiee (tous les comptes):
    - Aucune IA gratuite incluse dans aucun forfait
    - Le client doit avoir des credits prepayes pour utiliser l'IA
    - Si solde insuffisant, une recharge Stripe de 10$ est necessaire

    Args:
        entreprise_id: ID de l'entreprise
        product_type: Type de produit (ERP ou EXPERTS_IA) — auto-detecte si None

    Returns:
        Dict avec:
            - allowed (bool): True si l'utilisation IA est permise
            - is_trial (bool): True si l'entreprise est en essai
            - needs_prepaid_charge (bool): True si une recharge Stripe est necessaire
            - monthly_cost (float): Cout IA du mois en USD
            - included_limit (float): Toujours 0 (aucune IA incluse)
            - prepaid_balance (float): Solde de credits prepayes en USD
            - daily_cost (float): Cout IA du jour en USD
            - daily_limit (float): Toujours 0 (pas de limite gratuite)
            - remaining (float): Credits prepayes restants
            - message (str): Message a afficher si bloque (vide si autorise)
    """
    try:
        # Auto-detection du product_type depuis la table entreprises
        if product_type is None:
            product_type = get_entreprise_product_type(entreprise_id)

        # Recuperer le statut d'abonnement
        status = _get_subscription_status(entreprise_id)
        is_trial = (status == 'trialing')

        monthly_cost = get_current_month_cost(entreprise_id, product_type)
        daily_cost = get_today_cost(entreprise_id, product_type)

        # ---- LOGIQUE UNIFIEE: credits prepayes obligatoires pour tous ----
        balance = get_prepaid_balance(entreprise_id, product_type)

        if balance > 0:
            # A des credits prepayes — autoriser
            return {
                'allowed': True,
                'is_trial': is_trial,
                'needs_prepaid_charge': False,
                'monthly_cost': round(monthly_cost, 4),
                'included_limit': 0.0,
                'prepaid_balance': round(balance, 4),
                'daily_cost': round(daily_cost, 4),
                'daily_limit': 0.0,
                'remaining': round(balance, 4),
                'message': ''
            }

        # Aucun credit — une recharge est necessaire AVANT l'appel IA
        trial_msg = ""
        return {
            'allowed': False,
            'is_trial': is_trial,
            'needs_prepaid_charge': True,
            'monthly_cost': round(monthly_cost, 4),
            'included_limit': 0.0,
            'prepaid_balance': 0.0,
            'daily_cost': round(daily_cost, 4),
            'daily_limit': 0.0,
            'remaining': 0.0,
            'message': (
                f"Credits IA insuffisants. "
                f"Une recharge de {PREPAID_CREDIT_AMOUNT:.2f}$ sera facturee a votre carte pour continuer."
                f"{trial_msg}"
            )
        }

    except Exception as e:
        logger.error(f"[AI_USAGE] Erreur check_ai_quota: {e}")
        # En cas d'erreur, bloquer par defaut (fail-closed) pour eviter l'utilisation non-payee
        return {
            'allowed': False,
            'is_trial': False,
            'needs_prepaid_charge': True,
            'monthly_cost': 0.0,
            'included_limit': 0.0,
            'prepaid_balance': 0.0,
            'daily_cost': 0.0,
            'daily_limit': 0.0,
            'remaining': 0.0,
            'message': "Erreur de verification des credits IA. Veuillez reessayer."
        }


def get_feature_label(feature: str) -> str:
    """Retourne le libelle francais d'une fonctionnalite."""
    labels = {
        # ERP
        'devis_estimation': 'Devis - Estimation IA',
        'assistant_ia': 'Assistant IA',
        'document_analyzer': 'Analyse de documents',
        'web_search': 'Recherche Web IA',
        'gantt_optimization': 'Optimisation Gantt',
        'gantt_analyze': 'Analyse Gantt',
        # ERP - Modules Projets / Entreprises / Contacts
        'projets_chat': 'Chat Projets IA',
        'projets_analyse': 'Analyse Projets IA',
        'projets_concept': 'Concepts Projets IA',
        'entreprises_chat': 'Chat Entreprises IA',
        'entreprises_analyse': 'Analyse Entreprises IA',
        'entreprises_concept': 'Concepts Entreprises IA',
        'contacts_chat': 'Chat Contacts IA',
        'contacts_analyse': 'Analyse Contacts IA',
        'contacts_concept': 'Concepts Contacts IA',
        'kanban_chat': 'Chat Kanban IA',
        'kanban_analyse': 'Analyse Kanban IA',
        'immobilier_analyse': 'Analyse Immobilier IA',
        'immobilier_chat': 'Chat Immobilier IA',
        'immobilier_rapport': 'Rapport Immobilier IA',
        'immobilier_financement': 'Financement Immobilier IA',
        'document_analyzer': 'Analyse de Documents IA',
        'plan_analyse': 'Analyse de Plans IA',
        'plan_analyse_fabrication': 'Analyse Plans Fabrication IA',
        'metal_weight_chat': 'Chat Calcul Metal IA',
        'agent_pipeline': 'Pipeline Multi-Agent IA',
        # EXPERTS IA
        'experts_conversation': 'Conversation Expert',
        'experts_document_analysis': 'Analyse de Documents',
        'experts_web_search': 'Recherche Web',
        'experts_web_fetch': 'Extraction Web',
        'experts_memory_conversation': 'Conversation avec Mémoire',
        'experts_soumission_extraction': 'Extraction Soumission',
        'experts_pdf_import': 'Import PDF IA',
    }
    return labels.get(feature, feature)


# Initialiser les tables au chargement du module
try:
    init_ai_usage_table()
except Exception as e:
    logger.warning(f"[AI_USAGE] Impossible d'initialiser les tables: {e}")
