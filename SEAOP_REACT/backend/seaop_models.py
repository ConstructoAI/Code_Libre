"""
SEAOP React Backend - Pydantic Models
All request/response models for the SEAOP API.
Uses Pydantic v2 syntax (BaseModel with model_config).
"""

from datetime import date, datetime
from typing import Any, Generic, List, Optional, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ============================================
# GENERIC / COMMON
# ============================================

T = TypeVar("T")


class SuccessResponse(BaseModel):
    success: bool = True
    message: str = "OK"


class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T] = []  # type: ignore[valid-type]
    total: int = 0
    page: int = 1
    per_page: int = 20


# ============================================
# AUTH MODELS
# ============================================

class EntrepreneurLogin(BaseModel):
    email: EmailStr
    mot_de_passe: str


class EntrepreneurRegister(BaseModel):
    nom_entreprise: str
    nom_contact: str
    email: EmailStr
    telephone: str
    mot_de_passe: str = Field(..., min_length=8)
    numero_rbq: Optional[str] = None
    zones_desservies: Optional[str] = None
    types_projets: Optional[str] = None
    certifications: Optional[str] = None
    # RBQ verification fields
    categories_rbq: Optional[str] = None
    assurance_responsabilite: Optional[bool] = False
    montant_assurance: Optional[float] = None
    licence_valide_jusqu_au: Optional[date] = None


class ClientLogin(BaseModel):
    email: EmailStr
    numero_reference: str


class AdminLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    nom: Optional[str] = None
    nom_entreprise: Optional[str] = None
    nom_contact: Optional[str] = None
    telephone: Optional[str] = None
    user_type: str  # "entrepreneur", "client", "admin"
    numero_rbq: Optional[str] = None
    zones_desservies: Optional[str] = None
    types_projets: Optional[str] = None
    abonnement: Optional[str] = None
    credits_restants: Optional[int] = None
    certifications: Optional[str] = None
    evaluations_moyenne: Optional[float] = None
    nombre_evaluations: Optional[int] = None
    statut: Optional[str] = None
    date_inscription: Optional[datetime] = None
    # RBQ verification fields
    rbq_verifie: Optional[bool] = False
    categories_rbq: Optional[str] = None
    assurance_responsabilite: Optional[bool] = False
    montant_assurance: Optional[float] = None
    licence_valide_jusqu_au: Optional[date] = None


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# ============================================
# LEAD MODELS
# ============================================

class LeadCreate(BaseModel):
    nom: str
    email: EmailStr
    telephone: str
    code_postal: str
    type_projet: str
    description: str
    budget: str
    delai_realisation: str
    date_limite_soumissions: Optional[date] = None
    date_debut_souhaite: Optional[date] = None
    niveau_urgence: str = "normal"
    photos: Optional[str] = None
    plans: Optional[str] = None
    documents: Optional[str] = None
    # CNESST / Compliance fields
    rbq_requis: Optional[bool] = False
    categories_rbq_requises: Optional[str] = None
    cnesst_requis: Optional[bool] = False
    assurance_requise: Optional[bool] = False
    montant_assurance_min: Optional[float] = None
    cautionnement_requis: Optional[bool] = False
    pourcentage_cautionnement: Optional[float] = None


class LeadUpdate(BaseModel):
    nom: Optional[str] = None
    email: Optional[EmailStr] = None
    telephone: Optional[str] = None
    code_postal: Optional[str] = None
    type_projet: Optional[str] = None
    description: Optional[str] = None
    budget: Optional[str] = None
    delai_realisation: Optional[str] = None
    date_limite_soumissions: Optional[date] = None
    date_debut_souhaite: Optional[date] = None
    niveau_urgence: Optional[str] = None
    photos: Optional[str] = None
    plans: Optional[str] = None
    documents: Optional[str] = None
    statut: Optional[str] = None
    visible_entrepreneurs: Optional[bool] = None
    accepte_soumissions: Optional[bool] = None
    # CNESST / Compliance fields
    rbq_requis: Optional[bool] = None
    categories_rbq_requises: Optional[str] = None
    cnesst_requis: Optional[bool] = None
    assurance_requise: Optional[bool] = None
    montant_assurance_min: Optional[float] = None
    cautionnement_requis: Optional[bool] = None
    pourcentage_cautionnement: Optional[float] = None


class LeadResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str
    email: str
    telephone: str
    code_postal: str
    type_projet: str
    description: str
    budget: str
    delai_realisation: str
    date_limite_soumissions: Optional[date] = None
    date_debut_souhaite: Optional[date] = None
    niveau_urgence: Optional[str] = "normal"
    photos: Optional[str] = None
    plans: Optional[str] = None
    documents: Optional[str] = None
    date_creation: Optional[datetime] = None
    statut: Optional[str] = "nouveau"
    numero_reference: Optional[str] = None
    visible_entrepreneurs: Optional[bool] = True
    accepte_soumissions: Optional[bool] = True
    nb_soumissions: Optional[int] = 0
    # CNESST / Compliance fields
    rbq_requis: Optional[bool] = False
    categories_rbq_requises: Optional[str] = None
    cnesst_requis: Optional[bool] = False
    assurance_requise: Optional[bool] = False
    montant_assurance_min: Optional[float] = None
    cautionnement_requis: Optional[bool] = False
    pourcentage_cautionnement: Optional[float] = None


class LeadListResponse(BaseModel):
    items: List[LeadResponse] = []
    total: int = 0
    page: int = 1
    per_page: int = 20


# ============================================
# SOUMISSION MODELS
# ============================================

class SoumissionCreate(BaseModel):
    lead_id: int
    montant: float = Field(..., gt=0)
    description_travaux: str
    delai_execution: str
    validite_offre: str
    inclusions: Optional[str] = None
    exclusions: Optional[str] = None
    conditions: Optional[str] = None
    # Bid bond / cautionnement fields
    cautionnement_inclus: Optional[bool] = False
    montant_cautionnement: Optional[float] = None
    type_cautionnement: Optional[str] = None


class SoumissionStatusUpdate(BaseModel):
    statut: str


class SoumissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    lead_id: int
    entrepreneur_id: int
    montant: float
    description_travaux: str
    delai_execution: str
    validite_offre: str
    inclusions: Optional[str] = None
    exclusions: Optional[str] = None
    conditions: Optional[str] = None
    documents: Optional[str] = None
    statut: Optional[str] = "envoyee"
    date_creation: Optional[datetime] = None
    date_modification: Optional[datetime] = None
    vue_par_client: Optional[bool] = False
    notes_client: Optional[str] = None
    notes_entrepreneur: Optional[str] = None
    # Bid bond / cautionnement fields
    cautionnement_inclus: Optional[bool] = False
    montant_cautionnement: Optional[float] = None
    type_cautionnement: Optional[str] = None
    # Joined entrepreneur info (optional, populated in list views)
    nom_entreprise: Optional[str] = None
    nom_contact: Optional[str] = None
    entrepreneur_email: Optional[str] = None
    entrepreneur_telephone: Optional[str] = None
    evaluations_moyenne: Optional[float] = None
    # RBQ verification fields (joined from entrepreneur)
    numero_rbq: Optional[str] = None
    rbq_verifie: Optional[bool] = False
    assurance_responsabilite: Optional[bool] = False
    # Joined lead info (populated in entrepreneur's /mes-soumissions view)
    lead_nom: Optional[str] = None
    lead_type_projet: Optional[str] = None
    lead_numero_reference: Optional[str] = None


# ============================================
# MESSAGE MODELS
# ============================================

class MessageCreate(BaseModel):
    lead_id: int
    entrepreneur_id: Optional[int] = None
    destinataire_id: Optional[int] = None
    message: str
    pieces_jointes: Optional[str] = None


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    lead_id: int
    entrepreneur_id: Optional[int] = None
    expediteur_type: str
    expediteur_id: int
    destinataire_id: int
    message: str
    pieces_jointes: Optional[str] = None
    date_envoi: Optional[datetime] = None
    lu: Optional[bool] = False


class ConversationSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    lead_id: int
    entrepreneur_id: Optional[int] = None
    other_party_name: Optional[str] = None
    other_party_email: Optional[str] = None
    last_message: Optional[str] = None
    last_message_date: Optional[datetime] = None
    unread_count: int = 0
    lead_type_projet: Optional[str] = None
    lead_numero_reference: Optional[str] = None


# ============================================
# NOTIFICATION MODELS
# ============================================

class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    utilisateur_type: str
    user_id: int
    type_notification: str
    titre: str
    message: str
    lien_id: Optional[int] = None
    lu: Optional[bool] = False
    date_creation: Optional[datetime] = None


class NotificationCountResponse(BaseModel):
    unread: int = 0
    total: int = 0


# ============================================
# EVALUATION MODELS
# ============================================

class EvaluationCreate(BaseModel):
    soumission_id: int
    note: int = Field(..., ge=1, le=5)
    commentaire: Optional[str] = None


class EvaluationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    soumission_id: int
    evaluateur_type: str
    note: int
    commentaire: Optional[str] = None
    date_evaluation: Optional[datetime] = None


# ============================================
# ADDENDUM MODELS
# ============================================

class AddendumCreate(BaseModel):
    titre: str
    description: str


class AddendumResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    lead_id: int
    numero: int
    titre: str
    description: str
    date_creation: Optional[datetime] = None
    auteur_email: Optional[str] = None
