"""
ERP React - Documents Router
Dossiers + pièces jointes.
Based on dossier.py (3,070 lines).
"""

import os
import re
import sys
import logging
import secrets
import json
import base64
import unicodedata
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel, Field
from typing import Optional, List
import io
from psycopg2 import errors as psycopg2_errors

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db

# Import Anthropic + AI helpers from ai.py
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
try:
    import anthropic
    _anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
except ImportError:
    _anthropic_client = None

_NOTE_CATEGORIES = ['defaut', 'observation', 'progression', 'decision', 'action', 'general']


# Tous les caractères de contrôle ASCII (0x00-0x1F + 0x7F) + caractères qui
# cassent un header Content-Disposition: quote, backslash, séparateurs de path.
_FILENAME_UNSAFE_RE = re.compile(r'[\x00-\x1f\x7f"\\/]')


def _sanitize_filename_for_header(name: str) -> str:
    """Retourne un filename sûr pour Content-Disposition.

    - Supprime tous les caractères de contrôle, quotes, séparateurs de path.
    - Tronque à 255 caractères.
    - Fallback "file" si tout est filtré.
    """
    if not name:
        return "file"
    cleaned = _FILENAME_UNSAFE_RE.sub("_", name).strip().strip(".")
    cleaned = cleaned[:255]
    return cleaned or "file"

_NOTE_AI_SYSTEM = """Tu es un assistant IA specialise en construction au Quebec, integre dans l'ERP Constructo AI.
Tu aides les gestionnaires de chantier a documenter professionnellement leurs dossiers.
REGLES:
1. Reponds toujours en francais quebecois professionnel.
2. Structure les notes avec des sections claires (gras avec **).
3. Sois concis et pertinent pour le domaine de la construction.
4. Identifie les actions a suivre quand pertinent."""

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/documents", tags=["Documents"])

DOCUMENT_CATEGORIES = [
    "PLAN", "PHOTO", "CONTRAT", "FACTURE", "CORRESPONDANCE",
    "ADDENDA", "FICHE_TECHNIQUE", "SOUMISSION", "DIRECTIVE_CHANTIER", "AUTRE",
]

DOSSIER_STATUTS = ["OUVERT", "EN_COURS", "EN_ATTENTE", "TERMINE", "ARCHIVE"]


class DossierCreate(BaseModel):
    titre: str = Field(..., min_length=1, max_length=255)
    type_dossier: str = "PROJET"
    project_id: Optional[str] = None
    priorite: str = "NORMAL"
    notes: Optional[str] = None


class DossierUpdate(BaseModel):
    titre: Optional[str] = Field(None, min_length=1, max_length=255)
    statut: Optional[str] = None
    priorite: Optional[str] = None
    notes: Optional[str] = None


class EtapeCreate(BaseModel):
    titre: str
    description: Optional[str] = None
    ordre: int = 0


class NoteCreate(BaseModel):
    contenu: str


class LienCreate(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)
    description: Optional[str] = Field(None, max_length=1000)


class LienUpdate(BaseModel):
    url: Optional[str] = Field(None, min_length=1, max_length=2048)
    description: Optional[str] = Field(None, max_length=1000)


# ============================================
# HELPER: ensure new tables
# ============================================

def _ensure_etapes_table(cursor):
    """Create dossier_etapes table if not exists, and add missing columns."""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS dossier_etapes (
            id SERIAL PRIMARY KEY,
            dossier_id INTEGER NOT NULL,
            titre TEXT NOT NULL,
            description TEXT,
            statut TEXT DEFAULT 'EN_ATTENTE',
            ordre INTEGER DEFAULT 0,
            completed_at TIMESTAMP,
            completed_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Add columns that may be missing on older tenant schemas
    for col, typ in [("completed_at", "TIMESTAMP"), ("completed_by", "TEXT")]:
        try:
            cursor.execute(f"ALTER TABLE dossier_etapes ADD COLUMN IF NOT EXISTS {col} {typ}")
        except Exception:
            pass


def _ensure_notes_table(cursor):
    """Create dossier_notes table if not exists."""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS dossier_notes (
            id SERIAL PRIMARY KEY,
            dossier_id INTEGER NOT NULL,
            contenu TEXT NOT NULL,
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Add attachments column if missing (stores JSON array of {nom, type, taille, data_base64})
    try:
        cursor.execute("ALTER TABLE dossier_notes ADD COLUMN IF NOT EXISTS attachments TEXT")
    except Exception:
        pass
    # Add categorie + is_pinned columns for AI features
    for col, typ in [("categorie", "TEXT DEFAULT 'general'"), ("is_pinned", "BOOLEAN DEFAULT FALSE")]:
        try:
            cursor.execute(f"ALTER TABLE dossier_notes ADD COLUMN IF NOT EXISTS {col} {typ}")
        except Exception:
            pass
    # Fix created_by column type if it was created as INTEGER by an older migration
    try:
        cursor.execute(
            "ALTER TABLE dossier_notes ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT"
        )
    except Exception:
        pass  # Already TEXT or column doesn't exist


def _ensure_liens_table(cursor):
    """Create dossier_liens table if not exists."""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS dossier_liens (
            id SERIAL PRIMARY KEY,
            dossier_id INTEGER NOT NULL,
            url TEXT NOT NULL,
            description TEXT,
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    try:
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_dossier_liens_dossier ON dossier_liens(dossier_id)"
        )
    except Exception:
        pass


_URL_SCHEME_RE = re.compile(r'^https?://', re.IGNORECASE)


def _validate_lien_url(url: str) -> str:
    """Valide et normalise une URL de lien. Seuls http:// et https:// sont acceptes."""
    cleaned = (url or '').strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="URL requise")
    if len(cleaned) > 2048:
        raise HTTPException(status_code=400, detail="URL trop longue (max 2048 caracteres)")
    # Bloquer caracteres de controle (CRLF, NUL, etc.) pour eviter header/log injection.
    if any(c in cleaned for c in ('\r', '\n', '\0')):
        raise HTTPException(status_code=400, detail="URL contient des caracteres invalides")
    if not _URL_SCHEME_RE.match(cleaned):
        raise HTTPException(
            status_code=400,
            detail="L'URL doit commencer par http:// ou https://",
        )
    return cleaned


def _clean_lien_description(raw: Optional[str]) -> Optional[str]:
    """Normalise la description: strip, vide -> None. Coherent entre CREATE et UPDATE."""
    if raw is None:
        return None
    cleaned = raw.strip()
    return cleaned if cleaned else None


def _verify_dossier_exists_in_tenant(cursor, dossier_id: int) -> None:
    """Valide que le dossier existe dans le schema tenant courant (defense contre IDOR).

    db.set_tenant() isole deja les requetes au schema du tenant, mais sans cette
    verification un client pourrait creer des liens orphelins pour un dossier_id
    inexistant, ou obtenir un 404 confus au lieu d'une erreur claire.

    On distingue:
    - Table `dossiers` inexistante OU dossier absent => 404
    - Toute autre erreur DB (permission, connexion, syntaxe) => re-raise pour
      qu'elle soit loggee par l'appelant et renvoyee en 500 (plutot que masquee
      par un 404 trompeur).
    """
    try:
        cursor.execute(
            "SELECT 1 FROM dossiers WHERE id = %s LIMIT 1",
            (dossier_id,),
        )
    except psycopg2_errors.UndefinedTable:
        # Table 'dossiers' absente dans ce tenant -> equivaut a dossier_id invalide.
        raise HTTPException(status_code=404, detail="Dossier non trouve")
    if cursor.fetchone() is None:
        raise HTTPException(status_code=404, detail="Dossier non trouve")


# ============================================
# STATISTICS (must be before /{dossier_id})
# ============================================

@router.get("/statistics")
async def get_dossier_statistics(user: ErpUser = Depends(get_current_user)):
    """Get dossier statistics grouped by statut."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_schema = %s AND table_name = 'dossiers')",
            (user.schema,),
        )
        if not cursor.fetchone().get("exists", False):
            return {"total": 0, "ouverts": 0, "termines": 0, "par_statut": []}
        cursor.execute("SELECT statut, COUNT(*) as count FROM dossiers GROUP BY statut")
        rows = cursor.fetchall()
        par_statut = [dict(r) for r in rows]
        total = sum(r["count"] for r in par_statut)
        ouverts = sum(r["count"] for r in par_statut if r["statut"] in ("OUVERT", "EN_COURS", "EN_ATTENTE"))
        termines = sum(r["count"] for r in par_statut if r["statut"] in ("TERMINE", "ARCHIVE"))
        return {"total": total, "ouverts": ouverts, "termines": termines, "par_statut": par_statut}
    except Exception as exc:
        logger.error("get_dossier_statistics error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("")
async def list_dossiers(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    statut: Optional[str] = None,
    project_id: Optional[str] = None,
):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Check if dossiers table exists
        cursor.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_schema = %s AND table_name = 'dossiers')",
            (user.schema,),
        )
        if not cursor.fetchone().get("exists", False):
            return {"items": [], "total": 0, "page": page, "per_page": per_page}

        wheres, params = [], []
        if statut:
            wheres.append("statut = %s")
            params.append(statut)
        if project_id:
            wheres.append("project_id = %s")
            params.append(project_id)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(f"SELECT COUNT(*) as total FROM dossiers WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        # Ensure notes column exists (some tenants may not have it)
        try:
            cursor.execute("ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS notes TEXT")
        except Exception:
            pass
        cursor.execute(
            f"SELECT id, numero_dossier, titre, type_dossier, statut, priorite, project_id, "
            f"notes, created_at, updated_at FROM dossiers "
            f"WHERE {w} ORDER BY updated_at DESC NULLS LAST LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("created_at", "updated_at"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except Exception as exc:
        logger.error("list_dossiers error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/{dossier_id}")
async def get_dossier(dossier_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM dossiers WHERE id = %s", (dossier_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Dossier non trouvé")
        d = dict(row)
        for k in ("created_at", "updated_at"):
            if d.get(k):
                d[k] = str(d[k])
        return d
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_dossier error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("")
async def create_dossier(body: DossierCreate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Auto-generate numero_dossier: DOS-YYYY-NNNNN
        # INSERT with temp numero, then UPDATE with ID-based unique number
        # (fixes race condition: COUNT(*)+1 can produce duplicates — lesson #113)
        from datetime import date
        year = date.today().year
        cursor.execute(
            "INSERT INTO dossiers (numero_dossier, titre, type_dossier, project_id, statut, priorite, "
            "notes, created_at, updated_at) "
            "VALUES ('TEMP', %s, %s, %s, 'OUVERT', %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.titre, body.type_dossier, body.project_id, body.priorite, body.notes),
        )
        row = cursor.fetchone()
        dossier_id = row["id"]
        numero_dossier = f"DOS-{year}-{dossier_id:05d}"
        cursor.execute("UPDATE dossiers SET numero_dossier = %s WHERE id = %s", (numero_dossier, dossier_id))
        conn.commit()
        return {"id": dossier_id, "numeroDossier": numero_dossier, "message": "Dossier créé"}
    except Exception as exc:
        logger.error("create_dossier error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/{dossier_id}")
async def update_dossier(dossier_id: int, body: DossierUpdate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    ALLOWED_COLS = {"titre", "statut", "priorite", "notes"}
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ")
    if "statut" in fields and fields["statut"] not in DOSSIER_STATUTS:
        raise HTTPException(status_code=400, detail=f"Statut invalide. Valeurs: {DOSSIER_STATUTS}")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [dossier_id]
        cursor.execute(f"UPDATE dossiers SET {', '.join(set_parts)} WHERE id = %s", values)
        conn.commit()
        return {"message": "Dossier mis à jour"}
    except Exception as exc:
        logger.error("update_dossier error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/{dossier_id}")
async def delete_dossier(dossier_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a dossier with cascading cleanup on child tables.

    Preserves historical links by SET NULL on opportunities.dossier_id and
    projects.dossier_id (the record stays, just detached from the dossier).
    Explicit cascade on all child tables with dossier_id (defensive — some
    association tables are created without FK CASCADE, leaving orphan rows).
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    # Pool returns connections in AUTOCOMMIT mode — disable for atomic multi-step delete.
    prev_autocommit = conn.autocommit
    try:
        db.set_tenant(conn, user.schema)
        conn.autocommit = False
        cursor = conn.cursor()

        # 1. Check dossier exists + lock the row (prevents concurrent delete race)
        cursor.execute(
            "SELECT id, titre FROM dossiers WHERE id = %s FOR UPDATE",
            (dossier_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Dossier introuvable")
        titre = row["titre"] if isinstance(row, dict) else row[1]

        # 2. Cascade cleanup on child tables (guard information_schema for tenants without them).
        # Covers both FK-CASCADE tables (defensive redundancy) and tables without FK
        # (created via _ensure_link_tables without REFERENCES clause — orphans would remain).
        child_tables = (
            "attachments",
            "dossier_notes",
            "dossier_etapes",
            "dossier_devis",
            "dossier_projets",
            "dossier_formulaires",
            "dossier_achats",
            "dossier_factures",
            "dossier_documents",
            "dossier_commentaires_publics",
        )
        for table in child_tables:
            cursor.execute(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = %s AND table_name = %s",
                (user.schema, table),
            )
            if cursor.fetchone():
                cursor.execute(
                    f"DELETE FROM {table} WHERE dossier_id = %s",
                    (dossier_id,),
                )

        # 3. Public share tokens (stored in public schema — both plural/singular legacy variants)
        for token_table in ("dossiers_public_tokens", "dossier_public_tokens"):
            cursor.execute(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = %s",
                (token_table,),
            )
            if cursor.fetchone():
                cursor.execute(
                    f"DELETE FROM public.{token_table} "
                    "WHERE tenant_schema = %s AND dossier_id = %s",
                    (user.schema, dossier_id),
                )

        # 4. Detach from preserved records (SET NULL on opportunities, projects)
        for table in ("opportunities", "projects"):
            cursor.execute(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = %s AND table_name = %s AND column_name = 'dossier_id'",
                (user.schema, table),
            )
            if cursor.fetchone():
                cursor.execute(
                    f"UPDATE {table} SET dossier_id = NULL WHERE dossier_id = %s",
                    (dossier_id,),
                )

        # 5. Delete the dossier itself (any remaining FK CASCADE children are handled by PostgreSQL)
        cursor.execute("DELETE FROM dossiers WHERE id = %s", (dossier_id,))
        conn.commit()
        logger.info("Dossier %s (%s) deleted by user %s", dossier_id, titre, user.user_id)
        return {"message": "Dossier supprimé", "id": dossier_id}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        logger.error("delete_dossier error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression du dossier")
    finally:
        if cursor:
            cursor.close()
        try:
            conn.autocommit = prev_autocommit
        except Exception:
            pass
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# ATTACHMENTS (Pieces jointes)
# ============================================

def _ensure_attachments_table(cursor):
    """Create attachments table if not exists."""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS attachments (
            id SERIAL PRIMARY KEY,
            dossier_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            content_type TEXT,
            file_size INTEGER,
            file_data BYTEA,
            category TEXT DEFAULT 'AUTRE',
            uploaded_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)


@router.post("/{dossier_id}/attachments")
async def upload_attachment(
    dossier_id: int,
    file: UploadFile = File(...),
    user: ErpUser = Depends(get_current_user),
):
    """Upload a file attachment to a dossier."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    MAX_SIZE = 150 * 1024 * 1024  # 150 MB
    chunks = []
    total = 0
    while True:
        chunk = await file.read(64 * 1024)  # 64 KB chunks
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_SIZE:
            raise HTTPException(status_code=413, detail="Fichier trop volumineux (max 150 MB)")
        chunks.append(chunk)
    file_data = b"".join(chunks)
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_attachments_table(cursor)
        cursor.execute(
            "INSERT INTO attachments (dossier_id, filename, original_name, content_type, "
            "file_size, file_data, uploaded_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                dossier_id,
                file.filename,
                file.filename,
                file.content_type,
                len(file_data),
                file_data,
                # `uploaded_by` schema varies by tenant (INTEGER vs TEXT) —
                # str() lets PG cast to either via unknown-type resolution.
                str(user.user_id),
            ),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "filename": file.filename, "message": "Fichier televerse"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("upload_attachment error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/{dossier_id}/attachments")
async def list_attachments(dossier_id: int, user: ErpUser = Depends(get_current_user)):
    """List attachments for a dossier (without file content)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_attachments_table(cursor)
        cursor.execute(
            "SELECT id, filename, original_name, content_type, file_size, category, "
            "uploaded_by, created_at FROM attachments "
            "WHERE dossier_id = %s ORDER BY created_at DESC",
            (dossier_id,),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            items.append(d)
        return {"items": items}
    except Exception as exc:
        logger.error("list_attachments error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/{dossier_id}/attachments/{att_id}/download")
async def download_attachment(dossier_id: int, att_id: int, user: ErpUser = Depends(get_current_user)):
    """Download an attachment file."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_attachments_table(cursor)
        cursor.execute(
            "SELECT filename, original_name, content_type, file_data "
            "FROM attachments WHERE id = %s AND dossier_id = %s",
            (att_id, dossier_id),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Piece jointe non trouvée")
        content_type = row["content_type"] or "application/octet-stream"
        original_name = row["original_name"] or row["filename"]
        # psycopg2 returns BYTEA as memoryview — normalize to bytes up front
        # so adding any string operation later (e.g. a future hash / magic
        # check) won't silently crash with AttributeError (see the /preview
        # regression that was fixed in b9dc0af).
        file_bytes = bytes(row["file_data"]) if row["file_data"] else b""
        # Strip characters that could break the Content-Disposition header
        # (quote, CR, LF) — same hardening as /preview so a crafted filename
        # can't inject extra response headers.
        safe_name = _sanitize_filename_for_header(original_name or "")
        return StreamingResponse(
            io.BytesIO(file_bytes),
            media_type=content_type,
            headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("download_attachment error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/{dossier_id}/attachments/{att_id}/preview")
async def preview_attachment(dossier_id: int, att_id: int, user: ErpUser = Depends(get_current_user)):
    """Serve the attachment inline (without forcing a download).

    Same payload as /download but with `Content-Disposition: inline` so
    browsers render PDFs, images, and text formats directly in-page
    via the DocumentViewer modal. Auth identical to /download — the
    tenant user must belong to the dossier's schema.

    The filename in Content-Disposition still matches the original name
    so that "Save as…" from the embedded viewer produces a sensible file.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_attachments_table(cursor)
        cursor.execute(
            "SELECT filename, original_name, content_type, file_data "
            "FROM attachments WHERE id = %s AND dossier_id = %s",
            (att_id, dossier_id),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Piece jointe non trouvée")
        content_type = row["content_type"] or "application/octet-stream"
        original_name = row["original_name"] or row["filename"]
        # psycopg2 returns BYTEA columns as `memoryview`, not `bytes`. Methods
        # like `.startswith()` don't exist on memoryview → the magic-byte
        # check below would crash with AttributeError → the endpoint would
        # return 500 Internal Server Error to the frontend, which is exactly
        # the symptom reported ("Aperçu indisponible — Impossible de charger
        # le document"). Convert explicitly to bytes up front.
        raw_data = row["file_data"]
        file_bytes = bytes(raw_data) if raw_data else b""

        # Defense against "malicious-HTML-disguised-as-PDF" uploads: if the
        # stored mime claims PDF, the first 5 bytes MUST be "%PDF-". Otherwise
        # downgrade to octet-stream so the browser won't render it via its
        # PDF viewer (and the frontend's DocumentViewer will fall back to the
        # "Télécharger" UI). Same idea for claimed images — we verify the
        # most common magic bytes. Text/HTML uploads are still served inline
        # but the frontend renders them in <pre>, not <iframe>.
        lowered = content_type.lower()
        if lowered == "application/pdf":
            if not file_bytes[:5].startswith(b"%PDF-"):
                content_type = "application/octet-stream"
        elif lowered in ("image/png",) and not file_bytes[:8].startswith(b"\x89PNG\r\n\x1a\n"):
            content_type = "application/octet-stream"
        elif lowered in ("image/jpeg", "image/jpg") and not file_bytes[:3].startswith(b"\xff\xd8\xff"):
            content_type = "application/octet-stream"
        elif lowered == "image/gif" and not (
            file_bytes[:6].startswith(b"GIF87a") or file_bytes[:6].startswith(b"GIF89a")
        ):
            content_type = "application/octet-stream"

        # Strict allow-list of MIME types we are willing to serve with
        # Content-Disposition: inline. Anything outside this list (SVG,
        # HTML, XML, XHTML, WebP, BMP, TIFF, Office formats, archives,
        # executables, etc.) is downgraded to octet-stream so the frontend
        # falls back to the "Télécharger" card instead of rendering it.
        # This is belt-and-braces on top of CSP + sandbox: SVG in particular
        # can contain <script> which would execute in certain edge cases
        # (direct tab open, legacy browsers) even with our headers.
        INLINE_ALLOWED = {
            "application/pdf",
            "image/png", "image/jpeg", "image/jpg", "image/gif",
            "text/plain", "text/csv", "application/json",
            "application/octet-stream",
        }
        if content_type.lower().split(";")[0].strip() not in INLINE_ALLOWED:
            content_type = "application/octet-stream"

        # Escape characters that could break the Content-Disposition header.
        # A malicious filename like `a".html\r\nX-Foo: bar` would otherwise
        # inject extra headers (CRLF injection).
        safe_name = _sanitize_filename_for_header(original_name or "")
        return StreamingResponse(
            io.BytesIO(file_bytes),
            media_type=content_type,
            headers={
                "Content-Disposition": f'inline; filename="{safe_name}"',
                # Block browser content-type sniffing — combined with the
                # magic-byte check above, this prevents a non-PDF file from
                # being auto-detected and rendered as HTML.
                "X-Content-Type-Options": "nosniff",
                # Defense-in-depth CSP for the preview payload. The frontend
                # fetches this as a blob (XHR), so these directives only
                # apply if the URL is opened directly — belt-and-braces.
                "Content-Security-Policy": "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; script-src 'none'",
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("preview_attachment error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/{dossier_id}/attachments/{att_id}")
async def delete_attachment(dossier_id: int, att_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete an attachment."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_attachments_table(cursor)
        cursor.execute(
            "DELETE FROM attachments WHERE id = %s AND dossier_id = %s",
            (att_id, dossier_id),
        )
        conn.commit()
        return {"message": "Piece jointe supprimée"}
    except Exception as exc:
        logger.error("delete_attachment error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# ETAPES (Checklist steps)
# ============================================

@router.get("/{dossier_id}/etapes")
async def list_dossier_etapes(dossier_id: int, user: ErpUser = Depends(get_current_user)):
    """List checklist steps for a dossier."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_etapes_table(cursor)
        cursor.execute(
            "SELECT * FROM dossier_etapes WHERE dossier_id = %s ORDER BY ordre, id",
            (dossier_id,),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("created_at", "completed_at"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)
        return {"items": items}
    except Exception as exc:
        logger.error("list_dossier_etapes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/{dossier_id}/etapes")
async def create_dossier_etape(dossier_id: int, body: EtapeCreate, user: ErpUser = Depends(get_current_user)):
    """Create a checklist step for a dossier."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_etapes_table(cursor)
        cursor.execute(
            "INSERT INTO dossier_etapes (dossier_id, titre, description, ordre) "
            "VALUES (%s, %s, %s, %s) RETURNING id",
            (dossier_id, body.titre, body.description, body.ordre),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Étape créée"}
    except Exception as exc:
        logger.error("create_dossier_etape error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/{dossier_id}/etapes/{etape_id}/toggle")
async def toggle_etape(dossier_id: int, etape_id: int, user: ErpUser = Depends(get_current_user)):
    """Toggle etape completion status."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_etapes_table(cursor)
        cursor.execute(
            "UPDATE dossier_etapes SET "
            "statut = CASE WHEN statut = 'COMPLETE' THEN 'EN_ATTENTE' ELSE 'COMPLETE' END, "
            "completed_at = CASE WHEN statut = 'EN_ATTENTE' THEN CURRENT_TIMESTAMP ELSE NULL END, "
            "completed_by = CASE WHEN statut = 'EN_ATTENTE' THEN %s ELSE NULL END "
            "WHERE id = %s AND dossier_id = %s "
            "RETURNING id, statut, completed_at",
            # `completed_by` schema varies by tenant — str() works for both.
            (str(user.user_id), etape_id, dossier_id),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Etape non trouvée")
        conn.commit()
        d = dict(row)
        if d.get("completed_at"):
            d["completed_at"] = str(d["completed_at"])
        return d
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("toggle_etape error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# NOTES
# ============================================

@router.get("/{dossier_id}/notes")
async def list_dossier_notes(dossier_id: int, user: ErpUser = Depends(get_current_user)):
    """List notes for a dossier."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_notes_table(cursor)
        cursor.execute(
            "SELECT id, dossier_id, contenu, created_by, created_at, attachments, "
            "COALESCE(categorie, 'general') AS categorie, COALESCE(is_pinned, FALSE) AS is_pinned "
            "FROM dossier_notes WHERE dossier_id = %s "
            "ORDER BY COALESCE(is_pinned, FALSE) DESC, created_at DESC LIMIT 100",
            (dossier_id,),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            # Parse attachments JSON, strip base64 data for list (keep metadata only)
            if d.get("attachments"):
                try:
                    atts = json.loads(d["attachments"]) if isinstance(d["attachments"], str) else d["attachments"]
                    d["attachments"] = [{"nom": a.get("nom"), "type": a.get("type"), "taille": a.get("taille")} for a in atts]
                except Exception:
                    d["attachments"] = []
            else:
                d["attachments"] = []
            items.append(d)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_dossier_notes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/{dossier_id}/notes")
async def create_dossier_note(dossier_id: int, body: NoteCreate, user: ErpUser = Depends(get_current_user)):
    """Create a note for a dossier."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_notes_table(cursor)
        cursor.execute(
            "INSERT INTO dossier_notes (dossier_id, contenu, created_by) "
            "VALUES (%s, %s, %s) RETURNING id",
            # `created_by` schema varies by tenant — str() works for both
            # INTEGER and TEXT columns via PG unknown-type casting.
            (dossier_id, body.contenu, str(user.user_id)),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Note créée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_dossier_note error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/{dossier_id}/notes-with-files")
async def create_dossier_note_with_files(
    dossier_id: int,
    contenu: str = Form(...),
    files: List[UploadFile] = File(default=[]),
    user: ErpUser = Depends(get_current_user),
):
    """Create a note with optional file attachments (max 10 files, 15MB each)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_notes_table(cursor)

        # Process file attachments
        attachments_json = None
        if files:
            att_list = []
            for f in files[:10]:  # max 10 files
                content = await f.read()
                if len(content) > 15 * 1024 * 1024:
                    continue  # skip files > 15MB
                att_list.append({
                    "nom": f.filename or "fichier",
                    "type": f.content_type or "application/octet-stream",
                    "taille": len(content),
                    "data_base64": base64.b64encode(content).decode("utf-8"),
                })
            if att_list:
                attachments_json = json.dumps(att_list)

        cursor.execute(
            "INSERT INTO dossier_notes (dossier_id, contenu, created_by, attachments, created_at) "
            "VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP) RETURNING id",
            # `created_by` schema varies by tenant — str() works for both
            # INTEGER and TEXT columns via PG unknown-type casting.
            (dossier_id, contenu, str(user.user_id), attachments_json),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Note creee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_dossier_note_with_files error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la note")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/{dossier_id}/notes/{note_id}/attachment/{att_index}")
async def download_note_attachment(dossier_id: int, note_id: int, att_index: int, user: ErpUser = Depends(get_current_user)):
    """Download a specific attachment from a note."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT attachments FROM dossier_notes WHERE id = %s AND dossier_id = %s",
            (note_id, dossier_id),
        )
        row = cursor.fetchone()
        if not row or not row.get("attachments"):
            raise HTTPException(status_code=404, detail="Note ou piece jointe non trouvee")
        atts = json.loads(row["attachments"]) if isinstance(row["attachments"], str) else row["attachments"]
        if att_index < 0 or att_index >= len(atts):
            raise HTTPException(status_code=404, detail="Piece jointe non trouvee")
        att = atts[att_index]
        content = base64.b64decode(att.get("data_base64", ""))
        return StreamingResponse(
            io.BytesIO(content),
            media_type=att.get("type", "application/octet-stream"),
            headers={"Content-Disposition": f'attachment; filename="{att.get("nom", "fichier")}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("download_note_attachment error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/{dossier_id}/notes/{note_id}")
async def delete_dossier_note(dossier_id: int, note_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a note from a dossier."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM dossier_notes WHERE id = %s AND dossier_id = %s",
            (note_id, dossier_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Note non trouvee")
        conn.commit()
        return {"message": "Note supprimee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_dossier_note error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# LIENS (cliquables)
# ============================================


@router.get("/{dossier_id}/liens")
async def list_dossier_liens(dossier_id: int, user: ErpUser = Depends(get_current_user)):
    """List cliquable links for a dossier."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _verify_dossier_exists_in_tenant(cursor, dossier_id)
        _ensure_liens_table(cursor)
        conn.commit()
        cursor.execute(
            "SELECT id, dossier_id, url, description, created_by, created_at, updated_at "
            "FROM dossier_liens WHERE dossier_id = %s "
            "ORDER BY created_at DESC LIMIT 500",
            (dossier_id,),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            if d.get("updated_at"):
                d["updated_at"] = str(d["updated_at"])
            items.append(d)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_dossier_liens error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/{dossier_id}/liens")
async def create_dossier_lien(dossier_id: int, body: LienCreate, user: ErpUser = Depends(get_current_user)):
    """Create a cliquable link for a dossier."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    url = _validate_lien_url(body.url)
    description = _clean_lien_description(body.description)
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _verify_dossier_exists_in_tenant(cursor, dossier_id)
        _ensure_liens_table(cursor)
        cursor.execute(
            "INSERT INTO dossier_liens (dossier_id, url, description, created_by) "
            "VALUES (%s, %s, %s, %s) RETURNING id",
            (dossier_id, url, description, str(user.user_id)),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Lien cree"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_dossier_lien error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/{dossier_id}/liens/{lien_id}")
async def update_dossier_lien(
    dossier_id: int,
    lien_id: int,
    body: LienUpdate,
    user: ErpUser = Depends(get_current_user),
):
    """Update a cliquable link."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    sets = []
    params: list = []
    if body.url is not None:
        sets.append("url = %s")
        params.append(_validate_lien_url(body.url))
    if body.description is not None:
        sets.append("description = %s")
        params.append(_clean_lien_description(body.description))
    if not sets:
        raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
    sets.append("updated_at = CURRENT_TIMESTAMP")
    params.extend([lien_id, dossier_id])
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _verify_dossier_exists_in_tenant(cursor, dossier_id)
        _ensure_liens_table(cursor)
        cursor.execute(
            f"UPDATE dossier_liens SET {', '.join(sets)} "
            f"WHERE id = %s AND dossier_id = %s",
            params,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Lien non trouve")
        conn.commit()
        return {"message": "Lien mis a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_dossier_lien error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/{dossier_id}/liens/{lien_id}")
async def delete_dossier_lien(
    dossier_id: int,
    lien_id: int,
    user: ErpUser = Depends(get_current_user),
):
    """Delete a cliquable link."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _verify_dossier_exists_in_tenant(cursor, dossier_id)
        _ensure_liens_table(cursor)
        cursor.execute(
            "DELETE FROM dossier_liens WHERE id = %s AND dossier_id = %s",
            (lien_id, dossier_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Lien non trouve")
        conn.commit()
        return {"message": "Lien supprime"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_dossier_lien error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# NOTES — AI FEATURES
# ============================================


def _parse_ai_json(raw: str) -> dict:
    """Parse JSON from Claude response, handling ```json blocks."""
    raw = raw.strip()
    if raw.startswith('```'):
        raw = raw.split('\n', 1)[1] if '\n' in raw else raw[3:]
        raw = raw.strip()
        if raw.endswith('```'):
            raw = raw[:-3].strip()
    return json.loads(raw)


def _ai_track_and_deduct(user: ErpUser, feature: str, tokens_in: int, tokens_out: int):
    """Track AI usage and deduct credits. Non-blocking."""
    try:
        from .ai import track_ai_usage, _deduct_credits
        cost = (tokens_in * 0.003 + tokens_out * 0.015) / 1000 * 1.30
        duration_ms = 0
        track_ai_usage(user, feature, tokens_in, tokens_out, cost, duration_ms, success=True)
        _deduct_credits(user, cost)
    except Exception as exc:
        logger.warning("_ai_track_and_deduct error: %s", exc)


@router.post("/{dossier_id}/notes/ai/enrich")
async def ai_enrich_note(dossier_id: int, body: NoteCreate, user: ErpUser = Depends(get_current_user)):
    """Enrich a note with AI: professional text, category, actions."""
    if not _anthropic_client:
        raise HTTPException(status_code=503, detail="Service IA non disponible")
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    from .ai import check_ai_guard, _check_credits
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")
    credits_ok, _ = _check_credits(user)
    if not credits_ok:
        raise HTTPException(status_code=402, detail="Credits IA epuises")

    # Get dossier title for context
    dossier_titre = ""
    conn = db.get_conn()
    try:
        db.set_tenant(conn, user.schema)
        cur = conn.cursor()
        cur.execute("SELECT titre FROM dossiers WHERE id = %s", (dossier_id,))
        row = cur.fetchone()
        if row:
            dossier_titre = dict(row).get("titre", "")
        cur.close()
    except Exception:
        pass
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()

    context = f"Dossier: {dossier_titre}" if dossier_titre else ""
    prompt = f"""Enrichis cette note de chantier en une note professionnelle et structuree.

NOTE BRUTE: "{body.contenu}"
{context}

Reponds en JSON STRICT avec cette structure:
{{
  "contenu_enrichi": "La note enrichie, structuree et professionnelle (utilise **gras** pour les titres de sections)",
  "categorie": "une parmi: defaut, observation, progression, decision, action, general",
  "actions": ["action 1 a suivre", "action 2 si applicable"]
}}

REGLES pour la categorie:
- "defaut" = probleme, non-conformite, deficience, bris
- "observation" = constatation neutre, inspection, verification
- "progression" = avancement des travaux, etape completee
- "decision" = choix fait, approbation, modification au plan
- "action" = tache a faire, suivi requis, rappel
- "general" = autre (salutation, commentaire general)

Reponds UNIQUEMENT le JSON, sans texte additionnel."""

    try:
        response = _anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            system=_NOTE_AI_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=32000,
            temperature=0.3,
        )
        tokens_in = response.usage.input_tokens
        tokens_out = response.usage.output_tokens
        _ai_track_and_deduct(user, "note_enrich", tokens_in, tokens_out)

        raw = response.content[0].text.strip() if response.content else ""
        data = _parse_ai_json(raw)
        cat = data.get("categorie", "general")
        if cat not in _NOTE_CATEGORIES:
            cat = "general"

        return {
            "contenuEnrichi": data.get("contenu_enrichi", body.contenu),
            "categorie": cat,
            "actions": data.get("actions", []),
            "tokensInput": tokens_in,
            "tokensOutput": tokens_out,
        }
    except json.JSONDecodeError:
        return {"contenuEnrichi": raw if raw else body.contenu, "categorie": "general", "actions": [], "tokensInput": 0, "tokensOutput": 0}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("ai_enrich_note error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur du service IA")


@router.post("/{dossier_id}/notes/ai/analyze-photo")
async def ai_analyze_photo(
    dossier_id: int,
    file: UploadFile = File(...),
    contexte: Optional[str] = Form(None),
    user: ErpUser = Depends(get_current_user),
):
    """Analyze a construction site photo with Claude Vision."""
    if not _anthropic_client:
        raise HTTPException(status_code=503, detail="Service IA non disponible")
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    from .ai import check_ai_guard, _check_credits
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")
    credits_ok, _ = _check_credits(user)
    if not credits_ok:
        raise HTTPException(status_code=402, detail="Credits IA epuises")

    file_data = await file.read()
    if len(file_data) == 0:
        raise HTTPException(status_code=400, detail="Fichier vide")
    if len(file_data) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Fichier trop volumineux (max 15 Mo)")

    # FIX: file.content_type est attaquant-controle. Detecter le vrai type
    # via magic bytes pour eviter erreur 400 Anthropic "image/png declared
    # but appears to be image/jpeg" si le client ment sur le Content-Type.
    from .ai import _detect_media_type_from_bytes
    detected = _detect_media_type_from_bytes(file_data)
    if not detected:
        raise HTTPException(
            status_code=400,
            detail="Format image non reconnu (PNG, JPEG, GIF, WebP, BMP requis).",
        )
    media_type = detected
    image_b64 = base64.b64encode(file_data).decode("utf-8")

    # Get dossier title
    dossier_titre = ""
    conn = db.get_conn()
    try:
        db.set_tenant(conn, user.schema)
        cur = conn.cursor()
        cur.execute("SELECT titre FROM dossiers WHERE id = %s", (dossier_id,))
        row = cur.fetchone()
        if row:
            dossier_titre = dict(row).get("titre", "")
        cur.close()
    except Exception:
        pass
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()

    extra = ""
    if contexte:
        extra += f"\nContexte: {contexte}"
    if dossier_titre:
        extra += f"\nDossier: {dossier_titre}"

    prompt = f"""Analyse cette photo de chantier de construction et genere une note professionnelle.
{extra}

Reponds en JSON STRICT avec cette structure:
{{
  "contenu_enrichi": "Description detaillee et professionnelle de ce qui est visible sur la photo.",
  "categorie": "une parmi: defaut, observation, progression, decision, action, general",
  "actions": ["action 1 si applicable", "action 2 si applicable"]
}}

REGLES:
- Decris objectivement (materiaux, etat, travaux en cours/completes)
- Identifie les problemes potentiels (defauts, non-conformites, risques securite)
- Note la progression des travaux si visible
- Utilise le vocabulaire construction quebecois

Reponds UNIQUEMENT le JSON."""

    try:
        response = _anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            system=_NOTE_AI_SYSTEM,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                    {"type": "text", "text": prompt},
                ],
            }],
            max_tokens=32000,
            temperature=0.3,
        )
        tokens_in = response.usage.input_tokens
        tokens_out = response.usage.output_tokens
        _ai_track_and_deduct(user, "note_analyze_photo", tokens_in, tokens_out)

        raw = response.content[0].text.strip() if response.content else ""
        data = _parse_ai_json(raw)
        cat = data.get("categorie", "observation")
        if cat not in _NOTE_CATEGORIES:
            cat = "observation"

        return {
            "contenuEnrichi": data.get("contenu_enrichi", ""),
            "categorie": cat,
            "actions": data.get("actions", []),
            "tokensInput": tokens_in,
            "tokensOutput": tokens_out,
        }
    except json.JSONDecodeError:
        return {"contenuEnrichi": raw if raw else "Analyse non disponible.", "categorie": "observation", "actions": [], "tokensInput": 0, "tokensOutput": 0}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("ai_analyze_photo error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur du service IA")


@router.post("/{dossier_id}/notes/ai/summary")
async def ai_summarize_notes(dossier_id: int, user: ErpUser = Depends(get_current_user)):
    """AI-powered summary of all notes in a dossier."""
    if not _anthropic_client:
        raise HTTPException(status_code=503, detail="Service IA non disponible")
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    from .ai import check_ai_guard, _check_credits
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")
    credits_ok, _ = _check_credits(user)
    if not credits_ok:
        raise HTTPException(status_code=402, detail="Credits IA epuises")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_notes_table(cursor)

        # Dossier info
        cursor.execute("""
            SELECT d.titre, d.statut, d.priorite, d.type_dossier,
                   d.date_ouverture, d.date_echeance
            FROM dossiers d WHERE d.id = %s
        """, (dossier_id,))
        dossier = cursor.fetchone()
        if not dossier:
            raise HTTPException(status_code=404, detail="Dossier introuvable")
        dossier = dict(dossier)

        # Notes
        cursor.execute("""
            SELECT contenu, COALESCE(categorie, 'general') AS categorie,
                   COALESCE(is_pinned, FALSE) AS is_pinned,
                   created_at, created_by
            FROM dossier_notes WHERE dossier_id = %s
            ORDER BY created_at ASC
        """, (dossier_id,))
        notes = [dict(r) for r in cursor.fetchall()]
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("ai_summarize_notes load error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur chargement notes")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()

    if not notes:
        return {"resume": "Aucune note dans ce dossier.", "problemesOuverts": [], "actionsEnAttente": [], "nbNotesAnalysees": 0, "tokensInput": 0, "tokensOutput": 0}

    notes_text = ""
    for i, n in enumerate(notes, 1):
        date_str = str(n["created_at"])[:16] if n.get("created_at") else "?"
        cat_str = f" [{n['categorie']}]" if n.get("categorie") else ""
        pin_str = " [EPINGLEE]" if n.get("is_pinned") else ""
        notes_text += f"\n{i}. ({date_str}, {n.get('created_by', 'Inconnu')}{cat_str}{pin_str}) {n['contenu']}"

    dossier_info = f"""Dossier: {dossier.get('titre', 'N/A')}
Statut: {dossier.get('statut', 'N/A')}
Priorite: {dossier.get('priorite', 'N/A')}
Date ouverture: {dossier.get('date_ouverture', 'N/A')}
Date echeance: {dossier.get('date_echeance', 'N/A')}"""

    prompt = f"""Genere un resume intelligent et complet de ce dossier de construction base sur toutes les notes.

{dossier_info}

NOTES ({len(notes)} total):
{notes_text}

Reponds en JSON STRICT avec cette structure:
{{
  "resume": "Resume structure et complet. Utilise **gras** pour les titres de sections.",
  "problemes_ouverts": ["probleme 1 non resolu", "probleme 2"],
  "actions_en_attente": ["action 1 a faire", "action 2 a faire"]
}}

REGLES:
- Resume clair pour un gestionnaire de chantier
- Identifie tendances et patterns
- Distingue problemes resolus vs ouverts
- Liste les actions concretes en attente
- Mentionne les dates cles

Reponds UNIQUEMENT le JSON."""

    try:
        response = _anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            system=_NOTE_AI_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=32000,
            temperature=0.3,
        )
        tokens_in = response.usage.input_tokens
        tokens_out = response.usage.output_tokens
        _ai_track_and_deduct(user, "note_summary", tokens_in, tokens_out)

        raw = response.content[0].text.strip() if response.content else ""
        data = _parse_ai_json(raw)

        return {
            "resume": data.get("resume", ""),
            "problemesOuverts": data.get("problemes_ouverts", []),
            "actionsEnAttente": data.get("actions_en_attente", []),
            "nbNotesAnalysees": len(notes),
            "tokensInput": tokens_in,
            "tokensOutput": tokens_out,
        }
    except json.JSONDecodeError:
        return {"resume": raw if raw else "Erreur format reponse IA.", "problemesOuverts": [], "actionsEnAttente": [], "nbNotesAnalysees": len(notes), "tokensInput": 0, "tokensOutput": 0}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("ai_summarize_notes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur du service IA")


@router.patch("/{dossier_id}/notes/{note_id}/pin")
async def toggle_note_pin(dossier_id: int, note_id: int, user: ErpUser = Depends(get_current_user)):
    """Toggle pin state on a note."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_notes_table(cursor)
        cursor.execute(
            "UPDATE dossier_notes SET is_pinned = NOT COALESCE(is_pinned, FALSE) "
            "WHERE id = %s AND dossier_id = %s RETURNING is_pinned",
            (note_id, dossier_id),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note non trouvee")
        conn.commit()
        return {"isPinned": dict(row)["is_pinned"]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("toggle_note_pin error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.patch("/{dossier_id}/notes/{note_id}/categorie")
async def update_note_categorie(dossier_id: int, note_id: int, body: dict, user: ErpUser = Depends(get_current_user)):
    """Update note category."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    cat = body.get("categorie", "general")
    if cat not in _NOTE_CATEGORIES:
        cat = "general"
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_notes_table(cursor)
        cursor.execute(
            "UPDATE dossier_notes SET categorie = %s WHERE id = %s AND dossier_id = %s",
            (cat, note_id, dossier_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Note non trouvee")
        conn.commit()
        return {"categorie": cat}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_note_categorie error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# LINKED ITEMS (Elements lies)
# ============================================

@router.get("/{dossier_id}/linked")
async def get_dossier_linked_items(dossier_id: int, user: ErpUser = Depends(get_current_user)):
    """Get all items linked to a dossier via linking tables + project_id."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_link_tables(cursor)
        conn.commit()

        cursor.execute("SELECT project_id FROM dossiers WHERE id = %s", (dossier_id,))
        dossier = cursor.fetchone()
        if not dossier:
            raise HTTPException(status_code=404, detail="Dossier non trouvé")
        project_id = dossier.get("project_id")

        # Helper to safely query a table
        def _safe_query(sql, params=()):
            try:
                cursor.execute(sql, params)
                return [dict(r) for r in cursor.fetchall()]
            except Exception:
                conn.rollback()
                return []

        # Projets: from dossier_projets + direct project_id
        projets = _safe_query(
            "SELECT DISTINCT p.id, p.nom_projet, p.statut FROM projects p "
            "WHERE p.id IN (SELECT project_id FROM dossier_projets WHERE dossier_id = %s) "
            "OR p.id = %s",
            (dossier_id, project_id or 0),
        )

        # Devis: from dossier_devis + via project_id
        devis_list = _safe_query(
            "SELECT DISTINCT d.id, d.numero_devis, d.nom_projet, d.statut FROM devis d "
            "WHERE d.id IN (SELECT devis_id FROM dossier_devis WHERE dossier_id = %s) "
            "OR (%s IS NOT NULL AND d.project_id = %s) LIMIT 20",
            (dossier_id, project_id, project_id or 0),
        )

        # Bons de travail: from dossier_formulaires + via project_id
        bons_travail = _safe_query(
            "SELECT DISTINCT f.id, f.numero_document, f.nom, f.statut FROM formulaires f "
            "WHERE (f.id IN (SELECT formulaire_id FROM dossier_formulaires WHERE dossier_id = %s) "
            "OR (%s IS NOT NULL AND f.project_id = %s)) "
            "AND f.type_formulaire = 'BON_TRAVAIL' LIMIT 20",
            (dossier_id, project_id, project_id or 0),
        )

        # Bons de commande: from dossier_achats
        bons_commande = _safe_query(
            "SELECT DISTINCT bc.id, bc.numero, bc.statut, bc.montant_total "
            "FROM bons_commande bc "
            "WHERE bc.id IN (SELECT achat_id FROM dossier_achats WHERE dossier_id = %s) "
            "OR (%s IS NOT NULL AND bc.project_id = %s) LIMIT 20",
            (dossier_id, project_id, project_id or 0),
        )

        # Factures: from dossier_factures
        factures = _safe_query(
            "SELECT DISTINCT f.id, f.numero_facture, f.client_nom, f.montant_total, f.statut "
            "FROM factures f "
            "WHERE f.id IN (SELECT facture_id FROM dossier_factures WHERE dossier_id = %s) LIMIT 20",
            (dossier_id,),
        )

        return {
            "projets": projets, "devis": devis_list, "bons_travail": bons_travail,
            "bons_commande": bons_commande, "factures": factures,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_dossier_linked_items error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# FICHE 360 - Vue complete du dossier
# ============================================

@router.get("/{dossier_id}/360")
async def get_dossier_360(dossier_id: int, user: ErpUser = Depends(get_current_user)):
    """Get the full 360 view of a dossier: opportunity, devis, project, BTs, factures, pointage, comptabilite."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        try:
            from .crm import run_opportunity_migrations
            run_opportunity_migrations(conn, user.schema)
        except Exception:
            pass
        cursor = conn.cursor()

        # 1. Get the dossier itself
        cursor.execute(
            "SELECT d.*, c.nom as client_nom FROM dossiers d "
            "LEFT JOIN companies c ON d.company_id = c.id "
            "WHERE d.id = %s",
            (dossier_id,),
        )
        dossier = cursor.fetchone()
        if not dossier:
            raise HTTPException(status_code=404, detail="Dossier non trouvé")
        dossier = dict(dossier)
        for k in ("created_at", "updated_at", "date_ouverture", "date_fermeture"):
            if dossier.get(k):
                dossier[k] = str(dossier[k])

        # 2. Find the linked opportunity (via dossier_id on opportunities)
        opportunity = None
        try:
            cursor.execute(
                "SELECT o.id, o.nom, o.numero_opportunite, o.statut, o.montant_estime, "
                "o.probabilite, o.source, o.date_cloture_prevue, o.devis_id, o.projet_id, "
                "o.created_at, c.nom as company_nom "
                "FROM opportunities o "
                "LEFT JOIN companies c ON o.company_id = c.id "
                "WHERE o.dossier_id = %s",
                (dossier_id,),
            )
            opp_row = cursor.fetchone()
            if opp_row:
                opportunity = dict(opp_row)
                for k in ("created_at", "date_cloture_prevue"):
                    if opportunity.get(k):
                        opportunity[k] = str(opportunity[k])
        except Exception:
            pass

        # --- Ensure link tables exist ---
        try:
            _ensure_link_tables(cursor)
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass

        # --- Build lookup IDs from dossier + opportunity + association tables ---
        dossier_project_id = dossier.get("project_id")
        dossier_company_id = dossier.get("company_id")
        opp_id = opportunity.get("id") if opportunity else None
        opp_devis_id = opportunity.get("devis_id") if opportunity else None
        opp_projet_id = opportunity.get("projet_id") if opportunity else None

        # 3. Get linked projects (via dossier.project_id + opportunity + association table)
        projets = []
        project_ids = []
        try:
            conditions = []
            params = []
            if dossier_project_id:
                conditions.append("p.id = %s")
                params.append(dossier_project_id)
            if opp_projet_id:
                conditions.append("p.id = %s")
                params.append(opp_projet_id)
            if dossier_company_id:
                conditions.append("p.client_company_id = %s")
                params.append(dossier_company_id)
                conditions.append("p.company_id = %s")
                params.append(dossier_company_id)
            # Association table
            conditions.append("p.id IN (SELECT project_id FROM dossier_projets WHERE dossier_id = %s)")
            params.append(dossier_id)
            if conditions:
                where = " OR ".join(conditions)
                cursor.execute(
                    f"SELECT DISTINCT p.id, p.nom_projet, p.statut, p.priorite, p.budget_total, "
                    f"p.date_debut_reel, p.date_fin_reel, p.date_prevu, p.created_at "
                    f"FROM projects p WHERE ({where}) ORDER BY p.created_at DESC",
                    params,
                )
                for row in cursor.fetchall():
                    d = dict(row)
                    if d["id"] not in project_ids:
                        project_ids.append(d["id"])
                        for k in ("date_debut_reel", "date_fin_reel", "date_prevu"):
                            if d.get(k):
                                d[k] = str(d[k])
                        projets.append(d)
        except Exception:
            pass

        # 4. Get linked devis (via opportunity_id, project_id, company_id, association table)
        devis_list = []
        try:
            conditions = []
            params = []
            if opp_id:
                conditions.append("d.opportunity_id = %s")
                params.append(opp_id)
            if opp_devis_id:
                conditions.append("d.id = %s")
                params.append(opp_devis_id)
            if dossier_project_id:
                conditions.append("d.project_id = %s")
                params.append(dossier_project_id)
            if dossier_company_id:
                conditions.append("d.client_company_id = %s")
                params.append(dossier_company_id)
            for pid in project_ids:
                conditions.append("d.project_id = %s")
                params.append(pid)
            # Association table
            conditions.append("d.id IN (SELECT devis_id FROM dossier_devis WHERE dossier_id = %s)")
            params.append(dossier_id)
            if conditions:
                where = " OR ".join(conditions)
                cursor.execute(
                    f"SELECT DISTINCT d.id, d.numero_devis, d.nom_projet, d.statut, "
                    f"d.total_travaux, d.tps, d.tvq, d.investissement_total, "
                    f"d.created_at, d.updated_at "
                    f"FROM devis d WHERE ({where}) ORDER BY d.created_at DESC",
                    params,
                )
                seen = set()
                for row in cursor.fetchall():
                    d = dict(row)
                    if d["id"] not in seen:
                        seen.add(d["id"])
                        for k in ("created_at", "updated_at"):
                            if d.get(k):
                                d[k] = str(d[k])
                        devis_list.append(d)
        except Exception:
            pass

        # 5. Get linked bons de travail (via project_id + association table)
        bons_travail = []
        try:
            all_pids = list(set(project_ids + ([int(dossier_project_id)] if dossier_project_id else [])))
            conditions = []
            params_bt: list = []
            if all_pids:
                placeholders = ",".join(["%s"] * len(all_pids))
                conditions.append(f"f.project_id IN ({placeholders})")
                params_bt.extend(all_pids)
            conditions.append("f.id IN (SELECT formulaire_id FROM dossier_formulaires WHERE dossier_id = %s)")
            params_bt.append(dossier_id)
            where_bt = " OR ".join(conditions)
            cursor.execute(
                f"SELECT DISTINCT f.id, f.numero_document, f.nom, f.statut, f.priorite, "
                f"f.montant_total, f.date_echeance, f.created_at "
                f"FROM formulaires f "
                f"WHERE ({where_bt}) AND f.type_formulaire = 'BON_TRAVAIL' "
                f"ORDER BY f.created_at DESC",
                params_bt,
            )
            for row in cursor.fetchall():
                d = dict(row)
                for k in ("created_at", "date_echeance"):
                    if d.get(k):
                        d[k] = str(d[k])
                bons_travail.append(d)
        except Exception:
            pass

        # 6. Get factures (via project_id, company_id, association table)
        factures = []
        try:
            conditions = []
            params = []
            all_pids = list(set(project_ids + ([int(dossier_project_id)] if dossier_project_id else [])))
            if all_pids:
                placeholders = ",".join(["%s"] * len(all_pids))
                conditions.append(f"f.project_id IN ({placeholders})")
                params.extend(all_pids)
            if dossier_company_id:
                conditions.append("f.client_company_id = %s")
                params.append(dossier_company_id)
                conditions.append("f.company_id = %s")
                params.append(dossier_company_id)
            conditions.append("f.id IN (SELECT facture_id FROM dossier_factures WHERE dossier_id = %s)")
            params.append(dossier_id)
            if conditions:
                where = " OR ".join(conditions)
                cursor.execute(
                    f"SELECT DISTINCT f.id, f.numero_facture, f.client_nom, f.statut, "
                    f"f.montant_ht, f.montant_ttc, f.montant_paye, f.solde_du, "
                    f"f.date_facture, f.date_echeance "
                    f"FROM factures f WHERE ({where}) ORDER BY f.date_facture DESC",
                    params,
                )
                for row in cursor.fetchall():
                    d = dict(row)
                    for k in ("date_facture", "date_echeance"):
                        if d.get(k):
                            d[k] = str(d[k])
                    for k in ("montant_ht", "montant_ttc", "montant_paye", "solde_du"):
                        if d.get(k) is not None:
                            d[k] = float(d[k])
                    factures.append(d)
        except Exception:
            pass

        # 7. Get pointage (time entries for linked projects)
        pointage = []
        if project_ids:
            try:
                placeholders = ",".join(["%s"] * len(project_ids))
                cursor.execute(
                    f"SELECT te.id, te.employee_id, te.project_id, te.punch_in, te.punch_out, "
                    f"te.total_hours, COALESCE(e.taux_horaire, e.salaire, 0) as hourly_rate, "
                    f"COALESCE(te.total_hours * COALESCE(e.taux_horaire, e.salaire, 0), 0) as total_cost, "
                    f"te.notes, te.type_travail, "
                    f"te.validated, e.prenom, e.nom "
                    f"FROM time_entries te "
                    f"LEFT JOIN employees e ON te.employee_id = e.id "
                    f"WHERE te.project_id IN ({placeholders}) "
                    f"ORDER BY te.punch_in DESC NULLS LAST LIMIT 100",
                    project_ids,
                )
                for row in cursor.fetchall():
                    d = dict(row)
                    for k in ("punch_in", "punch_out"):
                        if d.get(k):
                            d[k] = str(d[k])
                    pointage.append(d)
            except Exception:
                pass

        # 8. Get bons de commande (via project_id + dossier_achats)
        bons_commande = []
        try:
            all_pids = list(set(project_ids + ([int(dossier_project_id)] if dossier_project_id else [])))
            conditions = []
            params_bc = []
            if all_pids:
                placeholders = ",".join(["%s"] * len(all_pids))
                conditions.append(f"bc.project_id IN ({placeholders})")
                params_bc.extend(all_pids)
            conditions.append("bc.id IN (SELECT achat_id FROM dossier_achats WHERE dossier_id = %s)")
            params_bc.append(dossier_id)
            where = " OR ".join(conditions)
            cursor.execute(
                f"SELECT DISTINCT bc.id, bc.numero, bc.statut, "
                f"bc.montant_total, bc.date_commande, bc.date_livraison_prevue "
                f"FROM bons_commande bc WHERE {where} "
                f"ORDER BY bc.date_commande DESC",
                params_bc,
            )
            for row in cursor.fetchall():
                d = dict(row)
                for k in ("date_commande", "date_livraison_prevue"):
                    if d.get(k):
                        d[k] = str(d[k])
                for k in ("montant_total",):
                    if d.get(k) is not None:
                        d[k] = float(d[k])
                bons_commande.append(d)
        except Exception:
            pass

        # 9. Get demandes de prix (formulaires type DEMANDE_PRIX via project_id)
        demandes_prix = []
        try:
            all_pids = list(set(project_ids + ([int(dossier_project_id)] if dossier_project_id else [])))
            if all_pids:
                placeholders = ",".join(["%s"] * len(all_pids))
                cursor.execute(
                    f"SELECT f.id, f.numero_document, f.nom, f.statut, f.priorite, "
                    f"f.montant_total, f.date_echeance, f.created_at "
                    f"FROM formulaires f "
                    f"WHERE f.project_id IN ({placeholders}) AND f.type_formulaire = 'DEMANDE_PRIX' "
                    f"ORDER BY f.created_at DESC",
                    all_pids,
                )
                for row in cursor.fetchall():
                    d = dict(row)
                    for k in ("created_at", "date_echeance"):
                        if d.get(k):
                            d[k] = str(d[k])
                    demandes_prix.append(d)
        except Exception:
            pass

        # 10. Comptabilite summary (includes achats in costs)
        total_devis = sum(float(d.get("investissement_total") or 0) for d in devis_list)
        total_facture = sum(float(f.get("montant_ttc") or 0) for f in factures)
        total_paye = sum(float(f.get("montant_paye") or 0) for f in factures)
        total_solde_du = sum(float(f.get("solde_du") or 0) for f in factures)
        total_heures = sum(float(p.get("total_hours") or 0) for p in pointage)
        total_cout_main_oeuvre = sum(float(p.get("total_cost") or 0) for p in pointage)
        total_achats = sum(float(bc.get("total") or bc.get("montant_total") or 0) for bc in bons_commande)
        budget_total = sum(float(p.get("budget_total") or 0) for p in projets)
        total_couts = total_cout_main_oeuvre + total_achats

        comptabilite = {
            "budget_total": budget_total,
            "total_devis": total_devis,
            "total_facture": total_facture,
            "total_paye": total_paye,
            "total_solde_du": total_solde_du,
            "total_heures": round(total_heures, 2),
            "total_cout_main_oeuvre": round(total_cout_main_oeuvre, 2),
            "total_achats": round(total_achats, 2),
            "total_couts": round(total_couts, 2),
            "marge_estimee": round(total_facture - total_couts, 2),
            "nb_factures": len(factures),
            "nb_factures_payees": sum(1 for f in factures if f.get("statut") == "PAYEE"),
            "nb_factures_en_retard": sum(1 for f in factures if f.get("statut") == "EN_RETARD"),
            "nb_bons_commande": len(bons_commande),
            "nb_demandes_prix": len(demandes_prix),
        }

        # 9. Get documents/pieces jointes for this dossier
        documents = []
        try:
            cursor.execute(
                "SELECT id, fichier_nom AS nom_fichier, categorie, "
                "fichier_taille AS taille, fichier_type AS content_type, "
                "confidentiel, uploaded_at AS created_at, "
                "'dossier_documents' AS source "
                "FROM dossier_documents WHERE dossier_id = %s AND actif = TRUE "
                "ORDER BY uploaded_at DESC",
                (dossier_id,),
            )
            for row in cursor.fetchall():
                d = dict(row)
                if d.get("created_at"):
                    d["created_at"] = str(d["created_at"])
                documents.append(d)
        except Exception:
            pass
        # Also include attachments table (uploaded via ERP React)
        try:
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = current_schema() AND table_name = 'attachments')"
            )
            has_attachments = cursor.fetchone().get("exists", False)
            if has_attachments:
                cursor.execute(
                    "SELECT id, original_name AS nom_fichier, category AS categorie, "
                    "file_size AS taille, content_type, FALSE AS confidentiel, created_at, "
                    "'attachments' AS source "
                    "FROM attachments WHERE dossier_id = %s "
                    "ORDER BY created_at DESC",
                    (dossier_id,),
                )
                for row in cursor.fetchall():
                    d = dict(row)
                    if d.get("created_at"):
                        d["created_at"] = str(d["created_at"])
                    documents.append(d)
        except Exception:
            pass

        return {
            "dossier": dossier,
            "opportunite": opportunity,
            "devis": devis_list,
            "projets": projets,
            "bons_travail": bons_travail,
            "bons_commande": bons_commande,
            "demandes_prix": demandes_prix,
            "factures": factures,
            "pointage": pointage,
            "comptabilite": comptabilite,
            "documents": documents,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_dossier_360 error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement de la fiche 360")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# SHARE (Partage public par token)
# ============================================

_DOSSIER_PUBLIC_TOKENS_TABLE_ENSURED = False


def _slugify(text: str, max_length: int = 30) -> str:
    """Lowercase, strip accents, keep alphanumerics and dashes only."""
    text = unicodedata.normalize('NFKD', text or '').encode('ascii', 'ignore').decode('ascii')
    text = re.sub(r'[^\w\s-]', '', text.lower())
    text = re.sub(r'[-\s]+', '-', text).strip('-')
    return text[:max_length]


def _generate_dossier_token(titre: str) -> str:
    """Generate a human-readable token like 'maison-papineau-2026-xY9aBc...'.
    Uses 16 bytes → ~22 chars base64url for collision/brute-force resistance.
    """
    slug = _slugify(titre, 30)
    year = datetime.now().year
    unique = secrets.token_urlsafe(16)
    return f"{slug}-{year}-{unique}" if slug else f"dossier-{year}-{unique}"


def _ensure_dossier_public_tokens_table(conn):
    """Create public.dossiers_public_tokens table (tracking + multi-tenant safe). Idempotent."""
    global _DOSSIER_PUBLIC_TOKENS_TABLE_ENSURED
    if _DOSSIER_PUBLIC_TOKENS_TABLE_ENSURED:
        return
    prev_autocommit = conn.autocommit
    try:
        conn.autocommit = True
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS public.dossiers_public_tokens (
                token TEXT PRIMARY KEY,
                tenant_schema TEXT NOT NULL,
                dossier_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP,
                total_views INTEGER NOT NULL DEFAULT 0,
                total_downloads INTEGER NOT NULL DEFAULT 0,
                last_viewed_at TIMESTAMP,
                last_downloaded_at TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_dospt_tenant_dossier
            ON public.dossiers_public_tokens(tenant_schema, dossier_id)
        """)
        cursor.close()
        _DOSSIER_PUBLIC_TOKENS_TABLE_ENSURED = True
    except Exception:
        pass
    finally:
        conn.autocommit = prev_autocommit


def _register_dossier_token(conn, token: str, tenant_schema: str, dossier_id: int, expires_days: int = 90):
    """Register/replace a token in the public lookup table with expiration (90 days)."""
    _ensure_dossier_public_tokens_table(conn)
    prev_autocommit = conn.autocommit
    try:
        conn.autocommit = True
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO public.dossiers_public_tokens (token, tenant_schema, dossier_id, expires_at) "
            "VALUES (%s, %s, %s, CURRENT_TIMESTAMP + make_interval(days => %s)) "
            "ON CONFLICT (token) DO UPDATE SET "
            "tenant_schema = EXCLUDED.tenant_schema, dossier_id = EXCLUDED.dossier_id, "
            "expires_at = EXCLUDED.expires_at",
            (token, tenant_schema, dossier_id, expires_days),
        )
        cursor.close()
    except Exception:
        pass
    finally:
        conn.autocommit = prev_autocommit


def _lookup_dossier_token(conn, token: str):
    """Return (tenant_schema, dossier_id) or None if token invalid/expired."""
    _ensure_dossier_public_tokens_table(conn)
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT tenant_schema, dossier_id FROM public.dossiers_public_tokens "
            "WHERE token = %s AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)",
            (token,),
        )
        row = cursor.fetchone()
        if row:
            return row["tenant_schema"], row["dossier_id"]
        return None
    except Exception:
        return None
    finally:
        cursor.close()


def _bump_dossier_stat(conn, token: str, kind: str):
    """Increment view or download counter. kind in ('view', 'download'). Best-effort."""
    if kind not in ("view", "download"):
        return
    prev_autocommit = conn.autocommit
    try:
        conn.autocommit = True
        cursor = conn.cursor()
        if kind == "view":
            cursor.execute(
                "UPDATE public.dossiers_public_tokens "
                "SET total_views = total_views + 1, last_viewed_at = CURRENT_TIMESTAMP "
                "WHERE token = %s",
                (token,),
            )
        else:
            cursor.execute(
                "UPDATE public.dossiers_public_tokens "
                "SET total_downloads = total_downloads + 1, last_downloaded_at = CURRENT_TIMESTAMP "
                "WHERE token = %s",
                (token,),
            )
        cursor.close()
    except Exception:
        pass
    finally:
        conn.autocommit = prev_autocommit


def _fetch_token_stats(conn, tenant_schema: str, dossier_id: int):
    """Return active token info for a dossier (token, created_at, expires_at, total_views, etc.) or None."""
    _ensure_dossier_public_tokens_table(conn)
    prev_autocommit = conn.autocommit
    try:
        conn.autocommit = True
        cursor = conn.cursor()
        cursor.execute(
            "SELECT token, created_at, expires_at, total_views, total_downloads, "
            "last_viewed_at, last_downloaded_at "
            "FROM public.dossiers_public_tokens "
            "WHERE tenant_schema = %s AND dossier_id = %s "
            "AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) "
            "ORDER BY created_at DESC LIMIT 1",
            (tenant_schema, dossier_id),
        )
        row = cursor.fetchone()
        cursor.close()
        return dict(row) if row else None
    except Exception:
        return None
    finally:
        conn.autocommit = prev_autocommit


@router.post("/{dossier_id}/share")
async def generate_share_link(dossier_id: int, user: ErpUser = Depends(get_current_user)):
    """Generate (or rotate) a public share link for a dossier. 90-day expiration."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("SELECT id, titre FROM dossiers WHERE id = %s", (dossier_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Dossier non trouvé")
        titre = row.get("titre") or ""
        token = _generate_dossier_token(titre)
        _register_dossier_token(conn, token, user.schema, dossier_id, expires_days=90)
        return {
            "token": token,
            "lien": f"/dossiers/public/{token}",
            "expiration_jours": 90,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("generate_share_link error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/{dossier_id}/share")
async def revoke_share_link(dossier_id: int, user: ErpUser = Depends(get_current_user)):
    """Revoke all active share links for a dossier. Verifies ownership first."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        # Ownership check: confirm the dossier exists in this tenant's schema
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM dossiers WHERE id = %s", (dossier_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Dossier non trouvé")
        cursor.close()
        cursor = None

        _ensure_dossier_public_tokens_table(conn)
        prev_autocommit = conn.autocommit
        try:
            conn.autocommit = True
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM public.dossiers_public_tokens "
                "WHERE tenant_schema = %s AND dossier_id = %s",
                (user.schema, dossier_id),
            )
            deleted = cursor.rowcount
            cursor.close()
            cursor = None
            return {"revoked": deleted}
        finally:
            conn.autocommit = prev_autocommit
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("revoke_share_link error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            try:
                cursor.close()
            except Exception:
                pass
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/{dossier_id}/share-info")
async def get_share_info(dossier_id: int, user: ErpUser = Depends(get_current_user)):
    """Return current share link info + stats (views, downloads, last access)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    try:
        info = _fetch_token_stats(conn, user.schema, dossier_id)
        if not info:
            return {"active": False}
        return {
            "active": True,
            "token": info["token"],
            "lien": f"/dossiers/public/{info['token']}",
            "createdAt": str(info["created_at"]) if info.get("created_at") else None,
            "expiresAt": str(info["expires_at"]) if info.get("expires_at") else None,
            "totalViews": int(info.get("total_views") or 0),
            "totalDownloads": int(info.get("total_downloads") or 0),
            "lastViewedAt": str(info["last_viewed_at"]) if info.get("last_viewed_at") else None,
            "lastDownloadedAt": str(info["last_downloaded_at"]) if info.get("last_downloaded_at") else None,
        }
    except Exception as exc:
        logger.error("get_share_info error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        conn.close()


# ============================================
# PUBLIC ENDPOINTS — no authentication required
# ============================================

_TOKEN_REGEX = re.compile(r'^[a-zA-Z0-9\-_]{6,120}$')


@router.get("/public/{token}")
async def get_public_dossier(token: str):
    """Public view: dossier metadata + list of documents. No authentication."""
    if not token or not _TOKEN_REGEX.match(token):
        raise HTTPException(status_code=404, detail="Lien invalide")
    conn = db.get_conn()
    cursor = None
    try:
        lookup = _lookup_dossier_token(conn, token)
        if not lookup:
            raise HTTPException(status_code=404, detail="Lien invalide ou expiré")
        tenant_schema, dossier_id = lookup

        db.set_tenant(conn, tenant_schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, numero_dossier, titre, type_dossier, statut "
            "FROM dossiers WHERE id = %s",
            (dossier_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Dossier non trouvé")
        dossier = dict(row)

        # Fetch attachments list (no file_data)
        _ensure_attachments_table(cursor)
        cursor.execute(
            "SELECT id, original_name, content_type, file_size, category, created_at "
            "FROM attachments WHERE dossier_id = %s ORDER BY created_at DESC",
            (dossier_id,),
        )
        attachments = []
        for att in cursor.fetchall():
            a = dict(att)
            if a.get("created_at"):
                a["created_at"] = str(a["created_at"])
            attachments.append(a)

        # Enterprise name for header
        enterprise_name = ""
        try:
            from .html_utils import get_company_info
            info = get_company_info(cursor)
            enterprise_name = (info or {}).get("nom", "") or ""
        except Exception:
            pass

        _bump_dossier_stat(conn, token, "view")

        return {
            "dossier": {
                "id": dossier["id"],
                "numero": dossier.get("numero_dossier"),
                "titre": dossier.get("titre"),
                "type": dossier.get("type_dossier"),
                "statut": dossier.get("statut"),
            },
            "attachments": attachments,
            "enterpriseName": enterprise_name,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_public_dossier error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# Shared defenses for ALL file-serving endpoints (preview + public view).
# Keeps the authenticated and unauthenticated paths in lockstep so a future
# change to the security posture only needs to touch one place.

_INLINE_ALLOWED_MIME = {
    "application/pdf",
    "image/png", "image/jpeg", "image/jpg", "image/gif",
    "text/plain", "text/csv", "application/json",
    "application/octet-stream",
}


def _sanitize_filename(name: str) -> str:
    """Strip characters that could break the Content-Disposition header
    (CRLF injection) or break out of the quoted filename value."""
    return (name or "").replace('"', '').replace("\r", "").replace("\n", "")


def _verify_magic_bytes(content_type: str, file_bytes: bytes) -> str:
    """If the declared mime claims PDF/PNG/JPEG/GIF, require the matching
    magic bytes. On mismatch, return ``application/octet-stream`` so the
    browser won't render a disguised file with its image/pdf viewer."""
    lowered = (content_type or "").lower()
    if lowered == "application/pdf":
        if not file_bytes[:5].startswith(b"%PDF-"):
            return "application/octet-stream"
    elif lowered == "image/png" and not file_bytes[:8].startswith(b"\x89PNG\r\n\x1a\n"):
        return "application/octet-stream"
    elif lowered in ("image/jpeg", "image/jpg") and not file_bytes[:3].startswith(b"\xff\xd8\xff"):
        return "application/octet-stream"
    elif lowered == "image/gif" and not (
        file_bytes[:6].startswith(b"GIF87a") or file_bytes[:6].startswith(b"GIF89a")
    ):
        return "application/octet-stream"
    return content_type


def _enforce_inline_whitelist(content_type: str) -> str:
    """Downgrade anything outside the safe-for-inline-render allow-list to
    ``application/octet-stream`` (which the frontend DocumentViewer maps to
    the 'Télécharger' fallback). Excludes SVG, HTML, XML, XHTML — all
    XSS vectors — and uncommon image formats the browser may render
    inconsistently."""
    primary = (content_type or "").lower().split(";")[0].strip()
    if primary in _INLINE_ALLOWED_MIME:
        return content_type
    return "application/octet-stream"


_INLINE_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": (
        "default-src 'none'; img-src 'self' data: blob:; "
        "style-src 'unsafe-inline'; script-src 'none'"
    ),
}


@router.get("/public/{token}/attachments/{att_id}")
async def view_public_attachment(token: str, att_id: int):
    """Public inline view (browser opens the file, no download). No authentication.

    Applies the same hardening as the authenticated `/preview` endpoint:
    magic-byte verification, inline MIME allow-list, CRLF-safe
    Content-Disposition, nosniff + CSP. Critical here because the link
    can be emailed by one tenant to anyone and opened in an anonymous
    browser session — we can't rely on authenticated user context.
    """
    if not token or not _TOKEN_REGEX.match(token):
        raise HTTPException(status_code=404, detail="Lien invalide")
    conn = db.get_conn()
    cursor = None
    try:
        lookup = _lookup_dossier_token(conn, token)
        if not lookup:
            raise HTTPException(status_code=404, detail="Lien invalide ou expiré")
        tenant_schema, dossier_id = lookup

        db.set_tenant(conn, tenant_schema)
        cursor = conn.cursor()
        _ensure_attachments_table(cursor)
        cursor.execute(
            "SELECT original_name, content_type, file_data "
            "FROM attachments WHERE id = %s AND dossier_id = %s",
            (att_id, dossier_id),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Piece jointe non trouvée")
        content_type = row["content_type"] or "application/octet-stream"
        original_name = row["original_name"] or "document"
        file_bytes = bytes(row["file_data"] or b"")

        content_type = _verify_magic_bytes(content_type, file_bytes)
        content_type = _enforce_inline_whitelist(content_type)
        safe_name = _sanitize_filename(original_name)

        _bump_dossier_stat(conn, token, "view")
        return Response(
            content=file_bytes,
            media_type=content_type,
            headers={
                "Content-Disposition": f'inline; filename="{safe_name}"',
                **_INLINE_SECURITY_HEADERS,
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("view_public_attachment error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/public/{token}/attachments/{att_id}/download")
async def download_public_attachment(token: str, att_id: int):
    """Public download endpoint (force attachment). No authentication.

    `Content-Disposition: attachment` prevents the browser from rendering
    the file, so magic-byte / inline allow-list aren't critical here.
    CRLF-safe filename is still required to prevent header injection
    via a crafted original_name.
    """
    if not token or not _TOKEN_REGEX.match(token):
        raise HTTPException(status_code=404, detail="Lien invalide")
    conn = db.get_conn()
    cursor = None
    try:
        lookup = _lookup_dossier_token(conn, token)
        if not lookup:
            raise HTTPException(status_code=404, detail="Lien invalide ou expiré")
        tenant_schema, dossier_id = lookup

        db.set_tenant(conn, tenant_schema)
        cursor = conn.cursor()
        _ensure_attachments_table(cursor)
        cursor.execute(
            "SELECT original_name, content_type, file_data "
            "FROM attachments WHERE id = %s AND dossier_id = %s",
            (att_id, dossier_id),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Piece jointe non trouvée")
        content_type = row["content_type"] or "application/octet-stream"
        original_name = row["original_name"] or "document"
        safe_name = _sanitize_filename(original_name)
        _bump_dossier_stat(conn, token, "download")
        return StreamingResponse(
            io.BytesIO(bytes(row["file_data"])),
            media_type=content_type,
            headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("download_public_attachment error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================================
# DOSSIER — Link / Unlink items
# ============================================================

LINK_TABLES = {
    "devis": ("dossier_devis", "devis_id"),
    "projet": ("dossier_projets", "project_id"),
    "bon_travail": ("dossier_formulaires", "formulaire_id"),
    "bon_commande": ("dossier_achats", "achat_id"),
    "facture": ("dossier_factures", "facture_id"),
    "demande_prix": ("dossier_formulaires", "formulaire_id"),
}


def _ensure_link_tables(cursor):
    """Create association tables if they don't exist."""
    for tbl, col in LINK_TABLES.values():
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS {tbl} (
                id SERIAL PRIMARY KEY,
                dossier_id INTEGER NOT NULL,
                {col} INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(dossier_id, {col})
            )
        """)


class LinkBody(BaseModel):
    item_type: str  # devis, projet, bon_travail, bon_commande, facture
    item_id: int


@router.post("/{dossier_id}/link")
async def link_item_to_dossier(dossier_id: int, body: LinkBody, user: ErpUser = Depends(get_current_user)):
    """Link an existing item (devis, project, BT, BC, facture) to a dossier."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if body.item_type not in LINK_TABLES:
        raise HTTPException(status_code=400, detail=f"Type invalide. Valeurs: {', '.join(LINK_TABLES.keys())}")

    table_name, col_name = LINK_TABLES[body.item_type]
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_link_tables(cursor)
        cursor.execute(
            f"INSERT INTO {table_name} (dossier_id, {col_name}) VALUES (%s, %s) ON CONFLICT (dossier_id, {col_name}) DO NOTHING",
            (dossier_id, body.item_id),
        )
        conn.commit()
        return {"message": "Element lie avec succes", "dossierId": dossier_id, "itemType": body.item_type, "itemId": body.item_id}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("link_item error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la liaison")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/{dossier_id}/link/{item_type}/{item_id}")
async def unlink_item_from_dossier(dossier_id: int, item_type: str, item_id: int, user: ErpUser = Depends(get_current_user)):
    """Unlink an item from a dossier."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if item_type not in LINK_TABLES:
        raise HTTPException(status_code=400, detail="Type invalide")

    table_name, col_name = LINK_TABLES[item_type]
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            f"DELETE FROM {table_name} WHERE dossier_id = %s AND {col_name} = %s",
            (dossier_id, item_id),
        )
        conn.commit()
        return {"message": "Lien supprimé"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("unlink_item error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/{dossier_id}/linkable")
async def get_linkable_items(dossier_id: int, item_type: str = Query(...), user: ErpUser = Depends(get_current_user)):
    """Get all items of a type that can be linked (not yet linked) to a dossier."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if item_type not in LINK_TABLES:
        raise HTTPException(status_code=400, detail="Type invalide")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_link_tables(cursor)

        table_name, col_name = LINK_TABLES[item_type]
        items = []

        if item_type == "devis":
            cursor.execute(
                f"SELECT d.id, d.numero_devis, d.nom_projet, d.statut, d.investissement_total "
                f"FROM devis d WHERE d.id NOT IN (SELECT {col_name} FROM {table_name} WHERE dossier_id = %s) "
                f"ORDER BY d.created_at DESC LIMIT 50",
                (dossier_id,),
            )
            for r in cursor.fetchall():
                d = dict(r)
                items.append({"id": d["id"], "label": f"{d.get('numero_devis', '')} — {d.get('nom_projet', '')}", "statut": d.get("statut", "")})

        elif item_type == "projet":
            cursor.execute(
                f"SELECT p.id, p.nom_projet, p.statut "
                f"FROM projects p WHERE p.id NOT IN (SELECT {col_name} FROM {table_name} WHERE dossier_id = %s) "
                f"ORDER BY p.created_at DESC LIMIT 50",
                (dossier_id,),
            )
            for r in cursor.fetchall():
                d = dict(r)
                items.append({"id": d["id"], "label": d.get("nom_projet", ""), "statut": d.get("statut", "")})

        elif item_type == "bon_travail":
            cursor.execute(
                f"SELECT f.id, f.numero_document, f.nom, f.statut "
                f"FROM formulaires f WHERE f.type_formulaire = 'BON_TRAVAIL' "
                f"AND f.id NOT IN (SELECT {col_name} FROM {table_name} WHERE dossier_id = %s) "
                f"ORDER BY f.created_at DESC LIMIT 50",
                (dossier_id,),
            )
            for r in cursor.fetchall():
                d = dict(r)
                items.append({"id": d["id"], "label": f"{d.get('numero_document', '')} — {d.get('nom', '')}", "statut": d.get("statut", "")})

        elif item_type == "bon_commande":
            cursor.execute(
                f"SELECT bc.id, bc.numero, bc.statut "
                f"FROM bons_commande bc WHERE bc.id NOT IN (SELECT {col_name} FROM {table_name} WHERE dossier_id = %s) "
                f"ORDER BY bc.created_at DESC LIMIT 50",
                (dossier_id,),
            )
            for r in cursor.fetchall():
                d = dict(r)
                items.append({"id": d["id"], "label": d.get("numero", ""), "statut": d.get("statut", "")})

        elif item_type == "facture":
            cursor.execute(
                f"SELECT f.id, f.numero_facture, f.client_nom, f.statut "
                f"FROM factures f WHERE f.id NOT IN (SELECT {col_name} FROM {table_name} WHERE dossier_id = %s) "
                f"ORDER BY f.created_at DESC LIMIT 50",
                (dossier_id,),
            )
            for r in cursor.fetchall():
                d = dict(r)
                items.append({"id": d["id"], "label": f"{d.get('numero_facture', '')} — {d.get('client_nom', '')}", "statut": d.get("statut", "")})

        elif item_type == "demande_prix":
            cursor.execute(
                f"SELECT f.id, f.numero_document, f.nom, f.statut "
                f"FROM formulaires f WHERE f.type_formulaire = 'DEMANDE_PRIX' "
                f"AND f.id NOT IN (SELECT {col_name} FROM {table_name} WHERE dossier_id = %s) "
                f"ORDER BY f.created_at DESC LIMIT 50",
                (dossier_id,),
            )
            for r in cursor.fetchall():
                d = dict(r)
                items.append({"id": d["id"], "label": f"{d.get('numero_document', '')} — {d.get('nom', '')}", "statut": d.get("statut", "")})

        conn.commit()
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_linkable_items error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()
