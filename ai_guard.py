"""
ai_guard.py — Module centralise de protection des appels IA

Verifie le quota et auto-recharge les credits prepayes Stripe
AVANT chaque appel Claude. Tout appel IA non exempt DOIT passer par ici.

Exemptions (Constructo AI paie):
  - Chat "Sylvain Leduc" sur la landing page (login_page_multitenant.py)
  - Compte demo Construction Demo (entreprise_id=105)
"""

import logging
import os

logger = logging.getLogger(__name__)

# Montant par defaut de recharge automatique (en CAD)
_DEFAULT_RECHARGE_AMOUNT = 10.00

# Entreprises exemptees de facturation IA (Constructo AI paie)
# Default: 1=Constructo AI, 105=Construction Demo (ERP), 172=Construction Demo IA
# Override via env var AI_GUARD_EXEMPT_IDS (comma-separated ints)
def _parse_exempt_ids():
    env_val = os.environ.get('AI_GUARD_EXEMPT_IDS')
    if env_val:
        try:
            return {int(x.strip()) for x in env_val.split(',') if x.strip()}
        except ValueError:
            logger.warning(
                f"[AI_GUARD] Invalid AI_GUARD_EXEMPT_IDS value: {env_val!r}, "
                "falling back to defaults {1, 105, 172}"
            )
    return {1, 105, 172}

_EXEMPT_ENTREPRISE_IDS = _parse_exempt_ids()


def get_current_entreprise_id():
    """
    Recupere l'entreprise_id du tenant connecte depuis st.session_state.
    Retourne None si non disponible (ex: page de login, tests).
    """
    try:
        import streamlit as st
        return (
            st.session_state.get('entreprise_id')
            or st.session_state.get('tenant_id')
            or st.session_state.get('company_id')
        )
    except Exception:
        return None


def check_and_charge_ai(entreprise_id=None, product_type=None, express_payment_token=None, express_bypass=False):
    """
    Vérifie le quota IA et auto-recharge si nécessaire.

    Args:
        entreprise_id: ID de l'entreprise (auto-détecté depuis session si None)
        product_type: 'ERP' ou 'EXPERTS_IA' — auto-detecte depuis la table entreprises si None
        express_payment_token: Token de paiement Stripe pour Estimation Express.
                               Vérifié cryptographiquement contre la DB avant d'autoriser.
        express_bypass: Si True, autorise l'appel sans vérification de quota (utilisé par
                        le pipeline Estimation Express après paiement Stripe vérifié).

    Returns:
        tuple (allowed: bool, error_message: str)
        - (True, '') si l'appel est autorisé
        - (False, 'message') si l'appel est bloqué
    """
    # Express bypass — autorise directement après vérification de paiement Stripe
    if express_bypass:
        return True, ''

    # Estimation Express — vérifier le token de paiement contre la DB
    if express_payment_token is not None:
        try:
            from db_utils import get_db_connection
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, used, expires_at FROM express_payment_tokens "
                "WHERE token = %s AND used = FALSE AND expires_at > NOW()",
                (express_payment_token,)
            )
            row = cursor.fetchone()

            if row is None:
                cursor.close()
                conn.close()
                logger.warning(
                    f"[AI_GUARD] Invalid or expired express_payment_token: "
                    f"{express_payment_token[:16]}..."
                )
                return False, "Token de paiement express invalide ou expiré."

            # Marquer le token comme utilisé pour empêcher la réutilisation
            cursor.execute(
                "UPDATE express_payment_tokens SET used = TRUE WHERE token = %s",
                (express_payment_token,)
            )
            conn.commit()
            cursor.close()
            conn.close()

            logger.info(
                f"[AI_GUARD] Express payment token verified and marked used (token_id={row[0]}) "
                f"— appel IA autorisé"
            )
            return True, ''
        except Exception as e:
            logger.error(f"[AI_GUARD] Error verifying express_payment_token: {e}")
            return False, "Erreur de vérification du token de paiement express."

    # Récupérer entreprise_id si pas fourni
    if entreprise_id is None:
        entreprise_id = get_current_entreprise_id()

    if not entreprise_id:
        logger.warning("[AI_GUARD] Aucun entreprise_id disponible — appel IA bloqué")
        return False, "Session expirée. Veuillez vous reconnecter."

    # Auto-detection du product_type depuis la table entreprises
    if product_type is None:
        try:
            from ai_usage_tracker import get_entreprise_product_type
            product_type = get_entreprise_product_type(entreprise_id)
        except Exception as e:
            logger.warning(
                f"[AI_GUARD] Failed to detect product_type for entreprise {entreprise_id}: {e}. "
                f"Blocking call as a safety measure."
            )
            return False, "Impossible de déterminer le type de produit. Veuillez réessayer."

    # Comptes exempts — Constructo AI paie (ex: compte demo presentation)
    if int(entreprise_id) in _EXEMPT_ENTREPRISE_IDS:
        return True, ''

    try:
        from ai_usage_tracker import check_ai_quota

        quota = check_ai_quota(entreprise_id, product_type)

        if quota.get('allowed', False):
            # Credits disponibles — autoriser
            return True, ''

        # Credits insuffisants — tenter une recharge automatique
        if quota.get('needs_prepaid_charge', False):
            try:
                from stripe_manager import charge_ai_prepaid_credit

                charge_result = charge_ai_prepaid_credit(
                    entreprise_id,
                    product_type,
                    amount=_DEFAULT_RECHARGE_AMOUNT
                )

                if charge_result.get('success'):
                    logger.info(
                        f"[AI_GUARD] Auto-recharge {_DEFAULT_RECHARGE_AMOUNT}$ reussie "
                        f"pour entreprise {entreprise_id} ({product_type})"
                    )
                    return True, ''
                else:
                    error = charge_result.get('error', 'Erreur inconnue')
                    logger.warning(
                        f"[AI_GUARD] Echec auto-recharge pour entreprise {entreprise_id}: {error}"
                    )
                    return False, (
                        f"Crédits IA insuffisants. La recharge automatique a échoué: {error}. "
                        f"Veuillez vérifier votre moyen de paiement."
                    )

            except ImportError:
                logger.error("[AI_GUARD] stripe_manager non disponible pour auto-recharge")
                return False, "Service de paiement non disponible. Veuillez réessayer."

        # Pas de recharge possible (pas de carte, abonnement annule, etc.)
        message = quota.get('message', '')
        return False, message or "Crédits IA insuffisants. Veuillez recharger vos crédits."

    except ImportError:
        logger.error("[AI_GUARD] ai_usage_tracker non disponible")
        return False, "Service de vérification IA non disponible."
    except Exception as e:
        logger.error(f"[AI_GUARD] Erreur inattendue: {e}")
        # Fail-closed: bloquer en cas d'erreur pour ne pas offrir de l'IA gratuite
        return False, "Erreur de vérification des crédits IA. Veuillez réessayer."
