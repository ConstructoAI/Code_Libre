#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Module de gestion des abonnements Stripe - Constructo AI
Gere les abonnements SaaS, paiements et webhooks Stripe
"""

import os
import logging
from datetime import datetime
from typing import Dict, Optional, List, Any

# Configuration logging
logger = logging.getLogger(__name__)

# Import Stripe
try:
    import stripe
    STRIPE_AVAILABLE = True
except ImportError:
    STRIPE_AVAILABLE = False
    logger.warning("Module stripe non installe. Executez: pip install stripe")

# Import database
try:
    import database_config
    DB_AVAILABLE = True
except ImportError:
    DB_AVAILABLE = False

# =============================================================================
# CONFIGURATION STRIPE
# =============================================================================

def get_stripe_keys() -> Dict[str, str]:
    """Recupere les cles Stripe depuis les variables d'environnement"""
    return {
        'secret_key': os.environ.get('STRIPE_SECRET_KEY', ''),
        'publishable_key': os.environ.get('STRIPE_PUBLISHABLE_KEY', ''),
        'webhook_secret': os.environ.get('STRIPE_WEBHOOK_SECRET', ''),
        'price_id': os.environ.get('STRIPE_PRICE_ID', ''),  # ID du plan ERP complet (79.99$/mois)
        'experts_ia_price_id': os.environ.get('STRIPE_EXPERTS_IA_PRICE_ID', '')  # ID du plan EXPERTS IA (39.99$/mois)
    }


# Prix des forfaits (affichage)
PRIX_ERP_COMPLET = 159.99  # ERP Constructo AI complet (IA non incluse — credits prepayes)
PRIX_EXPERTS_IA = 39.99    # Plateforme EXPERTS IA seule (IA non incluse — credits prepayes)


def init_stripe() -> bool:
    """Initialise la connexion Stripe"""
    if not STRIPE_AVAILABLE:
        logger.error("Stripe non disponible")
        return False

    keys = get_stripe_keys()
    if not keys['secret_key']:
        logger.warning("STRIPE_SECRET_KEY non configuree")
        return False

    stripe.api_key = keys['secret_key']
    stripe.api_version = "2023-10-16"
    return True


def is_stripe_configured() -> bool:
    """Verifie si Stripe est correctement configure"""
    keys = get_stripe_keys()
    return bool(keys['secret_key'] and keys['publishable_key'])


# =============================================================================
# GESTION DES CLIENTS STRIPE
# =============================================================================

def create_stripe_customer(email: str, name: str, company_id: int, metadata: Dict = None) -> Optional[str]:
    """
    Cree un client Stripe et retourne son ID

    Args:
        email: Email du client
        name: Nom de l'entreprise
        company_id: ID de l'entreprise dans notre BD
        metadata: Donnees supplementaires

    Returns:
        stripe_customer_id ou None si erreur
    """
    if not init_stripe():
        return None

    try:
        customer = stripe.Customer.create(
            email=email,
            name=name,
            metadata={
                'company_id': str(company_id),
                'source': 'constructo_ai',
                **(metadata or {})
            }
        )
        logger.info(f"Client Stripe cree: {customer.id} pour company_id={company_id}")
        return customer.id
    except stripe.error.StripeError as e:
        logger.error(f"Erreur creation client Stripe: {e}")
        return None


def get_or_create_stripe_customer(company_id: int, email: str, name: str) -> Optional[str]:
    """
    Recupere le customer_id existant ou en cree un nouveau
    """
    if not DB_AVAILABLE:
        return create_stripe_customer(email, name, company_id)

    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()

        # Chercher un customer existant
        cursor.execute(
            "SELECT stripe_customer_id FROM public.subscriptions WHERE company_id = %s AND stripe_customer_id IS NOT NULL LIMIT 1",
            (company_id,)
        )
        result = cursor.fetchone()
        conn.close()

        if result and result['stripe_customer_id']:
            return result['stripe_customer_id']

        # Creer un nouveau customer
        return create_stripe_customer(email, name, company_id)

    except Exception as e:
        logger.error(f"Erreur get_or_create_stripe_customer: {e}")
        return create_stripe_customer(email, name, company_id)


# =============================================================================
# GESTION DES ABONNEMENTS
# =============================================================================

def create_checkout_session(
    company_id: int,
    customer_email: str,
    company_name: str,
    success_url: str,
    cancel_url: str,
    price_id: str = None,
    metadata: Dict = None
) -> Optional[Dict]:
    """
    Cree une session Stripe Checkout pour l'abonnement

    Args:
        company_id: ID de l'entreprise (peut etre None pour nouvelles inscriptions)
        customer_email: Email de facturation
        company_name: Nom de l'entreprise
        success_url: URL de redirection apres succes
        cancel_url: URL de redirection si annulation
        price_id: ID du prix Stripe (optionnel, utilise env var sinon)
        metadata: Metadata supplementaires a ajouter a la session

    Returns:
        Dict avec 'session_id' et 'url' ou None si erreur
    """
    if not init_stripe():
        return None

    keys = get_stripe_keys()
    price_id = price_id or keys['price_id']

    if not price_id:
        logger.error("STRIPE_PRICE_ID non configure")
        return None

    try:
        # Pour les nouvelles inscriptions, company_id peut etre None
        customer_id_stripe = None
        if company_id:
            customer_id_stripe = get_or_create_stripe_customer(company_id, customer_email, company_name)

        # Preparer les metadata de base
        base_metadata = {}
        if company_id:
            base_metadata['company_id'] = str(company_id)

        # Fusionner avec les metadata supplementaires
        if metadata:
            base_metadata.update(metadata)

        # Creer la session checkout — facturation immediate (pas d'essai)
        session_params = {
            'mode': 'subscription',
            'payment_method_types': ['card'],
            'line_items': [{
                'price': price_id,
                'quantity': 1,
            }],
            'success_url': success_url + '&session_id={CHECKOUT_SESSION_ID}' if '?' in success_url else success_url + '?session_id={CHECKOUT_SESSION_ID}',
            'cancel_url': cancel_url,
            'metadata': base_metadata,
            'subscription_data': {
                'metadata': base_metadata,
            },
            'allow_promotion_codes': True,
            'billing_address_collection': 'required',
            'customer_email': customer_email,
            # Activer le calcul automatique des taxes (TPS 5% + TVQ 9.975%)
            'automatic_tax': {'enabled': True},
        }

        # Si on a deja un customer_id Stripe, l'utiliser
        if customer_id_stripe:
            session_params['customer'] = customer_id_stripe
            del session_params['customer_email']
            # Mettre a jour l'adresse du client pour les futurs calculs de taxes
            session_params['customer_update'] = {
                'address': 'auto',
                'name': 'auto',
            }

        session = stripe.checkout.Session.create(**session_params)

        logger.info(f"Session Checkout creee: {session.id} pour company_id={company_id}")

        return {
            'session_id': session.id,
            'url': session.url
        }

    except stripe.error.StripeError as e:
        logger.error(f"Erreur creation session Checkout: {e}")
        return None


# =============================================================================
# PAIEMENT COMMANDES B2B (BOUTIQUE)
# =============================================================================

def create_order_checkout_session(
    commande_id: int,
    commande_numero: str,
    client_email: str,
    client_name: str,
    montant_total_cents: int,
    ligne_items: list,
    success_url: str,
    cancel_url: str,
    metadata: Dict = None
) -> Optional[Dict]:
    """
    Cree une session Stripe Checkout pour payer une commande B2B (paiement unique)

    Args:
        commande_id: ID de la commande dans notre BD
        commande_numero: Numero de la commande (ex: CMD-B2B-2025-001)
        client_email: Email du client
        client_name: Nom de l'entreprise cliente
        montant_total_cents: Montant total en cents CAD
        ligne_items: Liste des articles pour l'affichage Stripe
        success_url: URL de redirection apres succes
        cancel_url: URL de redirection si annulation
        metadata: Metadata supplementaires

    Returns:
        Dict avec 'session_id' et 'url' ou None si erreur
    """
    if not init_stripe():
        return None

    try:
        # Preparer les line_items pour Stripe
        stripe_line_items = []
        for item in ligne_items:
            stripe_line_items.append({
                'price_data': {
                    'currency': 'cad',
                    'product_data': {
                        'name': item.get('nom', 'Article'),
                        'description': item.get('description', '')[:500] if item.get('description') else None,
                    },
                    'unit_amount': round(float(item.get('prix_unitaire', 0)) * 100),  # En cents
                },
                'quantity': int(item.get('quantite', 1)),
            })

        # Ajouter les frais de livraison si present
        if metadata and metadata.get('frais_livraison', 0) > 0:
            stripe_line_items.append({
                'price_data': {
                    'currency': 'cad',
                    'product_data': {
                        'name': 'Frais de livraison',
                    },
                    'unit_amount': round(float(metadata['frais_livraison']) * 100),
                },
                'quantity': 1,
            })

        # Metadata de base
        base_metadata = {
            'commande_id': str(commande_id),
            'commande_numero': commande_numero,
            'type': 'b2b_order'
        }
        if metadata:
            base_metadata.update(metadata)

        # Creer la session checkout (mode payment = paiement unique)
        session = stripe.checkout.Session.create(
            mode='payment',
            payment_method_types=['card'],
            line_items=stripe_line_items,
            success_url=success_url + ('&' if '?' in success_url else '?') + 'session_id={CHECKOUT_SESSION_ID}',
            cancel_url=cancel_url,
            customer_email=client_email,
            metadata=base_metadata,
            billing_address_collection='required',
            shipping_address_collection={
                'allowed_countries': ['CA'],
            },
            automatic_tax={'enabled': False},  # On gere les taxes nous-memes (TPS/TVQ)
            locale='fr-CA',
        )

        logger.info(f"Session Checkout commande creee: {session.id} pour commande={commande_numero}")

        return {
            'session_id': session.id,
            'url': session.url
        }

    except stripe.error.StripeError as e:
        logger.error(f"Erreur creation session Checkout commande: {e}")
        return None


def handle_order_payment_success(session_id: str) -> Optional[Dict]:
    """
    Traite le succes d'un paiement de commande B2B

    Args:
        session_id: ID de la session Stripe Checkout

    Returns:
        Dict avec les infos de paiement ou None
    """
    if not init_stripe():
        return None

    try:
        # Recuperer la session
        session = stripe.checkout.Session.retrieve(session_id)

        if session.payment_status != 'paid':
            logger.warning(f"Session {session_id} non payee: {session.payment_status}")
            return None

        commande_id = session.metadata.get('commande_id')
        commande_numero = session.metadata.get('commande_numero')

        if not commande_id:
            logger.error(f"Pas de commande_id dans session {session_id}")
            return None

        # Mettre a jour la commande dans la BD
        if DB_AVAILABLE:
            try:
                conn = database_config.get_connection()
                cursor = conn.cursor()

                cursor.execute('''
                    UPDATE b2b_commandes
                    SET statut_paiement = 'paye',
                        stripe_session_id = %s,
                        stripe_payment_intent_id = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                ''', (session_id, str(session.payment_intent) if session.payment_intent else None, int(commande_id)))

                conn.commit()
                conn.close()

                logger.info(f"Commande {commande_numero} marquee comme payee")

            except Exception as db_error:
                logger.error(f"Erreur BD mise a jour commande: {db_error}")

        return {
            'commande_id': commande_id,
            'commande_numero': commande_numero,
            'payment_intent': session.payment_intent,
            'amount_total': session.amount_total,
            'currency': session.currency,
            'customer_email': session.customer_details.email if session.customer_details else None
        }

    except stripe.error.StripeError as e:
        logger.error(f"Erreur recuperation session: {e}")
        return None


def get_subscription_status(company_id: int) -> Optional[Dict]:
    """
    Recupere le statut de l'abonnement d'une entreprise

    Returns:
        Dict avec les infos d'abonnement ou None
    """
    logger.debug(f"[GET_SUB_STATUS] Recherche abonnement pour company_id={company_id}")

    if not DB_AVAILABLE:
        logger.warning(f"[GET_SUB_STATUS] DB_AVAILABLE=False")
        return None

    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            SELECT
                id, stripe_customer_id, stripe_subscription_id,
                plan_name, status, price_monthly,
                current_period_start, current_period_end,
                trial_end, cancel_at_period_end,
                created_at, updated_at
            FROM public.subscriptions
            WHERE company_id = %s
            ORDER BY created_at DESC
            LIMIT 1
        ''', (company_id,))

        row = cursor.fetchone()
        conn.close()

        if not row:
            logger.debug(f"[GET_SUB_STATUS] Aucune ligne trouvee pour company_id={company_id}")
            return None

        # Supporter dict (RealDictCursor) ou tuple
        if isinstance(row, dict):
            result = {
                'id': row.get('id'),
                'stripe_customer_id': row.get('stripe_customer_id'),
                'stripe_subscription_id': row.get('stripe_subscription_id'),
                'plan_name': row.get('plan_name'),
                'status': row.get('status'),
                'price_monthly': row.get('price_monthly'),
                'current_period_start': row.get('current_period_start'),
                'current_period_end': row.get('current_period_end'),
                'trial_end': row.get('trial_end'),
                'cancel_at_period_end': row.get('cancel_at_period_end'),
                'created_at': row.get('created_at'),
                'updated_at': row.get('updated_at'),
                'is_active': row.get('status') in ('active', 'trialing')
            }
        else:
            result = {
                'id': row[0],
                'stripe_customer_id': row[1],
                'stripe_subscription_id': row[2],
                'plan_name': row[3],
                'status': row[4],
                'price_monthly': row[5],
                'current_period_start': row[6],
                'current_period_end': row[7],
                'trial_end': row[8],
                'cancel_at_period_end': row[9],
                'created_at': row[10],
                'updated_at': row[11],
                'is_active': row[4] in ('active', 'trialing')
            }
        logger.debug(f"[GET_SUB_STATUS] Abonnement trouve: id={result['id']}, status={result['status']}, stripe_sub_id={result['stripe_subscription_id']}")
        return result

    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        logger.error(f"[GET_SUB_STATUS] Erreur: {e}")
        logger.error(f"[GET_SUB_STATUS] Traceback: {error_details}")
        return None


def cancel_subscription(company_id: int, at_period_end: bool = True) -> bool:
    """
    Annule l'abonnement d'une entreprise

    Args:
        company_id: ID de l'entreprise
        at_period_end: Si True, annule a la fin de la periode (defaut)

    Returns:
        True si succes
    """
    logger.info(f"[CANCEL_SUB] Debut annulation pour company_id={company_id}, at_period_end={at_period_end}")

    sub_info = get_subscription_status(company_id)
    logger.debug(f"[CANCEL_SUB] sub_info={sub_info}")

    # Cas 1: Pas d'abonnement du tout
    if not sub_info:
        logger.warning(f"[CANCEL_SUB] Aucun abonnement trouve pour company_id={company_id}")
        return False

    stripe_sub_id = sub_info.get('stripe_subscription_id')

    # Cas 2: Abonnement avec Stripe - annuler via API Stripe
    if stripe_sub_id and init_stripe():
        try:
            if at_period_end:
                stripe.Subscription.modify(
                    stripe_sub_id,
                    cancel_at_period_end=True
                )
            else:
                stripe.Subscription.cancel(stripe_sub_id)

            logger.info(f"[CANCEL_SUB] Abonnement Stripe annule pour company_id={company_id}")

        except stripe.error.StripeError as e:
            # Si l'abonnement est gere par un subscription schedule, annuler via le schedule
            if 'subscription schedule' in str(e).lower():
                try:
                    sub = stripe.Subscription.retrieve(stripe_sub_id)
                    schedule_id = sub.get('schedule')
                    if schedule_id:
                        if at_period_end:
                            # Liberer le schedule (end_behavior=cancel) puis annuler a la fin de periode
                            stripe.SubscriptionSchedule.release(schedule_id)
                            stripe.Subscription.modify(stripe_sub_id, cancel_at_period_end=True)
                        else:
                            stripe.SubscriptionSchedule.cancel(schedule_id)
                        logger.info(f"[CANCEL_SUB] Abonnement Stripe annule via schedule {schedule_id} pour company_id={company_id}")
                    else:
                        logger.error(f"[CANCEL_SUB] Schedule non trouve sur l'abonnement {stripe_sub_id}")
                except stripe.error.StripeError as e2:
                    logger.error(f"[CANCEL_SUB] Erreur annulation via schedule: {e2}")
            else:
                logger.error(f"[CANCEL_SUB] Erreur annulation Stripe: {e}")
            # Continuer pour mettre a jour la BD meme si Stripe echoue
    else:
        logger.info(f"[CANCEL_SUB] Pas de stripe_sub_id ou Stripe non initialise - annulation locale uniquement")

    # Cas 3: Mettre a jour la BD (pour tous les abonnements, avec ou sans Stripe)
    if DB_AVAILABLE:
        try:
            conn = database_config.get_connection()
            cursor = conn.cursor()

            if at_period_end:
                cursor.execute('''
                    UPDATE public.subscriptions
                    SET cancel_at_period_end = TRUE,
                        updated_at = NOW()
                    WHERE company_id = %s
                ''', (company_id,))
            else:
                cursor.execute('''
                    UPDATE public.subscriptions
                    SET status = 'canceled',
                        cancel_at_period_end = FALSE,
                        updated_at = NOW()
                    WHERE company_id = %s
                ''', (company_id,))

            conn.commit()
            conn.close()

            logger.info(f"[CANCEL_SUB] Abonnement BD annule pour company_id={company_id}")
            return True

        except Exception as e:
            logger.error(f"[CANCEL_SUB] Erreur mise a jour BD: {e}")
            return False

    logger.warning(f"[CANCEL_SUB] DB_AVAILABLE=False")
    return False


def reactivate_subscription(company_id: int) -> bool:
    """
    Reactive un abonnement qui etait prevu pour annulation
    """
    sub_info = get_subscription_status(company_id)

    # Pas d'abonnement a reactiver
    if not sub_info:
        logger.warning(f"Aucun abonnement a reactiver pour company_id={company_id}")
        return False

    stripe_sub_id = sub_info.get('stripe_subscription_id')

    # Si abonnement Stripe, reactiver via API
    if stripe_sub_id and init_stripe():
        try:
            stripe.Subscription.modify(
                stripe_sub_id,
                cancel_at_period_end=False
            )
            logger.info(f"Abonnement Stripe reactive pour company_id={company_id}")

        except stripe.error.StripeError as e:
            logger.error(f"Erreur reactivation Stripe: {e}")
            # Continuer pour mettre a jour la BD

    # Mettre a jour la BD (pour tous les abonnements)
    if DB_AVAILABLE:
        try:
            conn = database_config.get_connection()
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE public.subscriptions
                SET cancel_at_period_end = FALSE,
                    status = 'active',
                    updated_at = NOW()
                WHERE company_id = %s
            ''', (company_id,))
            conn.commit()
            conn.close()

            logger.info(f"Abonnement BD reactive pour company_id={company_id}")
            return True

        except Exception as e:
            logger.error(f"Erreur mise a jour BD reactivation: {e}")
            return False

    return False


# =============================================================================
# GESTION DU PORTAIL CLIENT
# =============================================================================

def create_customer_portal_session(company_id: int, return_url: str) -> Optional[str]:
    """
    Cree une session pour le portail client Stripe
    Permet au client de gerer son abonnement, cartes, factures

    Returns:
        URL du portail ou None
    """
    if not init_stripe():
        return None

    if not return_url or not return_url.strip():
        return_url = (
            os.environ.get('APP_URL')
            or os.environ.get('APP_BASE_URL')
            or os.environ.get('RENDER_EXTERNAL_URL')
            or 'http://localhost:5174'
        )

    sub_info = get_subscription_status(company_id)
    if not sub_info or not sub_info.get('stripe_customer_id'):
        logger.warning(f"Aucun customer Stripe pour company_id={company_id}")
        return None

    try:
        session = stripe.billing_portal.Session.create(
            customer=sub_info['stripe_customer_id'],
            return_url=return_url
        )
        return session.url

    except stripe.error.StripeError as e:
        logger.error(f"Erreur creation portail: {e}")
        return None


# =============================================================================
# WEBHOOKS STRIPE
# =============================================================================

def handle_webhook_event(payload: bytes, sig_header: str) -> Dict:
    """
    Traite les evenements webhook Stripe

    Args:
        payload: Corps de la requete (bytes)
        sig_header: Header Stripe-Signature

    Returns:
        Dict avec 'success' et 'message'
    """
    if not init_stripe():
        return {'success': False, 'message': 'Stripe non configure'}

    keys = get_stripe_keys()
    webhook_secret = keys['webhook_secret']

    if not webhook_secret:
        logger.error("STRIPE_WEBHOOK_SECRET non configure - webhook rejete (fail-closed)")
        return {'success': False, 'message': 'Webhook secret non configure - impossible de verifier la signature'}
    else:
        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, webhook_secret
            )
        except stripe.error.SignatureVerificationError:
            return {'success': False, 'message': 'Signature invalide'}

    event_type = event.get('type', '')
    event_id = event.get('id', '')
    data = event.get('data', {}).get('object', {})

    logger.info(f"Webhook Stripe recu: {event_type} (event_id={event_id})")

    # Idempotency check: skip already-processed events (STRIPE-02)
    if event_id:
        try:
            conn = database_config.get_connection()
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
                    event_id TEXT PRIMARY KEY,
                    event_type TEXT,
                    processed_at TIMESTAMP DEFAULT NOW()
                )
            """)
            cursor.execute("""
                INSERT INTO public.stripe_webhook_events (event_id, event_type, processed_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (event_id) DO NOTHING
                RETURNING event_id
            """, (event_id, event_type))
            inserted = cursor.fetchone()
            conn.commit()
            cursor.close()
            conn.close()
            if inserted is None:
                logger.info(f"Webhook event {event_id} already processed, skipping")
                return {"status": "already_processed"}
        except Exception as e:
            logger.warning(f"Idempotency check failed: {e}")
            # Continue processing (fail-open for idempotency is OK)

    # Traiter les differents types d'evenements
    handlers = {
        'checkout.session.completed': _handle_checkout_completed,
        'customer.subscription.created': _handle_subscription_created,
        'customer.subscription.updated': _handle_subscription_updated,
        'customer.subscription.deleted': _handle_subscription_deleted,
        'invoice.paid': _handle_invoice_paid,
        'invoice.payment_failed': _handle_payment_failed,
    }

    handler = handlers.get(event_type)
    if handler:
        try:
            handler(data)
            return {'success': True, 'message': f'Event {event_type} traite'}
        except Exception as e:
            logger.error(f"Erreur traitement {event_type}: {e}")
            return {'success': False, 'message': str(e)}

    return {'success': True, 'message': f'Event {event_type} ignore'}


def _handle_checkout_completed(data: Dict):
    """Traite la completion d'un checkout"""
    metadata = data.get('metadata', {})
    company_id = metadata.get('company_id')
    subscription_id = str(data['subscription']) if data.get('subscription') else None
    customer_id = str(data['customer']) if data.get('customer') else None
    signup_flow = metadata.get('signup_flow')

    logger.info(f"[CHECKOUT] metadata={metadata}")
    logger.info(f"[CHECKOUT] subscription_id={subscription_id}, customer_id={customer_id}, signup_flow={signup_flow}")

    # Gestion du flux d'inscription nouvelle entreprise
    if signup_flow == 'new_company':
        company_name = metadata.get('company_name', '')
        email = metadata.get('email', '')
        checkout_session_id = data.get('id', '')

        logger.info(f"[CHECKOUT] new_company flow: company_name={company_name}, email={email}")

        if company_name and email:
            logger.info(f"Nouvelle inscription: {company_name} ({email})")
            # La création de l'entreprise se fait dans _create_company_from_signup
            new_company_id = _create_company_from_signup(company_name, email, customer_id, subscription_id, checkout_session_id)
            if new_company_id:
                logger.info(f"Entreprise creee avec ID={new_company_id}")
            else:
                logger.error(f"Echec creation entreprise pour {email}")

        # Sauvegarder le payment_method sur le Customer pour les nouvelles inscriptions aussi
        if customer_id and subscription_id:
            try:
                if init_stripe():
                    sub = stripe.Subscription.retrieve(subscription_id)
                    pm = sub.get('default_payment_method')
                    if not pm:
                        pms = stripe.PaymentMethod.list(customer=customer_id, type='card', limit=1)
                        if pms.data:
                            pm = pms.data[0].id
                    if pm:
                        stripe.Customer.modify(
                            customer_id,
                            invoice_settings={'default_payment_method': pm}
                        )
                        logger.info(f"[CHECKOUT] new_company: default_payment_method={pm} sauvegarde sur Customer {customer_id}")
            except Exception as pm_err:
                logger.warning(f"[CHECKOUT] new_company: Erreur sauvegarde payment_method: {pm_err}")

        return

    if not company_id:
        logger.warning("checkout.session.completed sans company_id ni signup_flow")
        return

    logger.info(f"Checkout complete pour company_id={company_id}")

    # --- CORRECTIF: Sauvegarder le payment_method sur le Customer ---
    # Apres un Checkout subscription (avec ou sans trial), la carte est attachee
    # a la Subscription mais PAS au Customer.invoice_settings.default_payment_method.
    # Sans ce correctif, les factures AI hors-subscription echouent avec erreur 402.
    if customer_id and subscription_id:
        try:
            if not init_stripe():
                logger.warning("[CHECKOUT] Stripe non initialise, skip sauvegarde payment_method")
            else:
                sub = stripe.Subscription.retrieve(subscription_id)
                pm = sub.get('default_payment_method')
                if pm:
                    stripe.Customer.modify(
                        customer_id,
                        invoice_settings={'default_payment_method': pm}
                    )
                    logger.info(f"[CHECKOUT] default_payment_method={pm} sauvegarde sur Customer {customer_id}")
                else:
                    # Trial sans payment_method sur la subscription - chercher dans les PaymentMethods
                    pms = stripe.PaymentMethod.list(customer=customer_id, type='card', limit=1)
                    if pms.data:
                        stripe.Customer.modify(
                            customer_id,
                            invoice_settings={'default_payment_method': pms.data[0].id}
                        )
                        logger.info(f"[CHECKOUT] payment_method={pms.data[0].id} (via list) sauvegarde sur Customer {customer_id}")
                    else:
                        logger.warning(f"[CHECKOUT] Aucun payment_method trouve pour Customer {customer_id}")
        except Exception as pm_err:
            logger.warning(f"[CHECKOUT] Erreur sauvegarde payment_method sur Customer: {pm_err}")

    # L'abonnement sera cree par customer.subscription.created


def _handle_subscription_created(data: Dict):
    """Traite la creation d'un abonnement"""
    _save_subscription_to_db(data)


def _handle_subscription_updated(data: Dict):
    """Traite la mise a jour d'un abonnement"""
    _save_subscription_to_db(data)

    # Synchroniser explicitement entreprises.subscription_status
    subscription_id = data.get('id')
    new_status = data.get('status')
    customer_id = data.get('customer')

    if not DB_AVAILABLE or not subscription_id or not new_status:
        return

    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE public.subscriptions
            SET status = %s, updated_at = NOW()
            WHERE stripe_subscription_id = %s
            RETURNING company_id
        ''', (new_status, subscription_id))
        result = cursor.fetchone()

        if result:
            company_id = result['company_id'] if isinstance(result, dict) else result[0]
            cursor.execute('''
                UPDATE public.entreprises
                SET subscription_status = %s, updated_at = NOW()
                WHERE id = %s
            ''', (new_status, company_id))
            logger.info(f"Abonnement {subscription_id} mis a jour: status={new_status}, company_id={company_id}")
        else:
            # Fallback: pas de record subscriptions — mettre a jour entreprises directement
            # via stripe_subscription_id ou stripe_customer_id
            cursor.execute('''
                UPDATE public.entreprises
                SET subscription_status = %s, updated_at = NOW()
                WHERE stripe_subscription_id = %s OR stripe_customer_id = %s
            ''', (new_status, subscription_id, customer_id))
            if cursor.rowcount > 0:
                logger.info(f"Abonnement {subscription_id} mis a jour via fallback entreprises: status={new_status}")
            else:
                logger.warning(f"Abonnement {subscription_id} non trouve dans subscriptions ni entreprises")

        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Erreur _handle_subscription_updated sync entreprises: {e}")


def _handle_subscription_deleted(data: Dict):
    """Traite la suppression d'un abonnement"""
    subscription_id = data.get('id')
    customer_id = data.get('customer')

    if not DB_AVAILABLE:
        return

    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE public.subscriptions
            SET status = 'canceled', updated_at = NOW()
            WHERE stripe_subscription_id = %s
            RETURNING company_id
        ''', (subscription_id,))
        result = cursor.fetchone()

        # Synchroniser entreprises.subscription_status pour check_ai_quota
        if result:
            company_id = result['company_id'] if isinstance(result, dict) else result[0]
            cursor.execute('''
                UPDATE public.entreprises
                SET subscription_status = 'canceled', updated_at = NOW()
                WHERE id = %s
            ''', (company_id,))
        else:
            # Fallback: pas de record subscriptions — mettre a jour entreprises directement
            cursor.execute('''
                UPDATE public.entreprises
                SET subscription_status = 'canceled', updated_at = NOW()
                WHERE stripe_subscription_id = %s OR stripe_customer_id = %s
            ''', (subscription_id, customer_id))
            if cursor.rowcount > 0:
                logger.info(f"Abonnement {subscription_id} annule via fallback entreprises")
            else:
                logger.warning(f"Abonnement {subscription_id} non trouve pour annulation")

        conn.commit()
        conn.close()
        logger.info(f"Abonnement {subscription_id} marque comme annule")
    except Exception as e:
        logger.error(f"Erreur _handle_subscription_deleted: {e}")


def _handle_invoice_paid(data: Dict):
    """Traite le paiement d'une facture"""
    subscription_id = data.get('subscription')
    amount_paid = data.get('amount_paid', 0) / 100  # Stripe utilise les centimes
    invoice_id = data.get('id')
    customer_id = data.get('customer')
    customer_email = data.get('customer_email', 'inconnu')
    payment_intent = data.get('payment_intent')
    currency = data.get('currency', 'cad').upper()
    paid_at = datetime.utcnow().isoformat()

    logger.info(
        f"Facture payee: invoice={invoice_id}, montant={amount_paid}$ {currency}, "
        f"subscription={subscription_id}, customer={customer_id}, "
        f"email={customer_email}, payment_intent={payment_intent}, "
        f"timestamp={paid_at}"
    )

    # STRIPE-09: Insert audit record into stripe_payment_records
    if not DB_AVAILABLE:
        return

    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()

        # Ensure audit table exists
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS public.stripe_payment_records (
                id SERIAL PRIMARY KEY,
                stripe_invoice_id TEXT UNIQUE,
                stripe_subscription_id TEXT,
                stripe_customer_id TEXT,
                stripe_payment_intent TEXT,
                customer_email TEXT,
                amount NUMERIC(12,2),
                currency TEXT DEFAULT 'CAD',
                status TEXT DEFAULT 'paid',
                paid_at TIMESTAMP DEFAULT NOW(),
                created_at TIMESTAMP DEFAULT NOW()
            )
        ''')

        cursor.execute('''
            INSERT INTO public.stripe_payment_records
                (stripe_invoice_id, stripe_subscription_id, stripe_customer_id,
                 stripe_payment_intent, customer_email, amount, currency, status, paid_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'paid', NOW())
            ON CONFLICT (stripe_invoice_id) DO NOTHING
        ''', (invoice_id, subscription_id, customer_id,
              payment_intent, customer_email, amount_paid, currency))

        conn.commit()
        conn.close()
        logger.info(f"Audit record created for invoice {invoice_id}, amount={amount_paid}$ {currency}")
    except Exception as e:
        logger.error(f"Erreur creation audit record invoice_paid: {e}")


def _handle_payment_failed(data: Dict):
    """Traite un echec de paiement - marque l'abonnement comme past_due"""
    subscription_id = data.get('subscription')
    customer_email = data.get('customer_email', 'inconnu')
    customer_id = data.get('customer')
    amount_due = data.get('amount_due', 0) / 100
    attempt_count = data.get('attempt_count', 0)
    next_attempt = data.get('next_payment_attempt')

    logger.warning(
        f"Paiement echoue: email={customer_email}, subscription={subscription_id}, "
        f"customer={customer_id}, montant_du={amount_due}$, "
        f"tentative={attempt_count}, prochaine_tentative={next_attempt}"
    )

    if not DB_AVAILABLE or not subscription_id:
        return

    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()

        # Marquer l'abonnement comme past_due dans subscriptions
        cursor.execute('''
            UPDATE public.subscriptions
            SET status = 'past_due', updated_at = NOW()
            WHERE stripe_subscription_id = %s
        ''', (subscription_id,))

        # Synchroniser entreprises.subscription_status via stripe_customer_id
        if customer_id:
            cursor.execute('''
                UPDATE public.entreprises
                SET subscription_status = 'past_due', updated_at = NOW()
                WHERE stripe_customer_id = %s
            ''', (customer_id,))

        conn.commit()
        conn.close()
        logger.info(f"Abonnement {subscription_id} marque past_due suite a echec de paiement")
    except Exception as e:
        logger.error(f"Erreur _handle_payment_failed: {e}")

    # TODO: Envoyer un email de notification


def _create_company_from_signup(company_name: str, email: str,
                                 customer_id: str, subscription_id: str,
                                 checkout_session_id: str = '') -> Optional[int]:
    """
    Cree une nouvelle entreprise apres un paiement Stripe reussi.

    Args:
        company_name: Nom de l'entreprise
        email: Email de l'entreprise
        customer_id: ID client Stripe
        subscription_id: ID abonnement Stripe
        checkout_session_id: ID de la session Stripe Checkout (pour retrouver le pending signup)

    Returns:
        ID de l'entreprise creee ou None en cas d'erreur
    """
    try:
        # Import du tenant_manager pour creer l'entreprise
        from tenant_manager import get_tenant_manager
        import secrets
        import string

        tenant_manager = get_tenant_manager()

        # Recuperer le mot de passe original depuis pending_signups ou pending_experts_ia_signups
        # C'est le mot de passe que l'utilisateur a vu lors de l'inscription
        temp_password = None
        password_already_hashed = False
        _rep_code = None
        if checkout_session_id and DB_AVAILABLE:
            try:
                conn_pending = database_config.get_connection()
                cursor_pending = conn_pending.cursor()
                cursor_pending.execute("SET search_path TO public")

                # Chercher d'abord dans pending_signups (ERP)
                try:
                    cursor_pending.execute(
                        'SELECT password_hash, representant_code FROM pending_signups WHERE checkout_session_id = %s',
                        (checkout_session_id,)
                    )
                    pending_result = cursor_pending.fetchone()
                    if pending_result:
                        _pending_hash = pending_result['password_hash'] if isinstance(pending_result, dict) else pending_result[0]
                        if _pending_hash and _pending_hash.startswith('$2'):
                            temp_password = _pending_hash
                            password_already_hashed = True
                            logger.info(f"[WEBHOOK] Password hash recupere depuis pending_signups pour {email}")
                        _rep_code = pending_result.get('representant_code') if isinstance(pending_result, dict) else (pending_result[1] if len(pending_result) > 1 else None)
                except Exception as e_ps:
                    logger.debug(f"[WEBHOOK] pending_signups lookup: {e_ps}")

                # Si pas trouve, chercher dans pending_experts_ia_signups
                if not temp_password:
                    try:
                        cursor_pending.execute(
                            'SELECT password_hash FROM pending_experts_ia_signups WHERE checkout_session_id = %s',
                            (checkout_session_id,)
                        )
                        pending_result = cursor_pending.fetchone()
                        if pending_result:
                            _pending_hash = pending_result['password_hash'] if isinstance(pending_result, dict) else pending_result[0]
                            if _pending_hash and _pending_hash.startswith('$2'):
                                temp_password = _pending_hash
                                password_already_hashed = True
                                logger.info(f"[WEBHOOK] Password hash recupere depuis pending_experts_ia_signups pour {email}")
                    except Exception as e_pes:
                        logger.debug(f"[WEBHOOK] pending_experts_ia_signups lookup: {e_pes}")

                conn_pending.close()
            except Exception as e_lookup:
                logger.warning(f"[WEBHOOK] Erreur lookup pending signup pour {email}: {e_lookup}")

        # Fallback: generer un mot de passe temporaire si rien trouve dans pending
        if not temp_password:
            temp_password = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(12))
            logger.info(f"[WEBHOOK] Mot de passe temporaire genere pour {email} (pending non trouve)")

        # Detecter le product_type depuis l'abonnement Stripe
        # Methode 1: Comparer le price_id avec la variable d'environnement
        # Methode 2 (fallback): Verifier le nom du produit Stripe
        _product_type = 'ERP'
        try:
            if init_stripe() and subscription_id:
                _sub = stripe.Subscription.retrieve(subscription_id)
                _experts_price = STRIPE_CONFIG.get('experts_ia_price_id', '')
                for _item in _sub.get('items', {}).get('data', []):
                    _price_id = _item.get('price', {}).get('id', '')
                    # Methode 1: match exact sur le price_id configure
                    if _experts_price and _price_id == _experts_price:
                        _product_type = 'EXPERTS_IA'
                        break
                    # Methode 2: verifier le nom du produit Stripe
                    try:
                        _prod_id = _item.get('price', {}).get('product', '')
                        if _prod_id:
                            _product = stripe.Product.retrieve(_prod_id)
                            if 'expert' in (_product.get('name', '') or '').lower():
                                _product_type = 'EXPERTS_IA'
                                break
                    except Exception:
                        pass
        except Exception:
            pass

        # Creer l'entreprise avec le bon product_type et les IDs Stripe
        entreprise_id = tenant_manager.create_entreprise(
            nom=company_name,
            password=temp_password,
            email=email,
            telephone="",
            representant_code=_rep_code or "",
            product_type=_product_type,
            stripe_customer_id=customer_id,
            stripe_subscription_id=subscription_id,
            password_already_hashed=password_already_hashed
        )

        # Sécurité: create_entreprise peut retourner un dict en cas de race condition
        if isinstance(entreprise_id, dict):
            entreprise_id = entreprise_id.get('entreprise_id', entreprise_id.get('id'))
        if not entreprise_id:
            logger.error(f"Echec creation entreprise via tenant_manager pour {email}")
            return None

        # Recuperer le schema de l'entreprise pour creer l'utilisateur admin
        try:
            conn = database_config.get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT schema_name FROM entreprises WHERE id = %s", (entreprise_id,))
            result = cursor.fetchone()
            conn.close()

            if result:
                schema_name = result['schema_name'] if isinstance(result, dict) else result[0]

                # Creer un utilisateur admin pour le client
                # Nom d'utilisateur = partie avant @ de l'email
                username = email.split('@')[0] if '@' in email else 'admin'

                # Creer l'utilisateur admin client
                # Si le mot de passe est deja hashe (recupere de pending_signups),
                # le passer via password_hash pour eviter le double-hashing
                admin_kwargs = {
                    "schema": schema_name,
                    "username": username,
                    "full_name": f"Admin {company_name}",
                    "email": email,
                }
                if password_already_hashed:
                    admin_kwargs["password_hash"] = temp_password
                else:
                    admin_kwargs["password"] = temp_password
                admin_created = tenant_manager.create_tenant_admin(**admin_kwargs)

                if admin_created:
                    logger.info(f"Utilisateur admin '{username}' cree pour {company_name}")
                else:
                    logger.warning(f"Echec creation utilisateur admin pour {company_name}")

        except Exception as e:
            logger.error(f"Erreur creation utilisateur admin: {e}")

        # Sauvegarder la relation avec Stripe dans la table subscriptions
        logger.info(f"[SAVE_SUB] DB_AVAILABLE={DB_AVAILABLE}, subscription_id={subscription_id}, entreprise_id={entreprise_id}, customer_id={customer_id}")

        if DB_AVAILABLE and subscription_id:
            try:
                conn = database_config.get_connection()
                cursor = conn.cursor()

                logger.info(f"[SAVE_SUB] Executing INSERT INTO public.subscriptions...")

                # Determiner le plan et le prix depuis le product_type deja detecte
                if _product_type == 'EXPERTS_IA':
                    _plan_name = 'EXPERTS IA PRO'
                    _plan_price = PRIX_EXPERTS_IA
                else:
                    _plan_name = 'Constructo AI Standard'
                    _plan_price = PRIX_ERP_COMPLET

                # Inserer l'abonnement avec les infos Stripe
                cursor.execute('''
                    INSERT INTO public.subscriptions (
                        company_id, stripe_customer_id, stripe_subscription_id,
                        status, plan_name, price_monthly, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
                    ON CONFLICT (company_id) DO UPDATE SET
                        stripe_customer_id = EXCLUDED.stripe_customer_id,
                        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
                        status = EXCLUDED.status,
                        updated_at = NOW()
                ''', (
                    entreprise_id, customer_id, subscription_id,
                    'active', _plan_name, _plan_price
                ))
                conn.commit()
                conn.close()

                logger.info(f"[SAVE_SUB] SUCCESS - Subscription saved for company_id={entreprise_id}")

                # Sauvegarder aussi dans entreprises pour que charge_ai_prepaid_credit()
                # trouve le stripe_customer_id directement (sans fallback subscriptions)
                try:
                    conn2 = database_config.get_connection()
                    cur2 = conn2.cursor()
                    cur2.execute('''
                        UPDATE public.entreprises
                        SET stripe_customer_id = %s,
                            stripe_subscription_id = %s,
                            subscription_status = 'active',
                            updated_at = NOW()
                        WHERE id = %s
                    ''', (customer_id, subscription_id, entreprise_id))
                    conn2.commit()
                    conn2.close()
                    logger.info(f"[SAVE_SUB] stripe_customer_id={customer_id} sauvegarde dans entreprises.id={entreprise_id}")
                except Exception as e2:
                    logger.error(f"[SAVE_SUB] Erreur maj entreprises: {e2}")

            except Exception as e:
                logger.error(f"[SAVE_SUB] ERREUR sauvegarde subscription pour {email}: {e}")
                import traceback
                logger.error(f"[SAVE_SUB] Traceback: {traceback.format_exc()}")
        else:
            logger.warning(f"[SAVE_SUB] SKIP - DB_AVAILABLE={DB_AVAILABLE}, subscription_id={subscription_id}")

        # Auto-recharge initiale des credits IA prepayes (10$ via Stripe)
        # Permet aux nouveaux clients d'utiliser l'IA immediatement apres
        # l'inscription, sans avoir a cliquer "Recharger" separement.
        # Si la charge echoue (carte refusee, etc.), on log mais on ne fail
        # PAS l'inscription -- le user a deja paye son abonnement ERP.
        try:
            _initial_charge = charge_ai_prepaid_credit(
                entreprise_id=entreprise_id,
                product_type=_product_type,
                amount=10.00
            )
            if _initial_charge.get('success'):
                logger.info(
                    f"[SIGNUP_AI_CREDIT] +10$ credits IA initiaux factures pour "
                    f"{company_name} (entreprise_id={entreprise_id}, "
                    f"invoice={_initial_charge.get('stripe_invoice_id')})"
                )
            else:
                logger.warning(
                    f"[SIGNUP_AI_CREDIT] Echec recharge initiale 10$ pour "
                    f"{company_name} (entreprise_id={entreprise_id}): "
                    f"{_initial_charge.get('error')}"
                )
        except Exception as _ai_credit_err:
            logger.error(
                f"[SIGNUP_AI_CREDIT] Exception recharge initiale pour "
                f"{company_name} (entreprise_id={entreprise_id}): {_ai_credit_err}"
            )

        # Generer le nom d'utilisateur pour les logs
        username = email.split('@')[0] if '@' in email else 'admin'

        # Envoyer un email de bienvenue avec les identifiants
        logger.info(f"Entreprise {company_name} creee avec succes!")
        logger.info(f"Email entreprise: {email}")
        logger.info("Mot de passe temporaire généré pour la nouvelle entreprise")
        logger.info(f"Nom d'utilisateur: {username}")

        # Note: En production, envoyer un email avec le mot de passe temporaire
        # ou un lien de reinitialisation de mot de passe

        return entreprise_id

    except Exception as e:
        logger.error(f"Erreur _create_company_from_signup: {e}")
        return None


def _save_subscription_to_db(data: Dict):
    """Sauvegarde ou met a jour un abonnement dans la BD"""
    if not DB_AVAILABLE:
        return

    subscription_id = str(data['id']) if data.get('id') else None
    customer_id = str(data['customer']) if data.get('customer') else None
    status = data.get('status')

    # Extraire company_id des metadata
    company_id = data.get('metadata', {}).get('company_id')

    if not company_id:
        # Essayer de trouver via customer_id
        try:
            conn = database_config.get_connection()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT company_id FROM public.subscriptions WHERE stripe_customer_id = %s LIMIT 1",
                (customer_id,)
            )
            result = cursor.fetchone()
            conn.close()
            if result:
                company_id = result['company_id']
        except Exception:
            pass

    if not company_id:
        logger.warning(f"Impossible de trouver company_id pour subscription {subscription_id}")
        return

    # Extraire les informations du plan
    items = data.get('items', {}).get('data', [])
    plan_name = 'Abonnement Constructo AI'
    price_monthly = 0

    if items:
        price_data = items[0].get('price', {})
        plan_name = price_data.get('nickname') or plan_name
        price_monthly = (price_data.get('unit_amount', 0) / 100)

    # Dates
    current_period_start = datetime.fromtimestamp(data.get('current_period_start', 0))
    current_period_end = datetime.fromtimestamp(data.get('current_period_end', 0))
    trial_end = None
    if data.get('trial_end'):
        trial_end = datetime.fromtimestamp(data['trial_end'])

    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()

        # Upsert
        cursor.execute('''
            INSERT INTO public.subscriptions
            (company_id, stripe_customer_id, stripe_subscription_id,
             plan_name, status, price_monthly,
             current_period_start, current_period_end,
             trial_end, cancel_at_period_end, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (company_id) DO UPDATE SET
                stripe_subscription_id = EXCLUDED.stripe_subscription_id,
                status = EXCLUDED.status,
                price_monthly = EXCLUDED.price_monthly,
                current_period_start = EXCLUDED.current_period_start,
                current_period_end = EXCLUDED.current_period_end,
                trial_end = EXCLUDED.trial_end,
                cancel_at_period_end = EXCLUDED.cancel_at_period_end,
                updated_at = NOW()
        ''', (
            company_id, customer_id, subscription_id,
            plan_name, status, price_monthly,
            current_period_start, current_period_end,
            trial_end, data.get('cancel_at_period_end', False)
        ))

        # Synchroniser entreprises.subscription_status pour que check_ai_quota
        # lise le bon statut (il lit depuis entreprises, pas subscriptions)
        cursor.execute('''
            UPDATE public.entreprises
            SET subscription_status = %s, updated_at = NOW()
            WHERE id = %s
        ''', (status, company_id))

        conn.commit()
        conn.close()
        logger.info(f"Abonnement sauvegarde pour company_id={company_id}, status={status}")

    except Exception as e:
        logger.error(f"Erreur _save_subscription_to_db: {e}")


# =============================================================================
# FONCTIONS UTILITAIRES
# =============================================================================

def get_invoices(company_id: int, limit: int = 10) -> List[Dict]:
    """
    Recupere les factures Stripe d'une entreprise
    """
    if not init_stripe():
        return []

    sub_info = get_subscription_status(company_id)
    if not sub_info or not sub_info.get('stripe_customer_id'):
        return []

    try:
        invoices = stripe.Invoice.list(
            customer=sub_info['stripe_customer_id'],
            limit=limit
        )

        result = []
        for inv in invoices.data:
            result.append({
                'id': inv.id,
                'number': inv.number,
                'amount_due': inv.amount_due / 100,
                'amount_paid': inv.amount_paid / 100,
                'status': inv.status,
                'created': datetime.fromtimestamp(inv.created),
                'invoice_pdf': inv.invoice_pdf,
                'hosted_invoice_url': inv.hosted_invoice_url
            })

        return result

    except stripe.error.StripeError as e:
        logger.error(f"Erreur get_invoices: {e}")
        return []


def check_subscription_active(company_id: int) -> bool:
    """
    Verifie rapidement si une entreprise a un abonnement actif
    """
    sub_info = get_subscription_status(company_id)
    if not sub_info:
        return False
    return sub_info.get('is_active', False)


def get_subscription_days_remaining(company_id: int) -> int:
    """
    Retourne le nombre de jours restants dans la periode actuelle
    """
    sub_info = get_subscription_status(company_id)
    if not sub_info or not sub_info.get('current_period_end'):
        return 0

    end_date = sub_info['current_period_end']
    if isinstance(end_date, datetime):
        delta = end_date - datetime.now()
        return max(0, delta.days)
    return 0


# =============================================================================
# INITIALISATION TABLE BD
# =============================================================================

def init_subscriptions_table():
    """Cree la table subscriptions si elle n'existe pas"""
    if not DB_AVAILABLE:
        logger.warning("Database non disponible")
        return False

    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS public.subscriptions (
                id SERIAL PRIMARY KEY,
                company_id INTEGER UNIQUE NOT NULL,
                stripe_customer_id TEXT,
                stripe_subscription_id TEXT,
                plan_name TEXT DEFAULT 'Abonnement Constructo AI',
                status TEXT DEFAULT 'inactive',
                price_monthly DECIMAL(10,2) DEFAULT 0,
                current_period_start TIMESTAMP,
                current_period_end TIMESTAMP,
                trial_end TIMESTAMP,
                cancel_at_period_end BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Table pour l'idempotence des webhooks (STRIPE-02)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
                event_id TEXT PRIMARY KEY,
                event_type TEXT,
                processed_at TIMESTAMP DEFAULT NOW()
            )
        ''')

        # Table audit des paiements Stripe (STRIPE-09)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS public.stripe_payment_records (
                id SERIAL PRIMARY KEY,
                stripe_invoice_id TEXT UNIQUE,
                stripe_subscription_id TEXT,
                stripe_customer_id TEXT,
                stripe_payment_intent TEXT,
                customer_email TEXT,
                amount NUMERIC(12,2),
                currency TEXT DEFAULT 'CAD',
                status TEXT DEFAULT 'paid',
                paid_at TIMESTAMP DEFAULT NOW(),
                created_at TIMESTAMP DEFAULT NOW()
            )
        ''')

        # Index
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_sub_company ON public.subscriptions(company_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_sub_status ON public.subscriptions(status)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_sub_stripe_customer ON public.subscriptions(stripe_customer_id)')

        conn.commit()
        conn.close()

        logger.info("Table subscriptions initialisee")
        return True

    except Exception as e:
        logger.error(f"Erreur init_subscriptions_table: {e}")
        return False


# =============================================================================
# SYNCHRONISATION STRIPE
# =============================================================================

def sync_all_subscriptions_from_stripe() -> dict:
    """
    Synchronise tous les abonnements depuis Stripe vers la base de données.
    Récupère le statut actuel de chaque subscription depuis l'API Stripe.

    Returns:
        dict avec 'updated', 'errors', 'details'
    """
    if not init_stripe():
        return {'updated': 0, 'errors': 1, 'details': ['Stripe non initialisé']}

    results = {'updated': 0, 'errors': 0, 'details': []}

    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()

        # Récupérer toutes les subscriptions avec un stripe_subscription_id
        cursor.execute('''
            SELECT company_id, stripe_subscription_id, status
            FROM public.subscriptions
            WHERE stripe_subscription_id IS NOT NULL
        ''')

        subscriptions = cursor.fetchall()
        logger.info(f"[SYNC] {len(subscriptions)} subscriptions trouvées à synchroniser")

        for row in subscriptions:
            # Support pour dict ou tuple
            if hasattr(row, 'get'):
                company_id = row.get('company_id')
                stripe_sub_id = row.get('stripe_subscription_id')
                current_status = row.get('status')
            else:
                company_id = row[0]
                stripe_sub_id = row[1]
                current_status = row[2]

            if not stripe_sub_id:
                continue

            try:
                # Récupérer l'abonnement depuis Stripe
                stripe_sub = stripe.Subscription.retrieve(stripe_sub_id)
                new_status = stripe_sub.status

                # Si le statut a changé, mettre à jour
                if new_status != current_status:
                    # Extraire les dates
                    current_period_start = datetime.fromtimestamp(stripe_sub.current_period_start)
                    current_period_end = datetime.fromtimestamp(stripe_sub.current_period_end)
                    trial_end = None
                    if stripe_sub.trial_end:
                        trial_end = datetime.fromtimestamp(stripe_sub.trial_end)

                    cursor.execute('''
                        UPDATE public.subscriptions
                        SET status = %s,
                            current_period_start = %s,
                            current_period_end = %s,
                            trial_end = %s,
                            cancel_at_period_end = %s,
                            updated_at = NOW()
                        WHERE company_id = %s
                    ''', (
                        new_status,
                        current_period_start,
                        current_period_end,
                        trial_end,
                        stripe_sub.cancel_at_period_end,
                        company_id
                    ))

                    results['updated'] += 1
                    results['details'].append(f"Company #{company_id}: {current_status} → {new_status}")
                    logger.info(f"[SYNC] Company #{company_id}: {current_status} → {new_status}")

            except stripe.error.StripeError as e:
                results['errors'] += 1
                results['details'].append(f"Company #{company_id}: Erreur Stripe - {str(e)}")
                logger.error(f"[SYNC] Erreur Stripe pour company #{company_id}: {e}")
            except Exception as e:
                results['errors'] += 1
                results['details'].append(f"Company #{company_id}: Erreur - {str(e)}")
                logger.error(f"[SYNC] Erreur pour company #{company_id}: {e}")

        conn.commit()

        # ═══ PHASE 2: Récupérer TOUS les abonnements actifs/trialing depuis Stripe ═══
        # et créer/mettre à jour les lignes manquantes dans subscriptions
        created_count = 0
        try:
            logger.info("[SYNC] Phase 2: Récupération de tous les abonnements actifs depuis Stripe...")

            # Récupérer la correspondance entreprise.id ↔ stripe_customer_id
            cursor.execute('''
                SELECT id, stripe_customer_id, nom
                FROM public.entreprises
                WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id != ''
            ''')
            ent_by_cust = {}
            for row in cursor.fetchall():
                if hasattr(row, 'get'):
                    ent_by_cust[row.get('stripe_customer_id')] = {
                        'id': row.get('id'), 'nom': row.get('nom')
                    }
                else:
                    ent_by_cust[row[1]] = {'id': row[0], 'nom': row[2]}

            # Récupérer tous les abonnements actifs et trialing depuis Stripe
            stripe_subs = []
            for st_status in ['active', 'trialing']:
                subs_iter = stripe.Subscription.list(status=st_status, limit=100)
                for sub in subs_iter.auto_paging_iter():
                    stripe_subs.append(sub)

            logger.info(f"[SYNC] {len(stripe_subs)} abonnements actifs/trialing trouvés sur Stripe")

            for sub in stripe_subs:
                cust_id = sub.customer
                ent = ent_by_cust.get(cust_id)
                if not ent:
                    results['details'].append(f"[STRIPE] Customer {cust_id}: aucune entreprise correspondante")
                    continue

                company_id = ent['id']
                nom = ent['nom']
                sub_id = sub.id
                sub_status = sub.status

                # Extraire prix et plan
                items = sub.get('items', {}).get('data', [])
                plan_name = 'Abonnement Constructo AI'
                price_monthly = 0
                if items:
                    price_data = items[0].get('price', {})
                    plan_name = price_data.get('nickname') or plan_name
                    price_monthly = (price_data.get('unit_amount') or 0) / 100

                # Dates
                current_period_start = datetime.fromtimestamp(sub.current_period_start)
                current_period_end = datetime.fromtimestamp(sub.current_period_end)
                trial_end = None
                if sub.trial_end:
                    trial_end = datetime.fromtimestamp(sub.trial_end)

                # Upsert: créer ou mettre à jour la ligne subscription
                cursor.execute('''
                    INSERT INTO public.subscriptions
                    (company_id, stripe_customer_id, stripe_subscription_id,
                     plan_name, status, price_monthly,
                     current_period_start, current_period_end,
                     trial_end, cancel_at_period_end, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (company_id) DO UPDATE SET
                        stripe_customer_id = EXCLUDED.stripe_customer_id,
                        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
                        plan_name = EXCLUDED.plan_name,
                        status = EXCLUDED.status,
                        price_monthly = EXCLUDED.price_monthly,
                        current_period_start = EXCLUDED.current_period_start,
                        current_period_end = EXCLUDED.current_period_end,
                        trial_end = EXCLUDED.trial_end,
                        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
                        updated_at = NOW()
                ''', (
                    company_id, cust_id, sub_id,
                    plan_name, sub_status, price_monthly,
                    current_period_start, current_period_end,
                    trial_end, sub.cancel_at_period_end
                ))

                created_count += 1
                results['details'].append(f"[SYNC] Company #{company_id} ({nom}): {sub_status} - {price_monthly}$/mois")
                logger.info(f"[SYNC] Upsert company #{company_id} ({nom}): {sub_status}, {price_monthly}$/mois")

            conn.commit()
            results['synced_from_stripe'] = created_count
            logger.info(f"[SYNC] Phase 2 terminée: {created_count} abonnements synchronisés depuis Stripe")

        except Exception as phase2_err:
            try:
                conn.rollback()  # Réinitialiser la transaction pour que Phase 3 puisse fonctionner
            except Exception:
                pass
            results['errors'] += 1
            results['details'].append(f"[SYNC Phase 2] Erreur: {str(phase2_err)}")
            logger.error(f"[SYNC] Erreur Phase 2: {phase2_err}")
            import traceback
            logger.error(f"[SYNC] Phase 2 Traceback: {traceback.format_exc()}")

        # ═══ PHASE 3: Détecter les abonnements DB "active" qui sont annulés sur Stripe ═══
        try:
            cursor.execute('''
                SELECT s.company_id, s.stripe_subscription_id, s.status,
                       e.nom as entreprise_nom
                FROM public.subscriptions s
                LEFT JOIN public.entreprises e ON s.company_id = e.id
                WHERE s.status IN ('active', 'trialing')
                AND s.stripe_subscription_id IS NOT NULL
                AND s.stripe_subscription_id != ''
            ''')
            db_active = cursor.fetchall()
            for row in db_active:
                if hasattr(row, 'get'):
                    cid = row.get('company_id')
                    sub_id = row.get('stripe_subscription_id')
                    nom = row.get('entreprise_nom', 'N/A')
                else:
                    cid = row[0]
                    sub_id = row[1]
                    nom = row[3] or 'N/A'

                try:
                    stripe_sub = stripe.Subscription.retrieve(sub_id)
                    if stripe_sub.status in ('canceled', 'unpaid', 'incomplete_expired'):
                        cursor.execute('''
                            UPDATE public.subscriptions
                            SET status = %s, updated_at = NOW()
                            WHERE company_id = %s
                        ''', (stripe_sub.status, cid))
                        results['updated'] += 1
                        results['details'].append(f"[STALE] Company #{cid} ({nom}): active → {stripe_sub.status}")
                        logger.info(f"[SYNC] Stale fix: Company #{cid} ({nom}): active → {stripe_sub.status}")
                except stripe.error.InvalidRequestError:
                    # Subscription n'existe plus sur Stripe
                    cursor.execute('''
                        UPDATE public.subscriptions
                        SET status = 'canceled', updated_at = NOW()
                        WHERE company_id = %s
                    ''', (cid,))
                    results['updated'] += 1
                    results['details'].append(f"[STALE] Company #{cid} ({nom}): sub introuvable sur Stripe → canceled")
                except Exception:
                    pass

            conn.commit()
        except Exception as phase3_err:
            logger.debug(f"[SYNC] Erreur Phase 3: {phase3_err}")

        # Détecter les abonnements orphelins (status actif sans stripe_subscription_id)
        try:
            cursor.execute('''
                SELECT s.company_id, s.status, s.stripe_customer_id, s.stripe_subscription_id,
                       e.nom as entreprise_nom
                FROM public.subscriptions s
                LEFT JOIN public.entreprises e ON s.company_id = e.id
                WHERE s.status IN ('active', 'trialing')
                AND (s.stripe_subscription_id IS NULL OR s.stripe_subscription_id = '')
            ''')
            orphans = cursor.fetchall()
            if orphans:
                results['orphelins'] = []
                for orphan in orphans:
                    if hasattr(orphan, 'get'):
                        nom = orphan.get('entreprise_nom', 'N/A')
                        cid = orphan.get('company_id')
                        has_customer = bool(orphan.get('stripe_customer_id'))
                    else:
                        nom = orphan[4] or 'N/A'
                        cid = orphan[0]
                        has_customer = bool(orphan[2])
                    msg = f"Company #{cid} ({nom}): status actif sans stripe_subscription_id (stripe_customer_id={'oui' if has_customer else 'NON'})"
                    results['orphelins'].append(msg)
                    results['details'].append(f"[ORPHELIN] {msg}")
                    logger.warning(f"[SYNC] {msg}")
        except Exception as orphan_err:
            logger.debug(f"[SYNC] Erreur detection orphelins: {orphan_err}")

        conn.close()

        logger.info(f"[SYNC] Synchronisation terminée: {results['updated']} mis à jour, {created_count} synchronisés depuis Stripe, {results['errors']} erreurs, {len(results.get('orphelins', []))} orphelin(s)")
        return results

    except Exception as e:
        logger.error(f"[SYNC] Erreur synchronisation: {e}")
        import traceback
        logger.error(f"[SYNC] Traceback: {traceback.format_exc()}")
        return {'updated': 0, 'errors': 1, 'details': [f'Erreur: {str(e)}']}


def update_subscription_status_manual(company_id: int, new_status: str) -> bool:
    """
    Met à jour manuellement le statut d'un abonnement.
    Utilisé pour les modifications depuis le CRM.

    Args:
        company_id: ID de l'entreprise
        new_status: Nouveau statut ('active', 'trialing', 'canceled', '' ou None)

    Returns:
        True si succès, False sinon
    """
    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()

        # Vérifier si une subscription existe déjà
        cursor.execute(
            "SELECT id FROM public.subscriptions WHERE company_id = %s",
            (company_id,)
        )
        existing = cursor.fetchone()

        if existing:
            # Mettre à jour le statut existant
            cursor.execute('''
                UPDATE public.subscriptions
                SET status = %s, updated_at = NOW()
                WHERE company_id = %s
            ''', (new_status if new_status else None, company_id))
        else:
            # Créer une nouvelle entrée si le statut n'est pas vide
            if new_status:
                cursor.execute('''
                    INSERT INTO public.subscriptions (company_id, status, created_at, updated_at)
                    VALUES (%s, %s, NOW(), NOW())
                ''', (company_id, new_status))

        conn.commit()
        conn.close()
        logger.info(f"[STRIPE] Statut manuel mis à jour: company_id={company_id}, status={new_status}")
        return True

    except Exception as e:
        logger.error(f"[STRIPE] Erreur mise à jour statut manuel: {e}")
        return False


def charge_ai_prepaid_credit(entreprise_id: int, product_type: str = 'ERP',
                             amount: float = 10.00) -> Dict:
    """
    Facture un credit IA prepaye sur la carte Stripe du client.
    Cree un InvoiceItem + Invoice et le finalise (charge immediate).
    Appele automatiquement quand le montant inclus mensuel est epuise.

    Args:
        entreprise_id: ID de l'entreprise
        product_type: Type de produit (ERP ou EXPERTS_IA)
        amount: Montant a facturer en USD (defaut: 10.00$)

    Returns:
        Dict avec 'success' (bool), 'stripe_invoice_id' (str|None), 'error' (str)
    """
    result = {'success': False, 'stripe_invoice_id': None, 'error': ''}

    if not init_stripe():
        result['error'] = 'Stripe non initialise'
        return result

    if not DB_AVAILABLE:
        result['error'] = 'Database non disponible'
        return result

    conn = None
    try:
        conn = database_config.get_connection()
        conn.autocommit = False
        cursor = conn.cursor()
        # SÉCURITÉ: Verrouiller la ligne entreprise pour éviter les charges concurrentes
        cursor.execute('''
            SELECT id FROM public.entreprises
            WHERE id = %s
            FOR UPDATE
        ''', (entreprise_id,))
        if not cursor.fetchone():
            result['error'] = 'Entreprise introuvable'
            conn.rollback()
            return result
        # Recuperer le stripe_customer_id depuis entreprises ou subscriptions
        cursor.execute('''
            SELECT stripe_customer_id FROM public.entreprises
            WHERE id = %s AND stripe_customer_id IS NOT NULL
        ''', (entreprise_id,))
        row = cursor.fetchone()

        if not row:
            cursor.execute('''
                SELECT stripe_customer_id FROM public.subscriptions
                WHERE company_id = %s AND stripe_customer_id IS NOT NULL
            ''', (entreprise_id,))
            row = cursor.fetchone()

        if not row:
            result['error'] = 'Aucun client Stripe associe. Veuillez souscrire a un abonnement.'
            return result

        stripe_customer_id = row[0] if isinstance(row, tuple) else row.get('stripe_customer_id')

        if not stripe_customer_id:
            result['error'] = 'Client Stripe non configure'
            return result

        # Convertir en cents CAD (Stripe utilise les cents)
        amount_cents = int(round(amount * 100))
        product_label = 'ERP Constructo AI' if product_type == 'ERP' else 'EXPERTS IA'

        now = datetime.now()

        # --- Resoudre le payment_method AVANT de creer la facture ---
        # Certains clients ont leur carte attachee a la subscription mais PAS
        # au Customer.invoice_settings.default_payment_method. Cela cause un 402
        # quand on cree une facture hors-abonnement (credits IA).
        payment_method_id = None
        try:
            customer_obj = stripe.Customer.retrieve(stripe_customer_id)
            # 1. Verifier si le Customer a deja un default_payment_method
            default_pm = None
            if hasattr(customer_obj, 'invoice_settings') and customer_obj.invoice_settings:
                default_pm = customer_obj.invoice_settings.get('default_payment_method')
            if not default_pm:
                default_pm = customer_obj.get('default_source')

            if default_pm:
                payment_method_id = default_pm
            else:
                # 2. Chercher sur la subscription active du client
                subs = stripe.Subscription.list(customer=stripe_customer_id, status='active', limit=1)
                if subs.data:
                    sub_pm = subs.data[0].get('default_payment_method')
                    if sub_pm:
                        payment_method_id = sub_pm
                        # Fixer le default sur le Customer pour les prochaines fois
                        stripe.Customer.modify(
                            stripe_customer_id,
                            invoice_settings={'default_payment_method': sub_pm}
                        )
                        logger.info(
                            f"[AI_CREDITS] default_payment_method corrige sur Customer "
                            f"{stripe_customer_id} depuis subscription (pm={sub_pm})"
                        )

                if not payment_method_id:
                    # 3. Dernier recours: lister les PaymentMethods du Customer
                    pms = stripe.PaymentMethod.list(customer=stripe_customer_id, type='card', limit=1)
                    if pms.data:
                        payment_method_id = pms.data[0].id
                        stripe.Customer.modify(
                            stripe_customer_id,
                            invoice_settings={'default_payment_method': payment_method_id}
                        )
                        logger.info(
                            f"[AI_CREDITS] default_payment_method corrige sur Customer "
                            f"{stripe_customer_id} depuis PaymentMethod liste (pm={payment_method_id})"
                        )

            if not payment_method_id:
                result['error'] = (
                    "Aucun moyen de paiement trouve. "
                    "Veuillez ajouter une carte de credit dans votre compte Stripe."
                )
                logger.error(
                    f"[AI_CREDITS] Aucun payment_method pour Customer {stripe_customer_id} "
                    f"(entreprise {entreprise_id})"
                )
                return result

        except stripe.error.StripeError as pm_err:
            logger.warning(f"[AI_CREDITS] Erreur resolution payment_method: {pm_err}")
            # On continue quand meme — pay() echouera si vraiment aucune carte

        # Creer la facture d'abord (en draft), puis attacher l'InvoiceItem directement
        # NOTE: On cree l'Invoice AVANT l'InvoiceItem avec invoice=invoice.id
        # pour eviter que l'item soit capture par une autre facture (race condition)
        invoice_params = {
            'customer': stripe_customer_id,
            'collection_method': 'charge_automatically',
            'description': f"Credit IA prepaye - {product_label}",
        }
        if payment_method_id:
            invoice_params['default_payment_method'] = payment_method_id

        invoice = stripe.Invoice.create(**invoice_params)

        # Attacher l'InvoiceItem directement a cette facture specifique
        stripe.InvoiceItem.create(
            customer=stripe_customer_id,
            amount=amount_cents,
            currency='cad',
            description=(
                f"Credit IA prepaye {product_label} - "
                f"{amount:.2f}$ ({now.strftime('%Y-%m-%d %H:%M')})"
            ),
            invoice=invoice.id
        )

        finalized = stripe.Invoice.finalize_invoice(invoice.id)

        # Forcer le paiement synchrone (leve CardError si la carte echoue)
        paid_invoice = stripe.Invoice.pay(finalized.id)

        if paid_invoice.status != 'paid':
            result['error'] = f"Paiement non confirme (status: {paid_invoice.status})"
            logger.error(
                f"[AI_CREDITS] Invoice #{finalized.id} finalisee mais status={paid_invoice.status} "
                f"pour entreprise {entreprise_id}"
            )
            return result

        result['stripe_invoice_id'] = str(paid_invoice.id)

        logger.info(
            f"[AI_CREDITS] Charge ${amount:.2f} pour entreprise {entreprise_id} "
            f"({product_type}) -> Stripe #{paid_invoice.id} (status: paid)"
        )

        # Ajouter le credit dans ai_prepaid_credits
        # NOTE: A ce point le paiement Stripe est confirme (status=paid).
        # On retourne success=True meme si l'ajout en DB echoue, pour ne pas bloquer l'utilisateur.
        result['success'] = True
        try:
            from ai_usage_tracker import add_prepaid_credit
            # Recuperer le nom de l'entreprise
            cursor.execute('SELECT nom FROM public.entreprises WHERE id = %s', (entreprise_id,))
            nom_row = cursor.fetchone()
            enom = (nom_row[0] if isinstance(nom_row, tuple) else nom_row.get('nom', '')) if nom_row else ''

            credit_added = add_prepaid_credit(
                entreprise_id=entreprise_id,
                product_type=product_type,
                amount=amount,
                stripe_id=str(finalized.id),
                entreprise_nom=enom
            )
            if not credit_added:
                logger.error(
                    f"[AI_CREDITS] ATTENTION: Charge OK (#{finalized.id}) mais add_prepaid_credit "
                    f"a retourne False pour entreprise {entreprise_id}. "
                    f"Reconciliation manuelle necessaire."
                )
        except Exception as credit_err:
            logger.error(
                f"[AI_CREDITS] CRITIQUE: Charge OK (#{finalized.id}) mais maj balance "
                f"echouee pour entreprise {entreprise_id}: {credit_err}. "
                f"Reconciliation manuelle necessaire."
            )

        conn.commit()
        return result

    except stripe.error.CardError as e:
        if conn:
            conn.rollback()
        result['error'] = f"Carte refusee: {e.user_message if hasattr(e, 'user_message') else str(e)}"
        logger.error(f"[AI_CREDITS] Carte refusee pour entreprise {entreprise_id}: {e}")
        return result

    except stripe.error.StripeError as e:
        if conn:
            conn.rollback()
        result['error'] = f"Erreur Stripe: {str(e)}"
        logger.error(f"[AI_CREDITS] Erreur Stripe pour entreprise {entreprise_id}: {e}")
        return result

    except Exception as e:
        if conn:
            conn.rollback()
        result['error'] = f"Erreur: {str(e)}"
        logger.error(f"[AI_CREDITS] Erreur pour entreprise {entreprise_id}: {e}")
        return result

    finally:
        if conn:
            conn.close()


# =============================================================================
# TEST
# =============================================================================

if __name__ == "__main__":
    print("=== Test Stripe Manager ===")
    print(f"Stripe disponible: {STRIPE_AVAILABLE}")
    print(f"Stripe configure: {is_stripe_configured()}")

    keys = get_stripe_keys()
    print(f"Secret key: {'***' + keys['secret_key'][-4:] if keys['secret_key'] else 'Non configure'}")
    print(f"Publishable key: {'***' + keys['publishable_key'][-4:] if keys['publishable_key'] else 'Non configure'}")
    print(f"Price ID: {keys['price_id'] or 'Non configure'}")
