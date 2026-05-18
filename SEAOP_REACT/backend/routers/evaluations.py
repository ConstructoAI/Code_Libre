"""
SEAOP React - Evaluations Router
Endpoints for rating entrepreneurs after project completion.
"""

import logging
from typing import List

from fastapi import APIRouter, HTTPException, Depends

from ..seaop_models import EvaluationCreate, EvaluationResponse
from ..seaop_auth import get_current_user, get_optional_user, require_role, SeaopUser
from .. import seaop_database as db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/evaluations", tags=["Evaluations"])


# ============================================
# CREATE / UPDATE EVALUATION (Client)
# ============================================

@router.post("", response_model=EvaluationResponse, status_code=201)
async def create_evaluation(
    body: EvaluationCreate,
    user: SeaopUser = Depends(require_role("client")),
):
    """
    Client rates a soumission (bid). Note must be 1-5.
    UPSERT: updates the evaluation if the client already rated this soumission.
    Auto-updates the entrepreneur's evaluations_moyenne and nombre_evaluations.
    """
    # Validate note range (also enforced by Pydantic, but explicit for clarity)
    if body.note < 1 or body.note > 5:
        raise HTTPException(status_code=400, detail="La note doit etre entre 1 et 5")

    # Verify the soumission exists
    soumission = db.get_soumission_by_id(body.soumission_id)
    if not soumission:
        raise HTTPException(status_code=404, detail="Soumission non trouvee")

    # Verify the client owns the lead associated with this soumission
    lead = db.get_lead_by_id(soumission["lead_id"])
    if not lead:
        raise HTTPException(status_code=404, detail="Projet associe non trouve")
    if user.email != lead.get("email"):
        raise HTTPException(
            status_code=403,
            detail="Vous ne pouvez evaluer que les soumissions de vos propres projets",
        )

    eval_data = {
        "soumission_id": body.soumission_id,
        "evaluateur_type": "client",
        "note": body.note,
        "commentaire": body.commentaire,
    }

    try:
        evaluation = db.upsert_evaluation(eval_data)
    except Exception as exc:
        logger.error("Error creating/updating evaluation: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de l'evaluation")

    # Notify the entrepreneur
    try:
        db.create_notification({
            "utilisateur_type": "entrepreneur",
            "user_id": soumission["entrepreneur_id"],
            "type_notification": "nouvelle_evaluation",
            "titre": "Nouvelle evaluation recue",
            "message": f"Vous avez recu une evaluation de {body.note}/5 pour le projet {lead.get('numero_reference', '')}.",
            "lien_id": soumission["id"],
        })
    except Exception as exc:
        logger.warning("Failed to create notification for evaluation: %s", exc)

    logger.info(
        "Evaluation upserted: soumission=%s note=%s by=%s",
        body.soumission_id, body.note, user.email,
    )
    return EvaluationResponse(**evaluation)


# ============================================
# ENTREPRENEUR EVALUATION STATS (Public)
# ============================================

@router.get("/entrepreneur/{entrepreneur_id}")
async def get_entrepreneur_evaluations(
    entrepreneur_id: int,
    user=Depends(get_optional_user),
):
    """
    Get evaluation stats for an entrepreneur. Public endpoint.
    Returns: average rating, count, and recent comments (last 10).
    """
    # Verify the entrepreneur exists
    entrepreneur = db.get_entrepreneur_by_id(entrepreneur_id)
    if not entrepreneur:
        raise HTTPException(status_code=404, detail="Entrepreneur non trouve")

    try:
        stats = db.get_evaluations_for_entrepreneur(entrepreneur_id, limit=10)
    except Exception as exc:
        logger.error("Error fetching evaluations for entrepreneur %s: %s", entrepreneur_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des evaluations")

    return {
        "entrepreneur_id": entrepreneur_id,
        "nom_entreprise": entrepreneur.get("nom_entreprise"),
        "moyenne": round(stats["moyenne"], 2),
        "count": stats["count"],
        "evaluations": [EvaluationResponse(**e) for e in stats["evaluations"]],
    }


# ============================================
# EVALUATION FOR A SPECIFIC BID
# ============================================

@router.get("/soumission/{soumission_id}", response_model=List[EvaluationResponse])
async def get_evaluations_for_soumission(
    soumission_id: int,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Get evaluations for a specific bid.
    Requires the entrepreneur who submitted it, the client who owns the lead, or admin.
    """
    soumission = db.get_soumission_by_id(soumission_id)
    if not soumission:
        raise HTTPException(status_code=404, detail="Soumission non trouvee")

    # Authorization: participant or admin
    if user.user_type == "entrepreneur":
        if soumission["entrepreneur_id"] != user.user_id:
            raise HTTPException(status_code=403, detail="Acces refuse a cette soumission")
    elif user.user_type == "client":
        lead = db.get_lead_by_id(soumission["lead_id"])
        if not lead or user.email != lead.get("email"):
            raise HTTPException(status_code=403, detail="Acces refuse a cette soumission")
    elif user.user_type not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Acces refuse")

    try:
        evaluations = db.get_evaluations_for_soumission(soumission_id)
    except Exception as exc:
        logger.error("Error fetching evaluations for soumission %s: %s", soumission_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des evaluations")

    return [EvaluationResponse(**e) for e in evaluations]
