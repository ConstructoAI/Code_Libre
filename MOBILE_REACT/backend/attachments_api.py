"""Router FastAPI pour le module Attachments polymorphiques.

7 endpoints sous /api/mobile/v1/attachments :
- POST   /upload/{parent_type}/{parent_id}   Upload multipart
- GET    /list/{parent_type}/{parent_id}     List metadata
- GET    /by-id/{id}                         Single metadata
- GET    /by-id/{id}/preview                 Stream (inline pour image, attachment sinon)
- GET    /by-id/{id}/download                Stream (toujours attachment)
- DELETE /by-id/{id}                         Soft delete
- PATCH  /by-id/{id}                         Rename / categorize

URLs avec prefixes verbaux (upload/list/by-id) pour eviter toute collision
de routing entre `/{parent_type}/{parent_id}` et `/{attachment_id}` (le
parent_type enum aurait leve 422 sur "by-id"). Plus REST-y aussi.

Auth : Bearer JWT pour write, Bearer | signed URL pour preview/download.
Multi-tenant : ctx.tenant_schema propage a chaque appel service.
"""

from __future__ import annotations

import logging
import re
import uuid
from typing import Optional

import psycopg2
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse

from .mobile_auth import (
    get_mobile_context, get_mobile_context_or_signed, MobileTenantContext,
)
from .mobile_models import (
    AttachmentListItem, AttachmentDetailResponse, AttachmentCreateResponse,
    AttachmentUpdateRequest, AttachmentCategory, AttachmentParentType,
)
from . import mobile_attachments_service as svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/mobile/v1/attachments", tags=["attachments"])


# Limite et whitelist sont definies dans mobile_api (helpers partages).
# Import en lazy pour eviter import circulaire au load time.
def _get_validation_helpers():
    from .mobile_api import (
        ATTACHMENT_ALLOWED_MIMES, MAX_ATTACHMENT_SIZE,
        _detect_file_mime, _extract_exif_lite, _build_download_headers,
    )
    return (ATTACHMENT_ALLOWED_MIMES, MAX_ATTACHMENT_SIZE,
            _detect_file_mime, _extract_exif_lite, _build_download_headers)


_FILENAME_SAFE_RE = re.compile(r'[\\/\x00-\x1f"]')


def _clean_filename_chars(name: Optional[str], fallback: str = "fichier") -> str:
    """Retire les caracteres dangereux (path separators, control chars, quotes)
    SANS ajouter de uuid prefix. Utilise pour PATCH (rename) et headers HTTP.
    """
    base = (name or fallback).strip()
    cleaned = _FILENAME_SAFE_RE.sub('_', base).strip('. ')[:200]
    return cleaned or fallback


def _sanitize_attachment_filename(name: Optional[str], fallback: str = "fichier") -> str:
    """Sanitisation cote upload : nettoyage + uuid prefix pour collisions.
    Ne PAS utiliser sur PATCH (creerait un double-uuid `def67890_abc12345_x.pdf`).
    """
    cleaned = _clean_filename_chars(name, fallback)
    prefix = uuid.uuid4().hex[:8]
    return f"{prefix}_{cleaned}"


def _stream_bytes(data: bytes, chunk_size: int = 65536):
    """Generator qui yield les chunks d'un BYTEA charge en RAM."""
    view = memoryview(data) if not isinstance(data, memoryview) else data
    total = len(view)
    for offset in range(0, total, chunk_size):
        yield bytes(view[offset:offset + chunk_size])


# IMPORTANT : ORDRE D'EVALUATION DES ROUTES
#
# FastAPI evalue les routes dans l'ordre de declaration. Une route
# /{parent_type}/{parent_id} declaree avant /by-id/{id} matcherait
# `/by-id/123` comme `parent_type=by-id, parent_id=123` et leverait
# 422 (by-id pas dans l'enum AttachmentParentType). Les routes
# /by-id/* DOIVENT donc venir EN PREMIER.


# ---------------------------------------------------------------------------
# GET /by-id/{attachment_id} — metadata seules (DECLARER AVANT /{parent_type}/...)
# ---------------------------------------------------------------------------

@router.post("/upload/{parent_type}/{parent_id}", response_model=AttachmentCreateResponse, status_code=201)
async def upload_attachment(
    parent_type: AttachmentParentType,
    parent_id: int,
    file: UploadFile = File(...),
    category: AttachmentCategory = Form(default=AttachmentCategory.AUTRE),
    description: Optional[str] = Form(default=None),
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Upload une piece jointe pour une entite parente (dossier, devis, BT, etc.).

    Pipeline:
      1. Validation parent_id (cohérence applicative — pas de FK polymorphique)
      2. Read content + validation taille (<= 10 MB post-decompression)
      3. Detection MIME via magic bytes (rejette si non-whitelist)
      4. Sanitization filename + uuid prefix
      5. Extraction EXIF best-effort (Pillow si dispo)
      6. INSERT + commit + hash SHA-256
    """
    (ATTACHMENT_ALLOWED_MIMES, MAX_ATTACHMENT_SIZE,
     _detect_file_mime, _extract_exif_lite, _) = _get_validation_helpers()

    if not svc._validate_parent_exists(ctx.tenant_schema, parent_type.value, parent_id):
        raise HTTPException(status_code=404, detail=f"{parent_type.value} #{parent_id} introuvable")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide")
    if len(content) > MAX_ATTACHMENT_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Fichier trop volumineux (max {MAX_ATTACHMENT_SIZE // (1024*1024)} Mo)",
        )

    mime_actual = _detect_file_mime(content)
    if not mime_actual or mime_actual not in ATTACHMENT_ALLOWED_MIMES:
        logger.info(
            "[ATTACHMENTS] Refus MIME pour upload (declared=%s, detected=%s) employee=%s",
            file.content_type, mime_actual, ctx.employee_id,
        )
        raise HTTPException(
            status_code=415,
            detail="Type de fichier non supporte (autorise : JPEG, PNG, WebP, HEIC, PDF, DOCX, XLSX)",
        )

    safe_filename = _sanitize_attachment_filename(file.filename)
    original_filename = (file.filename or "")[:255]
    exif = _extract_exif_lite(content, mime_actual)

    try:
        row = svc.create_attachment(
            schema_name=ctx.tenant_schema,
            parent_type=parent_type.value,
            parent_id=parent_id,
            file_data=content,
            filename=safe_filename,
            original_filename=original_filename,
            mime_actual=mime_actual,
            mime_declared=file.content_type,
            size_bytes=len(content),
            category=category.value,
            uploaded_by=ctx.employee_id,
            exif_data=exif,
            description=description,
        )
    except psycopg2.errors.CheckViolation as exc:
        logger.warning("[ATTACHMENTS] CHECK violation upload (%s/%s): %s",
                       parent_type.value, parent_id, exc)
        raise HTTPException(status_code=400, detail="Donnees invalides (categorie/taille)")
    except Exception:
        logger.error("[ATTACHMENTS] Erreur upload (%s/%s)", parent_type.value, parent_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors de l'enregistrement")

    return AttachmentCreateResponse(
        id=row['id'],
        filename=row['filename'],
        size_bytes=row['size_bytes'],
        mime_type=row['mime_type'],
    )


# ---------------------------------------------------------------------------
# GET /{parent_type}/{parent_id} — listing
# ---------------------------------------------------------------------------

@router.get("/list/{parent_type}/{parent_id}", response_model=list[AttachmentListItem])
async def list_attachments(
    parent_type: AttachmentParentType,
    parent_id: int,
    category: Optional[AttachmentCategory] = Query(default=None),
    include_deleted: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Liste les pieces jointes d'une entite (sans le BYTEA — bande passante)."""
    rows = svc.list_attachments(
        schema_name=ctx.tenant_schema,
        parent_type=parent_type.value,
        parent_id=parent_id,
        category=category.value if category else None,
        include_deleted=include_deleted,
        limit=limit,
        offset=offset,
    )
    return [AttachmentListItem(**r) for r in rows]


# ---------------------------------------------------------------------------
# GET /{id} — metadata seules
# ---------------------------------------------------------------------------

@router.get("/by-id/{attachment_id}", response_model=AttachmentDetailResponse)
async def get_attachment(
    attachment_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    meta = svc.get_attachment_meta(ctx.tenant_schema, attachment_id)
    if not meta or meta.get('deleted_at') is not None:
        raise HTTPException(status_code=404, detail="Piece jointe introuvable")
    # Retirer 'deleted_at' du response (non expose au client)
    meta.pop('deleted_at', None)
    return AttachmentDetailResponse(**meta)


# ---------------------------------------------------------------------------
# GET /{id}/preview — stream inline (image) ou attachment (autres)
# ---------------------------------------------------------------------------

@router.get("/by-id/{attachment_id}/preview")
async def preview_attachment(
    attachment_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context_or_signed),
):
    """Stream le contenu d'une piece jointe — inline pour images whitelist,
    attachment pour PDF/Office (anti-XSS). Accepte Bearer ou signed URL.
    """
    (*_, _build_download_headers) = _get_validation_helpers()
    result = svc.get_attachment_bytes(ctx.tenant_schema, attachment_id)
    if not result:
        raise HTTPException(status_code=404, detail="Piece jointe introuvable")
    data, meta = result
    headers = _build_download_headers(meta['original_filename'] or meta['filename'], meta['mime_type'])
    headers['Content-Length'] = str(meta['size_bytes'])
    return StreamingResponse(
        _stream_bytes(data),
        media_type=meta['mime_type'],
        headers=headers,
    )


# ---------------------------------------------------------------------------
# GET /{id}/download — toujours attachment
# ---------------------------------------------------------------------------

@router.get("/by-id/{attachment_id}/download")
async def download_attachment(
    attachment_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context_or_signed),
):
    """Force le telechargement (Content-Disposition: attachment toujours).

    Identique au preview mais override le disposition pour eviter rendering
    inline meme sur images (utile pour l'experience 'Save As' du client).
    """
    (*_, _build_download_headers) = _get_validation_helpers()
    result = svc.get_attachment_bytes(ctx.tenant_schema, attachment_id)
    if not result:
        raise HTTPException(status_code=404, detail="Piece jointe introuvable")
    data, meta = result
    # Force attachment via faux content_type — le helper choisit attachment
    # quand le type n'est pas dans la whitelist images. Mais ici on veut
    # FORCER attachment meme pour image (l'utilisateur a cliqué Telecharger).
    # Sanitization stricte du filename : CRLF/quotes/path separators bloques
    # pour eviter Content-Disposition header injection.
    safe_name = _clean_filename_chars(meta['original_filename'] or meta['filename'])
    headers = {
        "Content-Disposition": f'attachment; filename="{safe_name}"',
        "Content-Length": str(meta['size_bytes']),
        "Referrer-Policy": "no-referrer",
    }
    return StreamingResponse(
        _stream_bytes(data),
        media_type=meta['mime_type'],
        headers=headers,
    )


# ---------------------------------------------------------------------------
# DELETE /{id} — soft delete
# ---------------------------------------------------------------------------

@router.delete("/by-id/{attachment_id}", status_code=204)
async def delete_attachment(
    attachment_id: int,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Soft delete (deleted_at + deleted_by). 404 si deja supprime."""
    ok = svc.soft_delete_attachment(ctx.tenant_schema, attachment_id, ctx.employee_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Piece jointe introuvable ou deja supprimee")
    return None


# ---------------------------------------------------------------------------
# PATCH /{id} — rename / category / description
# ---------------------------------------------------------------------------

@router.patch("/by-id/{attachment_id}", response_model=AttachmentDetailResponse)
async def update_attachment(
    attachment_id: int,
    body: AttachmentUpdateRequest,
    ctx: MobileTenantContext = Depends(get_mobile_context),
):
    """Met a jour filename / categorie / description (jamais file_data)."""
    # PATCH : pas de uuid prefix (eviterait `def67890_abc12345_plan.pdf`)
    safe_filename = (
        _clean_filename_chars(body.filename) if body.filename else None
    )
    updated = svc.update_attachment(
        schema_name=ctx.tenant_schema,
        attachment_id=attachment_id,
        filename=safe_filename,
        category=body.category.value if body.category else None,
        description=body.description,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Piece jointe introuvable ou supprimee")
    updated.pop('deleted_at', None)
    return AttachmentDetailResponse(**updated)
