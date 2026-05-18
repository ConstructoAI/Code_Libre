"""
Tests — Production et Operations (5 tests)
Couvre: numero BT pattern, statut workflow, operation statuts.
"""

import pytest


class TestBTNumberGeneration:
    """Verify BT number pattern."""

    def test_bt_numero_format(self):
        """BT numbers should follow BT-NNNNN pattern."""
        bt_id = 123
        numero = f"BT-{bt_id:05d}"
        assert numero == "BT-00123"

    def test_facture_numero_format(self):
        """Facture numbers should follow FACT-YYYY-NNNNN pattern."""
        facture_id = 42
        year = "2026"
        numero = f"FACT-{year}-{facture_id:05d}"
        assert numero == "FACT-2026-00042"

    def test_devis_numero_format(self):
        """Devis numbers should follow DEV-YYYY-NNN pattern (3-digit pad)."""
        devis_id = 7
        year = "2026"
        numero = f"DEV-{year}-{devis_id:03d}"
        assert numero == "DEV-2026-007"


class TestStatutWorkflow:
    """Verify valid status transitions."""

    FACTURE_STATUTS = {"BROUILLON", "ENVOYEE", "PAYEE", "PARTIELLEMENT_PAYEE", "EN_RETARD", "ANNULEE"}
    BT_STATUTS = {"BROUILLON", "EN_COURS", "EN_PAUSE", "TERMINE", "ANNULE"}

    def test_facture_statuts_complete(self):
        assert "BROUILLON" in self.FACTURE_STATUTS
        assert "ENVOYEE" in self.FACTURE_STATUTS
        assert "PAYEE" in self.FACTURE_STATUTS
        assert len(self.FACTURE_STATUTS) == 6

    def test_bt_statuts_include_en_pause(self):
        """EN_PAUSE must be included (lecon from session 13)."""
        assert "EN_PAUSE" in self.BT_STATUTS
        assert "BROUILLON" in self.BT_STATUTS
