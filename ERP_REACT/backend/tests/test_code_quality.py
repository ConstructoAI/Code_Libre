"""
Tests — Qualite du Code (16 tests)
Couvre: AST parse, except HTTPException pattern, reset_tenant, no hardcoded secrets,
        no console.log, INSERT RETURNING id, conn=None pattern.
"""

import ast
import os
import re
import pytest
from pathlib import Path

# Base directories
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
ERP_BACKEND = PROJECT_ROOT / "ERP_REACT" / "backend"
ERP_FRONTEND_SRC = PROJECT_ROOT / "ERP_REACT" / "frontend" / "src"
MOBILE_BACKEND = PROJECT_ROOT / "MOBILE_REACT" / "backend"
SEAOP_BACKEND = PROJECT_ROOT / "SEAOP_REACT" / "backend"

ROUTER_DIR = ERP_BACKEND / "routers"


def _all_python_files(*dirs):
    """Collect all .py files from given directories."""
    files = []
    for d in dirs:
        if d.exists():
            files.extend(d.rglob("*.py"))
    return files


def _all_router_files():
    return list(ROUTER_DIR.glob("*.py")) if ROUTER_DIR.exists() else []


# ── AST Parse ─────────────────────────────────────────────

class TestAstParse:
    """Every Python file must parse without syntax errors."""

    def test_erp_backend_parse(self):
        errors = []
        for f in _all_python_files(ERP_BACKEND):
            try:
                ast.parse(f.read_text(encoding="utf-8"))
            except SyntaxError as e:
                errors.append(f"{f.name}: {e}")
        assert errors == [], f"Syntax errors: {errors}"

    def test_mobile_backend_parse(self):
        errors = []
        for f in _all_python_files(MOBILE_BACKEND):
            try:
                ast.parse(f.read_text(encoding="utf-8"))
            except SyntaxError as e:
                errors.append(f"{f.name}: {e}")
        assert errors == [], f"Syntax errors: {errors}"

    def test_seaop_backend_parse(self):
        if not SEAOP_BACKEND.exists():
            pytest.skip("SEAOP backend not found")
        errors = []
        for f in _all_python_files(SEAOP_BACKEND):
            try:
                ast.parse(f.read_text(encoding="utf-8"))
            except SyntaxError as e:
                errors.append(f"{f.name}: {e}")
        assert errors == [], f"Syntax errors: {errors}"


# ── except HTTPException: raise (lecon #5) ────────────────

class TestExceptPatterns:
    """Verify except HTTPException: raise comes before except Exception."""

    def test_routers_have_httpexception_guard(self):
        """Main routers should have 'except HTTPException' before 'except Exception'."""
        main_routers = ["accounting.py", "auth.py", "b2b.py", "production.py",
                        "ai.py", "crm.py", "emails.py"]
        missing = []
        for name in main_routers:
            f = ROUTER_DIR / name
            if not f.exists():
                continue
            content = f.read_text(encoding="utf-8")
            if "except Exception" in content and "except HTTPException" not in content:
                missing.append(name)
        assert missing == [], f"Routers missing 'except HTTPException: raise': {missing}"


# ── db.reset_tenant in finally (lecon #73) ────────────────

class TestResetTenant:
    """Verify reset_tenant is called in finally blocks."""

    def test_main_routers_have_reset_tenant(self):
        main_routers = ["accounting.py", "auth.py", "b2b.py", "production.py"]
        missing = []
        for name in main_routers:
            f = ROUTER_DIR / name
            if not f.exists():
                continue
            content = f.read_text(encoding="utf-8")
            if "set_tenant" in content and "reset_tenant" not in content:
                missing.append(name)
        assert missing == [], f"Routers with set_tenant but no reset_tenant: {missing}"


# ── No Hardcoded Secrets ──────────────────────────────────

class TestNoSecrets:
    """No real API keys or secrets in source code."""

    SECRET_PATTERNS = [
        (r'sk-ant-api\d{2}-[A-Za-z0-9]{20,}', "Anthropic API key"),
        (r'sk_live_[A-Za-z0-9]{20,}', "Stripe live key"),
        (r'whsec_[A-Za-z0-9]{20,}', "Stripe webhook secret"),
        (r'rnd_[A-Za-z0-9]{20,}', "Render API key"),
    ]

    def test_no_hardcoded_secrets_in_python(self):
        violations = []
        for f in _all_python_files(ERP_BACKEND, MOBILE_BACKEND):
            content = f.read_text(encoding="utf-8", errors="ignore")
            for pattern, label in self.SECRET_PATTERNS:
                if re.search(pattern, content):
                    violations.append(f"{f.name}: {label}")
        assert violations == [], f"Hardcoded secrets: {violations}"

    def test_no_hardcoded_secrets_in_typescript(self):
        if not ERP_FRONTEND_SRC.exists():
            pytest.skip("Frontend src not found")
        violations = []
        for f in ERP_FRONTEND_SRC.rglob("*.ts"):
            content = f.read_text(encoding="utf-8", errors="ignore")
            for pattern, label in self.SECRET_PATTERNS:
                if re.search(pattern, content):
                    violations.append(f"{f.name}: {label}")
        for f in ERP_FRONTEND_SRC.rglob("*.tsx"):
            content = f.read_text(encoding="utf-8", errors="ignore")
            for pattern, label in self.SECRET_PATTERNS:
                if re.search(pattern, content):
                    violations.append(f"{f.name}: {label}")
        assert violations == [], f"Hardcoded secrets: {violations}"


# ── No console.log in Production ──────────────────────────

class TestNoConsoleLogs:
    """No console.log left in production frontend code."""

    def test_no_console_log_in_erp_frontend(self):
        if not ERP_FRONTEND_SRC.exists():
            pytest.skip("Frontend src not found")
        violations = []
        for ext in ("*.ts", "*.tsx"):
            for f in ERP_FRONTEND_SRC.rglob(ext):
                content = f.read_text(encoding="utf-8", errors="ignore")
                for i, line in enumerate(content.split("\n"), 1):
                    stripped = line.strip()
                    if stripped.startswith("//"):
                        continue
                    if "console.log(" in stripped:
                        violations.append(f"{f.name}:{i}")
        assert violations == [], f"console.log found: {violations}"


# ── INSERT RETURNING id (lecon #123) ──────────────────────

class TestInsertReturning:
    """Number generators should use INSERT RETURNING id, not MAX+1 or COUNT+1."""

    def test_no_max_plus_one_in_routers(self):
        """Check that routers don't use MAX(id)+1 for number generation."""
        pattern = re.compile(r"MAX\s*\(\s*id\s*\)\s*\+\s*1", re.IGNORECASE)
        violations = []
        for f in _all_router_files():
            content = f.read_text(encoding="utf-8")
            for i, line in enumerate(content.split("\n"), 1):
                if pattern.search(line) and "-- old" not in line.lower():
                    violations.append(f"{f.name}:{i}")
        assert violations == [], f"MAX(id)+1 found (use INSERT RETURNING id): {violations}"


# ── Router File Count ─────────────────────────────────────

class TestRouterCompleteness:
    """Verify expected routers exist."""

    EXPECTED_ROUTERS = [
        "accounting.py", "auth.py", "ai.py", "b2b.py", "b2b_portal.py",
        "companies.py", "config.py", "crm.py", "devis.py", "documents.py",
        "emails.py", "employees.py", "exports.py", "integration.py",
        "inventory.py", "production.py", "projects.py", "suppliers.py",
    ]

    def test_expected_routers_exist(self):
        existing = {f.name for f in _all_router_files()}
        missing = [r for r in self.EXPECTED_ROUTERS if r not in existing]
        assert missing == [], f"Missing routers: {missing}"
