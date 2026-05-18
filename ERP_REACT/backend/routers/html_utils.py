"""Shared utilities for HTML document generation (headers, footers, company info)."""

import json
import logging
import re

logger = logging.getLogger(__name__)


# ============================================
# DOCUMENT COLOR THEME
# ============================================
#
# Tenant-wide color theme applied to every generated HTML document
# (devis, facture, bon de travail, etc.). Stored as a JSON blob under
# the key `document_theme` inside entreprise_config.config_data.
#
# To add new documents to the theming system, inject the palette from
# `get_document_theme(cursor)` and replace hardcoded hex values with
# {theme['primary']}-style substitutions in the HTML template.

DEFAULT_DOCUMENT_THEME = {
    "primary":       "#1F4E79",  # Entêtes, bandeau titre doc, table headers
    "primary_dark":  "#163a5c",  # Variante foncée (hover boutons, borders importantes)
    "accent":        "#2563eb",  # Accent: sous-titres, bordure gauche info-box
    "accent_light":  "#93c5fd",  # Accent clair: numéro doc affiché sur entête
    "header_text":   "#FFFFFF",  # Texte sur fond primary (entête, table header)
    "table_row_alt": "#F8F9FA",  # Fond alternance lignes tableau
    "info_bg":       "#F8FAFC",  # Fond sections info et totaux
    "border":        "#E9ECEF",  # Bordures fines (lignes tableau, sections)
}

THEME_KEYS = tuple(DEFAULT_DOCUMENT_THEME.keys())

_HEX_COLOR_RE = re.compile(r"^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$")


def _normalize_hex(value: str) -> str:
    """Normalize a hex color string to uppercase #RRGGBB form.

    Accepts 3-digit hex (#abc → #AABBCC) or 6-digit hex. Returns the
    normalized string, or raises ValueError on invalid input.
    """
    if not isinstance(value, str):
        raise ValueError("Couleur invalide: doit être une chaîne")
    v = value.strip()
    if not _HEX_COLOR_RE.match(v):
        raise ValueError(f"Couleur hex invalide: {value!r}")
    if len(v) == 4:  # #abc → #AABBCC
        v = "#" + "".join(ch * 2 for ch in v[1:])
    return v.upper()


def validate_document_theme(obj) -> dict:
    """Validate a partial theme dict and merge with defaults.

    - Unknown keys are silently dropped (forward-compat / typo protection).
    - Each provided value must be a valid hex color (#RGB or #RRGGBB).
    - Missing keys fall back to DEFAULT_DOCUMENT_THEME.

    Raises ValueError if any provided color fails validation.
    """
    if obj is None:
        return dict(DEFAULT_DOCUMENT_THEME)
    if not isinstance(obj, dict):
        raise ValueError("Le thème doit être un objet JSON")
    merged = dict(DEFAULT_DOCUMENT_THEME)
    for key in THEME_KEYS:
        if key in obj and obj[key] is not None and str(obj[key]).strip():
            merged[key] = _normalize_hex(obj[key])
    return merged


def get_document_theme(cursor) -> dict:
    """Fetch the tenant's document_theme from entreprise_config.

    Returns the merged theme (tenant overrides ∪ defaults). Any fetch
    or parse failure silently returns the default theme so document
    generation never crashes because of bad theme data.
    """
    try:
        cursor.execute("SELECT config_data FROM entreprise_config LIMIT 1")
        row = cursor.fetchone()
        if not row or not row.get("config_data"):
            return dict(DEFAULT_DOCUMENT_THEME)
        cfg = row["config_data"]
        if isinstance(cfg, str):
            cfg = json.loads(cfg)
        if not isinstance(cfg, dict):
            return dict(DEFAULT_DOCUMENT_THEME)
        raw = cfg.get("document_theme")
        if isinstance(raw, str) and raw.strip():
            try:
                raw = json.loads(raw)
            except (ValueError, TypeError):
                return dict(DEFAULT_DOCUMENT_THEME)
        if not isinstance(raw, dict):
            return dict(DEFAULT_DOCUMENT_THEME)
        try:
            return validate_document_theme(raw)
        except ValueError:
            return dict(DEFAULT_DOCUMENT_THEME)
    except Exception:
        logger.debug("get_document_theme: entreprise_config not available")
        return dict(DEFAULT_DOCUMENT_THEME)


def get_company_info(cursor) -> dict:
    """Fetch company info from entreprise_config (supports all key formats).

    The config_data JSONB may contain keys from different sources:
    - React frontend: company_name, company_address, company_phone, ...
    - Legacy Streamlit: nom, adresse, telephone_bureau, email, ...
    - Old mapping: nom_entreprise, courriel, numero_rbq, ...

    This function checks all variants and returns a normalized dict.
    """
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
                cfg = json.loads(cfg)
            for info_key, candidates in _KEY_VARIANTS.items():
                for ck in candidates:
                    if ck in cfg and cfg[ck]:
                        info[info_key] = str(cfg[ck])
                        break
    except Exception:
        logger.debug("get_company_info: entreprise_config not available")
    return info


def build_company_header_html(company: dict, theme: dict = None) -> str:
    """Build HTML header block with company info.

    `theme` is an optional dict from get_document_theme() used to color the
    company name. Falls back to the default primary color when omitted.
    """

    def _esc(val):
        if val is None:
            return ""
        s = str(val)
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

    primary = (theme or DEFAULT_DOCUMENT_THEME).get("primary", "#1F4E79")
    nom = _esc(company.get("nom", ""))
    lines = f'<div style="font-size:18px;font-weight:bold;color:{primary};">{nom}</div>'
    lines += '<div style="font-size:12px;color:#555;line-height:1.6;">'

    if company.get("adresse"):
        addr = _esc(company["adresse"])
        ville_parts = [p for p in [company.get("ville"), company.get("province"), company.get("code_postal")] if p]
        if ville_parts:
            addr += "<br>" + ", ".join([_esc(v) for v in ville_parts])
        lines += f'{addr}<br>'
    if company.get("telephone"):
        lines += f'Tel: {_esc(company["telephone"])}<br>'
    if company.get("courriel"):
        lines += f'{_esc(company["courriel"])}<br>'
    if company.get("rbq"):
        lines += f'RBQ: {_esc(company["rbq"])}<br>'
    if company.get("neq"):
        lines += f'NEQ: {_esc(company["neq"])}<br>'
    if company.get("tps"):
        lines += f'TPS: {_esc(company["tps"])}<br>'
    if company.get("tvq"):
        lines += f'TVQ: {_esc(company["tvq"])}'
    lines += '</div>'
    return lines
