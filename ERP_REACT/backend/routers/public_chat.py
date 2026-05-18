"""
ERP React - Public Chat Router
Endpoint public (sans auth) pour l'assistant pre-login Sylvain Leduc.
Porte depuis login_page_multitenant.py (Streamlit AssistantIASylvain).

- claude-sonnet-4-6, max_tokens 32000, temperature 0.7
- 20 echanges max par session_id (compteur en memoire, pas de BD)
- Historique envoye depuis le client (6 derniers messages en contexte)
- Tracking usage via ai_usage_tracker (feature='sylvain_chat_login')
- Rate limit IP gere par le middleware global de erp_api.py
"""

from __future__ import annotations

import os
import sys
import logging
import threading
import time as time_module
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from ..sylvain_prompt import (
    SYLVAIN_SYSTEM_PROMPT,
    LIMIT_REACHED_MESSAGE,
    IP_LIMIT_REACHED_MESSAGE,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/public", tags=["Public Chat"])


# ============================================
# Anthropic client
# ============================================

_anthropic_client = None
try:
    import anthropic
    _anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
except ImportError:
    logger.warning("Anthropic SDK not installed - Sylvain chat disabled")

SYLVAIN_MODEL = "claude-sonnet-4-6"
SYLVAIN_MAX_TOKENS = 32000
SYLVAIN_TEMPERATURE = 0.7
SYLVAIN_HISTORY_WINDOW = 6  # derniers messages envoyes en contexte


# ============================================
# AI usage tracker (optionnel)
# ============================================

_track_ai_usage = None
try:
    # public_chat.py → routers/ → backend/ → ERP_REACT/ → project root (4 dirnames)
    _project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    if _project_root not in sys.path:
        sys.path.insert(0, _project_root)
    from ai_usage_tracker import track_ai_usage as _track_ai_usage  # type: ignore
except ImportError:
    logger.debug("ai_usage_tracker not importable - Sylvain chat usage tracking disabled")


# ============================================
# Rate limits en memoire (2 couches : par session_id + par IP/jour)
# ============================================

# Couche 1 — par session_id (cycle-able cote client)
MAX_EXCHANGES_PER_SESSION = 20
SESSION_TTL_SECONDS = 6 * 60 * 60  # 6h — purge automatique
_session_counters: dict[str, tuple[int, float]] = {}

# Couche 2 — par IP sur 24h (empeche le cycle de session_id pour bypasser)
# 50 echanges/jour = genereux pour un bureau NAT (10 pers x 5 echanges) mais
# stoppe net un attaquant qui cycle les session_id. Combine avec le rate limit
# middleware (10 req/min specifique chat), c'est une defense en profondeur.
MAX_EXCHANGES_PER_IP_DAY = 50
IP_WINDOW_SECONDS = 24 * 60 * 60
_ip_counters: dict[str, tuple[int, float]] = {}

_session_lock = threading.Lock()  # Protege les 2 dicts (partage pour simplicite)


def _purge_expired_sessions() -> None:
    """Retire les sessions et IPs expirees pour borner la croissance memoire."""
    now = time_module.time()
    expired_sessions = [sid for sid, (_, last_seen) in _session_counters.items()
                        if now - last_seen > SESSION_TTL_SECONDS]
    for sid in expired_sessions:
        _session_counters.pop(sid, None)
    expired_ips = [ip for ip, (_, last_seen) in _ip_counters.items()
                   if now - last_seen > IP_WINDOW_SECONDS]
    for ip in expired_ips:
        _ip_counters.pop(ip, None)


def _reserve_exchange(session_id: str) -> Optional[int]:
    """
    Atomically check the session limit and reserve an exchange slot.
    Returns the new count if reserved, or None if over the limit.
    Atomic peek+increment prevents concurrent bypass.
    """
    with _session_lock:
        _purge_expired_sessions()
        count, _ = _session_counters.get(session_id, (0, 0.0))
        if count >= MAX_EXCHANGES_PER_SESSION:
            return None
        count += 1
        _session_counters[session_id] = (count, time_module.time())
        return count


def _release_exchange(session_id: str) -> None:
    """Rollback a reserved session slot if the Anthropic call fails."""
    with _session_lock:
        count, last_seen = _session_counters.get(session_id, (0, 0.0))
        if count > 0:
            _session_counters[session_id] = (count - 1, last_seen)


def _peek_session(session_id: str) -> int:
    with _session_lock:
        count, _ = _session_counters.get(session_id, (0, 0.0))
        return count


def _reserve_ip_exchange(client_ip: str) -> Optional[int]:
    """
    Atomically check the per-IP daily cap and reserve a slot.
    Returns the new count if reserved, or None if over the limit.
    The window resets 24h after the last observed request.
    """
    with _session_lock:
        now = time_module.time()
        count, last_seen = _ip_counters.get(client_ip, (0, 0.0))
        # Reset si la fenetre 24h est depassee
        if last_seen and now - last_seen > IP_WINDOW_SECONDS:
            count = 0
        if count >= MAX_EXCHANGES_PER_IP_DAY:
            return None
        count += 1
        _ip_counters[client_ip] = (count, now)
        return count


def _release_ip_exchange(client_ip: str) -> None:
    """Rollback a reserved IP slot if the Anthropic call fails."""
    with _session_lock:
        count, last_seen = _ip_counters.get(client_ip, (0, 0.0))
        if count > 0:
            _ip_counters[client_ip] = (count - 1, last_seen)


def _get_client_ip(request: Request) -> str:
    """Extract real client IP, trusting X-Forwarded-For from Render proxy chain."""
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        # Prend la premiere IP (client originel) — Render ecrit ce header lui-meme
        return xff.split(",")[0].strip() or "unknown"
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


# ============================================
# Pydantic models
# ============================================

class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    session_id: str = Field(..., min_length=8, max_length=128)
    message: str = Field(..., min_length=1, max_length=4000)
    history: Optional[List[ChatMessage]] = None

    @field_validator("message")
    @classmethod
    def _message_not_blank(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("Le message ne peut pas etre vide.")
        return stripped


class ChatResponse(BaseModel):
    response: str
    exchanges_used: int
    exchanges_remaining: int
    limit_reached: bool


# ============================================
# Helpers
# ============================================

def _track_usage(response_obj, feature: str = "sylvain_chat_login") -> None:
    """Log tokens + cout vers ai_usage_tracking (public, entreprise_id=None)."""
    if _track_ai_usage is None:
        return
    try:
        usage = getattr(response_obj, "usage", None)
        tokens_in = getattr(usage, "input_tokens", 0) if usage else 0
        tokens_out = getattr(usage, "output_tokens", 0) if usage else 0
        _track_ai_usage(
            feature=feature,
            tokens_input=tokens_in,
            tokens_output=tokens_out,
            model_used=SYLVAIN_MODEL,
            entreprise_id=None,
            entreprise_nom=None,
            schema_name=None,
            user_id=None,
            username=None,
            product_type="ERP",
        )
    except Exception as exc:
        logger.debug("Sylvain chat usage tracking failed: %s", exc)


def _build_messages(history: Optional[List[ChatMessage]], user_message: str) -> list[dict]:
    """Construit la liste messages envoyee a Anthropic (6 derniers + message courant)."""
    messages: list[dict] = []
    if history:
        recent = history[-SYLVAIN_HISTORY_WINDOW:]
        for msg in recent:
            messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": user_message})
    return messages


# ============================================
# Endpoint
# ============================================

@router.post("/sylvain-chat", response_model=ChatResponse)
async def sylvain_chat(body: ChatRequest, request: Request) -> ChatResponse:
    """
    Chat public pre-login avec l'assistant Sylvain Leduc.
    Aucune authentification requise. Defense anti-abuse en 3 couches :
    1. Rate limit middleware global (10 req/min par IP sur ce endpoint)
    2. Cap par session_id : 20 echanges max par session
    3. Cap par IP/jour : 50 echanges max par IP sur 24h (empeche le cycle
       de session_id pour contourner la couche 2)
    """
    if _anthropic_client is None:
        raise HTTPException(
            status_code=503,
            detail="Service IA temporairement indisponible. Veuillez reessayer plus tard.",
        )

    client_ip = _get_client_ip(request)

    # Couche 2 — verif session_id en premier (localise, pas d'impact IP si hit)
    session_count = _reserve_exchange(body.session_id)
    if session_count is None:
        current = _peek_session(body.session_id)
        return ChatResponse(
            response=LIMIT_REACHED_MESSAGE,
            exchanges_used=current,
            exchanges_remaining=0,
            limit_reached=True,
        )

    # Couche 3 — verif cap IP/jour (empeche le cycle session_id bypass)
    ip_count = _reserve_ip_exchange(client_ip)
    if ip_count is None:
        # IP bloque — rollback session slot (legit users ne paient pas pour ca)
        _release_exchange(body.session_id)
        logger.warning("Sylvain chat: IP daily cap reached for %s", client_ip)
        return ChatResponse(
            response=IP_LIMIT_REACHED_MESSAGE,
            exchanges_used=session_count - 1,
            exchanges_remaining=0,
            limit_reached=True,
        )

    messages = _build_messages(body.history, body.message)

    try:
        response = _anthropic_client.messages.create(
            model=SYLVAIN_MODEL,
            # Prompt caching: the 12.5k-token system prompt stays hot for 5 min,
            # dropping the per-call cost from ~$0.045 to ~$0.005 after the first
            # call in a session. Public endpoint gets most traffic from repeat
            # visits within a session so this is a real saving.
            system=[
                {
                    "type": "text",
                    "text": SYLVAIN_SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=messages,
            max_tokens=SYLVAIN_MAX_TOKENS,
            temperature=SYLVAIN_TEMPERATURE,
        )
    except HTTPException:
        _release_exchange(body.session_id)
        _release_ip_exchange(client_ip)
        raise
    except Exception as exc:
        logger.warning("Sylvain chat Anthropic call failed: %s", exc)
        _release_exchange(body.session_id)
        _release_ip_exchange(client_ip)
        raise HTTPException(
            status_code=503,
            detail="Service IA temporairement indisponible. Veuillez reessayer plus tard.",
        )

    try:
        response_text = response.content[0].text  # type: ignore[attr-defined]
    except (AttributeError, IndexError, KeyError):
        logger.warning("Sylvain chat: unexpected Anthropic response format")
        _release_exchange(body.session_id)
        _release_ip_exchange(client_ip)
        raise HTTPException(status_code=503, detail="Reponse IA invalide.")

    _track_usage(response)

    remaining = max(0, MAX_EXCHANGES_PER_SESSION - session_count)

    return ChatResponse(
        response=response_text,
        exchanges_used=session_count,
        exchanges_remaining=remaining,
        limit_reached=session_count >= MAX_EXCHANGES_PER_SESSION,
    )
