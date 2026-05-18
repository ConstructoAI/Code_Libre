"""
ERP React Backend - Pydantic Models
Request/response validation models for the ERP API.
"""

from pydantic import BaseModel, Field
from typing import Optional


# ============================================
# AUTH MODELS
# ============================================

class TenantLoginRequest(BaseModel):
    email: str
    password: str


class UserLoginRequest(BaseModel):
    username: str
    password: str
    entreprise_id: int


class SuperAdminLoginRequest(BaseModel):
    username: str
    password: str


class AuthUser(BaseModel):
    user_type: str
    user_id: int
    email: str
    display_name: str = ""
    schema_name: str = ""
    role: str = ""


class TenantLoginResponse(BaseModel):
    entreprise_id: int
    entreprise_nom: str
    schema_name: str


class UserLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AuthUser


class SessionLoginResponse(BaseModel):
    session_token: str
    user: AuthUser


class MeResponse(BaseModel):
    user_type: str
    user_id: int
    email: str
    display_name: str
    schema_name: str = ""
    role: str = ""
    entreprise_nom: str = ""


class RegisterRequest(BaseModel):
    company_name: str = Field(..., min_length=2, max_length=200)
    email: str = Field(..., min_length=5)
    password: str = Field(..., min_length=8)
    plan_type: str = Field(default="pro")
    success_url: str = ""
    cancel_url: str = ""
    representant: str = ""


# ============================================
# DASHBOARD MODELS
# ============================================

class DashboardStats(BaseModel):
    projects_total: int = 0
    projects_en_cours: int = 0
    projects_termines: int = 0
    companies_total: int = 0
    employes_actifs: int = 0
    devis_total: int = 0
    devis_brouillon: int = 0
    devis_acceptes: int = 0
    factures_total: int = 0
    factures_solde_du: float = 0.0
    produits_total: int = 0
    fournisseurs_total: int = 0
    bt_total: int = 0
    bt_en_cours: int = 0

    # Ventes/CRM
    clients_actifs: int = 0
    contacts_total: int = 0
    opportunites_ouvertes: int = 0
    pipeline_value: float = 0.0

    # Devis extra
    devis_en_attente: int = 0
    devis_taux_conversion: float = 0.0
    devis_montant_total: float = 0.0

    # Projets extra
    projects_actifs: int = 0
    projects_taux_completion: float = 0.0
    projects_ca_total: float = 0.0

    # Inventaire
    inventaire_total_articles: int = 0
    inventaire_quantite_totale: int = 0
    inventaire_valeur_stock: float = 0.0
    inventaire_stock_critique: int = 0
    inventaire_categories: int = 0

    # RH extra
    employes_total: int = 0
    employes_salaire_moyen: float = 0.0
    employes_surcharges: int = 0

    # Travaux extra
    bt_urgents: int = 0
    bt_termines: int = 0


class DashboardAlert(BaseModel):
    type: str  # "danger", "warning", "info"
    title: str
    message: str
    reference_id: Optional[str] = None
    reference_type: Optional[str] = None


class DashboardResponse(BaseModel):
    stats: DashboardStats
    alerts: list[DashboardAlert] = []


# ============================================
# ADMIN MODELS
# ============================================

class EntrepriseAdmin(BaseModel):
    id: int
    nom: str
    slug: Optional[str] = None
    email: Optional[str] = None
    representant: Optional[str] = None
    telephone: Optional[str] = None
    adresse: Optional[str] = None
    subscription_status: Optional[str] = None
    plan_type: Optional[str] = None
    trial_end_date: Optional[str] = None
    created_at: Optional[str] = None
    active: bool = True
    user_count: int = 0


class ToggleActiveRequest(BaseModel):
    active: bool
