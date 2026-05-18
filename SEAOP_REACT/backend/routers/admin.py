"""
SEAOP React - Administration Router
Endpoints for the admin dashboard: stats, entrepreneur management,
soumissions overview, and service request management.
All endpoints require admin role.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Depends

from ..seaop_auth import require_role, SeaopUser
from .. import seaop_database as db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Administration"])


# ============================================
# DASHBOARD STATS
# ============================================

@router.get("/stats")
async def get_admin_stats(
    user: SeaopUser = Depends(require_role("admin", "super_admin")),
):
    """
    Get dashboard statistics:
    - total_projets, total_entrepreneurs, total_soumissions, ca_total
    - top_entrepreneurs (top 5 by accepted bids)
    - evolution_projets (monthly project creation, last 6 months)
    """
    try:
        stats = db.get_admin_stats()
    except Exception as exc:
        logger.error("Error fetching admin stats: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des statistiques")

    return {"data": stats}


# ============================================
# LIST ALL ENTREPRENEURS
# ============================================

@router.get("/entrepreneurs")
async def list_entrepreneurs(
    statut: Optional[str] = Query(default=None, description="Filtrer par statut (actif, inactif, suspendu)"),
    user: SeaopUser = Depends(require_role("admin", "super_admin")),
):
    """
    List all entrepreneurs with optional status filter.
    """
    try:
        entrepreneurs = db.get_all_entrepreneurs(statut=statut)
    except Exception as exc:
        logger.error("Error fetching entrepreneurs: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des entrepreneurs")

    return {"data": entrepreneurs, "total": len(entrepreneurs)}


# ============================================
# UPDATE ENTREPRENEUR
# ============================================

@router.put("/entrepreneurs/{entrepreneur_id}")
async def update_entrepreneur(
    entrepreneur_id: int,
    body: dict,
    user: SeaopUser = Depends(require_role("admin", "super_admin")),
):
    """
    Admin update of an entrepreneur: status, credits, subscription, etc.
    """
    if not body:
        raise HTTPException(status_code=422, detail="Aucune donnee de mise a jour fournie")

    # Prevent overwriting critical fields
    body.pop("id", None)
    body.pop("email", None)
    body.pop("mot_de_passe_hash", None)

    try:
        result = db.update_entrepreneur_admin(entrepreneur_id, body)
    except Exception as exc:
        logger.error("Error updating entrepreneur %d: %s", entrepreneur_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour de l'entrepreneur")

    if not result:
        raise HTTPException(status_code=404, detail="Entrepreneur non trouve")

    return {"message": "Entrepreneur mis a jour avec succes", "data": result}


# ============================================
# LIST RECENT SOUMISSIONS
# ============================================

@router.get("/soumissions")
async def list_soumissions(
    user: SeaopUser = Depends(require_role("admin", "super_admin")),
):
    """
    List recent soumissions with entrepreneur and lead info (last 100).
    """
    try:
        soumissions = db.get_all_soumissions_admin()
    except Exception as exc:
        logger.error("Error fetching admin soumissions: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des soumissions")

    return {"data": soumissions, "total": len(soumissions)}


# ============================================
# VERIFY ENTREPRENEUR RBQ LICENSE
# ============================================

@router.put("/entrepreneurs/{entrepreneur_id}/verify-rbq")
async def verify_rbq(
    entrepreneur_id: int,
    user: SeaopUser = Depends(require_role("admin", "super_admin")),
):
    """
    Admin/Super-Admin manually verifies an entrepreneur's RBQ license.
    Sets rbq_verifie = TRUE and sends a notification to the entrepreneur.
    """
    try:
        result = db.verify_entrepreneur_rbq(entrepreneur_id)
    except Exception as exc:
        logger.error("Error verifying RBQ for entrepreneur %d: %s", entrepreneur_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la verification RBQ")

    if not result:
        raise HTTPException(status_code=404, detail="Entrepreneur non trouve")

    # Send notification to the entrepreneur
    try:
        db.create_notification({
            "utilisateur_type": "entrepreneur",
            "user_id": entrepreneur_id,
            "type_notification": "rbq_verification",
            "titre": "Licence RBQ verifiee",
            "message": "Votre licence RBQ a ete verifiee par un administrateur.",
            "lien_id": None,
        })
    except Exception as exc:
        logger.warning("Failed to create RBQ verification notification for entrepreneur %d: %s", entrepreneur_id, exc)

    return {"message": "Licence RBQ verifiee avec succes", "data": result}
