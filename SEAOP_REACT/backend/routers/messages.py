"""
SEAOP React - Messages Router
Endpoints for messaging between clients and entrepreneurs within lead contexts.
"""

import asyncio
import logging
from typing import List

from fastapi import APIRouter, HTTPException, Depends

from ..seaop_models import MessageCreate, MessageResponse, ConversationSummary
from ..seaop_auth import get_current_user, SeaopUser
from .. import seaop_database as db
from ..seaop_email import send_new_message_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/messages", tags=["Messages"])


# ============================================
# SEND A MESSAGE
# ============================================

@router.post("", response_model=MessageResponse, status_code=201)
async def send_message(
    body: MessageCreate,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Send a message in a conversation.
    The sender must be either the lead owner (client) or the entrepreneur.
    Creates a notification for the recipient.
    """
    # Verify the lead exists
    lead = db.get_lead_by_id(body.lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Projet non trouve")

    # Determine entrepreneur_id for the conversation
    entrepreneur_id = body.entrepreneur_id
    if user.user_type == "entrepreneur":
        entrepreneur_id = user.user_id
    elif not entrepreneur_id:
        raise HTTPException(
            status_code=400,
            detail="entrepreneur_id est requis pour les messages envoyes par un client",
        )

    # Validate the sender is a participant
    if user.user_type == "entrepreneur":
        if user.user_id != entrepreneur_id:
            raise HTTPException(status_code=403, detail="Acces refuse a cette conversation")
    elif user.user_type == "client":
        if user.email != lead.get("email"):
            raise HTTPException(status_code=403, detail="Acces refuse a cette conversation")
    elif user.user_type not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Acces refuse")

    # Determine expediteur_type
    expediteur_type = user.user_type  # "entrepreneur" or "client"

    # Auto-determine destinataire_id if not provided
    destinataire_id = body.destinataire_id
    if destinataire_id is None:
        if user.user_type == "client":
            # Client sends to entrepreneur
            destinataire_id = entrepreneur_id
        else:
            # Entrepreneur sends to client (clients have user_id=0)
            destinataire_id = 0

    message_data = {
        "lead_id": body.lead_id,
        "entrepreneur_id": entrepreneur_id,
        "expediteur_type": expediteur_type,
        "expediteur_id": user.user_id,
        "destinataire_id": destinataire_id,
        "message": body.message,
        "pieces_jointes": body.pieces_jointes,
    }

    try:
        msg = db.create_message(message_data)
    except Exception as exc:
        logger.error("Error creating message: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'envoi du message")

    # Create notification for the recipient
    try:
        sender_name = user.display_name or user.email
        notif_user_type = "entrepreneur" if user.user_type == "client" else "client"
        ref = lead.get("numero_reference", "")
        db.create_notification({
            "utilisateur_type": notif_user_type,
            "user_id": destinataire_id,
            "type_notification": "message",
            "titre": "Nouveau message",
            "message": f"Vous avez recu un message de {sender_name} concernant le projet \"{ref}\".",
            "lien_id": body.lead_id,
        })
    except Exception as exc:
        logger.warning("Failed to create notification for message: %s", exc)

    # Send email notification to recipient
    try:
        sender_name = user.display_name or user.email
        ref = lead.get("numero_reference", "")
        recipient_email = None
        if user.user_type == "client":
            # Client sent message -> email the entrepreneur
            ent = db.get_entrepreneur_by_id(entrepreneur_id)
            if ent:
                recipient_email = ent.get("email")
        else:
            # Entrepreneur sent message -> email the client (lead owner)
            recipient_email = lead.get("email")
        if recipient_email:
            loop = asyncio.get_running_loop()
            loop.run_in_executor(
                None, send_new_message_email, recipient_email, sender_name, ref,
            )
    except Exception as exc:
        logger.warning("Failed to send new-message email: %s", exc)

    logger.info(
        "Message sent: lead=%s from=%s(%s) to=%s",
        body.lead_id, user.user_type, user.user_id, destinataire_id,
    )
    return MessageResponse(**msg)


# ============================================
# LIST CONVERSATIONS
# ============================================

@router.get("/conversations", response_model=List[ConversationSummary])
async def list_conversations(
    user: SeaopUser = Depends(get_current_user),
):
    """
    List all conversations for the current user.
    For clients: conversations on their leads.
    For entrepreneurs: conversations they're part of.
    Returns conversation summaries with last message, unread count, and names.
    """
    try:
        conversations = db.get_conversations_for_user(user.user_type, user.user_id)
    except Exception as exc:
        logger.error("Error fetching conversations for user %s: %s", user.user_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des conversations")

    return [ConversationSummary(**c) for c in conversations]


# ============================================
# GET CONVERSATION THREAD
# ============================================

@router.get(
    "/conversation/{lead_id}/{entrepreneur_id}",
    response_model=List[MessageResponse],
)
async def get_conversation(
    lead_id: int,
    entrepreneur_id: int,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Get full conversation thread between a client and entrepreneur for a lead.
    Automatically marks messages as read for the reader.
    Requires the user to be a participant in the conversation.
    """
    # Verify the lead exists
    lead = db.get_lead_by_id(lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Projet non trouve")

    # Authorization: must be a participant or admin
    if user.user_type == "entrepreneur":
        if user.user_id != entrepreneur_id:
            raise HTTPException(status_code=403, detail="Acces refuse a cette conversation")
    elif user.user_type == "client":
        if user.email != lead.get("email"):
            raise HTTPException(status_code=403, detail="Acces refuse a cette conversation")
    elif user.user_type not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Acces refuse")

    try:
        messages = db.get_conversation(lead_id, entrepreneur_id)
    except Exception as exc:
        logger.error("Error fetching conversation lead=%s entrepreneur=%s: %s", lead_id, entrepreneur_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation de la conversation")

    # Mark messages as read for the current reader
    try:
        db.mark_messages_read(lead_id, entrepreneur_id, user.user_id)
    except Exception as exc:
        logger.warning("Failed to mark messages as read: %s", exc)

    return [MessageResponse(**m) for m in messages]


# ============================================
# MARK MESSAGES READ (Explicit)
# ============================================

@router.put("/mark-read/{lead_id}/{entrepreneur_id}")
async def mark_messages_read(
    lead_id: int,
    entrepreneur_id: int,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Explicitly mark all messages in a conversation as read for the current user.
    """
    # Verify the lead exists
    lead = db.get_lead_by_id(lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Projet non trouve")

    # Authorization: must be a participant
    if user.user_type == "entrepreneur":
        if user.user_id != entrepreneur_id:
            raise HTTPException(status_code=403, detail="Acces refuse a cette conversation")
    elif user.user_type == "client":
        if user.email != lead.get("email"):
            raise HTTPException(status_code=403, detail="Acces refuse a cette conversation")
    elif user.user_type not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Acces refuse")

    try:
        db.mark_messages_read(lead_id, entrepreneur_id, user.user_id)
    except Exception as exc:
        logger.error("Error marking messages read: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du marquage des messages comme lus")

    return {"success": True, "message": "Messages marques comme lus"}
