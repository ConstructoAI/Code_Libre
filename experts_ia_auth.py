"""
Gestionnaire d'authentification pour EXPERTS IA - Multi-Tenant
Module pour les abonnés EXPERTS IA (49.99$/mois)

Architecture Multi-Tenant:
- Table 'entreprises' dans le schéma public avec product_type='EXPERTS_IA'
- Schéma dédié 'tenant_XXX' pour chaque entreprise EXPERTS IA
- Authentification par email + mot de passe
- Intégration Stripe pour les abonnements
"""

import os
import logging
import bcrypt
import secrets
import string
from datetime import datetime
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

# Import de database_config et tenant_manager
import database_config
from tenant_manager import get_tenant_manager, set_current_tenant


def init_experts_ia_tables():
    """
    Initialise les tables système pour EXPERTS IA
    Appelle init_system_tables du tenant_manager pour s'assurer que
    les colonnes product_type, stripe_customer_id, etc. existent.
    """
    try:
        tm = get_tenant_manager()
        tm.init_system_tables()
        logger.info("Tables système EXPERTS IA initialisées")
        return True
    except Exception as e:
        logger.error(f"Erreur initialisation tables EXPERTS IA: {e}")
        return False


def generate_temp_password(length: int = 12) -> str:
    """Génère un mot de passe temporaire sécurisé"""
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def hash_password(password: str) -> str:
    """Hash un mot de passe avec bcrypt (14 rounds)"""
    salt = bcrypt.gensalt(rounds=14)
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    """Vérifie un mot de passe contre son hash"""
    try:
        # Vérifier que le hash est un hash bcrypt valide (commence par $2)
        if not password_hash or not password_hash.startswith('$2'):
            logger.error(f"Hash invalide (pas bcrypt): {password_hash[:20] if password_hash else 'None'}...")
            return False
        return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))
    except Exception as e:
        logger.error(f"Erreur vérification mot de passe: {e}")
        return False


def create_experts_ia_user(
    email: str,
    password: str,
    company_name: str = None,
    full_name: str = None,
    stripe_customer_id: str = None,
    stripe_subscription_id: str = None,
    representant_code: str = None,
    password_already_hashed: bool = False
) -> Optional[Dict[str, Any]]:
    """
    Crée un nouvel utilisateur/entreprise EXPERTS IA (Multi-Tenant)

    Args:
        email: Email de l'utilisateur (login)
        password: Mot de passe en clair (sera hashé)
        company_name: Nom de l'entreprise
        full_name: Nom complet (utilisé pour contact_nom)
        stripe_customer_id: ID client Stripe
        stripe_subscription_id: ID abonnement Stripe
        representant_code: Code du représentant Constructo AI

    Returns:
        Dict avec les infos utilisateur ou None si erreur
    """
    try:
        tm = get_tenant_manager()

        # Utiliser company_name ou dériver du domaine email
        nom = company_name or email.split('@')[0]

        # Créer l'entreprise avec le type EXPERTS_IA
        entreprise_id = tm.create_entreprise(
            nom=nom,
            password=password,
            email=email,
            telephone="",
            adresse="",
            representant_code=representant_code or "",
            type_industrie="SERVICES",
            product_type="EXPERTS_IA",
            stripe_customer_id=stripe_customer_id,
            stripe_subscription_id=stripe_subscription_id,
            password_already_hashed=password_already_hashed
        )

        # Sécurité: create_entreprise peut retourner un dict en cas de race condition
        if isinstance(entreprise_id, dict):
            entreprise_id = entreprise_id.get('entreprise_id', entreprise_id.get('id'))
        if not entreprise_id:
            logger.error(f"Échec création entreprise EXPERTS IA: {email}")
            return None

        # Récupérer les infos de l'entreprise créée
        conn = database_config.get_connection()
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")
        cursor.execute('''
            SELECT id, nom, email, schema_name, created_at
            FROM entreprises WHERE id = %s
        ''', (entreprise_id,))
        result = cursor.fetchone()
        conn.close()

        if not result:
            return None

        user = {
            'id': result['id'] if isinstance(result, dict) else result[0],
            'email': result['email'] if isinstance(result, dict) else result[2],
            'company_name': result['nom'] if isinstance(result, dict) else result[1],
            'schema_name': result['schema_name'] if isinstance(result, dict) else result[3],
            'created_at': result['created_at'] if isinstance(result, dict) else result[4]
        }

        logger.info(f"Entreprise EXPERTS IA créée: {email} (schéma: {user.get('schema_name')})")
        return user

    except Exception as e:
        logger.error(f"Erreur création utilisateur EXPERTS IA: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None


def authenticate_experts_ia_user(email: str, password: str) -> Optional[Dict[str, Any]]:
    """
    Authentifie un utilisateur EXPERTS IA (Multi-Tenant)

    Args:
        email: Email de l'utilisateur
        password: Mot de passe en clair

    Returns:
        Dict avec les infos utilisateur si authentifié, None sinon
    """
    conn = database_config.get_connection()
    if not conn:
        logger.error("Impossible de se connecter à la base de données")
        return None

    cursor = conn.cursor()

    try:
        # IMPORTANT: S'assurer qu'on est dans le schéma public
        cursor.execute("SET search_path TO public")

        # Rechercher l'entreprise EXPERTS_IA par email
        cursor.execute('''
            SELECT id, nom, email, password_hash, schema_name,
                   subscription_status, active, stripe_subscription_id,
                   stripe_customer_id, product_type
            FROM entreprises
            WHERE LOWER(email) = LOWER(%s)
        ''', (email.strip(),))

        result = cursor.fetchone()

        if not result:
            logger.warning(f"Entreprise EXPERTS IA non trouvée: {email}")
            conn.close()
            return None

        # Gérer tuple ou dict (selon le cursor)
        if isinstance(result, dict):
            entreprise_id = result.get('id')
            nom = result.get('nom')
            user_email = result.get('email')
            password_hash = result.get('password_hash')
            schema_name = result.get('schema_name')
            sub_status = result.get('subscription_status')
            active = result.get('active')
            stripe_sub_id = result.get('stripe_subscription_id')
            stripe_customer_id = result.get('stripe_customer_id')
            product_type = result.get('product_type')
        else:
            entreprise_id, nom, user_email, password_hash, schema_name, sub_status, active, stripe_sub_id, stripe_customer_id, product_type = result

        # Vérifier que c'est bien un compte EXPERTS_IA
        if product_type != 'EXPERTS_IA':
            logger.warning(f"Tentative de connexion EXPERTS IA avec compte {product_type}: {email}")
            conn.close()
            return None

        # Vérifier si le compte est actif
        if not active:
            logger.warning(f"Compte EXPERTS IA désactivé: {email}")
            conn.close()
            return None

        # Vérifier le mot de passe
        if not password_hash or not verify_password(password, password_hash):
            logger.warning(f"Mot de passe incorrect pour EXPERTS IA: {email}")
            conn.close()
            return None

        # Vérifier le statut de l'abonnement
        if sub_status and sub_status not in ('active', 'trialing', None):
            logger.warning(f"Abonnement EXPERTS IA inactif: {email} (status: {sub_status})")
            # On laisse quand même l'accès pour le moment mais on pourrait bloquer

        # Mettre à jour last_login (si la colonne existe)
        try:
            cursor.execute('''
                UPDATE entreprises
                SET updated_at = %s
                WHERE id = %s
            ''', (datetime.now(), entreprise_id))
            conn.commit()
        except Exception:
            pass  # Ignorer si erreur

        conn.close()

        user = {
            'id': entreprise_id,
            'email': user_email,
            'company_name': nom,
            'schema_name': schema_name,
            'subscription_status': sub_status,
            'stripe_subscription_id': stripe_sub_id,
            'stripe_customer_id': stripe_customer_id,
            'product_type': product_type
        }

        logger.info(f"Utilisateur EXPERTS IA authentifié: {email} (schéma: {schema_name})")
        return user

    except Exception as e:
        logger.error(f"Erreur authentification EXPERTS IA: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None
    finally:
        try:
            cursor.close()
            conn.close()
        except Exception:
            pass


def get_experts_ia_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Récupère une entreprise EXPERTS IA par son email"""
    conn = database_config.get_connection()
    if not conn:
        return None

    cursor = conn.cursor()

    try:
        # IMPORTANT: S'assurer qu'on est dans le schéma public
        cursor.execute("SET search_path TO public")

        cursor.execute('''
            SELECT id, nom, email, schema_name, subscription_status,
                   stripe_customer_id, stripe_subscription_id, active, created_at,
                   product_type
            FROM entreprises
            WHERE LOWER(email) = LOWER(%s)
        ''', (email.strip(),))

        result = cursor.fetchone()

        if not result:
            return None

        # Gérer tuple ou dict (selon le cursor)
        if isinstance(result, dict):
            # Vérifier que c'est bien un compte EXPERTS_IA ou retourner quand même
            return {
                'id': result.get('id'),
                'email': result.get('email'),
                'company_name': result.get('nom'),
                'schema_name': result.get('schema_name'),
                'subscription_status': result.get('subscription_status'),
                'stripe_customer_id': result.get('stripe_customer_id'),
                'stripe_subscription_id': result.get('stripe_subscription_id'),
                'active': result.get('active'),
                'created_at': result.get('created_at'),
                'product_type': result.get('product_type')
            }
        else:
            return {
                'id': result[0],
                'company_name': result[1],
                'email': result[2],
                'schema_name': result[3],
                'subscription_status': result[4],
                'stripe_customer_id': result[5],
                'stripe_subscription_id': result[6],
                'active': result[7],
                'created_at': result[8],
                'product_type': result[9]
            }

    except Exception as e:
        logger.error(f"Erreur récupération entreprise EXPERTS IA: {e}")
        return None
    finally:
        cursor.close()
        conn.close()


def get_experts_ia_user_by_stripe_customer(customer_id: str) -> Optional[Dict[str, Any]]:
    """Récupère une entreprise EXPERTS IA par son ID client Stripe"""
    conn = database_config.get_connection()
    if not conn:
        return None

    cursor = conn.cursor()

    try:
        # IMPORTANT: S'assurer qu'on est dans le schéma public
        cursor.execute("SET search_path TO public")

        cursor.execute('''
            SELECT id, nom, email, schema_name, subscription_status, active, product_type
            FROM entreprises
            WHERE stripe_customer_id = %s
        ''', (customer_id,))

        result = cursor.fetchone()

        if not result:
            return None

        # Gérer tuple ou dict (selon le cursor)
        if isinstance(result, dict):
            return {
                'id': result.get('id'),
                'company_name': result.get('nom'),
                'email': result.get('email'),
                'schema_name': result.get('schema_name'),
                'subscription_status': result.get('subscription_status'),
                'active': result.get('active'),
                'product_type': result.get('product_type')
            }
        else:
            return {
                'id': result[0],
                'company_name': result[1],
                'email': result[2],
                'schema_name': result[3],
                'subscription_status': result[4],
                'active': result[5],
                'product_type': result[6]
            }

    except Exception as e:
        logger.error(f"Erreur récupération entreprise EXPERTS IA par Stripe: {e}")
        return None
    finally:
        cursor.close()
        conn.close()


def update_experts_ia_subscription_status(entreprise_id: int, status: str, subscription_id: str = None):
    """Met à jour le statut d'abonnement d'une entreprise EXPERTS IA"""
    conn = database_config.get_connection()
    if not conn:
        return False

    cursor = conn.cursor()

    try:
        # IMPORTANT: S'assurer qu'on est dans le schéma public
        cursor.execute("SET search_path TO public")

        if subscription_id:
            cursor.execute('''
                UPDATE entreprises
                SET subscription_status = %s, stripe_subscription_id = %s, updated_at = %s
                WHERE id = %s AND product_type = 'EXPERTS_IA'
            ''', (status, subscription_id, datetime.now(), entreprise_id))
        else:
            cursor.execute('''
                UPDATE entreprises
                SET subscription_status = %s, updated_at = %s
                WHERE id = %s AND product_type = 'EXPERTS_IA'
            ''', (status, datetime.now(), entreprise_id))

        conn.commit()
        logger.info(f"Statut abonnement EXPERTS IA mis à jour: entreprise_id={entreprise_id}, status={status}")
        return True

    except Exception as e:
        logger.error(f"Erreur mise à jour statut abonnement EXPERTS IA: {e}")
        conn.rollback()
        return False
    finally:
        cursor.close()
        conn.close()


def cancel_experts_ia_subscription(entreprise_id: int, at_period_end: bool = True) -> bool:
    """
    Annule l'abonnement d'une entreprise EXPERTS IA

    Args:
        entreprise_id: ID de l'entreprise dans la table entreprises
        at_period_end: Si True, annule à la fin de la période (défaut)

    Returns:
        True si succès, False sinon
    """
    import stripe

    logger.info(f"[CANCEL_EXPERTS_IA] Début annulation pour entreprise_id={entreprise_id}, at_period_end={at_period_end}")

    conn = database_config.get_connection()
    if not conn:
        logger.error("[CANCEL_EXPERTS_IA] Connexion BD impossible")
        return False

    cursor = conn.cursor()

    try:
        # S'assurer qu'on est dans le schéma public
        cursor.execute("SET search_path TO public")

        # Récupérer les infos de l'abonnement
        cursor.execute('''
            SELECT stripe_subscription_id, stripe_customer_id, subscription_status
            FROM entreprises
            WHERE id = %s AND product_type = 'EXPERTS_IA'
        ''', (entreprise_id,))

        result = cursor.fetchone()

        if not result:
            logger.warning(f"[CANCEL_EXPERTS_IA] Aucune entreprise EXPERTS IA trouvée pour id={entreprise_id}")
            return False

        # Extraire les données
        if isinstance(result, dict):
            stripe_sub_id = result.get('stripe_subscription_id')
            current_status = result.get('subscription_status')
        else:
            stripe_sub_id = result[0]
            current_status = result[2]

        logger.info(f"[CANCEL_EXPERTS_IA] stripe_subscription_id={stripe_sub_id}, status actuel={current_status}")

        # Annuler via Stripe si on a un ID d'abonnement
        if stripe_sub_id:
            try:
                # Initialiser Stripe
                stripe_key = os.getenv('STRIPE_SECRET_KEY')
                if stripe_key:
                    stripe.api_key = stripe_key

                    if at_period_end:
                        # Annuler à la fin de la période
                        stripe.Subscription.modify(
                            stripe_sub_id,
                            cancel_at_period_end=True
                        )
                        logger.info(f"[CANCEL_EXPERTS_IA] Abonnement Stripe marqué pour annulation à la fin de la période")
                    else:
                        # Annuler immédiatement
                        stripe.Subscription.cancel(stripe_sub_id)
                        logger.info(f"[CANCEL_EXPERTS_IA] Abonnement Stripe annulé immédiatement")
                else:
                    logger.warning("[CANCEL_EXPERTS_IA] Clé Stripe non configurée")

            except stripe.error.StripeError as e:
                logger.error(f"[CANCEL_EXPERTS_IA] Erreur Stripe: {e}")
                # Continuer pour mettre à jour la BD même si Stripe échoue

        # Mettre à jour la BD
        new_status = 'canceled' if not at_period_end else 'cancel_at_period_end'
        cursor.execute('''
            UPDATE entreprises
            SET subscription_status = %s, updated_at = %s
            WHERE id = %s AND product_type = 'EXPERTS_IA'
        ''', (new_status, datetime.now(), entreprise_id))

        conn.commit()
        logger.info(f"[CANCEL_EXPERTS_IA] Abonnement annulé avec succès pour entreprise_id={entreprise_id}")
        return True

    except Exception as e:
        logger.error(f"[CANCEL_EXPERTS_IA] Erreur: {e}")
        conn.rollback()
        return False
    finally:
        cursor.close()
        conn.close()


def update_experts_ia_password(entreprise_id: int, new_password: str) -> bool:
    """Met à jour le mot de passe d'une entreprise EXPERTS IA"""
    conn = database_config.get_connection()
    if not conn:
        return False

    cursor = conn.cursor()

    try:
        # IMPORTANT: S'assurer qu'on est dans le schéma public
        cursor.execute("SET search_path TO public")

        password_hash = hash_password(new_password)

        cursor.execute('''
            UPDATE entreprises
            SET password_hash = %s, updated_at = %s
            WHERE id = %s AND product_type = 'EXPERTS_IA'
        ''', (password_hash, datetime.now(), entreprise_id))

        conn.commit()
        logger.info(f"Mot de passe EXPERTS IA mis à jour: entreprise_id={entreprise_id}")
        return True

    except Exception as e:
        logger.error(f"Erreur mise à jour mot de passe EXPERTS IA: {e}")
        conn.rollback()
        return False
    finally:
        cursor.close()
        conn.close()


def set_experts_ia_session(user_data: Dict[str, Any], session_state) -> bool:
    """
    Configure la session Streamlit pour EXPERTS IA après authentification

    Args:
        user_data: Données de l'utilisateur retournées par authenticate_experts_ia_user
        session_state: st.session_state de Streamlit

    Returns:
        True si succès, False sinon
    """
    try:
        # Définir l'authentification EXPERTS IA
        session_state.experts_ia_authenticated = True
        session_state.authenticated = True

        # Stocker les infos de l'entreprise
        session_state.experts_ia_user = user_data
        session_state.experts_ia_email = user_data.get('email')
        session_state.experts_ia_company = user_data.get('company_name')

        # Configurer le tenant multi-tenant
        session_state.tenant_id = user_data.get('id')
        session_state.tenant_nom = user_data.get('company_name')
        session_state.tenant_schema = user_data.get('schema_name')
        session_state.tenant_code = user_data.get('schema_name')

        # Marquer le produit actif
        session_state.active_product = 'EXPERTS_IA'

        logger.info(f"Session EXPERTS IA configurée: {user_data.get('email')} (schéma: {user_data.get('schema_name')})")
        return True

    except Exception as e:
        logger.error(f"Erreur configuration session EXPERTS IA: {e}")
        return False
