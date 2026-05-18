"""Tests Phase 2 - Module Attachments polymorphiques.

Couvre :
- _detect_file_mime (magic bytes pour JPEG, PNG, PDF, HEIC, ZIP/DOCX)
- _sanitize_attachment_filename (path traversal, control chars, uuid prefix)
- Endpoints upload/list/get/preview/download/delete/patch (mocks service)
- Validation taille / MIME / parent inexistant
- Tenant isolation

Pas de vraie DB requise — mobile_attachments_service est mocke.
"""

import io
import zipfile
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from MOBILE_REACT.backend.mobile_api import (
    app, _detect_file_mime, MAX_ATTACHMENT_SIZE,
)
from MOBILE_REACT.backend.attachments_api import (
    _sanitize_attachment_filename, _clean_filename_chars,
)
from MOBILE_REACT.backend.mobile_auth import create_token, MobileTenantContext


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def employe_token():
    return create_token("tenant_test_xyz", 42, "Test Employe", role="EMPLOYE")


@pytest.fixture
def jpeg_bytes():
    """Mini-JPEG valide (magic bytes JPEG suffisent pour _detect_file_mime)."""
    return b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00' + b'\x00' * 500


@pytest.fixture
def png_bytes():
    return b'\x89PNG\r\n\x1a\n' + b'\x00' * 500


@pytest.fixture
def pdf_bytes():
    return b'%PDF-1.4\n%fake pdf content for test\n' + b'\x00' * 500


@pytest.fixture
def docx_bytes():
    """Mini-DOCX (ZIP container avec word/document.xml)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        zf.writestr('word/document.xml', '<?xml version="1.0"?><document/>')
        zf.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types/>')
    return buf.getvalue()


@pytest.fixture
def heic_bytes():
    """Faux HEIC : 'ftypheic' a offset 4."""
    return b'\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic' + b'\x00' * 500


# ─────────────────────────────────────────────────────────────────────────────
# Tests unitaires : _detect_file_mime
# ─────────────────────────────────────────────────────────────────────────────

class TestDetectFileMime:
    def test_jpeg(self, jpeg_bytes):
        assert _detect_file_mime(jpeg_bytes) == 'image/jpeg'

    def test_png(self, png_bytes):
        assert _detect_file_mime(png_bytes) == 'image/png'

    def test_pdf(self, pdf_bytes):
        assert _detect_file_mime(pdf_bytes) == 'application/pdf'

    def test_heic(self, heic_bytes):
        assert _detect_file_mime(heic_bytes) == 'image/heic'

    def test_docx_via_zipfile_introspection(self, docx_bytes):
        assert _detect_file_mime(docx_bytes) == (
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )

    def test_unknown_returns_none(self):
        # Bytes random qui ne matchent aucun magic
        assert _detect_file_mime(b'\x00\x01\x02\x03\x04random garbage') is None

    def test_empty_returns_none(self):
        assert _detect_file_mime(b'') is None

    def test_too_short_returns_none(self):
        assert _detect_file_mime(b'\xff\xd8') is None  # JPEG header tronque

    def test_pdf_with_jpg_extension_still_detected_as_pdf(self, pdf_bytes):
        """Magic bytes priment sur l'extension — c'est le but du detect."""
        # Le fichier a l'extension .jpg cote client mais c'est un PDF.
        # _detect_file_mime ne regarde QUE les bytes -> 'application/pdf'.
        assert _detect_file_mime(pdf_bytes) == 'application/pdf'


# ─────────────────────────────────────────────────────────────────────────────
# Tests unitaires : sanitization filename
# ─────────────────────────────────────────────────────────────────────────────

class TestSanitizeAttachmentFilename:
    def test_uuid_prefix_added(self):
        result = _sanitize_attachment_filename("photo.jpg")
        # uuid hex 8 chars + _ + photo.jpg
        assert result.endswith("_photo.jpg")
        assert len(result) > len("photo.jpg")

    def test_path_separators_replaced(self):
        result = _sanitize_attachment_filename("../../../etc/passwd")
        # Le filename apres prefix uuid ne contient ni / ni \
        suffix = result.split("_", 1)[1]
        assert "/" not in suffix
        assert "\\" not in suffix

    def test_control_chars_replaced(self):
        result = _sanitize_attachment_filename("file\r\nname.pdf")
        assert "\r" not in result
        assert "\n" not in result

    def test_double_quote_replaced(self):
        result = _sanitize_attachment_filename('foo"bar.pdf')
        assert '"' not in result

    def test_empty_falls_back(self):
        result = _sanitize_attachment_filename("")
        assert result.endswith("_fichier")

    def test_only_dots_falls_back(self):
        result = _sanitize_attachment_filename("...")
        assert "fichier" in result

    def test_long_name_truncated(self):
        long_name = "a" * 500 + ".pdf"
        result = _sanitize_attachment_filename(long_name)
        # uuid prefix (9 chars) + 200 max base = ~209 chars max
        assert len(result) <= 220


# ─────────────────────────────────────────────────────────────────────────────
# Tests endpoint POST upload
# ─────────────────────────────────────────────────────────────────────────────

class TestUploadEndpoint:
    def test_requires_auth(self, client, jpeg_bytes):
        response = client.post(
            "/api/mobile/v1/attachments/upload/dossier/1",
            files={"file": ("photo.jpg", jpeg_bytes, "image/jpeg")},
        )
        assert response.status_code == 401

    def test_rejects_oversize(self, client, employe_token):
        oversize = b'\xff\xd8\xff' + b'\x00' * (MAX_ATTACHMENT_SIZE + 1)
        with patch("MOBILE_REACT.backend.attachments_api.svc._validate_parent_exists",
                   return_value=True):
            response = client.post(
                "/api/mobile/v1/attachments/upload/dossier/1",
                headers={"Authorization": f"Bearer {employe_token}"},
                files={"file": ("big.jpg", oversize, "image/jpeg")},
            )
        assert response.status_code == 413

    def test_rejects_empty_file(self, client, employe_token):
        with patch("MOBILE_REACT.backend.attachments_api.svc._validate_parent_exists",
                   return_value=True):
            response = client.post(
                "/api/mobile/v1/attachments/upload/dossier/1",
                headers={"Authorization": f"Bearer {employe_token}"},
                files={"file": ("empty.jpg", b"", "image/jpeg")},
            )
        assert response.status_code == 400

    def test_rejects_unknown_mime(self, client, employe_token):
        """Un .exe (PE header MZ) est refuse car non-whitelist."""
        exe_bytes = b'MZ\x90\x00' + b'\x00' * 1000
        with patch("MOBILE_REACT.backend.attachments_api.svc._validate_parent_exists",
                   return_value=True):
            response = client.post(
                "/api/mobile/v1/attachments/upload/dossier/1",
                headers={"Authorization": f"Bearer {employe_token}"},
                files={"file": ("evil.exe", exe_bytes, "application/octet-stream")},
            )
        assert response.status_code == 415

    def test_rejects_parent_not_exists(self, client, employe_token, jpeg_bytes):
        with patch("MOBILE_REACT.backend.attachments_api.svc._validate_parent_exists",
                   return_value=False):
            response = client.post(
                "/api/mobile/v1/attachments/upload/dossier/99999",
                headers={"Authorization": f"Bearer {employe_token}"},
                files={"file": ("photo.jpg", jpeg_bytes, "image/jpeg")},
            )
        assert response.status_code == 404

    def test_happy_path_jpeg(self, client, employe_token, jpeg_bytes):
        with patch("MOBILE_REACT.backend.attachments_api.svc._validate_parent_exists",
                   return_value=True), \
             patch("MOBILE_REACT.backend.attachments_api.svc.create_attachment",
                   return_value={
                       'id': 42, 'filename': 'abc123_photo.jpg',
                       'size_bytes': len(jpeg_bytes), 'mime_type': 'image/jpeg',
                       'uploaded_at': '2026-05-17T00:00:00',
                   }):
            response = client.post(
                "/api/mobile/v1/attachments/upload/dossier/1",
                headers={"Authorization": f"Bearer {employe_token}"},
                files={"file": ("photo.jpg", jpeg_bytes, "image/jpeg")},
                data={"category": "PHOTO"},
            )
        assert response.status_code == 201
        body = response.json()
        assert body['id'] == 42
        assert body['mime_type'] == 'image/jpeg'

    def test_happy_path_pdf(self, client, employe_token, pdf_bytes):
        with patch("MOBILE_REACT.backend.attachments_api.svc._validate_parent_exists",
                   return_value=True), \
             patch("MOBILE_REACT.backend.attachments_api.svc.create_attachment",
                   return_value={
                       'id': 43, 'filename': 'abc123_devis.pdf',
                       'size_bytes': len(pdf_bytes), 'mime_type': 'application/pdf',
                       'uploaded_at': '2026-05-17T00:00:00',
                   }):
            response = client.post(
                "/api/mobile/v1/attachments/upload/devis/5",
                headers={"Authorization": f"Bearer {employe_token}"},
                files={"file": ("devis.pdf", pdf_bytes, "application/pdf")},
            )
        assert response.status_code == 201

    def test_invalid_parent_type_returns_422(self, client, employe_token, jpeg_bytes):
        """parent_type pas dans l'enum → 422 Unprocessable Entity (Pydantic)."""
        response = client.post(
            "/api/mobile/v1/attachments/upload/invalid_type/1",
            headers={"Authorization": f"Bearer {employe_token}"},
            files={"file": ("photo.jpg", jpeg_bytes, "image/jpeg")},
        )
        assert response.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# Tests endpoints GET list / single / preview / download
# ─────────────────────────────────────────────────────────────────────────────

class TestListGetEndpoints:
    def test_list_returns_items(self, client, employe_token):
        from datetime import datetime
        with patch("MOBILE_REACT.backend.attachments_api.svc.list_attachments",
                   return_value=[{
                       'id': 1, 'parent_type': 'dossier', 'parent_id': 1,
                       'filename': 'abc_photo.jpg', 'original_filename': 'photo.jpg',
                       'mime_type': 'image/jpeg', 'size_bytes': 500, 'category': 'PHOTO',
                       'uploaded_by': 42, 'uploaded_by_name': 'Test User',
                       'uploaded_at': datetime(2026, 5, 17, 12, 0, 0),
                   }]):
            response = client.get(
                "/api/mobile/v1/attachments/list/dossier/1",
                headers={"Authorization": f"Bearer {employe_token}"},
            )
        assert response.status_code == 200
        body = response.json()
        assert len(body) == 1
        assert body[0]['filename'] == 'abc_photo.jpg'

    def test_get_single_404_if_not_found(self, client, employe_token):
        with patch("MOBILE_REACT.backend.attachments_api.svc.get_attachment_meta",
                   return_value=None):
            response = client.get(
                "/api/mobile/v1/attachments/by-id/9999",
                headers={"Authorization": f"Bearer {employe_token}"},
            )
        assert response.status_code == 404

    def test_get_single_404_if_soft_deleted(self, client, employe_token):
        from datetime import datetime
        with patch("MOBILE_REACT.backend.attachments_api.svc.get_attachment_meta",
                   return_value={
                       'id': 1, 'parent_type': 'dossier', 'parent_id': 1,
                       'filename': 'x', 'original_filename': 'x', 'mime_type': 'image/jpeg',
                       'size_bytes': 100, 'category': 'PHOTO', 'uploaded_by': 42,
                       'uploaded_by_name': 'X', 'uploaded_at': datetime.utcnow(),
                       'deleted_at': datetime.utcnow(),
                   }):
            response = client.get(
                "/api/mobile/v1/attachments/by-id/1",
                headers={"Authorization": f"Bearer {employe_token}"},
            )
        assert response.status_code == 404


class TestPreviewDownload:
    def test_preview_streams_content(self, client, employe_token, jpeg_bytes):
        with patch("MOBILE_REACT.backend.attachments_api.svc.get_attachment_bytes",
                   return_value=(jpeg_bytes, {
                       'id': 1, 'filename': 'photo.jpg', 'original_filename': 'photo.jpg',
                       'mime_type': 'image/jpeg', 'size_bytes': len(jpeg_bytes),
                   })):
            response = client.get(
                "/api/mobile/v1/attachments/by-id/1/preview",
                headers={"Authorization": f"Bearer {employe_token}"},
            )
        assert response.status_code == 200
        assert response.content == jpeg_bytes
        # JPEG dans whitelist images → inline
        assert response.headers["content-disposition"].startswith("inline;")

    def test_preview_pdf_forces_attachment(self, client, employe_token, pdf_bytes):
        with patch("MOBILE_REACT.backend.attachments_api.svc.get_attachment_bytes",
                   return_value=(pdf_bytes, {
                       'id': 1, 'filename': 'devis.pdf', 'original_filename': 'devis.pdf',
                       'mime_type': 'application/pdf', 'size_bytes': len(pdf_bytes),
                   })):
            response = client.get(
                "/api/mobile/v1/attachments/by-id/1/preview",
                headers={"Authorization": f"Bearer {employe_token}"},
            )
        assert response.status_code == 200
        assert response.headers["content-disposition"].startswith("attachment;")

    def test_download_always_attachment_even_for_image(self, client, employe_token, jpeg_bytes):
        """/download force attachment meme pour les images."""
        with patch("MOBILE_REACT.backend.attachments_api.svc.get_attachment_bytes",
                   return_value=(jpeg_bytes, {
                       'id': 1, 'filename': 'photo.jpg', 'original_filename': 'photo.jpg',
                       'mime_type': 'image/jpeg', 'size_bytes': len(jpeg_bytes),
                   })):
            response = client.get(
                "/api/mobile/v1/attachments/by-id/1/download",
                headers={"Authorization": f"Bearer {employe_token}"},
            )
        assert response.status_code == 200
        assert response.headers["content-disposition"].startswith("attachment;")
        assert response.headers["content-length"] == str(len(jpeg_bytes))

    def test_download_404_if_not_found(self, client, employe_token):
        with patch("MOBILE_REACT.backend.attachments_api.svc.get_attachment_bytes",
                   return_value=None):
            response = client.get(
                "/api/mobile/v1/attachments/by-id/9999/download",
                headers={"Authorization": f"Bearer {employe_token}"},
            )
        assert response.status_code == 404


class TestDeletePatch:
    def test_soft_delete_204(self, client, employe_token):
        with patch("MOBILE_REACT.backend.attachments_api.svc.soft_delete_attachment",
                   return_value=True):
            response = client.delete(
                "/api/mobile/v1/attachments/by-id/1",
                headers={"Authorization": f"Bearer {employe_token}"},
            )
        assert response.status_code == 204

    def test_delete_404_if_already_deleted(self, client, employe_token):
        with patch("MOBILE_REACT.backend.attachments_api.svc.soft_delete_attachment",
                   return_value=False):
            response = client.delete(
                "/api/mobile/v1/attachments/by-id/1",
                headers={"Authorization": f"Bearer {employe_token}"},
            )
        assert response.status_code == 404

    def test_patch_rename(self, client, employe_token):
        from datetime import datetime
        with patch("MOBILE_REACT.backend.attachments_api.svc.update_attachment",
                   return_value={
                       'id': 1, 'parent_type': 'dossier', 'parent_id': 1,
                       'filename': 'abc_renamed.jpg', 'original_filename': 'photo.jpg',
                       'mime_type': 'image/jpeg', 'size_bytes': 500, 'category': 'PHOTO',
                       'uploaded_by': 42, 'uploaded_by_name': 'X',
                       'uploaded_at': datetime.utcnow(),
                       'description': 'updated', 'exif_data': None, 'file_hash': None,
                   }):
            response = client.patch(
                "/api/mobile/v1/attachments/by-id/1",
                headers={"Authorization": f"Bearer {employe_token}"},
                json={"filename": "renamed.jpg", "description": "updated"},
            )
        assert response.status_code == 200
        body = response.json()
        assert 'renamed' in body['filename']


# ─────────────────────────────────────────────────────────────────────────────
# R2 fixes — tests de regression Round 2
# ─────────────────────────────────────────────────────────────────────────────

class TestCleanFilenameChars:
    """Tests directs de _clean_filename_chars (anti-CRLF header injection)."""

    def test_removes_crlf_injection(self):
        # CRLF dans le filename pourrait permettre HTTP header injection
        result = _clean_filename_chars("legit.pdf\r\nX-Malicious: header")
        assert "\r" not in result
        assert "\n" not in result

    def test_removes_path_separators(self):
        result = _clean_filename_chars("../../etc/passwd")
        assert "/" not in result
        assert "\\" not in result

    def test_no_uuid_prefix(self):
        # Difference critique avec _sanitize_attachment_filename:
        # _clean_filename_chars ne doit PAS ajouter de uuid prefix
        # (sinon double-uuid sur PATCH rename).
        result = _clean_filename_chars("plan.pdf")
        assert result == "plan.pdf"

    def test_empty_fallback(self):
        assert _clean_filename_chars("") == "fichier"
        assert _clean_filename_chars(None) == "fichier"

    def test_only_dangerous_chars_fallback(self):
        # Apres sub('_', ...) reste "___" puis strip('. ') -> "___" (le _ pas dans strip)
        result = _clean_filename_chars('/\\"')
        # Au moins, pas de char dangereux et longueur raisonnable
        assert '"' not in result
        assert "/" not in result
        assert "\\" not in result


class TestSignedUrlAttachmentsWhitelist:
    """R2-1: verifier que /attachments/by-id/* est dans _SIGNABLE_PATH_PREFIXES."""

    def test_signed_url_accepts_attachment_preview_path(self, client, employe_token):
        response = client.post(
            "/api/mobile/v1/auth/signed-url",
            headers={"Authorization": f"Bearer {employe_token}"},
            json={"path": "/api/mobile/v1/attachments/by-id/42/preview", "ttl_seconds": 300},
        )
        assert response.status_code == 200
        body = response.json()
        assert "sig=" in body["url"]

    def test_signed_url_accepts_attachment_download_path(self, client, employe_token):
        response = client.post(
            "/api/mobile/v1/auth/signed-url",
            headers={"Authorization": f"Bearer {employe_token}"},
            json={"path": "/api/mobile/v1/attachments/by-id/99/download", "ttl_seconds": 300},
        )
        assert response.status_code == 200

    def test_signed_url_still_rejects_auth_pin(self, client, employe_token):
        # Defense en profondeur : ne pas pouvoir signer un POST sensible
        response = client.post(
            "/api/mobile/v1/auth/signed-url",
            headers={"Authorization": f"Bearer {employe_token}"},
            json={"path": "/api/mobile/v1/auth/pin", "ttl_seconds": 300},
        )
        assert response.status_code == 400


class TestRequireRoleRBAC:
    """R2-7: tests directs de la factory require_role (sync via asyncio.run)."""

    def test_factory_returns_callable_dependency(self):
        from MOBILE_REACT.backend.mobile_api import require_role
        dep = require_role("ADMIN")
        assert callable(dep)

    def test_require_role_accepts_admin(self):
        import asyncio
        from MOBILE_REACT.backend.mobile_api import require_role
        ctx = MobileTenantContext("tenant_x", 1, "Admin", role="ADMIN")
        dep = require_role("ADMIN")
        result = asyncio.run(dep(ctx=ctx))
        assert result is ctx

    def test_require_role_rejects_employe_on_admin(self):
        import asyncio
        from MOBILE_REACT.backend.mobile_api import require_role
        from fastapi import HTTPException
        ctx = MobileTenantContext("tenant_x", 2, "Emp", role="EMPLOYE")
        dep = require_role("ADMIN")
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(dep(ctx=ctx))
        assert exc_info.value.status_code == 403

    def test_require_role_accepts_multiple_allowed(self):
        import asyncio
        from MOBILE_REACT.backend.mobile_api import require_role
        ctx = MobileTenantContext("tenant_x", 3, "Mgr", role="MANAGER")
        dep = require_role("ADMIN", "MANAGER")
        result = asyncio.run(dep(ctx=ctx))
        assert result.role == "MANAGER"

    def test_require_role_rejects_apprenti(self):
        import asyncio
        from MOBILE_REACT.backend.mobile_api import require_role
        from fastapi import HTTPException
        ctx = MobileTenantContext("tenant_x", 4, "App", role="APPRENTI")
        dep = require_role("ADMIN", "MANAGER", "EMPLOYE")
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(dep(ctx=ctx))
        assert exc_info.value.status_code == 403


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
