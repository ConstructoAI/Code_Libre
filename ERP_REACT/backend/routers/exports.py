"""
ERP React - Exports Router
Generate HTML documents for Devis, Factures, and Bons de Travail.
The frontend renders the HTML in a new tab; the user prints to PDF via Ctrl+P.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db
from .html_utils import (
    DEFAULT_DOCUMENT_THEME,
    THEME_KEYS,
    get_document_theme,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/exports", tags=["Exports"])


# ============================================
# SHARED CSS TEMPLATE (theme-aware)
# ============================================
#
# Tokens of the form __KEY__ (uppercase) are substituted by the tenant's
# document_theme at render time via build_shared_css(theme). The tokens
# map 1:1 to THEME_KEYS in html_utils.
# Non-themed hex values (e.g. badge colors #dbeafe) stay hardcoded since
# they carry semantic meaning (blue=info, green=success, red=alert) that
# should not change based on branding.

_SHARED_CSS_TEMPLATE = """
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        color: #1a1a1a;
        background: #fff;
        padding: 40px;
        max-width: 900px;
        margin: 0 auto;
        line-height: 1.5;
    }
    @media print {
        /* Force background colors to be printed — without this, Chrome/Firefox
           strip backgrounds by default on print, making the Budgétaire badge
           and banner (amber bg) invisible on the PDF (amber text on white). */
        body {
            padding: 20px;
            max-width: 100%;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        .no-print { display: none !important; }
        @page { margin: 15mm 10mm; }
    }
    .header {
        display: flex;
        justify-content: space-between;
        align-items: stretch;
        margin-bottom: 0;
    }
    .header-left {
        display: flex;
        align-items: center;
        gap: 16px;
        max-width: 55%;
    }
    .company-logo {
        max-height: 70px;
        max-width: 70px;
        object-fit: contain;
    }
    .company-details { }
    .company-name {
        font-size: 22px;
        font-weight: 800;
        color: __PRIMARY__;
        margin-bottom: 2px;
    }
    .company-info {
        font-size: 11px;
        color: #64748b;
        line-height: 1.5;
    }
    .company-info .ent-nums {
        color: #94a3b8;
        font-size: 10px;
        margin-top: 2px;
    }
    .doc-title {
        background: __PRIMARY__;
        color: __HEADER_TEXT__;
        padding: 20px 28px;
        border-radius: 6px;
        text-align: center;
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-width: 180px;
    }
    .doc-title h1 {
        font-size: 24px;
        color: __HEADER_TEXT__;
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 2px;
    }
    .doc-title .doc-number {
        font-size: 14px;
        color: __ACCENT_LIGHT__;
        font-weight: 600;
    }
    .header-separator {
        height: 4px;
        background: linear-gradient(90deg, __PRIMARY__ 0%, __ACCENT__ 50%, __PRIMARY__ 100%);
        border-radius: 2px;
        margin-bottom: 24px;
        margin-top: 20px;
    }
    .info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        margin-bottom: 30px;
    }
    .info-box {
        padding: 16px 20px;
        background: __INFO_BG__;
        border-radius: 6px;
        border-left: 4px solid __ACCENT__;
    }
    .info-box h3 {
        font-size: 11px;
        text-transform: uppercase;
        color: __ACCENT__;
        margin-bottom: 8px;
        letter-spacing: 0.5px;
        font-weight: 700;
    }
    .info-box p {
        font-size: 13px;
        color: #334155;
        margin-bottom: 3px;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
    }
    thead th {
        background: __PRIMARY__;
        color: __HEADER_TEXT__;
        padding: 10px 12px;
        text-align: left;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        font-weight: 600;
    }
    thead th.text-right { text-align: right; }
    thead th.text-center { text-align: center; }
    tbody td {
        padding: 10px 12px;
        font-size: 13px;
        border-bottom: 1px solid __BORDER__;
        color: #333;
    }
    tbody td.text-right { text-align: right; }
    tbody td.text-center { text-align: center; }
    tbody tr:nth-child(even) { background: __TABLE_ROW_ALT__; }
    tbody tr:hover { background: #e9f3ff; }
    .totals-section {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 30px;
    }
    .totals-table {
        width: 320px;
    }
    .totals-table tr td {
        padding: 8px 12px;
        font-size: 13px;
        border-bottom: 1px solid __BORDER__;
    }
    .totals-table tr td:first-child {
        color: #555;
    }
    .totals-table tr td:last-child {
        text-align: right;
        font-weight: 600;
        color: #333;
    }
    .totals-table tr.total-row td {
        border-top: 2px solid __PRIMARY__;
        border-bottom: none;
        font-size: 16px;
        font-weight: 700;
        color: __PRIMARY__;
        padding-top: 12px;
    }
    .conditions-section {
        margin-bottom: 30px;
        padding: 15px;
        background: __TABLE_ROW_ALT__;
        border-radius: 6px;
    }
    .conditions-section h3 {
        font-size: 12px;
        text-transform: uppercase;
        color: __PRIMARY__;
        margin-bottom: 8px;
        font-weight: 700;
    }
    .conditions-section p {
        font-size: 12px;
        color: #555;
        white-space: pre-line;
    }
    .signatures {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 40px;
        margin-top: 50px;
        page-break-inside: avoid;
    }
    .signatures.three-col {
        grid-template-columns: 1fr 1fr 1fr;
        gap: 30px;
    }
    .signature-block {
        text-align: center;
    }
    .signature-line {
        border-top: 1px solid #333;
        margin-top: 60px;
        padding-top: 8px;
        font-size: 12px;
        color: #555;
    }
    .badge {
        display: inline-block;
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .badge-blue { background: #dbeafe; color: #1e40af; }
    .badge-green { background: #dcfce7; color: #166534; }
    .badge-yellow { background: #fef9c3; color: #854d0e; }
    .badge-red { background: #fee2e2; color: #991b1b; }
    .badge-gray { background: #f3f4f6; color: #374151; }
    .footer {
        margin-top: 40px;
        padding-top: 15px;
        border-top: 1px solid __BORDER__;
        text-align: center;
        font-size: 10px;
        color: #999;
    }
    .print-btn {
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 10px 20px;
        background: __PRIMARY__;
        color: __HEADER_TEXT__;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 1000;
    }
    .print-btn:hover { background: __PRIMARY_DARK__; }
    .section-title {
        font-size: 14px;
        font-weight: 700;
        color: __PRIMARY__;
        margin-bottom: 12px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .materials-section {
        margin-bottom: 30px;
        padding: 15px;
        background: #fffbeb;
        border-radius: 6px;
        border-left: 4px solid #f59e0b;
    }
    .materials-section h3 {
        font-size: 12px;
        text-transform: uppercase;
        color: #92400e;
        margin-bottom: 8px;
        font-weight: 700;
    }
    .safety-section {
        margin-bottom: 30px;
        padding: 15px;
        background: #fef2f2;
        border-radius: 6px;
        border-left: 4px solid #ef4444;
    }
    .safety-section h3 {
        font-size: 12px;
        text-transform: uppercase;
        color: #991b1b;
        margin-bottom: 8px;
        font-weight: 700;
    }
    .safety-section ul {
        font-size: 12px;
        color: #555;
        padding-left: 20px;
    }
    .safety-section li { margin-bottom: 4px; }
"""


def build_shared_css(theme: dict = None) -> str:
    """Return the shared CSS with theme tokens substituted.

    Missing or invalid theme dict falls back to DEFAULT_DOCUMENT_THEME so
    document generation never breaks due to theme issues.
    """
    resolved = dict(DEFAULT_DOCUMENT_THEME)
    if isinstance(theme, dict):
        for k in THEME_KEYS:
            v = theme.get(k)
            if isinstance(v, str) and v.strip():
                resolved[k] = v
    css = _SHARED_CSS_TEMPLATE
    for k in THEME_KEYS:
        css = css.replace(f"__{k.upper()}__", resolved[k])
    return css


# Backward-compat: legacy imports still reference SHARED_CSS (module-level
# constant). Keep it as the default-theme variant so any unmigrated caller
# still renders with a valid palette.
SHARED_CSS = build_shared_css()


def _fmt_currency(val) -> str:
    """Format a number as currency string."""
    if val is None:
        return "0.00 $"
    try:
        return f"{float(val):,.2f} $"
    except (ValueError, TypeError):
        return "0.00 $"


def _fmt_date(val) -> str:
    """Format a date value as string."""
    if val is None:
        return "--"
    return str(val)[:10]


def _esc(val) -> str:
    """Escape HTML special characters."""
    if val is None:
        return ""
    s = str(val)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _get_company_info(cursor) -> dict:
    """Fetch company info from entreprise_config (supports all key formats)."""
    info = {
        "nom": "",
        "adresse": "",
        "ville": "",
        "province": "",
        "code_postal": "",
        "telephone": "",
        "courriel": "",
        "site_web": "",
        "rbq": "",
        "neq": "",
        "tps": "",
        "tvq": "",
        "logo_base64": "",
    }
    # Each output field can be found under multiple key names in config_data,
    # depending on whether data was saved by React frontend, legacy Streamlit, or old mapping.
    # First match wins (priority: React frontend > legacy BD > old mapping).
    _KEY_VARIANTS = {
        "nom":         ["company_name", "nom", "nom_entreprise"],
        "adresse":     ["company_address", "adresse"],
        "ville":       ["company_city", "ville"],
        "province":    ["company_province", "province"],
        "code_postal": ["company_postal_code", "code_postal"],
        "telephone":   ["company_phone", "telephone", "telephone_bureau"],
        "courriel":    ["company_email", "email", "courriel"],
        "site_web":    ["company_website", "site_web"],
        "rbq":         ["company_rbq_number", "rbq", "numero_rbq"],
        "neq":         ["company_neq", "neq", "numero_neq"],
        "tps":         ["company_tps_number", "tps", "numero_tps"],
        "tvq":         ["company_tvq_number", "tvq", "numero_tvq"],
        "logo_base64": ["company_logo_base64", "logo_base64"],
    }
    try:
        cursor.execute("SELECT config_data FROM entreprise_config LIMIT 1")
        row = cursor.fetchone()
        if row and row["config_data"]:
            cfg = row["config_data"]
            if isinstance(cfg, str):
                import json as _json
                cfg = _json.loads(cfg)
            for info_key, candidates in _KEY_VARIANTS.items():
                for ck in candidates:
                    if ck in cfg and cfg[ck]:
                        info[info_key] = str(cfg[ck])
                        break
    except Exception:
        pass
    return info


def _logo_html(company: dict) -> str:
    """Build <img> tag for the company logo, or empty string if no logo."""
    logo = company.get("logo_base64", "") or ""
    if not logo or not logo.startswith("data:image/"):
        return ""
    return f'<img src="{_esc(logo)}" alt="{_esc(company.get("nom", "Logo"))}" class="company-logo">'


def _build_company_header(company: dict) -> str:
    """Build compact professional company header HTML (logo + name side by side)."""
    logo = _logo_html(company)
    nom = _esc(company.get("nom", ""))
    addr = _esc(company.get("adresse", "") or "")
    ville = _esc(company.get("ville", "") or "")
    prov = _esc(company.get("province", "") or "")
    cp = _esc(company.get("code_postal", "") or "")
    tel = _esc(company.get("telephone", "") or "")
    email = _esc(company.get("courriel", "") or "")
    rbq = _esc(company.get("rbq", "") or "")
    neq = _esc(company.get("neq", "") or "")
    tps = _esc(company.get("tps", "") or "")
    tvq = _esc(company.get("tvq", "") or "")

    addr_line = addr
    if ville:
        addr_line += f", {ville}"
        if prov:
            addr_line += f", {prov}"
        if cp:
            addr_line += f" {cp}"

    contact_parts = []
    if tel:
        contact_parts.append(f"Tel: {tel}")
    if email:
        contact_parts.append(email)
    contact_line = " | ".join(contact_parts)

    nums = []
    if rbq:
        nums.append(f"RBQ: {rbq}")
    if neq:
        nums.append(f"NEQ: {neq}")
    if tps:
        nums.append(f"TPS: {tps}")
    if tvq:
        nums.append(f"TVQ: {tvq}")
    nums_line = ' | '.join(nums)

    html = '<div class="header-left">'
    if logo:
        html += logo
    html += f'<div class="company-details"><div class="company-name">{nom}</div>'
    html += '<div class="company-info">'
    if addr_line:
        html += f'{addr_line}<br>'
    if contact_line:
        html += contact_line
    if nums_line:
        html += f'<div class="ent-nums">{nums_line}</div>'
    html += '</div></div></div>'
    return html


def _badge_class(statut: str) -> str:
    """Return CSS badge class for a status."""
    s = (statut or "").upper()
    if s in ("ACCEPTE", "PAYEE", "TERMINE", "VALIDEE"):
        return "badge-green"
    if s in ("EN_COURS", "ENVOYE", "ENVOYEE", "VALIDE"):
        return "badge-blue"
    if s in ("EN_ATTENTE", "EN_PAUSE", "PARTIELLEMENT_PAYEE", "EN_RETARD", "EXPIRE"):
        return "badge-yellow"
    if s in ("REFUSE", "ANNULE", "ANNULEE"):
        return "badge-red"
    return "badge-gray"


# ============================================
# 1. DEVIS EXPORT
# ============================================

@router.get("/devis/{devis_id}/html", response_class=HTMLResponse)
async def export_devis_html(devis_id: int, user: ErpUser = Depends(get_current_user)):
    """Generate an HTML document for a devis, ready for browser print-to-PDF."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Load tenant document color theme (falls back to defaults on any issue)
        theme = get_document_theme(cursor)

        # Ensure conditions/exclusions columns exist on legacy tenants before SELECT d.*
        from .devis import _ensure_visibility_columns
        _ensure_visibility_columns(cursor)

        # Fetch devis
        cursor.execute(
            "SELECT d.*, c.nom as client_nom, c.adresse as client_adresse, "
            "c.telephone as client_telephone, c.email as client_email "
            "FROM devis d LEFT JOIN companies c ON d.client_company_id = c.id "
            "WHERE d.id = %s",
            (devis_id,),
        )
        devis = cursor.fetchone()
        if not devis:
            raise HTTPException(status_code=404, detail="Devis non trouvé")
        devis = dict(devis)

        # Fetch lignes (filter hidden lines)
        # Includes per-line markup overrides (admin_pct_ligne / contingence_pct_ligne /
        # profit_pct_ligne) so the export honours line-level pricing exactly like
        # devis._generate_devis_html does. NULL on an override falls back to the
        # devis-level percentage.
        cursor.execute(
            "SELECT description, quantite, unite, prix_unitaire, montant_ligne, categorie, "
            "COALESCE(visible, TRUE) as visible, "
            "mo_pct, mat_pct, "
            "admin_pct_ligne, contingence_pct_ligne, profit_pct_ligne "
            "FROM devis_lignes WHERE devis_id = %s ORDER BY sequence_ligne ASC",
            (devis_id,),
        )
        lignes = [dict(r) for r in cursor.fetchall() if dict(r).get("visible", True) is not False]

        # Company info
        company = _get_company_info(cursor)

        # Calculate totals (use `is not None` to avoid treating 0 as falsy)
        _tv = devis.get("total_travaux")
        _ta = devis.get("total_avant_taxes")
        montant_ht = float(_tv if _tv is not None else (_ta if _ta is not None else 0))
        _tps = devis.get("tps")
        montant_tps = float(_tps) if _tps is not None else 0.0
        _tvq = devis.get("tvq")
        montant_tvq = float(_tvq) if _tvq is not None else 0.0
        _it = devis.get("investissement_total")
        montant_total = float(_it) if _it is not None else 0.0

        # Markup factor: distribute admin/contingences/profit into line prices.
        # Per-line overrides (admin_pct_ligne / contingence_pct_ligne /
        # profit_pct_ligne) take precedence over the devis-level defaults —
        # mirrors `_line_markup` in devis._generate_devis_html.
        _adm_pct = devis.get("administration_pct")
        _con_pct = devis.get("contingences_pct")
        _pro_pct = devis.get("profit_pct")
        _adm_default = float(_adm_pct) if _adm_pct is not None else 3.0
        _con_default = float(_con_pct) if _con_pct is not None else 12.0
        _pro_default = float(_pro_pct) if _pro_pct is not None else 15.0

        def _line_markup_export(l):
            _a = l.get("admin_pct_ligne")
            _c = l.get("contingence_pct_ligne")
            _p = l.get("profit_pct_ligne")
            _ar = (float(_a)) if _a is not None else _adm_default
            _cr = (float(_c)) if _c is not None else _con_default
            _pr = (float(_p)) if _p is not None else _pro_default
            return 1 + (_ar + _cr + _pr) / 100

        # Column visibility flags
        show_unite = devis.get("show_unite", True) is not False
        show_quantite = devis.get("show_quantite", True) is not False
        show_prix_unitaire = devis.get("show_prix_unitaire", True) is not False
        show_montant_ligne = devis.get("show_montant_ligne", True) is not False
        exp_col_count = 3 + (1 if show_unite else 0) + (1 if show_quantite else 0) + (1 if show_prix_unitaire else 0) + (1 if show_montant_ligne else 0)

        # Build lignes HTML (prices include per-line markup with overrides)
        lignes_rows = ""
        for i, l in enumerate(lignes, 1):
            _q = l.get("quantite")
            q = float(_q) if _q is not None else 0.0
            _lm = _line_markup_export(l)
            _pu = l.get("prix_unitaire")
            pu = round((float(_pu) if _pu is not None else 0.0) * _lm, 2)
            _mt = l.get("montant_ligne")
            mt = round((float(_mt) if _mt is not None else 0.0) * _lm, 2)
            lignes_rows += f"""
                <tr>
                    <td class="text-center">{i}</td>
                    <td>{_esc(l.get('description'))}</td>
                    <td class="text-center">{_esc(l.get('categorie') or '')}</td>
                    {'<td class="text-right">' + f'{q:,.2f}' + '</td>' if show_quantite else ''}
                    {'<td class="text-center">' + _esc(l.get('unite') or 'unite') + '</td>' if show_unite else ''}
                    {'<td class="text-right">' + _fmt_currency(pu) + '</td>' if show_prix_unitaire else ''}
                    {'<td class="text-right">' + _fmt_currency(mt) + '</td>' if show_montant_ligne else ''}
                </tr>
            """

        if not lignes_rows:
            lignes_rows = f'<tr><td colspan="{exp_col_count}" style="text-align:center;color:#999;padding:20px;">Aucune ligne</td></tr>'

        # Company info lines — compact professional layout
        company_lines = _build_company_header(company)

        # Client info
        client_info = ""
        client_nom = _esc(devis.get("client_nom") or "")
        if client_nom:
            client_info += f"<p><strong>{client_nom}</strong></p>"
        client_adresse = _esc(devis.get("client_adresse") or "")
        if client_adresse:
            client_info += f"<p>{client_adresse}</p>"
        client_tel = _esc(devis.get("client_telephone") or "")
        if client_tel:
            client_info += f"<p>Tel: {client_tel}</p>"
        client_email = _esc(devis.get("client_email") or "")
        if client_email:
            client_info += f"<p>{client_email}</p>"
        if not client_info:
            client_info = "<p style='color:#999;'>Client non specifie</p>"

        # Conditions + Exclusions (3-level fallback: devis → entreprise config → hardcoded)
        # Mirrors devis._generate_devis_html logic to keep exports consistent.
        from .devis import _get_entreprise_devis_defaults, DEVIS_CONDITIONS, DEVIS_EXCLUSIONS
        defaults = _get_entreprise_devis_defaults(cursor)
        cond_raw = devis.get("conditions_text")
        if not (isinstance(cond_raw, str) and cond_raw.strip()):
            cond_raw = defaults.get("conditions") or "\n".join(DEVIS_CONDITIONS)
        excl_raw = devis.get("exclusions_text")
        if not (isinstance(excl_raw, str) and excl_raw.strip()):
            excl_raw = defaults.get("exclusions") or "\n".join(DEVIS_EXCLUSIONS)

        def _parse_cond_items(text):
            items = []
            for raw in (text or "").replace("\r\n", "\n").split("\n"):
                line = raw.strip().lstrip("-•*").strip()
                if line:
                    items.append(line)
            return items

        cond_items = _parse_cond_items(cond_raw)
        excl_items = _parse_cond_items(excl_raw)
        show_cond = devis.get("show_conditions", True) is not False
        show_excl = devis.get("show_exclusions", True) is not False

        conditions_html = ""
        if show_cond and cond_items:
            lis = "\n".join(f"<li>{_esc(c)}</li>" for c in cond_items)
            conditions_html += f"""
            <div class="conditions-section">
                <h3>Conditions</h3>
                <ul style="padding-left:20px;font-size:13px;">{lis}</ul>
            </div>
            """
        # Legacy free-text `conditions` column: preserved for backward compatibility
        # if tenant still uses it AND no structured conditions_text is set.
        legacy_conditions = devis.get("conditions") or ""
        if legacy_conditions and not devis.get("conditions_text"):
            conditions_html += f"""
            <div class="conditions-section" style="margin-top:12px;">
                <p>{_esc(legacy_conditions)}</p>
            </div>
            """
        if show_excl and excl_items:
            ols = "\n".join(f"<li>{_esc(e)}</li>" for e in excl_items)
            conditions_html += f"""
            <div class="conditions-section" style="margin-top:16px;">
                <h3>Exclusions</h3>
                <ol style="padding-left:20px;font-size:13px;">{ols}</ol>
            </div>
            """

        # Type de soumission badge + banner (Budgétaire vs Détaillée)
        type_soum = (devis.get("type_soumission") or "Détaillée").strip()
        is_budgetaire = type_soum == "Budgétaire"
        type_badge_html = (
            '<div style="background:#FEF3C7;color:#92400E;padding:4px 10px;border-radius:4px;'
            'font-size:11px;font-weight:700;letter-spacing:0.5px;margin-top:6px;'
            'display:inline-block;">BUDGÉTAIRE</div>'
            if is_budgetaire else ''
        )
        budgetaire_banner_html = (
            '<div style="background:#FEF3C7;border-left:4px solid #F59E0B;color:#92400E;'
            'padding:10px 14px;border-radius:4px;margin:16px 0;font-size:12px;">'
            '<strong>Soumission budgétaire</strong> — Ce document est une estimation '
            'approximative à titre indicatif. Les montants peuvent varier selon le '
            'relevé final des mesures et l\'analyse détaillée du projet.</div>'
            if is_budgetaire else ''
        )

        html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Devis {_esc(devis.get('numero_devis', ''))}</title>
    <style>{build_shared_css(theme)}</style>
</head>
<body>
    <button class="print-btn no-print" onclick="window.print()">Imprimer / PDF</button>

    <div class="header">
        {company_lines}
        <div class="doc-title">
            <h1>Devis</h1>
            <div class="doc-number">{_esc(devis.get('numero_devis', ''))}</div>
            {type_badge_html}
        </div>
    </div>
    <div class="header-separator"></div>
    {budgetaire_banner_html}

    <div class="info-grid">
        <div class="info-box">
            <h3>Client</h3>
            {client_info}
        </div>
        <div class="info-box">
            <h3>Details du devis</h3>
            <p><strong>Numero:</strong> {_esc(devis.get('numero_devis', ''))}</p>
            <p><strong>Date:</strong> {_fmt_date(devis.get('created_at'))}</p>
            <p><strong>Validite:</strong> {_fmt_date(devis.get('date_prevu'))}</p>
            <p><strong>Statut:</strong> <span class="badge {_badge_class(devis.get('statut', ''))}">{_esc(devis.get('statut', ''))}</span></p>
        </div>
    </div>

    {f'<p style="margin-bottom:20px;color:#555;font-size:13px;">{_esc(devis.get("description", ""))}</p>' if devis.get('description') else ''}

    <table>
        <thead>
            <tr>
                <th class="text-center" style="width:40px;">#</th>
                <th>Description</th>
                <th class="text-center">Categorie</th>
                {'<th class="text-right">Quantite</th>' if show_quantite else ''}
                {'<th class="text-center">Unite</th>' if show_unite else ''}
                {'<th class="text-right">Prix unit.</th>' if show_prix_unitaire else ''}
                {'<th class="text-right">Montant</th>' if show_montant_ligne else ''}
            </tr>
        </thead>
        <tbody>
            {lignes_rows}
        </tbody>
    </table>

    <div class="totals-section">
        <table class="totals-table">
            <tr><td>Sous-total</td><td>{_fmt_currency(float(devis["total_avant_taxes"]) if devis.get("total_avant_taxes") is not None else montant_ht)}</td></tr>
            <tr><td>TPS (5%)</td><td>{_fmt_currency(montant_tps)}</td></tr>
            <tr><td>TVQ (9.975%)</td><td>{_fmt_currency(montant_tvq)}</td></tr>
            <tr class="total-row"><td>Total TTC</td><td>{_fmt_currency(montant_total)}</td></tr>
        </table>
    </div>

    {conditions_html}

    <div class="signatures">
        <div class="signature-block">
            <div class="signature-line">Signature de l'entreprise</div>
        </div>
        <div class="signature-block">
            <div class="signature-line">Signature du client</div>
        </div>
    </div>

    <div class="footer">
        {_esc(company['nom'])} &mdash; Document genere electroniquement
    </div>
</body>
</html>"""

        return HTMLResponse(content=html)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("export_devis_html error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la generation du devis")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# 2. INVOICE (FACTURE) EXPORT
# ============================================

@router.get("/invoice/{invoice_id}/html", response_class=HTMLResponse)
async def export_invoice_html(invoice_id: int, user: ErpUser = Depends(get_current_user)):
    """Generate an HTML document for an invoice, ready for browser print-to-PDF."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Load tenant document color theme (falls back to defaults on any issue)
        theme = get_document_theme(cursor)

        # Fetch invoice
        cursor.execute("SELECT * FROM factures WHERE id = %s", (invoice_id,))
        facture = cursor.fetchone()
        if not facture:
            raise HTTPException(status_code=404, detail="Facture non trouvée")
        facture = dict(facture)

        # Try to fetch client company details
        client_company = None
        if facture.get("client_company_id"):
            cursor.execute(
                "SELECT nom, adresse, telephone, email FROM companies WHERE id = %s",
                (facture["client_company_id"],),
            )
            row = cursor.fetchone()
            if row:
                client_company = dict(row)

        # Company info
        company = _get_company_info(cursor)

        # Extract amounts (use `is not None` to avoid treating 0 as falsy)
        _mht = facture.get("montant_ht")
        montant_ht = float(_mht) if _mht is not None else 0.0
        _mt = facture.get("montant_tps")
        montant_tps = float(_mt) if _mt is not None else 0.0
        _mtvq = facture.get("montant_tvq")
        montant_tvq = float(_mtvq) if _mtvq is not None else 0.0
        _mttc = facture.get("montant_ttc")
        _mtot = facture.get("montant_total")
        montant_ttc = float(_mttc if _mttc is not None else (_mtot if _mtot is not None else 0))
        _mpaye = facture.get("montant_paye")
        montant_paye = float(_mpaye) if _mpaye is not None else 0.0
        _sdu = facture.get("solde_du")
        solde_du = float(_sdu) if _sdu is not None else 0.0

        # Company info HTML
        company_lines = _build_company_header(company)

        # Client info
        client_nom = _esc(facture.get("client_nom") or "")
        client_info = ""
        if client_company:
            client_info += f"<p><strong>{_esc(client_company.get('nom', client_nom))}</strong></p>"
            if client_company.get("adresse"):
                client_info += f"<p>{_esc(client_company['adresse'])}</p>"
            if client_company.get("telephone"):
                client_info += f"<p>Tel: {_esc(client_company['telephone'])}</p>"
            if client_company.get("email"):
                client_info += f"<p>{_esc(client_company['email'])}</p>"
        elif client_nom:
            client_info = f"<p><strong>{client_nom}</strong></p>"
        else:
            client_info = "<p style='color:#999;'>Client non specifie</p>"

        # Solde styling
        solde_color = "#166534" if solde_du <= 0 else "#991b1b"

        # Notes section
        notes_html = ""
        if facture.get("notes"):
            notes_html = f"""
            <div class="conditions-section">
                <h3>Notes</h3>
                <p>{_esc(facture['notes'])}</p>
            </div>
            """

        # Payment info
        payment_info = """
        <div class="conditions-section">
            <h3>Modalites de paiement</h3>
            <p>Paiement par cheque a l'ordre de {company_name}</p>
            <p>Virement Interac accepte</p>
        </div>
        """.format(company_name=_esc(company["nom"]))

        html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Facture {_esc(facture.get('numero_facture', ''))}</title>
    <style>{build_shared_css(theme)}</style>
</head>
<body>
    <button class="print-btn no-print" onclick="window.print()">Imprimer / PDF</button>

    <div class="header">
        {company_lines}
        <div class="doc-title">
            <h1>Facture</h1>
            <div class="doc-number">{_esc(facture.get('numero_facture', ''))}</div>
        </div>
    </div>
    <div class="header-separator"></div>

    <div class="info-grid">
        <div class="info-box">
            <h3>Facturer a</h3>
            {client_info}
        </div>
        <div class="info-box">
            <h3>Details de la facture</h3>
            <p><strong>Numero:</strong> {_esc(facture.get('numero_facture', ''))}</p>
            <p><strong>Date facture:</strong> {_fmt_date(facture.get('date_facture'))}</p>
            <p><strong>Date echeance:</strong> {_fmt_date(facture.get('date_echeance'))}</p>
            <p><strong>Conditions:</strong> {_esc(facture.get('conditions_paiement', 'Net 30'))}</p>
            <p><strong>Statut:</strong> <span class="badge {_badge_class(facture.get('statut', ''))}">{_esc(facture.get('statut', ''))}</span></p>
        </div>
    </div>

    <div class="totals-section" style="margin-top:20px;">
        <table class="totals-table" style="width:400px;">
            <tr><td>Sous-total HT</td><td>{_fmt_currency(montant_ht)}</td></tr>
            <tr><td>TPS (5%)</td><td>{_fmt_currency(montant_tps)}</td></tr>
            <tr><td>TVQ (9.975%)</td><td>{_fmt_currency(montant_tvq)}</td></tr>
            <tr class="total-row"><td>Total TTC</td><td>{_fmt_currency(montant_ttc)}</td></tr>
            <tr><td style="padding-top:12px;">Montant paye</td><td style="padding-top:12px;color:#166534;">{_fmt_currency(montant_paye)}</td></tr>
            <tr style="font-size:16px;font-weight:700;">
                <td style="color:{solde_color};border-top:2px solid {solde_color};padding-top:10px;">Solde du</td>
                <td style="color:{solde_color};border-top:2px solid {solde_color};padding-top:10px;">{_fmt_currency(solde_du)}</td>
            </tr>
        </table>
    </div>

    {notes_html}
    {payment_info}

    <div class="signatures">
        <div class="signature-block">
            <div class="signature-line">Signature autorisee</div>
        </div>
        <div class="signature-block">
            <div class="signature-line">Signature du client</div>
        </div>
    </div>

    <div class="footer">
        {_esc(company['nom'])} &mdash; Document genere electroniquement
    </div>
</body>
</html>"""

        return HTMLResponse(content=html)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("export_invoice_html error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la generation de la facture")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# 3. BON DE TRAVAIL (WORK ORDER) EXPORT
# ============================================

@router.get("/work-order/{bt_id}/html", response_class=HTMLResponse)
async def export_work_order_html(bt_id: int, user: ErpUser = Depends(get_current_user)):
    """Generate an HTML document for a work order, ready for browser print-to-PDF."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Load tenant document color theme (falls back to defaults on any issue)
        theme = get_document_theme(cursor)

        # Fetch work order
        cursor.execute(
            "SELECT f.id, f.numero_document, f.nom, f.statut, f.priorite, "
            "f.project_id, f.date_echeance, f.montant_total, f.notes, "
            "f.created_at, f.updated_at, "
            "p.nom_projet AS project_nom "
            "FROM formulaires f "
            "LEFT JOIN projects p ON p.id::text = f.project_id::text "
            "WHERE f.id = %s AND f.type_formulaire = 'BON_TRAVAIL'",
            (bt_id,),
        )
        bt = cursor.fetchone()
        if not bt:
            raise HTTPException(status_code=404, detail="Bon de travail introuvable")
        bt = dict(bt)

        # Fetch lines (with product info from inventory)
        try:
            cursor.execute("ALTER TABLE formulaire_lignes ADD COLUMN IF NOT EXISTS produit_id INTEGER")
        except Exception:
            pass
        cursor.execute(
            "SELECT fl.description, fl.quantite, fl.unite, fl.prix_unitaire, fl.montant_ligne, "
            "fl.sequence_ligne, fl.produit_id, p.nom AS produit_nom, p.code_produit AS produit_code "
            "FROM formulaire_lignes fl "
            "LEFT JOIN produits p ON p.id = fl.produit_id "
            "WHERE fl.formulaire_id = %s ORDER BY fl.sequence_ligne, fl.id",
            (bt_id,),
        )
        lines = [dict(r) for r in cursor.fetchall()]

        # Fetch assignations
        assignations = []
        try:
            cursor.execute(
                "SELECT a.id, a.employee_id, a.role, a.created_at, "
                "e.prenom || ' ' || e.nom AS employee_nom "
                "FROM bt_assignations a "
                "LEFT JOIN employees e ON e.id = a.employee_id "
                "WHERE a.bt_id = %s ORDER BY a.created_at",
                (bt_id,),
            )
            assignations = [dict(r) for r in cursor.fetchall()]
        except Exception:
            try:
                conn.rollback()
                db.set_tenant(conn, user.schema)
            except Exception:
                pass

        # Fetch operations
        operations = []
        try:
            cursor.execute(
                "SELECT o.*, e.prenom || ' ' || e.nom AS employee_nom "
                "FROM operations o "
                "LEFT JOIN employees e ON e.id = o.employee_id "
                "WHERE o.formulaire_bt_id = %s ORDER BY o.id",
                (bt_id,),
            )
            operations = [dict(r) for r in cursor.fetchall()]
        except Exception:
            try:
                conn.rollback()
                db.set_tenant(conn, user.schema)
            except Exception:
                pass

        # Company info
        company = _get_company_info(cursor)

        # Build lines table
        lines_rows = ""
        lines_total = 0
        for i, l in enumerate(lines, 1):
            _q = l.get("quantite")
            q = float(_q) if _q is not None else 0.0
            _pu = l.get("prix_unitaire")
            pu = float(_pu) if _pu is not None else 0.0
            _mt = l.get("montant_ligne")
            mt = float(_mt) if _mt is not None else 0.0
            lines_total += mt
            lines_rows += f"""
                <tr>
                    <td class="text-center">{i}</td>
                    <td>{_esc(l.get('description'))}</td>
                    <td class="text-right">{q:,.2f}</td>
                    <td class="text-center">{_esc(l.get('unite') or '--')}</td>
                    <td class="text-right">{_fmt_currency(pu)}</td>
                    <td class="text-right">{_fmt_currency(mt)}</td>
                </tr>
            """

        if not lines_rows:
            lines_rows = '<tr><td colspan="6" style="text-align:center;color:#999;padding:20px;">Aucune operation</td></tr>'

        # Build assignations table
        assign_rows = ""
        for a in assignations:
            assign_rows += f"""
                <tr>
                    <td>{_esc(a.get('employee_nom') or f"Employe #{a.get('employee_id', '?')}")}</td>
                    <td>{_esc(a.get('role') or '--')}</td>
                    <td class="text-center">{_fmt_date(a.get('created_at'))}</td>
                </tr>
            """

        if not assign_rows:
            assign_rows = '<tr><td colspan="3" style="text-align:center;color:#999;padding:15px;">Aucune assignation</td></tr>'

        # Build operations table
        ops_rows = ""
        total_h_prevues = 0.0
        total_h_reelles = 0.0
        for i, op in enumerate(operations, 1):
            op_nom = op.get("nom", "") or op.get("description", "") or ""
            op_qte = float(op.get("quantite", 1) or 1)
            op_assign = op.get("employee_nom", "") or ""
            op_fourn = op.get("fournisseur", "") or ""
            _hp = op.get("heures_prevues")
            op_hp = float(_hp) if _hp is not None else 0.0
            _hr = op.get("heures_reelles")
            op_hr = float(_hr) if _hr is not None else 0.0
            op_statut = (op.get("statut", "") or "").replace("_", " ").capitalize()
            total_h_prevues += op_hp
            total_h_reelles += op_hr
            ops_rows += f"""
                <tr>
                    <td class="text-center">{i}</td>
                    <td>{_esc(op_nom)}</td>
                    <td class="text-center">{op_qte:g}</td>
                    <td>{_esc(op_assign)}</td>
                    <td>{_esc(op_fourn)}</td>
                    <td class="text-right">{op_hp:g}h</td>
                    <td class="text-right">{op_hr:g}h</td>
                    <td class="text-center">{_esc(op_statut)}</td>
                </tr>
            """
        if not ops_rows:
            ops_rows = '<tr><td colspan="8" style="text-align:center;color:#999;padding:20px;">Aucune operation</td></tr>'

        # Company info HTML
        company_lines = _build_company_header(company)

        # Priority badge
        priorite = bt.get("priorite", "NORMALE")
        priorite_badge_class = {
            "BASSE": "badge-gray",
            "NORMALE": "badge-blue",
            "HAUTE": "badge-yellow",
            "URGENTE": "badge-red",
        }.get(priorite, "badge-gray")

        # Notes
        notes_html = ""
        if bt.get("notes"):
            notes_html = f"""
            <div class="conditions-section">
                <h3>Notes / Instructions</h3>
                <p>{_esc(bt['notes'])}</p>
            </div>
            """

        html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bon de Travail {_esc(bt.get('numero_document', ''))}</title>
    <style>{build_shared_css(theme)}</style>
</head>
<body>
    <button class="print-btn no-print" onclick="window.print()">Imprimer / PDF</button>

    <div class="header">
        {company_lines}
        <div class="doc-title">
            <h1>Bon de Travail</h1>
            <div class="doc-number">{_esc(bt.get('numero_document', ''))}</div>
        </div>
    </div>
    <div class="header-separator"></div>

    <div class="info-grid">
        <div class="info-box">
            <h3>Informations</h3>
            <p><strong>Titre:</strong> {_esc(bt.get('nom', ''))}</p>
            <p><strong>Projet:</strong> {_esc(bt.get('project_nom') or 'Aucun projet')}</p>
            <p><strong>Date echeance:</strong> {_fmt_date(bt.get('date_echeance'))}</p>
            <p><strong>Cree le:</strong> {_fmt_date(bt.get('created_at'))}</p>
        </div>
        <div class="info-box">
            <h3>Statut &amp; Priorite</h3>
            <p style="margin-bottom:8px;">
                <span class="badge {_badge_class(bt.get('statut', ''))}">{_esc(bt.get('statut', ''))}</span>
                &nbsp;
                <span class="badge {priorite_badge_class}">{_esc(priorite)}</span>
            </p>
            <p><strong>Montant total:</strong> {_fmt_currency(bt.get('montant_total'))}</p>
        </div>
    </div>

    {notes_html}

    <h3 class="section-title">Operations</h3>
    <table>
        <thead>
            <tr>
                <th class="text-center" style="width:40px;">#</th>
                <th>Operation</th>
                <th class="text-center">Qte</th>
                <th>Assigne a</th>
                <th>Fournisseur</th>
                <th class="text-right">H. prevues</th>
                <th class="text-right">H. reelles</th>
                <th class="text-center">Statut</th>
            </tr>
        </thead>
        <tbody>
            {ops_rows}
        </tbody>
    </table>
    {f'<p style="text-align:right;font-size:13px;color:#4a5568;margin-bottom:20px;"><strong>Total heures:</strong> {total_h_prevues:g}h prevues | {total_h_reelles:g}h reelles</p>' if operations else ''}

    {f'''<h3 class="section-title">Lignes</h3>
    <table>
        <thead>
            <tr>
                <th class="text-center" style="width:40px;">#</th>
                <th>Description</th>
                <th class="text-right">Quantite</th>
                <th class="text-center">Unite</th>
                <th class="text-right">Prix unit.</th>
                <th class="text-right">Montant</th>
            </tr>
        </thead>
        <tbody>
            {lines_rows}
        </tbody>
    </table>
    <div class="totals-section">
        <table class="totals-table">
            <tr class="total-row"><td>Total lignes</td><td>{_fmt_currency(lines_total)}</td></tr>
        </table>
    </div>''' if lines else ''}

    <h3 class="section-title">Assignations</h3>
    <table>
        <thead>
            <tr>
                <th>Employe</th>
                <th>Role</th>
                <th class="text-center">Date d'assignation</th>
            </tr>
        </thead>
        <tbody>
            {assign_rows}
        </tbody>
    </table>

    <div class="safety-section">
        <h3>Instructions de securite</h3>
        <ul>
            <li>Port des EPI obligatoire (casque, lunettes, bottes, gants)</li>
            <li>Respecter les procedures de cadenassage avant toute intervention</li>
            <li>Signaler tout incident ou condition dangereuse au superviseur</li>
            <li>Consulter les fiches de donnees de securite (FDS) pour les produits chimiques</li>
            <li>Maintenir la zone de travail propre et degagee en tout temps</li>
        </ul>
    </div>

    <div class="signatures three-col">
        <div class="signature-block">
            <div class="signature-line">Superviseur</div>
        </div>
        <div class="signature-block">
            <div class="signature-line">Chef d'equipe</div>
        </div>
        <div class="signature-block">
            <div class="signature-line">Client</div>
        </div>
    </div>

    <div class="footer">
        {_esc(company['nom'])} &mdash; Bon de travail genere electroniquement
    </div>
</body>
</html>"""

        return HTMLResponse(content=html)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("export_work_order_html error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la generation du bon de travail")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()
