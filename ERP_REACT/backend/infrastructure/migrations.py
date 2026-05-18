"""
Database Migrations — Guide d'integration Alembic.

L'ERP Constructo AI utilise actuellement des migrations defensives
(ALTER TABLE IF NOT EXISTS, CREATE TABLE IF NOT EXISTS) dans chaque router.
Ce module documente la transition vers Alembic pour des migrations controlees.

Alembic est deja dans requirements.txt (alembic>=1.14.0).

Pour initialiser:
    cd ERP_REACT/backend
    alembic init migrations

Pour creer une migration:
    alembic revision --autogenerate -m "add column X to table Y"

Pour appliquer:
    alembic upgrade head

Note: Les migrations multi-tenant necessitent d'appliquer chaque migration
sur tous les schemas tenant_* en plus du schema public.
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Alembic is already in requirements.txt but not yet initialized.
# This module provides helpers for when it's set up.

ALEMBIC_INITIALIZED = os.path.exists(
    os.path.join(os.path.dirname(__file__), "..", "alembic.ini")
)


def check_migrations_status() -> dict:
    """Check if Alembic is initialized and report status."""
    return {
        "alembic_initialized": ALEMBIC_INITIALIZED,
        "strategy": "defensive" if not ALEMBIC_INITIALIZED else "alembic",
        "note": (
            "Using defensive migrations (ALTER TABLE IF NOT EXISTS). "
            "Run 'alembic init migrations' to switch to controlled migrations."
            if not ALEMBIC_INITIALIZED
            else "Alembic migrations active."
        ),
    }


def get_tenant_schemas(conn) -> list:
    """List all tenant schemas for multi-tenant migration."""
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT schema_name FROM information_schema.schemata "
            "WHERE schema_name LIKE 'tenant_%' ORDER BY schema_name"
        )
        schemas = [row[0] for row in cursor.fetchall()]
        return schemas
    except Exception as exc:
        logger.error("Failed to list tenant schemas: %s", exc)
        return []
    finally:
        if cursor:
            try:
                cursor.close()
            except Exception:
                pass
