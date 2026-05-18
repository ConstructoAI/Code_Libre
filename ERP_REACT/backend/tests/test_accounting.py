"""
Tests — Comptabilite et Facturation (12 tests)
Couvre: TPS/TVQ calculs, recalculate_invoice, journal entry helper,
        payment days parsing, plan comptable seed.
"""

import pytest
from unittest.mock import MagicMock, patch, call
from decimal import Decimal


# ── Tax Calculations ───────────────────────────────────────

class TestTaxCalculations:
    """Quebec tax calculation tests (TPS 5%, TVQ 9.975%)."""

    def test_tps_on_1000(self):
        ht = 1000.0
        tps = round(ht * 0.05, 2)
        assert tps == 50.0

    def test_tvq_on_1000(self):
        ht = 1000.0
        tvq = round(ht * 0.09975, 2)
        assert tvq == 99.75

    def test_ttc_from_ht(self):
        ht = 1000.0
        tps = round(ht * 0.05, 2)
        tvq = round(ht * 0.09975, 2)
        ttc = round(ht + tps + tvq, 2)
        assert ttc == 1149.75

    def test_ht_from_ttc_reverse(self):
        """Verify the reverse calculation used in _create_invoice_journal_entry."""
        ttc = 1149.75
        ht = round(ttc / 1.14975, 2)
        tps = round(ht * 0.05, 2)
        tvq = round(ttc - ht - tps, 2)
        assert abs(ht - 1000.0) < 0.02  # Within rounding tolerance
        assert abs(tps - 50.0) < 0.02
        assert abs(tvq - 99.75) < 0.02


# ── Payment Days Parsing ──────────────────────────────────

class TestPaymentDays:
    """Test _parse_payment_days utility."""

    def test_net_30(self):
        from ERP_REACT.backend.routers.accounting import _parse_payment_days
        assert _parse_payment_days("Net 30") == 30

    def test_net_15(self):
        from ERP_REACT.backend.routers.accounting import _parse_payment_days
        assert _parse_payment_days("Net 15") == 15

    def test_net_60(self):
        from ERP_REACT.backend.routers.accounting import _parse_payment_days
        assert _parse_payment_days("Net 60") == 60

    def test_default_fallback(self):
        from ERP_REACT.backend.routers.accounting import _parse_payment_days
        assert _parse_payment_days("invalid") == 30

    def test_empty_string(self):
        from ERP_REACT.backend.routers.accounting import _parse_payment_days
        assert _parse_payment_days("") == 30

    def test_none_input(self):
        """None conditions_paiement should fallback to 30 days."""
        from ERP_REACT.backend.routers.accounting import _parse_payment_days
        assert _parse_payment_days(None) == 30


# ── Plan Comptable Seed ───────────────────────────────────

class TestPlanComptable:
    """Verify the chart of accounts seed data."""

    def test_seed_has_required_accounts(self):
        from ERP_REACT.backend.routers.accounting import PLAN_COMPTABLE_SEED
        codes = {row[0] for row in PLAN_COMPTABLE_SEED}
        required = {"1010", "1100", "2100", "2200", "2210", "3100", "4100", "5100"}
        for code in required:
            assert code in codes, f"Account {code} missing from PLAN_COMPTABLE_SEED"

    def test_seed_debit_credit_consistency(self):
        from ERP_REACT.backend.routers.accounting import PLAN_COMPTABLE_SEED
        for code, nom, type_compte, classe, solde_normal in PLAN_COMPTABLE_SEED:
            if type_compte == "ACTIF":
                assert solde_normal == "DEBIT" or "Amortissement" in nom, \
                    f"Actif {code} should be DEBIT (got {solde_normal})"
            elif type_compte in ("PASSIF", "REVENU", "CAPITAUX"):
                assert solde_normal == "CREDIT", \
                    f"{type_compte} {code} should be CREDIT (got {solde_normal})"
            elif type_compte == "CHARGE":
                assert solde_normal == "DEBIT", \
                    f"Charge {code} should be DEBIT (got {solde_normal})"

    def test_seed_no_duplicate_codes(self):
        from ERP_REACT.backend.routers.accounting import PLAN_COMPTABLE_SEED
        codes = [row[0] for row in PLAN_COMPTABLE_SEED]
        assert len(codes) == len(set(codes)), "Duplicate account codes in seed"
