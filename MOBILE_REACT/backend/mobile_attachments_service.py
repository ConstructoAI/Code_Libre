"""Service layer pour le module Attachments polymorphiques.

Une table unifiee `document_attachments` rattache des fichiers (BYTEA) a
n'importe quelle entite metier via (parent_type, parent_id). Coexiste avec
les tables silotees ERP legacy (project_attachments, devis_attachments, etc.)
sans collision — destination propriete du module Mobile React.

Migration : runtime via _ensure_attachments_table (pattern _ensure_weather_columns).
"""

from __future__ import annotations

import hashlib
import logging
import threading
from typing import Optional

import psycopg2
import psycopg2.extras  # pour psycopg2.extras.Json (JSONB)
from psycopg2.extras import RealDictCursor

from . import mobile_database as db

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Migration runtime idempotente — pattern _ensure_weather_columns
# ---------------------------------------------------------------------------

_ATTACHMENTS_ENSURED: set = set()
_ATTACHMENTS_LOCK = threading.Lock()


_VALID_PARENT_TYPES = ('dossier', 'devis', 'facture', 'bon_travail', 'bon_commande', 'bon_achat')

# Mapping parent_type -> (table_name, primary_key_col)
_PARENT_TABLES = {
    'dossier': ('dossiers', 'id'),
    'devis': ('devis', 'id'),
    'facture': ('factures', 'id'),
    'bon_travail': ('formulaires', 'id'),  # WHERE type_formulaire = 'BON_TRAVAIL'
    'bon_commande': ('bons_commande', 'id'),
    'bon_achat': ('bons_achat', 'id'),
}


def _ensure_attachments_table(cursor) -> None:
    """Migration idempotente : cree document_attachments si absente.

    Memoized par (worker process, schema). Pattern strict de _ensure_weather_columns
    avec advisory_xact_lock pour serialiser workers concurrents au premier appel.
    """
    schema_key = None
    try:
        cursor.execute("SELECT current_schema()")
        row = cursor.fetchone()
        if row:
            schema_key = row[0] if not isinstance(row, dict) else row.get("current_schema")
    except Exception:
        schema_key = None

    if schema_key:
        with _ATTACHMENTS_LOCK:
            if schema_key in _ATTACHMENTS_ENSURED:
                return

    conn = cursor.connection
    altered = False
    try:
        if schema_key:
            try:
                cursor.execute(
                    "SELECT pg_advisory_xact_lock(hashtext(%s))",
                    (f"{schema_key}:attachments_ensure",),
                )
            except Exception:
                pass

            with _ATTACHMENTS_LOCK:
                if schema_key in _ATTACHMENTS_ENSURED:
                    try:
                        conn.commit()
                    except Exception:
                        pass
                    return

        cursor.execute(
            """CREATE TABLE IF NOT EXISTS document_attachments (
                id                  SERIAL PRIMARY KEY,
                parent_type         VARCHAR(32) NOT NULL,
                parent_id           INTEGER NOT NULL,
                filename            VARCHAR(255) NOT NULL,
                original_filename   VARCHAR(255) NOT NULL,
                mime_type_declared  VARCHAR(127),
                mime_type_actual    VARCHAR(127) NOT NULL,
                size_bytes          INTEGER NOT NULL,
                file_data           BYTEA NOT NULL,
                category            VARCHAR(32) NOT NULL DEFAULT 'AUTRE',
                description         TEXT,
                uploaded_by         INTEGER NOT NULL,
                uploaded_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                exif_data           JSONB,
                file_hash           VARCHAR(64),
                deleted_at          TIMESTAMP,
                deleted_by          INTEGER
            )"""
        )

        # CHECK constraints via DO block (ADD CONSTRAINT IF NOT EXISTS pas supporte)
        cursor.execute(
            """DO $$ BEGIN
                ALTER TABLE document_attachments ADD CONSTRAINT chk_attachments_parent_type
                CHECK (parent_type IN ('dossier','devis','facture','bon_travail','bon_commande','bon_achat'));
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;"""
        )
        cursor.execute(
            """DO $$ BEGIN
                ALTER TABLE document_attachments ADD CONSTRAINT chk_attachments_category
                CHECK (category IN ('PLAN','PHOTO','CONTRAT','FACTURE','DEVIS',
                                    'BON_LIVRAISON','BON_TRAVAIL','RAPPORT','AUTRE'));
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;"""
        )
        cursor.execute(
            """DO $$ BEGIN
                ALTER TABLE document_attachments ADD CONSTRAINT chk_attachments_size
                CHECK (size_bytes > 0 AND size_bytes <= 10485760);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;"""
        )

        # Indexes partiels (excluent les soft-deleted pour performance listings)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_doc_attach_parent "
            "ON document_attachments (parent_type, parent_id) "
            "WHERE deleted_at IS NULL"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_doc_attach_uploaded_at "
            "ON document_attachments (uploaded_at DESC) "
            "WHERE deleted_at IS NULL"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_doc_attach_uploader "
            "ON document_attachments (uploaded_by, uploaded_at DESC) "
            "WHERE deleted_at IS NULL"
        )
        altered = True
    except Exception as exc:
        logger.warning("[ATTACHMENTS] Migration schema=%s failed: %s", schema_key, exc)
        try:
            conn.rollback()
        except Exception:
            pass
        return

    if altered:
        try:
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            return

        if schema_key:
            with _ATTACHMENTS_LOCK:
                _ATTACHMENTS_ENSURED.add(schema_key)


# ---------------------------------------------------------------------------
# Coherence applicative : verification que le parent existe vraiment
# ---------------------------------------------------------------------------

def _validate_parent_exists(schema_name: str, parent_type: str, parent_id: int) -> bool:
    """Verifie qu'une entite parent (dossier/devis/facture/BT/BC/BA) existe.

    Retourne False si le parent n'existe pas — eviter d'inserter des attachments
    orphelins (pas de FK polymorphique possible en PostgreSQL).
    """
    if parent_type not in _PARENT_TABLES:
        return False
    table, pk_col = _PARENT_TABLES[parent_type]
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            db.set_search_path(cur, schema_name)
            if parent_type == 'bon_travail':
                # 'formulaires' contient plusieurs types — filtrer
                cur.execute(
                    "SELECT 1 FROM formulaires WHERE id = %s AND type_formulaire = 'BON_TRAVAIL'",
                    (parent_id,),
                )
            else:
                cur.execute(
                    f"SELECT 1 FROM {table} WHERE {pk_col} = %s",
                    (parent_id,),
                )
            return cur.fetchone() is not None
    except psycopg2.Error as exc:
        logger.warning("[ATTACHMENTS] _validate_parent_exists error (%s/%s): %s",
                       parent_type, parent_id, exc)
        return False
    finally:
        db.release_connection(conn)


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def create_attachment(
    schema_name: str,
    parent_type: str,
    parent_id: int,
    file_data: bytes,
    filename: str,
    original_filename: str,
    mime_actual: str,
    mime_declared: Optional[str],
    size_bytes: int,
    category: str,
    uploaded_by: int,
    exif_data: Optional[dict] = None,
    description: Optional[str] = None,
) -> dict:
    """Insere un nouvel attachment. Calcule le hash SHA-256 cote service."""
    file_hash = hashlib.sha256(file_data).hexdigest()
    conn = db.get_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            db.set_search_path(cur, schema_name)
            _ensure_attachments_table(cur)
            cur.execute(
                """INSERT INTO document_attachments (
                    parent_type, parent_id, filename, original_filename,
                    mime_type_declared, mime_type_actual, size_bytes, file_data,
                    category, description, uploaded_by, exif_data, file_hash
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, filename, size_bytes, mime_type_actual AS mime_type,
                          uploaded_at""",
                (
                    parent_type, parent_id, filename, original_filename,
                    mime_declared, mime_actual, size_bytes, psycopg2.Binary(file_data),
                    category, description, uploaded_by,
                    psycopg2.extras.Json(exif_data) if exif_data else None,
                    file_hash,
                ),
            )
            row = cur.fetchone()
            conn.commit()
            return dict(row)
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        db.release_connection(conn)


def list_attachments(
    schema_name: str,
    parent_type: str,
    parent_id: int,
    category: Optional[str] = None,
    include_deleted: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Liste les attachments d'un parent (sans file_data — economiser bande passante)."""
    conn = db.get_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            db.set_search_path(cur, schema_name)
            _ensure_attachments_table(cur)
            query = (
                "SELECT a.id, a.parent_type, a.parent_id, a.filename, "
                "       a.original_filename, a.mime_type_actual AS mime_type, "
                "       a.size_bytes, a.category, a.uploaded_by, a.uploaded_at, "
                "       (e.prenom || ' ' || e.nom) AS uploaded_by_name "
                "FROM document_attachments a "
                "LEFT JOIN employees e ON e.id = a.uploaded_by "
                "WHERE a.parent_type = %s AND a.parent_id = %s "
            )
            params: list = [parent_type, parent_id]
            if not include_deleted:
                query += "AND a.deleted_at IS NULL "
            if category:
                query += "AND a.category = %s "
                params.append(category)
            query += "ORDER BY a.uploaded_at DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])
            cur.execute(query, tuple(params))
            return [dict(r) for r in cur.fetchall()]
    finally:
        db.release_connection(conn)


def get_attachment_meta(schema_name: str, attachment_id: int) -> Optional[dict]:
    """Recupere les metadata d'un attachment (sans file_data)."""
    conn = db.get_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            db.set_search_path(cur, schema_name)
            _ensure_attachments_table(cur)
            cur.execute(
                """SELECT a.id, a.parent_type, a.parent_id, a.filename,
                          a.original_filename, a.mime_type_actual AS mime_type,
                          a.size_bytes, a.category, a.description, a.exif_data,
                          a.file_hash, a.uploaded_by, a.uploaded_at, a.deleted_at,
                          (e.prenom || ' ' || e.nom) AS uploaded_by_name
                   FROM document_attachments a
                   LEFT JOIN employees e ON e.id = a.uploaded_by
                   WHERE a.id = %s""",
                (attachment_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        db.release_connection(conn)


def get_attachment_bytes(
    schema_name: str,
    attachment_id: int,
    include_deleted: bool = False,
) -> Optional[tuple[bytes, dict]]:
    """Retourne (file_data, meta_dict) — pour download/preview.

    None si attachment introuvable ou soft-deleted (sauf include_deleted=True).
    """
    conn = db.get_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            db.set_search_path(cur, schema_name)
            _ensure_attachments_table(cur)
            query = (
                "SELECT id, filename, original_filename, "
                "       mime_type_actual AS mime_type, size_bytes, file_data "
                "FROM document_attachments WHERE id = %s "
            )
            if not include_deleted:
                query += "AND deleted_at IS NULL"
            cur.execute(query, (attachment_id,))
            row = cur.fetchone()
            if not row:
                return None
            data = bytes(row['file_data']) if not isinstance(row['file_data'], bytes) else row['file_data']
            meta = {k: row[k] for k in ('id', 'filename', 'original_filename', 'mime_type', 'size_bytes')}
            return (data, meta)
    finally:
        db.release_connection(conn)


def soft_delete_attachment(schema_name: str, attachment_id: int, deleted_by: int) -> bool:
    """Soft delete (deleted_at + deleted_by). Retourne True si quelque chose a ete affecte."""
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            db.set_search_path(cur, schema_name)
            _ensure_attachments_table(cur)
            cur.execute(
                """UPDATE document_attachments
                   SET deleted_at = CURRENT_TIMESTAMP, deleted_by = %s
                   WHERE id = %s AND deleted_at IS NULL""",
                (deleted_by, attachment_id),
            )
            affected = cur.rowcount > 0
            conn.commit()
            return affected
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        db.release_connection(conn)


def update_attachment(
    schema_name: str,
    attachment_id: int,
    filename: Optional[str] = None,
    category: Optional[str] = None,
    description: Optional[str] = None,
) -> Optional[dict]:
    """PATCH : renommer / changer categorie / description. Retourne metadata mises a jour."""
    updates: list[str] = []
    params: list = []
    if filename is not None:
        updates.append("filename = %s")
        params.append(filename)
    if category is not None:
        updates.append("category = %s")
        params.append(category)
    if description is not None:
        updates.append("description = %s")
        params.append(description)
    if not updates:
        return get_attachment_meta(schema_name, attachment_id)

    params.append(attachment_id)
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            db.set_search_path(cur, schema_name)
            _ensure_attachments_table(cur)
            cur.execute(
                f"UPDATE document_attachments SET {', '.join(updates)} "
                f"WHERE id = %s AND deleted_at IS NULL",
                tuple(params),
            )
            if cur.rowcount == 0:
                conn.rollback()
                return None
            conn.commit()
        return get_attachment_meta(schema_name, attachment_id)
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        db.release_connection(conn)
