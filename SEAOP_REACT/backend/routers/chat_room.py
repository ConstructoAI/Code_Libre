"""
SEAOP React - Chat Room Router
Public chat room endpoints for community discussion between entrepreneurs and clients.
"""

import logging
import re
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field

from ..seaop_auth import get_current_user, get_optional_user, require_role, SeaopUser
from .. import seaop_database as db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat-room", tags=["Chat Room"])

# Chat hardening constants
MAX_MESSAGE_LEN = 5000
MAX_DISPLAY_NAME_LEN = 100
# Strips any HTML tag (defence-in-depth — React escapes at render time, but
# we keep stored data clean for admin panels, emails, logs, CSV exports, etc.)
_HTML_TAG_RE = re.compile(r"<[^>]*>")


def _sanitize_display_name(raw: str) -> str:
    """Remove HTML tags, collapse whitespace, truncate to MAX_DISPLAY_NAME_LEN."""
    if not raw:
        return ""
    cleaned = _HTML_TAG_RE.sub("", raw)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:MAX_DISPLAY_NAME_LEN]


# ============================================
# REQUEST / RESPONSE MODELS
# ============================================

class ChatMessageCreate(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_LEN)
    parent_id: Optional[int] = None


class ChatMessageEdit(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_LEN)


class HeartbeatRequest(BaseModel):
    is_typing: bool = False


# ============================================
# GET MESSAGES
# ============================================

@router.get("/messages")
async def get_messages(
    pinned: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: Optional[SeaopUser] = Depends(get_optional_user),
):
    """
    Get chat room messages. If pinned=True, returns only pinned messages.
    If the user is authenticated, each message includes a likedByMe field.
    """
    try:
        messages = db.get_chat_messages(pinned=pinned, limit=limit, offset=offset)
    except Exception as exc:
        logger.error("Error fetching chat messages: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des messages")

    # Enrich with likedByMe if authenticated
    if user and messages:
        try:
            message_ids = [m["id"] for m in messages]
            liked_ids = db.get_user_likes(user.email, message_ids)
            for msg in messages:
                msg["likedByMe"] = msg["id"] in liked_ids
        except Exception as exc:
            logger.warning("Failed to fetch user likes: %s", exc)
            for msg in messages:
                msg["likedByMe"] = False
    else:
        for msg in messages:
            msg["likedByMe"] = False

    return messages


# ============================================
# POST MESSAGE
# ============================================

@router.post("/messages", status_code=201)
async def post_message(
    body: ChatMessageCreate,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Post a new chat room message. Requires authentication.
    User info is auto-filled from the auth token.
    """
    if not body.message or not body.message.strip():
        raise HTTPException(status_code=400, detail="Le message ne peut pas etre vide")

    # Determine badge based on user type
    badge = None
    if user.user_type in ("admin", "super_admin"):
        badge = "Admin"
    elif user.user_type == "entrepreneur":
        badge = "Entrepreneur"
    elif user.user_type == "client":
        badge = "Client"

    safe_display_name = _sanitize_display_name(user.display_name or user.email or "")

    data = {
        "user_type": user.user_type,
        "user_name": safe_display_name or (user.email or "Utilisateur"),
        "user_email": user.email,
        "user_id": user.user_id if user.user_id else None,
        "message": body.message.strip(),
        "parent_id": body.parent_id,
        "user_badge": badge,
    }

    try:
        message = db.create_chat_message(data)
    except Exception as exc:
        logger.error("Error creating chat message: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'envoi du message")

    logger.info("Chat message posted by %s (%s)", user.email, user.user_type)
    return message


# ============================================
# EDIT MESSAGE (Owner only)
# ============================================

@router.put("/messages/{message_id}")
async def edit_message(
    message_id: int,
    body: ChatMessageEdit,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Edit a chat room message. Only the message author can edit their own messages.
    """
    if not body.message or not body.message.strip():
        raise HTTPException(status_code=400, detail="Le message ne peut pas etre vide")

    # Fetch the message to check ownership
    try:
        messages = db.get_chat_messages(limit=1000, offset=0)
        target = next((m for m in messages if m["id"] == message_id), None)
    except Exception as exc:
        logger.error("Error fetching message for edit: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")

    if not target:
        raise HTTPException(status_code=404, detail="Message non trouve")

    if target.get("user_email") != user.email:
        raise HTTPException(status_code=403, detail="Vous ne pouvez modifier que vos propres messages")

    # Update the message
    conn = db.get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE {db.T}chat_room SET message = %s, edited_at = NOW() WHERE id = %s RETURNING *",
            (body.message.strip(), message_id)
        )
        updated = cursor.fetchone()
        conn.commit()
        cursor.close()
    except Exception as exc:
        conn.rollback()
        logger.error("Error updating chat message %s: %s", message_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la modification du message")
    finally:
        conn.close()

    if not updated:
        raise HTTPException(status_code=404, detail="Message non trouve")

    logger.info("Chat message %s edited by %s", message_id, user.email)
    return dict(updated)


# ============================================
# DELETE MESSAGE (Owner or Admin)
# ============================================

@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: int,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Soft-delete a chat room message. Owner or admin only.
    """
    # Fetch the message to check ownership
    try:
        messages = db.get_chat_messages(limit=1000, offset=0)
        target = next((m for m in messages if m["id"] == message_id), None)
    except Exception as exc:
        logger.error("Error fetching message for delete: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")

    if not target:
        raise HTTPException(status_code=404, detail="Message non trouve")

    # Only owner or admin can delete
    if target.get("user_email") != user.email and user.user_type not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Vous ne pouvez supprimer que vos propres messages")

    try:
        db.delete_chat_message(message_id, deleted_by=user.email)
    except Exception as exc:
        logger.error("Error deleting chat message %s: %s", message_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression du message")

    logger.info("Chat message %s deleted by %s", message_id, user.email)
    return {"success": True, "message": "Message supprime"}


# ============================================
# TOGGLE LIKE
# ============================================

@router.post("/messages/{message_id}/like")
async def toggle_like(
    message_id: int,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Toggle like on a chat room message. Requires authentication.
    Returns {liked: true/false} indicating the new state.
    """
    try:
        liked = db.toggle_chat_like(message_id, user.email)
    except Exception as exc:
        logger.error("Error toggling like on message %s: %s", message_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors du like")

    return {"liked": liked, "message_id": message_id}


# ============================================
# TOGGLE PIN (Admin only)
# ============================================

@router.put("/messages/{message_id}/pin")
async def toggle_pin(
    message_id: int,
    user: SeaopUser = Depends(require_role("admin", "super_admin")),
):
    """
    Toggle pin on a chat room message. Admin only.
    Returns {pinned: true/false} indicating the new state.
    """
    try:
        pinned = db.toggle_chat_pin(message_id)
    except Exception as exc:
        logger.error("Error toggling pin on message %s: %s", message_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'epinglage")

    logger.info("Chat message %s %s by admin %s", message_id, "pinned" if pinned else "unpinned", user.email)
    return {"pinned": pinned, "message_id": message_id}


# ============================================
# ONLINE USERS
# ============================================

@router.get("/online")
async def get_online_users(
    user: Optional[SeaopUser] = Depends(get_optional_user),
):
    """
    Get list of online users (active in the last 5 minutes).
    Public endpoint.
    """
    try:
        users = db.get_online_users(minutes=5)
    except Exception as exc:
        logger.error("Error fetching online users: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des utilisateurs en ligne")

    return users


# ============================================
# HEARTBEAT (Presence)
# ============================================

@router.post("/heartbeat")
async def heartbeat(
    body: HeartbeatRequest,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Update online presence. Called periodically by the frontend.
    Also signals typing status.
    """
    safe_display_name = _sanitize_display_name(user.display_name or user.email or "")

    try:
        db.update_online_status(
            user_type=user.user_type,
            user_name=safe_display_name or (user.email or "Utilisateur"),
            user_email=user.email,
            is_typing=body.is_typing,
        )
    except Exception as exc:
        logger.warning("Failed to update online status for %s: %s", user.email, exc)

    return {"success": True}


# ============================================
# STATS (Public)
# ============================================

@router.get("/stats")
async def get_stats(
    user: Optional[SeaopUser] = Depends(get_optional_user),
):
    """
    Get chat room statistics: total messages and unique participants.
    Public endpoint.
    """
    try:
        stats = db.get_chat_stats()
    except Exception as exc:
        logger.error("Error fetching chat stats: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des statistiques")

    return stats
