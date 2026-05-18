"""
Configuration centralisée des taux de taxes québécoises.

Ce module définit les taux officiels de TPS (Taxe sur les Produits et Services)
et TVQ (Taxe de Vente du Québec) utilisés dans tout le système Constructo AI.

Taux en vigueur au Québec (2024-2025):
- TPS (Federal/Canada): 5%
- TVQ (Provincial/Québec): 9.975%

Note: Ces taux sont appliqués de manière non-composée au Québec.
Le taux combiné effectif est: 5% + 9.975% = 14.975%
"""

# ============================================================================
# TAUX DE TAXES QUÉBÉCOISES - CONFIGURATION CENTRALISÉE
# ============================================================================

# Taxe sur les Produits et Services (fédérale)
TPS_RATE = 0.05  # 5%

# Taxe de Vente du Québec (provinciale)
TVQ_RATE = 0.09975  # 9.975%

# Taux combiné (pour calculs inversés TTC → HT)
COMBINED_TAX_RATE = TPS_RATE + TVQ_RATE  # 14.975%

# Multiplicateur TTC (pour calculs HT → TTC)
TTC_MULTIPLIER = 1 + COMBINED_TAX_RATE  # 1.14975


# ============================================================================
# FONCTIONS UTILITAIRES DE CALCUL DE TAXES
# ============================================================================

def calculer_taxes(montant_ht: float) -> dict:
    """
    Calcule les taxes à partir d'un montant HT.

    Args:
        montant_ht: Montant hors taxes

    Returns:
        dict avec 'tps', 'tvq', 'total_taxes', 'montant_ttc'
    """
    tps = round(montant_ht * TPS_RATE, 2)
    tvq = round(montant_ht * TVQ_RATE, 2)
    total_taxes = round(tps + tvq, 2)
    montant_ttc = round(montant_ht + total_taxes, 2)

    return {
        'montant_ht': round(montant_ht, 2),
        'tps': tps,
        'tvq': tvq,
        'total_taxes': total_taxes,
        'montant_ttc': montant_ttc
    }


def calculer_ht_depuis_ttc(montant_ttc: float) -> dict:
    """
    Calcule le montant HT et les taxes à partir d'un montant TTC.

    Args:
        montant_ttc: Montant toutes taxes comprises

    Returns:
        dict avec 'montant_ht', 'tps', 'tvq', 'total_taxes'
    """
    montant_ht = round(montant_ttc / TTC_MULTIPLIER, 2)
    tps = round(montant_ht * TPS_RATE, 2)
    tvq = round(montant_ht * TVQ_RATE, 2)
    total_taxes = round(tps + tvq, 2)

    return {
        'montant_ht': montant_ht,
        'tps': tps,
        'tvq': tvq,
        'total_taxes': total_taxes,
        'montant_ttc': round(montant_ttc, 2)
    }


def formater_taxes_display(montant_ht: float) -> str:
    """
    Retourne une chaîne formatée pour affichage des taxes.

    Args:
        montant_ht: Montant hors taxes

    Returns:
        Chaîne formatée "TPS: X.XX$ | TVQ: X.XX$ | Total: X.XX$"
    """
    taxes = calculer_taxes(montant_ht)
    return f"TPS: {taxes['tps']:.2f}$ | TVQ: {taxes['tvq']:.2f}$ | Total: {taxes['montant_ttc']:.2f}$"


# ============================================================================
# CONSTANTES POUR AFFICHAGE
# ============================================================================

TPS_LABEL = "TPS (5%)"
TVQ_LABEL = "TVQ (9.975%)"
TPS_PERCENT = "5%"
TVQ_PERCENT = "9.975%"
