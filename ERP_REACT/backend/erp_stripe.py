"""
ERP React Backend - Stripe Integration
Full Stripe flow: subscriptions, checkout, customer portal, AI prepaid credits.
"""

import os
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

try:
    import stripe
except ImportError:
    stripe = None
    logger.warning("Stripe SDK not installed - subscription features unavailable")


# ============================================
# PRICE CONFIGURATION
# ============================================

# Map plan_type values to Stripe Price IDs
# Fallback: use STRIPE_PRICE_ID env var for the single default plan
STRIPE_PRICE_MAP = {
    "starter": os.getenv("STRIPE_PRICE_STARTER", ""),
    "pro": os.getenv("STRIPE_PRICE_PRO", os.getenv("STRIPE_PRICE_ID", "")),
    "enterprise": os.getenv("STRIPE_PRICE_ENTERPRISE", ""),
}

AI_CREDIT_RECHARGE_AMOUNT = float(os.getenv("AI_CREDIT_RECHARGE_AMOUNT", "10.00"))
AI_CREDIT_CURRENCY = os.getenv("AI_CREDIT_CURRENCY", "cad")


# ============================================
# STRIPE DECLINE CODE -> FR MESSAGE MAPPING
# ============================================
# Mapping from Stripe `decline_code` to a user-friendly French message,
# shared between routes/stripe_routes.py (manual recharge) and
# routers/ai.py (auto-recharge during AI chat). Hoisted to module scope
# so it's not rebuilt on every failed call. See
# https://stripe.com/docs/declines/codes for the full list.
STRIPE_DECLINE_FR_MESSAGES: dict = {
    "insufficient_funds": (
        "Carte refusee — fonds insuffisants. Verifiez le solde "
        "de votre carte ou utilisez une autre methode de paiement "
        "dans le portail Stripe."
    ),
    "lost_card": "Carte refusee — carte signalee perdue. Utilisez une autre carte.",
    "stolen_card": "Carte refusee — carte signalee volee. Utilisez une autre carte.",
    "expired_card": (
        "Carte expiree. Mettez a jour votre methode de paiement "
        "dans le portail Stripe (bouton « Gerer mon abonnement »)."
    ),
    "incorrect_cvc": "Code CVC incorrect. Verifiez les 3 chiffres au dos de votre carte.",
    "incorrect_number": "Numero de carte incorrect. Verifiez les 16 chiffres au recto.",
    "card_velocity_exceeded": (
        "Limite de transactions atteinte sur cette carte. "
        "Reessayez plus tard ou utilisez une autre carte."
    ),
    "do_not_honor": (
        "Carte refusee par votre banque (do_not_honor). "
        "Contactez votre banque ou utilisez une autre carte."
    ),
    "generic_decline": (
        "Carte refusee par votre banque. Contactez votre "
        "banque ou utilisez une autre carte."
    ),
    "processing_error": "Erreur de traitement temporaire. Reessayez dans quelques minutes.",
    "transaction_not_allowed": (
        "Transaction non autorisee par votre banque. "
        "Contactez votre banque ou utilisez une autre carte."
    ),
}

STRIPE_DECLINE_GENERIC_FR = (
    "Carte refusee. Mettez a jour votre methode de paiement "
    "dans le portail Stripe (bouton « Gerer mon abonnement »)."
)


def format_decline_message_fr(decline_code: str | None, user_message: str | None = None) -> str:
    """Map a Stripe decline_code to a clear FR message.
    Fallback chain: known decline_code -> stripe user_message -> generic FR.
    """
    if decline_code:
        msg = STRIPE_DECLINE_FR_MESSAGES.get(decline_code)
        if msg:
            return msg
    if user_message:
        return user_message
    return STRIPE_DECLINE_GENERIC_FR


# ============================================
# INITIALIZATION
# ============================================

def init_stripe() -> bool:
    """Initialize Stripe with API key."""
    if stripe is None:
        return False
    secret_key = os.getenv("STRIPE_SECRET_KEY", "")
    if not secret_key:
        logger.warning("STRIPE_SECRET_KEY not set")
        return False
    stripe.api_key = secret_key
    stripe.api_version = "2023-10-16"
    return True


# ============================================
# SUBSCRIPTION STATUS HELPERS
# ============================================

def is_subscription_active(subscription_status: str | None) -> bool:
    """Check if a Stripe subscription status indicates active access."""
    if not subscription_status:
        return False  # No status means no verified subscription
    return subscription_status in ("active", "trialing")


def get_subscription_info(stripe_subscription_id: str | None) -> dict | None:
    """Fetch subscription info from Stripe."""
    if stripe is None or not stripe_subscription_id:
        return None
    try:
        sub = stripe.Subscription.retrieve(stripe_subscription_id)
        return {
            "id": sub.id,
            "status": sub.status,
            "plan": sub.plan.nickname if sub.plan else None,
            "current_period_end": sub.current_period_end,
        }
    except Exception as exc:
        logger.error("Stripe subscription lookup error: %s", exc)
        return None


# ============================================
# CHECKOUT & SUBSCRIPTIONS
# ============================================

def create_signup_checkout_session(
    email: str,
    company_name: str,
    plan_type: str,
    success_url: str,
    cancel_url: str,
) -> dict | None:
    """
    Create a Stripe Checkout session for a NEW company signup.
    No entreprise_id needed — the company will be created by the webhook.
    Returns dict with 'session_id' and 'url', or None on failure.
    """
    if stripe is None:
        logger.warning("Stripe SDK not installed — cannot create signup checkout")
        return None

    if not init_stripe():
        return None

    price_id = STRIPE_PRICE_MAP.get(plan_type, "")
    if not price_id:
        price_id = os.getenv("STRIPE_PRICE_ID", "")
    if not price_id:
        logger.error(
            "No Stripe Price ID configured for plan_type=%s. "
            "Set STRIPE_PRICE_PRO or STRIPE_PRICE_ID env var.",
            plan_type,
        )
        raise ValueError(f"Aucun prix Stripe configure pour le plan '{plan_type}'.")

    try:
        signup_metadata = {
            "signup_flow": "new_company",
            "company_name": company_name,
            "email": email,
            "plan_type": plan_type,
        }

        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url + ("&" if "?" in success_url else "?") + "session_id={CHECKOUT_SESSION_ID}",
            cancel_url=cancel_url,
            customer_email=email,
            allow_promotion_codes=True,
            billing_address_collection="required",
            automatic_tax={"enabled": True},
            metadata=signup_metadata,
            subscription_data={"metadata": signup_metadata},
        )
        logger.info(
            "Signup checkout session created: session=%s email=%s plan=%s",
            session.id, email, plan_type,
        )
        return {"session_id": session.id, "url": session.url}
    except Exception as exc:
        logger.error("Failed to create signup checkout session: %s", exc)
        return None


def create_checkout_session(
    entreprise_id: int,
    plan_type: str,
    success_url: str,
    cancel_url: str,
    stripe_customer_id: str | None = None,
) -> str | None:
    """
    Create a Stripe Checkout session for a new subscription.
    Returns the session URL, or None on failure.
    """
    if stripe is None:
        logger.warning("Stripe SDK not installed - cannot create checkout session")
        return None

    if not init_stripe():
        return None

    # Resolve the price ID for the requested plan
    price_id = STRIPE_PRICE_MAP.get(plan_type, "")
    if not price_id:
        # Fallback to the single env var
        price_id = os.getenv("STRIPE_PRICE_ID", "")
    if not price_id:
        logger.error(
            "No Stripe Price ID configured for plan_type=%s. "
            "Set STRIPE_PRICE_PRO or STRIPE_PRICE_ID env var.",
            plan_type,
        )
        raise ValueError(f"Aucun prix Stripe configure pour le plan '{plan_type}'.")

    try:
        session_params = {
            "mode": "subscription",
            "line_items": [{"price": price_id, "quantity": 1}],
            "success_url": success_url,
            "cancel_url": cancel_url,
            "metadata": {
                "entreprise_id": str(entreprise_id),
                "plan_type": plan_type,
            },
            "subscription_data": {
                "metadata": {
                    "entreprise_id": str(entreprise_id),
                    "plan_type": plan_type,
                },
            },
        }

        # Attach to existing customer if we have one
        if stripe_customer_id:
            session_params["customer"] = stripe_customer_id
        else:
            session_params["customer_creation"] = "always"

        session = stripe.checkout.Session.create(**session_params)
        logger.info(
            "Checkout session created for entreprise_id=%s plan=%s session=%s",
            entreprise_id, plan_type, session.id,
        )
        return session.url
    except Exception as exc:
        logger.error("Failed to create checkout session: %s", exc)
        return None


def create_customer_portal_session(
    stripe_customer_id: str,
    return_url: str,
) -> str | None:
    """
    Create a Stripe Customer Portal session for managing subscription/payment.
    Returns the portal URL, or None on failure.
    """
    if stripe is None:
        logger.warning("Stripe SDK not installed - cannot create portal session")
        return None

    if not init_stripe():
        return None

    if not stripe_customer_id:
        logger.error("No stripe_customer_id provided for portal session")
        return None

    try:
        session = stripe.billing_portal.Session.create(
            customer=stripe_customer_id,
            return_url=return_url,
        )
        logger.info("Portal session created for customer=%s", stripe_customer_id)
        return session.url
    except Exception as exc:
        logger.error("Failed to create portal session: %s", exc)
        return None


def get_subscription_details(stripe_subscription_id: str | None) -> dict | None:
    """
    Get full subscription details from Stripe.
    Returns dict with plan, status, current_period_end, cancel_at, etc.
    """
    if stripe is None or not stripe_subscription_id:
        return None

    if not init_stripe():
        return None

    try:
        sub = stripe.Subscription.retrieve(
            stripe_subscription_id,
            expand=["default_payment_method", "latest_invoice"],
        )
        # Extract plan info
        plan_name = None
        plan_amount = None
        plan_interval = None
        sub_items = sub.get("items")
        if sub_items and sub_items.get("data"):
            item = sub_items["data"][0]
            price = item.get("price")
            if price:
                plan_name = price.get("nickname") or price.get("id")
                plan_amount = price.get("unit_amount")
                recurring = price.get("recurring")
                plan_interval = recurring.get("interval") if recurring else None

        return {
            "id": sub.id,
            "status": sub.status,
            "plan_name": plan_name,
            "plan_amount": plan_amount,
            "plan_interval": plan_interval,
            "current_period_start": sub.current_period_start,
            "current_period_end": sub.current_period_end,
            "cancel_at_period_end": sub.cancel_at_period_end,
            "cancel_at": sub.cancel_at,
            "canceled_at": sub.canceled_at,
            "trial_start": sub.trial_start,
            "trial_end": sub.trial_end,
            "created": sub.created,
        }
    except Exception as exc:
        logger.error("Stripe get_subscription_details error: %s", exc)
        return None


def cancel_subscription(stripe_subscription_id: str | None) -> bool:
    """
    Cancel a subscription at the end of the current billing period.
    Returns True on success, False on failure.
    """
    if stripe is None or not stripe_subscription_id:
        return False

    if not init_stripe():
        return False

    try:
        stripe.Subscription.modify(
            stripe_subscription_id,
            cancel_at_period_end=True,
        )
        logger.info("Subscription %s set to cancel at period end", stripe_subscription_id)
        return True
    except Exception as exc:
        logger.error("Failed to cancel subscription %s: %s", stripe_subscription_id, exc)
        return False


# ============================================
# AI PREPAID CREDITS
# ============================================

def charge_ai_prepaid_credit(
    stripe_customer_id: str,
    amount: float = 10.00,
    currency: str = "cad",
) -> dict | None:
    """
    Create and pay a Stripe invoice for AI credit recharge.
    Ported from the robust Streamlit stripe_manager.py logic:
    - Resolves payment method (customer → subscription → PM list)
    - Creates Invoice FIRST, then InvoiceItem with invoice=id (prevents race condition)
    - Finalizes and pays synchronously
    Returns payment info dict or None on failure.
    """
    if stripe is None:
        logger.warning("Stripe SDK not installed - cannot charge AI credit")
        return None

    if not init_stripe():
        return None

    if not stripe_customer_id:
        logger.error("No stripe_customer_id for AI credit charge")
        return None

    try:
        amount_cents = int(round(amount * 100))
        now = datetime.now()

        # --- Resolve payment method BEFORE creating invoice ---
        # Some clients have their card on the subscription but NOT on
        # Customer.invoice_settings.default_payment_method, causing 402
        # on out-of-subscription invoices (AI credits).
        payment_method_id = None
        try:
            customer_obj = stripe.Customer.retrieve(stripe_customer_id)
            # 1. Check Customer default_payment_method
            default_pm = None
            if hasattr(customer_obj, 'invoice_settings') and customer_obj.invoice_settings:
                default_pm = customer_obj.invoice_settings.get('default_payment_method')
            if not default_pm:
                default_pm = customer_obj.get('default_source')

            if default_pm:
                payment_method_id = default_pm
            else:
                # 2. Check active subscription
                subs = stripe.Subscription.list(customer=stripe_customer_id, status='active', limit=1)
                if subs.data:
                    sub_pm = subs.data[0].get('default_payment_method')
                    if sub_pm:
                        payment_method_id = sub_pm
                        # Fix default on Customer for next time
                        stripe.Customer.modify(
                            stripe_customer_id,
                            invoice_settings={'default_payment_method': sub_pm}
                        )
                        logger.info(
                            "AI credit: fixed default_payment_method on %s from subscription (pm=%s)",
                            stripe_customer_id, sub_pm,
                        )

                if not payment_method_id:
                    # 3. Last resort: list PaymentMethods
                    pms = stripe.PaymentMethod.list(customer=stripe_customer_id, type='card', limit=1)
                    if pms.data:
                        payment_method_id = pms.data[0].id
                        stripe.Customer.modify(
                            stripe_customer_id,
                            invoice_settings={'default_payment_method': payment_method_id}
                        )
                        logger.info(
                            "AI credit: fixed default_payment_method on %s from PM list (pm=%s)",
                            stripe_customer_id, payment_method_id,
                        )

            if not payment_method_id:
                logger.error("AI credit: no payment method for customer %s", stripe_customer_id)
                return None
        except Exception as pm_err:
            logger.warning("AI credit: error resolving payment_method: %s", pm_err)
            # Continue anyway — pay() will fail if truly no card

        # --- Create Invoice FIRST, then InvoiceItem with invoice=id ---
        # This prevents the InvoiceItem from being captured by another pending invoice
        invoice_params = {
            'customer': stripe_customer_id,
            'collection_method': 'charge_automatically',
            'description': "Credit IA prepaye - Constructo AI",
            'metadata': {'type': 'ai_credit_recharge'},
        }
        if payment_method_id:
            invoice_params['default_payment_method'] = payment_method_id

        invoice = stripe.Invoice.create(**invoice_params)

        # Attach InvoiceItem to this specific invoice
        stripe.InvoiceItem.create(
            customer=stripe_customer_id,
            amount=amount_cents,
            currency=currency,
            description=f"Credit IA prepaye - Recharge {amount:.2f}$ ({now.strftime('%Y-%m-%d %H:%M')})",
            invoice=invoice.id,
        )

        # Finalize then pay synchronously
        finalized = stripe.Invoice.finalize_invoice(invoice.id)
        paid_invoice = stripe.Invoice.pay(finalized.id)

        logger.info(
            "AI credit charged: customer=%s amount=%.2f %s invoice=%s status=%s",
            stripe_customer_id, amount, currency, paid_invoice.id, paid_invoice.status,
        )

        return {
            "invoice_id": paid_invoice.id,
            "amount": amount,
            "currency": currency,
            "status": paid_invoice.status,
            "paid": paid_invoice.status == "paid",
        }
    except Exception as exc:
        # Capture le decline_code Stripe pour que le route handler puisse
        # mapper a un message FR clair (insufficient_funds, expired_card, etc.)
        # plutot qu'un 502 generique.
        # `stripe.error.CardError` n'est pas un sous-classe d'`Exception` import
        # explicite (le SDK l'expose via `stripe.error`), donc on inspecte
        # `getattr` pour rester compatible si stripe n'est pas installe.
        code = getattr(exc, "code", None)
        decline_code = getattr(exc, "decline_code", None)
        user_message = getattr(exc, "user_message", None)
        # `stripe.error.CardError` n'est pas toujours resolvable via getattr
        # (selon la version du SDK et l'ordre d'init des sous-modules), donc
        # on detecte un card error via la presence de `decline_code` qui
        # n'existe que sur les erreurs de carte Stripe.
        is_card_error = decline_code is not None
        if is_card_error:
            logger.warning(
                "AI credit charge declined: customer=%s code=%s decline_code=%s message=%s",
                stripe_customer_id, code, decline_code, user_message,
            )
        else:
            logger.error("Failed to charge AI credit: %s", exc)
        return {
            "paid": False,
            "error_type": "card_declined" if is_card_error else "server_error",
            "code": code,
            "decline_code": decline_code,
            "user_message": user_message,
        }


def get_prepaid_balance(entreprise_id: int, conn) -> float:
    """
    Get AI prepaid credit balance from the ai_prepaid_credits table.
    Returns balance as float (CAD). Returns 0.0 if table doesn't exist or on error.
    Targets the current month's ERP row (composite key: entreprise_id, product_type, billing_year, billing_month).
    """
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COALESCE(balance_cad, 0) AS balance "
            "FROM public.ai_prepaid_credits "
            "WHERE entreprise_id = %s AND product_type = 'ERP' "
            "AND billing_year = EXTRACT(YEAR FROM CURRENT_DATE)::int "
            "AND billing_month = EXTRACT(MONTH FROM CURRENT_DATE)::int",
            (entreprise_id,),
        )
        row = cursor.fetchone()
        cursor.close()
        if row:
            return float(row["balance"])
        return 0.0
    except Exception as exc:
        logger.error("get_prepaid_balance error for entreprise_id=%s: %s", entreprise_id, exc)
        return 0.0


def deduct_prepaid_credit(
    entreprise_id: int,
    amount: float,
    feature: str,
    conn,
) -> bool:
    """
    Deduct amount from prepaid credits for an AI feature usage.
    Returns False if insufficient balance or on error.
    """
    try:
        cursor = conn.cursor()
        # Atomic update: only deduct if balance is sufficient (current month ERP row)
        cursor.execute(
            "UPDATE public.ai_prepaid_credits "
            "SET balance_cad = balance_cad - %s, "
            "    updated_at = NOW() "
            "WHERE entreprise_id = %s AND product_type = 'ERP' "
            "AND billing_year = EXTRACT(YEAR FROM CURRENT_DATE)::int "
            "AND billing_month = EXTRACT(MONTH FROM CURRENT_DATE)::int "
            "AND balance_cad >= %s "
            "RETURNING balance_cad",
            (amount, entreprise_id, amount),
        )
        row = cursor.fetchone()
        if row is None:
            cursor.close()
            logger.warning(
                "Insufficient AI credits for entreprise_id=%s amount=%.4f feature=%s",
                entreprise_id, amount, feature,
            )
            return False

        # Log the usage in ai_usage_tracking (the real table)
        cursor.execute(
            "INSERT INTO public.ai_usage_tracking "
            "(tenant_slug, cost_usd, feature, created_at) "
            "VALUES ("
            "  (SELECT REPLACE(slug, 'tenant_', '') FROM public.entreprises WHERE id = %s),"
            "  %s, %s, NOW()"
            ")",
            (entreprise_id, amount, feature),
        )
        conn.commit()
        cursor.close()

        logger.info(
            "AI credit deducted: entreprise_id=%s amount=%.4f feature=%s remaining=%.2f",
            entreprise_id, amount, feature, float(row["balance_cad"]),
        )
        return True
    except Exception as exc:
        logger.error("deduct_prepaid_credit error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        return False


def add_prepaid_credit(entreprise_id: int, amount: float, conn) -> float:
    """
    Add credit to the prepaid balance. Creates the row if it doesn't exist.
    Uses composite key (entreprise_id, product_type, billing_year, billing_month).
    Returns the new balance, or -1.0 on failure.
    """
    try:
        cursor = conn.cursor()
        # Ensure the UNIQUE constraint exists before the ON CONFLICT upsert.
        # The table may have been created by a code path that omitted the constraint,
        # causing: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS "
            "uq_ai_prepaid_credits_ent_prod_year_month "
            "ON public.ai_prepaid_credits "
            "(entreprise_id, product_type, billing_year, billing_month)"
        )
        cursor.execute(
            "INSERT INTO public.ai_prepaid_credits "
            "(entreprise_id, product_type, billing_year, billing_month, "
            " balance_cad, balance_usd, total_charged_usd, charges_count, updated_at) "
            "VALUES (%s, 'ERP', "
            " EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM CURRENT_DATE)::int, "
            " %s, %s, CASE WHEN %s > 0 THEN %s ELSE 0 END, CASE WHEN %s > 0 THEN 1 ELSE 0 END, NOW()) "
            "ON CONFLICT (entreprise_id, product_type, billing_year, billing_month) "
            "DO UPDATE SET balance_cad = ai_prepaid_credits.balance_cad + EXCLUDED.balance_cad, "
            "             balance_usd = ai_prepaid_credits.balance_usd + EXCLUDED.balance_usd, "
            "             total_charged_usd = ai_prepaid_credits.total_charged_usd + EXCLUDED.total_charged_usd, "
            "             charges_count = ai_prepaid_credits.charges_count + EXCLUDED.charges_count, "
            "             updated_at = NOW() "
            "RETURNING balance_cad",
            (entreprise_id, amount, amount, amount, amount, amount),
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        new_balance = float(row["balance_cad"]) if row else amount
        logger.info(
            "AI credit added: entreprise_id=%s amount=%.2f new_balance=%.2f",
            entreprise_id, amount, new_balance,
        )
        return new_balance
    except Exception as exc:
        logger.error("add_prepaid_credit error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        return -1.0


def get_credit_usage_this_month(entreprise_id: int, conn) -> float:
    """Get total AI credit usage for the current month."""
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COALESCE(SUM(t.cost_usd), 0) AS total "
            "FROM public.ai_usage_tracking t "
            "WHERE t.tenant_slug = ("
            "  SELECT REPLACE(slug, 'tenant_', '') FROM public.entreprises WHERE id = %s"
            ") "
            "AND t.created_at >= date_trunc('month', CURRENT_DATE)",
            (entreprise_id,),
        )
        row = cursor.fetchone()
        cursor.close()
        return float(row["total"]) if row else 0.0
    except Exception as exc:
        logger.error("get_credit_usage_this_month error: %s", exc)
        return 0.0


def check_ai_quota(entreprise_id: int, conn) -> dict:
    """
    Check if enterprise has AI credits available.
    Returns {allowed: bool, balance: float, message: str}.
    """
    try:
        balance = get_prepaid_balance(entreprise_id, conn)

        # Check if enterprise is exempt (e.g. enterprise plan)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT plan_type FROM public.entreprises WHERE id = %s",
            (entreprise_id,),
        )
        row = cursor.fetchone()
        cursor.close()

        plan_type = row["plan_type"] if row else None

        # Enterprise plan gets unlimited AI
        if plan_type == "enterprise":
            return {
                "allowed": True,
                "balance": balance,
                "is_exempt": True,
                "message": "Plan entreprise - acces IA illimite",
            }

        if balance <= 0:
            return {
                "allowed": False,
                "balance": 0.0,
                "is_exempt": False,
                "message": "Credits IA insuffisants. Veuillez recharger votre solde.",
            }

        return {
            "allowed": True,
            "balance": balance,
            "is_exempt": False,
            "message": f"Credits IA disponibles: {balance:.2f} $",
        }
    except Exception as exc:
        logger.error("check_ai_quota error: %s", exc)
        return {
            "allowed": False,
            "balance": 0.0,
            "is_exempt": False,
            "message": "Erreur lors de la verification des credits IA.",
        }
