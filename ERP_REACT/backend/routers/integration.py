"""
ERP React Backend - Integration Router
QuickBooks Online & Sage 50 connection management.

Provides:
  - OAuth 2.0 flow for QuickBooks Online (Intuit)
  - ODBC/DSN configuration for Sage 50
  - Connection CRUD, test, sync triggers
  - Sync history & statistics
  - Auto-provisioning of integration tables per tenant
"""

import os
import json
import logging
import hashlib
import secrets
import base64
import re
import time as _time
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from ..erp_auth import require_role, ErpUser
from .. import erp_database as db

# Reuse Fernet helpers from emails.py to keep a single source of truth for
# encryption (lecon S33 #1 - tokens OAuth doivent etre chiffres au repos).
# encrypt_password/decrypt_password derivent leur cle de EMAIL_SECRET_KEY
# (fallback SECRET_KEY) via SHA256 + base64.urlsafe_b64encode.
try:
    from .emails import encrypt_password as _encrypt_secret  # noqa: F401
    from .emails import decrypt_password as _decrypt_secret  # noqa: F401
    _HAS_CRYPTO = True
except Exception:  # pragma: no cover - defensive
    _encrypt_secret = None  # type: ignore
    _decrypt_secret = None  # type: ignore
    _HAS_CRYPTO = False

logger = logging.getLogger(__name__)

# Fernet ciphertext always starts with "gAAAA" (base64 of version byte 0x80).
# Lecture defensive : un token sans ce prefixe est considere legacy clair et
# sera re-chiffre au prochain UPDATE.
_FERNET_PREFIX = "gAAAA"


def _encrypt_token(plain: Optional[str]) -> Optional[str]:
    """Chiffre un token OAuth via Fernet. Retourne None si plain est falsy.

    Lecon QA1-R4 S33 (durci): refuse de stocker un token en clair si Fernet
    indisponible. Sans ce raise, un EMAIL_SECRET_KEY manquant en prod aurait
    stocke des tokens OAuth en clair en BD - vol direct si breach BD.
    Le caller doit donc verifier que EMAIL_SECRET_KEY est configuree avant
    d'initier un flow OAuth.
    """
    if not plain:
        return None
    if not _HAS_CRYPTO or _encrypt_secret is None:
        logger.critical("integration: Fernet indisponible, REFUS de stocker token QB. Configurer EMAIL_SECRET_KEY.")
        raise HTTPException(
            status_code=500,
            detail="Chiffrement non disponible cote serveur. Contactez l'administrateur (EMAIL_SECRET_KEY manquante).",
        )
    try:
        return _encrypt_secret(plain)
    except Exception as exc:
        logger.error("integration: encrypt token QB echec: %s", type(exc).__name__)
        raise HTTPException(
            status_code=500,
            detail="Erreur de chiffrement du token. Contactez l'administrateur.",
        )


def _decrypt_token(stored: Optional[str]) -> Optional[str]:
    """Dechiffre un token OAuth. Si le payload n'a pas le prefixe Fernet,
    il est considere clair (legacy migration window) et retourne tel quel.
    """
    if not stored:
        return None
    if not stored.startswith(_FERNET_PREFIX):
        return stored  # legacy clear-text (sera re-chiffre au prochain UPDATE)
    if not _HAS_CRYPTO or _decrypt_secret is None:
        logger.error("integration: Fernet indisponible mais token chiffre en BD (EMAIL_SECRET_KEY manquante)")
        return None
    try:
        return _decrypt_secret(stored)
    except Exception as exc:
        logger.error("integration: decrypt token QB echec: %s", type(exc).__name__)
        return None

router = APIRouter(tags=["Integration"])

# ── Environment variables ───────────────────────────────────
QB_CLIENT_ID = os.getenv("QUICKBOOKS_CLIENT_ID", "")
QB_CLIENT_SECRET = os.getenv("QUICKBOOKS_CLIENT_SECRET", "")
QB_REDIRECT_URI = os.getenv("QUICKBOOKS_REDIRECT_URI", "http://localhost:5174/integration?callback=quickbooks")
QB_ENVIRONMENT = os.getenv("QUICKBOOKS_ENVIRONMENT", "sandbox")

QB_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2"
QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
QB_API_BASE = {
    "sandbox": "https://sandbox-quickbooks.api.intuit.com",
    "production": "https://quickbooks.api.intuit.com",
}
QB_SCOPES = "com.intuit.quickbooks.accounting"

# Allowed column names for dynamic UPDATE (defense-in-depth)
_ALLOWED_UPDATE_COLS = {"name", "status", "sync_frequency", "config"}


# ── Pydantic models ─────────────────────────────────────────
class ConnectionCreate(BaseModel):
    provider: str
    name: str
    config: dict = {}

class ConnectionUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    sync_frequency: Optional[str] = None
    config: Optional[dict] = None

class SyncRequest(BaseModel):
    direction: Optional[str] = "export"
    entity_type: Optional[str] = None


# ── Table provisioning ──────────────────────────────────────
def _ensure_integration_tables(cursor):
    """Create integration tables if they don't exist (defensive, per-tenant).

    Le SAVEPOINT plus bas (autour du CREATE UNIQUE INDEX idx_entity_map_unique)
    exige un bloc transactionnel. psycopg2 pool peut retourner des connexions
    en autocommit=True (lecon #122) — dans ce mode SAVEPOINT echoue avec
    "SAVEPOINT can only be used in transaction blocks" et casse les endpoints
    list_connections, get_sync_stats, etc.

    On bascule temporairement en autocommit=False, on commit les DDL a la fin,
    et on restaure l'etat d'origine pour ne pas polluer le pool psycopg2.
    """
    conn = cursor.connection
    prev_autocommit = None
    try:
        prev_autocommit = conn.autocommit
    except Exception:
        pass

    try:
        if prev_autocommit:
            try:
                conn.autocommit = False
            except Exception:
                pass

        _run_integration_tables_ddl(cursor)

        try:
            conn.commit()
        except Exception as commit_exc:
            try:
                conn.rollback()
            except Exception as rollback_exc:
                logger.error(
                    "integration: commit AND rollback failed. "
                    "commit=%s | rollback=%s",
                    commit_exc, rollback_exc,
                )
            raise
    finally:
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception as restore_exc:
                logger.warning(
                    "integration: restore conn.autocommit=%s failed: %s",
                    prev_autocommit, restore_exc,
                )


def _run_integration_tables_ddl(cursor):
    """Body interne de _ensure_integration_tables. Extrait pour permettre
    l'encadrement autocommit/commit/restore sans reecrire la logique DDL."""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS integrations (
            id SERIAL PRIMARY KEY,
            provider TEXT NOT NULL,
            name TEXT NOT NULL,
            status TEXT DEFAULT 'disconnected',
            config JSONB DEFAULT '{}',
            access_token TEXT,
            refresh_token TEXT,
            token_expires_at TIMESTAMP,
            realm_id TEXT,
            sync_frequency TEXT DEFAULT 'manual',
            last_sync_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Lecon M1 S33: ON DELETE SET NULL preserve l'audit trail comptable
    # apres suppression de connexion. Le precedent CASCADE detruisait
    # tout l'historique avec la connexion - non conforme pour audit financier.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS integration_sync_logs (
            id SERIAL PRIMARY KEY,
            connection_id INTEGER REFERENCES integrations(id) ON DELETE SET NULL,
            provider TEXT NOT NULL,
            direction TEXT DEFAULT 'export',
            entity_type TEXT,
            entity_id INTEGER,
            status TEXT DEFAULT 'pending',
            details TEXT,
            error_message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Migration in-place pour tenants existants : drop ancien FK CASCADE
    # et recreer en SET NULL. Idempotent : on tente, on tolere si le FK
    # n'existe pas ou est deja en SET NULL.
    #
    # Lecon QA1-R11 S33: ALTER TABLE prend ACCESS EXCLUSIVE lock. Si un
    # worker concurrent fait un INSERT sur integration_sync_logs, on
    # bloquerait jusqu'au timeout PG defaut. SET lock_timeout = 2s pour
    # fail-fast: si lock impossible, on log et on continue (la migration
    # sera retentee au prochain hit endpoint). Le schema reste fonctionnel
    # avec l'ancien FK CASCADE jusque-la.
    try:
        cursor.execute("SAVEPOINT sp_sync_logs_fk")
        cursor.execute("SET LOCAL lock_timeout = '2s'")
        cursor.execute("""
            ALTER TABLE integration_sync_logs
            DROP CONSTRAINT IF EXISTS integration_sync_logs_connection_id_fkey
        """)
        cursor.execute("""
            ALTER TABLE integration_sync_logs
            ADD CONSTRAINT integration_sync_logs_connection_id_fkey
            FOREIGN KEY (connection_id) REFERENCES integrations(id) ON DELETE SET NULL
        """)
        cursor.execute("RELEASE SAVEPOINT sp_sync_logs_fk")
    except Exception as fk_exc:
        try:
            cursor.execute("ROLLBACK TO SAVEPOINT sp_sync_logs_fk")
        except Exception:
            pass
        # Lock_timeout error: code 55P03 (lock_not_available). Autres = vrais bugs.
        logger.warning("integration_sync_logs FK migration M1 skipped: %s", type(fk_exc).__name__)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS integration_entity_map (
            id SERIAL PRIMARY KEY,
            connection_id INTEGER REFERENCES integrations(id) ON DELETE CASCADE,
            entity_type TEXT NOT NULL,
            local_id INTEGER NOT NULL,
            external_id TEXT NOT NULL,
            last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # CREATE INDEX IF NOT EXISTS can race between concurrent workers on a
    # fresh tenant and raise "duplicate key pg_class_relname_nsp_index".
    # Wrap in a SAVEPOINT so the race does not abort the surrounding
    # transaction (which would break any subsequent cursor.execute with
    # "current transaction is aborted").
    #
    # SAVEPOINT requires an active transaction block. The outer wrapper
    # tries to switch the connection to autocommit=False, but the switch
    # can fail silently (observed in prod 2026-04-26: list_connections +
    # get_sync_stats logged "SAVEPOINT can only be used in transaction
    # blocks"). Probe psycopg2's transaction_status and skip SAVEPOINT if
    # we are not actually inside a transaction — rely on plain exception
    # handling for the duplicate-key race instead.
    in_transaction = False
    try:
        from psycopg2.extensions import TRANSACTION_STATUS_INTRANS
        in_transaction = (
            cursor.connection.info.transaction_status == TRANSACTION_STATUS_INTRANS
        )
    except Exception:
        in_transaction = False

    if in_transaction:
        cursor.execute("SAVEPOINT sp_integration_idx")
    try:
        cursor.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_map_unique
            ON integration_entity_map(connection_id, entity_type, local_id)
        """)
        # Lecon QA4-R23 S33: index sur external_id pour les lookups
        # WHERE connection_id = ? AND entity_type = ? AND external_id = ?
        # (utilise dans _sync_*_from_qb pour detection "deja importe").
        # Sans cet index, full scan sur 10k+ rows/tenant.
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_entity_map_external
            ON integration_entity_map(connection_id, entity_type, external_id)
        """)
        if in_transaction:
            cursor.execute("RELEASE SAVEPOINT sp_integration_idx")
    except Exception as exc:
        if in_transaction:
            try:
                cursor.execute("ROLLBACK TO SAVEPOINT sp_integration_idx")
            except Exception:
                pass
        _msg = str(exc).lower()
        if not any(tok in _msg for tok in ("duplicate key", "pg_class_relname", "already exists")):
            raise
        logger.warning("CREATE INDEX idx_entity_map race: %s", exc)


# ── Helpers ──────────────────────────────────────────────────
def _row_to_connection(row):
    """Convert a DB row to a safe connection dict (hide tokens)."""
    return {
        "id": row["id"],
        "provider": row["provider"],
        "name": row["name"],
        "status": row.get("status", "disconnected"),
        "config": row.get("config") or {},
        "realm_id": row.get("realm_id"),
        "sync_frequency": row.get("sync_frequency", "manual"),
        "last_sync_at": str(row["last_sync_at"]) if row.get("last_sync_at") else None,
        "has_token": bool(row.get("access_token")),
        "token_expires_at": str(row["token_expires_at"]) if row.get("token_expires_at") else None,
        "created_at": str(row["created_at"]) if row.get("created_at") else None,
        "updated_at": str(row["updated_at"]) if row.get("updated_at") else None,
    }


def _log_sync(cursor, connection_id, provider, direction, entity_type,
              entity_id=None, status="success", details=None, error_message=None):
    """Insert a sync log entry."""
    cursor.execute(
        """INSERT INTO integration_sync_logs
           (connection_id, provider, direction, entity_type, entity_id, status, details, error_message)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (connection_id, provider, direction, entity_type, entity_id, status, details, error_message),
    )


# ── QuickBooks Token Refresh ──────────────────────────────

def _refresh_qb_token(cursor, conn, connection_id, refresh_token_value, *, use_savepoint=False):
    """Refresh QB access token using the stored refresh token.
    Updates DB and returns new access_token, or None on failure.

    Lecon QA4-R16 S33: si appele en plein milieu d'un sync (mid-SAVEPOINT
    du caller), use_savepoint=True utilise SAVEPOINT au lieu de COMMIT pour
    ne pas detruire le SAVEPOINT parent du caller. Le nouveau token est
    persiste au prochain commit du caller. Si rollback, on perd le token
    refresh - acceptable car le prochain coup re-refresh.
    """
    if not QB_CLIENT_ID or not QB_CLIENT_SECRET:
        logger.error("QB credentials not configured for token refresh")
        return None
    try:
        import requests as _requests
    except ImportError:
        logger.error("requests module not available for QB token refresh")
        return None

    auth_header = base64.b64encode(
        f"{QB_CLIENT_ID}:{QB_CLIENT_SECRET}".encode()
    ).decode()
    # Lecon M5 S33: retry exponentiel sur timeout reseau (1s, 2s, 4s).
    # Sans retry, un transient reseau = deconnexion permanente cote ERP.
    resp = None
    for attempt in range(3):
        try:
            resp = _requests.post(
                QB_TOKEN_URL,
                headers={
                    "Authorization": f"Basic {auth_header}",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                },
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token_value,
                },
                timeout=15,
            )
            break
        except Exception as net_exc:
            if attempt < 2:
                wait = 2 ** attempt  # 1s, 2s
                logger.warning("QB token refresh timeout (tentative %d/3): %s, retry dans %ss",
                               attempt + 1, type(net_exc).__name__, wait)
                _time.sleep(wait)
                continue
            logger.error("QB token refresh echoue apres 3 tentatives: %s", type(net_exc).__name__)
            return None
    try:
        if resp is None or resp.status_code != 200:
            # Lecon H4 S33: pas de resp.text en clair (peut leak info Intuit).
            logger.error("QB token refresh failed: status=%s",
                         resp.status_code if resp is not None else "no_response")
            return None

        tokens = resp.json()
        new_access = tokens.get("access_token")
        new_refresh = tokens.get("refresh_token", refresh_token_value)
        expires_in = tokens.get("expires_in", 3600)

        if not new_access:
            logger.error("QB token refresh: no access_token in response")
            return None

        expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
        # Lecon QA4-R16 S33: si on est mid-SAVEPOINT (use_savepoint=True),
        # encapsuler l'UPDATE dans un SAVEPOINT local au lieu d'un COMMIT
        # global. Le COMMIT detruisait tous les SAVEPOINTs du caller, faisant
        # echouer le ROLLBACK TO SAVEPOINT sync_item en cas d'erreur ulterieure.
        if use_savepoint:
            cursor.execute("SAVEPOINT sp_token_refresh_update")
            try:
                cursor.execute(
                    """UPDATE integrations
                       SET access_token = %s, refresh_token = %s, token_expires_at = %s,
                           status = 'connected', updated_at = CURRENT_TIMESTAMP
                       WHERE id = %s""",
                    (_encrypt_token(new_access), _encrypt_token(new_refresh), expires_at, connection_id),
                )
                cursor.execute("RELEASE SAVEPOINT sp_token_refresh_update")
            except Exception:
                try:
                    cursor.execute("ROLLBACK TO SAVEPOINT sp_token_refresh_update")
                except Exception:
                    pass
                raise
        else:
            cursor.execute(
                """UPDATE integrations
                   SET access_token = %s, refresh_token = %s, token_expires_at = %s,
                       status = 'connected', updated_at = CURRENT_TIMESTAMP
                   WHERE id = %s""",
                (_encrypt_token(new_access), _encrypt_token(new_refresh), expires_at, connection_id),
            )
            conn.commit()
        logger.info("QB token refreshed for connection %s", connection_id)
        return new_access
    except HTTPException:
        # Lecon QA2-R12 S33 + lecon #5: re-raise HTTPException (ex: Fernet
        # indisponible via _encrypt_token raise 500). Sans ce raise explicite,
        # l'except Exception en dessous masquait silencieusement la panne
        # systeme en retournant None - l'admin ignorerait que EMAIL_SECRET_KEY
        # est manquant et verrait juste "impossible de renouveler" en boucle.
        raise
    except Exception as exc:
        logger.error("QB token refresh error: %s", type(exc).__name__)
        return None


def _get_valid_qb_connection(cursor, conn, connection_id):
    """Get QB connection with valid token. Auto-refreshes if expired.
    Returns (access_token, realm_id) or raises HTTPException.

    Lecon H1 (S33): SELECT FOR UPDATE empeche 2 workers de declencher un
    refresh concurrent qui invaliderait mutuellement leurs nouveaux tokens.
    """
    cursor.execute(
        "SELECT * FROM integrations WHERE id = %s AND provider = 'quickbooks' FOR UPDATE",
        (connection_id,),
    )
    row = cursor.fetchone()
    if not row:
        raise HTTPException(404, "Connexion QuickBooks non trouv\u00e9e")
    if row["status"] == "disconnected":
        raise HTTPException(400, "QuickBooks non connect\u00e9. Lancez l'autorisation OAuth.")

    # Dechiffrement transparent (lecon C1 S33). Si token legacy clair en BD,
    # _decrypt_token le retourne tel quel - sera re-chiffre au prochain UPDATE.
    access_token = _decrypt_token(row.get("access_token"))
    refresh_token = _decrypt_token(row.get("refresh_token"))
    realm_id = row.get("realm_id")
    expires_at = row.get("token_expires_at")

    if not access_token or not realm_id:
        raise HTTPException(400, "QuickBooks non connect\u00e9. Lancez l'autorisation OAuth.")

    # Refresh if token expired, will expire within 5 minutes, or expires_at unknown
    if not expires_at or datetime.utcnow() >= (expires_at - timedelta(minutes=5)):
        if not refresh_token:
            cursor.execute(
                "UPDATE integrations SET status = 'error' WHERE id = %s",
                (connection_id,),
            )
            conn.commit()
            raise HTTPException(401, "Token QuickBooks expir\u00e9 sans refresh token. Reconnectez.")

        new_token = _refresh_qb_token(cursor, conn, connection_id, refresh_token)
        if not new_token:
            # Re-read row: another process may have refreshed concurrently
            cursor.execute(
                "SELECT access_token, token_expires_at FROM integrations WHERE id = %s",
                (connection_id,),
            )
            recheck = cursor.fetchone()
            if (recheck and recheck.get("token_expires_at")
                    and datetime.utcnow() < recheck["token_expires_at"]):
                # Another process already refreshed - use its (encrypted) token
                return _decrypt_token(recheck["access_token"]), realm_id
            cursor.execute(
                "UPDATE integrations SET status = 'error' WHERE id = %s",
                (connection_id,),
            )
            conn.commit()
            raise HTTPException(401, "Impossible de renouveler le token QuickBooks. Reconnectez.")
        access_token = new_token
        _log_sync(cursor, connection_id, "quickbooks", "import", "token_refresh",
                  status="success", details="Token renouvel\u00e9 automatiquement")
        conn.commit()

    return access_token, realm_id


# ── QuickBooks API Helpers ─────────────────────────────────

# Lecon C4 S33: handler 401 (auto-refresh) + 429 (backoff exponentiel).
# Lecon H4 S33: ne pas logger resp.text en clair (peut leak schema/tenant).
# Acceptable cap des retries : 429 -> max 3, 401 -> 1 (refresh + retry).

def _qb_api_request(method, access_token, realm_id, resource,
                    query=None, payload=None, *,
                    cursor=None, conn=None, connection_id=None,
                    max_429_retries=3):
    """Wrapper unifie GET/POST QuickBooks avec auto-refresh 401 + backoff 429.

    Si cursor/conn/connection_id fournis, un 401 declenche un auto-refresh
    du token via _refresh_qb_token + retry une fois. Sinon le 401 propage.

    Backoff 429 : utilise Retry-After si present, sinon exponentiel 2/4/8s.
    Le caller recoit le JSON parse, ou None sur echec irrecuperable.

    Returns (response_json_or_None, refreshed_access_token_or_None).
    Le 2e element permet au caller de propager le nouveau token si pertinent.
    """
    import requests as _requests
    api_base = QB_API_BASE.get(QB_ENVIRONMENT, QB_API_BASE["sandbox"])
    url = f"{api_base}/v3/company/{realm_id}/{resource}"
    refreshed_token = None
    current_token = access_token
    retry_count_429 = 0
    tried_refresh = False

    while True:
        params = {"query": query} if query else None
        try:
            if method == "GET":
                resp = _requests.get(
                    url,
                    headers={"Authorization": f"Bearer {current_token}", "Accept": "application/json"},
                    params=params,
                    timeout=15,
                )
            else:  # POST
                resp = _requests.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {current_token}",
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=15,
                )
        except Exception as exc:
            logger.error("QB API %s %s: %s", method, resource, type(exc).__name__)
            return None, refreshed_token

        # Success
        if resp.status_code in (200, 201):
            return resp.json(), refreshed_token

        # 401 -> tenter auto-refresh une fois si possible
        if resp.status_code == 401 and not tried_refresh and cursor is not None and conn is not None and connection_id is not None:
            tried_refresh = True
            cursor.execute(
                "SELECT refresh_token FROM integrations WHERE id = %s",
                (connection_id,),
            )
            r = cursor.fetchone()
            if r and r.get("refresh_token"):
                refresh_clear = _decrypt_token(r["refresh_token"])
                if refresh_clear:
                    # Lecon QA4-R16 S33: use_savepoint=True car on est appele
                    # mid-sync (le caller a un SAVEPOINT actif sync_item).
                    # Un commit ici detruirait ce SAVEPOINT parent.
                    new_access = _refresh_qb_token(
                        cursor, conn, connection_id, refresh_clear,
                        use_savepoint=True,
                    )
                    if new_access:
                        current_token = new_access
                        refreshed_token = new_access
                        # Lecon QA1-R1 S33: reset 429 counter apres refresh,
                        # sinon un cumul 401+429 anterieur exhauste les retries.
                        retry_count_429 = 0
                        continue  # retry with fresh token
            logger.warning("QB API %s %s: 401 mais refresh impossible", method, resource)
            return None, refreshed_token

        # 429 -> backoff exponentiel
        if resp.status_code == 429 and retry_count_429 < max_429_retries:
            retry_count_429 += 1
            retry_after = resp.headers.get("Retry-After")
            if retry_after and retry_after.isdigit():
                wait = min(int(retry_after), 60)
            else:
                wait = 2 ** retry_count_429  # 2, 4, 8 secondes
            logger.warning("QB API %s %s: 429 throttle, wait %ss (retry %d/%d)",
                           method, resource, wait, retry_count_429, max_429_retries)
            _time.sleep(wait)
            continue

        # Autres erreurs : log sans corps brut (lecon H4)
        logger.error("QB API %s %s: status=%s", method, resource, resp.status_code)
        return None, refreshed_token


def _qb_api_get(access_token, realm_id, resource, query=None,
                *, cursor=None, conn=None, connection_id=None,
                token_holder=None):
    """GET from QuickBooks API. Returns parsed JSON or None.
    Si cursor/conn/connection_id fournis, auto-refresh sur 401 + backoff 429.

    Lecon QA1-R2 S33: si `token_holder` (dict {"access": ...}) fourni et
    qu'un refresh se produit, on met a jour token_holder["access"] pour
    que le caller (sync helpers) puisse propager le nouveau token sur
    ses appels suivants. Sans ca, chaque appel ulterieur faisait un 401
    inutile suivi d'un refresh redondant.
    """
    result, refreshed = _qb_api_request(
        "GET", access_token, realm_id, resource,
        query=query, cursor=cursor, conn=conn, connection_id=connection_id,
    )
    if refreshed and token_holder is not None:
        token_holder["access"] = refreshed
    return result


def _qb_api_post(access_token, realm_id, resource, payload,
                 *, cursor=None, conn=None, connection_id=None,
                 token_holder=None):
    """POST to QuickBooks API. Returns parsed JSON or None.
    Si cursor/conn/connection_id fournis, auto-refresh sur 401 + backoff 429.
    Voir _qb_api_get pour le pattern token_holder (lecon QA1-R2).
    """
    result, refreshed = _qb_api_request(
        "POST", access_token, realm_id, resource,
        payload=payload, cursor=cursor, conn=conn, connection_id=connection_id,
    )
    if refreshed and token_holder is not None:
        token_holder["access"] = refreshed
    return result


def _qb_api_paginated_query(access_token, realm_id, base_query, entity_key,
                             *, cursor=None, conn=None, connection_id=None,
                             token_holder=None,
                             page_size=1000, safety_cap=10000):
    """Pagine une query QB via STARTPOSITION + MAXRESULTS.

    Lecon C2 S33: les anciens MAXRESULTS 100/50 hardcodes perdaient
    silencieusement les enregistrements au-dela. Cette fonction parcourt
    toutes les pages jusqu'a `safety_cap` (defaut 10000).

    Lecon QA1-R2: utilise un token_holder local pour propager les refresh
    de token entre les pages (eviter 401 redondant a chaque page).

    Args:
        base_query: query SQL-like sans STARTPOSITION/MAXRESULTS, ex:
                    "SELECT * FROM Customer WHERE Active = true"
        entity_key: nom de l'entite dans QueryResponse, ex: "Customer" ou "Invoice"
        page_size: 1000 est le max autorise par Intuit pour query API.
        token_holder: dict {"access": token} mute par le caller si refresh
                      doit propager au-dela de cette fonction. Sinon local.

    Returns: liste de tous les items recuperes (peut etre vide).
    """
    all_items = []
    start = 1
    local_holder = token_holder if token_holder is not None else {"access": access_token}
    while True:
        full_query = f"{base_query} STARTPOSITION {start} MAXRESULTS {page_size}"
        result = _qb_api_get(
            local_holder["access"], realm_id, "query", query=full_query,
            cursor=cursor, conn=conn, connection_id=connection_id,
            token_holder=local_holder,
        )
        if not result or "QueryResponse" not in result:
            break
        batch = result["QueryResponse"].get(entity_key, []) or []
        if not batch:
            break
        all_items.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
        if len(all_items) >= safety_cap:
            logger.warning("QB pagination safety cap %d atteint (entite=%s), stop. Relancer le sync pour traiter la suite.",
                           safety_cap, entity_key)
            break
    return all_items


# ══════════════════════════════════════════════════════════════
#  CONNECTIONS CRUD
# ══════════════════════════════════════════════════════════════

@router.get("/integrations")
async def list_connections(
    user: ErpUser = Depends(require_role("admin", "super_admin")),
):
    if not user.schema:
        raise HTTPException(400, "Contexte entreprise requis")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_integration_tables(cursor)
        conn.commit()
        cursor.execute("SELECT * FROM integrations ORDER BY created_at DESC")
        rows = cursor.fetchall()
        return {"items": [_row_to_connection(r) for r in rows], "total": len(rows)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_connections error: %s", exc)
        return {"items": [], "total": 0}
    finally:
        db.reset_tenant(conn)
        if cursor:
            cursor.close()
        conn.close()


@router.post("/integrations")
async def create_connection(
    body: ConnectionCreate,
    user: ErpUser = Depends(require_role("admin", "super_admin")),
):
    if not user.schema:
        raise HTTPException(400, "Contexte entreprise requis")
    if body.provider not in ("quickbooks", "sage50"):
        raise HTTPException(400, "Fournisseur invalide. Utilisez 'quickbooks' ou 'sage50'.")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_integration_tables(cursor)
        cursor.execute(
            """INSERT INTO integrations (provider, name, status, config)
               VALUES (%s, %s, 'pending', %s::jsonb) RETURNING id""",
            (body.provider, body.name, json.dumps(body.config)),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": f"Connexion {body.provider} cr\u00e9\u00e9e"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_connection error: %s", exc)
        raise HTTPException(500, "Erreur lors de la cr\u00e9ation de la connexion")
    finally:
        db.reset_tenant(conn)
        if cursor:
            cursor.close()
        conn.close()


@router.put("/integrations/{connection_id}")
async def update_connection(
    connection_id: int,
    body: ConnectionUpdate,
    user: ErpUser = Depends(require_role("admin", "super_admin")),
):
    if not user.schema:
        raise HTTPException(400, "Contexte entreprise requis")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_integration_tables(cursor)
        updates = body.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(400, "Aucun champ \u00e0 mettre \u00e0 jour")

        set_clauses = []
        values = []
        for key, val in updates.items():
            if key not in _ALLOWED_UPDATE_COLS:
                continue
            if key == "config":
                set_clauses.append("config = %s::jsonb")
                values.append(json.dumps(val))
            else:
                set_clauses.append(f"{key} = %s")
                values.append(val)
        if not set_clauses:
            raise HTTPException(400, "Aucun champ valide \u00e0 mettre \u00e0 jour")
        set_clauses.append("updated_at = CURRENT_TIMESTAMP")
        values.append(connection_id)

        cursor.execute(
            f"UPDATE integrations SET {', '.join(set_clauses)} WHERE id = %s",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(404, "Connexion non trouv\u00e9e")
        conn.commit()
        return {"message": "Connexion mise \u00e0 jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_connection error: %s", exc)
        raise HTTPException(500, "Erreur lors de la mise \u00e0 jour")
    finally:
        db.reset_tenant(conn)
        if cursor:
            cursor.close()
        conn.close()


@router.delete("/integrations/{connection_id}")
async def delete_connection(
    connection_id: int,
    user: ErpUser = Depends(require_role("admin", "super_admin")),
):
    if not user.schema:
        raise HTTPException(400, "Contexte entreprise requis")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_integration_tables(cursor)

        # Lecon H2 S33: avant DELETE, revoquer le token cote Intuit pour
        # invalider l'acces (sinon un token capture reste actif jusqu'a son
        # expiration naturelle). Best-effort: si revoke echoue (reseau, QB API
        # down), on continue la suppression locale.
        cursor.execute(
            "SELECT provider, refresh_token, access_token FROM integrations WHERE id = %s",
            (connection_id,),
        )
        existing = cursor.fetchone()
        if existing and existing.get("provider") == "quickbooks":
            token_to_revoke = _decrypt_token(existing.get("refresh_token") or existing.get("access_token"))
            if token_to_revoke and QB_CLIENT_ID and QB_CLIENT_SECRET:
                try:
                    import requests as _requests
                    revoke_auth = base64.b64encode(
                        f"{QB_CLIENT_ID}:{QB_CLIENT_SECRET}".encode()
                    ).decode()
                    revoke_resp = _requests.post(
                        "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
                        headers={
                            "Authorization": f"Basic {revoke_auth}",
                            "Content-Type": "application/json",
                            "Accept": "application/json",
                        },
                        json={"token": token_to_revoke},
                        timeout=10,
                    )
                    if revoke_resp.status_code not in (200, 204):
                        logger.warning("QB token revoke status=%s pour connection %s",
                                       revoke_resp.status_code, connection_id)
                except Exception as revoke_exc:
                    logger.warning("QB token revoke echec %s pour connection %s",
                                   type(revoke_exc).__name__, connection_id)

        cursor.execute("DELETE FROM integrations WHERE id = %s", (connection_id,))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Connexion non trouv\u00e9e")
        conn.commit()
        return {"message": "Connexion supprim\u00e9e"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_connection error: %s", type(exc).__name__)
        raise HTTPException(500, "Erreur lors de la suppression")
    finally:
        db.reset_tenant(conn)
        if cursor:
            cursor.close()
        conn.close()


# ══════════════════════════════════════════════════════════════
#  QUICKBOOKS OAUTH 2.0
# ══════════════════════════════════════════════════════════════

@router.get("/integrations/quickbooks/auth-url")
async def get_quickbooks_auth_url(
    connection_id: int = Query(...),
    user: ErpUser = Depends(require_role("admin", "super_admin")),
):
    if not QB_CLIENT_ID:
        raise HTTPException(400, "QuickBooks n'est pas configur\u00e9 sur ce serveur. Contactez l'administrateur.")
    state = hashlib.sha256(f"{user.schema}:{connection_id}:{secrets.token_hex(8)}".encode()).hexdigest()[:32]
    # Lecon C3 S33: stocker un timestamp ISO pour faire expirer le state
    # apres 10 min (anti-CSRF replay). Format: 'YYYY-MM-DDTHH:MM:SSZ'.
    state_created_at = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_integration_tables(cursor)
        cursor.execute(
            "UPDATE integrations SET config = config || %s::jsonb, status = 'pending' WHERE id = %s",
            (json.dumps({
                "oauth_state": state,
                "oauth_state_created_at": state_created_at,
                "tenant_schema": user.schema,
            }), connection_id),
        )
        conn.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_quickbooks_auth_url error: %s", exc)
        raise HTTPException(500, "Erreur lors de la pr\u00e9paration OAuth")
    finally:
        db.reset_tenant(conn)
        if cursor:
            cursor.close()
        conn.close()

    auth_url = (
        f"{QB_AUTH_URL}"
        f"?client_id={QB_CLIENT_ID}"
        f"&response_type=code"
        f"&scope={QB_SCOPES}"
        f"&redirect_uri={quote(QB_REDIRECT_URI, safe='')}"
        f"&state={state}"
    )
    return {"auth_url": auth_url, "state": state}


@router.post("/integrations/quickbooks/callback")
async def quickbooks_oauth_callback(
    request: Request,
    user: ErpUser = Depends(require_role("admin", "super_admin")),
):
    body = await request.json()
    code = body.get("code")
    realm_id = body.get("realmId") or body.get("realm_id")
    state = body.get("state")

    if not code:
        raise HTTPException(400, "Code d'autorisation requis")
    if not state:
        raise HTTPException(400, "Param\u00e8tre state requis pour la v\u00e9rification CSRF")
    if not QB_CLIENT_ID or not QB_CLIENT_SECRET:
        raise HTTPException(400, "QuickBooks non configur\u00e9 sur ce serveur")

    # Exchange code for tokens
    try:
        import requests as _requests
    except ImportError:
        raise HTTPException(500, "Module requests non disponible")

    auth_header = base64.b64encode(f"{QB_CLIENT_ID}:{QB_CLIENT_SECRET}".encode()).decode()
    token_resp = _requests.post(
        QB_TOKEN_URL,
        headers={
            "Authorization": f"Basic {auth_header}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": QB_REDIRECT_URI,
        },
        timeout=15,
    )

    if token_resp.status_code != 200:
        # Lecon H4 S33: ne pas logger resp.text en clair (peut leak schema/tenant info).
        logger.error("QB token exchange failed: status=%s", token_resp.status_code)
        raise HTTPException(400, "Erreur d'authentification QuickBooks. R\u00e9essayez.")

    tokens = token_resp.json()
    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    expires_in = tokens.get("expires_in", 3600)

    if not access_token:
        raise HTTPException(400, "Aucun token reçu de QuickBooks")

    # realmId may come from callback URL params or from stored connection config
    if not realm_id:
        logger.warning("realmId missing from OAuth callback, will use stored value if available")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_integration_tables(cursor)

        # Find connection with matching state (mandatory CSRF check)
        # Lecon C3 S33: recuperer aussi oauth_state_created_at pour valider TTL 10min.
        cursor.execute(
            """SELECT id, realm_id,
                      config->>'oauth_state_created_at' AS oauth_state_created_at
               FROM integrations
               WHERE provider = 'quickbooks' AND config->>'oauth_state' = %s""",
            (state,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(400, "État OAuth invalide. Relancez la connexion.")

        # Lecon C3 + QA1-R8 S33: refuser state expire (>10 min). Anti-CSRF replay.
        # Si format invalide, REJET (durci): un format casse = etat suspect, on
        # ne fait pas confiance. Le precedent comportement permissif aurait
        # accepte un state forge sans timestamp interpretable.
        state_created_iso = row.get("oauth_state_created_at")
        if state_created_iso:
            try:
                state_created = datetime.strptime(state_created_iso, "%Y-%m-%dT%H:%M:%SZ")
            except (ValueError, TypeError):
                logger.warning("oauth_state_created_at format invalide pour connection %s", row["id"])
                raise HTTPException(400, "État OAuth corrompu. Relancez la connexion.")
            if datetime.utcnow() - state_created > timedelta(minutes=10):
                raise HTTPException(400, "État OAuth expiré (>10 min). Relancez la connexion.")
            # Lecon QA4-R21 S33: si l'horloge serveur a recule (NTP resync, etc.)
            # et qu'on accepte le state, un attaquant peut rejouer le callback
            # indefiniment. Rejeter explicitement plutot que log only.
            if datetime.utcnow() < state_created - timedelta(minutes=1):
                logger.critical("Horloge serveur reculee detectee (NTP?), rejet du state pour connection %s", row["id"])
                raise HTTPException(500, "Erreur serveur: horloge invalide. Réessayez dans 1 minute.")

        # Lecon QA4-R22 S33: refuser tentative de substitution realm_id.
        # Si une connexion existante a deja un realm_id stocke, le callback
        # doit fournir EXACTEMENT le meme realm_id (Intuit l'envoie toujours).
        # Sans ce check, un attaquant avec un state valide (replay attack apres
        # breach BD) pourrait re-associer la connexion a un realm_id arbitraire.
        stored_realm = row.get("realm_id") or ""
        if stored_realm and realm_id and realm_id != stored_realm:
            logger.warning("Tentative substitution realm_id pour connection %s (callback differe du stocke)", row["id"])
            raise HTTPException(400, "realmId ne correspond pas à la connexion. Relancez OAuth.")

        # Use provided realmId (premiere connexion), or fall back to stored (reconnexion).
        final_realm_id = realm_id or stored_realm or ""

        # Lecon M3 + C3 S33: refuser realm_id vide ET valider format numerique.
        # Lecon QA1-R7 S33: cap longueur a 20 chiffres (Intuit companyId est un
        # long 64-bit = max ~19 chiffres). Empeche injection via realm_id geant.
        if not final_realm_id:
            raise HTTPException(400, "realmId QuickBooks manquant. Relancez la connexion depuis Intuit.")
        if not re.match(r"^[0-9]{1,20}$", final_realm_id):
            logger.warning("realm_id format suspect (len=%d) pour connection %s",
                           len(final_realm_id), row["id"])
            raise HTTPException(400, "Format realmId QuickBooks invalide.")

        expires_at = datetime.utcnow() + timedelta(seconds=expires_in)

        # Lecon M7 S33: tester immediatement le token avant de confirmer 'connected'.
        # Si Intuit refuse, marquer 'error' plutot que faux 'connected'.
        connection_validated = False
        try:
            api_base = QB_API_BASE.get(QB_ENVIRONMENT, QB_API_BASE["sandbox"])
            test_resp = _requests.get(
                f"{api_base}/v3/company/{final_realm_id}/companyinfo/{final_realm_id}",
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
                timeout=10,
            )
            connection_validated = (test_resp.status_code == 200)
            if not connection_validated:
                logger.warning("QB callback: token recu mais companyinfo refuse status=%s", test_resp.status_code)
        except Exception as exc:
            logger.warning("QB callback: validation companyinfo echec: %s", type(exc).__name__)

        final_status = "connected" if connection_validated else "error"

        # Lecon C1 S33: chiffrer access_token + refresh_token avant stockage.
        cursor.execute(
            """UPDATE integrations
               SET access_token = %s, refresh_token = %s, token_expires_at = %s,
                   realm_id = %s, status = %s, updated_at = CURRENT_TIMESTAMP,
                   config = (config - 'oauth_state') - 'oauth_state_created_at'
               WHERE id = %s""",
            (_encrypt_token(access_token), _encrypt_token(refresh_token),
             expires_at, final_realm_id, final_status, row["id"]),
        )
        _log_sync(cursor, row["id"], "quickbooks", "import", "oauth",
                  status="success" if connection_validated else "error",
                  details=("Connexion OAuth réussie" if connection_validated
                           else "Token reçu mais validation companyinfo échouée"))
        conn.commit()
        if not connection_validated:
            raise HTTPException(400, "Token reçu mais l'API QuickBooks refuse l'accès. Vérifiez le compte et reconnectez.")
        return {"message": "QuickBooks connecté avec succès", "connection_id": row["id"], "realm_id": final_realm_id}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("QB callback error: %s", exc)
        raise HTTPException(500, "Erreur lors du traitement OAuth")
    finally:
        db.reset_tenant(conn)
        if cursor:
            cursor.close()
        conn.close()


# ══════════════════════════════════════════════════════════════
#  CONNECTION TEST
# ══════════════════════════════════════════════════════════════

@router.post("/integrations/{connection_id}/test")
async def test_connection(
    connection_id: int,
    user: ErpUser = Depends(require_role("admin", "super_admin")),
):
    if not user.schema:
        raise HTTPException(400, "Contexte entreprise requis")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_integration_tables(cursor)
        cursor.execute("SELECT * FROM integrations WHERE id = %s", (connection_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(404, "Connexion non trouv\u00e9e")

        provider = row["provider"]
        success = False
        message = ""

        if provider == "quickbooks":
            # Lecon C1 S33: dechiffrement transparent (legacy clair toleré).
            access_token = _decrypt_token(row.get("access_token"))
            refresh_token = _decrypt_token(row.get("refresh_token"))
            realm_id = row.get("realm_id")
            if not access_token or not realm_id:
                message = "Non connect\u00e9 \u00e0 QuickBooks. Lancez d'abord l'autorisation OAuth."
            else:
                try:
                    import requests as _requests
                    api_base = QB_API_BASE.get(QB_ENVIRONMENT, QB_API_BASE["sandbox"])
                    resp = _requests.get(
                        f"{api_base}/v3/company/{realm_id}/companyinfo/{realm_id}",
                        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
                        timeout=10,
                    )
                    if resp.status_code == 200:
                        info = resp.json().get("CompanyInfo", {})
                        company_name = info.get("CompanyName", "QuickBooks")
                        success = True
                        message = f"Connect\u00e9 \u00e0 {company_name}"
                    elif resp.status_code == 401 and refresh_token:
                        # Auto-refresh token and retry
                        new_token = _refresh_qb_token(cursor, conn, connection_id, refresh_token)
                        if new_token:
                            resp2 = _requests.get(
                                f"{api_base}/v3/company/{realm_id}/companyinfo/{realm_id}",
                                headers={"Authorization": f"Bearer {new_token}", "Accept": "application/json"},
                                timeout=10,
                            )
                            if resp2.status_code == 200:
                                info = resp2.json().get("CompanyInfo", {})
                                company_name = info.get("CompanyName", "QuickBooks")
                                success = True
                                message = f"Connect\u00e9 \u00e0 {company_name} (token renouvel\u00e9)"
                            else:
                                message = "Token renouvel\u00e9 mais l'API QuickBooks refuse l'acc\u00e8s. Reconnectez."
                                cursor.execute("UPDATE integrations SET status = 'error' WHERE id = %s", (connection_id,))
                                conn.commit()
                        else:
                            message = "Token expir\u00e9 et renouvellement \u00e9chou\u00e9. Reconnectez QuickBooks."
                            cursor.execute("UPDATE integrations SET status = 'error' WHERE id = %s", (connection_id,))
                            conn.commit()
                    elif resp.status_code == 401:
                        message = "Token expir\u00e9. Reconnectez QuickBooks."
                        cursor.execute("UPDATE integrations SET status = 'error' WHERE id = %s", (connection_id,))
                        conn.commit()
                    else:
                        message = f"Erreur QuickBooks API: HTTP {resp.status_code}"
                except Exception:
                    message = "Impossible de joindre l'API QuickBooks"

        elif provider == "sage50":
            config = row.get("config") or {}
            dsn = config.get("dsn", "")
            if not dsn:
                message = "Aucun DSN configur\u00e9 pour Sage 50."
            else:
                try:
                    import pyodbc
                    test_conn = pyodbc.connect(f"DSN={dsn}", timeout=5)
                    test_conn.close()
                    success = True
                    message = f"Connect\u00e9 au DSN '{dsn}'"
                except ImportError:
                    message = "Driver ODBC pyodbc non install\u00e9 sur le serveur."
                except Exception:
                    message = "Impossible de se connecter au DSN Sage 50"

        new_status = "connected" if success else "error"
        cursor.execute(
            "UPDATE integrations SET status = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (new_status, connection_id),
        )
        _log_sync(cursor, connection_id, provider, "export", "test",
                  status="success" if success else "error", details=message)
        conn.commit()
        return {"success": success, "message": message}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("test_connection error: %s", exc)
        return {"success": False, "message": "Erreur lors du test de connexion"}
    finally:
        db.reset_tenant(conn)
        if cursor:
            cursor.close()
        conn.close()


# ══════════════════════════════════════════════════════════════
#  SYNC ENGINE — QuickBooks Real API
# ══════════════════════════════════════════════════════════════

def _sync_companies_to_qb(cursor, conn, connection_id, access_token, realm_id):
    """Export ERP companies (clients) to QuickBooks as Customers.
    Returns (synced_count, error_count).

    Lecon C2 S33: batch de 1000 (vs ancien 100). Pour les tenants avec
    >1000 entreprises actives, declencher plusieurs syncs successifs.
    Lecon QA1-R2 S33: token_holder local propage les refresh entre items.
    """
    synced = 0
    errors = 0
    # token_holder pattern: muteable dict pour propager les refresh entre items
    token_holder = {"access": access_token}

    cursor.execute("""
        SELECT c.id, c.nom, c.email, c.telephone, c.adresse, c.ville,
               c.province, c.code_postal,
               iem.external_id
        FROM companies c
        LEFT JOIN integration_entity_map iem
            ON iem.connection_id = %s AND iem.entity_type = 'customer' AND iem.local_id = c.id
        WHERE c.active = TRUE
        ORDER BY c.id LIMIT 1000
    """, (connection_id,))
    companies = [dict(r) for r in cursor.fetchall()]

    for company in companies:
        try:
            cursor.execute("SAVEPOINT sync_item")
            display_name = (company["nom"] or f"Client-{company['id']}")[:500]
            qb_customer = {
                "DisplayName": display_name,
                "CompanyName": display_name,
            }
            if company.get("email"):
                qb_customer["PrimaryEmailAddr"] = {"Address": company["email"][:100]}
            if company.get("telephone"):
                qb_customer["PrimaryPhone"] = {"FreeFormNumber": company["telephone"][:30]}

            addr = {}
            if company.get("adresse"):
                addr["Line1"] = company["adresse"][:500]
            if company.get("ville"):
                addr["City"] = company["ville"][:255]
            if company.get("province"):
                addr["CountrySubDivisionCode"] = company["province"][:255]
            if company.get("code_postal"):
                addr["PostalCode"] = company["code_postal"][:30]
            if addr:
                addr["Country"] = "CA"
                qb_customer["BillAddr"] = addr

            external_id = company.get("external_id")

            if external_id:
                # Update: fetch SyncToken from QB
                existing = _qb_api_get(
                    token_holder["access"], realm_id, f"customer/{external_id}",
                    cursor=cursor, conn=conn, connection_id=connection_id,
                    token_holder=token_holder,
                )
                if existing and "Customer" in existing:
                    qb_customer["Id"] = external_id
                    qb_customer["SyncToken"] = existing["Customer"]["SyncToken"]
                    qb_customer["sparse"] = True

            result = _qb_api_post(
                token_holder["access"], realm_id, "customer", qb_customer,
                cursor=cursor, conn=conn, connection_id=connection_id,
                token_holder=token_holder,
            )

            if result and "Customer" in result:
                qb_id = str(result["Customer"]["Id"])
                cursor.execute(
                    """INSERT INTO integration_entity_map
                       (connection_id, entity_type, local_id, external_id, last_synced_at)
                       VALUES (%s, 'customer', %s, %s, CURRENT_TIMESTAMP)
                       ON CONFLICT (connection_id, entity_type, local_id)
                       DO UPDATE SET external_id = %s, last_synced_at = CURRENT_TIMESTAMP""",
                    (connection_id, company["id"], qb_id, qb_id),
                )
                _log_sync(cursor, connection_id, "quickbooks", "export", "customer",
                          entity_id=company["id"], status="success",
                          details=f"{display_name} \u2192 QB #{qb_id}")
                synced += 1
            else:
                _log_sync(cursor, connection_id, "quickbooks", "export", "customer",
                          entity_id=company["id"], status="error",
                          error_message=f"QB API: client {display_name} rejete")
                errors += 1
        except Exception as exc:
            cursor.execute("ROLLBACK TO SAVEPOINT sync_item")
            logger.error("Sync customer %s error: %s", company["id"], exc)
            _log_sync(cursor, connection_id, "quickbooks", "export", "customer",
                      entity_id=company["id"], status="error",
                      error_message=str(exc)[:500])
            errors += 1

    conn.commit()
    return synced, errors


def _sync_invoices_to_qb(cursor, conn, connection_id, access_token, realm_id):
    """Export ERP factures to QuickBooks as Invoices.
    Only syncs invoices not yet exported (no entity_map entry).
    Returns (synced_count, error_count).

    Lecon C2 S33: batch de 500 (vs ancien 50). Cap volontaire car les
    factures sont plus lourdes (lignes + tax detail). Pour les tenants
    avec >500 factures non-syncees, declencher plusieurs syncs successifs.
    Lecon QA1-R2 S33: token_holder local propage les refresh entre items.
    """
    synced = 0
    errors = 0
    token_holder = {"access": access_token}

    cursor.execute("""
        SELECT f.id, f.numero_facture, f.date_facture, f.date_echeance,
               f.client_nom, f.client_company_id, f.montant_ht, f.tps, f.tvq,
               f.montant_total, f.statut
        FROM factures f
        LEFT JOIN integration_entity_map iem
            ON iem.connection_id = %s AND iem.entity_type = 'invoice' AND iem.local_id = f.id
        WHERE f.statut IN ('ENVOYEE', 'PAYEE', 'PARTIELLEMENT_PAYEE', 'EN_RETARD')
          AND iem.external_id IS NULL
        ORDER BY f.id LIMIT 500
    """, (connection_id,))
    invoices = [dict(r) for r in cursor.fetchall()]

    for inv in invoices:
        try:
            cursor.execute("SAVEPOINT sync_item")
            # Find QB customer reference
            customer_ref = None
            if inv.get("client_company_id"):
                cursor.execute(
                    "SELECT external_id FROM integration_entity_map "
                    "WHERE connection_id = %s AND entity_type = 'customer' AND local_id = %s",
                    (connection_id, inv["client_company_id"]),
                )
                map_row = cursor.fetchone()
                if map_row:
                    customer_ref = {"value": map_row["external_id"]}

            if not customer_ref:
                _log_sync(cursor, connection_id, "quickbooks", "export", "invoice",
                          entity_id=inv["id"], status="skipped",
                          details=f"Client non synchronis\u00e9 (client_company_id={inv.get('client_company_id')})")
                continue

            # Build lines from facture_lignes if they exist
            lignes = []
            cursor.execute("SAVEPOINT lignes_check")
            try:
                cursor.execute(
                    "SELECT description, quantite, prix_unitaire, montant "
                    "FROM facture_lignes WHERE facture_id = %s ORDER BY sequence_ligne, id",
                    (inv["id"],),
                )
                lignes = [dict(r) for r in cursor.fetchall()]
            except Exception:
                cursor.execute("ROLLBACK TO SAVEPOINT lignes_check")

            qb_lines = []
            if lignes:
                for ligne in lignes:
                    qty = float(ligne.get("quantite") or 1)
                    unit_price = float(ligne.get("prix_unitaire") or 0)
                    amount = float(ligne.get("montant") or (qty * unit_price))
                    qb_lines.append({
                        "DetailType": "SalesItemLineDetail",
                        "Amount": round(amount, 2),
                        "Description": (ligne.get("description") or "")[:4000],
                        "SalesItemLineDetail": {
                            "Qty": qty,
                            "UnitPrice": round(unit_price, 2),
                        },
                    })
            else:
                montant = float(inv.get("montant_ht") or inv.get("montant_total") or 0)
                qb_lines.append({
                    "DetailType": "SalesItemLineDetail",
                    "Amount": round(montant, 2),
                    "Description": f"Facture {inv.get('numero_facture') or inv['id']}",
                    "SalesItemLineDetail": {"Qty": 1, "UnitPrice": round(montant, 2)},
                })

            qb_invoice = {
                "CustomerRef": customer_ref,
                "DocNumber": (inv.get("numero_facture") or f"FACT-{inv['id']}")[:21],
                "Line": qb_lines,
            }
            if inv.get("date_facture"):
                qb_invoice["TxnDate"] = str(inv["date_facture"])[:10]
            if inv.get("date_echeance"):
                qb_invoice["DueDate"] = str(inv["date_echeance"])[:10]

            tps = float(inv.get("tps") or 0)
            tvq = float(inv.get("tvq") or 0)
            if tps > 0 or tvq > 0:
                qb_invoice["TxnTaxDetail"] = {"TotalTax": round(tps + tvq, 2)}

            result = _qb_api_post(
                token_holder["access"], realm_id, "invoice", qb_invoice,
                cursor=cursor, conn=conn, connection_id=connection_id,
                token_holder=token_holder,
            )

            if result and "Invoice" in result:
                qb_id = str(result["Invoice"]["Id"])
                cursor.execute(
                    """INSERT INTO integration_entity_map
                       (connection_id, entity_type, local_id, external_id, last_synced_at)
                       VALUES (%s, 'invoice', %s, %s, CURRENT_TIMESTAMP)
                       ON CONFLICT (connection_id, entity_type, local_id)
                       DO UPDATE SET external_id = %s, last_synced_at = CURRENT_TIMESTAMP""",
                    (connection_id, inv["id"], qb_id, qb_id),
                )
                _log_sync(cursor, connection_id, "quickbooks", "export", "invoice",
                          entity_id=inv["id"], status="success",
                          details=f"{inv.get('numero_facture')} \u2192 QB #{qb_id}")
                synced += 1
            else:
                _log_sync(cursor, connection_id, "quickbooks", "export", "invoice",
                          entity_id=inv["id"], status="error",
                          error_message=f"QB API: facture {inv.get('numero_facture')} rejetee")
                errors += 1
        except Exception as exc:
            cursor.execute("ROLLBACK TO SAVEPOINT sync_item")
            logger.error("Sync invoice %s error: %s", inv["id"], exc)
            _log_sync(cursor, connection_id, "quickbooks", "export", "invoice",
                      entity_id=inv["id"], status="error",
                      error_message=str(exc)[:500])
            errors += 1

    conn.commit()
    return synced, errors


def _sync_customers_from_qb(cursor, conn, connection_id, access_token, realm_id):
    """Import QuickBooks Customers to ERP companies.
    Returns (synced_count, error_count).

    Lecon C2 S33: utilisation de _qb_api_paginated_query (STARTPOSITION).
    L'ancien MAXRESULTS 100 hardcode perdait les clients au-dela de 100.
    """
    synced = 0
    errors = 0

    customers = _qb_api_paginated_query(
        access_token, realm_id,
        "SELECT * FROM Customer WHERE Active = true",
        "Customer",
        cursor=cursor, conn=conn, connection_id=connection_id,
    )
    if not customers:
        _log_sync(cursor, connection_id, "quickbooks", "import", "customer",
                  status="error", error_message="Aucun client recupere depuis QB (API ou liste vide)")
        conn.commit()
        return 0, 1

    for customer in customers:
        try:
            cursor.execute("SAVEPOINT sync_item")
            qb_id = str(customer["Id"])
            display_name = customer.get("DisplayName") or customer.get("CompanyName") or f"QB-{qb_id}"

            # Check if already mapped
            cursor.execute(
                "SELECT local_id FROM integration_entity_map "
                "WHERE connection_id = %s AND entity_type = 'customer' AND external_id = %s",
                (connection_id, qb_id),
            )
            existing = cursor.fetchone()

            email = ""
            if customer.get("PrimaryEmailAddr"):
                email = customer["PrimaryEmailAddr"].get("Address", "")
            phone = ""
            if customer.get("PrimaryPhone"):
                phone = customer["PrimaryPhone"].get("FreeFormNumber", "")

            addr = customer.get("BillAddr") or {}

            if existing:
                cursor.execute(
                    """UPDATE companies SET nom = %s,
                       email = COALESCE(NULLIF(%s, ''), email),
                       telephone = COALESCE(NULLIF(%s, ''), telephone),
                       adresse = COALESCE(NULLIF(%s, ''), adresse),
                       ville = COALESCE(NULLIF(%s, ''), ville),
                       province = COALESCE(NULLIF(%s, ''), province),
                       code_postal = COALESCE(NULLIF(%s, ''), code_postal),
                       updated_at = CURRENT_TIMESTAMP
                       WHERE id = %s""",
                    (display_name, email, phone,
                     addr.get("Line1", ""), addr.get("City", ""),
                     addr.get("CountrySubDivisionCode", ""),
                     addr.get("PostalCode", ""),
                     existing["local_id"]),
                )
                cursor.execute(
                    "UPDATE integration_entity_map SET last_synced_at = CURRENT_TIMESTAMP "
                    "WHERE connection_id = %s AND entity_type = 'customer' AND external_id = %s",
                    (connection_id, qb_id),
                )
            else:
                # Lecon H5 S33: dedup multi-criteres (email > telephone > nom)
                # Priorite email car unique en pratique; nom seul fusionnait
                # deux vrais clients distincts qui partagent le meme nom.
                name_match = None
                if email:
                    cursor.execute(
                        "SELECT id FROM companies WHERE LOWER(email) = LOWER(%s) AND active = TRUE LIMIT 1",
                        (email,),
                    )
                    name_match = cursor.fetchone()
                if not name_match and phone:
                    # Normaliser le telephone pour comparaison (retirer espaces/tirets)
                    phone_normalized = re.sub(r"[^0-9+]", "", phone)
                    if phone_normalized:
                        cursor.execute(
                            "SELECT id FROM companies "
                            "WHERE regexp_replace(COALESCE(telephone, ''), '[^0-9+]', '', 'g') = %s "
                            "AND active = TRUE LIMIT 1",
                            (phone_normalized,),
                        )
                        name_match = cursor.fetchone()
                if not name_match:
                    cursor.execute(
                        "SELECT id FROM companies WHERE LOWER(nom) = LOWER(%s) AND active = TRUE LIMIT 1",
                        (display_name,),
                    )
                    name_match = cursor.fetchone()
                if name_match:
                    local_id = name_match["id"]
                else:
                    cursor.execute(
                        """INSERT INTO companies
                           (nom, email, telephone, adresse, ville, province,
                            code_postal, type_company, active, created_at, updated_at)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, 'CLIENT', TRUE,
                                   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                           RETURNING id""",
                        (display_name, email or None, phone or None,
                         addr.get("Line1") or None, addr.get("City") or None,
                         addr.get("CountrySubDivisionCode") or None,
                         addr.get("PostalCode") or None),
                    )
                    local_id = cursor.fetchone()["id"]
                cursor.execute(
                    """INSERT INTO integration_entity_map
                       (connection_id, entity_type, local_id, external_id, last_synced_at)
                       VALUES (%s, 'customer', %s, %s, CURRENT_TIMESTAMP)""",
                    (connection_id, local_id, qb_id),
                )

            _log_sync(cursor, connection_id, "quickbooks", "import", "customer",
                      status="success", details=f"QB #{qb_id} {display_name}")
            synced += 1
        except Exception as exc:
            cursor.execute("ROLLBACK TO SAVEPOINT sync_item")
            logger.error("Import QB customer %s error: %s", customer.get("Id"), exc)
            _log_sync(cursor, connection_id, "quickbooks", "import", "customer",
                      status="error", error_message=str(exc)[:500])
            errors += 1

    conn.commit()
    return synced, errors


def _sync_invoices_from_qb(cursor, conn, connection_id, access_token, realm_id):
    """Import QuickBooks Invoices to ERP factures.
    Returns (synced_count, error_count).

    Lecon C2 S33: pagination STARTPOSITION (ancien MAXRESULTS 50 perdait 95%).
    """
    synced = 0
    errors = 0

    qb_invoices = _qb_api_paginated_query(
        access_token, realm_id,
        "SELECT * FROM Invoice",
        "Invoice",
        cursor=cursor, conn=conn, connection_id=connection_id,
    )
    if not qb_invoices:
        _log_sync(cursor, connection_id, "quickbooks", "import", "invoice",
                  status="error", error_message="Aucune facture recuperee depuis QB (API ou liste vide)")
        conn.commit()
        return 0, 1

    for qb_inv in qb_invoices:
        try:
            cursor.execute("SAVEPOINT sync_item")
            qb_id = str(qb_inv["Id"])

            # Already imported?
            cursor.execute(
                "SELECT local_id FROM integration_entity_map "
                "WHERE connection_id = %s AND entity_type = 'invoice' AND external_id = %s",
                (connection_id, qb_id),
            )
            if cursor.fetchone():
                continue  # already mapped, skip

            # Lecon QA4-R20 S33: refuser invoices en devise non-CAD.
            # L'ERP Constructo AI est calibre TPS/TVQ Quebec, importer du USD
            # comme CAD fausserait toute la comptabilite.
            currency = (qb_inv.get("CurrencyRef") or {}).get("value", "").upper()
            if currency and currency != "CAD":
                _log_sync(cursor, connection_id, "quickbooks", "import", "invoice",
                          status="skipped",
                          details=f"Devise non-CAD ignoree: {currency} (QC = CAD seulement)")
                logger.warning("QB invoice %s: devise %s non supportee, skipping", qb_id, currency)
                continue

            # Resolve customer
            company_id = None
            cust_ref = qb_inv.get("CustomerRef", {})
            if cust_ref.get("value"):
                cursor.execute(
                    "SELECT local_id FROM integration_entity_map "
                    "WHERE connection_id = %s AND entity_type = 'customer' AND external_id = %s",
                    (connection_id, str(cust_ref["value"])),
                )
                cust_map = cursor.fetchone()
                if cust_map:
                    company_id = cust_map["local_id"]

            raw_doc = qb_inv.get("DocNumber") or ""
            doc_number = f"QB-{raw_doc}" if raw_doc else f"QB-{qb_id}"

            # Lecon QA4-R19 S33: parser dates en strict ISO 8601 et capturer
            # les formats invalides plutot que de laisser psycopg2 planter
            # avec un message obscur. None est accepte (date_facture nullable).
            def _parse_qb_date(raw):
                if not raw:
                    return None
                try:
                    return datetime.strptime(raw[:10], "%Y-%m-%d").date()
                except (ValueError, TypeError):
                    logger.warning("QB invoice %s: date format invalide %r", qb_id, raw)
                    return None
            txn_date = _parse_qb_date(qb_inv.get("TxnDate"))
            due_date = _parse_qb_date(qb_inv.get("DueDate"))

            total_amt = float(qb_inv.get("TotalAmt") or 0)
            balance = float(qb_inv.get("Balance") if qb_inv.get("Balance") is not None else total_amt)
            montant_paye = round(total_amt - balance, 2)
            tax_detail = qb_inv.get("TxnTaxDetail") or {}
            total_tax = float(tax_detail.get("TotalTax") or 0)
            montant_ht = round(total_amt - total_tax, 2)

            # Lecon H3 S33: priorite au detail line-level (TxnTaxLine[]) si fourni.
            # Le fallback ratio 0.3339/0.6661 = TPS_5% / (TPS_5% + TVQ_9.975%) - exact
            # SI toutes les lignes ont les memes taxes; sinon imprecis.
            # Lecon QA1-R3 S33: detecter 3e taxe non mappee (ex: HST ON, autre TPS
            # autre province) et logger pour ne pas la perdre silencieusement.
            # Lecon QA1-R9 S33: parse TaxPercent safe (peut etre str/None/dict).
            tps_val = 0.0
            tvq_val = 0.0
            tax_lines = tax_detail.get("TaxLine") or []
            tps_taxlines = []
            tvq_taxlines = []
            unmapped_amount = 0.0
            for tl in tax_lines:
                detail = tl.get("TaxLineDetail") or {}
                tax_rate_ref = (detail.get("TaxRateRef") or {})
                rate_name = (tax_rate_ref.get("name") or "").upper()
                try:
                    rate_value = float(str(detail.get("TaxPercent") or 0).rstrip("%").strip())
                except (ValueError, TypeError):
                    logger.warning("QB invoice %s: TaxPercent non-numeric: %r",
                                   qb_id, detail.get("TaxPercent"))
                    rate_value = 0.0
                try:
                    tax_amount = float(tl.get("Amount") or 0)
                except (ValueError, TypeError):
                    logger.warning("QB invoice %s: TaxLine.Amount non-numeric: %r",
                                   qb_id, tl.get("Amount"))
                    tax_amount = 0.0
                # Heuristique mapping: nom contient TPS/GST/HST ou taux ~5% -> TPS;
                # nom contient TVQ/QST ou taux ~9.975% -> TVQ.
                if "TPS" in rate_name or "GST" in rate_name or "HST" in rate_name or abs(rate_value - 5.0) < 0.1:
                    tps_taxlines.append(tax_amount)
                elif "TVQ" in rate_name or "QST" in rate_name or abs(rate_value - 9.975) < 0.1:
                    tvq_taxlines.append(tax_amount)
                else:
                    # Lecon QA1-R3 : 3e taxe non mappee - logger + accumuler
                    unmapped_amount += tax_amount
                    logger.warning("QB invoice %s: taxe non mappee '%s' (taux=%.3f) montant=%.2f$",
                                   qb_id, rate_name or "unnamed", rate_value, tax_amount)
            if tps_taxlines or tvq_taxlines:
                tps_val = round(sum(tps_taxlines), 2)
                tvq_val = round(sum(tvq_taxlines), 2)
                # Si seules les lignes TPS ou TVQ identifiees, deduire l'autre par diff
                # APRES soustraction de la taxe non mappee (sinon faux montant_ht).
                if tps_val and not tvq_val:
                    tvq_val = round(total_tax - tps_val - unmapped_amount, 2)
                elif tvq_val and not tps_val:
                    tps_val = round(total_tax - tvq_val - unmapped_amount, 2)
            else:
                # Fallback ratio Quebec (TPS 5% / TVQ 9.975% sur HT)
                if total_tax > 0:
                    logger.info("QB invoice %s: TaxLine absent, fallback ratio TPS/TVQ", qb_id)
                tps_val = round(total_tax * (5.0 / 14.975), 2)
                tvq_val = round(total_tax - tps_val, 2)  # absorbe l'erreur d'arrondi
            # Lecon QA1-R3: si une 3e taxe a ete absorbee dans total_tax, montant_ht
            # est correct (total_amt - total_tax couvre toute la taxe). On garde
            # montant_ht tel quel, mais tps_val + tvq_val < total_tax = traçabilite logs.
            client_name = cust_ref.get("name") or ""

            # Lecon QA4-R18 S33: deduire le statut depuis le balance QB plutot
            # que d'hardcoder 'ENVOYEE'. Une facture QB Balance=0 est PAYEE,
            # Balance<TotalAmt est PARTIELLEMENT_PAYEE, Balance==TotalAmt est ENVOYEE.
            # Note: CHECK constraint sur factures.statut accepte ces 3 valeurs
            # (verifie via erp_database.py).
            if total_amt > 0 and balance <= 0.005:  # tolerance arrondi
                statut_facture = 'PAYEE'
            elif montant_paye > 0.005 and balance > 0.005:
                statut_facture = 'PARTIELLEMENT_PAYEE'
            else:
                statut_facture = 'ENVOYEE'

            cursor.execute(
                """INSERT INTO factures
                   (numero_facture, date_facture, date_echeance, client_nom,
                    client_company_id, montant_ht, montant_total, montant_ttc,
                    tps, tvq, montant_tps, montant_tvq, taux_tps, taux_tvq,
                    solde_du, montant_paye, statut, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                           5.0, 9.975, %s, %s, %s,
                           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                   RETURNING id""",
                (doc_number, txn_date, due_date, client_name,
                 company_id, montant_ht, total_amt, total_amt,
                 tps_val, tvq_val, tps_val, tvq_val,
                 balance, montant_paye, statut_facture),
            )
            local_id = cursor.fetchone()["id"]

            cursor.execute(
                """INSERT INTO integration_entity_map
                   (connection_id, entity_type, local_id, external_id, last_synced_at)
                   VALUES (%s, 'invoice', %s, %s, CURRENT_TIMESTAMP)""",
                (connection_id, local_id, qb_id),
            )

            _log_sync(cursor, connection_id, "quickbooks", "import", "invoice",
                      status="success", details=f"QB #{qb_id} {doc_number} ({total_amt:.2f}$)")
            synced += 1
        except Exception as exc:
            cursor.execute("ROLLBACK TO SAVEPOINT sync_item")
            logger.error("Import QB invoice %s error: %s", qb_inv.get("Id"), exc)
            _log_sync(cursor, connection_id, "quickbooks", "import", "invoice",
                      status="error", error_message=str(exc)[:500])
            errors += 1

    conn.commit()
    return synced, errors


# ══════════════════════════════════════════════════════════════
#  SYNC TRIGGER
# ══════════════════════════════════════════════════════════════

@router.post("/integrations/{connection_id}/sync")
async def trigger_sync(
    connection_id: int,
    body: SyncRequest = SyncRequest(),
    user: ErpUser = Depends(require_role("admin", "super_admin")),
):
    if not user.schema:
        raise HTTPException(400, "Contexte entreprise requis")
    conn = db.get_conn()
    cursor = None
    prev_autocommit = None
    try:
        # Les helpers _sync_*_to_qb / _sync_*_from_qb utilisent SAVEPOINT
        # par item pour protege l'iteration des erreurs UNIQUE/FK.
        # SAVEPOINT exige un bloc transactionnel — psycopg2 pool retourne
        # des connexions en autocommit=True (lecon #122). Forcer
        # autocommit=False pour le scope du sync, restaurer dans finally.
        try:
            prev_autocommit = conn.autocommit
        except Exception:
            pass
        if prev_autocommit:
            try:
                conn.autocommit = False
            except Exception:
                pass

        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_integration_tables(cursor)
        conn.commit()

        cursor.execute("SELECT provider FROM integrations WHERE id = %s", (connection_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(404, "Connexion non trouv\u00e9e")

        provider = row["provider"]
        direction = body.direction or "export"
        entity_type = body.entity_type

        if provider != "quickbooks":
            raise HTTPException(400, f"Synchronisation non support\u00e9e pour {provider}")

        # Validate token (auto-refresh if expired)
        access_token, realm_id = _get_valid_qb_connection(cursor, conn, connection_id)

        total_synced = 0
        total_errors = 0
        results = []

        if direction == "export":
            if not entity_type or entity_type in ("customer", "all"):
                s, e = _sync_companies_to_qb(cursor, conn, connection_id, access_token, realm_id)
                results.append(f"Clients: {s} synchronis\u00e9s, {e} erreurs")
                total_synced += s
                total_errors += e

            if not entity_type or entity_type in ("invoice", "all"):
                s, e = _sync_invoices_to_qb(cursor, conn, connection_id, access_token, realm_id)
                results.append(f"Factures: {s} synchronis\u00e9es, {e} erreurs")
                total_synced += s
                total_errors += e

        elif direction == "import":
            if not entity_type or entity_type in ("customer", "all"):
                s, e = _sync_customers_from_qb(cursor, conn, connection_id, access_token, realm_id)
                results.append(f"Clients QB: {s} import\u00e9s, {e} erreurs")
                total_synced += s
                total_errors += e

            if not entity_type or entity_type in ("invoice", "all"):
                s, e = _sync_invoices_from_qb(cursor, conn, connection_id, access_token, realm_id)
                results.append(f"Factures QB: {s} import\u00e9es, {e} erreurs")
                total_synced += s
                total_errors += e

        cursor.execute(
            "UPDATE integrations SET last_sync_at = CURRENT_TIMESTAMP, "
            "updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (connection_id,),
        )
        conn.commit()

        summary = " | ".join(results) if results else "Aucune entit\u00e9 \u00e0 synchroniser"
        return {
            "message": f"Synchronisation {direction} termin\u00e9e: {total_synced} entit\u00e9s, {total_errors} erreurs",
            "synced": total_synced,
            "errors": total_errors,
            "details": results,
            "status": "success" if total_errors == 0 else "partial",
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("trigger_sync error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(500, "Erreur lors de la synchronisation")
    finally:
        # Restaurer l'autocommit pour ne pas polluer le pool psycopg2.
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception:
                pass
        db.reset_tenant(conn)
        if cursor:
            cursor.close()
        conn.close()


# ══════════════════════════════════════════════════════════════
#  SYNC HISTORY & STATS
# ══════════════════════════════════════════════════════════════

@router.get("/integrations/sync-history")
async def get_sync_history(
    user: ErpUser = Depends(require_role("admin", "super_admin")),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    provider: Optional[str] = None,
    status: Optional[str] = None,
    entity_type: Optional[str] = None,
):
    if not user.schema:
        raise HTTPException(400, "Contexte entreprise requis")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_integration_tables(cursor)
        conn.commit()

        where_clauses = []
        params: list = []
        if provider:
            where_clauses.append("provider = %s")
            params.append(provider)
        if status:
            where_clauses.append("status = %s")
            params.append(status)
        if entity_type:
            where_clauses.append("entity_type = %s")
            params.append(entity_type)

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        cursor.execute(f"SELECT COUNT(*) AS total FROM integration_sync_logs {where_sql}", params)
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT * FROM integration_sync_logs {where_sql} ORDER BY created_at DESC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = [
            {
                "id": r["id"],
                "connection_id": r.get("connection_id"),
                "provider": r["provider"],
                "direction": r.get("direction", "export"),
                "entity_type": r.get("entity_type"),
                "entity_id": r.get("entity_id"),
                "status": r.get("status", "pending"),
                "details": r.get("details"),
                "error_message": r.get("error_message"),
                "created_at": str(r["created_at"]) if r.get("created_at") else None,
            }
            for r in cursor.fetchall()
        ]
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_sync_history error: %s", exc)
        return {"items": [], "total": 0}
    finally:
        db.reset_tenant(conn)
        if cursor:
            cursor.close()
        conn.close()


@router.get("/integrations/sync-stats")
async def get_sync_stats(
    user: ErpUser = Depends(require_role("admin", "super_admin")),
):
    if not user.schema:
        raise HTTPException(400, "Contexte entreprise requis")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_integration_tables(cursor)
        conn.commit()

        cursor.execute("SELECT COUNT(*) AS total FROM integration_sync_logs")
        total = cursor.fetchone()["total"]

        cursor.execute("SELECT COUNT(*) AS c FROM integration_sync_logs WHERE status = 'success'")
        success_count = cursor.fetchone()["c"]

        cursor.execute("SELECT COUNT(*) AS c FROM integration_sync_logs WHERE status = 'error'")
        error_count = cursor.fetchone()["c"]

        cursor.execute("SELECT MAX(created_at) AS last_sync FROM integration_sync_logs")
        last_row = cursor.fetchone()
        last_sync_at = str(last_row["last_sync"]) if last_row and last_row["last_sync"] else None

        cursor.execute(
            """SELECT provider, COUNT(*) AS count,
                      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
               FROM integration_sync_logs GROUP BY provider"""
        )
        by_provider = [{"provider": r["provider"], "count": r["count"], "errors": r["errors"]} for r in cursor.fetchall()]

        cursor.execute(
            """SELECT entity_type,
                      SUM(CASE WHEN direction = 'export' THEN 1 ELSE 0 END) AS exported,
                      SUM(CASE WHEN direction = 'import' THEN 1 ELSE 0 END) AS imported
               FROM integration_sync_logs WHERE entity_type IS NOT NULL GROUP BY entity_type"""
        )
        by_entity = [{"entity": r["entity_type"], "exported": r["exported"], "imported": r["imported"]} for r in cursor.fetchall()]

        return {
            "total_syncs": total,
            "success_count": success_count,
            "error_count": error_count,
            "last_sync_at": last_sync_at,
            "by_provider": by_provider,
            "by_entity": by_entity,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_sync_stats error: %s", exc)
        return {"total_syncs": 0, "success_count": 0, "error_count": 0, "by_provider": [], "by_entity": []}
    finally:
        db.reset_tenant(conn)
        if cursor:
            cursor.close()
        conn.close()
