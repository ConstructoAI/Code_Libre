"""
SEAOP React - Soumissions Router
Endpoints for bid management: submit, list, view, update, accept/reject.
"""

import asyncio
import logging
from typing import List

from fastapi import APIRouter, HTTPException, Depends

from ..seaop_models import SoumissionCreate, SoumissionResponse, SoumissionStatusUpdate
from ..seaop_auth import get_current_user, require_role, SeaopUser
from .. import seaop_database as db
from ..seaop_email import send_new_soumission_email, send_soumission_status_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/soumissions", tags=["Soumissions"])


# ============================================
# SUBMIT A BID (Entrepreneur)
# ============================================

@router.post("", response_model=SoumissionResponse, status_code=201)
async def create_soumission(
    body: SoumissionCreate,
    user: SeaopUser = Depends(require_role("entrepreneur")),
):
    """
    Entrepreneur submits a bid on a lead.
    Requires entrepreneur role.
    Creates a notification for the lead owner.
    """
    # Verify the lead exists and accepts soumissions
    lead = db.get_lead_by_id(body.lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Projet non trouve")
    if not lead.get("accepte_soumissions", True):
        raise HTTPException(status_code=400, detail="Ce projet n'accepte plus de soumissions")

    # Check if this entrepreneur already submitted on this lead
    existing = db.get_soumissions_for_lead(body.lead_id)
    for s in existing:
        if s.get("entrepreneur_id") == user.user_id:
            raise HTTPException(
                status_code=409,
                detail="Vous avez deja soumis une offre pour ce projet",
            )

    soumission_data = {
        "lead_id": body.lead_id,
        "entrepreneur_id": user.user_id,
        "montant": body.montant,
        "description_travaux": body.description_travaux,
        "delai_execution": body.delai_execution,
        "validite_offre": body.validite_offre,
        "inclusions": body.inclusions,
        "exclusions": body.exclusions,
        "conditions": body.conditions,
        "cautionnement_inclus": body.cautionnement_inclus,
        "montant_cautionnement": body.montant_cautionnement,
        "type_cautionnement": body.type_cautionnement,
    }

    try:
        soumission = db.create_soumission(soumission_data)
    except Exception as exc:
        logger.error("Error creating soumission: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la soumission")

    # Create notification for the lead owner (client)
    try:
        entrepreneur = db.get_entrepreneur_by_id(user.user_id)
        nom_entreprise = entrepreneur.get("nom_entreprise", "Un entrepreneur") if entrepreneur else "Un entrepreneur"
        lead_nom = lead.get("nom", lead.get("numero_reference", ""))
        db.create_notification({
            "utilisateur_type": "client",
            "user_id": 0,  # Client identified by lead email, not numeric ID
            "type_notification": "soumission",
            "titre": "Nouvelle soumission reçue",
            "message": f"{nom_entreprise} a soumis une offre de {body.montant:.2f}$ pour votre projet \"{lead_nom}\".",
            "lien_id": body.lead_id,
        })
    except Exception as exc:
        # Notification failure should not block the soumission
        logger.warning("Failed to create notification for new soumission: %s", exc)

    # Send email notification to client
    try:
        client_email = lead.get("email")
        if client_email:
            lead_nom = lead.get("nom", lead.get("numero_reference", ""))
            ref = lead.get("numero_reference", "")
            loop = asyncio.get_running_loop()
            loop.run_in_executor(
                None, send_new_soumission_email, client_email, lead_nom, body.montant, ref,
            )
    except Exception as exc:
        logger.warning("Failed to send new-soumission email: %s", exc)

    logger.info(
        "Soumission created: id=%s lead=%s entrepreneur=%s",
        soumission["id"], body.lead_id, user.user_id,
    )
    return SoumissionResponse(**soumission)


# ============================================
# LIST BIDS FOR A LEAD (Client/Admin)
# ============================================

@router.get("/lead/{lead_id}", response_model=List[SoumissionResponse])
async def get_soumissions_for_lead(
    lead_id: int,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Get all bids for a lead, with entrepreneur info (name, RBQ, rating).
    Requires the client who owns the lead, or admin.
    """
    lead = db.get_lead_by_id(lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Projet non trouve")

    # Authorization: client must own the lead, admin can view any
    if user.user_type == "client":
        if user.email != lead.get("email"):
            raise HTTPException(status_code=403, detail="Acces refuse a ce projet")
    elif user.user_type not in ("admin", "super_admin"):
        # Entrepreneurs can see their own soumissions via /mes-soumissions
        raise HTTPException(status_code=403, detail="Acces refuse")

    try:
        soumissions = db.get_soumissions_for_lead(lead_id)
    except Exception as exc:
        logger.error("Error fetching soumissions for lead %s: %s", lead_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des soumissions")

    return [SoumissionResponse(**s) for s in soumissions]


# ============================================
# MY BIDS (Entrepreneur)
# ============================================

@router.get("/mes-soumissions", response_model=List[SoumissionResponse])
async def get_my_soumissions(
    user: SeaopUser = Depends(require_role("entrepreneur")),
):
    """
    Get all bids submitted by the authenticated entrepreneur.
    Requires entrepreneur role.
    """
    try:
        soumissions = db.get_soumissions_by_entrepreneur(user.user_id)
    except Exception as exc:
        logger.error("Error fetching soumissions for entrepreneur %s: %s", user.user_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation de vos soumissions")

    return [SoumissionResponse(**s) for s in soumissions]


# ============================================
# SINGLE BID DETAIL
# ============================================

@router.get("/{soumission_id}", response_model=SoumissionResponse)
async def get_soumission(
    soumission_id: int,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Get a single bid by ID.
    Requires the entrepreneur who submitted it, the client who owns the lead, or admin.
    """
    soumission = db.get_soumission_by_id(soumission_id)
    if not soumission:
        raise HTTPException(status_code=404, detail="Soumission non trouvee")

    # Authorization check
    if user.user_type == "entrepreneur":
        if soumission["entrepreneur_id"] != user.user_id:
            raise HTTPException(status_code=403, detail="Acces refuse a cette soumission")
    elif user.user_type == "client":
        lead = db.get_lead_by_id(soumission["lead_id"])
        if not lead or user.email != lead.get("email"):
            raise HTTPException(status_code=403, detail="Acces refuse a cette soumission")
    elif user.user_type not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Acces refuse")

    return SoumissionResponse(**soumission)


# ============================================
# UPDATE BID (Entrepreneur, only if 'envoyee')
# ============================================

@router.put("/{soumission_id}", response_model=SoumissionResponse)
async def update_soumission(
    soumission_id: int,
    body: SoumissionCreate,
    user: SeaopUser = Depends(require_role("entrepreneur")),
):
    """
    Entrepreneur updates their bid. Only allowed if status is 'envoyee'.
    """
    soumission = db.get_soumission_by_id(soumission_id)
    if not soumission:
        raise HTTPException(status_code=404, detail="Soumission non trouvee")

    # Must be the submitting entrepreneur
    if soumission["entrepreneur_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Vous ne pouvez modifier que vos propres soumissions")

    # Can only update if status is 'envoyee'
    if soumission.get("statut") != "envoyee":
        raise HTTPException(
            status_code=400,
            detail=f"Impossible de modifier une soumission avec le statut '{soumission.get('statut')}'. "
                   "Seules les soumissions avec le statut 'envoyee' peuvent etre modifiees.",
        )

    update_data = {
        "montant": body.montant,
        "description_travaux": body.description_travaux,
        "delai_execution": body.delai_execution,
        "validite_offre": body.validite_offre,
        "inclusions": body.inclusions,
        "exclusions": body.exclusions,
        "conditions": body.conditions,
    }

    try:
        updated = db.update_soumission(soumission_id, update_data)
    except Exception as exc:
        logger.error("Error updating soumission %s: %s", soumission_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour de la soumission")

    if not updated:
        raise HTTPException(status_code=404, detail="Soumission non trouvee apres mise a jour")

    return SoumissionResponse(**updated)


# ============================================
# ACCEPT / REJECT BID (Client)
# ============================================

@router.put("/{soumission_id}/statut", response_model=SoumissionResponse)
async def update_soumission_status(
    soumission_id: int,
    body: SoumissionStatusUpdate,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Client accepts or rejects a bid.
    Validates the client owns the lead.
    If accepting: marks lead as 'attribue' and rejects all other bids.
    Creates a notification for the entrepreneur.
    """
    soumission = db.get_soumission_by_id(soumission_id)
    if not soumission:
        raise HTTPException(status_code=404, detail="Soumission non trouvee")

    # Validate the new status
    valid_statuses = ["vue", "en_evaluation", "acceptee", "refusee"]
    if body.statut not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Statut invalide. Valeurs acceptees: {', '.join(valid_statuses)}",
        )

    # Authorization: client must own the lead, or admin
    lead = db.get_lead_by_id(soumission["lead_id"])
    if not lead:
        raise HTTPException(status_code=404, detail="Projet associe non trouve")

    if user.user_type == "client":
        if user.email != lead.get("email"):
            raise HTTPException(status_code=403, detail="Vous ne pouvez gerer que les soumissions de vos projets")
    elif user.user_type not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Acces refuse")

    try:
        updated = db.update_soumission_status(soumission_id, body.statut)
    except Exception as exc:
        logger.error("Error updating soumission status %s: %s", soumission_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour du statut")

    if not updated:
        raise HTTPException(status_code=404, detail="Soumission non trouvee apres mise a jour")

    # If accepting, mark lead as 'attribue' and reject other bids
    if body.statut == "acceptee":
        try:
            db.update_lead(soumission["lead_id"], {
                "statut": "attribue",
                "accepte_soumissions": False,
            })
            # Reject all other soumissions for this lead
            other_soumissions = db.get_soumissions_for_lead(soumission["lead_id"])
            for other in other_soumissions:
                if other["id"] != soumission_id and other.get("statut") not in ("refusee", "acceptee"):
                    db.update_soumission_status(other["id"], "refusee")
                    # Notify rejected entrepreneurs
                    try:
                        db.create_notification({
                            "utilisateur_type": "entrepreneur",
                            "user_id": other["entrepreneur_id"],
                            "type_notification": "statut",
                            "titre": "Soumission non retenue",
                            "message": f"Votre soumission pour le projet \"{lead.get('numero_reference', '')}\" n'a pas ete retenue.",
                            "lien_id": other["id"],
                        })
                    except Exception as exc:
                        logger.warning("Failed to notify rejected entrepreneur %s: %s", other["entrepreneur_id"], exc)
                    # Email rejected entrepreneur
                    try:
                        rej_ent = db.get_entrepreneur_by_id(other["entrepreneur_id"])
                        if rej_ent and rej_ent.get("email"):
                            loop = asyncio.get_running_loop()
                            loop.run_in_executor(
                                None, send_soumission_status_email,
                                rej_ent["email"], lead.get("nom", ""), "refusee", lead.get("numero_reference", ""),
                            )
                    except Exception as exc:
                        logger.warning("Failed to send rejection email to entrepreneur %s: %s", other["entrepreneur_id"], exc)
        except Exception as exc:
            logger.error("Error in post-acceptance processing for soumission %s: %s", soumission_id, exc)
            # The main status update succeeded, so we log but don't fail

    # Notify the entrepreneur about the status change
    ref = lead.get("numero_reference", "")
    notification_map = {
        "acceptee": ("Votre soumission a ete acceptee", f"Votre soumission pour le projet \"{ref}\" a ete acceptee!"),
        "refusee": ("Votre soumission a ete refusee", f"Votre soumission pour le projet \"{ref}\" n'a pas ete retenue."),
        "en_evaluation": ("Votre soumission a ete en_evaluation", f"Votre soumission pour le projet \"{ref}\" est en cours d'evaluation."),
        "vue": ("Votre soumission a ete vue", f"Votre soumission pour le projet \"{ref}\" a ete consultee par le client."),
    }

    if body.statut in notification_map:
        titre, message = notification_map[body.statut]
        try:
            db.create_notification({
                "utilisateur_type": "entrepreneur",
                "user_id": soumission["entrepreneur_id"],
                "type_notification": "statut",
                "titre": titre,
                "message": message,
                "lien_id": soumission_id,
            })
        except Exception as exc:
            logger.warning("Failed to create status notification for entrepreneur %s: %s", soumission["entrepreneur_id"], exc)

        # Send status-change email to entrepreneur
        try:
            ent = db.get_entrepreneur_by_id(soumission["entrepreneur_id"])
            if ent and ent.get("email"):
                lead_nom = lead.get("nom", lead.get("numero_reference", ""))
                loop = asyncio.get_running_loop()
                loop.run_in_executor(
                    None, send_soumission_status_email,
                    ent["email"], lead_nom, body.statut, ref,
                )
        except Exception as exc:
            logger.warning("Failed to send status email to entrepreneur %s: %s", soumission["entrepreneur_id"], exc)

    logger.info(
        "Soumission %s status updated to '%s' by %s",
        soumission_id, body.statut, user.email,
    )
    return SoumissionResponse(**updated)


# ============================================
# FORMAL AWARD (Attribuer) ENDPOINT
# ============================================

@router.post("/{soumission_id}/attribuer", response_model=SoumissionResponse)
async def attribuer_soumission(
    soumission_id: int,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Formally award a contract to a soumission.
    1. Accepts the soumission (status -> 'acceptee')
    2. Updates lead status to 'attribue'
    3. Rejects all other bids for the same lead
    4. Creates notification for the winner
    5. Creates notifications for the losers
    Returns the updated soumission.
    """
    soumission = db.get_soumission_by_id(soumission_id)
    if not soumission:
        raise HTTPException(status_code=404, detail="Soumission non trouvee")

    # Authorization: client must own the lead, or admin
    lead = db.get_lead_by_id(soumission["lead_id"])
    if not lead:
        raise HTTPException(status_code=404, detail="Projet associe non trouve")

    if user.user_type == "client":
        if user.email != lead.get("email"):
            raise HTTPException(status_code=403, detail="Vous ne pouvez gerer que les soumissions de vos projets")
    elif user.user_type not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Acces refuse")

    # Cannot award if already awarded or rejected
    if soumission.get("statut") in ("acceptee", "refusee"):
        raise HTTPException(
            status_code=400,
            detail=f"Impossible d'attribuer une soumission avec le statut '{soumission.get('statut')}'.",
        )

    # 1. Accept the winning soumission
    try:
        updated = db.update_soumission_status(soumission_id, "acceptee")
    except Exception as exc:
        logger.error("Error accepting soumission %s: %s", soumission_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'attribution du contrat")

    if not updated:
        raise HTTPException(status_code=404, detail="Soumission non trouvee apres mise a jour")

    lead_nom = lead.get("nom", lead.get("numero_reference", ""))

    # 2. Update lead status to 'attribue' and stop accepting bids
    try:
        db.update_lead(soumission["lead_id"], {
            "statut": "attribue",
            "accepte_soumissions": False,
        })
    except Exception as exc:
        logger.error("Error updating lead %s to attribue: %s", soumission["lead_id"], exc)

    # 3. Reject all other soumissions and notify losers
    try:
        other_soumissions = db.get_soumissions_for_lead(soumission["lead_id"])
        for other in other_soumissions:
            if other["id"] != soumission_id and other.get("statut") not in ("refusee", "acceptee"):
                db.update_soumission_status(other["id"], "refusee")
                # Notify rejected entrepreneur
                try:
                    db.create_notification({
                        "utilisateur_type": "entrepreneur",
                        "user_id": other["entrepreneur_id"],
                        "type_notification": "statut",
                        "titre": "Soumission non retenue",
                        "message": f"Votre soumission n'a pas ete retenue pour le projet \"{lead_nom}\".",
                        "lien_id": other["id"],
                    })
                except Exception as exc:
                    logger.warning("Failed to notify rejected entrepreneur %s: %s", other["entrepreneur_id"], exc)
                # Email rejected entrepreneur
                try:
                    rej_ent = db.get_entrepreneur_by_id(other["entrepreneur_id"])
                    if rej_ent and rej_ent.get("email"):
                        ref = lead.get("numero_reference", "")
                        loop = asyncio.get_running_loop()
                        loop.run_in_executor(
                            None, send_soumission_status_email,
                            rej_ent["email"], lead_nom, "refusee", ref,
                        )
                except Exception as exc:
                    logger.warning("Failed to send rejection email to entrepreneur %s: %s", other["entrepreneur_id"], exc)
    except Exception as exc:
        logger.error("Error rejecting other soumissions for lead %s: %s", soumission["lead_id"], exc)

    # 4. Notify the winner
    try:
        db.create_notification({
            "utilisateur_type": "entrepreneur",
            "user_id": soumission["entrepreneur_id"],
            "type_notification": "statut",
            "titre": "Contrat attribue!",
            "message": f"Felicitations! Votre soumission a ete retenue pour le projet \"{lead_nom}\".",
            "lien_id": soumission_id,
        })
    except Exception as exc:
        logger.warning("Failed to notify winning entrepreneur %s: %s", soumission["entrepreneur_id"], exc)

    # Email the winner
    try:
        win_ent = db.get_entrepreneur_by_id(soumission["entrepreneur_id"])
        if win_ent and win_ent.get("email"):
            ref = lead.get("numero_reference", "")
            loop = asyncio.get_running_loop()
            loop.run_in_executor(
                None, send_soumission_status_email,
                win_ent["email"], lead_nom, "acceptee", ref,
            )
    except Exception as exc:
        logger.warning("Failed to send award email to entrepreneur %s: %s", soumission["entrepreneur_id"], exc)

    logger.info(
        "Soumission %s formally awarded by %s for lead %s",
        soumission_id, user.email, soumission["lead_id"],
    )
    return SoumissionResponse(**updated)
