"""Modeles Pydantic pour l'API Mobile Pointage."""

import json
from enum import Enum

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from typing import Optional, Literal, Any
from datetime import datetime, date


# --- Auth ---

class TenantLoginRequest(BaseModel):
    email: str = Field(..., description="Email de l'entreprise")
    password: str = Field(..., description="Mot de passe de l'entreprise")


class EmployeeInfo(BaseModel):
    id: int
    prenom: str
    nom: str
    poste: Optional[str] = None


class TenantLoginResponse(BaseModel):
    tenant_id: int
    tenant_nom: str
    schema_name: str
    employees: list[EmployeeInfo]


class PinLoginRequest(BaseModel):
    tenant_id: int
    employee_id: int
    pin_code: str = Field(..., min_length=4, max_length=4, pattern=r'^\d{4}$')


class PinLoginResponse(BaseModel):
    token: str
    employee: EmployeeInfo
    tenant_nom: str
    role: str = Field(default="EMPLOYE",
                      description="Role mobile: ADMIN | MANAGER | EMPLOYE | APPRENTI")


class MeResponse(BaseModel):
    """Reponse de GET /me — pour refresh du role apres login (UI cache buttons)."""
    employee_id: int
    employee_name: str
    role: str
    tenant_schema: str


# --- Work Orders ---

class WorkOrderResponse(BaseModel):
    id: int
    numero_document: Optional[str] = None
    description: Optional[str] = None
    statut: Optional[str] = None
    priorite: Optional[str] = None
    project_nom: Optional[str] = None
    project_id: Optional[int] = None
    date_debut: Optional[datetime] = None
    date_fin: Optional[datetime] = None
    client_nom: Optional[str] = None
    adresse_chantier: Optional[str] = None
    ville_chantier: Optional[str] = None
    po_client: Optional[str] = None
    heures_estimees: Optional[float] = None
    heures_realisees: Optional[float] = None
    operations: list[dict] = []


# --- Pointage ---

class PunchInRequest(BaseModel):
    formulaire_bt_id: int
    operation_id: Optional[int] = None
    notes: Optional[str] = Field(None, max_length=1000)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)


class PunchOutRequest(BaseModel):
    notes: Optional[str] = Field(None, max_length=1000)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)


class TimeEntryUpdate(BaseModel):
    notes: Optional[str] = Field(None, max_length=1000)


class SignatureExterneRequest(BaseModel):
    """Signature tactile par un superviseur externe (client, directeur d'usine, etc.)
    apposee directement sur le telephone de l'employe au moment du punch out.

    signature_base64 : image PNG encodee en base64 (sans prefixe data URL),
                       genere par canvas.toDataURL('image/png') cote frontend.
                       Strippe et valide non-vide (au-dela des espaces).
    signataire_nom   : nom du superviseur externe qui signe (ex. "Jean Tremblay - Directeur maintenance").
                       Strippe automatiquement, min 2 caracteres apres strip.
    """
    signature_base64: str = Field(..., min_length=1, max_length=2_000_000)
    signataire_nom: str = Field(..., min_length=2, max_length=200)

    @field_validator('signature_base64')
    @classmethod
    def _check_signature_b64(cls, v: str) -> str:
        stripped = v.strip()
        if len(stripped) < 100:
            raise ValueError("signature_base64 trop courte (signature manquante ou vide)")
        # Validation laxiste du format base64 : ignore le padding, accepte standard et URL-safe.
        # On ne decode pas pour eviter le cout CPU sur 2MB.
        return stripped

    @field_validator('signataire_nom')
    @classmethod
    def _check_signataire_nom(cls, v: str) -> str:
        stripped = v.strip()
        if len(stripped) < 2:
            raise ValueError("signataire_nom doit avoir au moins 2 caracteres significatifs")
        return stripped


class WeatherSnapshot(BaseModel):
    """Snapshot météo capturé au punch in/out via Open-Meteo.

    Tous les champs sont optionnels — l'objet entier vaut None si Open-Meteo
    a échoué ou si aucune coordonnée GPS n'a été fournie. Le shape doit rester
    aligné avec ce que `_fetch_current_weather()` produit dans mobile_database.py.
    """
    temperature_c:    Optional[float] = None
    feels_like_c:     Optional[float] = None
    humidity:         Optional[int] = None
    wind_kmh:         Optional[float] = None
    wind_direction:   Optional[int] = None
    precipitation_mm: Optional[float] = None
    weather_code:     Optional[int] = None
    condition:        Optional[str] = None
    icon:             Optional[str] = None
    is_day:           Optional[bool] = None
    latitude:         Optional[float] = None
    longitude:        Optional[float] = None
    captured_at:      Optional[str] = None
    # Origine des coordonnées : "gps" (position de l'employé) ou "chantier"
    # (géocodé depuis adresse_chantier du projet, fallback desktop sans GPS).
    location_source:  Optional[str] = None


class TimeEntryResponse(BaseModel):
    id: int
    employee_id: int
    formulaire_bt_id: Optional[int] = None
    operation_id: Optional[int] = None
    operation_nom: Optional[str] = None
    numero_bt: Optional[str] = None
    project_id: Optional[int] = None
    project_nom: Optional[str] = None
    punch_in: datetime
    punch_out: Optional[datetime] = None
    total_hours: Optional[float] = None
    validated: Optional[bool] = None
    validated_by: Optional[str] = None
    validated_at: Optional[datetime] = None
    notes: Optional[str] = None
    billable: Optional[bool] = None
    is_billed: Optional[bool] = None
    weather_in:  Optional[WeatherSnapshot] = None
    weather_out: Optional[WeatherSnapshot] = None

    @field_validator('validated_by', mode='before')
    @classmethod
    def coerce_validated_by(cls, v):
        """Convertit validated_by en str si la DB retourne un int (user_id)."""
        if v is None:
            return v
        return str(v)

    @field_validator('weather_in', 'weather_out', mode='before')
    @classmethod
    def parse_weather_jsonb(cls, v):
        """Filet de sécurité : si psycopg2 retourne le JSONB en str (au lieu de
        dict décodé), on parse explicitement. Normalement RealDictCursor décode
        JSONB → dict directement, mais si la connexion vient d'un pool sans le
        register de type JSONB, on peut recevoir un str.

        Tolérant : sur erreur de parsing, retourne None plutôt que de bloquer
        toute la réponse — la météo est documentaire, pas opérationnelle.
        """
        if v is None or isinstance(v, dict):
            return v
        if isinstance(v, (bytes, bytearray)):
            try:
                v = v.decode('utf-8')
            except Exception:
                return None
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                return parsed if isinstance(parsed, dict) else None
            except (ValueError, TypeError):
                return None
        return None


class PunchStatusResponse(BaseModel):
    is_punched_in: bool
    active_entry: Optional[TimeEntryResponse] = None
    elapsed_minutes: Optional[float] = None


# --- Resume hebdomadaire ---

class DailySummary(BaseModel):
    date: date
    jour: str
    total_hours: float
    entries_count: int
    is_overtime: bool = False


class WeeklySummaryResponse(BaseModel):
    semaine_du: date
    semaine_au: date
    total_hours: float
    jours: list[DailySummary]
    overtime_hours: float = 0.0
    is_overtime_week: bool = False


# --- Photo upload ---

class PhotoUploadResponse(BaseModel):
    photo_url: str
    message: str


# --- Vue contremaitre ---

class CrewMemberStatus(BaseModel):
    employee_id: int
    prenom: str
    nom: str
    poste: Optional[str] = None
    is_punched_in: bool
    punch_in: Optional[datetime] = None
    punch_out: Optional[datetime] = None
    elapsed_minutes: Optional[float] = None
    total_hours: Optional[float] = None
    numero_bt: Optional[str] = None
    project_nom: Optional[str] = None
    time_entry_id: Optional[int] = None
    validated: bool = False


class CrewViewResponse(BaseModel):
    project_id: Optional[int] = None
    project_nom: Optional[str] = None
    total_on_site: int
    total_assigned: int
    can_approve: bool = False
    members: list[CrewMemberStatus]


# --- Messagerie Conference ---

class ChannelResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    channel_type: Optional[str] = None
    icon: Optional[str] = None
    is_private: bool = False
    member_count: int = 0
    message_count: int = 0
    unread_count: int = 0
    created_at: Optional[datetime] = None


class MessageResponse(BaseModel):
    id: int
    channel_id: int
    user_id: int
    user_name: str = ""
    message_text: str
    parent_message_id: Optional[int] = None
    has_attachments: bool = False
    is_edited: bool = False
    is_deleted: bool = False
    reaction_count: int = 0
    reply_count: int = 0
    reactions: Optional[dict] = None
    created_at: Optional[datetime] = None
    edited_at: Optional[datetime] = None


class SendMessageRequest(BaseModel):
    message_text: str = Field(..., min_length=1, max_length=5000)
    parent_message_id: Optional[int] = None


class ReactionRequest(BaseModel):
    emoji: str = Field(..., min_length=1, max_length=10)


class CreateChannelRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    channel_type: str = Field(default="custom")
    icon: str = Field(default="💬")
    is_private: bool = False
    member_ids: Optional[list[int]] = None


class ChannelMemberResponse(BaseModel):
    employee_id: int
    prenom: str
    nom: str
    poste: Optional[str] = None
    role: str = "member"


# --- Messagerie Directe ---

class DirectMessageResponse(BaseModel):
    id: int
    sender_type: str
    sender_name: Optional[str] = None
    sender_user_id: Optional[int] = None
    recipient_type: str
    recipient_user_id: Optional[int] = None
    recipient_username: Optional[str] = None
    subject: Optional[str] = None
    message: str
    message_type: str = "normal"
    conversation_id: Optional[str] = None
    parent_message_id: Optional[int] = None
    created_at: Optional[datetime] = None
    read_at: Optional[datetime] = None
    is_read: bool = False


class SendDirectMessageRequest(BaseModel):
    recipient_employee_id: Optional[int] = None
    recipient_type: Literal["super_admin", "user"] = "super_admin"
    subject: Optional[str] = Field(None, max_length=500)
    message: str = Field(..., min_length=1, max_length=5000)
    message_type: Literal["normal", "urgent", "support"] = "normal"
    conversation_id: Optional[str] = None
    parent_message_id: Optional[int] = None

    @model_validator(mode='after')
    def validate_recipient(self):
        if self.recipient_type == 'user' and not self.recipient_employee_id:
            raise ValueError('recipient_employee_id est requis quand recipient_type est "user"')
        return self


class ConversationSummaryResponse(BaseModel):
    conversation_id: Optional[str] = None
    other_party_name: str = ""
    last_message: str = ""
    last_message_at: Optional[datetime] = None
    total_messages: int = 0
    unread_count: int = 0


class UnreadCountResponse(BaseModel):
    conference_unread: int = 0
    direct_unread: int = 0
    total_unread: int = 0


# --- Dossiers ---

class DossierListResponse(BaseModel):
    id: int
    numero_dossier: str
    titre: str
    statut: Optional[str] = None
    priorite: Optional[str] = None
    type_dossier: Optional[str] = None
    project_nom: Optional[str] = None
    client_nom: Optional[str] = None
    date_ouverture: Optional[date] = None
    date_echeance: Optional[date] = None
    documents_count: int = 0
    etapes_total: int = 0
    etapes_done: int = 0


class DossierEtapeResponse(BaseModel):
    id: int
    titre: str
    description: Optional[str] = None
    ordre: int = 0
    statut: str = "TODO"
    date_prevue: Optional[date] = None
    date_realisee: Optional[date] = None


class DossierDocumentResponse(BaseModel):
    id: int
    titre: str
    description: Optional[str] = None
    categorie: Optional[str] = None
    fichier_nom: str
    fichier_type: Optional[str] = None
    fichier_taille: Optional[int] = None
    uploaded_by: Optional[str] = None
    uploaded_at: Optional[datetime] = None
    source: Optional[str] = None

    @field_validator('uploaded_by', mode='before')
    @classmethod
    def coerce_uploaded_by(cls, v):
        """Convertit uploaded_by en str si la DB retourne un int (user_id)."""
        if v is None:
            return v
        return str(v)


class NotePhotoResponse(BaseModel):
    id: int
    note_id: int
    fichier_nom: str
    fichier_type: Optional[str] = "image/jpeg"
    fichier_taille: Optional[int] = None
    photo_url: str
    uploaded_at: Optional[datetime] = None


class NoteAttachmentMeta(BaseModel):
    nom: str
    type: Optional[str] = "application/octet-stream"
    taille: Optional[int] = None


class DossierNoteResponse(BaseModel):
    id: int
    contenu: str
    is_pinned: bool = False
    categorie: Optional[str] = "general"
    created_at: Optional[datetime] = None
    photos: list[NotePhotoResponse] = []
    attachments: list[NoteAttachmentMeta] = []


class CreateDossierNoteRequest(BaseModel):
    contenu: str = Field("", max_length=5000)


class DossierLienResponse(BaseModel):
    id: int
    dossier_id: int
    url: str
    description: Optional[str] = None
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class CreateDossierLienRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)
    description: Optional[str] = Field(None, max_length=1000)


class UpdateDossierLienRequest(BaseModel):
    url: Optional[str] = Field(None, min_length=1, max_length=2048)
    description: Optional[str] = Field(None, max_length=1000)


class Dossier360Projet(BaseModel):
    id: int
    nom_projet: Optional[str] = None
    statut: Optional[str] = None
    priorite: Optional[str] = None
    budget_total: Optional[float] = None
    date_debut_reel: Optional[date] = None
    date_fin_reel: Optional[date] = None
    date_prevu: Optional[date] = None

class Dossier360Devis(BaseModel):
    id: int
    numero_devis: Optional[str] = None
    nom_projet: Optional[str] = None
    statut: Optional[str] = None
    total_travaux: Optional[float] = None
    investissement_total: Optional[float] = None
    created_at: Optional[datetime] = None

class Dossier360Formulaire(BaseModel):
    id: int
    numero_document: Optional[str] = None
    nom: Optional[str] = None
    statut: Optional[str] = None
    priorite: Optional[str] = None
    montant_total: Optional[float] = None
    date_echeance: Optional[date] = None
    created_at: Optional[datetime] = None

class Dossier360Facture(BaseModel):
    id: int
    numero_facture: Optional[str] = None
    client_nom: Optional[str] = None
    statut: Optional[str] = None
    montant_ht: Optional[float] = None
    montant_ttc: Optional[float] = None
    montant_paye: Optional[float] = None
    solde_du: Optional[float] = None
    date_facture: Optional[date] = None
    date_echeance: Optional[date] = None

class Dossier360BonCommande(BaseModel):
    id: int
    numero: Optional[str] = None
    statut: Optional[str] = None
    montant_total: Optional[float] = None
    date_commande: Optional[date] = None
    date_livraison_prevue: Optional[date] = None

class Dossier360Pointage(BaseModel):
    id: int
    employee_id: Optional[int] = None
    project_id: Optional[int] = None
    punch_in: Optional[datetime] = None
    punch_out: Optional[datetime] = None
    total_hours: Optional[float] = None
    notes: Optional[str] = None
    validated: Optional[bool] = None
    prenom: Optional[str] = None
    nom: Optional[str] = None

class Dossier360Comptabilite(BaseModel):
    budget_total: float = 0
    total_devis: float = 0
    total_facture: float = 0
    total_paye: float = 0
    total_solde_du: float = 0
    total_heures: float = 0
    total_achats: float = 0
    total_couts: float = 0
    marge_estimee: float = 0
    nb_factures: int = 0
    nb_factures_payees: int = 0
    nb_factures_en_retard: int = 0
    nb_bons_commande: int = 0
    nb_bons_travail: int = 0
    nb_devis: int = 0


class DossierDetailResponse(BaseModel):
    id: int
    numero_dossier: str
    titre: str
    description: Optional[str] = None
    statut: Optional[str] = None
    priorite: Optional[str] = None
    type_dossier: Optional[str] = None
    project_nom: Optional[str] = None
    client_nom: Optional[str] = None
    responsable_nom: Optional[str] = None
    date_ouverture: Optional[date] = None
    date_echeance: Optional[date] = None
    date_fermeture: Optional[date] = None
    tags: Optional[str] = None
    etapes: list[DossierEtapeResponse] = []
    documents: list[DossierDocumentResponse] = []
    notes: list[DossierNoteResponse] = []
    # Fiche 360
    projets: list[Dossier360Projet] = []
    devis: list[Dossier360Devis] = []
    bons_travail: list[Dossier360Formulaire] = []
    factures: list[Dossier360Facture] = []
    bons_commande: list[Dossier360BonCommande] = []
    demandes_prix: list[Dossier360Formulaire] = []
    pointage: list[Dossier360Pointage] = []
    comptabilite: Optional[Dossier360Comptabilite] = None


# --- Assistant IA ---

class AIChatImageData(BaseModel):
    data: str = Field(..., min_length=100, max_length=10_000_000, description="Image ou document encode en base64 (max ~7MB)")
    media_type: Literal["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] = "image/jpeg"


class AIChatMessageRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=5000)
    conversation_id: Optional[int] = None
    images: Optional[list[AIChatImageData]] = Field(None, description="Images ou documents joints (max 5)")

    @model_validator(mode='after')
    def validate_images_count(self):
        if self.images and len(self.images) > 5:
            raise ValueError('Maximum 5 fichiers par message')
        return self


class AIPendingAction(BaseModel):
    """Action d'ecriture proposee par l'IA, en attente de confirmation user."""
    id: int
    action_type: Literal["INSERT", "UPDATE", "DELETE"]
    target_table: str
    summary: str


class AIChatMessageResponse(BaseModel):
    conversation_id: Optional[int] = None
    role: str = "assistant"
    content: str
    tokens_input: int = 0
    tokens_output: int = 0
    expert_profile: Optional[str] = None
    pending_actions: list[AIPendingAction] = Field(default_factory=list)


class AIPendingActionConfirmResponse(BaseModel):
    success: bool
    result_msg: str
    rowcount: Optional[int] = None


class AIConversationResponse(BaseModel):
    id: int
    name: str
    created_at: Optional[str] = None
    last_updated_at: Optional[str] = None
    message_count: int = 0


class AIConversationDetailResponse(BaseModel):
    id: int
    name: str
    messages: list[dict] = []
    created_at: Optional[str] = None
    last_updated_at: Optional[str] = None


class AIQuotaResponse(BaseModel):
    allowed: bool
    prepaid_balance: float = 0.0
    monthly_cost: float = 0.0
    message: str = ""


# --- Notes IA Intelligentes ---

class NoteAIEnrichRequest(BaseModel):
    """Demande d'enrichissement IA d'une note brute."""
    contenu: str = Field(..., min_length=1, max_length=5000, description="Texte brut de la note a enrichir")
    dossier_titre: Optional[str] = Field(None, description="Titre du dossier pour contexte")


class NoteAIAnalyzePhotoRequest(BaseModel):
    """Demande d'analyse IA d'une photo de chantier."""
    image_data: str = Field(..., min_length=100, max_length=10_000_000, description="Image base64")
    media_type: Literal["image/jpeg", "image/png", "image/webp", "image/gif"] = "image/jpeg"
    contexte: Optional[str] = Field(None, max_length=500, description="Contexte additionnel (ex: etage, zone)")
    dossier_titre: Optional[str] = Field(None, description="Titre du dossier pour contexte")


class NoteAISummaryRequest(BaseModel):
    """Demande de resume intelligent de toutes les notes d'un dossier."""
    dossier_id: int


class NoteAIResponse(BaseModel):
    """Reponse IA pour enrichissement ou analyse photo."""
    contenu_enrichi: str = Field(..., description="Texte enrichi/structure par l'IA")
    categorie: Optional[str] = Field(None, description="Categorie auto-detectee")
    actions: list[str] = Field(default_factory=list, description="Actions a suivre extraites")
    tokens_input: int = 0
    tokens_output: int = 0


class NoteAISummaryResponse(BaseModel):
    """Reponse IA pour resume de dossier."""
    resume: str = Field(..., description="Resume structure du dossier")
    problemes_ouverts: list[str] = Field(default_factory=list)
    actions_en_attente: list[str] = Field(default_factory=list)
    nb_notes_analysees: int = 0
    tokens_input: int = 0
    tokens_output: int = 0


# --- Push Notifications ---

class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(..., min_length=10)
    auth: str = Field(..., min_length=10)


class PushSubscriptionRequest(BaseModel):
    endpoint: str = Field(..., min_length=10)
    keys: PushSubscriptionKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str = Field(..., min_length=10)


# --- Documents commerciaux (Devis, Factures, BT, BC) ---

class DocumentLineResponse(BaseModel):
    id: int
    description: Optional[str] = None
    quantite: float = 0
    unite: Optional[str] = None
    prix_unitaire: float = 0
    montant_ligne: float = 0
    code_article: Optional[str] = None
    notes: Optional[str] = None
    sequence_ligne: int = 0


class DocumentLineCreate(BaseModel):
    description: str = Field(..., min_length=1, max_length=1000)
    quantite: float = 1
    unite: str = "unite"
    prix_unitaire: float = 0
    code_article: Optional[str] = None
    notes: Optional[str] = None
    sequence_ligne: int = 0


class DocumentLineUpdate(BaseModel):
    description: Optional[str] = None
    quantite: Optional[float] = None
    unite: Optional[str] = None
    prix_unitaire: Optional[float] = None
    code_article: Optional[str] = None
    notes: Optional[str] = None
    sequence_ligne: Optional[int] = None


class DocumentStatsResponse(BaseModel):
    total: int = 0
    brouillon: int = 0
    en_attente: int = 0
    envoye: int = 0
    accepte: int = 0
    en_cours: int = 0
    termine: int = 0
    paye: int = 0
    annule: int = 0


class DocumentListItemResponse(BaseModel):
    id: int
    doc_type: str
    numero: Optional[str] = None
    nom_projet: Optional[str] = None
    client_nom: Optional[str] = None
    statut: Optional[str] = None
    priorite: Optional[str] = None
    montant_total: Optional[float] = None
    date_creation: Optional[str] = None
    date_echeance: Optional[str] = None
    lignes_count: int = 0


class DocumentDetailResponse(BaseModel):
    id: int
    doc_type: str
    numero: Optional[str] = None
    nom_projet: Optional[str] = None
    description: Optional[str] = None
    client_nom: Optional[str] = None
    client_company_id: Optional[int] = None
    project_id: Optional[int] = None
    statut: Optional[str] = None
    priorite: Optional[str] = None
    montant_total: Optional[float] = None
    total_avant_taxes: Optional[float] = None
    tps: Optional[float] = None
    tvq: Optional[float] = None
    date_creation: Optional[str] = None
    date_echeance: Optional[str] = None
    notes: Optional[str] = None
    lignes: list[DocumentLineResponse] = []


class DevisCreateRequest(BaseModel):
    nom_projet: str = Field(..., min_length=1, max_length=500)
    client_company_id: Optional[int] = None
    client_nom_direct: Optional[str] = None
    project_id: Optional[int] = None
    description: Optional[str] = None
    date_prevu: Optional[str] = None
    priorite: str = "NORMAL"
    notes: Optional[str] = None


class FactureCreateRequest(BaseModel):
    client_company_id: Optional[int] = None
    client_nom: Optional[str] = None
    project_id: Optional[int] = None
    devis_id: Optional[int] = None
    date_echeance: Optional[str] = None
    conditions_paiement: str = "Net 30"
    notes: Optional[str] = None


class BonTravailCreateRequest(BaseModel):
    nom: str = Field(..., min_length=1, max_length=500)
    project_id: Optional[int] = None
    priorite: str = "NORMALE"
    date_echeance: Optional[str] = None
    notes: Optional[str] = None


class BonCommandeCreateRequest(BaseModel):
    fournisseur_id: Optional[int] = None
    fournisseur_nom: Optional[str] = None
    project_id: Optional[int] = None
    date_livraison_prevue: Optional[str] = None
    notes: Optional[str] = None


class DocumentUpdateRequest(BaseModel):
    nom_projet: Optional[str] = None
    description: Optional[str] = None
    statut: Optional[str] = None
    priorite: Optional[str] = None
    date_echeance: Optional[str] = None
    notes: Optional[str] = None
    client_company_id: Optional[int] = None
    client_nom: Optional[str] = None
    project_id: Optional[int] = None


# --- Envoi de documents par courriel (Phase 3B) ---

class DocumentEmailRequest(BaseModel):
    """Requete d'envoi d'un document commercial (devis, facture, BT, BC) par courriel
    avec PDF joint. CC optionnel, sujet et message auto-generes si vides.
    """
    to_email: EmailStr = Field(..., description="Adresse courriel du destinataire principal")
    cc: list[EmailStr] = Field(default_factory=list, description="Adresses CC (max 10)")
    subject: str = Field("", max_length=998,
                         description="Sujet du courriel. Vide -> auto: 'Facture XYZ - Constructo AI'")
    message: str = Field("", max_length=10000,
                         description="Corps texte. Vide -> message professionnel par defaut")

    @field_validator('cc')
    @classmethod
    def _limit_cc(cls, v):
        if v and len(v) > 10:
            raise ValueError('Maximum 10 adresses CC')
        return v

    @field_validator('subject', 'message')
    @classmethod
    def _no_crlf_injection(cls, v: str) -> str:
        # Sujet stocke sur une seule ligne; corps peut avoir des \n mais pas de \r isole.
        if v and '\r' in v:
            raise ValueError('Caractere CR interdit')
        return v


class DocumentEmailResponse(BaseModel):
    sent: bool
    message_id: Optional[str] = None
    to_email: str
    cc: list[str] = Field(default_factory=list)
    sent_at: Optional[datetime] = None
    pdf_size_bytes: Optional[int] = None


# --- Signed URLs (downloads sans JWT en clair) ---

class SignedUrlRequest(BaseModel):
    path: str = Field(..., min_length=1, max_length=500,
                      description="Chemin API absolu a signer (whitelist serveur)")
    ttl_seconds: int = Field(default=300, ge=60, le=3600,
                             description="Duree de validite, max 1 heure")


class SignedUrlResponse(BaseModel):
    url: str = Field(..., description="URL signee complete (path + params HMAC)")
    expires_in_seconds: int


# --- Attachments polymorphiques (dossier, devis, facture, BT, BC, BA) ---

class AttachmentParentType(str, Enum):
    """Types d'entites parent supportes par document_attachments."""
    DOSSIER = "dossier"
    DEVIS = "devis"
    FACTURE = "facture"
    BON_TRAVAIL = "bon_travail"
    BON_COMMANDE = "bon_commande"
    BON_ACHAT = "bon_achat"


class AttachmentCategory(str, Enum):
    """Categories libres pour classer les pieces jointes."""
    PLAN = "PLAN"
    PHOTO = "PHOTO"
    CONTRAT = "CONTRAT"
    FACTURE = "FACTURE"
    DEVIS = "DEVIS"
    BON_LIVRAISON = "BON_LIVRAISON"
    BON_TRAVAIL = "BON_TRAVAIL"
    RAPPORT = "RAPPORT"
    AUTRE = "AUTRE"


class AttachmentListItem(BaseModel):
    """Item de liste — sans file_data (bande passante)."""
    id: int
    parent_type: AttachmentParentType
    parent_id: int
    filename: str
    original_filename: str
    mime_type: str = Field(..., description="MIME detecte via magic bytes (pas Content-Type client)")
    size_bytes: int
    category: AttachmentCategory
    uploaded_by: int
    uploaded_by_name: Optional[str] = None
    uploaded_at: datetime


class AttachmentDetailResponse(AttachmentListItem):
    """Detail enrichi avec EXIF + hash + description (sans file_data toujours)."""
    description: Optional[str] = None
    exif_data: Optional[dict[str, Any]] = None
    file_hash: Optional[str] = None


class AttachmentCreateResponse(BaseModel):
    id: int
    filename: str
    size_bytes: int
    mime_type: str
    message: str = "Piece jointe enregistree"


class AttachmentUpdateRequest(BaseModel):
    filename: Optional[str] = Field(None, min_length=1, max_length=255)
    category: Optional[AttachmentCategory] = None
    description: Optional[str] = Field(None, max_length=2000)


# --- Stripe Payment Links (Phase 3C) ---

class PaymentLinkResponse(BaseModel):
    """Reponse de POST /documents/factures/{id}/payment-link.

    url           : URL Stripe PaymentLink (https://buy.stripe.com/...) a partager au client.
    expires_at    : Toujours None pour PaymentLink (les liens Stripe ne expirent pas par defaut).
    montant_ttc   : Montant total TTC (sous-total + TPS + TVQ) en CAD pour affichage.
    cached        : True si l'URL existait deja en DB (pas de nouvel appel Stripe).
    """
    url: str = Field(..., description="URL Stripe PaymentLink")
    expires_at: Optional[datetime] = None
    montant_ttc: float = Field(..., description="Montant total TTC en CAD")
    cached: bool = Field(default=False, description="True si lien deja existant reutilise")


# --- OCR scan recus (Phase 4A) ---

class OcrReceiptLine(BaseModel):
    """Ligne extraite d'un recu par Claude Vision."""
    description: str = Field(..., max_length=500, description="Description de l'item")
    quantite: float = Field(default=1.0, description="Quantite (defaut 1)")
    unite: str = Field(default="unite", max_length=50, description="Unite (unite, kg, m, etc.)")
    prix_unitaire: float = Field(default=0.0, description="Prix unitaire en CAD")
    montant_ligne: float = Field(default=0.0, description="Montant total ligne (qte * prix)")


class OcrReceiptResponse(BaseModel):
    """Reponse de POST /ocr/receipt.

    Tous les champs sauf `lignes` et `confidence` sont nullable car Claude peut
    ne pas reussir a extraire chaque info d'un recu illisible/froisse.
    """
    fournisseur_nom: Optional[str] = Field(None, max_length=255, description="Nom du fournisseur (Home Depot, Reno-Depot, etc.)")
    fournisseur_adresse: Optional[str] = Field(None, max_length=500)
    date_achat: Optional[str] = Field(None, description="Date au format ISO 8601 (YYYY-MM-DD)")
    numero_facture: Optional[str] = Field(None, max_length=100)
    lignes: list[OcrReceiptLine] = Field(default_factory=list, description="Lignes d'items extraites")
    sous_total: Optional[float] = Field(None, description="Sous-total avant taxes (CAD)")
    tps: Optional[float] = Field(None, description="Montant TPS 5%")
    tvq: Optional[float] = Field(None, description="Montant TVQ 9.975%")
    total: Optional[float] = Field(None, description="Total TTC")
    mode_paiement: Optional[str] = Field(None, max_length=100, description="VISA, comptant, debit, etc.")
    confidence: float = Field(default=0.0, ge=0.0, le=1.0, description="Estimation de confiance 0-1")
    raw_response: Optional[str] = Field(None, description="Reponse brute Claude pour debug")


# --- Relances factures impayees (Phase 4B) ---

# Aging buckets supportes : J30 = 1-30j de retard, J60 = 31-60j, J90 = 61-90j,
# J90+ = > 90j. Ces noms sont utilises a la fois dans le filtre query
# (GET /factures/overdue?bucket=) et le body POST /factures/send-reminders.
VALID_REMINDER_BUCKETS = frozenset({"J30", "J60", "J90", "J90+"})


class OverdueFacture(BaseModel):
    """Facture en retard pour la page de relances."""
    id: int
    numero: str = Field(..., description="Numero facture (numero_facture ou numero)")
    client_nom: str = Field(default="", description="Nom du client (cache)")
    client_email: Optional[str] = Field(None, description="Email du client si companies.email present")
    montant_total: float = Field(default=0.0, description="Montant TTC")
    solde_du: float = Field(default=0.0, description="Solde restant a payer (montant_total - montant_paye)")
    date_echeance: Optional[str] = Field(None, description="Date d'echeance ISO 8601 (YYYY-MM-DD)")
    days_overdue: int = Field(default=0, ge=0, description="Nombre de jours depuis la date d'echeance")
    bucket: str = Field(..., description="Aging bucket : J30 | J60 | J90 | J90+")


class OverdueBucketSummary(BaseModel):
    """Aggregation par bucket (count + montant) avec liste des factures."""
    bucket: str = Field(..., description="J30 | J60 | J90 | J90+")
    count: int = Field(default=0, ge=0)
    total_solde_du: float = Field(default=0.0, description="Somme des soldes_du de ce bucket")
    factures: list[OverdueFacture] = Field(default_factory=list)


class OverdueResponse(BaseModel):
    """Reponse de GET /factures/overdue."""
    total_count: int = Field(default=0, ge=0)
    total_amount: float = Field(default=0.0, description="Somme totale des soldes dus (tous buckets)")
    buckets: list[OverdueBucketSummary] = Field(default_factory=list)


class RemindersSendRequest(BaseModel):
    """Requete POST /factures/send-reminders.

    buckets : liste des aging buckets a relancer ; si None ou vide, envoie a tous.
    dry_run : si True, simule sans envoyer (preview UI).
    test_email : si fourni, envoie tous les courriels a cet email au lieu des vrais
                 clients (utile pour tests sans spam).
    """
    buckets: Optional[list[str]] = Field(default=None, description="Liste de buckets J30 | J60 | J90 | J90+")
    dry_run: bool = Field(default=False, description="True = simulation, pas d'envoi SMTP")
    test_email: Optional[EmailStr] = Field(default=None, description="Email de test (remplace tous les destinataires reels)")

    @field_validator('buckets')
    @classmethod
    def _validate_buckets(cls, v):
        if v is None:
            return v
        for b in v:
            if b not in VALID_REMINDER_BUCKETS:
                raise ValueError(f"Bucket invalide '{b}'. Valides : {sorted(VALID_REMINDER_BUCKETS)}")
        return v


class ReminderDetailItem(BaseModel):
    """Detail par facture pour la reponse aggregee."""
    facture_id: int
    numero: str
    bucket: str
    client_email: Optional[str] = None
    sent_to: Optional[str] = Field(None, description="Adresse reelle utilisee (peut differer si test_email)")
    status: str = Field(..., description="sent | skipped | failed | dry_run")
    error: Optional[str] = None


class RemindersSendResponse(BaseModel):
    """Reponse de POST /factures/send-reminders."""
    sent_count: int = Field(default=0, ge=0)
    failed_count: int = Field(default=0, ge=0)
    skipped_count: int = Field(default=0, ge=0)
    dry_run: bool = Field(default=False)
    total_processed: int = Field(default=0, ge=0)
    details: list[ReminderDetailItem] = Field(default_factory=list)


# --- Audit log polymorphique (Phase 5D - Loi 25 Quebec / GDPR) ---


class AuditEventResponse(BaseModel):
    """Un evenement d'audit dans le journal mobile_audit_events.

    Le pattern polymorphique (entity_type, entity_id) couvre toutes les
    entites sans FK rigide. before_data / after_data sont des snapshots
    JSONB optionnels (tronques a 50 KB par champ cote DB pour eviter
    les blobs base64).
    """
    id: int
    employee_id: Optional[int] = None
    employee_name: Optional[str] = Field(
        None, description="Nom complet de l'employe (enrichi cote serveur)"
    )
    action: str = Field(..., description="create | update | delete | login | sign | email_sent | payment_received")
    entity_type: str = Field(..., description="facture | devis | bon_travail | bon_commande | attachment | auth | ...")
    entity_id: Optional[int] = None
    entity_label: Optional[str] = Field(
        None, description="Label humain (ex. numero facture) pour search facile"
    )
    before_data: Optional[dict[str, Any]] = None
    after_data: Optional[dict[str, Any]] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None
    created_at: Optional[str] = Field(
        None, description="Timestamp ISO 8601 de l'evenement"
    )


class AuditEventsResponse(BaseModel):
    """Reponse de GET /audit/events. Pagination simple (limit + offset)."""
    events: list[AuditEventResponse] = Field(default_factory=list)
    total: int = Field(default=0, ge=0, description="Nombre total d'events matching les filtres (sans limit/offset)")
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


# --- Factures recurrentes (Phase 5C) ---

RECURRENT_FREQUENCY_VALUES = frozenset({"weekly", "monthly", "quarterly", "yearly"})


class RecurrentInvoiceCreateRequest(BaseModel):
    """Requete POST /factures/{facture_id}/recurrent.

    frequency  : Cadence de generation (hebdo / mensuel / trimestriel / annuel).
    description : Note libre (visible dans la liste des configs).
    start_date : Date a laquelle la PROCHAINE facture sera generee.
                 Si omise, le serveur calcule NOW() + 1 tick de frequency
                 (la prochaine facture sera generee dans une periode).
    """
    frequency: Literal['weekly', 'monthly', 'quarterly', 'yearly'] = Field(
        ..., description="Cadence : weekly | monthly | quarterly | yearly"
    )
    description: Optional[str] = Field(None, max_length=2000)
    start_date: Optional[date] = Field(
        None,
        description="Date de la prochaine generation (defaut = aujourd'hui + 1 tick)",
    )


class RecurrentInvoiceConfigResponse(BaseModel):
    """Resume d'une config de facture recurrente (POST create + GET list)."""
    id: int
    source_facture_id: int
    source_numero: Optional[str] = Field(
        None, description="Numero de la facture source (joint sur factures, best-effort)"
    )
    source_client_nom: Optional[str] = Field(
        None, description="Nom client cache de la facture source"
    )
    source_montant_total: Optional[float] = Field(
        None, description="Montant TTC de la facture source"
    )
    client_company_id: Optional[int] = None
    frequency: str = Field(..., description="weekly | monthly | quarterly | yearly")
    next_run_at: datetime = Field(..., description="Prochaine generation prevue")
    last_run_at: Optional[datetime] = Field(
        None, description="Derniere generation (None si jamais executee)"
    )
    runs_count: int = Field(default=0, ge=0, description="Nombre total de factures generees")
    active: bool = Field(default=True, description="False = pause (le cron ignore cette config)")
    description: Optional[str] = None
    created_by: Optional[int] = Field(None, description="employee_id du createur")
    created_at: Optional[datetime] = None


class RecurrentRunRequest(BaseModel):
    """Requete POST /factures/recurrent/run (optionnel)."""
    dry_run: bool = Field(
        default=False,
        description="True = simulation, pas de creation de factures ni de UPDATE",
    )


class RecurrentRunItem(BaseModel):
    """Detail par config traitee (succes ou erreur)."""
    config_id: int
    source_facture_id: int
    status: str = Field(..., description="created | skipped | failed | dry_run")
    new_facture_id: Optional[int] = None
    new_numero: Optional[str] = None
    next_run_at: Optional[datetime] = Field(
        None, description="Nouveau next_run_at apres avancement (None si dry_run / failed)"
    )
    error: Optional[str] = None


class RecurrentRunResponse(BaseModel):
    """Reponse de POST /factures/recurrent/run."""
    processed: int = Field(default=0, ge=0, description="Nombre de configs traitees")
    created_facture_ids: list[int] = Field(default_factory=list)
    dry_run: bool = Field(default=False)
    items: list[RecurrentRunItem] = Field(default_factory=list)
