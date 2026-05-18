"""Mobile React — Service de generation PDF documents commerciaux.

Genere un PDF professionnel style QuickBooks pour devis, facture, bon de
travail, bon de commande. Utilise WeasyPrint (HTML -> PDF) avec fallback
sur fpdf2 si WeasyPrint n'est pas disponible (dependances natives Cairo/
Pango parfois problematiques sur Windows dev).

Le HTML est volontairement self-contained (pas de fichiers externes,
pas de fonts custom) pour eviter les surprises de deploiement.
"""

from __future__ import annotations

import html as _html
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers de formattage (francais Quebec)
# ─────────────────────────────────────────────────────────────────────────────

def _fmt_money(value: Optional[float]) -> str:
    """Formatte un montant en '1 234,56 $' (francais Quebec)."""
    try:
        v = float(value or 0)
    except (TypeError, ValueError):
        v = 0.0
    sign = "-" if v < 0 else ""
    v = abs(v)
    integer_part = int(v)
    decimal_part = int(round((v - integer_part) * 100))
    # Espace insecable narrow pour separateur de milliers (mais ASCII pour PDF)
    int_str = f"{integer_part:,}".replace(",", " ")
    return f"{sign}{int_str},{decimal_part:02d} $"


def _fmt_qty(value: Optional[float]) -> str:
    """Formatte une quantite : 1 / 1,5 / 12,75."""
    try:
        v = float(value or 0)
    except (TypeError, ValueError):
        v = 0.0
    if v == int(v):
        return str(int(v))
    return f"{v:.2f}".rstrip("0").rstrip(".").replace(".", ",")


def _fmt_date(value: Optional[str]) -> str:
    """ISO date -> 'YYYY-MM-DD'. None -> '-'."""
    if not value:
        return "-"
    s = str(value).strip()
    if not s or s.lower() == "none":
        return "-"
    # Garde seulement la partie date
    if "T" in s:
        s = s.split("T", 1)[0]
    elif " " in s:
        s = s.split(" ", 1)[0]
    return s


def _e(value) -> str:
    """HTML-escape un str/None."""
    if value is None:
        return ""
    return _html.escape(str(value))


# ─────────────────────────────────────────────────────────────────────────────
# Templating HTML
# ─────────────────────────────────────────────────────────────────────────────

_CSS = """
@page { size: Letter; margin: 18mm 16mm 18mm 16mm; }
* { box-sizing: border-box; }
body {
  font-family: 'Helvetica', 'Arial', sans-serif;
  color: #1f2937;
  font-size: 10pt;
  line-height: 1.4;
  margin: 0;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 2px solid #0078D4;
  padding-bottom: 12px;
  margin-bottom: 18px;
}
.brand {
  font-size: 18pt;
  font-weight: 700;
  color: #0078D4;
  letter-spacing: 0.5px;
}
.brand-sub {
  font-size: 8.5pt;
  color: #6b7280;
  margin-top: 2px;
}
.doc-meta {
  text-align: right;
  font-size: 9pt;
}
.doc-meta .doc-type {
  font-size: 16pt;
  font-weight: 700;
  text-transform: uppercase;
  color: #111827;
  letter-spacing: 1px;
}
.doc-meta .doc-numero {
  font-size: 11pt;
  font-weight: 600;
  color: #374151;
  margin-top: 4px;
}
.doc-meta .doc-date {
  color: #6b7280;
  margin-top: 2px;
}
.parties {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 22px;
}
.party {
  flex: 1;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 12px 14px;
}
.party h3 {
  font-size: 8.5pt;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: #6b7280;
  margin: 0 0 6px 0;
  font-weight: 600;
}
.party .name {
  font-size: 11pt;
  font-weight: 700;
  color: #111827;
  margin-bottom: 2px;
}
.party .line { font-size: 9pt; color: #4b5563; }
.section-title {
  font-size: 9pt;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: #6b7280;
  font-weight: 600;
  margin: 18px 0 6px 0;
}
table.lines {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 14px;
}
table.lines thead th {
  background: #0078D4;
  color: #ffffff;
  text-align: left;
  padding: 8px 10px;
  font-size: 9pt;
  font-weight: 600;
  border: 1px solid #0078D4;
}
table.lines thead th.num,
table.lines thead th.qty,
table.lines thead th.price,
table.lines thead th.amount { text-align: right; }
table.lines tbody td {
  padding: 7px 10px;
  font-size: 9.5pt;
  border-bottom: 1px solid #e5e7eb;
  vertical-align: top;
}
table.lines tbody tr:nth-child(even) td { background: #f9fafb; }
table.lines td.num,
table.lines td.qty,
table.lines td.price,
table.lines td.amount { text-align: right; white-space: nowrap; }
table.lines td.amount { font-weight: 600; }
.totals {
  margin-left: auto;
  width: 280px;
}
.totals table { width: 100%; border-collapse: collapse; }
.totals td { padding: 5px 10px; font-size: 10pt; }
.totals td.label { color: #6b7280; }
.totals td.value { text-align: right; font-weight: 600; color: #111827; }
.totals tr.grand td {
  font-size: 12pt;
  font-weight: 700;
  color: #0078D4;
  border-top: 2px solid #0078D4;
  padding-top: 8px;
  padding-bottom: 8px;
}
.notes {
  margin-top: 18px;
  padding: 10px 12px;
  background: #f3f4f6;
  border-left: 3px solid #0078D4;
  font-size: 9pt;
  color: #4b5563;
}
.notes .lbl {
  font-weight: 600;
  color: #374151;
  margin-bottom: 3px;
  display: block;
}
.footer {
  margin-top: 28px;
  padding-top: 10px;
  border-top: 1px solid #e5e7eb;
  font-size: 8pt;
  color: #6b7280;
  text-align: center;
  line-height: 1.5;
}
/* ── Watermark filigrane (BROUILLON / ANNULE / PAYE) ──────────────────── */
.watermark {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-30deg);
  font-size: 140pt;
  font-weight: 900;
  letter-spacing: 8px;
  text-transform: uppercase;
  opacity: 0.15;
  z-index: 9999;
  pointer-events: none;
  white-space: nowrap;
  font-family: 'Helvetica', 'Arial', sans-serif;
}
.watermark-brouillon { color: #6b7280; }   /* gris pale */
.watermark-annule    { color: #dc2626; }   /* rouge */
.watermark-paye      { color: #16a34a; }   /* vert */
"""


def _build_address_block(party: dict) -> str:
    """Construit un bloc d'adresse multi-lignes a partir d'un dict tenant/client."""
    if not party:
        return ""
    parts = []
    adresse = (party.get("adresse") or "").strip()
    if adresse:
        parts.append(f'<div class="line">{_e(adresse)}</div>')
    ville_line_bits = []
    if party.get("ville"):
        ville_line_bits.append(_e(party.get("ville")))
    if party.get("province"):
        ville_line_bits.append(_e(party.get("province")))
    ville_line = ", ".join(ville_line_bits)
    if party.get("code_postal"):
        ville_line = (ville_line + " " + _e(party.get("code_postal"))).strip()
    if ville_line:
        parts.append(f'<div class="line">{ville_line}</div>')
    if party.get("telephone"):
        parts.append(f'<div class="line">Tel : {_e(party.get("telephone"))}</div>')
    if party.get("email"):
        parts.append(f'<div class="line">{_e(party.get("email"))}</div>')
    # Numero TPS/TVQ tenant ou client
    if party.get("numero_tps"):
        parts.append(f'<div class="line">No TPS : {_e(party.get("numero_tps"))}</div>')
    if party.get("numero_tvq"):
        parts.append(f'<div class="line">No TVQ : {_e(party.get("numero_tvq"))}</div>')
    if party.get("numero_neq"):
        parts.append(f'<div class="line">NEQ : {_e(party.get("numero_neq"))}</div>')
    return "".join(parts)


def _compute_watermark(statut: Optional[str]) -> tuple[str, str]:
    """Retourne (texte, classe_css) du watermark selon le statut.

    - BROUILLON               -> ("BROUILLON", "watermark-brouillon")  gris
    - ANNULE/ANNULEE/REFUSE   -> ("ANNULE",    "watermark-annule")     rouge
    - PAYE/PAYEE              -> ("PAYE",      "watermark-paye")       vert
    - autres (ENVOYE, etc.)   -> ("", "")  pas de watermark
    """
    if not statut:
        return ("", "")
    s = str(statut).upper().strip()
    if s == "BROUILLON":
        return ("BROUILLON", "watermark-brouillon")
    if s in ("ANNULE", "ANNULEE", "REFUSE", "REFUSEE"):
        # Accent retire pour eviter problemes de rendu cross-fonts
        return ("ANNULE", "watermark-annule")
    if s in ("PAYE", "PAYEE"):
        return ("PAYE", "watermark-paye")
    return ("", "")


def render_document_html(data: dict) -> str:
    """Construit le HTML complet du document a convertir en PDF."""
    tenant = data.get("tenant") or {}
    client = data.get("client") or {}
    doc = data.get("doc") or {}
    lignes = data.get("lignes") or []
    totaux = data.get("totaux") or {}
    doc_type_label = data.get("doc_type_label") or "Document"

    # Lignes du tableau
    if lignes:
        rows_html = []
        for idx, l in enumerate(lignes, start=1):
            qty = _fmt_qty(l.get("quantite"))
            unite = _e(l.get("unite") or "")
            qty_display = f"{qty} {unite}".strip()
            rows_html.append(
                f"<tr>"
                f'<td class="num">{idx}</td>'
                f'<td>{_e(l.get("description") or "")}</td>'
                f'<td class="qty">{qty_display}</td>'
                f'<td class="price">{_fmt_money(l.get("prix_unitaire"))}</td>'
                f'<td class="amount">{_fmt_money(l.get("montant_ligne"))}</td>'
                f"</tr>"
            )
        lines_body = "".join(rows_html)
    else:
        lines_body = (
            '<tr><td colspan="5" style="text-align:center;color:#9ca3af;'
            'padding:18px;">Aucune ligne</td></tr>'
        )

    # Notes / description
    notes_block = ""
    notes_text = (doc.get("notes") or doc.get("description") or "").strip()
    if notes_text:
        notes_block = (
            '<div class="notes">'
            '<span class="lbl">Notes</span>'
            f'{_e(notes_text)}'
            '</div>'
        )

    # Footer Quebec
    footer_bits = []
    tenant_nom = tenant.get("nom") or "Constructo AI"
    footer_bits.append(_e(tenant_nom))
    if tenant.get("numero_neq"):
        footer_bits.append(f'NEQ : {_e(tenant.get("numero_neq"))}')
    if tenant.get("numero_tps"):
        footer_bits.append(f'TPS : {_e(tenant.get("numero_tps"))}')
    if tenant.get("numero_tvq"):
        footer_bits.append(f'TVQ : {_e(tenant.get("numero_tvq"))}')
    footer_line1 = " &nbsp;&middot;&nbsp; ".join(footer_bits)
    footer_line2 = (
        "Conditions de paiement : net 30 jours. Tout solde impaye apres "
        "30 jours porte interet a 1,5 % par mois (18 % annuel). "
        "Document genere par Constructo AI."
    )

    # Date emission
    today_str = datetime.now().strftime("%Y-%m-%d")
    date_emission = _fmt_date(doc.get("date_creation")) or today_str
    date_echeance = _fmt_date(doc.get("date_echeance"))

    # Watermark filigrane selon statut (BROUILLON / ANNULE / PAYE)
    wm_text, wm_class = _compute_watermark(doc.get("statut"))
    watermark_block = (
        f'<div class="watermark {wm_class}">{_e(wm_text)}</div>'
        if wm_text else ""
    )

    html = f"""<!DOCTYPE html>
<html lang="fr-CA">
<head>
<meta charset="utf-8">
<title>{_e(doc_type_label)} {_e(doc.get('numero') or '')}</title>
<style>{_CSS}</style>
</head>
<body>
{watermark_block}
<div class="header">
  <div>
    <div class="brand">{_e(tenant_nom)}</div>
    <div class="brand-sub">{_build_address_block(tenant) or '&nbsp;'}</div>
  </div>
  <div class="doc-meta">
    <div class="doc-type">{_e(doc_type_label)}</div>
    <div class="doc-numero">{_e(doc.get('numero') or '')}</div>
    <div class="doc-date">Emission : {_e(date_emission)}</div>
    {f'<div class="doc-date">Echeance : {_e(date_echeance)}</div>' if date_echeance and date_echeance != '-' else ''}
    {f'<div class="doc-date">Statut : {_e((doc.get("statut") or "").title())}</div>' if doc.get('statut') else ''}
  </div>
</div>

<div class="parties">
  <div class="party">
    <h3>Client</h3>
    <div class="name">{_e(client.get('nom') or '-')}</div>
    {_build_address_block(client)}
  </div>
  <div class="party">
    <h3>Projet / Reference</h3>
    <div class="name">{_e(doc.get('nom_projet') or '-')}</div>
    {f'<div class="line">Priorite : {_e(doc.get("priorite"))}</div>' if doc.get('priorite') else ''}
  </div>
</div>

<div class="section-title">Details</div>
<table class="lines">
  <thead>
    <tr>
      <th class="num" style="width:30px;">#</th>
      <th>Description</th>
      <th class="qty" style="width:80px;">Qte</th>
      <th class="price" style="width:90px;">Prix unit.</th>
      <th class="amount" style="width:100px;">Montant</th>
    </tr>
  </thead>
  <tbody>
    {lines_body}
  </tbody>
</table>

<div class="totals">
  <table>
    <tr>
      <td class="label">Sous-total HT</td>
      <td class="value">{_fmt_money(totaux.get('sous_total'))}</td>
    </tr>
    <tr>
      <td class="label">TPS (5 %)</td>
      <td class="value">{_fmt_money(totaux.get('tps'))}</td>
    </tr>
    <tr>
      <td class="label">TVQ (9,975 %)</td>
      <td class="value">{_fmt_money(totaux.get('tvq'))}</td>
    </tr>
    <tr class="grand">
      <td class="label">Total TTC</td>
      <td class="value">{_fmt_money(totaux.get('total'))}</td>
    </tr>
  </table>
</div>

{notes_block}

<div class="footer">
  <div>{footer_line1}</div>
  <div style="margin-top:4px;">{footer_line2}</div>
</div>

</body>
</html>"""
    return html


# ─────────────────────────────────────────────────────────────────────────────
# Backend de conversion HTML -> PDF (WeasyPrint preferred, fpdf2 fallback)
# ─────────────────────────────────────────────────────────────────────────────

def _render_with_weasyprint(html: str) -> Optional[bytes]:
    """Tente la conversion via WeasyPrint. Retourne None si indisponible."""
    try:
        from weasyprint import HTML  # type: ignore
    except Exception as e:
        logger.warning(f"[PDF] WeasyPrint indisponible : {e}")
        return None
    try:
        return HTML(string=html).write_pdf()
    except Exception as e:
        logger.error(f"[PDF] WeasyPrint a echoue lors du rendu : {e}")
        return None


def _render_with_fpdf2_fallback(data: dict) -> bytes:
    """Fallback minimaliste avec fpdf2 si WeasyPrint indispo. Layout
    simplifie mais lisible. Utilise par exemple sur Windows dev sans Cairo."""
    try:
        from fpdf import FPDF  # type: ignore
    except Exception as e:
        raise RuntimeError(
            "Aucune lib PDF disponible (WeasyPrint et fpdf2 absents). "
            f"Erreur fpdf2: {e}"
        )

    tenant = data.get("tenant") or {}
    client = data.get("client") or {}
    doc = data.get("doc") or {}
    lignes = data.get("lignes") or []
    totaux = data.get("totaux") or {}
    doc_type_label = data.get("doc_type_label") or "Document"

    pdf = FPDF(orientation="P", unit="mm", format="Letter")
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=18)

    def _safe(s):
        # fpdf2 core fonts = latin-1 only; on degrade les caracteres hors-charset
        if s is None:
            return ""
        return str(s).encode("latin-1", "replace").decode("latin-1")

    # En-tete
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(0, 120, 212)
    pdf.cell(0, 10, _safe(tenant.get("nom") or "Constructo AI"), ln=True)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(80, 80, 80)
    addr_bits = []
    for k in ("adresse", "ville", "telephone", "email"):
        if tenant.get(k):
            addr_bits.append(str(tenant.get(k)))
    if addr_bits:
        pdf.cell(0, 5, _safe(" | ".join(addr_bits)), ln=True)
    pdf.ln(4)

    # Type + numero
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(0, 8, _safe(f"{doc_type_label} — {doc.get('numero') or ''}"), ln=True)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 5, _safe(f"Emission : {_fmt_date(doc.get('date_creation'))}"), ln=True)
    pdf.ln(3)

    # Client
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(0, 6, "CLIENT", ln=True)
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 5, _safe(client.get("nom") or "-"), ln=True)
    for k in ("adresse", "ville", "telephone"):
        if client.get(k):
            pdf.cell(0, 5, _safe(str(client.get(k))), ln=True)
    pdf.ln(4)

    # Tableau
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(0, 120, 212)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(85, 7, " Description", border=0, fill=True)
    pdf.cell(25, 7, "Qte", border=0, fill=True, align="R")
    pdf.cell(35, 7, "Prix unit.", border=0, fill=True, align="R")
    pdf.cell(35, 7, "Montant", border=0, fill=True, align="R")
    pdf.ln()
    pdf.set_text_color(20, 20, 20)
    pdf.set_font("Helvetica", "", 9)
    for idx, l in enumerate(lignes):
        if idx % 2 == 0:
            pdf.set_fill_color(249, 250, 251)
        else:
            pdf.set_fill_color(255, 255, 255)
        desc = (l.get("description") or "")[:65]
        pdf.cell(85, 6, _safe(" " + desc), border=0, fill=True)
        pdf.cell(25, 6, _safe(_fmt_qty(l.get("quantite")) + " " + (l.get("unite") or "")), border=0, fill=True, align="R")
        pdf.cell(35, 6, _safe(_fmt_money(l.get("prix_unitaire"))), border=0, fill=True, align="R")
        pdf.cell(35, 6, _safe(_fmt_money(l.get("montant_ligne"))), border=0, fill=True, align="R")
        pdf.ln()

    pdf.ln(4)
    # Totaux
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(110, 6, "", border=0)
    pdf.cell(35, 6, "Sous-total HT", border=0, align="R")
    pdf.cell(35, 6, _safe(_fmt_money(totaux.get("sous_total"))), border=0, align="R")
    pdf.ln()
    pdf.cell(110, 6, "", border=0)
    pdf.cell(35, 6, "TPS (5 %)", border=0, align="R")
    pdf.cell(35, 6, _safe(_fmt_money(totaux.get("tps"))), border=0, align="R")
    pdf.ln()
    pdf.cell(110, 6, "", border=0)
    pdf.cell(35, 6, "TVQ (9,975 %)", border=0, align="R")
    pdf.cell(35, 6, _safe(_fmt_money(totaux.get("tvq"))), border=0, align="R")
    pdf.ln()
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(0, 120, 212)
    pdf.cell(110, 8, "", border=0)
    pdf.cell(35, 8, "Total TTC", border="T", align="R")
    pdf.cell(35, 8, _safe(_fmt_money(totaux.get("total"))), border="T", align="R")
    pdf.ln()

    # Notes
    notes_text = (doc.get("notes") or doc.get("description") or "").strip()
    if notes_text:
        pdf.ln(6)
        pdf.set_text_color(80, 80, 80)
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(0, 5, "NOTES", ln=True)
        pdf.set_font("Helvetica", "", 9)
        pdf.multi_cell(0, 5, _safe(notes_text))

    out = pdf.output(dest="S")
    if isinstance(out, str):
        # fpdf2 v1 retourne str latin-1
        return out.encode("latin-1", "replace")
    if isinstance(out, bytearray):
        return bytes(out)
    return out  # bytes


def generate_document_pdf(data: dict) -> bytes:
    """Genere les bytes du PDF a partir du dict retourne par
    get_document_for_pdf(). Essaie WeasyPrint d'abord puis fpdf2 fallback."""
    html = render_document_html(data)
    pdf_bytes = _render_with_weasyprint(html)
    if pdf_bytes:
        return pdf_bytes
    logger.warning("[PDF] Bascule sur fpdf2 fallback (WeasyPrint indispo)")
    return _render_with_fpdf2_fallback(data)


def safe_filename(doc_type_label: str, numero: Optional[str]) -> str:
    """Genere un nom de fichier ASCII-safe pour Content-Disposition.

    Bloque explicitement path traversal (..), backslashes, control chars
    et quotes (anti-injection header HTTP).
    """
    import re as _re
    # Anti-path-traversal explicite
    _BLOCKED = _re.compile(r'(\.\.|[\\/\x00-\x1f"])')
    label = _BLOCKED.sub("_", (doc_type_label or "document").strip().replace(" ", "_"))
    num = _BLOCKED.sub("_", (numero or "").replace(" ", "_"))
    # Strip non-ASCII
    label_ascii = label.encode("ascii", "ignore").decode("ascii").strip("._") or "document"
    num_ascii = num.encode("ascii", "ignore").decode("ascii").strip("._") or "doc"
    # Cap longueur (FAT32: 255)
    return f"{label_ascii[:100]}_{num_ascii[:100]}.pdf"
