"""
Redis Client — Rate limiting distribue et cache de sessions.

Usage:
    from infrastructure.redis_client import get_redis, rate_limit_check

    # Rate limiting
    allowed = await rate_limit_check("login", client_ip, max_requests=10, window_seconds=60)

    # Cache simple
    r = get_redis()
    if r:
        r.setex("key", 300, "value")  # TTL 5 min

Configuration:
    REDIS_URL env var (ex: redis://red-xxx.render.com:6379)
    Si absent, les fonctions retournent None/True (fallback gracieux).
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_redis_client = None
_redis_available = None

REDIS_URL = os.getenv("REDIS_URL")


def get_redis():
    """Get Redis connection. Returns None if Redis not configured or unavailable."""
    global _redis_client, _redis_available

    if _redis_available is False:
        return None

    if _redis_client is not None:
        return _redis_client

    if not REDIS_URL:
        _redis_available = False
        logger.info("REDIS_URL not set — using in-memory fallback")
        return None

    try:
        import redis
        _redis_client = redis.from_url(
            REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=3,
            socket_timeout=3,
            retry_on_timeout=True,
        )
        _redis_client.ping()
        _redis_available = True
        logger.info("Redis connected: %s", REDIS_URL[:30] + "...")
        return _redis_client
    except Exception as exc:
        _redis_available = False
        _redis_client = None
        logger.warning("Redis unavailable, using in-memory fallback: %s", exc)
        return None


def rate_limit_check(key_prefix: str, identifier: str,
                     max_requests: int = 100, window_seconds: int = 60) -> bool:
    """Check rate limit. Returns True if allowed, False if rate limited.
    Falls back to True (allow) if Redis is unavailable.
    """
    r = get_redis()
    if not r:
        return True  # No Redis = no distributed rate limit

    key = f"rl:{key_prefix}:{identifier}"
    try:
        pipe = r.pipeline()
        pipe.incr(key)
        pipe.expire(key, window_seconds)
        results = pipe.execute()
        current_count = results[0]
        return current_count <= max_requests
    except Exception as exc:
        logger.warning("Rate limit check failed: %s", exc)
        return True  # Fail open


def cache_get(key: str) -> Optional[str]:
    """Get value from cache. Returns None if miss or Redis unavailable."""
    r = get_redis()
    if not r:
        return None
    try:
        return r.get(key)
    except Exception:
        return None


def cache_set(key: str, value: str, ttl_seconds: int = 300) -> bool:
    """Set value in cache with TTL. Returns False if Redis unavailable."""
    r = get_redis()
    if not r:
        return False
    try:
        r.setex(key, ttl_seconds, value)
        return True
    except Exception:
        return False
