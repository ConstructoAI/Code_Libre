"""
Constructo AI ERP — Pytest Configuration & Fixtures
Provides mock DB, test JWT tokens, and FastAPI TestClient.
"""

import os
import sys
import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone

# Ensure backend is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

# Set test environment variables BEFORE any imports
os.environ.setdefault("ERP_JWT_SECRET", "test-secret-for-pytest")
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test_db")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real")
os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_not_real")
os.environ.setdefault("STRIPE_WEBHOOK_SECRET", "whsec_test_not_real")
os.environ.setdefault("QUICKBOOKS_CLIENT_ID", "test_client_id")
os.environ.setdefault("QUICKBOOKS_CLIENT_SECRET", "test_client_secret")
os.environ.setdefault("QUICKBOOKS_REDIRECT_URI", "http://localhost/callback")
os.environ.setdefault("QUICKBOOKS_ENVIRONMENT", "sandbox")


# ── Mock DB module ──────────────────────────────────────────

class MockCursor:
    """Simulates a psycopg2 RealDictCursor."""

    def __init__(self, rows=None):
        self._rows = rows or []
        self._index = 0
        self.rowcount = len(self._rows)
        self.description = None

    def execute(self, query, params=None):
        pass

    def fetchone(self):
        if self._rows:
            return self._rows[0]
        return None

    def fetchall(self):
        return self._rows

    def close(self):
        pass


class MockConnection:
    """Simulates a psycopg2 connection."""

    def __init__(self):
        self.autocommit = True
        self._committed = False
        self._rolled_back = False

    def cursor(self, cursor_factory=None):
        return MockCursor()

    def commit(self):
        self._committed = True

    def rollback(self):
        self._rolled_back = True

    def close(self):
        pass


@pytest.fixture
def mock_conn():
    """Provide a mock DB connection."""
    return MockConnection()


@pytest.fixture
def mock_cursor():
    """Provide a mock DB cursor."""
    return MockCursor()


# ── Auth fixtures ───────────────────────────────────────────

@pytest.fixture
def jwt_secret():
    """Return the actual JWT secret used by the app (matches erp_config.JWT_SECRET)."""
    return os.environ.get("ERP_JWT_SECRET", "test-secret-for-pytest")


@pytest.fixture
def test_user_payload():
    return {
        "sub": "1",
        "email": "admin@constructiontest.ca",
        "schema": "tenant_constructi_test01",
        "role": "admin",
        "user_type": "user",
    }


@pytest.fixture
def test_b2b_payload():
    return {
        "sub": "10",
        "email": "client@entreprise.ca",
        "schema": "tenant_constructi_test01",
        "role": "b2b_client",
        "user_type": "b2b_client",
        "client_id": 5,
    }


@pytest.fixture
def test_token(test_user_payload, jwt_secret):
    """Generate a valid JWT token for testing."""
    import jwt as pyjwt
    from datetime import timedelta

    now = datetime.now(timezone.utc)
    payload = {
        **test_user_payload,
        "iat": now,
        "exp": now + timedelta(days=1),
    }
    return pyjwt.encode(payload, jwt_secret, algorithm="HS256")


@pytest.fixture
def test_b2b_token(test_b2b_payload, jwt_secret):
    """Generate a valid B2B JWT token for testing."""
    import jwt as pyjwt
    from datetime import timedelta

    now = datetime.now(timezone.utc)
    payload = {
        **test_b2b_payload,
        "iat": now,
        "exp": now + timedelta(days=1),
    }
    return pyjwt.encode(payload, jwt_secret, algorithm="HS256")


# ── Constants ───────────────────────────────────────────────

TPS_RATE = 0.05
TVQ_RATE = 0.09975
COMBINED_TAX_RATE = 1 + TPS_RATE + TVQ_RATE  # 1.14975
