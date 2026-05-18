"""
SEAOP React - Leads Router
Endpoints for creating, listing, viewing, and updating project leads (appels d'offres).
"""

import asyncio
import logging
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Depends

from ..seaop_models import LeadCreate, LeadUpdate, LeadResponse, LeadListResponse, AddendumCreate, AddendumResponse
from ..seaop_auth import get_current_user, get_optional_user, require_role, SeaopUser
from .. import seaop_database as db
from ..seaop_email import send_addendum_email, send_email
from .. import seaop_config as cfg

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/leads", tags=["Leads"])


# ============================================
# URGENCY CALCULATION
# ============================================

def calculate_urgency(date_limite_soumissions, date_debut_souhaite) -> str:
    """
    Auto-calculate urgency level based on submission deadline and desired start date.

    Returns:
        "critique" - 3 days or less remaining
        "eleve"    - 4 to 7 days remaining
        "normal"   - 8 to 14 days remaining
        "faible"   - more than 14 days remaining
    """
    if not date_limite_soumissions:
        return "normal"
    today = date.today()
    # Handle both date objects and strings
    if isinstance(date_limite_soumissions, str):
        try:
            date_limite_soumissions = date.fromisoformat(date_limite_soumissions)
        except (ValueError, TypeError):
            return "normal"
    days_remaining = (date_limite_soumissions - today).days
    if days_remaining <= 3:
        return "critique"
    elif days_remaining <= 7:
        return "eleve"
    elif days_remaining <= 14:
        return "normal"
    return "faible"


# ============================================
# LIST LEADS (PUBLIC)
# ============================================

@router.get("", response_model=LeadListResponse)
async def list_leads(
    type_projet: Optional[str] = Query(None, description="Filtrer par type de projet"),
    recherche: Optional[str] = Query(None, description="Recherche textuelle"),
    region: Optional[str] = Query(None, description="Filtrer par région du Québec (code postal)"),
    trier_par: str = Query("date_desc", description="Tri: date_desc, date_asc, budget_desc, budget_asc, urgence"),
    page: int = Query(1, ge=1, description="Numéro de page"),
    per_page: int = Query(20, ge=1, le=100, description="Résultats par page"),
    user: Optional[SeaopUser] = Depends(get_optional_user),
):
    """
    List available leads (appels d'offres) with filtering, search, sorting, and pagination.
    This is a public endpoint - authentication is optional.
    Only returns leads where visible_entrepreneurs=True and accepte_soumissions=True.
    """
    try:
        leads, total = db.get_available_leads(
            page=page,
            per_page=per_page,
            type_projet=type_projet,
            recherche=recherche,
            trier_par=trier_par,
            region=region,
        )
    except Exception as exc:
        logger.error("Error fetching leads: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la récupération des projets")

    return LeadListResponse(
        items=[LeadResponse(**lead) for lead in leads],
        total=total,
        page=page,
        per_page=per_page,
    )


# ============================================
# CLIENT'S OWN PROJECTS
# ============================================

@router.get("/mes-projets")
async def my_projects(
    user: SeaopUser = Depends(require_role("client")),
):
    """
    List all projects belonging to the authenticated client (by email).
    Requires client session authentication.
    """
    if not user.email:
        raise HTTPException(status_code=400, detail="Email non disponible dans la session")

    try:
        leads = db.get_leads_by_email(user.email)
    except Exception as exc:
        logger.error("Error fetching client leads: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la récupération de vos projets")

    return {
        "items": [LeadResponse(**lead) for lead in leads],
        "total": len(leads),
        "email": user.email,
    }


# ============================================
# SINGLE LEAD DETAIL (PUBLIC)
# ============================================

@router.get("/{lead_id}", response_model=LeadResponse)
async def get_lead(
    lead_id: int,
    user: Optional[SeaopUser] = Depends(get_optional_user),
):
    """
    Get a single lead by ID. Public endpoint.
    Returns full lead details including submission count.
    """
    lead = db.get_lead_by_id(lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Projet non trouvé")
    return LeadResponse(**lead)


# ============================================
# CREATE LEAD
# ============================================

@router.post("", response_model=LeadResponse, status_code=201)
async def create_lead(
    body: LeadCreate,
    user: Optional[SeaopUser] = Depends(get_optional_user),
):
    """
    Create a new lead (appel d'offres / project request).

    If the user is authenticated as a client, the email from the session is used.
    Otherwise the email from the request body is used (anonymous submission).

    Auto-generates a reference number (SEAOP-YYYYMMDD-XXXXXXXX).
    Auto-calculates urgency level from submission deadline.
    """
    # Use session email if client is authenticated, otherwise body email
    email = body.email
    if user and user.user_type == "client" and user.email:
        email = user.email

    # Auto-calculate urgency if not explicitly set or set to default
    urgency = body.niveau_urgence
    if urgency == "normal" or not urgency:
        urgency = calculate_urgency(body.date_limite_soumissions, body.date_debut_souhaite)

    lead_data = {
        "nom": body.nom,
        "email": email,
        "telephone": body.telephone,
        "code_postal": body.code_postal,
        "type_projet": body.type_projet,
        "description": body.description,
        "budget": body.budget,
        "delai_realisation": body.delai_realisation,
        "date_limite_soumissions": body.date_limite_soumissions,
        "date_debut_souhaite": body.date_debut_souhaite,
        "niveau_urgence": urgency,
        "photos": body.photos,
        "plans": body.plans,
        "documents": body.documents,
        # numero_reference is auto-generated by db.create_lead
        # CNESST / Compliance fields
        "rbq_requis": body.rbq_requis,
        "categories_rbq_requises": body.categories_rbq_requises,
        "cnesst_requis": body.cnesst_requis,
        "assurance_requise": body.assurance_requise,
        "montant_assurance_min": body.montant_assurance_min,
        "cautionnement_requis": body.cautionnement_requis,
        "pourcentage_cautionnement": body.pourcentage_cautionnement,
    }

    try:
        lead = db.create_lead(lead_data)
    except Exception as exc:
        logger.error("Error creating lead: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la création du projet")

    logger.info("Lead created: id=%s ref=%s", lead["id"], lead.get("numero_reference"))

    # Send confirmation email with reference number to client
    try:
        ref = lead.get("numero_reference", "")
        nom_projet = lead.get("nom", "Votre projet")
        base_url = cfg.SEAOP_BASE_URL.rstrip("/")
        projet_url = f"{base_url}/projet/{lead['id']}"
        login_url = f"{base_url}/login"

        html_body = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a56db;">SEAOP - Confirmation de publication</h2>
            <p>Bonjour,</p>
            <p>Votre appel d'offres <strong>{nom_projet}</strong> a &eacute;t&eacute; publi&eacute; avec succ&egrave;s sur la plateforme SEAOP.</p>
            <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
                <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 14px;">Votre num&eacute;ro de r&eacute;f&eacute;rence</p>
                <p style="margin: 0; font-size: 22px; font-weight: bold; color: #1a56db; font-family: monospace;">{ref}</p>
            </div>
            <p><strong>Conservez ce num&eacute;ro pr&eacute;cieusement.</strong> Il vous sera demand&eacute; pour vous connecter et consulter les soumissions re&ccedil;ues.</p>
            <p>Pour acc&eacute;der &agrave; votre projet :</p>
            <ol>
                <li>Rendez-vous sur <a href="{login_url}">{login_url}</a></li>
                <li>S&eacute;lectionnez l'onglet <strong>Client</strong></li>
                <li>Entrez votre courriel et votre num&eacute;ro de r&eacute;f&eacute;rence</li>
            </ol>
            <p style="margin-top: 20px;">
                <a href="{projet_url}" style="background: #1a56db; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">Voir mon projet</a>
            </p>
            <hr style="margin-top: 30px; border: none; border-top: 1px solid #e5e7eb;" />
            <p style="color: #9ca3af; font-size: 12px;">Ceci est un courriel automatique de la plateforme SEAOP. Ne r&eacute;pondez pas &agrave; ce message.</p>
        </div>
        """

        text_body = (
            f"SEAOP - Confirmation de publication\n\n"
            f"Bonjour,\n\n"
            f"Votre appel d'offres \"{nom_projet}\" a ete publie avec succes.\n\n"
            f"Votre numero de reference : {ref}\n\n"
            f"Conservez ce numero precieusement. Il vous sera demande pour vous connecter "
            f"et consulter les soumissions recues.\n\n"
            f"Pour acceder a votre projet :\n"
            f"1. Rendez-vous sur {login_url}\n"
            f"2. Selectionnez l'onglet Client\n"
            f"3. Entrez votre courriel et votre numero de reference\n\n"
            f"Voir mon projet : {projet_url}\n"
        )

        loop = asyncio.get_running_loop()
        loop.run_in_executor(
            None,
            send_email,
            lead["email"],
            f"Votre appel d'offres {ref} - SEAOP",
            html_body,
            text_body,
        )
    except Exception as exc:
        logger.warning("Failed to send confirmation email for lead %s: %s", lead["id"], exc)

    return LeadResponse(**lead)


# ============================================
# UPDATE LEAD
# ============================================

@router.put("/{lead_id}", response_model=LeadResponse)
async def update_lead(
    lead_id: int,
    body: LeadUpdate,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Update an existing lead.
    Requires authentication as the owning client (matching email) or admin.
    """
    # Verify lead exists
    existing = db.get_lead_by_id(lead_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Projet non trouvé")

    # Authorization: client must own the lead, admin can update any
    if user.user_type == "client":
        if user.email != existing.get("email"):
            raise HTTPException(
                status_code=403,
                detail="Vous ne pouvez modifier que vos propres projets",
            )
    elif user.user_type not in ("admin", "super_admin", "entrepreneur"):
        raise HTTPException(status_code=403, detail="Accès refusé")

    # Build update dict from non-None fields
    update_data = body.model_dump(exclude_unset=True, exclude_none=True)
    if not update_data:
        # Nothing to update, return existing
        return LeadResponse(**existing)

    # Recalculate urgency if deadline fields changed
    if "date_limite_soumissions" in update_data or "date_debut_souhaite" in update_data:
        new_deadline = update_data.get(
            "date_limite_soumissions",
            existing.get("date_limite_soumissions"),
        )
        new_start = update_data.get(
            "date_debut_souhaite",
            existing.get("date_debut_souhaite"),
        )
        # Only auto-recalculate if urgency is not explicitly being set
        if "niveau_urgence" not in update_data:
            update_data["niveau_urgence"] = calculate_urgency(new_deadline, new_start)

    try:
        updated = db.update_lead(lead_id, update_data)
    except Exception as exc:
        logger.error("Error updating lead %s: %s", lead_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise à jour du projet")

    if not updated:
        raise HTTPException(status_code=404, detail="Projet non trouvé après mise à jour")

    return LeadResponse(**updated)


# ============================================
# ADDENDA
# ============================================

@router.get("/{lead_id}/addenda", response_model=List[AddendumResponse])
async def get_addenda(
    lead_id: int,
    user: Optional[SeaopUser] = Depends(get_optional_user),
):
    """
    List all addenda for a lead. Public endpoint.
    """
    lead = db.get_lead_by_id(lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Projet non trouve")

    try:
        addenda = db.get_addenda(lead_id)
    except Exception as exc:
        logger.error("Error fetching addenda for lead %s: %s", lead_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des addenda")

    return [AddendumResponse(**a) for a in addenda]


@router.post("/{lead_id}/addenda", response_model=AddendumResponse, status_code=201)
async def create_addendum(
    lead_id: int,
    body: AddendumCreate,
    user: SeaopUser = Depends(get_current_user),
):
    """
    Create a new addendum for a lead.
    Only the lead owner (client with matching email) or admin can create addenda.
    Notifies all entrepreneurs who have submitted on this lead.
    """
    lead = db.get_lead_by_id(lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Projet non trouve")

    # Authorization: client must own the lead, or admin/super_admin
    if user.user_type == "client":
        if user.email != lead.get("email"):
            raise HTTPException(
                status_code=403,
                detail="Vous ne pouvez ajouter des addenda qu'a vos propres projets",
            )
    elif user.user_type not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Acces refuse")

    addendum_data = {
        "titre": body.titre,
        "description": body.description,
        "auteur_email": user.email,
    }

    try:
        addendum = db.create_addendum(lead_id, addendum_data)
    except Exception as exc:
        logger.error("Error creating addendum for lead %s: %s", lead_id, exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de l'addendum")

    # Notify all entrepreneurs who have submitted on this lead
    try:
        soumissions = db.get_soumissions_for_lead(lead_id)
        notified_ids = set()
        ref = lead.get("numero_reference", f"#{lead_id}")
        lead_nom = lead.get("nom", ref)
        for s in soumissions:
            eid = s.get("entrepreneur_id")
            if eid and eid not in notified_ids:
                notified_ids.add(eid)
                db.create_notification({
                    "utilisateur_type": "entrepreneur",
                    "user_id": eid,
                    "type_notification": "addendum",
                    "titre": f"Addendum #{addendum['numero']} - {ref}",
                    "message": f"Un addendum a ete publie pour le projet \"{ref}\": {body.titre}",
                    "lien_id": lead_id,
                })
                # Send addendum email to entrepreneur
                try:
                    ent = db.get_entrepreneur_by_id(eid)
                    if ent and ent.get("email"):
                        loop = asyncio.get_running_loop()
                        loop.run_in_executor(
                            None, send_addendum_email,
                            ent["email"], lead_nom, body.titre, ref,
                        )
                except Exception as exc:
                    logger.warning("Failed to send addendum email to entrepreneur %s: %s", eid, exc)
    except Exception as exc:
        logger.warning("Failed to notify entrepreneurs about addendum: %s", exc)

    logger.info("Addendum created: id=%s lead=%s numero=%s", addendum["id"], lead_id, addendum["numero"])
    return AddendumResponse(**addendum)
