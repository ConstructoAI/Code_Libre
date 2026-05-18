"""
ERP React - Stripe Routes
Checkout, subscription management, customer portal, AI prepaid credits.
"""

import os
import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db
from .. import erp_stripe

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stripe", tags=["Stripe"])


# ============================================
# REQUEST / RESPONSE MODELS
# ============================================

class CheckoutRequest(BaseModel):
    plan_type: str = "pro"
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


class CheckoutResponse(BaseModel):
    url: str


class PortalRequest(BaseModel):
    return_url: Optional[str] = None


class PortalResponse(BaseModel):
    url: str


class SubscriptionResponse(BaseModel):
    subscription_id: Optional[str] = None
    status: Optional[str] = None
    plan_name: Optional[str] = None
    plan_type: Optional[str] = None
    plan_amount: Optional[int] = None
    plan_interval: Optional[str] = None
    current_period_start: Optional[int] = None
    current_period_end: Optional[int] = None
    cancel_at_period_end: bool = False
    cancel_at: Optional[int] = None
    canceled_at: Optional[int] = None
    trial_start: Optional[int] = None
    trial_end: Optional[int] = None
    created: Optional[int] = None


class CancelResponse(BaseModel):
    success: bool
    message: str


class CreditsResponse(BaseModel):
    balance: float
    usage_this_month: float
    is_exempt: bool
    plan_type: Optional[str] = None


class RechargeRequest(BaseModel):
    amount: float = 10.00


class RechargeResponse(BaseModel):
    success: bool
    message: str
    new_balance: float = 0.0
    invoice_id: Optional[str] = None


# ============================================
# HELPER: get entreprise for current user
# ============================================

def _get_entreprise_for_user(user: ErpUser) -> dict:
    """
    Resolve the entreprise record for the authenticated user.
    Works for both tenant users (via schema) and super_admins.
    """
    if not user.schema:
        raise HTTPException(
            status_code=400,
            detail="Aucun contexte d'entreprise. Connectez-vous en tant qu'utilisateur tenant.",
        )

    slug = user.schema if user.schema.startswith("tenant_") else f"tenant_{user.schema}"
    conn = db.get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM public.entreprises WHERE slug = %s",
            (slug,),
        )
        row = cursor.fetchone()
        cursor.close()
        if not row:
            raise HTTPException(status_code=404, detail="Entreprise non trouvée")
        return dict(row)
    finally:
        conn.close()


# ============================================
# ENDPOINTS
# ============================================

@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(
    body: CheckoutRequest,
    user: ErpUser = Depends(get_current_user),
):
    """Create a Stripe Checkout session for a new or upgraded subscription."""
    entreprise = _get_entreprise_for_user(user)

    # Build default URLs based on common frontend patterns
    base_url = os.getenv("APP_BASE_URL", "http://localhost:5174")
    success_url = body.success_url or f"{base_url}/configuration?tab=abonnement&checkout=success"
    cancel_url = body.cancel_url or f"{base_url}/configuration?tab=abonnement&checkout=cancel"

    try:
        url = erp_stripe.create_checkout_session(
            entreprise_id=entreprise["id"],
            plan_type=body.plan_type,
            success_url=success_url,
            cancel_url=cancel_url,
            stripe_customer_id=entreprise.get("stripe_customer_id"),
        )
    except ValueError as exc:
        logger.warning("create_checkout_session config error: %s", exc)
        raise HTTPException(
            status_code=400,
            detail="Plan d'abonnement non disponible. Contactez le support.",
        )

    if not url:
        raise HTTPException(
            status_code=502,
            detail="Impossible de creer la session de paiement Stripe. Verifiez la configuration.",
        )

    return CheckoutResponse(url=url)


@router.get("/subscription", response_model=SubscriptionResponse)
async def get_subscription(
    user: ErpUser = Depends(get_current_user),
):
    """Get current subscription details for the user's entreprise."""
    entreprise = _get_entreprise_for_user(user)

    sub_id = entreprise.get("stripe_subscription_id")
    if not sub_id:
        # No Stripe subscription yet — return local data
        return SubscriptionResponse(
            status=entreprise.get("subscription_status"),
            plan_type=entreprise.get("plan_type"),
        )

    details = erp_stripe.get_subscription_details(sub_id)
    if not details:
        # Stripe unavailable — fall back to local data
        return SubscriptionResponse(
            subscription_id=sub_id,
            status=entreprise.get("subscription_status"),
            plan_type=entreprise.get("plan_type"),
        )

    return SubscriptionResponse(
        subscription_id=details.get("id"),
        status=details.get("status"),
        plan_name=details.get("plan_name"),
        plan_type=entreprise.get("plan_type"),
        plan_amount=details.get("plan_amount"),
        plan_interval=details.get("plan_interval"),
        current_period_start=details.get("current_period_start"),
        current_period_end=details.get("current_period_end"),
        cancel_at_period_end=details.get("cancel_at_period_end", False),
        cancel_at=details.get("cancel_at"),
        canceled_at=details.get("canceled_at"),
        trial_start=details.get("trial_start"),
        trial_end=details.get("trial_end"),
        created=details.get("created"),
    )


@router.post("/portal", response_model=PortalResponse)
async def create_portal(
    body: PortalRequest,
    user: ErpUser = Depends(get_current_user),
):
    """Create a Stripe Customer Portal session for managing subscription/payment."""
    entreprise = _get_entreprise_for_user(user)

    customer_id = entreprise.get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(
            status_code=400,
            detail="Aucun compte Stripe lie a cette entreprise. Souscrivez d'abord a un abonnement.",
        )

    base_url = os.getenv("APP_BASE_URL", "http://localhost:5174")
    return_url = body.return_url or f"{base_url}/configuration?tab=abonnement"

    url = erp_stripe.create_customer_portal_session(customer_id, return_url)
    if not url:
        raise HTTPException(
            status_code=502,
            detail="Impossible de creer la session du portail Stripe.",
        )

    return PortalResponse(url=url)


@router.post("/cancel", response_model=CancelResponse)
async def cancel_subscription(
    user: ErpUser = Depends(get_current_user),
):
    """Cancel the current subscription at the end of the billing period."""
    entreprise = _get_entreprise_for_user(user)

    sub_id = entreprise.get("stripe_subscription_id")
    if not sub_id:
        raise HTTPException(
            status_code=400,
            detail="Aucun abonnement Stripe actif a annuler.",
        )

    success = erp_stripe.cancel_subscription(sub_id)
    if not success:
        raise HTTPException(
            status_code=502,
            detail="Erreur lors de l'annulation de l'abonnement.",
        )

    # Update local status
    conn = None
    try:
        conn = db.get_conn()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE public.entreprises SET subscription_status = 'canceling' "
            "WHERE id = %s",
            (entreprise["id"],),
        )
        conn.commit()
        cursor.close()
    except Exception as exc:
        logger.error("Failed to update local subscription status: %s", exc)
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

    return CancelResponse(
        success=True,
        message="Abonnement annule. Il restera actif jusqu'a la fin de la periode en cours.",
    )


@router.get("/credits", response_model=CreditsResponse)
async def get_credits(
    user: ErpUser = Depends(get_current_user),
):
    """Get AI prepaid credit balance and usage for the current month."""
    entreprise = _get_entreprise_for_user(user)

    conn = db.get_conn()
    try:
        balance = erp_stripe.get_prepaid_balance(entreprise["id"], conn)
        usage = erp_stripe.get_credit_usage_this_month(entreprise["id"], conn)

        # Check if enterprise plan (exempt)
        is_exempt = entreprise.get("plan_type") == "enterprise"

        return CreditsResponse(
            balance=balance,
            usage_this_month=usage,
            is_exempt=is_exempt,
            plan_type=entreprise.get("plan_type"),
        )
    finally:
        conn.close()


@router.post("/credits/recharge", response_model=RechargeResponse)
async def recharge_credits(
    body: RechargeRequest,
    user: ErpUser = Depends(get_current_user),
):
    """Manually recharge AI prepaid credits via Stripe one-time invoice."""
    entreprise = _get_entreprise_for_user(user)

    customer_id = entreprise.get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(
            status_code=400,
            detail="Aucun compte Stripe lie. Souscrivez d'abord a un abonnement.",
        )

    # Validate amount
    amount = body.amount
    if amount < 5.0:
        raise HTTPException(status_code=400, detail="Le montant minimum de recharge est de 5.00 $.")
    if amount > 500.0:
        raise HTTPException(status_code=400, detail="Le montant maximum de recharge est de 500.00 $.")

    # Add credits FIRST (can be rolled back), then charge Stripe
    conn = db.get_conn()
    try:
        new_balance = erp_stripe.add_prepaid_credit(entreprise["id"], amount, conn)
        if new_balance < 0:
            raise HTTPException(
                status_code=500,
                detail="Erreur d'enregistrement des credits. Reessayez.",
            )

        # Charge via Stripe (credits already added — if this fails, rollback)
        result = erp_stripe.charge_ai_prepaid_credit(
            stripe_customer_id=customer_id,
            amount=amount,
            currency=erp_stripe.AI_CREDIT_CURRENCY,
        )

        if not result or not result.get("paid"):
            # Stripe failed — rollback the credit addition
            try:
                erp_stripe.add_prepaid_credit(entreprise["id"], -amount, conn)
            except Exception:
                logger.error(
                    "CRITICAL: Credit rollback failed for entreprise=%s amount=%.2f",
                    entreprise["id"], amount,
                )
            # Map Stripe decline_code to a clear FR message for the user.
            # Card-level errors (declined, expired, etc.) get HTTP 402 Payment
            # Required — the user can fix this by updating their card.
            # Non-card errors (Stripe API down, etc.) keep HTTP 502.
            error_type = (result or {}).get("error_type", "server_error")
            decline_code = (result or {}).get("decline_code") or ""
            stripe_user_message = (result or {}).get("user_message") or ""
            if error_type == "card_declined":
                detail = erp_stripe.format_decline_message_fr(
                    decline_code, stripe_user_message
                )
                raise HTTPException(status_code=402, detail=detail)
            # Non-card error (Stripe API down, network, internal) — keep 502
            raise HTTPException(
                status_code=502,
                detail=(
                    "Erreur temporaire du systeme de paiement. Reessayez "
                    "dans quelques minutes ou contactez le support si le "
                    "probleme persiste."
                ),
            )
    finally:
        conn.close()

    return RechargeResponse(
        success=True,
        message=f"Recharge de {amount:.2f} $ effectuee avec succes.",
        new_balance=new_balance,
        invoice_id=result.get("invoice_id"),
    )
