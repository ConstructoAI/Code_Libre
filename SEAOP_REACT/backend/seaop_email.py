"""
SEAOP React Backend - Email Notifications
Sends professional HTML emails via SMTP using the same pattern as the ERP (devis.py).
"""

import html as html_mod
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr, formatdate

from . import seaop_config as cfg

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Branding constants
# ---------------------------------------------------------------------------
_NAVY = "#002050"
_BLUE_BTN = "#1976d2"
_LIGHT_BG = "#f4f6f9"


def _email_wrapper(title: str, body_html: str, cta_url: str, cta_label: str) -> str:
    """Return a full HTML email document with Constructo AI SEAOP branding."""
    esc = html_mod.escape
    return f"""\
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:{_LIGHT_BG};font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_LIGHT_BG};">
<tr><td align="center" style="padding:30px 10px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0"
         style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <!-- Header -->
    <tr><td style="background:{_NAVY};padding:24px 32px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;">Constructo AI &ndash; SEAOP</h1>
    </td></tr>
    <!-- Body -->
    <tr><td style="padding:32px;">
      <h2 style="margin:0 0 16px;color:{_NAVY};font-size:18px;">{esc(title)}</h2>
      {body_html}
      <p style="text-align:center;margin:28px 0 0;">
        <a href="{esc(cta_url)}" target="_blank"
           style="display:inline-block;background:{_BLUE_BTN};color:#ffffff;text-decoration:none;
                  padding:12px 32px;border-radius:6px;font-weight:600;font-size:15px;">
          {esc(cta_label)}
        </a>
      </p>
    </td></tr>
    <!-- Footer -->
    <tr><td style="background:{_LIGHT_BG};padding:16px 32px;text-align:center;font-size:12px;color:#888888;">
      &copy; Constructo AI &ndash; Systeme Electronique d'Appels d'Offres Publics
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Generic send
# ---------------------------------------------------------------------------

def send_email(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Send an email via SMTP.  Returns True on success, False on failure.  Never raises."""
    if not cfg.SMTP_HOST or not cfg.SMTP_USER or not cfg.SMTP_PASSWORD:
        logger.warning("SMTP not configured -- skipping email to %s (subject: %s)", to_email, subject)
        return False

    # Reject CRLF in subject / to_email to prevent header injection
    # (e.g., an attacker sneaking in a second "Bcc: victim@..." header).
    # MIME libraries often encode these, but we fail-fast and log.
    for field_name, value in (("subject", subject), ("to_email", to_email)):
        if "\r" in value or "\n" in value:
            logger.error("Header injection attempt rejected in %s: %r", field_name, value)
            return False

    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = formataddr((cfg.SMTP_FROM_NAME, cfg.SMTP_USER))
        msg["To"] = to_email
        msg["Subject"] = subject
        msg["Date"] = formatdate(localtime=True)
        msg["Reply-To"] = cfg.SMTP_USER

        msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        if cfg.SMTP_USE_SSL:
            with smtplib.SMTP_SSL(cfg.SMTP_HOST, cfg.SMTP_PORT, timeout=30) as server:
                server.login(cfg.SMTP_USER, cfg.SMTP_PASSWORD)
                server.send_message(msg)
        else:
            with smtplib.SMTP(cfg.SMTP_HOST, cfg.SMTP_PORT, timeout=30) as server:
                server.starttls()
                server.login(cfg.SMTP_USER, cfg.SMTP_PASSWORD)
                server.send_message(msg)

        logger.info("Email sent to %s (subject: %s)", to_email, subject)
        return True

    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to_email, exc)
        return False


# ---------------------------------------------------------------------------
# Specific notification emails
# ---------------------------------------------------------------------------

def send_new_soumission_email(
    client_email: str,
    lead_nom: str,
    montant: float,
    reference: str,
) -> bool:
    """Notify client: a new bid was received on their project."""
    esc = html_mod.escape
    base = cfg.SEAOP_BASE_URL.rstrip("/")
    cta_url = f"{base}/mes-projets"

    title = "Nouvelle soumission recue"
    body_html = (
        f"<p style='color:#333;font-size:15px;line-height:1.6;'>"
        f"Une nouvelle soumission de <strong>{esc(f'{montant:,.2f}')}$</strong> "
        f"a ete deposee pour votre projet&nbsp;:</p>"
        f"<p style='color:{_NAVY};font-weight:600;font-size:16px;'>"
        f"{esc(lead_nom)} ({esc(reference)})</p>"
        f"<p style='color:#333;font-size:15px;'>Connectez-vous pour consulter les details "
        f"et comparer les offres.</p>"
    )
    text_body = (
        f"Nouvelle soumission recue\n\n"
        f"Montant : {montant:,.2f}$\n"
        f"Projet : {lead_nom} ({reference})\n\n"
        f"Consultez les details ici : {cta_url}\n\n"
        f"---\nConstructo AI SEAOP"
    )

    html_body = _email_wrapper(title, body_html, cta_url, "Voir les soumissions")
    subject = f"Nouvelle soumission - {reference}"

    return send_email(client_email, subject, html_body, text_body)


def send_soumission_status_email(
    entrepreneur_email: str,
    lead_nom: str,
    statut: str,
    reference: str,
) -> bool:
    """Notify entrepreneur: their bid status changed (accepted/rejected/etc.)."""
    esc = html_mod.escape
    base = cfg.SEAOP_BASE_URL.rstrip("/")
    cta_url = f"{base}/mes-soumissions"

    status_labels = {
        "acceptee": ("Soumission acceptee!", "Felicitations! Votre soumission a ete retenue."),
        "refusee": ("Soumission non retenue", "Votre soumission n'a malheureusement pas ete retenue."),
        "en_evaluation": ("Soumission en evaluation", "Votre soumission est en cours d'evaluation."),
        "vue": ("Soumission consultee", "Votre soumission a ete consultee par le client."),
    }
    title, description = status_labels.get(statut, (f"Statut: {statut}", f"Le statut de votre soumission a change: {statut}."))

    body_html = (
        f"<p style='color:#333;font-size:15px;line-height:1.6;'>{esc(description)}</p>"
        f"<p style='color:{_NAVY};font-weight:600;font-size:16px;'>"
        f"Projet : {esc(lead_nom)} ({esc(reference)})</p>"
        f"<p style='color:#333;font-size:15px;'>Connectez-vous pour voir les details.</p>"
    )
    text_body = (
        f"{title}\n\n"
        f"{description}\n"
        f"Projet : {lead_nom} ({reference})\n\n"
        f"Details : {cta_url}\n\n"
        f"---\nConstructo AI SEAOP"
    )

    html_body = _email_wrapper(title, body_html, cta_url, "Voir ma soumission")
    subject = f"{title} - {reference}"

    return send_email(entrepreneur_email, subject, html_body, text_body)


def send_new_message_email(
    recipient_email: str,
    sender_name: str,
    lead_reference: str,
) -> bool:
    """Notify: a new message was received in a conversation."""
    esc = html_mod.escape
    base = cfg.SEAOP_BASE_URL.rstrip("/")
    cta_url = f"{base}/messages"

    title = "Nouveau message"
    body_html = (
        f"<p style='color:#333;font-size:15px;line-height:1.6;'>"
        f"Vous avez recu un nouveau message de <strong>{esc(sender_name)}</strong> "
        f"concernant le projet&nbsp;:</p>"
        f"<p style='color:{_NAVY};font-weight:600;font-size:16px;'>{esc(lead_reference)}</p>"
        f"<p style='color:#333;font-size:15px;'>Connectez-vous pour lire et repondre.</p>"
    )
    text_body = (
        f"Nouveau message\n\n"
        f"De : {sender_name}\n"
        f"Projet : {lead_reference}\n\n"
        f"Lire le message : {cta_url}\n\n"
        f"---\nConstructo AI SEAOP"
    )

    html_body = _email_wrapper(title, body_html, cta_url, "Lire le message")
    subject = f"Nouveau message - {lead_reference}"

    return send_email(recipient_email, subject, html_body, text_body)


def send_estimation_admin_notification(estimation: dict) -> bool:
    """
    Notify the admin inbox (info@constructoai.ca) when a new estimation request
    is submitted via the public wizard. Returns True on success.
    """
    esc = html_mod.escape
    base = cfg.SEAOP_BASE_URL.rstrip("/")
    admin_email = cfg.ADMIN_NOTIFICATION_EMAIL
    cta_url = f"{base}/administration"
    ref = estimation.get("numero_reference") or f"#{estimation.get('id', '?')}"
    title = f"Nouvelle demande d'estimation — {ref}"

    def row(label: str, value: object) -> str:
        v = str(value) if value not in (None, "") else "—"
        return (
            f"<tr><td style='padding:6px 12px;color:#666;font-size:13px;width:180px;'>{esc(label)}</td>"
            f"<td style='padding:6px 12px;color:#222;font-size:14px;'>{esc(v)}</td></tr>"
        )

    nom_complet = " ".join(
        s for s in (estimation.get("prenom"), estimation.get("nom")) if s
    ).strip() or "—"

    photos = estimation.get("photos") or []
    plans = estimation.get("plans") or []
    attachments_parts: list[str] = []
    if isinstance(photos, list) and photos:
        attachments_parts.append(f"{len(photos)} photo(s)")
    if isinstance(plans, list) and plans:
        attachments_parts.append(f"{len(plans)} plan(s) PDF")
    pieces_jointes = ", ".join(attachments_parts) if attachments_parts else None

    body_html = (
        "<p style='color:#333;font-size:15px;line-height:1.6;'>"
        "Un client a soumis une nouvelle demande d'estimation.</p>"
        "<table role='presentation' cellspacing='0' cellpadding='0' "
        "style='width:100%;border-collapse:collapse;margin:12px 0;"
        "background:#fafafa;border:1px solid #eee;border-radius:6px;'>"
        f"{row('Référence', ref)}"
        f"{row('Corps de métier', estimation.get('corps_metier'))}"
        f"{row('Secteur', estimation.get('secteur'))}"
        f"{row('Type de projet', estimation.get('type_projet'))}"
        f"{row('Urgence', estimation.get('urgence'))}"
        f"{row('Disponibilité', estimation.get('disponibilite'))}"
        f"{row('Date souhaitée', estimation.get('date_souhaitee'))}"
        f"{row('Code postal', estimation.get('code_postal'))}"
        f"{row('Localisation', estimation.get('localisation'))}"
        f"{row('Pièces jointes', pieces_jointes) if pieces_jointes else ''}"
        "<tr><td colspan='2' style='padding:10px 12px;"
        "border-top:1px solid #eee;background:#fff;'></td></tr>"
        f"{row('Contact', nom_complet)}"
        f"{row('Entreprise', estimation.get('entreprise'))}"
        f"{row('Courriel', estimation.get('email'))}"
        f"{row('Téléphone', estimation.get('telephone'))}"
        "</table>"
        "<p style='color:#333;font-size:14px;margin:16px 0 6px;'><strong>Description :</strong></p>"
        f"<p style='color:#333;font-size:14px;line-height:1.6;white-space:pre-wrap;'>"
        f"{esc(estimation.get('description', ''))}</p>"
    )

    text_body = (
        f"Nouvelle demande d'estimation - {ref}\n\n"
        f"Corps de métier : {estimation.get('corps_metier', '—')}\n"
        f"Secteur : {estimation.get('secteur', '—')}\n"
        f"Urgence : {estimation.get('urgence', '—')}\n"
        f"Disponibilité : {estimation.get('disponibilite', '—')}\n"
        f"Code postal : {estimation.get('code_postal', '—')}\n\n"
        f"Contact : {nom_complet}\n"
        f"Entreprise : {estimation.get('entreprise', '—')}\n"
        f"Courriel : {estimation.get('email', '—')}\n"
        f"Téléphone : {estimation.get('telephone', '—')}\n\n"
        f"Description :\n{estimation.get('description', '')}\n\n"
        f"Consulter : {cta_url}\n\n---\nConstructo AI SEAOP"
    )

    html_body = _email_wrapper(title, body_html, cta_url, "Ouvrir l'administration")
    return send_email(admin_email, title, html_body, text_body)


def send_estimation_client_confirmation(estimation: dict) -> bool:
    """
    Confirmation email to the client after submitting an estimation request.
    Promises a response under 24-48h.
    """
    esc = html_mod.escape
    base = cfg.SEAOP_BASE_URL.rstrip("/")
    client_email = estimation.get("email") or ""
    if not client_email:
        return False

    cta_url = f"{base}/services/estimation"
    ref = estimation.get("numero_reference") or f"#{estimation.get('id', '?')}"
    prenom = estimation.get("prenom") or estimation.get("nom") or "cher client"
    title = "Demande d'estimation reçue"

    body_html = (
        f"<p style='color:#333;font-size:15px;line-height:1.6;'>Bonjour {esc(prenom)},</p>"
        "<p style='color:#333;font-size:15px;line-height:1.6;'>"
        "Nous avons bien reçu votre demande d'estimation pour les travaux suivants :</p>"
        f"<p style='color:{_NAVY};font-weight:600;font-size:15px;'>"
        f"{esc(estimation.get('corps_metier', '—'))} — {esc(estimation.get('secteur', '—'))}</p>"
        "<div style='background:#fafafa;border:1px solid #eee;border-radius:6px;padding:12px 16px;margin:12px 0;'>"
        f"<p style='margin:0;color:#666;font-size:13px;'>Votre numéro de référence</p>"
        f"<p style='margin:4px 0 0;color:{_NAVY};font-weight:700;font-family:monospace;font-size:16px;'>"
        f"{esc(ref)}</p></div>"
        "<p style='color:#333;font-size:15px;line-height:1.6;'>"
        "Notre équipe analysera votre demande et vous transmettra une estimation détaillée "
        "<strong>dans un délai de 24 à 48 heures ouvrables</strong>, par courriel à cette adresse.</p>"
        "<p style='color:#333;font-size:14px;line-height:1.6;'>"
        "Pour toute question, répondez directement à ce courriel en conservant le numéro "
        "de référence en objet.</p>"
    )

    text_body = (
        f"Bonjour {prenom},\n\n"
        "Nous avons bien reçu votre demande d'estimation.\n\n"
        f"Corps de métier : {estimation.get('corps_metier', '—')}\n"
        f"Secteur : {estimation.get('secteur', '—')}\n"
        f"Numéro de référence : {ref}\n\n"
        "Notre équipe analysera votre demande et vous transmettra une estimation détaillée "
        "dans un délai de 24 à 48 heures ouvrables, par courriel.\n\n"
        f"Site : {base}\n\n---\nConstructo AI SEAOP"
    )

    html_body = _email_wrapper(title, body_html, cta_url, "Retour au site")
    subject = f"Demande d'estimation reçue — {ref}"
    return send_email(client_email, subject, html_body, text_body)


def send_addendum_email(
    entrepreneur_email: str,
    lead_nom: str,
    addendum_titre: str,
    reference: str,
) -> bool:
    """Notify entrepreneur: a new addendum was published on a project they bid on."""
    esc = html_mod.escape
    base = cfg.SEAOP_BASE_URL.rstrip("/")
    cta_url = f"{base}/projets"

    title = "Nouvel addendum publie"
    body_html = (
        f"<p style='color:#333;font-size:15px;line-height:1.6;'>"
        f"Un addendum a ete publie pour un projet sur lequel vous avez soumissionne&nbsp;:</p>"
        f"<p style='color:{_NAVY};font-weight:600;font-size:16px;'>"
        f"{esc(lead_nom)} ({esc(reference)})</p>"
        f"<p style='color:#333;font-size:15px;'>"
        f"<strong>Addendum :</strong> {esc(addendum_titre)}</p>"
        f"<p style='color:#333;font-size:15px;'>"
        f"Connectez-vous pour consulter les modifications.</p>"
    )
    text_body = (
        f"Nouvel addendum publie\n\n"
        f"Projet : {lead_nom} ({reference})\n"
        f"Addendum : {addendum_titre}\n\n"
        f"Voir les details : {cta_url}\n\n"
        f"---\nConstructo AI SEAOP"
    )

    html_body = _email_wrapper(title, body_html, cta_url, "Voir le projet")
    subject = f"Addendum - {reference}"

    return send_email(entrepreneur_email, subject, html_body, text_body)
