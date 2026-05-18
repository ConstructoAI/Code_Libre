"""
Gestionnaire de contexte tenant pour l'API REST Constructo AI
Remplace le st.session_state de Streamlit pour le contexte API

Ce module gère:
- L'isolation des données par tenant (schéma PostgreSQL)
- La connexion base de données avec search_path configuré
- La vérification des permissions
"""

import logging
from typing import Optional, List, Any
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime

import database_config
from database_config import validate_schema_name, set_search_path_secure

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# CLASSE TENANT CONTEXT
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class TenantContext:
    """
    Contexte tenant pour une requête API.

    Remplace le st.session_state de Streamlit pour les requêtes API REST.
    Chaque requête API reçoit son propre TenantContext isolé.

    Attributs:
        tenant_id: ID de l'entreprise (table entreprises)
        schema_name: Nom du schéma PostgreSQL (ex: tenant_abc_12345)
        entreprise_nom: Nom de l'entreprise
        api_key_id: ID de la clé API utilisée
        permissions: Liste des permissions accordées
        rate_limit_per_hour: Limite de requêtes par heure
    """
    tenant_id: int
    schema_name: str
    entreprise_nom: str = ""
    api_key_id: Optional[int] = None
    permissions: List[str] = field(default_factory=list)
    rate_limit_per_hour: int = 1000

    # Connexion gérée en interne
    _connection: Any = field(default=None, repr=False)
    _connection_acquired: bool = field(default=False, repr=False)

    def __post_init__(self):
        """Validation après initialisation."""
        if not validate_schema_name(self.schema_name):
            raise ValueError(f"Nom de schéma invalide: {self.schema_name}")

    def get_connection(self):
        """
        Obtient une connexion configurée pour ce tenant.

        La connexion est mise en cache pour la durée de vie du contexte.
        Le search_path est automatiquement configuré pour isoler les données.

        Returns:
            PooledConnection configurée pour le schéma du tenant
        """
        if self._connection is None or self._connection.closed:
            self._connection = database_config.get_connection()
            self._connection_acquired = True

            # Configurer le search_path pour ce tenant
            cursor = self._connection.cursor()
            try:
                set_search_path_secure(cursor, self.schema_name)
                logger.debug(f"[TenantContext] search_path = {self.schema_name}")
            finally:
                cursor.close()

        return self._connection

    def get_public_connection(self):
        """
        Obtient une connexion pour le schéma public.

        Utile pour accéder aux tables système (entreprises, api_keys, etc.)

        Returns:
            PooledConnection configurée pour le schéma public
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SET search_path TO public")
            logger.debug("[TenantContext] search_path = public (temporaire)")
        finally:
            cursor.close()
        return conn

    def restore_tenant_context(self):
        """
        Restaure le search_path au schéma du tenant après une opération public.
        """
        if self._connection and not self._connection.closed:
            cursor = self._connection.cursor()
            try:
                set_search_path_secure(cursor, self.schema_name)
            finally:
                cursor.close()

    def has_permission(self, required_permission: str) -> bool:
        """
        Vérifie si le contexte a une permission spécifique.

        Args:
            required_permission: Permission requise (ex: "invoices:read")

        Returns:
            True si la permission est accordée
        """
        if not self.permissions:
            return False

        # Permission exacte
        if required_permission in self.permissions:
            return True

        # Wildcard sur la ressource (ex: "invoices:*")
        resource = required_permission.split(':')[0]
        if f"{resource}:*" in self.permissions:
            return True

        # Permission admin globale
        if "*:*" in self.permissions or "admin" in self.permissions:
            return True

        return False

    def require_permission(self, required_permission: str):
        """
        Vérifie une permission et lève une exception si non accordée.

        Args:
            required_permission: Permission requise

        Raises:
            PermissionError: Si la permission n'est pas accordée
        """
        if not self.has_permission(required_permission):
            raise PermissionError(
                f"Permission refusée: {required_permission} "
                f"(permissions disponibles: {self.permissions})"
            )

    def close(self):
        """
        Ferme la connexion et nettoie les ressources.

        IMPORTANT: Appeler cette méthode à la fin de chaque requête API.
        """
        if self._connection and self._connection_acquired:
            try:
                # Reset search_path avant de retourner au pool
                cursor = self._connection.cursor()
                cursor.execute("SET search_path TO public")
                cursor.close()
                self._connection.close()
                logger.debug(f"[TenantContext] Connexion fermée pour {self.schema_name}")
            except Exception as e:
                logger.warning(f"[TenantContext] Erreur fermeture connexion: {e}")
            finally:
                self._connection = None
                self._connection_acquired = False

    def __enter__(self):
        """Support du context manager (with statement)."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Ferme automatiquement la connexion à la sortie du context manager."""
        self.close()
        return False  # Ne pas supprimer les exceptions

    def to_dict(self) -> dict:
        """
        Convertit le contexte en dictionnaire (pour logging/debug).
        """
        return {
            'tenant_id': self.tenant_id,
            'schema_name': self.schema_name,
            'entreprise_nom': self.entreprise_nom,
            'api_key_id': self.api_key_id,
            'permissions': self.permissions,
            'rate_limit_per_hour': self.rate_limit_per_hour
        }


# ═══════════════════════════════════════════════════════════════════════════════
# FACTORY FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def create_tenant_context(
    tenant_id: int,
    schema_name: str,
    entreprise_nom: str = "",
    api_key_id: Optional[int] = None,
    permissions: Optional[List[str]] = None,
    rate_limit_per_hour: int = 1000
) -> TenantContext:
    """
    Crée un nouveau contexte tenant.

    Factory function pour créer un TenantContext avec validation.

    Args:
        tenant_id: ID de l'entreprise
        schema_name: Nom du schéma PostgreSQL
        entreprise_nom: Nom de l'entreprise
        api_key_id: ID de la clé API utilisée
        permissions: Liste des permissions
        rate_limit_per_hour: Limite de requêtes

    Returns:
        TenantContext configuré

    Raises:
        ValueError: Si le schema_name est invalide
    """
    return TenantContext(
        tenant_id=tenant_id,
        schema_name=schema_name,
        entreprise_nom=entreprise_nom,
        api_key_id=api_key_id,
        permissions=permissions or [],
        rate_limit_per_hour=rate_limit_per_hour
    )


def create_tenant_context_from_api_info(api_info: dict) -> TenantContext:
    """
    Crée un contexte tenant depuis les informations d'une clé API.

    Args:
        api_info: Dictionnaire retourné par api_auth.verify_api_key()

    Returns:
        TenantContext configuré
    """
    return TenantContext(
        tenant_id=api_info['entreprise_id'],
        schema_name=api_info['schema_name'],
        entreprise_nom=api_info.get('entreprise_nom', ''),
        api_key_id=api_info.get('key_id'),
        permissions=api_info.get('permissions', []),
        rate_limit_per_hour=api_info.get('rate_limit_per_hour', 1000)
    )


# ═══════════════════════════════════════════════════════════════════════════════
# CONTEXT MANAGER UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════

@contextmanager
def tenant_connection(tenant_context: TenantContext):
    """
    Context manager pour une connexion tenant sécurisée.

    Usage:
        with tenant_connection(ctx) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM projects")
            # ...

    Args:
        tenant_context: Contexte tenant actif

    Yields:
        Connexion configurée pour le tenant
    """
    conn = tenant_context.get_connection()
    try:
        yield conn
    finally:
        # Note: ne pas fermer ici car le contexte peut réutiliser la connexion
        pass


@contextmanager
def public_schema_context(tenant_context: TenantContext):
    """
    Context manager pour accéder temporairement au schéma public.

    Usage:
        with public_schema_context(ctx) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM public.entreprises")

    Args:
        tenant_context: Contexte tenant actif

    Yields:
        Connexion configurée pour le schéma public
    """
    conn = tenant_context.get_public_connection()
    try:
        yield conn
    finally:
        # Restaurer le contexte tenant
        tenant_context.restore_tenant_context()


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def execute_tenant_query(
    tenant_context: TenantContext,
    query: str,
    params: tuple = None,
    fetch_one: bool = False
) -> Any:
    """
    Exécute une requête dans le contexte du tenant.

    Helper function pour simplifier les requêtes simples.

    Args:
        tenant_context: Contexte tenant
        query: Requête SQL
        params: Paramètres de la requête
        fetch_one: True pour fetchone(), False pour fetchall()

    Returns:
        Résultat de la requête (dict ou liste de dicts)
    """
    conn = tenant_context.get_connection()
    cursor = conn.cursor()

    try:
        if params:
            cursor.execute(query, params)
        else:
            cursor.execute(query)

        if fetch_one:
            result = cursor.fetchone()
            return dict(result) if result else None
        else:
            results = cursor.fetchall()
            return [dict(row) for row in results]
    finally:
        cursor.close()


def execute_tenant_update(
    tenant_context: TenantContext,
    query: str,
    params: tuple = None
) -> int:
    """
    Exécute une requête de modification dans le contexte du tenant.

    Args:
        tenant_context: Contexte tenant
        query: Requête SQL (INSERT, UPDATE, DELETE)
        params: Paramètres de la requête

    Returns:
        Nombre de lignes affectées
    """
    conn = tenant_context.get_connection()
    cursor = conn.cursor()

    try:
        if params:
            cursor.execute(query, params)
        else:
            cursor.execute(query)

        conn.commit()
        return cursor.rowcount
    finally:
        cursor.close()


# ═══════════════════════════════════════════════════════════════════════════════
# TEST
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=== Test Module API Tenant Context ===")

    # Test création contexte
    ctx = TenantContext(
        tenant_id=1,
        schema_name="tenant_test_123",
        entreprise_nom="Test Enterprise",
        permissions=["invoices:read", "projects:read"]
    )

    print(f"Contexte créé: {ctx.to_dict()}")
    print(f"Has invoices:read: {ctx.has_permission('invoices:read')}")
    print(f"Has invoices:write: {ctx.has_permission('invoices:write')}")
