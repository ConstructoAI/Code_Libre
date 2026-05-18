"""
Module d'authentification API pour Constructo AI
Gestion des clés API pour intégrations externes (QuickBooks, Sage, n8n)

Fonctionnalités:
- Génération de clés API sécurisées
- Vérification et validation des clés
- Gestion des permissions
- Révocation des clés
"""

import os
import secrets
import logging
import json
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any, Tuple
import bcrypt

import psycopg2
import database_config

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# CONSTANTES
# ═══════════════════════════════════════════════════════════════════════════════

# Préfixe des clés API Constructo AI
API_KEY_PREFIX = "cai"
API_KEY_ENV_LIVE = "live"
API_KEY_ENV_TEST = "test"

# Longueur de la partie secrète de la clé
API_KEY_SECRET_LENGTH = 32  # 32 bytes = 256 bits

# Permissions disponibles
PERMISSIONS_READ = [
    "companies:read",
    "projects:read",
    "invoices:read",
    "products:read",
    "inventory:read",
    "quotes:read",
    "employees:read",
    "timetracking:read",
    "payments:read"
]

PERMISSIONS_WRITE = [
    "companies:write",
    "projects:write",
    "invoices:write",
    "products:write",
    "inventory:write",
    "quotes:write",
    "payments:write"
]

PERMISSIONS_ADMIN = [
    "webhooks:manage",
    "api_keys:manage"
]

# Permissions par défaut pour les nouvelles clés API (principe du moindre privilège)
# P3-G: Restreint aux ressources de base en lecture seule.
# Les permissions sensibles (inventory, timetracking, payments) doivent être
# demandées explicitement via un préset ou une sélection personnalisée.
DEFAULT_API_KEY_PERMISSIONS = [
    "companies:read",
    "projects:read",
    "invoices:read",
    "products:read",
    "quotes:read",
    "employees:read"
]

# Présets de permissions
PERMISSION_PRESETS = {
    "read_only": PERMISSIONS_READ,
    "read_write": PERMISSIONS_READ + PERMISSIONS_WRITE,
    "full_access": PERMISSIONS_READ + PERMISSIONS_WRITE + PERMISSIONS_ADMIN
}


# ═══════════════════════════════════════════════════════════════════════════════
# GÉNÉRATION DE CLÉS API
# ═══════════════════════════════════════════════════════════════════════════════

def generate_api_key(
    entreprise_id: int,
    name: str,
    permissions: List[str] = None,
    description: str = "",
    rate_limit_per_hour: int = 1000,
    expires_in_days: Optional[int] = None,
    created_by: Optional[int] = None,
    is_test: bool = False
) -> Tuple[Optional[str], Optional[int]]:
    """
    Génère une nouvelle clé API pour une entreprise.

    IMPORTANT: La clé complète n'est retournée qu'UNE SEULE FOIS.
    Seul le hash est stocké en base de données.

    Args:
        entreprise_id: ID de l'entreprise propriétaire
        name: Nom descriptif de la clé (ex: "QuickBooks Integration")
        permissions: Liste des permissions (défaut: lecture seule restreinte, voir DEFAULT_API_KEY_PERMISSIONS)
        description: Description optionnelle
        rate_limit_per_hour: Limite de requêtes par heure
        expires_in_days: Nombre de jours avant expiration (None = jamais)
        created_by: ID de l'utilisateur qui crée la clé
        is_test: True pour une clé de test (préfixe différent)

    Returns:
        Tuple (clé_complète, key_id) ou (None, None) si erreur
        La clé complète doit être affichée à l'utilisateur immédiatement
    """
    if permissions is None:
        permissions = DEFAULT_API_KEY_PERMISSIONS.copy()

    try:
        # Vérifier que l'entreprise existe
        conn = database_config.get_connection()
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")

        cursor.execute("SELECT id, nom FROM entreprises WHERE id = %s AND active = TRUE", (entreprise_id,))
        entreprise = cursor.fetchone()

        if not entreprise:
            logger.error(f"[API Auth] Entreprise {entreprise_id} non trouvée ou inactive")
            conn.close()
            return None, None

        # Générer la partie secrète de la clé
        secret_part = secrets.token_urlsafe(API_KEY_SECRET_LENGTH)

        # Construire la clé complète
        env_prefix = API_KEY_ENV_TEST if is_test else API_KEY_ENV_LIVE
        full_key = f"{API_KEY_PREFIX}_{env_prefix}_{secret_part}"

        # Extraire le préfixe pour identification (premiers 12 caractères du secret)
        key_prefix = f"{API_KEY_PREFIX}_{env_prefix}_{secret_part[:8]}"

        # Hasher la clé pour stockage sécurisé
        key_hash = bcrypt.hashpw(full_key.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')

        # Calculer la date d'expiration
        expires_at = None
        if expires_in_days:
            expires_at = datetime.now() + timedelta(days=expires_in_days)

        # Stocker en base de données
        cursor.execute('''
            INSERT INTO api_keys
            (entreprise_id, key_hash, key_prefix, name, description, permissions,
             rate_limit_per_hour, expires_at, created_by, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        ''', (
            entreprise_id,
            key_hash,
            key_prefix,
            name,
            description,
            json.dumps(permissions),
            rate_limit_per_hour,
            expires_at,
            created_by,
            datetime.now()
        ))

        key_id = cursor.fetchone()['id']
        conn.commit()
        conn.close()

        logger.info(f"[API Auth] Clé API créée: {key_prefix}... pour entreprise {entreprise['nom']}")

        # Retourner la clé complète (affichée une seule fois)
        return full_key, key_id

    except (psycopg2.Error, ValueError, KeyError) as e:
        logger.error(f"[API Auth] Erreur génération clé API: {e}")
        try:
            conn.close()
        except (psycopg2.Error, OSError):
            pass
        return None, None


# ═══════════════════════════════════════════════════════════════════════════════
# VÉRIFICATION DE CLÉS API
# ═══════════════════════════════════════════════════════════════════════════════

def verify_api_key(api_key: str) -> Optional[Dict[str, Any]]:
    """
    Vérifie une clé API et retourne les informations associées.

    Args:
        api_key: Clé API complète (format: cai_live_XXXXX...)

    Returns:
        Dict avec informations si valide:
        {
            'key_id': int,
            'entreprise_id': int,
            'schema_name': str,
            'entreprise_nom': str,
            'permissions': List[str],
            'rate_limit_per_hour': int
        }
        None si invalide
    """
    if not api_key or not api_key.startswith(API_KEY_PREFIX + "_"):
        logger.warning("[API Auth] Format de clé API invalide")
        return None

    try:
        # Extraire le préfixe pour recherche optimisée
        parts = api_key.split('_')
        if len(parts) < 3:
            logger.warning("[API Auth] Structure de clé API invalide")
            return None

        # Préfixe de recherche (cai_live_XXXXXXXX)
        search_prefix = f"{parts[0]}_{parts[1]}_{parts[2][:8]}"

        conn = database_config.get_connection()
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")

        # Rechercher les clés candidates par préfixe
        cursor.execute('''
            SELECT k.id, k.entreprise_id, k.key_hash, k.permissions, k.rate_limit_per_hour,
                   k.is_active, k.expires_at, e.schema_name, e.nom as entreprise_nom
            FROM api_keys k
            JOIN entreprises e ON k.entreprise_id = e.id
            WHERE k.key_prefix = %s AND k.is_active = TRUE AND e.active = TRUE
        ''', (search_prefix,))

        candidates = cursor.fetchall()

        for candidate in candidates:
            # Vérifier le hash bcrypt
            if bcrypt.checkpw(api_key.encode('utf-8'), candidate['key_hash'].encode('utf-8')):
                # Vérifier l'expiration
                if candidate['expires_at'] and candidate['expires_at'] < datetime.now():
                    logger.warning(f"[API Auth] Clé API expirée: {search_prefix}...")
                    conn.close()
                    return None

                # Mettre à jour last_used_at
                cursor.execute(
                    "UPDATE api_keys SET last_used_at = %s WHERE id = %s",
                    (datetime.now(), candidate['id'])
                )
                conn.commit()
                conn.close()

                # Parser les permissions
                permissions = json.loads(candidate['permissions']) if candidate['permissions'] else []

                logger.debug(f"[API Auth] Clé API validée: {search_prefix}... (entreprise: {candidate['entreprise_nom']})")

                return {
                    'key_id': candidate['id'],
                    'entreprise_id': candidate['entreprise_id'],
                    'schema_name': candidate['schema_name'],
                    'entreprise_nom': candidate['entreprise_nom'],
                    'permissions': permissions,
                    'rate_limit_per_hour': candidate['rate_limit_per_hour']
                }

        conn.close()
        logger.warning(f"[API Auth] Clé API non trouvée ou inactive: {search_prefix}...")
        return None

    except (psycopg2.Error, ValueError, KeyError) as e:
        logger.error(f"[API Auth] Erreur vérification clé API: {e}")
        try:
            conn.close()
        except (psycopg2.Error, OSError):
            pass
        return None


def has_permission(api_info: Dict[str, Any], required_permission: str) -> bool:
    """
    Vérifie si une clé API a une permission spécifique.

    Args:
        api_info: Dictionnaire retourné par verify_api_key()
        required_permission: Permission requise (ex: "invoices:read")

    Returns:
        True si la permission est accordée
    """
    if not api_info or 'permissions' not in api_info:
        return False

    permissions = api_info.get('permissions', [])

    # Vérifier permission exacte
    if required_permission in permissions:
        return True

    # Vérifier wildcard (ex: "invoices:*" pour toutes les permissions invoices)
    resource = required_permission.split(':')[0]
    if f"{resource}:*" in permissions:
        return True

    # Vérifier permission admin globale
    if "*:*" in permissions or "admin" in permissions:
        return True

    return False


# ═══════════════════════════════════════════════════════════════════════════════
# GESTION DES CLÉS API
# ═══════════════════════════════════════════════════════════════════════════════

def list_api_keys(entreprise_id: int) -> List[Dict[str, Any]]:
    """
    Liste toutes les clés API d'une entreprise (sans les secrets).

    Args:
        entreprise_id: ID de l'entreprise

    Returns:
        Liste des clés avec métadonnées (pas les secrets)
    """
    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")

        cursor.execute('''
            SELECT id, key_prefix, name, description, permissions, rate_limit_per_hour,
                   is_active, last_used_at, expires_at, created_at, revoked_at
            FROM api_keys
            WHERE entreprise_id = %s
            ORDER BY created_at DESC
        ''', (entreprise_id,))

        keys = []
        for row in cursor.fetchall():
            keys.append({
                'id': row['id'],
                'key_prefix': row['key_prefix'],
                'name': row['name'],
                'description': row['description'],
                'permissions': json.loads(row['permissions']) if row['permissions'] else [],
                'rate_limit_per_hour': row['rate_limit_per_hour'],
                'is_active': row['is_active'],
                'last_used_at': row['last_used_at'].isoformat() if row['last_used_at'] else None,
                'expires_at': row['expires_at'].isoformat() if row['expires_at'] else None,
                'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                'revoked_at': row['revoked_at'].isoformat() if row['revoked_at'] else None,
                'is_expired': row['expires_at'] < datetime.now() if row['expires_at'] else False
            })

        conn.close()
        return keys

    except (psycopg2.Error, json.JSONDecodeError, KeyError) as e:
        logger.error(f"[API Auth] Erreur liste clés API: {e}")
        return []


def revoke_api_key(key_id: int, entreprise_id: int) -> bool:
    """
    Révoque une clé API.

    Args:
        key_id: ID de la clé à révoquer
        entreprise_id: ID de l'entreprise (pour vérification de propriété)

    Returns:
        True si révoquée avec succès
    """
    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")

        # Vérifier que la clé appartient à l'entreprise
        cursor.execute(
            "SELECT id, key_prefix FROM api_keys WHERE id = %s AND entreprise_id = %s",
            (key_id, entreprise_id)
        )
        key = cursor.fetchone()

        if not key:
            logger.warning(f"[API Auth] Tentative de révocation de clé non autorisée: {key_id}")
            conn.close()
            return False

        # Révoquer la clé
        cursor.execute('''
            UPDATE api_keys
            SET is_active = FALSE, revoked_at = %s
            WHERE id = %s
        ''', (datetime.now(), key_id))

        conn.commit()
        conn.close()

        logger.info(f"[API Auth] Clé API révoquée: {key['key_prefix']}...")
        return True

    except (psycopg2.Error, KeyError) as e:
        logger.error(f"[API Auth] Erreur révocation clé API: {e}")
        return False


def update_api_key(
    key_id: int,
    entreprise_id: int,
    name: Optional[str] = None,
    description: Optional[str] = None,
    permissions: Optional[List[str]] = None,
    rate_limit_per_hour: Optional[int] = None,
    is_active: Optional[bool] = None
) -> bool:
    """
    Met à jour les propriétés d'une clé API.

    Args:
        key_id: ID de la clé
        entreprise_id: ID de l'entreprise (vérification propriété)
        name: Nouveau nom (optionnel)
        description: Nouvelle description (optionnel)
        permissions: Nouvelles permissions (optionnel)
        rate_limit_per_hour: Nouvelle limite (optionnel)
        is_active: Activer/désactiver (optionnel)

    Returns:
        True si mise à jour réussie
    """
    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")

        # Vérifier propriété
        cursor.execute(
            "SELECT id FROM api_keys WHERE id = %s AND entreprise_id = %s",
            (key_id, entreprise_id)
        )
        if not cursor.fetchone():
            conn.close()
            return False

        # Construire la requête de mise à jour
        updates = []
        params = []

        if name is not None:
            updates.append("name = %s")
            params.append(name)
        if description is not None:
            updates.append("description = %s")
            params.append(description)
        if permissions is not None:
            updates.append("permissions = %s")
            params.append(json.dumps(permissions))
        if rate_limit_per_hour is not None:
            updates.append("rate_limit_per_hour = %s")
            params.append(rate_limit_per_hour)
        if is_active is not None:
            updates.append("is_active = %s")
            params.append(is_active)
            if not is_active:
                updates.append("revoked_at = %s")
                params.append(datetime.now())

        if not updates:
            conn.close()
            return True

        params.append(key_id)
        query = f"UPDATE api_keys SET {', '.join(updates)} WHERE id = %s"
        cursor.execute(query, params)

        conn.commit()
        conn.close()

        logger.info(f"[API Auth] Clé API {key_id} mise à jour")
        return True

    except (psycopg2.Error, KeyError, json.JSONDecodeError) as e:
        logger.error(f"[API Auth] Erreur mise à jour clé API: {e}")
        return False


def get_api_key_stats(entreprise_id: int, days: int = 30) -> Dict[str, Any]:
    """
    Retourne les statistiques d'utilisation des clés API.

    Args:
        entreprise_id: ID de l'entreprise
        days: Nombre de jours d'historique

    Returns:
        Statistiques d'utilisation
    """
    try:
        conn = database_config.get_connection()
        cursor = conn.cursor()
        cursor.execute("SET search_path TO public")

        since_date = datetime.now() - timedelta(days=days)

        # Nombre total de requêtes
        cursor.execute('''
            SELECT COUNT(*) as total_requests,
                   COUNT(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 END) as successful,
                   COUNT(CASE WHEN status_code >= 400 THEN 1 END) as errors,
                   AVG(response_time_ms) as avg_response_time
            FROM api_request_logs
            WHERE entreprise_id = %s AND created_at >= %s
        ''', (entreprise_id, since_date))

        stats = cursor.fetchone()

        # Requêtes par endpoint
        cursor.execute('''
            SELECT endpoint, COUNT(*) as count
            FROM api_request_logs
            WHERE entreprise_id = %s AND created_at >= %s
            GROUP BY endpoint
            ORDER BY count DESC
            LIMIT 10
        ''', (entreprise_id, since_date))

        endpoints = [{'endpoint': r['endpoint'], 'count': r['count']} for r in cursor.fetchall()]

        # Clés actives
        cursor.execute('''
            SELECT COUNT(*) as active_keys
            FROM api_keys
            WHERE entreprise_id = %s AND is_active = TRUE
        ''', (entreprise_id,))

        active_keys = cursor.fetchone()['active_keys']

        conn.close()

        return {
            'period_days': days,
            'total_requests': stats['total_requests'] or 0,
            'successful_requests': stats['successful'] or 0,
            'error_requests': stats['errors'] or 0,
            'avg_response_time_ms': round(stats['avg_response_time'] or 0, 2),
            'top_endpoints': endpoints,
            'active_keys': active_keys
        }

    except (psycopg2.Error, KeyError, TypeError) as e:
        logger.error(f"[API Auth] Erreur stats clés API: {e}")
        return {}


# ═══════════════════════════════════════════════════════════════════════════════
# UTILITAIRES
# ═══════════════════════════════════════════════════════════════════════════════

def get_permission_presets() -> Dict[str, List[str]]:
    """Retourne les présets de permissions disponibles."""
    return PERMISSION_PRESETS.copy()


def get_all_permissions() -> Dict[str, List[str]]:
    """Retourne toutes les permissions organisées par catégorie."""
    return {
        'read': PERMISSIONS_READ.copy(),
        'write': PERMISSIONS_WRITE.copy(),
        'admin': PERMISSIONS_ADMIN.copy()
    }


def validate_permissions(permissions: List[str]) -> List[str]:
    """
    Valide et nettoie une liste de permissions.

    Args:
        permissions: Liste de permissions à valider

    Returns:
        Liste de permissions valides uniquement
    """
    all_valid = PERMISSIONS_READ + PERMISSIONS_WRITE + PERMISSIONS_ADMIN
    return [p for p in permissions if p in all_valid]


# ═══════════════════════════════════════════════════════════════════════════════
# TEST
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=== Test Module API Auth ===")
    print(f"Préfixe clés: {API_KEY_PREFIX}")
    print(f"Permissions lecture: {PERMISSIONS_READ}")
    print(f"Permissions écriture: {PERMISSIONS_WRITE}")
    print(f"Permissions admin: {PERMISSIONS_ADMIN}")
    print(f"Présets: {list(PERMISSION_PRESETS.keys())}")
