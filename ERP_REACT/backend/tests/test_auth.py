"""
Tests — Authentification et JWT (10 tests)
Couvre: hash/verify password, JWT creation/decode, B2B token isolation, expiry.
"""

import hashlib
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import jwt as pyjwt
import pytest


# ── Password Hashing ───────────────────────────────────────

class TestPasswordHashing:
    """Tests for password hash and verify functions."""

    def test_hash_password_returns_bcrypt(self):
        from ERP_REACT.backend.erp_auth import hash_password
        hashed = hash_password("MonMotDePasse123!")
        assert hashed.startswith("$2b$") or hashed.startswith("$2a$")
        assert len(hashed) == 60

    def test_verify_password_correct(self):
        from ERP_REACT.backend.erp_auth import hash_password, verify_password
        pwd = "SecurePass2026!"
        hashed = hash_password(pwd)
        assert verify_password(pwd, hashed) is True

    def test_verify_password_wrong(self):
        from ERP_REACT.backend.erp_auth import hash_password, verify_password
        hashed = hash_password("CorrectPassword")
        assert verify_password("WrongPassword", hashed) is False

    def test_verify_password_empty(self):
        from ERP_REACT.backend.erp_auth import verify_password
        assert verify_password("", "$2b$12$fakehash") is False
        assert verify_password("test", "") is False

    def test_verify_sha256_legacy(self):
        from ERP_REACT.backend.erp_auth import verify_password
        pwd = "legacyPassword"
        sha256_hash = hashlib.sha256(pwd.encode("utf-8")).hexdigest()
        assert verify_password(pwd, sha256_hash) is True


# ── JWT Creation & Decode ──────────────────────────────────

class TestJWT:
    """Tests for JWT token creation and decoding."""

    def test_create_jwt_valid(self, jwt_secret):
        from ERP_REACT.backend.erp_auth import create_jwt
        token = create_jwt(user_id=1, email="test@test.ca", schema="tenant_test_abc123")
        payload = pyjwt.decode(token, jwt_secret, algorithms=["HS256"])
        assert payload["sub"] == "1"
        assert payload["email"] == "test@test.ca"
        assert payload["schema"] == "tenant_test_abc123"
        assert payload["user_type"] == "user"
        assert payload["role"] == "admin"

    def test_create_b2b_jwt_has_client_id(self, jwt_secret):
        from ERP_REACT.backend.erp_auth import create_b2b_client_jwt
        token = create_b2b_client_jwt(
            client_user_id=10, email="client@co.ca",
            schema="tenant_test_abc123", client_id=5
        )
        payload = pyjwt.decode(token, jwt_secret, algorithms=["HS256"])
        assert payload["user_type"] == "b2b_client"
        assert payload["client_id"] == 5
        assert payload["role"] == "b2b_client"

    def test_decode_jwt_valid(self, test_token):
        from ERP_REACT.backend.erp_auth import decode_jwt
        payload = decode_jwt(test_token)
        assert payload["sub"] == "1"
        assert payload["user_type"] == "user"

    def test_decode_jwt_expired_raises(self, jwt_secret):
        expired_payload = {
            "sub": "1", "email": "t@t.ca", "schema": "s",
            "iat": datetime.now(timezone.utc) - timedelta(days=10),
            "exp": datetime.now(timezone.utc) - timedelta(days=1),
        }
        token = pyjwt.encode(expired_payload, jwt_secret, algorithm="HS256")
        from ERP_REACT.backend.erp_auth import decode_jwt
        with pytest.raises(Exception) as exc_info:
            decode_jwt(token)
        assert exc_info.value.status_code == 401

    def test_decode_jwt_invalid_token(self):
        from ERP_REACT.backend.erp_auth import decode_jwt
        with pytest.raises(Exception) as exc_info:
            decode_jwt("not.a.valid.token")
        assert exc_info.value.status_code == 401
