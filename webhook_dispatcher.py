"""
Webhook Dispatcher pour Constructo AI

Module responsable de l'envoi des webhooks vers les systemes externes.
Compatible avec n8n, Zapier, Make (Integromat) et autres.

Fonctionnalites:
- Envoi asynchrone des webhooks
- Signature HMAC-SHA256 pour securite
- Retry automatique en cas d'echec
- Logging des livraisons
- Support des evenements: invoice.*, payment.*, project.*, quote.*, inventory.*

P3-K Fix: Uses PostgreSQL as the source of truth for the pending webhook queue
instead of an in-memory Queue. This ensures webhooks are never lost when
running multiple uvicorn workers (each worker has its own memory space).
Workers use SELECT ... FOR UPDATE SKIP LOCKED to safely dequeue without
conflicts.
"""

import hashlib
import hmac
import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field
from enum import Enum
import requests

import database_config

logger = logging.getLogger(__name__)


# ===============================================================================
# CONSTANTES ET CONFIGURATION
# ===============================================================================

# Timeout pour les requetes webhook
WEBHOOK_TIMEOUT_SECONDS = 30

# Nombre maximum de retries
MAX_RETRIES = 3

# Delai entre les retries (en secondes) - backoff exponentiel
RETRY_DELAYS = [60, 300, 900]  # 1min, 5min, 15min

# Nombre de workers pour l'envoi asynchrone
WEBHOOK_WORKERS = 3

# Intervalle de polling DB (secondes) - workers verifient la queue DB
POLL_INTERVAL_SECONDS = 2


class WebhookEvent(str, Enum):
    """Evenements webhook supportes."""
    # Factures
    INVOICE_CREATED = "invoice.created"
    INVOICE_UPDATED = "invoice.updated"
    INVOICE_SENT = "invoice.sent"
    INVOICE_PAID = "invoice.paid"
    INVOICE_OVERDUE = "invoice.overdue"
    INVOICE_CANCELLED = "invoice.cancelled"

    # Paiements
    PAYMENT_RECEIVED = "payment.received"
    PAYMENT_REFUNDED = "payment.refunded"

    # Projets
    PROJECT_CREATED = "project.created"
    PROJECT_UPDATED = "project.updated"
    PROJECT_STATUS_CHANGED = "project.status_changed"
    PROJECT_COMPLETED = "project.completed"

    # Devis
    QUOTE_CREATED = "quote.created"
    QUOTE_SENT = "quote.sent"
    QUOTE_APPROVED = "quote.approved"
    QUOTE_REJECTED = "quote.rejected"
    QUOTE_EXPIRED = "quote.expired"

    # Inventaire
    INVENTORY_LOW_STOCK = "inventory.low_stock"
    INVENTORY_OUT_OF_STOCK = "inventory.out_of_stock"
    INVENTORY_ADJUSTED = "inventory.adjusted"

    # Clients
    COMPANY_CREATED = "company.created"
    COMPANY_UPDATED = "company.updated"

    # Employes
    EMPLOYEE_CREATED = "employee.created"
    TIME_ENTRY_CREATED = "time_entry.created"


@dataclass
class WebhookDelivery:
    """Represente une livraison de webhook."""
    webhook_id: int
    entreprise_id: int
    event: str
    payload: Dict[str, Any]
    url: str
    secret: str
    attempt: int = 1
    scheduled_at: datetime = field(default_factory=datetime.now)
    queue_id: Optional[int] = None  # ID in webhook_pending_queue table


# ===============================================================================
# SIGNATURE HMAC
# ===============================================================================

def generate_webhook_signature(payload: str, secret: str) -> str:
    """
    Genere une signature HMAC-SHA256 pour le payload webhook.

    Args:
        payload: JSON string du payload
        secret: Secret partage pour la signature

    Returns:
        Signature hexadecimale prefixee par 'sha256='
    """
    signature = hmac.new(
        secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    return f"sha256={signature}"


def verify_webhook_signature(payload: str, signature: str, secret: str) -> bool:
    """
    Verifie une signature webhook (utile pour les webhooks entrants).

    Args:
        payload: JSON string du payload
        signature: Signature recue
        secret: Secret partage

    Returns:
        True si la signature est valide
    """
    expected = generate_webhook_signature(payload, secret)
    return hmac.compare_digest(signature, expected)


# ===============================================================================
# WEBHOOK DISPATCHER (PostgreSQL-backed queue for multi-worker safety)
# ===============================================================================

class WebhookDispatcher:
    """
    Dispatcher pour l'envoi asynchrone des webhooks.

    Uses PostgreSQL as the source of truth for the pending webhook queue.
    Workers poll the DB using SELECT ... FOR UPDATE SKIP LOCKED to safely
    dequeue items without conflicts between multiple uvicorn workers.

    Usage:
        dispatcher = WebhookDispatcher()
        dispatcher.start()

        # Envoyer un webhook
        dispatcher.dispatch(
            entreprise_id=1,
            event=WebhookEvent.INVOICE_CREATED,
            data={"invoice_id": 123, "amount": 1500.00}
        )

        # A l'arret de l'application
        dispatcher.stop()
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        """Singleton pattern pour avoir un seul dispatcher par worker."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._running = False
        self._workers: List[threading.Thread] = []
        self._worker_id = f"w{os.getpid()}"  # Unique per-process worker ID
        self._initialized = True

    def start(self):
        """Demarre les workers de dispatch (poll from PostgreSQL queue)."""
        if self._running:
            return

        self._running = True

        for i in range(WEBHOOK_WORKERS):
            worker = threading.Thread(
                target=self._worker_loop,
                name=f"webhook-worker-{self._worker_id}-{i}",
                daemon=True
            )
            worker.start()
            self._workers.append(worker)

        logger.info(
            f"[WebhookDispatcher] Demarre avec {WEBHOOK_WORKERS} workers "
            f"(process {self._worker_id}, DB-backed queue)"
        )

    def stop(self, timeout: float = 30.0):
        """Arrete proprement les workers."""
        self._running = False

        # Wait for workers to finish their current iteration
        for worker in self._workers:
            worker.join(timeout=timeout / max(len(self._workers), 1))

        self._workers.clear()
        logger.info(f"[WebhookDispatcher] Arrete (process {self._worker_id})")

    def dispatch(
        self,
        entreprise_id: int,
        event: WebhookEvent,
        data: Dict[str, Any],
        schema_name: Optional[str] = None
    ) -> int:
        """
        Dispatch un webhook vers tous les endpoints configures pour cet evenement.

        Writes pending deliveries to PostgreSQL so they survive worker restarts
        and are visible to all uvicorn workers.

        Args:
            entreprise_id: ID de l'entreprise
            event: Type d'evenement
            data: Donnees de l'evenement
            schema_name: Schema optionnel (si non fourni, sera resolu)

        Returns:
            Nombre de webhooks mis en queue
        """
        if not self._running:
            logger.warning("[WebhookDispatcher] Dispatcher non demarre, webhook ignore")
            return 0

        # Recuperer les webhooks actifs pour cet evenement
        webhooks = self._get_active_webhooks(entreprise_id, event.value)

        if not webhooks:
            logger.debug(f"[WebhookDispatcher] Aucun webhook pour {event.value} (entreprise {entreprise_id})")
            return 0

        # Construire le payload
        payload = self._build_payload(event.value, data, entreprise_id)

        # Enqueue each webhook into PostgreSQL pending queue
        queued = 0
        for webhook in webhooks:
            try:
                self._enqueue_to_db(
                    webhook_id=webhook['id'],
                    entreprise_id=entreprise_id,
                    event=event.value,
                    payload=payload,
                    url=webhook['url'],
                    secret=webhook['secret'],
                    attempt=1,
                    scheduled_at=datetime.now()
                )
                queued += 1
            except Exception as e:
                logger.error(f"[WebhookDispatcher] Erreur queue webhook {webhook['id']}: {e}")

        logger.info(f"[WebhookDispatcher] {queued} webhook(s) en queue pour {event.value}")
        return queued

    def dispatch_sync(
        self,
        entreprise_id: int,
        event: WebhookEvent,
        data: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Dispatch un webhook de maniere synchrone (pour les tests ou cas urgents).

        Returns:
            Liste des resultats de livraison
        """
        webhooks = self._get_active_webhooks(entreprise_id, event.value)
        payload = self._build_payload(event.value, data, entreprise_id)

        results = []
        for webhook in webhooks:
            result = self._send_webhook(
                webhook_id=webhook['id'],
                url=webhook['url'],
                payload=payload,
                secret=webhook['secret'],
                attempt=1
            )
            results.append(result)

        return results

    # ---------------------------------------------------------------------------
    # PostgreSQL-backed queue operations
    # ---------------------------------------------------------------------------

    @staticmethod
    def _enqueue_to_db(
        webhook_id: int,
        entreprise_id: int,
        event: str,
        payload: Dict[str, Any],
        url: str,
        secret: str,
        attempt: int,
        scheduled_at: datetime
    ):
        """Insert a pending webhook delivery into the PostgreSQL queue."""
        conn = database_config.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SET search_path TO public")
            cursor.execute('''
                INSERT INTO webhook_pending_queue
                    (webhook_id, entreprise_id, event, payload, url, secret, attempt, scheduled_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ''', (
                webhook_id, entreprise_id, event,
                json.dumps(payload, default=str, ensure_ascii=False),
                url, secret, attempt, scheduled_at
            ))
            conn.commit()
        finally:
            try:
                cursor.close()
            except Exception:
                pass
            conn.close()

    @staticmethod
    def _dequeue_from_db() -> Optional[Dict[str, Any]]:
        """
        Atomically claim one pending delivery from the PostgreSQL queue.

        Uses FOR UPDATE SKIP LOCKED to allow multiple workers to dequeue
        concurrently without conflicts.

        Returns:
            Dict with queue row data, or None if queue is empty.
        """
        conn = database_config.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SET search_path TO public")

            # Claim the oldest ready-to-send item, skipping locked rows
            cursor.execute('''
                DELETE FROM webhook_pending_queue
                WHERE id = (
                    SELECT id FROM webhook_pending_queue
                    WHERE scheduled_at <= CURRENT_TIMESTAMP
                    ORDER BY scheduled_at ASC, id ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id, webhook_id, entreprise_id, event, payload,
                          url, secret, attempt, scheduled_at
            ''')

            row = cursor.fetchone()
            conn.commit()

            if row:
                return dict(row)
            return None
        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass
            logger.debug(f"[WebhookDispatcher] Dequeue error: {e}")
            return None
        finally:
            try:
                cursor.close()
            except Exception:
                pass
            conn.close()

    # ---------------------------------------------------------------------------
    # Worker loop
    # ---------------------------------------------------------------------------

    def _worker_loop(self):
        """Boucle principale d'un worker - polls PostgreSQL queue."""
        while self._running:
            try:
                item = self._dequeue_from_db()

                if item is None:
                    # No pending items, sleep before polling again
                    time.sleep(POLL_INTERVAL_SECONDS)
                    continue

                # Parse payload from JSON string
                payload = item['payload']
                if isinstance(payload, str):
                    payload = json.loads(payload)

                # Send the webhook
                result = self._send_webhook(
                    webhook_id=item['webhook_id'],
                    url=item['url'],
                    payload=payload,
                    secret=item['secret'],
                    attempt=item['attempt']
                )

                # Handle failures - schedule retry in DB
                if not result['success'] and item['attempt'] < MAX_RETRIES:
                    delay = RETRY_DELAYS[min(item['attempt'] - 1, len(RETRY_DELAYS) - 1)]
                    next_attempt = item['attempt'] + 1
                    retry_at = datetime.now() + timedelta(seconds=delay)

                    try:
                        self._enqueue_to_db(
                            webhook_id=item['webhook_id'],
                            entreprise_id=item['entreprise_id'],
                            event=item['event'],
                            payload=payload,
                            url=item['url'],
                            secret=item['secret'],
                            attempt=next_attempt,
                            scheduled_at=retry_at
                        )
                        logger.info(
                            f"[WebhookDispatcher] Retry #{next_attempt} programme "
                            f"dans {delay}s pour webhook {item['webhook_id']}"
                        )
                    except Exception:
                        logger.error(f"[WebhookDispatcher] Impossible de programmer retry")

            except Exception as e:
                logger.error(f"[WebhookDispatcher] Erreur worker: {e}")
                time.sleep(POLL_INTERVAL_SECONDS)

    @staticmethod
    def _is_internal_url(url: str) -> bool:
        """Verifie si une URL pointe vers un reseau interne (protection SSRF).

        Bloque :
          - Tout schema autre que http(s)
          - Hostnames internes connus (localhost, metadata, etc.)
          - IPs privées RFC1918, loopback, link-local, multicast, reserved
          - Adresses résolues par DNS qui retombent sur du privé (anti-DNS-rebinding)
        """
        from urllib.parse import urlparse
        import ipaddress
        import socket

        try:
            parsed = urlparse(url)
        except Exception:
            return True  # URL malformée = à bloquer

        # 1. Schemes autorisés uniquement
        if parsed.scheme not in ("http", "https"):
            return True

        hostname = (parsed.hostname or "").lower()
        if not hostname:
            return True

        # 2. Hostnames internes connus
        internal_hosts = {
            "localhost", "127.0.0.1", "0.0.0.0", "::1", "::",
            "metadata", "metadata.google.internal",
            "metadata.azure.com", "instance-data",
        }
        if hostname in internal_hosts:
            return True

        # 3. Si c'est déjà une IP : vérifier directement
        try:
            ip = ipaddress.ip_address(hostname)
            return (
                ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified
            )
        except ValueError:
            pass  # C'est un hostname, pas une IP

        # 4. Cloud metadata endpoints
        if hostname.startswith("169.254.") or hostname == "metadata":
            return True

        # 5. Anti-DNS-rebinding : résoudre le hostname et vérifier toutes les IPs
        try:
            for family, _, _, _, sockaddr in socket.getaddrinfo(
                hostname, None, proto=socket.IPPROTO_TCP
            ):
                ip_str = sockaddr[0]
                try:
                    ip = ipaddress.ip_address(ip_str)
                except ValueError:
                    continue
                if (
                    ip.is_private or ip.is_loopback or ip.is_link_local
                    or ip.is_reserved or ip.is_multicast or ip.is_unspecified
                ):
                    return True
        except (socket.gaierror, socket.timeout, OSError):
            # Résolution DNS impossible → bloquer par précaution
            return True

        return False

    def _send_webhook(
        self,
        webhook_id: int,
        url: str,
        payload: Dict[str, Any],
        secret: str,
        attempt: int
    ) -> Dict[str, Any]:
        """
        Envoie un webhook HTTP POST.

        Returns:
            Dictionnaire avec success, status_code, response_time_ms, error
        """
        # SSRF protection
        if self._is_internal_url(url):
            logger.warning(f"[WEBHOOK] SSRF blocked: webhook {webhook_id} tried to reach internal URL")
            return {'success': False, 'status_code': 0, 'response_time_ms': 0,
                    'error': 'URL interne bloquee pour raisons de securite'}

        start_time = time.time()
        payload_json = json.dumps(payload, default=str, ensure_ascii=False)
        signature = generate_webhook_signature(payload_json, secret)

        headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'ConstructoAI-Webhook/2.0',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': payload.get('event', ''),
            'X-Webhook-Delivery': str(webhook_id),
            'X-Webhook-Attempt': str(attempt)
        }

        try:
            response = requests.post(
                url,
                data=payload_json,
                headers=headers,
                timeout=WEBHOOK_TIMEOUT_SECONDS
            )

            response_time_ms = int((time.time() - start_time) * 1000)
            success = 200 <= response.status_code < 300

            # Logger la livraison
            self._log_delivery(
                webhook_id=webhook_id,
                event=payload.get('event', ''),
                status_code=response.status_code,
                response_time_ms=response_time_ms,
                success=success,
                attempt=attempt,
                error_message=None if success else response.text[:500]
            )

            if success:
                logger.info(
                    f"[WebhookDispatcher] Webhook {webhook_id} livre: "
                    f"{response.status_code} en {response_time_ms}ms"
                )
            else:
                logger.warning(
                    f"[WebhookDispatcher] Webhook {webhook_id} echec: "
                    f"{response.status_code} - {response.text[:200]}"
                )

            return {
                'success': success,
                'status_code': response.status_code,
                'response_time_ms': response_time_ms,
                'error': None if success else response.text[:500]
            }

        except requests.Timeout:
            response_time_ms = int((time.time() - start_time) * 1000)
            error = f"Timeout apres {WEBHOOK_TIMEOUT_SECONDS}s"

            self._log_delivery(
                webhook_id=webhook_id,
                event=payload.get('event', ''),
                status_code=0,
                response_time_ms=response_time_ms,
                success=False,
                attempt=attempt,
                error_message=error
            )

            logger.warning(f"[WebhookDispatcher] Webhook {webhook_id} timeout")
            return {
                'success': False,
                'status_code': 0,
                'response_time_ms': response_time_ms,
                'error': error
            }

        except requests.RequestException as e:
            response_time_ms = int((time.time() - start_time) * 1000)
            error = str(e)[:500]

            self._log_delivery(
                webhook_id=webhook_id,
                event=payload.get('event', ''),
                status_code=0,
                response_time_ms=response_time_ms,
                success=False,
                attempt=attempt,
                error_message=error
            )

            logger.error(f"[WebhookDispatcher] Webhook {webhook_id} erreur: {e}")
            return {
                'success': False,
                'status_code': 0,
                'response_time_ms': response_time_ms,
                'error': error
            }

    def _build_payload(
        self,
        event: str,
        data: Dict[str, Any],
        entreprise_id: int
    ) -> Dict[str, Any]:
        """Construit le payload standard pour un webhook."""
        return {
            'event': event,
            'created_at': datetime.now().isoformat(),
            'entreprise_id': entreprise_id,
            'api_version': '2.0',
            'data': data
        }

    def _get_active_webhooks(
        self,
        entreprise_id: int,
        event: str
    ) -> List[Dict[str, Any]]:
        """
        Recupere les webhooks actifs pour un evenement donne.

        Les webhooks sont filtres par:
        - entreprise_id
        - event dans la liste des events configures
        - is_active = True
        - failure_count < 10 (desactivation auto apres trop d'echecs)
        """
        try:
            conn = database_config.get_connection()
            cursor = conn.cursor()
            cursor.execute("SET search_path TO public")

            cursor.execute('''
                SELECT id, url, secret, events, failure_count
                FROM webhooks
                WHERE entreprise_id = %s
                  AND is_active = TRUE
                  AND failure_count < 10
            ''', (entreprise_id,))

            rows = cursor.fetchall()
            conn.close()

            webhooks = []
            for row in rows:
                webhook = dict(row)
                # Parser les events JSON
                try:
                    events_list = json.loads(webhook['events']) if webhook['events'] else []
                except json.JSONDecodeError:
                    events_list = []

                # Verifier si cet evenement est configure
                if event in events_list or '*' in events_list:
                    webhooks.append(webhook)

            return webhooks

        except Exception as e:
            logger.error(f"[WebhookDispatcher] Erreur recuperation webhooks: {e}")
            return []

    def _log_delivery(
        self,
        webhook_id: int,
        event: str,
        status_code: int,
        response_time_ms: int,
        success: bool,
        attempt: int,
        error_message: Optional[str] = None
    ):
        """Enregistre une livraison webhook en base."""
        try:
            conn = database_config.get_connection()
            cursor = conn.cursor()
            cursor.execute("SET search_path TO public")

            # Inserer le log
            cursor.execute('''
                INSERT INTO webhook_deliveries
                (webhook_id, event, status_code, response_time_ms, success, attempt, error_message)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            ''', (webhook_id, event, status_code, response_time_ms, success, attempt, error_message))

            # Mettre a jour le webhook
            if success:
                cursor.execute('''
                    UPDATE webhooks
                    SET last_triggered_at = CURRENT_TIMESTAMP,
                        failure_count = 0
                    WHERE id = %s
                ''', (webhook_id,))
            else:
                cursor.execute('''
                    UPDATE webhooks
                    SET last_triggered_at = CURRENT_TIMESTAMP,
                        failure_count = failure_count + 1
                    WHERE id = %s
                ''', (webhook_id,))

            conn.commit()
            conn.close()

        except Exception as e:
            logger.error(f"[WebhookDispatcher] Erreur logging livraison: {e}")


# ===============================================================================
# INSTANCE GLOBALE ET HELPERS
# ===============================================================================

# Instance singleton (per-process, but queue is in PostgreSQL so this is safe)
_dispatcher: Optional[WebhookDispatcher] = None


def get_dispatcher() -> WebhookDispatcher:
    """Retourne le dispatcher singleton, le cree si necessaire."""
    global _dispatcher
    if _dispatcher is None:
        _dispatcher = WebhookDispatcher()
    return _dispatcher


def start_webhook_dispatcher():
    """Demarre le dispatcher (a appeler au demarrage de l'API)."""
    dispatcher = get_dispatcher()
    dispatcher.start()
    return dispatcher


def stop_webhook_dispatcher():
    """Arrete le dispatcher (a appeler a l'arret de l'API)."""
    global _dispatcher
    if _dispatcher:
        _dispatcher.stop()
        _dispatcher = None


def dispatch_webhook(
    entreprise_id: int,
    event: WebhookEvent,
    data: Dict[str, Any]
) -> int:
    """
    Helper function pour dispatcher un webhook.

    Usage:
        from webhook_dispatcher import dispatch_webhook, WebhookEvent

        dispatch_webhook(
            entreprise_id=1,
            event=WebhookEvent.INVOICE_CREATED,
            data={"id": 123, "numero": "FAC-001", "montant_total": 1500.00}
        )
    """
    dispatcher = get_dispatcher()
    return dispatcher.dispatch(entreprise_id, event, data)


# ===============================================================================
# FONCTIONS D'INTEGRATION
# ===============================================================================

def trigger_invoice_webhook(
    entreprise_id: int,
    invoice_data: Dict[str, Any],
    event_type: str = "created"
):
    """
    Helper specifique pour les webhooks de factures.

    Args:
        entreprise_id: ID de l'entreprise
        invoice_data: Donnees de la facture
        event_type: Type d'evenement (created, updated, paid, sent, cancelled)
    """
    event_map = {
        "created": WebhookEvent.INVOICE_CREATED,
        "updated": WebhookEvent.INVOICE_UPDATED,
        "paid": WebhookEvent.INVOICE_PAID,
        "sent": WebhookEvent.INVOICE_SENT,
        "cancelled": WebhookEvent.INVOICE_CANCELLED,
        "overdue": WebhookEvent.INVOICE_OVERDUE
    }

    event = event_map.get(event_type)
    if event:
        dispatch_webhook(entreprise_id, event, invoice_data)


def trigger_payment_webhook(
    entreprise_id: int,
    payment_data: Dict[str, Any],
    event_type: str = "received"
):
    """Helper specifique pour les webhooks de paiements."""
    event_map = {
        "received": WebhookEvent.PAYMENT_RECEIVED,
        "refunded": WebhookEvent.PAYMENT_REFUNDED
    }

    event = event_map.get(event_type)
    if event:
        dispatch_webhook(entreprise_id, event, payment_data)


def trigger_project_webhook(
    entreprise_id: int,
    project_data: Dict[str, Any],
    event_type: str = "created"
):
    """Helper specifique pour les webhooks de projets."""
    event_map = {
        "created": WebhookEvent.PROJECT_CREATED,
        "updated": WebhookEvent.PROJECT_UPDATED,
        "status_changed": WebhookEvent.PROJECT_STATUS_CHANGED,
        "completed": WebhookEvent.PROJECT_COMPLETED
    }

    event = event_map.get(event_type)
    if event:
        dispatch_webhook(entreprise_id, event, project_data)


def trigger_quote_webhook(
    entreprise_id: int,
    quote_data: Dict[str, Any],
    event_type: str = "created"
):
    """Helper specifique pour les webhooks de devis."""
    event_map = {
        "created": WebhookEvent.QUOTE_CREATED,
        "sent": WebhookEvent.QUOTE_SENT,
        "approved": WebhookEvent.QUOTE_APPROVED,
        "rejected": WebhookEvent.QUOTE_REJECTED,
        "expired": WebhookEvent.QUOTE_EXPIRED
    }

    event = event_map.get(event_type)
    if event:
        dispatch_webhook(entreprise_id, event, quote_data)


def trigger_inventory_webhook(
    entreprise_id: int,
    product_data: Dict[str, Any],
    event_type: str = "low_stock"
):
    """Helper specifique pour les webhooks d'inventaire."""
    event_map = {
        "low_stock": WebhookEvent.INVENTORY_LOW_STOCK,
        "out_of_stock": WebhookEvent.INVENTORY_OUT_OF_STOCK,
        "adjusted": WebhookEvent.INVENTORY_ADJUSTED
    }

    event = event_map.get(event_type)
    if event:
        dispatch_webhook(entreprise_id, event, product_data)


# ===============================================================================
# MIGRATION - TABLES WEBHOOK
# ===============================================================================

def ensure_webhook_deliveries_table():
    """
    Cree les tables webhook_deliveries et webhook_pending_queue si elles
    n'existent pas. A appeler au demarrage de l'API.
    """
    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")

        # Table de log des livraisons (existante)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS webhook_deliveries (
                id SERIAL PRIMARY KEY,
                webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
                event VARCHAR(100) NOT NULL,
                status_code INTEGER,
                response_time_ms INTEGER,
                success BOOLEAN DEFAULT FALSE,
                attempt INTEGER DEFAULT 1,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook
            ON webhook_deliveries(webhook_id)
        ''')

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created
            ON webhook_deliveries(created_at)
        ''')

        # P3-K Fix: PostgreSQL-backed pending queue for multi-worker safety
        # This replaces the in-memory Queue that was lost across workers.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS webhook_pending_queue (
                id SERIAL PRIMARY KEY,
                webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
                entreprise_id INTEGER NOT NULL,
                event VARCHAR(100) NOT NULL,
                payload JSONB NOT NULL,
                url TEXT NOT NULL,
                secret VARCHAR(255) NOT NULL,
                attempt INTEGER DEFAULT 1,
                scheduled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_webhook_pending_queue_scheduled
            ON webhook_pending_queue(scheduled_at)
        ''')

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_webhook_pending_queue_created
            ON webhook_pending_queue(created_at)
        ''')

        conn.commit()
        conn.close()

        logger.info("[WebhookDispatcher] Tables webhook_deliveries et webhook_pending_queue verifiees/creees")

    except Exception as e:
        logger.error(f"[WebhookDispatcher] Erreur creation tables webhook: {e}")


# ===============================================================================
# TEST
# ===============================================================================

if __name__ == "__main__":
    print("=== Test Module Webhook Dispatcher ===")

    # Test signature
    payload = '{"event": "test", "data": {"id": 1}}'
    secret = "test_secret_123"

    signature = generate_webhook_signature(payload, secret)
    print(f"Signature generee: {signature}")

    is_valid = verify_webhook_signature(payload, signature, secret)
    print(f"Signature valide: {is_valid}")

    # Test payload building
    dispatcher = WebhookDispatcher()
    test_payload = dispatcher._build_payload(
        event="invoice.created",
        data={"id": 123, "numero": "FAC-001", "montant": 1500.00},
        entreprise_id=1
    )
    print(f"\nPayload test:")
    print(json.dumps(test_payload, indent=2, default=str))

    # Liste des evenements supportes
    print(f"\nEvenements supportes ({len(WebhookEvent)}):")
    for event in WebhookEvent:
        print(f"  - {event.value}")
