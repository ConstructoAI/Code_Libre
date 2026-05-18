"""
ERP React - Messaging Router
Teams-like internal messaging (conference_channels) + direct messages.
Based on modules/conference_manager/ (2,016 lines) + direct_messages.py (1,241 lines).
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Messaging"])


# ============================================
# PYDANTIC MODELS
# ============================================

class ChannelCreate(BaseModel):
    name: str
    description: Optional[str] = None
    channel_type: str = "general"
    is_private: bool = False


class MessageCreate(BaseModel):
    message_text: str
    parent_message_id: Optional[int] = None


class ReactionCreate(BaseModel):
    emoji: str


class DirectMessageCreate(BaseModel):
    recipient_user_id: Optional[int] = None
    recipient_entreprise_id: Optional[str] = None
    subject: Optional[str] = None
    message: str
    parent_id: Optional[int] = None


# ============================================
# CHANNELS (Teams-like)
# ============================================

@router.get("/channels")
async def list_channels(user: ErpUser = Depends(get_current_user)):
    """List all active channels for the tenant."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT c.id, c.name, c.description, c.channel_type, c.is_active, "
            "c.created_at, "
            "0 as member_count, "
            "(SELECT COUNT(*) FROM conference_messages m WHERE m.channel_id = c.id "
            "  AND m.is_deleted = FALSE) as message_count "
            "FROM conference_channels c "
            "WHERE c.is_active = TRUE "
            "ORDER BY c.name ASC"
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            items.append(d)

        return {"items": items}
    except Exception as exc:
        logger.error("list_channels error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/channels")
async def create_channel(body: ChannelCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new channel."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "INSERT INTO conference_channels (name, description, channel_type, created_by, "
            "is_active, created_at) "
            "VALUES (%s, %s, %s, %s, TRUE, CURRENT_TIMESTAMP) RETURNING id",
            (body.name, body.description, body.channel_type, user.user_id),
        )
        channel_id = cursor.fetchone()["id"]

        conn.commit()
        return {"id": channel_id, "message": "Canal créé"}
    except Exception as exc:
        logger.error("create_channel error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/channels/{channel_id}/messages")
async def get_channel_messages(
    channel_id: int,
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
):
    """Get messages for a channel."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    # CRITICAL: Hard-qualify the `users` JOIN below with the validated tenant
    # schema. The legacy `public.users` table holds stale CROSS-TENANT data
    # from earlier Streamlit migrations. Without explicit qualification, the
    # `search_path` fallback would resolve `users` → `public.users` if the
    # tenant `users` table is missing, leaking other tenants' usernames into
    # the channel message feed (e.g. tenant A seeing "posted by Steve from
    # tenant B" labels). Same defense pattern as `metre_pdf.py::_db_list_metres_library`.
    if not db.validate_schema_name(user.schema):
        raise HTTPException(status_code=400, detail="Invalid tenant schema")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        offset = (page - 1) * per_page
        cursor.execute(
            "SELECT m.id, m.channel_id, m.user_id, m.message_text, m.parent_message_id, "
            "m.is_edited, m.is_deleted, m.created_at, m.edited_at, "
            "u.username, COALESCE(e.prenom || ' ' || e.nom, u.full_name, u.username) as user_name "
            "FROM conference_messages m "
            f'LEFT JOIN "{user.schema}".users u ON m.user_id = u.id '
            "LEFT JOIN employees e ON m.user_id = e.id "
            "WHERE m.channel_id = %s AND m.is_deleted = FALSE "
            "ORDER BY m.created_at DESC LIMIT %s OFFSET %s",
            (channel_id, per_page, offset),
        )
        messages = []
        msg_ids = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("created_at", "edited_at"):
                if d.get(k):
                    d[k] = str(d[k])
            d["reactions"] = []
            messages.append(d)
            msg_ids.append(d["id"])

        if msg_ids:
            try:
                cursor.execute(
                    "SELECT message_id, emoji, COUNT(*) AS count, "
                    "BOOL_OR(user_id = %s) AS mine "
                    "FROM conference_reactions "
                    "WHERE message_id = ANY(%s) "
                    "GROUP BY message_id, emoji",
                    (user.user_id, msg_ids),
                )
                reactions_by_msg: dict[int, list[dict]] = {}
                for r in cursor.fetchall():
                    reactions_by_msg.setdefault(r["message_id"], []).append(
                        {"emoji": r["emoji"], "count": int(r["count"]), "mine": bool(r["mine"])}
                    )
                for d in messages:
                    d["reactions"] = reactions_by_msg.get(d["id"], [])
            except Exception as exc:
                logger.warning("get_channel_messages reactions fetch failed: %s", exc)
                # Nettoie l'état aborted — pas de query suivante dans le try, rollback suffit
                try:
                    conn.rollback()
                except Exception:
                    pass

        # Reverse to chronological order
        messages.reverse()

        return {"items": messages, "channel_id": channel_id}
    except Exception as exc:
        logger.error("get_channel_messages error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/channels/{channel_id}/messages")
async def post_channel_message(
    channel_id: int, body: MessageCreate, user: ErpUser = Depends(get_current_user)
):
    """Post a message to a channel."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "INSERT INTO conference_messages (channel_id, user_id, message_text, parent_message_id, "
            "is_edited, is_deleted, created_at) "
            "VALUES (%s, %s, %s, %s, FALSE, FALSE, CURRENT_TIMESTAMP) RETURNING id",
            (channel_id, user.user_id, body.message_text, body.parent_message_id),
        )
        msg_id = cursor.fetchone()["id"]
        conn.commit()
        return {"id": msg_id, "message": "Message envoye"}
    except Exception as exc:
        logger.error("post_channel_message error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/channels/{channel_id}/messages/{message_id}/reactions")
async def toggle_reaction(
    channel_id: int, message_id: int, body: ReactionCreate,
    user: ErpUser = Depends(get_current_user),
):
    """Toggle a reaction on a message (add if absent, remove if present)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    emoji = (body.emoji or "").strip()
    # VARCHAR(10) en BD — aligne la limite Python pour éviter StringDataRightTruncation
    if not emoji or len(emoji) > 10:
        raise HTTPException(status_code=400, detail="Emoji invalide")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Verify message exists and belongs to the given channel
        cursor.execute(
            "SELECT id FROM conference_messages "
            "WHERE id = %s AND channel_id = %s AND is_deleted = FALSE",
            (message_id, channel_id),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Message introuvable")

        # Toggle: remove if this user already has this emoji, otherwise add
        cursor.execute(
            "DELETE FROM conference_reactions "
            "WHERE message_id = %s AND user_id = %s AND emoji = %s RETURNING id",
            (message_id, user.user_id, emoji),
        )
        deleted = cursor.fetchone()

        if deleted:
            conn.commit()
            return {"action": "removed", "emoji": emoji}

        try:
            cursor.execute(
                "INSERT INTO conference_reactions (message_id, user_id, emoji, created_at) "
                "VALUES (%s, %s, %s, CURRENT_TIMESTAMP) "
                "ON CONFLICT (message_id, user_id, emoji) DO NOTHING RETURNING id",
                (message_id, user.user_id, emoji),
            )
        except Exception as exc:
            # Race: message supprimé entre le check et l'INSERT → FK violation
            conn.rollback()
            logger.warning("toggle_reaction INSERT failed (message likely deleted): %s", exc)
            raise HTTPException(status_code=404, detail="Message introuvable")

        conn.commit()
        return {"action": "added", "emoji": emoji}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("toggle_reaction error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# DIRECT MESSAGES
# ============================================

@router.get("/direct-messages")
async def list_direct_messages(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=50),
):
    """Get direct messages for the current user, filtered by tenant."""
    try:
        # direct_messages table does not exist in current schema
        return {"items": [], "unread_count": 0}
    except Exception as exc:
        logger.error("list_direct_messages error: %s", exc)
        return {"items": [], "unread_count": 0}


@router.post("/direct-messages")
async def send_direct_message(
    body: DirectMessageCreate, user: ErpUser = Depends(get_current_user)
):
    """Send a direct message. Currently unavailable — table not provisioned."""
    # Returning 503 (instead of 200 with a stub body) prevents the frontend
    # from believing the message was delivered when it was silently dropped.
    raise HTTPException(
        status_code=503,
        detail="Service de messages directs temporairement indisponible.",
    )


@router.put("/direct-messages/{message_id}/read")
async def mark_message_read(message_id: int, user: ErpUser = Depends(get_current_user)):
    """Mark a direct message as read. Currently unavailable — table not provisioned."""
    raise HTTPException(
        status_code=503,
        detail="Service de messages directs temporairement indisponible.",
    )


# ============================================
# NOTIFICATIONS
# ============================================

@router.get("/notifications")
async def list_notifications(
    user: ErpUser = Depends(get_current_user),
    unread_only: bool = Query(False),
    limit: int = Query(20, ge=1, le=50),
):
    """Get notifications for the current user."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Check if notifications table exists
        cursor.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_schema = %s AND table_name = 'notifications')",
            (user.schema,),
        )
        if not cursor.fetchone().get("exists", False):
            return {"items": [], "unread_count": 0}

        where = "WHERE user_id = %s"
        params = [user.user_id]
        if unread_only:
            where += " AND is_read = FALSE"

        cursor.execute(
            f"SELECT id, type, title, message, is_read, link, "
            f"created_at FROM notifications {where} "
            f"ORDER BY created_at DESC LIMIT %s",
            params + [limit],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            items.append(d)

        cursor.execute(
            "SELECT COUNT(*) as count FROM notifications "
            "WHERE user_id = %s AND is_read = FALSE",
            (user.user_id,),
        )
        unread_count = cursor.fetchone()["count"]

        return {"items": items, "unread_count": unread_count}
    except Exception as exc:
        logger.error("list_notifications error: %s", exc)
        return {"items": [], "unread_count": 0}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int, user: ErpUser = Depends(get_current_user)
):
    """Mark a notification as read."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE notifications SET is_read = TRUE WHERE id = %s AND user_id = %s",
            (notification_id, user.user_id),
        )
        conn.commit()
        return {"message": "Notification lue"}
    except Exception as exc:
        logger.error("mark_notification_read error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/notifications/count")
async def get_notification_count(user: ErpUser = Depends(get_current_user)):
    """Get unread notification count (for the bell icon)."""
    if not user.schema:
        return {"count": 0}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_schema = %s AND table_name = 'notifications')",
            (user.schema,),
        )
        if not cursor.fetchone().get("exists", False):
            return {"count": 0}

        cursor.execute(
            "SELECT COUNT(*) as count FROM notifications "
            "WHERE user_id = %s AND is_read = FALSE",
            (user.user_id,),
        )
        return {"count": cursor.fetchone()["count"]}
    except Exception as exc:
        logger.error("get_notification_count error: %s", exc)
        return {"count": 0}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()
