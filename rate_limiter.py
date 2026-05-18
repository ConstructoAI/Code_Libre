"""
Rate Limiter - ERP Constructo AI
==========================
Protection contre les attaques par force brute et limitation de requêtes.

Fonctionnalités :
- Limitation tentatives de connexion (5 tentatives / 30 minutes)
- Blocage automatique temporaire
- Nettoyage automatique anciennes tentatives
- Logging des tentatives suspectes
- Support multi-utilisateurs

Auteur: Constructo AI
Date: Janvier 2025
Version: 1.0.0
"""

import time
import logging
from collections import defaultdict
from typing import Tuple, Dict, List
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class RateLimiter:
    """
    Gestionnaire de rate limiting pour prévenir les attaques par force brute.

    Configuration par défaut :
    - Max 5 tentatives par période
    - Période: 30 minutes (1800 secondes)
    - Durée blocage: 30 minutes

    Usage:
        limiter = RateLimiter()
        allowed, message = limiter.check_attempt("username")
        if not allowed:
            print(f"Bloqué: {message}")
    """

    def __init__(
        self,
        max_attempts: int = 5,
        period_seconds: int = 1800,  # 30 minutes
        block_duration_seconds: int = 1800  # 30 minutes
    ):
        """
        Initialise le rate limiter.

        Args:
            max_attempts: Nombre maximum de tentatives autorisées
            period_seconds: Période de temps pour compter les tentatives (secondes)
            block_duration_seconds: Durée du blocage (secondes)
        """
        self.max_attempts = max_attempts
        self.period_seconds = period_seconds
        self.block_duration_seconds = block_duration_seconds

        # Dictionnaires pour stocker les données
        self.attempts: Dict[str, List[float]] = defaultdict(list)
        self.blocked: Dict[str, float] = {}
        self.failed_attempts_count: Dict[str, int] = defaultdict(int)

        logger.info(
            f"RateLimiter initialisé: {max_attempts} tentatives / "
            f"{period_seconds}s, blocage {block_duration_seconds}s"
        )

    def check_attempt(self, identifier: str) -> Tuple[bool, str]:
        """
        Vérifie si une tentative est autorisée pour un identifiant.

        Args:
            identifier: Identifiant unique (ex: username, IP)

        Returns:
            Tuple (allowed: bool, message: str)
            - allowed: True si autorisé, False si bloqué
            - message: Message explicatif

        Example:
            >>> limiter = RateLimiter(max_attempts=3, period_seconds=60)
            >>> allowed, msg = limiter.check_attempt("user1")
            >>> print(allowed, msg)
            True OK
        """
        now = time.time()

        # 1. Vérifier si l'utilisateur est actuellement bloqué
        if identifier in self.blocked:
            block_end_time = self.blocked[identifier]

            if now < block_end_time:
                # Toujours bloqué
                remaining_seconds = int(block_end_time - now)
                remaining_minutes = remaining_seconds // 60

                logger.warning(
                    f"Tentative bloquée pour '{identifier}': "
                    f"encore {remaining_minutes} min de blocage"
                )

                return False, f"Compte temporairement bloqué. Réessayez dans {remaining_minutes} minutes."
            else:
                # Blocage expiré, débloquer
                del self.blocked[identifier]
                self.attempts[identifier] = []
                self.failed_attempts_count[identifier] = 0
                logger.info(f"Déblocage automatique de '{identifier}'")

        # 2. Nettoyer les anciennes tentatives (> période)
        self.attempts[identifier] = [
            attempt_time
            for attempt_time in self.attempts[identifier]
            if now - attempt_time < self.period_seconds
        ]

        # 3. Vérifier le nombre de tentatives dans la période
        current_attempts = len(self.attempts[identifier])

        if current_attempts >= self.max_attempts:
            # Bloquer l'utilisateur
            block_end_time = now + self.block_duration_seconds
            self.blocked[identifier] = block_end_time

            logger.warning(
                f"BLOCAGE: '{identifier}' a dépassé {self.max_attempts} tentatives. "
                f"Bloqué pour {self.block_duration_seconds // 60} minutes."
            )

            # Logger pour sécurité
            security_logger = logging.getLogger('security')
            security_logger.warning(
                f"Tentative de force brute détectée: {identifier} "
                f"({current_attempts} tentatives en {self.period_seconds}s)"
            )

            return False, f"Trop de tentatives. Compte bloqué pour {self.block_duration_seconds // 60} minutes."

        # 4. Enregistrer la tentative actuelle
        self.attempts[identifier].append(now)

        # Avertir si approche de la limite
        remaining = self.max_attempts - (current_attempts + 1)
        if remaining <= 2 and remaining > 0:
            logger.warning(
                f"Avertissement: '{identifier}' a {current_attempts + 1} tentatives. "
                f"Reste {remaining} tentatives avant blocage."
            )
            return True, f"Attention: {remaining} tentative(s) restante(s) avant blocage temporaire."

        return True, "OK"

    def record_failed_attempt(self, identifier: str):
        """
        Enregistre une tentative échouée (après vérification du rate limit).

        Args:
            identifier: Identifiant de l'utilisateur
        """
        self.failed_attempts_count[identifier] += 1

        logger.info(
            f"Tentative échouée pour '{identifier}': "
            f"{self.failed_attempts_count[identifier]} échecs totaux"
        )

        # Logger pour audit si beaucoup d'échecs
        if self.failed_attempts_count[identifier] >= 10:
            security_logger = logging.getLogger('security')
            security_logger.error(
                f"ALERTE: '{identifier}' a {self.failed_attempts_count[identifier]} "
                f"tentatives échouées au total"
            )

    def record_successful_attempt(self, identifier: str):
        """
        Enregistre une tentative réussie et réinitialise les compteurs.

        Args:
            identifier: Identifiant de l'utilisateur
        """
        # Réinitialiser tout
        if identifier in self.attempts:
            del self.attempts[identifier]
        if identifier in self.blocked:
            del self.blocked[identifier]

        total_failures = self.failed_attempts_count.get(identifier, 0)
        self.failed_attempts_count[identifier] = 0

        logger.info(
            f"Connexion réussie pour '{identifier}' "
            f"(après {total_failures} échecs)"
        )

    def is_blocked(self, identifier: str) -> bool:
        """
        Vérifie si un identifiant est actuellement bloqué.

        Args:
            identifier: Identifiant à vérifier

        Returns:
            True si bloqué, False sinon
        """
        if identifier not in self.blocked:
            return False

        now = time.time()
        return now < self.blocked[identifier]

    def get_remaining_block_time(self, identifier: str) -> int:
        """
        Obtient le temps restant de blocage en secondes.

        Args:
            identifier: Identifiant bloqué

        Returns:
            Secondes restantes (0 si pas bloqué)
        """
        if not self.is_blocked(identifier):
            return 0

        now = time.time()
        remaining = int(self.blocked[identifier] - now)
        return max(0, remaining)

    def unblock(self, identifier: str):
        """
        Débloque manuellement un utilisateur (admin).

        Args:
            identifier: Identifiant à débloquer
        """
        if identifier in self.blocked:
            del self.blocked[identifier]
        if identifier in self.attempts:
            del self.attempts[identifier]

        logger.info(f"Déblocage manuel de '{identifier}' par administrateur")

    def get_statistics(self) -> Dict:
        """
        Obtient des statistiques sur le rate limiting.

        Returns:
            Dictionnaire avec statistiques
        """
        now = time.time()

        # Compter utilisateurs bloqués actifs
        active_blocks = sum(
            1 for block_time in self.blocked.values()
            if now < block_time
        )

        # Total tentatives dans la période
        total_attempts = sum(
            len([t for t in times if now - t < self.period_seconds])
            for times in self.attempts.values()
        )

        return {
            'active_blocks': active_blocks,
            'total_users_tracked': len(self.attempts),
            'total_attempts_in_period': total_attempts,
            'total_failed_attempts': sum(self.failed_attempts_count.values()),
            'blocked_users': [
                {
                    'identifier': identifier,
                    'remaining_seconds': int(block_time - now)
                }
                for identifier, block_time in self.blocked.items()
                if now < block_time
            ]
        }

    def cleanup_old_data(self, days_old: int = 7):
        """
        Nettoie les anciennes données (pour maintenance).

        Args:
            days_old: Supprimer données plus anciennes que X jours
        """
        now = time.time()
        threshold = now - (days_old * 24 * 3600)

        # Nettoyer anciennes tentatives
        for identifier in list(self.attempts.keys()):
            self.attempts[identifier] = [
                t for t in self.attempts[identifier]
                if t > threshold
            ]
            if not self.attempts[identifier]:
                del self.attempts[identifier]

        # Nettoyer anciens blocages
        for identifier in list(self.blocked.keys()):
            if self.blocked[identifier] < threshold:
                del self.blocked[identifier]

        logger.info(f"Nettoyage rate limiter: données > {days_old} jours supprimées")


class IPRateLimiter(RateLimiter):
    """
    Rate limiter spécialisé pour limiter par adresse IP.

    Usage pour protéger une API ou endpoint web.
    """

    def __init__(self, max_requests: int = 100, period_seconds: int = 60):
        """
        Initialise le rate limiter IP.

        Args:
            max_requests: Nombre max de requêtes par période
            period_seconds: Période en secondes (défaut: 1 minute)
        """
        super().__init__(
            max_attempts=max_requests,
            period_seconds=period_seconds,
            block_duration_seconds=300  # Bloquer 5 minutes
        )

        logger.info(
            f"IPRateLimiter initialisé: {max_requests} requêtes / {period_seconds}s"
        )


# ===== INSTANCE GLOBALE =====
# Instance par défaut pour l'authentification
login_rate_limiter = RateLimiter(
    max_attempts=5,
    period_seconds=1800,  # 30 minutes
    block_duration_seconds=1800  # 30 minutes
)


# ===== TESTS UNITAIRES INTÉGRÉS =====

if __name__ == "__main__":
    print("=== Tests Rate Limiter ===\n")

    # Test 1: Tentatives normales
    print("Test 1: Tentatives normales (max 3)")
    limiter = RateLimiter(max_attempts=3, period_seconds=60, block_duration_seconds=60)

    for i in range(3):
        allowed, msg = limiter.check_attempt("test_user")
        print(f"  Tentative {i+1}: {'✅' if allowed else '❌'} - {msg}")

    print()

    # Test 2: Dépassement limite
    print("Test 2: Dépassement limite (4ème tentative)")
    allowed, msg = limiter.check_attempt("test_user")
    print(f"  Tentative 4: {'✅' if allowed else '❌'} - {msg}")
    print()

    # Test 3: Vérifier blocage
    print("Test 3: Vérifier blocage")
    print(f"  Est bloqué: {limiter.is_blocked('test_user')}")
    print(f"  Temps restant: {limiter.get_remaining_block_time('test_user')}s")
    print()

    # Test 4: Déblocage manuel
    print("Test 4: Déblocage manuel")
    limiter.unblock("test_user")
    print(f"  Est bloqué après déblocage: {limiter.is_blocked('test_user')}")
    print()

    # Test 5: Tentative réussie
    print("Test 5: Enregistrement tentative réussie")
    limiter.check_attempt("user2")
    limiter.record_failed_attempt("user2")
    limiter.check_attempt("user2")
    limiter.record_successful_attempt("user2")
    print(f"  Tentatives échouées user2: {limiter.failed_attempts_count['user2']}")
    print()

    # Test 6: Statistiques
    print("Test 6: Statistiques")
    stats = limiter.get_statistics()
    print(f"  Utilisateurs bloqués actifs: {stats['active_blocks']}")
    print(f"  Total utilisateurs suivis: {stats['total_users_tracked']}")
    print(f"  Total tentatives échouées: {stats['total_failed_attempts']}")
    print()

    # Test 7: IP Rate Limiter
    print("Test 7: IP Rate Limiter (max 5 requêtes/minute)")
    ip_limiter = IPRateLimiter(max_requests=5, period_seconds=60)

    for i in range(6):
        allowed, msg = ip_limiter.check_attempt("192.168.1.100")
        status = "✅" if allowed else "❌"
        print(f"  Requête {i+1}: {status}")

    print()
    print("✅ Tous les tests terminés!")


# ============================================================================
# MIDDLEWARE FASTAPI - Rate Limiting API
# ============================================================================

class APIRateLimitMiddleware:
    """
    Middleware FastAPI pour le rate limiting des requêtes API.

    Usage:
        from rate_limiter import APIRateLimitMiddleware
        app.add_middleware(APIRateLimitMiddleware)
    """

    # Limites par endpoint
    ENDPOINT_LIMITS = {
        "/api/login": (10, 60),           # 10 req/min
        "/api/register": (5, 60),         # 5 req/min
        "/api/password-reset": (3, 60),   # 3 req/min
        "/api/ai/": (20, 60),             # 20 req/min (coûteux)
        "/": (200, 60),                   # 200 req/min (health)
    }

    def __init__(self, app, default_limit: int = 100, window: int = 60):
        self.app = app
        self.default_limit = default_limit
        self.window = window
        self.ip_limiter = IPRateLimiter(max_requests=default_limit, period_seconds=window)
        logger.info(f"[APIRateLimitMiddleware] ✅ Activé - {default_limit} req/{window}s")

    def _get_client_ip(self, scope) -> str:
        """Extrait l'IP du client."""
        headers = dict(scope.get("headers", []))

        # Headers proxy
        forwarded = headers.get(b"x-forwarded-for", b"").decode()
        if forwarded:
            return forwarded.split(",")[0].strip()

        real_ip = headers.get(b"x-real-ip", b"").decode()
        if real_ip:
            return real_ip

        # IP directe
        client = scope.get("client")
        if client:
            return client[0]

        return "unknown"

    def _get_limit_for_path(self, path: str) -> tuple:
        """Retourne (max_requests, window) pour un chemin."""
        for endpoint, limits in self.ENDPOINT_LIMITS.items():
            if path.startswith(endpoint):
                return limits
        return (self.default_limit, self.window)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        client_ip = self._get_client_ip(scope)
        path = scope.get("path", "/")
        max_req, window = self._get_limit_for_path(path)

        # Créer un limiter temporaire pour cet endpoint
        key = f"{client_ip}:{path.split('/')[1] if '/' in path[1:] else 'root'}"
        allowed, msg = self.ip_limiter.check_attempt(key)

        if not allowed:
            # 429 Too Many Requests
            logger.warning(f"[RateLimit] 429 pour {client_ip} sur {path}")
            body = b'{"error": "Too Many Requests", "message": "Rate limit exceeded"}'

            await send({
                "type": "http.response.start",
                "status": 429,
                "headers": [
                    [b"content-type", b"application/json"],
                    [b"retry-after", str(window).encode()],
                ],
            })
            await send({"type": "http.response.body", "body": body})
            return

        await self.app(scope, receive, send)
