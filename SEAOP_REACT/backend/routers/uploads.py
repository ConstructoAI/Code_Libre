"""
SEAOP React - Uploads Router
Stateless file upload endpoints that return base64-encoded file data.
Files are NOT stored in the database - the caller includes the base64
data in their lead/soumission creation payload.
"""

import logging
import base64
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Depends

from ..seaop_auth import get_optional_user, SeaopUser
from ..seaop_config import MAX_FILE_SIZE, MAX_FILES_PER_UPLOAD

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/uploads", tags=["Uploads"])

# Allowed MIME types for upload (Content-Type header — info uniquement, NON sécurité)
ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
}

# Magic bytes (file signature) → MIME canonique. Source de vérité pour bloquer
# un client qui ment dans son Content-Type (HTML/SVG/exécutable maquillé).
_MAGIC_PREFIXES: tuple = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"RIFF", "image/webp"),  # vérification supplémentaire ci-dessous
    (b"%PDF-", "application/pdf"),
    (b"PK\x03\x04", "application/zip"),  # docx, xlsx (zip-based)
    (b"PK\x05\x06", "application/zip"),
    (b"PK\x07\x08", "application/zip"),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "application/x-ole"),  # doc/xls legacy
)

# Mapping MIME magique → MIMEs Content-Type acceptables associés.
_MAGIC_TO_DECLARED = {
    "image/jpeg": {"image/jpeg"},
    "image/png": {"image/png"},
    "image/gif": {"image/gif"},
    "image/webp": {"image/webp"},
    "application/pdf": {"application/pdf"},
    "application/zip": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/zip",
    },
    "application/x-ole": {"application/msword", "application/vnd.ms-excel"},
    "text/plain": {"text/plain"},
}


def _detect_magic_mime(content: bytes) -> Optional[str]:
    """Retourne le MIME déduit des magic bytes (None si inconnu/texte ASCII)."""
    if not content:
        return None
    for prefix, mime in _MAGIC_PREFIXES:
        if content.startswith(prefix):
            if mime == "image/webp":
                # WEBP = RIFF....WEBP — confirmer le format WEBP
                if len(content) >= 12 and content[8:12] == b"WEBP":
                    return "image/webp"
                continue
            return mime
    # Texte brut : pas de magic bytes mais ASCII/UTF-8 imprimable
    try:
        sample = content[:512].decode("utf-8")
        if all(ch == "\t" or ch == "\n" or ch == "\r" or 32 <= ord(ch) < 127 for ch in sample):
            return "text/plain"
    except UnicodeDecodeError:
        return None
    return None


def _validate_file_content(content: bytes, declared_type: Optional[str]) -> str:
    """Valide via magic bytes que le contenu correspond à un type autorisé.

    Retourne le MIME canonique à utiliser (ne fait pas confiance au Content-Type
    fourni par le client). Lève HTTPException si rejeté.
    """
    detected = _detect_magic_mime(content)
    if not detected:
        raise HTTPException(
            status_code=400,
            detail="Type de fichier non identifiable ou non supporté.",
        )
    # Si le client a déclaré un Content-Type, il doit correspondre au type détecté.
    allowed_declared = _MAGIC_TO_DECLARED.get(detected, set())
    if declared_type and declared_type not in allowed_declared and declared_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Type de fichier non supporté: {declared_type}",
        )
    if detected in ("application/zip", "application/x-ole"):
        # Pour les conteneurs, on accepte si le Content-Type déclaré était un doc Office
        if not declared_type or declared_type not in allowed_declared:
            raise HTTPException(
                status_code=400,
                detail="Conteneur générique refusé — fournir un Content-Type Office valide.",
            )
        return declared_type
    return detected


async def _process_file(file: UploadFile) -> dict:
    """Read file, validate size + magic bytes, return base64 encoded result."""
    content = await file.read()

    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Fichier trop volumineux: {len(content) / (1024*1024):.1f} Mo. "
                   f"Taille maximale: {MAX_FILE_SIZE / (1024*1024):.0f} Mo.",
        )

    # Validation par magic bytes — bloque les fichiers maquillés par Content-Type.
    canonical_type = _validate_file_content(content, file.content_type)

    encoded = base64.b64encode(content).decode("utf-8")
    file_id = str(uuid.uuid4())

    return {
        "fileId": file_id,
        "filename": file.filename or "unnamed",
        "contentType": canonical_type,
        "size": len(content),
        "data": encoded,
    }


# ============================================
# SINGLE FILE UPLOAD
# ============================================

@router.post("")
async def upload_file(
    file: UploadFile = File(...),
    user: Optional[SeaopUser] = Depends(get_optional_user),
):
    """
    Upload a single file. Validates size (150MB max) and type.
    Returns {fileId, filename, contentType, size, data} where data is base64 encoded.
    The caller includes the base64 data in their lead/soumission creation.
    Stateless endpoint - nothing is stored server-side.
    Auth is optional (lead creation is public).
    """
    try:
        result = await _process_file(file)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error processing upload: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du traitement du fichier")

    logger.info(
        "File uploaded: %s (%s bytes) by %s",
        result["filename"], result["size"], user.email if user else "anonymous",
    )
    return result


# ============================================
# MULTI FILE UPLOAD
# ============================================

@router.post("/multi")
async def upload_multiple_files(
    files: List[UploadFile] = File(...),
    user: Optional[SeaopUser] = Depends(get_optional_user),
):
    """
    Upload multiple files (up to 5). Validates each file individually.
    Returns a list of {fileId, filename, contentType, size, data}.
    Auth is optional (lead creation is public).
    """
    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(
            status_code=400,
            detail=f"Trop de fichiers: {len(files)}. Maximum: {MAX_FILES_PER_UPLOAD}.",
        )

    results = []
    for file in files:
        try:
            result = await _process_file(file)
            results.append(result)
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Error processing file %s in multi-upload: %s", file.filename, exc)
            raise HTTPException(
                status_code=500,
                detail=f"Erreur lors du traitement du fichier: {file.filename}",
            )

    logger.info(
        "Multi-upload: %d files by %s",
        len(results), user.email if user else "anonymous",
    )
    return results
