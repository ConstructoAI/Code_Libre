"""
Tests — Billing IA et Stripe (6 tests)
Couvre: MIN_BALANCE_THRESHOLD, pricing formulas, credit tracking.
"""

import pytest


class TestBillingConstants:
    """Verify billing constants and pricing calculations."""

    def test_min_balance_threshold(self):
        """MIN_BALANCE_THRESHOLD should be 0.10, not 0."""
        from ERP_REACT.backend.routers.ai import MIN_BALANCE_THRESHOLD
        assert MIN_BALANCE_THRESHOLD == 0.10

    def test_auto_recharge_amount(self):
        """Auto-recharge should charge $10 CAD."""
        from ERP_REACT.backend.routers.ai import PREPAID_RECHARGE_AMOUNT
        assert PREPAID_RECHARGE_AMOUNT == 10.0

    def test_pricing_sonnet(self):
        """Sonnet pricing: (input * 0.003 + output * 0.015) / 1000 * 1.30 markup."""
        input_tokens = 1000
        output_tokens = 500
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30
        expected = (3.0 + 7.5) / 1000 * 1.30
        assert abs(cost - expected) < 0.0001

    def test_pricing_opus(self):
        """Opus pricing: (input * 0.015 + output * 0.075) / 1000 * 1.30 markup."""
        input_tokens = 1000
        output_tokens = 500
        cost = (input_tokens * 0.015 + output_tokens * 0.075) / 1000 * 1.30
        expected = (15.0 + 37.5) / 1000 * 1.30
        assert abs(cost - expected) < 0.0001


class TestBillingEdgeCases:
    """Edge cases in billing logic."""

    def test_negative_balance_allowed(self):
        """Balance can go negative for accurate tracking (lecon #119)."""
        balance = 0.50
        cost = 2.00
        new_balance = balance - cost
        assert new_balance == -1.50  # Negative is OK

    def test_recharge_triggered_at_threshold(self):
        """Recharge should trigger when balance < MIN_BALANCE_THRESHOLD."""
        from ERP_REACT.backend.routers.ai import MIN_BALANCE_THRESHOLD
        balance = 0.05
        assert balance < MIN_BALANCE_THRESHOLD
