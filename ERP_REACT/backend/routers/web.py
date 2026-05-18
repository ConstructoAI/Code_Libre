"""
ERP React - Web Router
Recherche web et analyse de contenu via les outils Claude (web_search + web_fetch).
Porte depuis web_tools.py (Streamlit) vers le pattern ERP React multi-tenant.
"""

import os
import sys
import logging
import time as time_module
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/web", tags=["Recherche Web"])

# Import Anthropic client
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
try:
    import anthropic
    _anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
except ImportError:
    _anthropic_client = None
    logger.warning("Anthropic SDK not installed - Web features unavailable")

# Web module uses Opus for advanced web research (same as Streamlit web_tools.py)
WEB_AI_MODEL = "claude-opus-4-7"
WEB_AI_MAX_TOKENS = 32000

# Re-use AI billing from ai.py
from .ai import check_ai_guard, _check_credits, _deduct_credits, track_ai_usage


# ============================================
# PYDANTIC MODELS
# ============================================

class WebSearchRequest(BaseModel):
    query: str
    max_uses: int = 5
    allowed_domains: Optional[List[str]] = None
    blocked_domains: Optional[List[str]] = None


class WebFetchRequest(BaseModel):
    url: str
    max_uses: int = 5
    allowed_domains: Optional[List[str]] = None
    blocked_domains: Optional[List[str]] = None
    enable_citations: bool = True
    max_content_tokens: int = 100000


class WebSearchFetchRequest(BaseModel):
    query: str
    max_search_uses: int = 3
    max_fetch_uses: int = 2
    allowed_domains: Optional[List[str]] = None


# ============================================
# HELPERS
# ============================================

def _parse_web_response(response) -> dict:
    """Parse the Claude API response containing web search/fetch tool results.
    Extracts text, citations, and tool usage stats.
    """
    final_text = ""
    citations = []
    search_count = 0
    fetch_count = 0

    if not hasattr(response, "content") or not response.content:
        return {"text": "", "citations": [], "search_count": 0, "fetch_count": 0}

    for block in response.content:
        block_type = getattr(block, "type", None)

        if block_type == "server_tool_use":
            tool_name = getattr(block, "name", "")
            if tool_name == "web_search":
                search_count += 1
            elif tool_name == "web_fetch":
                fetch_count += 1

        elif block_type == "web_search_tool_result":
            content = getattr(block, "content", [])
            for result in content:
                if hasattr(result, "url"):
                    title = getattr(result, "title", result.url)
                    citations.append({"title": title, "url": result.url})

        elif block_type == "web_fetch_tool_result":
            content = getattr(block, "content", {})
            url = None
            if hasattr(content, "url"):
                url = content.url
            elif isinstance(content, dict):
                url = content.get("url")
            if url:
                already = any(c["url"] == url for c in citations)
                if not already:
                    citations.append({"title": "Analyse detaillee", "url": url})

        elif block_type == "text":
            text = getattr(block, "text", "")
            final_text += text + "\n\n"

    return {
        "text": final_text.strip(),
        "citations": citations,
        "search_count": search_count,
        "fetch_count": fetch_count,
    }


def _save_search_history(user: ErpUser, search_type: str, query: str, result_text: str,
                          citations_count: int):
    """Save a web search/fetch to the tenant's search history table."""
    if not user.schema:
        return
    conn = None
    cursor = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Ensure table exists
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS web_search_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER,
                search_type VARCHAR(30) NOT NULL,
                query TEXT NOT NULL,
                result_preview TEXT,
                citations_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
        cursor.execute(
            "INSERT INTO web_search_history (user_id, search_type, query, result_preview, citations_count) "
            "VALUES (%s, %s, %s, %s, %s)",
            (user.user_id, search_type, query[:500], result_text[:500] if result_text else "", citations_count),
        )
        conn.commit()
    except Exception as exc:
        logger.warning("Failed to save search history: %s", exc)
        try:
            if conn:
                conn.rollback()
        except Exception:
            pass
    finally:
        if cursor:
            cursor.close()
        if conn:
            db.reset_tenant(conn)
            conn.close()


# ============================================
# ENDPOINTS
# ============================================

@router.post("/search")
async def web_search(body: WebSearchRequest, user: ErpUser = Depends(get_current_user)):
    """Recherche web en temps reel via Claude API (web_search_20260209)."""
    if not _anthropic_client:
        raise HTTPException(status_code=503, detail="Service IA non disponible")

    if not body.query or not body.query.strip():
        raise HTTPException(status_code=400, detail="La requete de recherche est vide")

    # AI guard + credits
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    credits_ok, balance = _check_credits(user)
    if not credits_ok:
        raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    start = time_module.time()
    try:
        # Build web_search tool config
        tool_config = {
            "type": "web_search_20260209",
            "name": "web_search",
            "max_uses": min(body.max_uses, 10),
            "user_location": {
                "type": "approximate",
                "city": "Montreal",
                "region": "Quebec",
                "country": "CA",
                "timezone": "America/Montreal",
            },
        }
        # Domain filtering (mutually exclusive)
        if body.allowed_domains:
            tool_config["allowed_domains"] = body.allowed_domains[:10]
        elif body.blocked_domains:
            tool_config["blocked_domains"] = body.blocked_domains[:10]

        # Streaming required by Anthropic for tool-use operations that can exceed 10 min
        with _anthropic_client.messages.stream(
            model=WEB_AI_MODEL,
            max_tokens=WEB_AI_MAX_TOKENS,
            temperature=0.1,
            messages=[{
                "role": "user",
                "content": (
                    f"Effectue une recherche web pour: {body.query}. "
                    "Fournis une reponse detaillee et structuree avec les sources citees."
                ),
            }],
            tools=[tool_config],
        ) as stream:
            response = stream.get_final_message()

        parsed = _parse_web_response(response)
        elapsed = time_module.time() - start
        duration_ms = int(elapsed * 1000)

        tokens_in = getattr(response.usage, "input_tokens", 0)
        tokens_out = getattr(response.usage, "output_tokens", 0)
        cache_creation = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
        # Opus 4.7: $15/M input, $75/M output, $18.75/M cache write, $1.50/M cache read
        cost = (
            tokens_in * 15 / 1_000_000
            + tokens_out * 75 / 1_000_000
            + cache_creation * 18.75 / 1_000_000
            + cache_read * 1.50 / 1_000_000
        ) * 1.30  # 30% markup

        track_ai_usage(user, "web_search", tokens_in, tokens_out, cost, duration_ms,
                       success=True, model=WEB_AI_MODEL)
        _deduct_credits(user, cost)

        # Save to history
        _save_search_history(user, "search", body.query, parsed["text"], len(parsed["citations"]))

        return {
            "text": parsed["text"],
            "citations": parsed["citations"],
            "search_count": parsed["search_count"],
            "fetch_count": parsed["fetch_count"],
            "input_tokens": tokens_in,
            "output_tokens": tokens_out,
            "cost_usd": round(cost, 6),
            "elapsed_seconds": round(elapsed, 2),
            "credit_balance": round(balance - cost, 4),
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("web_search error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recherche web")


@router.post("/fetch")
async def web_fetch(body: WebFetchRequest, user: ErpUser = Depends(get_current_user)):
    """Recupere et analyse le contenu d'une URL via Claude API (web_fetch_20250910)."""
    if not _anthropic_client:
        raise HTTPException(status_code=503, detail="Service IA non disponible")

    if not body.url or not body.url.strip():
        raise HTTPException(status_code=400, detail="L'URL est vide")

    if not body.url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="L'URL doit commencer par http:// ou https://")

    # AI guard + credits
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    credits_ok, balance = _check_credits(user)
    if not credits_ok:
        raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    start = time_module.time()
    try:
        tool_config = {
            "type": "web_fetch_20250910",
            "name": "web_fetch",
            "max_uses": min(body.max_uses, 10),
            "citations": {"enabled": body.enable_citations},
            "max_content_tokens": min(body.max_content_tokens, 200000),
        }
        if body.allowed_domains:
            tool_config["allowed_domains"] = body.allowed_domains[:10]
        elif body.blocked_domains:
            tool_config["blocked_domains"] = body.blocked_domains[:10]

        # Streaming required by Anthropic for tool-use operations that can exceed 10 min
        with _anthropic_client.messages.stream(
            model=WEB_AI_MODEL,
            max_tokens=WEB_AI_MAX_TOKENS,
            temperature=0.1,
            messages=[{
                "role": "user",
                "content": (
                    f"Analyse en detail le contenu de cette page web: {body.url}\n\n"
                    "Fournis une analyse structuree comprenant:\n"
                    "1. Resume du contenu\n"
                    "2. Points cles et informations importantes\n"
                    "3. Contexte et implications\n"
                    "4. Recommandations ou conclusions"
                ),
            }],
            tools=[tool_config],
        ) as stream:
            response = stream.get_final_message()

        parsed = _parse_web_response(response)
        elapsed = time_module.time() - start
        duration_ms = int(elapsed * 1000)

        tokens_in = getattr(response.usage, "input_tokens", 0)
        tokens_out = getattr(response.usage, "output_tokens", 0)
        cache_creation = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
        # Opus 4.7: $15/M input, $75/M output, $18.75/M cache write, $1.50/M cache read
        cost = (
            tokens_in * 15 / 1_000_000
            + tokens_out * 75 / 1_000_000
            + cache_creation * 18.75 / 1_000_000
            + cache_read * 1.50 / 1_000_000
        ) * 1.30  # 30% markup

        track_ai_usage(user, "web_fetch", tokens_in, tokens_out, cost, duration_ms,
                       success=True, model=WEB_AI_MODEL)
        _deduct_credits(user, cost)

        _save_search_history(user, "fetch", body.url, parsed["text"], len(parsed["citations"]))

        return {
            "text": parsed["text"],
            "citations": parsed["citations"],
            "search_count": parsed["search_count"],
            "fetch_count": parsed["fetch_count"],
            "input_tokens": tokens_in,
            "output_tokens": tokens_out,
            "cost_usd": round(cost, 6),
            "elapsed_seconds": round(elapsed, 2),
            "credit_balance": round(balance - cost, 4),
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("web_fetch error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'analyse de la page")


@router.post("/search-fetch")
async def web_search_and_fetch(body: WebSearchFetchRequest, user: ErpUser = Depends(get_current_user)):
    """Recherche web + analyse approfondie des meilleures sources."""
    if not _anthropic_client:
        raise HTTPException(status_code=503, detail="Service IA non disponible")

    if not body.query or not body.query.strip():
        raise HTTPException(status_code=400, detail="La requete de recherche est vide")

    # AI guard + credits
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    credits_ok, balance = _check_credits(user)
    if not credits_ok:
        raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    start = time_module.time()
    try:
        tools = [
            {
                "type": "web_search_20260209",
                "name": "web_search",
                "max_uses": min(body.max_search_uses, 5),
                "user_location": {
                    "type": "approximate",
                    "city": "Montreal",
                    "region": "Quebec",
                    "country": "CA",
                    "timezone": "America/Montreal",
                },
            },
            {
                "type": "web_fetch_20250910",
                "name": "web_fetch",
                "max_uses": min(body.max_fetch_uses, 5),
                "citations": {"enabled": True},
                "max_content_tokens": 50000,
            },
        ]
        if body.allowed_domains:
            tools[0]["allowed_domains"] = body.allowed_domains[:10]
            tools[1]["allowed_domains"] = body.allowed_domains[:10]

        prompt = (
            f"Effectue une recherche web approfondie sur: {body.query}\n\n"
            "Processus a suivre:\n"
            "1. Recherche d'abord les informations pertinentes avec web search\n"
            "2. Identifie les 1-2 sources les plus prometteuses\n"
            "3. Recupere et analyse le contenu complet de ces sources avec web fetch\n"
            "4. Fournis une analyse detaillee et synthetique basee sur les informations trouvees\n\n"
            "Fournis une reponse structuree avec:\n"
            "- Synthese des informations trouvees\n"
            "- Points cles avec details\n"
            "- Sources citees avec leurs URLs"
        )

        # Streaming required by Anthropic for tool-use operations that can exceed 10 min
        with _anthropic_client.messages.stream(
            model=WEB_AI_MODEL,
            max_tokens=WEB_AI_MAX_TOKENS,
            temperature=0.1,
            messages=[{"role": "user", "content": prompt}],
            tools=tools,
        ) as stream:
            response = stream.get_final_message()

        parsed = _parse_web_response(response)
        elapsed = time_module.time() - start
        duration_ms = int(elapsed * 1000)

        tokens_in = getattr(response.usage, "input_tokens", 0)
        tokens_out = getattr(response.usage, "output_tokens", 0)
        cache_creation = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
        # Opus 4.7: $15/M input, $75/M output, $18.75/M cache write, $1.50/M cache read
        cost = (
            tokens_in * 15 / 1_000_000
            + tokens_out * 75 / 1_000_000
            + cache_creation * 18.75 / 1_000_000
            + cache_read * 1.50 / 1_000_000
        ) * 1.30  # 30% markup

        track_ai_usage(user, "web_search_fetch", tokens_in, tokens_out, cost, duration_ms,
                       success=True, model=WEB_AI_MODEL)
        _deduct_credits(user, cost)

        _save_search_history(user, "search_fetch", body.query, parsed["text"], len(parsed["citations"]))

        return {
            "text": parsed["text"],
            "citations": parsed["citations"],
            "search_count": parsed["search_count"],
            "fetch_count": parsed["fetch_count"],
            "input_tokens": tokens_in,
            "output_tokens": tokens_out,
            "cost_usd": round(cost, 6),
            "elapsed_seconds": round(elapsed, 2),
            "credit_balance": round(balance - cost, 4),
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("web_search_fetch error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recherche approfondie")


@router.get("/history")
async def get_search_history(
    limit: int = Query(20, le=100),
    user: ErpUser = Depends(get_current_user),
):
    """Retourne l'historique des recherches web du tenant."""
    if not user.schema:
        return {"items": []}

    conn = None
    cursor = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Check if table exists
        cursor.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_schema = current_schema() AND table_name = 'web_search_history')"
        )
        if not cursor.fetchone().get("exists", False):
            return {"items": []}

        cursor.execute(
            "SELECT id, user_id, search_type, query, result_preview, citations_count, created_at "
            "FROM web_search_history ORDER BY created_at DESC LIMIT %s",
            (limit,),
        )
        rows = cursor.fetchall()
        items = []
        for r in rows:
            items.append({
                "id": r["id"],
                "user_id": r["user_id"],
                "search_type": r["search_type"],
                "query": r["query"],
                "result_preview": r["result_preview"],
                "citations_count": r["citations_count"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            })
        return {"items": items}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_search_history error: %s", exc)
        try:
            if conn:
                conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors du chargement de l'historique")
    finally:
        if cursor:
            cursor.close()
        if conn:
            db.reset_tenant(conn)
            conn.close()
