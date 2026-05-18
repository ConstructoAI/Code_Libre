"""
SEAOP React - Notifications Router
Endpoints for user notifications (new messages, evaluations, bid status changes).
"""

import logging
from typing import List

from fastapi import APIRouter, HTTPException, Query, Depends

from ..seaop_models import NotificationResponse, NotificationCountResponse
from ..seaop_auth import get_current_user, SeaopUser
from .. import seaop_database as db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["Notifications"])


# ============================================
# LIST NOTIFICATIONS
# ============================================

@router.get("", response_model=List[NotificationResponse])
async def list_notifications(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: SeaopUser = Depends(get_current_user),
):
    """
    List notifications for the current user, ordered by most recent.
    Supports pagination via limit/offset.
    """
    try:
        notifications = db.get_notifications(
            user_type=user.user_type,
            user_id=user.user_id,
            limit=limit,
            offset=offset,
        )
    except Exception as exc:
        logger.error("Error fetching notifications for user %s: %s", user.user_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des notifications")

    return [NotificationResponse(**n) for n in notifications]


# ============================================
# UNREAD COUNT
# ============================================

@router.get("/count")
async def get_notification_count(
    user: SeaopUser = Depends(get_current_user),
):
    """
    Get unread notification count for the current user.
    Returns {nonLues: N} for the frontend badge counter.
    """
    try:
        count = db.count_unread_notifications(
            user_type=user.user_type,
            user_id=user.user_id,
        )
    except Exception as exc:
        logger.error("Error counting notifications for user %s: %s", user.user_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors du comptage des notifications")

    return {"nonLues": count}


# ============================================
# MARK ALL AS READ
# (Must be defined before /{notification_id}/read
#  so FastAPI does not interpret "read-all" as a notification_id)
# ============================================

@router.put("/read-all")
async def mark_all_notifications_read(
    user: SeaopUser = Depends(get_current_user),
):
    """
    Mark all notifications as read for the current user.
    """
    try:
        db.mark_all_notifications_read(
            user_type=user.user_type,
            user_id=user.user_id,
        )
    except Exception as exc:
        logger.error("Error marking all notifications read for user %s: %s", user.user_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors du marquage des notifications")

    return {"success": True, "message": "Toutes les notifications marquees comme lues"}


# ============================================
# MARK ONE AS READ
# ============================================

@router.put("/{notification_id}/read")
async def mark_notification_as_read(
    notification_id: int,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Mark a single notification as read.
    Verifies ownership: the notification must belong to the current user.
    """
    # Verify the notification belongs to this user
    try:
        notifications = db.get_notifications(
            user_type=user.user_type,
            user_id=user.user_id,
            limit=1000,
            offset=0,
        )
        owned = any(n.get("id") == notification_id for n in notifications)
    except Exception as exc:
        logger.error("Error verifying notification ownership: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")

    if not owned:
        raise HTTPException(
            status_code=404,
            detail="Notification non trouvee ou acces refuse",
        )

    try:
        db.mark_notification_read(notification_id)
    except Exception as exc:
        logger.error("Error marking notification %s as read: %s", notification_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors du marquage de la notification")

    return {"success": True, "message": "Notification marquee comme lue"}
