"""
ERP React - Secondary Modules Router
Immobilier, Logistique, Location, Maintenance, Meteo, Conformite, Subventions.
Combined router for Phase 9 modules.
"""

import logging
import random
import os
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from typing import Optional

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db

# AI billing integration
try:
    from .ai import check_ai_guard, _check_credits, _deduct_credits, track_ai_usage
except ImportError:
    check_ai_guard = None
    _check_credits = None
    _deduct_credits = None
    track_ai_usage = None

try:
    import anthropic
    _AnthropicAPIError = anthropic.APIError
except (ImportError, AttributeError):
    anthropic = None
    _AnthropicAPIError = type("_FakeAPIError", (Exception,), {})

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Secondary Modules"])


# ============================================
# PYDANTIC MODELS
# ============================================

def _empty_to_none(v):
    """Convert empty strings to None — used on date fields to avoid PostgreSQL
    'invalid input syntax for type date: ""' errors when frontend sends blank dates."""
    return None if isinstance(v, str) and v.strip() == "" else v


class RealEstateProjectCreate(BaseModel):
    nom: str
    type_projet: Optional[str] = None
    adresse: Optional[str] = None
    ville: Optional[str] = None
    budget_total: Optional[float] = None
    date_debut: Optional[str] = None
    description: Optional[str] = None

    @field_validator("date_debut", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class UnitCreate(BaseModel):
    numero: str
    type_unite: str = "CONDO"
    superficie_m2: Optional[float] = None
    prix_vente: Optional[float] = None
    statut: str = "DISPONIBLE"

class MaintenanceRequestCreate(BaseModel):
    titre: Optional[str] = None
    description: str
    type_demande: Optional[str] = "CORRECTIVE"
    type_maintenance: Optional[str] = None
    priorite: Optional[str] = "NORMALE"
    equipement_id: Optional[int] = None
    equipement_type: Optional[str] = "INVENTORY"
    planification_id: Optional[int] = None
    symptomes: Optional[str] = None
    demandeur_id: Optional[int] = None
    date_souhaitee: Optional[str] = None
    cout_estime: Optional[float] = None
    temps_estime_heures: Optional[float] = None
    notes: Optional[str] = None

    @field_validator("date_souhaitee", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class MaintenanceRequestUpdate(BaseModel):
    statut: Optional[str] = None
    titre: Optional[str] = None
    description: Optional[str] = None
    priorite: Optional[str] = None
    type_maintenance: Optional[str] = None
    symptomes: Optional[str] = None
    date_souhaitee: Optional[str] = None
    date_planifiee: Optional[str] = None
    date_debut: Optional[str] = None
    date_fin: Optional[str] = None
    technicien_interne_id: Optional[int] = None
    fournisseur_externe_id: Optional[int] = None
    cout_estime: Optional[float] = None
    cout_reel: Optional[float] = None
    temps_estime_heures: Optional[float] = None
    temps_reel_heures: Optional[float] = None
    cause_panne: Optional[str] = None
    solution: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("date_souhaitee", "date_planifiee", "date_debut", "date_fin", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class MaintenanceTypeCreate(BaseModel):
    nom: str
    description: Optional[str] = None
    categorie: Optional[str] = "PREVENTIVE"
    frequence_jours: Optional[int] = None
    checklist_json: Optional[str] = None
    duree_estimee_heures: Optional[float] = None
    cout_estime: Optional[float] = None
    competences_requises: Optional[str] = None
    pieces_requises_json: Optional[str] = None
    actif: Optional[bool] = True

class MaintenanceTypeUpdate(BaseModel):
    nom: Optional[str] = None
    description: Optional[str] = None
    categorie: Optional[str] = None
    frequence_jours: Optional[int] = None
    checklist_json: Optional[str] = None
    duree_estimee_heures: Optional[float] = None
    cout_estime: Optional[float] = None
    competences_requises: Optional[str] = None
    pieces_requises_json: Optional[str] = None
    actif: Optional[bool] = None

class MaintenancePlanificationCreate(BaseModel):
    equipement_type: str = "INVENTORY"
    equipement_id: int
    maintenance_type_id: Optional[int] = None
    nom_planification: str
    description: Optional[str] = None
    frequence_type: Optional[str] = "JOURS"
    frequence_valeur: Optional[int] = 30
    derniere_maintenance: Optional[str] = None
    prochaine_maintenance: Optional[str] = None
    seuil_alerte_jours: Optional[int] = 7
    priorite: Optional[str] = "NORMALE"
    responsable_id: Optional[int] = None
    actif: Optional[bool] = True
    notes: Optional[str] = None

    @field_validator("derniere_maintenance", "prochaine_maintenance", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class MaintenancePlanificationUpdate(BaseModel):
    maintenance_type_id: Optional[int] = None
    nom_planification: Optional[str] = None
    description: Optional[str] = None
    frequence_type: Optional[str] = None
    frequence_valeur: Optional[int] = None
    derniere_maintenance: Optional[str] = None
    prochaine_maintenance: Optional[str] = None
    seuil_alerte_jours: Optional[int] = None
    priorite: Optional[str] = None
    responsable_id: Optional[int] = None
    actif: Optional[bool] = None
    notes: Optional[str] = None

    @field_validator("derniere_maintenance", "prochaine_maintenance", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class MaintenanceInterventionCreate(BaseModel):
    demande_id: int
    date_intervention: Optional[str] = None
    technicien_id: Optional[int] = None
    fournisseur_id: Optional[int] = None
    type_intervention: Optional[str] = None
    description_travaux: Optional[str] = None
    duree_heures: Optional[float] = None
    statut: Optional[str] = "EN_COURS"
    observations: Optional[str] = None
    recommandations: Optional[str] = None
    signature_technicien: Optional[str] = None
    entreprise_emettrice_id: Optional[int] = None

    @field_validator("date_intervention", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class MaintenanceInterventionUpdate(BaseModel):
    date_intervention: Optional[str] = None
    technicien_id: Optional[int] = None
    fournisseur_id: Optional[int] = None
    type_intervention: Optional[str] = None
    description_travaux: Optional[str] = None
    duree_heures: Optional[float] = None
    statut: Optional[str] = None
    observations: Optional[str] = None
    recommandations: Optional[str] = None
    signature_technicien: Optional[str] = None
    entreprise_emettrice_id: Optional[int] = None

    @field_validator("date_intervention", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class MaintenancePieceCreate(BaseModel):
    demande_id: Optional[int] = None
    intervention_id: Optional[int] = None
    piece_nom: str
    piece_reference: Optional[str] = None
    inventory_item_id: Optional[int] = None
    quantite: Optional[float] = 1
    cout_unitaire: Optional[float] = None
    cout_total: Optional[float] = None
    fournisseur_id: Optional[int] = None

class MaintenanceHistoriqueCreate(BaseModel):
    equipement_type: str
    equipement_id: int
    demande_id: Optional[int] = None
    type_evenement: str
    date_evenement: Optional[str] = None
    description: Optional[str] = None
    cout: Optional[float] = None
    duree_heures: Optional[float] = None
    technicien: Optional[str] = None
    compteur_heures: Optional[float] = None
    compteur_km: Optional[int] = None
    notes: Optional[str] = None

    @field_validator("date_evenement", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class MaintenanceCompteurCreate(BaseModel):
    equipement_type: str
    equipement_id: int
    type_compteur: str = "HEURES"
    valeur_actuelle: float
    date_releve: Optional[str] = None
    releve_par_id: Optional[int] = None
    notes: Optional[str] = None

    @field_validator("date_releve", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class MaintenanceAlerteCreate(BaseModel):
    equipement_type: str
    equipement_id: int
    planification_id: Optional[int] = None
    type_alerte: str
    priorite: Optional[str] = "NORMALE"
    titre: str
    message: Optional[str] = None
    date_echeance: Optional[str] = None

    @field_validator("date_echeance", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class MaintenanceAlerteUpdate(BaseModel):
    lue: Optional[bool] = None
    traitee: Optional[bool] = None
    traite_par_id: Optional[int] = None

class MaintenanceIaChatRequest(BaseModel):
    question: str
    context: Optional[str] = None

class MaintenanceIaDiagnoseRequest(BaseModel):
    equipement: str
    symptomes: str
    historique: Optional[str] = None

class MaintenanceIaPreventiveRequest(BaseModel):
    equipement: str
    utilisation: str
    derniere_maintenance: Optional[str] = None

class MaintenanceIaAnalyzeInterventionRequest(BaseModel):
    demande_id: Optional[int] = None
    equipement: Optional[str] = None
    type_maintenance: Optional[str] = None
    description: Optional[str] = None
    date_planifiee: Optional[str] = None
    duree_estimee: Optional[str] = None
    priorite: Optional[str] = None
    cout_estime: Optional[float] = None

    @field_validator("date_planifiee", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class MaintenanceIaChecklistRequest(BaseModel):
    type_maintenance: str
    equipement: str

class MaintenanceIaEstimateCostRequest(BaseModel):
    equipement: str
    probleme: str
    urgence: Optional[str] = "normale"

class RentalContractCreate(BaseModel):
    client_nom_cache: str
    client_type: Optional[str] = "ENTREPRISE"
    client_company_id: Optional[int] = None
    client_contact_id: Optional[int] = None
    project_id: Optional[int] = None
    date_debut: str
    date_fin_prevue: Optional[str] = None
    duree_type: Optional[str] = "JOUR"
    duree_nombre: Optional[int] = None
    conditions_particulieres: Optional[str] = None
    lieu_livraison: Optional[str] = None
    lieu_retour: Optional[str] = None
    caution_montant: Optional[float] = 0
    notes: Optional[str] = None

    @field_validator("date_fin_prevue", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class RentalContractUpdate(BaseModel):
    statut: Optional[str] = None
    client_nom_cache: Optional[str] = None
    date_debut: Optional[str] = None
    date_fin_prevue: Optional[str] = None
    date_fin_reelle: Optional[str] = None
    duree_type: Optional[str] = None
    duree_nombre: Optional[int] = None
    conditions_particulieres: Optional[str] = None
    lieu_livraison: Optional[str] = None
    lieu_retour: Optional[str] = None
    caution_montant: Optional[float] = None
    caution_recue: Optional[bool] = None
    notes: Optional[str] = None

    @field_validator("date_debut", "date_fin_prevue", "date_fin_reelle", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class RentalItemCreate(BaseModel):
    nom: str
    description: Optional[str] = None
    categorie: Optional[str] = None
    numero_serie: Optional[str] = None
    marque: Optional[str] = None
    modele: Optional[str] = None
    annee_fabrication: Optional[int] = None
    etat: Optional[str] = "BON"
    quantite_totale: Optional[int] = 1
    valeur_achat: Optional[float] = None
    valeur_remplacement: Optional[float] = None
    tarif_journalier: Optional[float] = None
    tarif_hebdomadaire: Optional[float] = None
    tarif_mensuel: Optional[float] = None
    caution_requise: Optional[float] = 0
    assurance_requise: Optional[bool] = False
    conditions_location: Optional[str] = None
    notes: Optional[str] = None

class RentalItemUpdate(BaseModel):
    nom: Optional[str] = None
    description: Optional[str] = None
    categorie: Optional[str] = None
    numero_serie: Optional[str] = None
    marque: Optional[str] = None
    modele: Optional[str] = None
    annee_fabrication: Optional[int] = None
    etat: Optional[str] = None
    disponible: Optional[bool] = None
    quantite_totale: Optional[int] = None
    valeur_achat: Optional[float] = None
    valeur_remplacement: Optional[float] = None
    tarif_journalier: Optional[float] = None
    tarif_hebdomadaire: Optional[float] = None
    tarif_mensuel: Optional[float] = None
    caution_requise: Optional[float] = None
    assurance_requise: Optional[bool] = None
    conditions_location: Optional[str] = None
    notes: Optional[str] = None

class RentalContratLigneCreate(BaseModel):
    location_item_id: int = Field(..., gt=0)
    quantite: Optional[int] = Field(default=1, ge=1)
    tarif_unitaire: float = Field(..., ge=0)
    tarif_type: Optional[str] = "JOUR"
    remise_pourcent: Optional[float] = Field(default=0, ge=0, le=100)
    date_sortie: Optional[str] = None
    date_retour_prevue: Optional[str] = None
    etat_sortie: Optional[str] = "BON"
    notes_sortie: Optional[str] = None

    @field_validator("date_sortie", "date_retour_prevue", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class RentalContratLigneUpdate(BaseModel):
    quantite: Optional[int] = Field(default=None, ge=1)
    tarif_unitaire: Optional[float] = Field(default=None, ge=0)
    tarif_type: Optional[str] = None
    remise_pourcent: Optional[float] = Field(default=None, ge=0, le=100)
    date_sortie: Optional[str] = None
    date_retour_prevue: Optional[str] = None
    date_retour_reelle: Optional[str] = None
    etat_sortie: Optional[str] = None
    etat_retour: Optional[str] = None
    notes_sortie: Optional[str] = None
    notes_retour: Optional[str] = None

    @field_validator("date_sortie", "date_retour_prevue", "date_retour_reelle", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class RentalRetourCreate(BaseModel):
    contrat_id: int
    ligne_id: int
    location_item_id: int
    etat_avant: Optional[str] = None
    etat_apres: Optional[str] = None
    dommages_constates: Optional[str] = None
    frais_reparation: Optional[float] = 0
    frais_nettoyage: Optional[float] = 0
    frais_retard: Optional[float] = 0
    commentaires: Optional[str] = None

class RentalEmployeeConfigUpdate(BaseModel):
    disponible_location: Optional[bool] = None
    statut_location: Optional[str] = None
    metier_principal: Optional[str] = None
    taux_horaire_location: Optional[float] = None
    taux_journalier_location: Optional[float] = None
    certifications_json: Optional[str] = None
    notes_location: Optional[str] = None

class RentalEmployeeContractCreate(BaseModel):
    employee_id: int
    client_company_id: Optional[int] = None
    project_id: Optional[int] = None
    date_debut: str
    date_fin_prevue: str
    tarif_type: Optional[str] = "JOUR"
    tarif_unitaire: Optional[float] = 0
    heures_prevues: Optional[float] = None
    lieu_travail: Optional[str] = None
    description_mission: Optional[str] = None
    notes: Optional[str] = None

class RentalEmployeeContractUpdate(BaseModel):
    statut: Optional[str] = None
    date_fin_prevue: Optional[str] = None
    date_fin_reelle: Optional[str] = None
    tarif_type: Optional[str] = None
    tarif_unitaire: Optional[float] = None
    heures_prevues: Optional[float] = None
    heures_reelles: Optional[float] = None
    montant_facture: Optional[float] = None
    lieu_travail: Optional[str] = None
    description_mission: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("date_fin_prevue", "date_fin_reelle", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class RentalEmployeeHeuresCreate(BaseModel):
    date_travail: str
    heures_normales: Optional[float] = 0
    heures_supplementaires: Optional[float] = 0
    description_taches: Optional[str] = None
    notes: Optional[str] = None

class LocationIaChatRequest(BaseModel):
    question: str
    context: Optional[str] = None

class LocationIaRecommandationRequest(BaseModel):
    description_projet: str
    budget: Optional[float] = None
    duree_jours: Optional[int] = None

class LocationIaChecklistRequest(BaseModel):
    equipement_type: str
    duree_location: str

class LocationIaLocationVsAchatRequest(BaseModel):
    equipement: str
    prix_achat: float
    tarif_location_jour: float
    utilisation_jours_an: int

class DeliveryCreate(BaseModel):
    zone_stockage: Optional[str] = None
    date_prevue: Optional[str] = None
    project_id: Optional[str] = None
    type_livraison: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("date_prevue", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class DeliveryUpdate(BaseModel):
    statut: Optional[str] = None
    vehicule_id: Optional[int] = None
    notes: Optional[str] = None

class EquipmentCreate(BaseModel):
    nom: str
    categorie: Optional[str] = None
    type_possession: Optional[str] = None
    cout_journalier: Optional[float] = None
    cout_mensuel: Optional[float] = None
    statut: Optional[str] = "disponible"
    localisation_actuelle: Optional[str] = None
    notes: Optional[str] = None

class EquipmentUpdate(BaseModel):
    nom: Optional[str] = None
    categorie: Optional[str] = None
    statut: Optional[str] = None
    localisation_actuelle: Optional[str] = None
    notes: Optional[str] = None

class VehicleCreate(BaseModel):
    immatriculation: str
    marque: Optional[str] = None
    modele: Optional[str] = None
    annee: Optional[int] = None
    type_vehicule: Optional[str] = None
    capacite_charge: Optional[float] = None
    unite_capacite: Optional[str] = None
    kilometrage: Optional[float] = None
    consommation_moyenne: Optional[float] = None
    cout_km: Optional[float] = None
    notes: Optional[str] = None

class VehicleUpdate(BaseModel):
    statut: Optional[str] = None
    kilometrage: Optional[float] = None
    notes: Optional[str] = None

class CoordinationCreate(BaseModel):
    project_id: Optional[int] = None
    date_coordination: str
    type_activite: str
    heure_debut: Optional[str] = None
    heure_fin: Optional[str] = None
    zone_concernee: Optional[str] = None
    responsable: Optional[str] = None
    notes: Optional[str] = None

class CoordinationUpdate(BaseModel):
    statut: Optional[str] = None
    notes: Optional[str] = None

class DeliveryItemCreate(BaseModel):
    description: str
    quantite_prevue: Optional[float] = None
    unite: Optional[str] = None

class ReservationCreate(BaseModel):
    project_id: Optional[int] = None
    date_debut: str
    date_fin: Optional[str] = None
    responsable: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("date_fin", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class EquipmentMaintenanceCreate(BaseModel):
    type_intervention: Optional[str] = None
    date_intervention: str
    description: Optional[str] = None
    cout: Optional[float] = None
    technicien: Optional[str] = None
    prochaine_date: Optional[str] = None
    conforme: Optional[bool] = True
    documents: Optional[str] = None

    @field_validator("prochaine_date", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class EquipmentMaintenanceUpdate(BaseModel):
    type_intervention: Optional[str] = None
    description: Optional[str] = None
    cout: Optional[float] = None
    technicien: Optional[str] = None
    prochaine_date: Optional[str] = None
    conforme: Optional[bool] = None
    documents: Optional[str] = None

    @field_validator("prochaine_date", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

class AlerteUpdate(BaseModel):
    statut: Optional[str] = None
    traite_par: Optional[str] = None

class LogistiqueIaChatRequest(BaseModel):
    question: str
    context: Optional[str] = None

class LogistiqueIaOptimisationRequest(BaseModel):
    besoin: str
    nombre_vehicules: Optional[int] = None
    nombre_equipements: Optional[int] = None
    nombre_livraisons_semaine: Optional[int] = None

class TripCreate(BaseModel):
    project_id: Optional[int] = None
    destination: str
    motif: Optional[str] = None
    km_depart: Optional[float] = None

# ============================================
# HELPERS
# ============================================

def _tenant_query(user: ErpUser, query: str, params: tuple = (), table_check: str = ""):
    """Execute a tenant-scoped query and return results."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        if table_check:
            cursor.execute(
                "SELECT EXISTS (SELECT FROM information_schema.tables "
                "WHERE table_schema = %s AND table_name = %s)",
                (user.schema, table_check),
            )
            if not cursor.fetchone().get("exists", False):
                return []
        cursor.execute(query, params)
        results = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in list(d.keys()):
                if (k.endswith("_at") or k.startswith("date")) and d[k]:
                    d[k] = str(d[k])
                elif isinstance(d[k], (float,)):
                    pass  # keep as-is
            results.append(d)
        return results
    except Exception as exc:
        logger.error("_tenant_query error: %s", exc)
        return []
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _ensure_table(cursor, ddl: str):
    """Run a CREATE TABLE IF NOT EXISTS statement."""
    cursor.execute(ddl)


def _ensure_columns(cursor, table: str, columns: list):
    """Add missing columns to an existing table (defensive migration)."""
    for col, typedef in columns:
        try:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {typedef}")
        except Exception:
            pass


def _gen_numero(prefix: str) -> str:
    """Generate a random reference number like MR-83421."""
    return f"{prefix}-{random.randint(10000, 99999)}"


def _serialize_row(row: dict) -> dict:
    """Convert date/Decimal fields in a row dict to JSON-safe types."""
    from decimal import Decimal
    d = dict(row)
    for k in list(d.keys()):
        if (k.endswith("_at") or k.startswith("date") or k.startswith("prochaine")) and d[k]:
            d[k] = str(d[k])
        elif isinstance(d[k], Decimal):
            d[k] = float(d[k])
    return d


# ============================================
# LOGISTICS (Logistique)
# ============================================

@router.get("/logistics/deliveries")
async def list_deliveries(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    statut: Optional[str] = None,
):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        wheres = []
        params = []
        if statut:
            wheres.append("statut = %s")
            params.append(statut)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(f"SELECT COUNT(*) as total FROM logistics_deliveries WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT id, reference, project_id, fournisseur_id, type_livraison, statut, "
            f"date_prevue, date_effective, zone_stockage, notes, created_at "
            f"FROM logistics_deliveries WHERE {w} "
            f"ORDER BY created_at DESC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_prevue", "date_effective", "created_at"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except Exception as exc:
        logger.error("list_deliveries error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/logistics/vehicles")
async def list_vehicles(user: ErpUser = Depends(get_current_user)):
    items = _tenant_query(
        user,
        "SELECT id, immatriculation, marque, modele, annee, type_vehicule, statut, "
        "kilometrage, created_at FROM logistics_vehicles ORDER BY marque ASC",
        table_check="logistics_vehicles",
    )
    return {"items": items}


@router.post("/logistics/deliveries")
async def create_delivery(body: DeliveryCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new logistics delivery."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, """
            CREATE TABLE IF NOT EXISTS logistics_deliveries (
                id SERIAL PRIMARY KEY,
                reference TEXT UNIQUE,
                project_id INTEGER,
                fournisseur_id INTEGER,
                date_prevue DATE NOT NULL,
                heure_prevue TIME,
                date_effective DATE,
                heure_effective TIME,
                statut TEXT DEFAULT 'planifiee',
                type_livraison TEXT,
                zone_stockage TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        reference = _gen_numero("LIV")
        cursor.execute(
            "INSERT INTO logistics_deliveries (reference, zone_stockage, date_prevue, project_id, type_livraison, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id, reference",
            (reference, body.zone_stockage, body.date_prevue, body.project_id, body.type_livraison, body.notes),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "reference": row["reference"], "message": "Livraison créée"}
    except Exception as exc:
        conn.rollback()
        logger.error("create_delivery error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/logistics/deliveries/{delivery_id}")
async def update_delivery(delivery_id: int, body: DeliveryUpdate, user: ErpUser = Depends(get_current_user)):
    """Update an existing delivery."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        sets = []
        params = []
        if body.statut is not None:
            sets.append("statut = %s")
            params.append(body.statut)
        if body.notes is not None:
            sets.append("notes = %s")
            params.append(body.notes)
        if not sets:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        params.append(delivery_id)
        cursor.execute(
            f"UPDATE logistics_deliveries SET {', '.join(sets)} WHERE id = %s RETURNING id",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Livraison introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Livraison mise à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_delivery error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/logistics/statistics")
async def get_logistics_stats(user: ErpUser = Depends(get_current_user)):
    """Return enhanced logistics statistics."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        def _table_exists(tname):
            cursor.execute(
                "SELECT EXISTS (SELECT FROM information_schema.tables "
                "WHERE table_schema = %s AND table_name = %s)",
                (user.schema, tname),
            )
            return cursor.fetchone().get("exists", False)

        # -- Livraisons --
        livraisons = {"total": 0, "planifiees": 0, "en_cours": 0, "cette_semaine": 0}
        if _table_exists("logistics_deliveries"):
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_deliveries")
            livraisons["total"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_deliveries WHERE statut = 'planifiee'")
            livraisons["planifiees"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_deliveries WHERE statut = 'en_cours'")
            livraisons["en_cours"] = cursor.fetchone()["cnt"]
            cursor.execute(
                "SELECT COUNT(*) as cnt FROM logistics_deliveries "
                "WHERE date_prevue >= date_trunc('week', CURRENT_DATE) "
                "AND date_prevue < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days'"
            )
            livraisons["cette_semaine"] = cursor.fetchone()["cnt"]

        # -- Equipements --
        equipements = {"total": 0, "disponibles": 0, "en_utilisation": 0, "en_maintenance": 0}
        if _table_exists("logistics_equipment"):
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_equipment")
            equipements["total"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_equipment WHERE statut = 'disponible'")
            equipements["disponibles"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_equipment WHERE statut = 'en_utilisation'")
            equipements["en_utilisation"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_equipment WHERE statut = 'en_maintenance'")
            equipements["en_maintenance"] = cursor.fetchone()["cnt"]

        # -- Vehicules --
        vehicules = {"total": 0, "disponibles": 0, "en_deplacement": 0, "km_total": 0}
        if _table_exists("logistics_vehicles"):
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_vehicles")
            vehicules["total"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_vehicles WHERE statut = 'disponible'")
            vehicules["disponibles"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_vehicles WHERE statut = 'en_deplacement'")
            vehicules["en_deplacement"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COALESCE(SUM(kilometrage), 0) as km FROM logistics_vehicles")
            vehicules["km_total"] = float(cursor.fetchone()["km"])

        # -- Alertes --
        alertes = 0
        if _table_exists("logistics_alerts"):
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_alerts WHERE statut = 'active'")
            alertes = cursor.fetchone()["cnt"]

        return {
            "livraisons": livraisons,
            "equipements": equipements,
            "vehicules": vehicules,
            "alertes": alertes,
        }
    except Exception as exc:
        logger.error("get_logistics_stats error: %s", exc)
        return {
            "livraisons": {"total": 0, "planifiees": 0, "en_cours": 0, "cette_semaine": 0},
            "equipements": {"total": 0, "disponibles": 0, "en_utilisation": 0, "en_maintenance": 0},
            "vehicules": {"total": 0, "disponibles": 0, "en_deplacement": 0, "km_total": 0},
            "alertes": 0,
            "error": "Erreur interne",
        }
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── DDL helpers for location (rental) tables ──

_DDL_LOCATION_ITEMS = """
    CREATE TABLE IF NOT EXISTS location_items (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(255) NOT NULL,
        description TEXT,
        categorie VARCHAR(100),
        numero_serie VARCHAR(100),
        marque VARCHAR(100),
        modele VARCHAR(100),
        annee_fabrication INTEGER,
        etat VARCHAR(30) DEFAULT 'BON',
        disponible BOOLEAN DEFAULT TRUE,
        quantite_totale INTEGER DEFAULT 1,
        quantite_disponible INTEGER DEFAULT 1,
        valeur_achat NUMERIC(12,2),
        valeur_remplacement NUMERIC(12,2),
        tarif_journalier NUMERIC(10,2),
        tarif_hebdomadaire NUMERIC(10,2),
        tarif_mensuel NUMERIC(10,2),
        tarif_degressif_actif BOOLEAN DEFAULT FALSE,
        seuil_degressif_jours INTEGER,
        reduction_degressif_pourcent NUMERIC(5,2),
        caution_requise NUMERIC(10,2) DEFAULT 0,
        assurance_requise BOOLEAN DEFAULT FALSE,
        conditions_location TEXT,
        notes TEXT,
        actif BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_LOCATION_CONTRATS = """
    CREATE TABLE IF NOT EXISTS location_contrats (
        id SERIAL PRIMARY KEY,
        numero_contrat TEXT UNIQUE,
        client_type VARCHAR(30) DEFAULT 'ENTREPRISE',
        client_company_id INTEGER,
        client_contact_id INTEGER,
        client_nom_cache TEXT,
        project_id INTEGER,
        responsable_id INTEGER,
        statut VARCHAR(30) DEFAULT 'BROUILLON',
        date_debut DATE,
        date_fin_prevue DATE,
        date_fin_reelle DATE,
        duree_type VARCHAR(20) DEFAULT 'JOUR',
        duree_nombre INTEGER,
        montant_ht NUMERIC(12,2) DEFAULT 0,
        taux_tps NUMERIC(5,3) DEFAULT 5.0,
        montant_tps NUMERIC(12,2) DEFAULT 0,
        taux_tvq NUMERIC(5,3) DEFAULT 9.975,
        montant_tvq NUMERIC(12,2) DEFAULT 0,
        montant_total NUMERIC(12,2) DEFAULT 0,
        caution_montant NUMERIC(10,2) DEFAULT 0,
        caution_recue BOOLEAN DEFAULT FALSE,
        conditions_particulieres TEXT,
        lieu_livraison TEXT,
        lieu_retour TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_LOCATION_CONTRAT_LIGNES = """
    CREATE TABLE IF NOT EXISTS location_contrat_lignes (
        id SERIAL PRIMARY KEY,
        contrat_id INTEGER NOT NULL,
        location_item_id INTEGER NOT NULL,
        quantite INTEGER DEFAULT 1,
        tarif_unitaire NUMERIC(10,2),
        tarif_type VARCHAR(20) DEFAULT 'JOUR',
        remise_pourcent NUMERIC(5,2) DEFAULT 0,
        montant_ligne NUMERIC(12,2) DEFAULT 0,
        date_sortie DATE,
        date_retour_prevue DATE,
        date_retour_reelle DATE,
        etat_sortie TEXT,
        etat_retour TEXT,
        notes_sortie TEXT,
        notes_retour TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_LOCATION_RETOURS = """
    CREATE TABLE IF NOT EXISTS location_retours (
        id SERIAL PRIMARY KEY,
        contrat_id INTEGER,
        ligne_id INTEGER,
        location_item_id INTEGER,
        date_retour TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        etat_avant TEXT,
        etat_apres TEXT,
        dommages_constates TEXT,
        frais_reparation NUMERIC(10,2) DEFAULT 0,
        frais_nettoyage NUMERIC(10,2) DEFAULT 0,
        frais_retard NUMERIC(10,2) DEFAULT 0,
        commentaires TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_EMPLOYEE_LOCATION = """
    CREATE TABLE IF NOT EXISTS employee_location (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER UNIQUE NOT NULL,
        disponible_location BOOLEAN DEFAULT TRUE,
        statut_location VARCHAR(30) DEFAULT 'DISPONIBLE',
        metier_principal VARCHAR(100),
        taux_horaire_location NUMERIC(10,2),
        taux_journalier_location NUMERIC(10,2),
        certifications_json TEXT,
        notes_location TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_LOCATION_CONTRATS_EMPLOYES = """
    CREATE TABLE IF NOT EXISTS location_contrats_employes (
        id SERIAL PRIMARY KEY,
        numero_contrat TEXT UNIQUE,
        employee_id INTEGER NOT NULL,
        client_company_id INTEGER,
        client_contact_id INTEGER,
        project_id INTEGER,
        statut VARCHAR(30) DEFAULT 'BROUILLON',
        date_debut DATE NOT NULL,
        date_fin_prevue DATE NOT NULL,
        date_fin_reelle DATE,
        tarif_type VARCHAR(20) DEFAULT 'JOUR',
        tarif_unitaire NUMERIC(10,2),
        heures_prevues NUMERIC(10,2),
        heures_reelles NUMERIC(10,2) DEFAULT 0,
        montant_estime_ht NUMERIC(12,2),
        montant_facture NUMERIC(12,2) DEFAULT 0,
        lieu_travail TEXT,
        description_mission TEXT,
        conditions_particulieres TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_LOCATION_EMPLOYES_HEURES = """
    CREATE TABLE IF NOT EXISTS location_employes_heures (
        id SERIAL PRIMARY KEY,
        contrat_id INTEGER NOT NULL,
        date_travail DATE NOT NULL,
        heures_normales NUMERIC(5,2) DEFAULT 0,
        heures_supplementaires NUMERIC(5,2) DEFAULT 0,
        description_taches TEXT,
        notes TEXT,
        valide BOOLEAN DEFAULT FALSE,
        valide_par INTEGER,
        valide_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""


# ── DDL helpers for logistics tables ──

_DDL_LOGISTICS_DELIVERIES = """
    CREATE TABLE IF NOT EXISTS logistics_deliveries (
        id SERIAL PRIMARY KEY,
        reference VARCHAR(50) UNIQUE,
        project_id INTEGER,
        fournisseur_id INTEGER,
        date_prevue DATE NOT NULL,
        heure_prevue TIME,
        date_effective DATE,
        heure_effective TIME,
        statut VARCHAR(30) DEFAULT 'planifiee',
        type_livraison VARCHAR(50),
        zone_stockage VARCHAR(100),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_LOGISTICS_DELIVERY_ITEMS = """
    CREATE TABLE IF NOT EXISTS logistics_delivery_items (
        id SERIAL PRIMARY KEY,
        delivery_id INTEGER REFERENCES logistics_deliveries(id) ON DELETE CASCADE,
        inventory_item_id INTEGER,
        description VARCHAR(255),
        quantite_prevue DECIMAL(12,2),
        quantite_recue DECIMAL(12,2),
        unite VARCHAR(20),
        conforme BOOLEAN DEFAULT TRUE,
        notes TEXT
    )
"""

_DDL_LOGISTICS_EQUIPMENT = """
    CREATE TABLE IF NOT EXISTS logistics_equipment (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE,
        nom VARCHAR(255) NOT NULL,
        description TEXT,
        categorie VARCHAR(100),
        type_possession VARCHAR(20) DEFAULT 'propriete',
        fournisseur_location_id INTEGER,
        cout_journalier DECIMAL(10,2),
        cout_mensuel DECIMAL(10,2),
        date_acquisition DATE,
        date_fin_location DATE,
        valeur_achat DECIMAL(12,2),
        statut VARCHAR(30) DEFAULT 'disponible',
        localisation_actuelle VARCHAR(255),
        project_id_actuel INTEGER,
        prochaine_maintenance DATE,
        prochaine_inspection DATE,
        heures_utilisation DECIMAL(10,2) DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_LOGISTICS_EQUIPMENT_RESERVATIONS = """
    CREATE TABLE IF NOT EXISTS logistics_equipment_reservations (
        id SERIAL PRIMARY KEY,
        equipment_id INTEGER REFERENCES logistics_equipment(id) ON DELETE CASCADE,
        project_id INTEGER,
        date_debut DATE NOT NULL,
        date_fin DATE NOT NULL,
        responsable VARCHAR(255),
        statut VARCHAR(30) DEFAULT 'reservee',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_LOGISTICS_EQUIPMENT_MAINTENANCE = """
    CREATE TABLE IF NOT EXISTS logistics_equipment_maintenance (
        id SERIAL PRIMARY KEY,
        equipment_id INTEGER REFERENCES logistics_equipment(id) ON DELETE CASCADE,
        type_intervention VARCHAR(50),
        date_intervention DATE NOT NULL,
        description TEXT,
        cout DECIMAL(10,2),
        technicien VARCHAR(255),
        prochaine_date DATE,
        conforme BOOLEAN DEFAULT TRUE,
        documents TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_LOGISTICS_VEHICLES = """
    CREATE TABLE IF NOT EXISTS logistics_vehicles (
        id SERIAL PRIMARY KEY,
        immatriculation VARCHAR(20) UNIQUE,
        marque VARCHAR(100),
        modele VARCHAR(100),
        annee INTEGER,
        type_vehicule VARCHAR(50),
        capacite_charge DECIMAL(10,2),
        unite_capacite VARCHAR(20) DEFAULT 'kg',
        kilometrage INTEGER DEFAULT 0,
        consommation_moyenne DECIMAL(5,2),
        cout_km DECIMAL(5,2),
        statut VARCHAR(30) DEFAULT 'disponible',
        conducteur_attritre_id INTEGER,
        date_prochain_entretien DATE,
        date_prochaine_inspection DATE,
        assurance_expiration DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_LOGISTICS_VEHICLE_TRIPS = """
    CREATE TABLE IF NOT EXISTS logistics_vehicle_trips (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER REFERENCES logistics_vehicles(id) ON DELETE CASCADE,
        project_id INTEGER,
        conducteur_id INTEGER,
        date_depart TIMESTAMP NOT NULL,
        date_retour TIMESTAMP,
        km_depart INTEGER,
        km_retour INTEGER,
        destination VARCHAR(255),
        motif VARCHAR(255),
        carburant_litres DECIMAL(8,2),
        cout_carburant DECIMAL(10,2),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_LOGISTICS_SITE_COORDINATION = """
    CREATE TABLE IF NOT EXISTS logistics_site_coordination (
        id SERIAL PRIMARY KEY,
        reference VARCHAR(50) UNIQUE,
        project_id INTEGER,
        date_coordination DATE NOT NULL,
        type_activite VARCHAR(100),
        heure_debut TIME,
        heure_fin TIME,
        zone_concernee VARCHAR(100),
        acces_requis TEXT,
        contraintes TEXT,
        sequence_ordre INTEGER,
        statut VARCHAR(30) DEFAULT 'planifie',
        responsable VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_LOGISTICS_ALERTS = """
    CREATE TABLE IF NOT EXISTS logistics_alerts (
        id SERIAL PRIMARY KEY,
        type_alerte VARCHAR(50),
        reference_type VARCHAR(50),
        reference_id INTEGER,
        message TEXT NOT NULL,
        priorite VARCHAR(20) DEFAULT 'normale',
        date_alerte TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        date_echeance DATE,
        statut VARCHAR(20) DEFAULT 'active',
        traite_par VARCHAR(255),
        date_traitement TIMESTAMP
    )
"""

LOCATION_AI_SYSTEM_PROMPT = """Tu es un expert en location d'equipements de construction et en pret de main-d'oeuvre au Quebec.

Tu maitrises les domaines suivants:

1. Types d'equipements de location:
   - Equipements lourds: excavatrices, retrochargeuses, chargeuses, bouteurs, niveleuses
   - Levage: grues mobiles, grues a tour, nacelles elevatrices, chariots telescopiques
   - Compresseurs et generatrices: compresseurs d'air, generatrices diesel et essence
   - Outils electriques: scies, perceuses, marteaux piqueurs, plaques vibrantes
   - Echafaudages: tubulaires, a cadres, suspendus, roulants
   - Pompes: pompes a beton, pompes d'assechement, pompes submersibles
   - Soudage: postes a souder MIG, TIG, baguettes
   - Vehicules: camions-bennes, fardiers, camions-grues

2. Pret de main-d'oeuvre (location d'employes):
   - Reglementation CCQ (Commission de la Construction du Quebec)
   - Cartes de competence et metiers reglementes
   - Calcul des couts: taux horaire, taux journalier, heures supplementaires
   - Responsabilites de l'employeur vs le client
   - Assurance CNESST et couverture en cas d'accident
   - Conventions collectives applicables

3. Tarification et facturation:
   - Tarifs horaires, journaliers, hebdomadaires, mensuels
   - Tarifs degressifs selon la duree
   - Calcul location vs achat (seuil de rentabilite)
   - Taxes TPS (5%) et TVQ (9.975%)
   - Cautions et assurances

4. Gestion des contrats:
   - Conditions generales de location
   - Clauses specifiques au pret de main-d'oeuvre
   - Reservations et disponibilite
   - Retours et inspection des equipements
   - Gestion des dommages et penalites

5. Securite et conformite:
   - Normes CNESST pour les equipements
   - Certifications operateurs (carte de grutier, nacelliste, etc.)
   - Inspections pre-utilisation et post-retour
   - Programme de prevention ASP Construction
   - Registre d'entretien et verification periodique

Reponds toujours en francais et adapte tes conseils au contexte quebecois de la construction."""


def _get_location_ai_client():
    """Get Anthropic client for location (rental) IA."""
    if anthropic is None:
        return None
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    return anthropic.Anthropic(api_key=api_key)


MAINTENANCE_AI_SYSTEM_PROMPT = """Tu es un expert-conseil specialise en maintenance d'equipements et materiel de construction au Quebec.
Tu possedes une expertise approfondie sur:

MAINTENANCE PREVENTIVE:
- Planification des maintenances regulieres
- Intervalles de maintenance (heures, kilometrage, temps)
- Checklists d'inspection
- Lubrification et graissage
- Remplacement preventif des pieces d'usure
- Calendriers de maintenance saisonniere

MAINTENANCE CORRECTIVE:
- Diagnostic de pannes et dysfonctionnements
- Identification des causes racines
- Procedures de reparation
- Priorisation des interventions urgentes
- Gestion des arrets non planifies

EQUIPEMENTS DE CONSTRUCTION:
- Equipements lourds (excavatrice, chargeuse, bulldozer)
- Equipements de levage (grues, nacelles, chariots)
- Compresseurs et generatrices
- Outils electriques et pneumatiques
- Systemes hydrauliques et pneumatiques
- Moteurs diesel et essence

GESTION DES INTERVENTIONS:
- Planification des travaux
- Estimation des temps d'intervention
- Coordination avec la production
- Documentation des interventions
- Suivi des historiques de maintenance

OPTIMISATION DES COUTS:
- Analyse cout de maintenance vs remplacement
- Gestion des pieces de rechange
- Reduction des temps d'arret
- Maintenance predictive
- Negociation avec les fournisseurs

SECURITE ET CONFORMITE:
- Normes CNESST pour les equipements
- Inspections obligatoires
- Certifications requises
- Procedures de verrouillage/etiquetage (LOTO)
- Documentation reglementaire

TON ROLE:
1. Diagnostiquer les problemes d'equipements
2. Recommander des maintenances preventives adaptees
3. Estimer les couts et delais d'intervention
4. Conseiller sur la gestion des pieces de rechange
5. Optimiser les plannings de maintenance

IMPORTANT:
- La securite est toujours la priorite
- Recommander de faire appel a des techniciens certifies pour les travaux complexes
- Les couts sont indicatifs et varient selon les fournisseurs

Reponds toujours en francais quebecois, de maniere professionnelle et pratique."""


def _get_maintenance_ai_client():
    """Get Anthropic client for maintenance IA."""
    if anthropic is None:
        return None
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    return anthropic.Anthropic(api_key=api_key)


_DDL_MAINTENANCE_TYPES = """
    CREATE TABLE IF NOT EXISTS maintenance_types (
        id SERIAL PRIMARY KEY,
        nom TEXT NOT NULL,
        description TEXT,
        categorie TEXT DEFAULT 'PREVENTIVE',
        frequence_jours INTEGER,
        checklist_json TEXT,
        duree_estimee_heures NUMERIC(5,2),
        cout_estime NUMERIC(10,2),
        competences_requises TEXT,
        pieces_requises_json TEXT,
        actif BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_MAINTENANCE_PLANIFICATION = """
    CREATE TABLE IF NOT EXISTS maintenance_planification (
        id SERIAL PRIMARY KEY,
        equipement_type TEXT NOT NULL DEFAULT 'INVENTORY',
        equipement_id INTEGER NOT NULL,
        maintenance_type_id INTEGER,
        nom_planification TEXT NOT NULL,
        description TEXT,
        frequence_type TEXT DEFAULT 'JOURS',
        frequence_valeur INTEGER DEFAULT 30,
        derniere_maintenance DATE,
        prochaine_maintenance DATE,
        seuil_alerte_jours INTEGER DEFAULT 7,
        priorite TEXT DEFAULT 'NORMALE',
        responsable_id INTEGER,
        actif BOOLEAN DEFAULT TRUE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_MAINTENANCE_DEMANDES = """
    CREATE TABLE IF NOT EXISTS maintenance_demandes (
        id SERIAL PRIMARY KEY,
        numero_demande TEXT UNIQUE NOT NULL,
        equipement_type TEXT NOT NULL DEFAULT 'INVENTORY',
        equipement_id INTEGER NOT NULL DEFAULT 0,
        planification_id INTEGER,
        type_maintenance TEXT DEFAULT 'CORRECTIVE',
        priorite TEXT DEFAULT 'NORMALE',
        statut TEXT DEFAULT 'DEMANDE',
        titre TEXT NOT NULL DEFAULT '',
        description TEXT,
        symptomes TEXT,
        demandeur_id INTEGER,
        date_demande TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        date_souhaitee DATE,
        date_planifiee DATE,
        date_debut TIMESTAMP,
        date_fin TIMESTAMP,
        technicien_interne_id INTEGER,
        fournisseur_externe_id INTEGER,
        cout_estime NUMERIC(10,2),
        cout_reel NUMERIC(10,2),
        temps_estime_heures NUMERIC(5,2),
        temps_reel_heures NUMERIC(5,2),
        cause_panne TEXT,
        solution TEXT,
        pieces_utilisees_json TEXT,
        photos_avant TEXT,
        photos_apres TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_MAINTENANCE_INTERVENTIONS = """
    CREATE TABLE IF NOT EXISTS maintenance_interventions (
        id SERIAL PRIMARY KEY,
        demande_id INTEGER NOT NULL,
        date_intervention TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        technicien_id INTEGER,
        fournisseur_id INTEGER,
        type_intervention TEXT,
        description_travaux TEXT,
        duree_heures NUMERIC(5,2),
        statut TEXT DEFAULT 'EN_COURS',
        observations TEXT,
        recommandations TEXT,
        signature_technicien TEXT,
        entreprise_emettrice_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_MAINTENANCE_PIECES = """
    CREATE TABLE IF NOT EXISTS maintenance_pieces (
        id SERIAL PRIMARY KEY,
        demande_id INTEGER,
        intervention_id INTEGER,
        piece_nom TEXT NOT NULL,
        piece_reference TEXT,
        inventory_item_id INTEGER,
        quantite NUMERIC(10,2) DEFAULT 1,
        cout_unitaire NUMERIC(10,2),
        cout_total NUMERIC(10,2),
        fournisseur_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_MAINTENANCE_HISTORIQUE = """
    CREATE TABLE IF NOT EXISTS maintenance_historique (
        id SERIAL PRIMARY KEY,
        equipement_type TEXT NOT NULL,
        equipement_id INTEGER NOT NULL,
        demande_id INTEGER,
        type_evenement TEXT NOT NULL DEFAULT 'MAINTENANCE',
        date_evenement TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        description TEXT,
        cout NUMERIC(10,2),
        duree_heures NUMERIC(5,2),
        technicien TEXT,
        compteur_heures NUMERIC(10,2),
        compteur_km INTEGER,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""

_DDL_MAINTENANCE_COMPTEURS = """
    CREATE TABLE IF NOT EXISTS maintenance_compteurs (
        id SERIAL PRIMARY KEY,
        equipement_type TEXT NOT NULL,
        equipement_id INTEGER NOT NULL,
        type_compteur TEXT NOT NULL DEFAULT 'HEURES',
        valeur_actuelle NUMERIC(12,2) DEFAULT 0,
        date_releve TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        releve_par_id INTEGER,
        notes TEXT
    )
"""

_DDL_MAINTENANCE_ALERTES = """
    CREATE TABLE IF NOT EXISTS maintenance_alertes (
        id SERIAL PRIMARY KEY,
        equipement_type TEXT NOT NULL,
        equipement_id INTEGER NOT NULL,
        planification_id INTEGER,
        type_alerte TEXT NOT NULL,
        priorite TEXT DEFAULT 'NORMALE',
        titre TEXT NOT NULL,
        message TEXT,
        date_alerte TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        date_echeance DATE,
        lue BOOLEAN DEFAULT FALSE,
        traitee BOOLEAN DEFAULT FALSE,
        traite_par_id INTEGER,
        date_traitement TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
"""


def _ensure_maintenance_tables(cursor):
    """Ensure all 8 maintenance tables exist (called at top of each endpoint)."""
    _ensure_table(cursor, _DDL_MAINTENANCE_TYPES)
    _ensure_table(cursor, _DDL_MAINTENANCE_PLANIFICATION)
    _ensure_table(cursor, _DDL_MAINTENANCE_DEMANDES)
    _ensure_table(cursor, _DDL_MAINTENANCE_INTERVENTIONS)
    _ensure_table(cursor, _DDL_MAINTENANCE_PIECES)
    _ensure_table(cursor, _DDL_MAINTENANCE_HISTORIQUE)
    _ensure_table(cursor, _DDL_MAINTENANCE_COMPTEURS)
    _ensure_table(cursor, _DDL_MAINTENANCE_ALERTES)
    # Defensive columns for pre-existing maintenance_demandes tables
    defensive_cols = [
        ("symptomes", "TEXT"),
        ("date_souhaitee", "DATE"),
        ("fournisseur_externe_id", "INTEGER"),
        ("temps_estime_heures", "NUMERIC(5,2)"),
        ("temps_reel_heures", "NUMERIC(5,2)"),
        ("cause_panne", "TEXT"),
        ("solution", "TEXT"),
        ("pieces_utilisees_json", "TEXT"),
        ("photos_avant", "TEXT"),
        ("photos_apres", "TEXT"),
        ("planification_id", "INTEGER"),
        ("technicien_interne_id", "INTEGER"),
    ]
    for col_name, col_type in defensive_cols:
        try:
            cursor.execute(f"ALTER TABLE maintenance_demandes ADD COLUMN IF NOT EXISTS {col_name} {col_type}")
        except Exception as exc:
            logger.warning("ALTER maintenance_demandes ADD %s failed: %s", col_name, exc)


LOGISTIQUE_AI_SYSTEM_PROMPT = """Tu es un expert en logistique de construction au Quebec, specialise dans:

1. Gestion des livraisons de chantier:
   - Planification et coordination des livraisons de materiaux
   - Optimisation des fenetres de livraison
   - Gestion des contraintes d'acces aux chantiers
   - Suivi des receptions et controle qualite

2. Gestion des equipements et outils:
   - Allocation optimale des equipements entre chantiers
   - Planification de la maintenance preventive
   - Gestion des locations vs achats
   - Suivi des inspections reglementaires

3. Gestion de flotte de vehicules:
   - Optimisation des routes et tournees
   - Suivi de consommation et couts
   - Planification de l'entretien
   - Gestion des permis et conformites

4. Coordination logistique de chantier:
   - Synchronisation des approvisionnements avec l'avancement des travaux
   - Gestion des zones de stockage sur site
   - Coordination multi-fournisseurs
   - Gestion des urgences et imprevus

5. Reglementations et normes quebecoises:
   - Reglements de la SAAQ (transport lourd)
   - Normes du MTQ (Ministere des Transports)
   - Reglements municipaux sur les livraisons
   - Normes de securite sur les chantiers (CNESST)
   - Heures de livraison autorisees selon les municipalites

Tu analyses les donnees logistiques avec expertise et fournis des recommandations
concretes pour optimiser les operations, reduire les couts et ameliorer l'efficacite.

Reponds toujours en francais et adapte tes conseils au contexte quebecois de la construction."""


def _get_logistique_ai_client():
    """Get Anthropic client for logistics IA."""
    if anthropic is None:
        return None
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    return anthropic.Anthropic(api_key=api_key)


# ── 1. DELETE delivery ──

@router.delete("/logistics/deliveries/{delivery_id}")
async def delete_delivery(delivery_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a logistics delivery."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM logistics_deliveries WHERE id = %s RETURNING id",
            (delivery_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Livraison introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Livraison supprimée"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_delivery error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 2. GET single delivery with items ──

@router.get("/logistics/deliveries/{delivery_id}")
async def get_delivery(delivery_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single delivery with its items."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, reference, project_id, fournisseur_id, type_livraison, statut, "
            "date_prevue, date_effective, zone_stockage, notes, created_at "
            "FROM logistics_deliveries WHERE id = %s",
            (delivery_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Livraison introuvable")
        delivery = _serialize_row(row)
        # Fetch items
        items = []
        _ensure_table(cursor, _DDL_LOGISTICS_DELIVERY_ITEMS)
        cursor.execute(
            "SELECT id, delivery_id, inventory_item_id, description, quantite_prevue, "
            "quantite_recue, unite, conforme, notes "
            "FROM logistics_delivery_items WHERE delivery_id = %s ORDER BY id",
            (delivery_id,),
        )
        for r in cursor.fetchall():
            items.append(_serialize_row(r))
        delivery["items"] = items
        return delivery
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_delivery error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 3. POST / DELETE delivery items ──

@router.post("/logistics/deliveries/{delivery_id}/items")
async def create_delivery_item(delivery_id: int, body: DeliveryItemCreate, user: ErpUser = Depends(get_current_user)):
    """Add an item to a delivery."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_DELIVERIES)
        _ensure_table(cursor, _DDL_LOGISTICS_DELIVERY_ITEMS)
        # Verify delivery exists
        cursor.execute("SELECT id FROM logistics_deliveries WHERE id = %s", (delivery_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Livraison introuvable")
        cursor.execute(
            "INSERT INTO logistics_delivery_items (delivery_id, description, quantite_prevue, unite) "
            "VALUES (%s, %s, %s, %s) RETURNING id",
            (delivery_id, body.description, body.quantite_prevue, body.unite),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Item ajoute"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_delivery_item error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/logistics/deliveries/{delivery_id}/items/{item_id}")
async def delete_delivery_item(delivery_id: int, item_id: int, user: ErpUser = Depends(get_current_user)):
    """Remove an item from a delivery."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM logistics_delivery_items WHERE id = %s AND delivery_id = %s RETURNING id",
            (item_id, delivery_id),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Item introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Item supprime"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_delivery_item error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 4. Equipment CRUD ──

@router.get("/logistics/equipment")
async def list_equipment(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    categorie: Optional[str] = None,
    statut: Optional[str] = None,
):
    """List logistics equipment with pagination and filters."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT)
        wheres = []
        params: list = []
        if categorie:
            wheres.append("categorie = %s")
            params.append(categorie)
        if statut:
            wheres.append("statut = %s")
            params.append(statut)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(f"SELECT COUNT(*) as total FROM logistics_equipment WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT id, code, nom, categorie, type_possession, cout_journalier, cout_mensuel, "
            f"statut, localisation_actuelle, project_id_actuel, prochaine_maintenance, "
            f"heures_utilisation, notes, created_at "
            f"FROM logistics_equipment WHERE {w} "
            f"ORDER BY nom ASC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_equipment error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/logistics/equipment/{equipment_id}")
async def get_equipment(equipment_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single equipment item."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT)
        cursor.execute(
            "SELECT * FROM logistics_equipment WHERE id = %s",
            (equipment_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Equipement introuvable")
        return _serialize_row(row)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_equipment error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/logistics/equipment")
async def create_equipment(body: EquipmentCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new equipment item."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT)
        code = _gen_numero("EQP")
        cursor.execute(
            "INSERT INTO logistics_equipment (code, nom, categorie, type_possession, "
            "cout_journalier, cout_mensuel, statut, localisation_actuelle, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, code",
            (code, body.nom, body.categorie, body.type_possession,
             body.cout_journalier, body.cout_mensuel, body.statut,
             body.localisation_actuelle, body.notes),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "code": row["code"], "message": "Équipement créé"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_equipment error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/logistics/equipment/{equipment_id}")
async def update_equipment(equipment_id: int, body: EquipmentUpdate, user: ErpUser = Depends(get_current_user)):
    """Update an existing equipment item."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        sets = ["updated_at = NOW()"]
        params: list = []
        if body.nom is not None:
            sets.append("nom = %s")
            params.append(body.nom)
        if body.categorie is not None:
            sets.append("categorie = %s")
            params.append(body.categorie)
        if body.statut is not None:
            sets.append("statut = %s")
            params.append(body.statut)
        if body.localisation_actuelle is not None:
            sets.append("localisation_actuelle = %s")
            params.append(body.localisation_actuelle)
        if body.notes is not None:
            sets.append("notes = %s")
            params.append(body.notes)
        if len(sets) <= 1:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        params.append(equipment_id)
        cursor.execute(
            f"UPDATE logistics_equipment SET {', '.join(sets)} WHERE id = %s RETURNING id",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Equipement introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Equipement mis à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_equipment error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/logistics/equipment/{equipment_id}")
async def delete_equipment(equipment_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete an equipment item."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM logistics_equipment WHERE id = %s RETURNING id",
            (equipment_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Equipement introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Equipement supprime"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_equipment error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 5. Equipment Reservations ──

@router.get("/logistics/equipment/{equipment_id}/reservations")
async def list_equipment_reservations(equipment_id: int, user: ErpUser = Depends(get_current_user)):
    """List reservations for an equipment item."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT)
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT_RESERVATIONS)
        cursor.execute(
            "SELECT id, equipment_id, project_id, date_debut, date_fin, responsable, "
            "statut, notes, created_at "
            "FROM logistics_equipment_reservations WHERE equipment_id = %s "
            "ORDER BY date_debut DESC",
            (equipment_id,),
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_equipment_reservations error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/logistics/equipment/{equipment_id}/reservations")
async def create_equipment_reservation(equipment_id: int, body: ReservationCreate, user: ErpUser = Depends(get_current_user)):
    """Create a reservation for an equipment item."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT)
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT_RESERVATIONS)
        # Verify equipment exists
        cursor.execute("SELECT id FROM logistics_equipment WHERE id = %s", (equipment_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Equipement introuvable")
        cursor.execute(
            "INSERT INTO logistics_equipment_reservations "
            "(equipment_id, project_id, date_debut, date_fin, responsable, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (equipment_id, body.project_id, body.date_debut, body.date_fin,
             body.responsable, body.notes),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Réservation créée"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_equipment_reservation error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 5b. Equipment Maintenance ──

@router.get("/logistics/maintenance/alertes")
async def list_logistics_maintenance_alertes(user: ErpUser = Depends(get_current_user)):
    """List equipment with maintenance or inspection due within 7 days."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT)
        conn.commit()
        cursor.execute(
            "SELECT id, code, nom, prochaine_maintenance, prochaine_inspection "
            "FROM logistics_equipment "
            "WHERE prochaine_maintenance <= CURRENT_DATE + 7 "
            "   OR prochaine_inspection <= CURRENT_DATE + 7 "
            "ORDER BY LEAST(COALESCE(prochaine_maintenance, '9999-12-31'), "
            "COALESCE(prochaine_inspection, '9999-12-31')) ASC"
        )
        rows = cursor.fetchall()
        alertes = []
        for row in rows:
            d = dict(row)
            if d.get("prochaine_maintenance") and str(d["prochaine_maintenance"]) <= str(
                __import__("datetime").date.today() + __import__("datetime").timedelta(days=7)
            ):
                urgence = "haute" if str(d["prochaine_maintenance"]) <= str(
                    __import__("datetime").date.today() + __import__("datetime").timedelta(days=2)
                ) else "normale"
                alertes.append({
                    "id": d["id"], "code": d.get("code"), "nom": d.get("nom"),
                    "type": "maintenance",
                    "date_echeance": str(d["prochaine_maintenance"]),
                    "urgence": urgence,
                })
            if d.get("prochaine_inspection") and str(d["prochaine_inspection"]) <= str(
                __import__("datetime").date.today() + __import__("datetime").timedelta(days=7)
            ):
                urgence = "haute" if str(d["prochaine_inspection"]) <= str(
                    __import__("datetime").date.today() + __import__("datetime").timedelta(days=2)
                ) else "normale"
                alertes.append({
                    "id": d["id"], "code": d.get("code"), "nom": d.get("nom"),
                    "type": "inspection",
                    "date_echeance": str(d["prochaine_inspection"]),
                    "urgence": urgence,
                })
        return {"items": alertes}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_logistics_maintenance_alertes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/logistics/equipment/{equipment_id}/maintenance")
async def list_equipment_maintenance(equipment_id: int, user: ErpUser = Depends(get_current_user)):
    """List maintenance history for an equipment item."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT)
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT_MAINTENANCE)
        conn.commit()
        cursor.execute(
            "SELECT * FROM logistics_equipment_maintenance "
            "WHERE equipment_id = %s ORDER BY date_intervention DESC",
            (equipment_id,),
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_equipment_maintenance error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/logistics/equipment/{equipment_id}/maintenance")
async def create_equipment_maintenance(
    equipment_id: int, body: EquipmentMaintenanceCreate, user: ErpUser = Depends(get_current_user)
):
    """Create a maintenance record for an equipment item."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT)
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT_MAINTENANCE)
        conn.commit()
        # Verify equipment exists
        cursor.execute("SELECT id FROM logistics_equipment WHERE id = %s", (equipment_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Equipement introuvable")
        cursor.execute(
            "INSERT INTO logistics_equipment_maintenance "
            "(equipment_id, type_intervention, date_intervention, description, "
            "cout, technicien, prochaine_date, conforme, documents) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (equipment_id, body.type_intervention, body.date_intervention,
             body.description, body.cout, body.technicien,
             body.prochaine_date, body.conforme, body.documents),
        )
        row = cursor.fetchone()
        # Update next maintenance date on equipment if provided
        if body.prochaine_date:
            cursor.execute(
                "UPDATE logistics_equipment SET prochaine_maintenance = %s WHERE id = %s",
                (body.prochaine_date, equipment_id),
            )
        conn.commit()
        return {"id": row["id"], "message": "Maintenance enregistrée"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("create_equipment_maintenance error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/logistics/maintenance/{maintenance_id}")
async def update_maintenance(
    maintenance_id: int, body: EquipmentMaintenanceUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update a maintenance record."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT_MAINTENANCE)
        conn.commit()
        sets = []
        params: list = []
        if body.type_intervention is not None:
            sets.append("type_intervention = %s")
            params.append(body.type_intervention)
        if body.description is not None:
            sets.append("description = %s")
            params.append(body.description)
        if body.cout is not None:
            sets.append("cout = %s")
            params.append(body.cout)
        if body.technicien is not None:
            sets.append("technicien = %s")
            params.append(body.technicien)
        if body.prochaine_date is not None:
            sets.append("prochaine_date = %s")
            params.append(body.prochaine_date)
        if body.conforme is not None:
            sets.append("conforme = %s")
            params.append(body.conforme)
        if body.documents is not None:
            sets.append("documents = %s")
            params.append(body.documents)
        if not sets:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        params.append(maintenance_id)
        cursor.execute(
            f"UPDATE logistics_equipment_maintenance SET {', '.join(sets)} WHERE id = %s RETURNING id",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Maintenance introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Maintenance mise à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("update_maintenance error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/logistics/maintenance/{maintenance_id}")
async def delete_maintenance(maintenance_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a maintenance record."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT_MAINTENANCE)
        conn.commit()
        cursor.execute(
            "DELETE FROM logistics_equipment_maintenance WHERE id = %s RETURNING id",
            (maintenance_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Maintenance introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Maintenance supprimée"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("delete_maintenance error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 6. Vehicle CRUD ──

@router.post("/logistics/vehicles")
async def create_vehicle(body: VehicleCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new vehicle."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_VEHICLES)
        cursor.execute(
            "INSERT INTO logistics_vehicles (immatriculation, marque, modele, annee, "
            "type_vehicule, capacite_charge, unite_capacite, kilometrage, "
            "consommation_moyenne, cout_km, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, immatriculation",
            (body.immatriculation, body.marque, body.modele, body.annee,
             body.type_vehicule, body.capacite_charge, body.unite_capacite,
             body.kilometrage, body.consommation_moyenne, body.cout_km, body.notes),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "immatriculation": row["immatriculation"], "message": "Véhicule créé"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_vehicle error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/logistics/vehicles/{vehicle_id}")
async def update_vehicle(vehicle_id: int, body: VehicleUpdate, user: ErpUser = Depends(get_current_user)):
    """Update an existing vehicle."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        sets = ["updated_at = NOW()"]
        params: list = []
        if body.statut is not None:
            sets.append("statut = %s")
            params.append(body.statut)
        if body.kilometrage is not None:
            sets.append("kilometrage = %s")
            params.append(body.kilometrage)
        if body.notes is not None:
            sets.append("notes = %s")
            params.append(body.notes)
        if len(sets) <= 1:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        params.append(vehicle_id)
        cursor.execute(
            f"UPDATE logistics_vehicles SET {', '.join(sets)} WHERE id = %s RETURNING id",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Vehicule introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Vehicule mis à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_vehicle error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/logistics/vehicles/{vehicle_id}")
async def delete_vehicle(vehicle_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a vehicle."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM logistics_vehicles WHERE id = %s RETURNING id",
            (vehicle_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Vehicule introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Vehicule supprime"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_vehicle error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 7. Vehicle Trips ──

@router.get("/logistics/vehicles/{vehicle_id}/trips")
async def list_vehicle_trips(vehicle_id: int, user: ErpUser = Depends(get_current_user)):
    """List trips for a vehicle."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_VEHICLES)
        _ensure_table(cursor, _DDL_LOGISTICS_VEHICLE_TRIPS)
        cursor.execute(
            "SELECT id, vehicle_id, project_id, conducteur_id, date_depart, date_retour, "
            "km_depart, km_retour, destination, motif, carburant_litres, cout_carburant, "
            "notes, created_at "
            "FROM logistics_vehicle_trips WHERE vehicle_id = %s "
            "ORDER BY date_depart DESC",
            (vehicle_id,),
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_vehicle_trips error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/logistics/vehicles/{vehicle_id}/trips")
async def create_vehicle_trip(vehicle_id: int, body: TripCreate, user: ErpUser = Depends(get_current_user)):
    """Create a trip record for a vehicle."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_VEHICLES)
        _ensure_table(cursor, _DDL_LOGISTICS_VEHICLE_TRIPS)
        # Verify vehicle exists
        cursor.execute("SELECT id FROM logistics_vehicles WHERE id = %s", (vehicle_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Vehicule introuvable")
        cursor.execute(
            "INSERT INTO logistics_vehicle_trips "
            "(vehicle_id, project_id, date_depart, destination, motif, km_depart) "
            "VALUES (%s, %s, NOW(), %s, %s, %s) RETURNING id",
            (vehicle_id, body.project_id, body.destination, body.motif, body.km_depart),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Déplacement créé"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_vehicle_trip error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 8. Coordination CRUD ──

@router.get("/logistics/coordination")
async def list_coordination(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    project_id: Optional[int] = None,
    statut: Optional[str] = None,
):
    """List site coordination entries with pagination and filters."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_SITE_COORDINATION)
        _ensure_columns(cursor, "logistics_site_coordination", [
            ("reference", "VARCHAR(50)"),
            ("responsable", "VARCHAR(255)"),
        ])
        wheres = []
        params: list = []
        if project_id is not None:
            wheres.append("project_id = %s")
            params.append(project_id)
        if statut:
            wheres.append("statut = %s")
            params.append(statut)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(f"SELECT COUNT(*) as total FROM logistics_site_coordination WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT id, reference, project_id, date_coordination, type_activite, "
            f"heure_debut, heure_fin, zone_concernee, statut, responsable, notes, created_at "
            f"FROM logistics_site_coordination WHERE {w} "
            f"ORDER BY date_coordination DESC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_coordination error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/logistics/coordination")
async def create_coordination(body: CoordinationCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new site coordination entry."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_SITE_COORDINATION)
        _ensure_columns(cursor, "logistics_site_coordination", [
            ("reference", "VARCHAR(50)"),
            ("responsable", "VARCHAR(255)"),
        ])
        # Defensif: retirer NOT NULL de project_id pour tenants existants (bug prod 2026-04-12)
        try:
            cursor.execute("ALTER TABLE logistics_site_coordination ALTER COLUMN project_id DROP NOT NULL")
        except Exception as exc:
            logger.warning("ALTER project_id DROP NOT NULL failed: %s", exc)
        reference = _gen_numero("COORD")
        cursor.execute(
            "INSERT INTO logistics_site_coordination "
            "(reference, project_id, date_coordination, type_activite, "
            "heure_debut, heure_fin, zone_concernee, responsable, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, reference",
            (reference, body.project_id, body.date_coordination, body.type_activite,
             body.heure_debut, body.heure_fin, body.zone_concernee,
             body.responsable, body.notes),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "reference": row["reference"], "message": "Coordination créée"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_coordination error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/logistics/coordination/{coordination_id}")
async def update_coordination(coordination_id: int, body: CoordinationUpdate, user: ErpUser = Depends(get_current_user)):
    """Update a site coordination entry."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        sets = []
        params: list = []
        if body.statut is not None:
            sets.append("statut = %s")
            params.append(body.statut)
        if body.notes is not None:
            sets.append("notes = %s")
            params.append(body.notes)
        if not sets:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        params.append(coordination_id)
        cursor.execute(
            f"UPDATE logistics_site_coordination SET {', '.join(sets)} WHERE id = %s RETURNING id",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Coordination introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Coordination mise à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_coordination error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/logistics/coordination/{coordination_id}")
async def delete_coordination(coordination_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a site coordination entry."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM logistics_site_coordination WHERE id = %s RETURNING id",
            (coordination_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Coordination introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Coordination supprimée"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_coordination error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 9. Logistics Alerts ──

@router.get("/logistics/alerts")
async def list_alerts(
    user: ErpUser = Depends(get_current_user),
    statut: Optional[str] = Query("active"),
    priorite: Optional[str] = None,
):
    """List logistics alerts with optional filters."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_ALERTS)
        conn.commit()
        wheres = []
        params: list = []
        if statut:
            wheres.append("statut = %s")
            params.append(statut)
        if priorite:
            wheres.append("priorite = %s")
            params.append(priorite)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(
            f"SELECT * FROM logistics_alerts WHERE {w} "
            f"ORDER BY date_alerte DESC LIMIT 50",
            params,
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_alerts error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/logistics/alerts/{alert_id}")
async def update_alert(alert_id: int, body: AlerteUpdate, user: ErpUser = Depends(get_current_user)):
    """Update an alert (e.g. mark as treated)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_ALERTS)
        conn.commit()
        sets = []
        params: list = []
        if body.statut is not None:
            sets.append("statut = %s")
            params.append(body.statut)
            if body.statut == "traitee":
                sets.append("date_traitement = CURRENT_TIMESTAMP")
        if body.traite_par is not None:
            sets.append("traite_par = %s")
            params.append(body.traite_par)
        if not sets:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        params.append(alert_id)
        cursor.execute(
            f"UPDATE logistics_alerts SET {', '.join(sets)} WHERE id = %s RETURNING id",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Alerte introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Alerte mise à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("update_alert error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/logistics/alerts/generate")
async def generate_alerts(user: ErpUser = Depends(get_current_user)):
    """Auto-generate alerts for upcoming maintenance, inspections and insurance expirations."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT)
        _ensure_table(cursor, _DDL_LOGISTICS_VEHICLES)
        _ensure_table(cursor, _DDL_LOGISTICS_ALERTS)
        conn.commit()
        generated = 0

        # 1. Equipment maintenance due within 7 days
        cursor.execute(
            "SELECT id, nom, prochaine_maintenance FROM logistics_equipment "
            "WHERE prochaine_maintenance IS NOT NULL "
            "AND prochaine_maintenance <= CURRENT_DATE + 7"
        )
        for row in cursor.fetchall():
            cursor.execute(
                "SELECT id FROM logistics_alerts "
                "WHERE reference_type = 'equipment' AND reference_id = %s "
                "AND type_alerte = 'maintenance_prevue' AND statut = 'active'",
                (row["id"],),
            )
            if not cursor.fetchone():
                cursor.execute(
                    "INSERT INTO logistics_alerts "
                    "(type_alerte, reference_type, reference_id, message, priorite, date_echeance) "
                    "VALUES ('maintenance_prevue', 'equipment', %s, %s, %s, %s)",
                    (row["id"],
                     "Maintenance prévue pour " + (row.get("nom") or "équipement"),
                     "haute" if str(row["prochaine_maintenance"]) <= str(
                         __import__("datetime").date.today() + __import__("datetime").timedelta(days=2)
                     ) else "normale",
                     row["prochaine_maintenance"]),
                )
                generated += 1

        # 2. Equipment inspection due within 7 days
        cursor.execute(
            "SELECT id, nom, prochaine_inspection FROM logistics_equipment "
            "WHERE prochaine_inspection IS NOT NULL "
            "AND prochaine_inspection <= CURRENT_DATE + 7"
        )
        for row in cursor.fetchall():
            cursor.execute(
                "SELECT id FROM logistics_alerts "
                "WHERE reference_type = 'equipment' AND reference_id = %s "
                "AND type_alerte = 'inspection_requise' AND statut = 'active'",
                (row["id"],),
            )
            if not cursor.fetchone():
                cursor.execute(
                    "INSERT INTO logistics_alerts "
                    "(type_alerte, reference_type, reference_id, message, priorite, date_echeance) "
                    "VALUES ('inspection_requise', 'equipment', %s, %s, %s, %s)",
                    (row["id"],
                     "Inspection requise pour " + (row.get("nom") or "équipement"),
                     "haute" if str(row["prochaine_inspection"]) <= str(
                         __import__("datetime").date.today() + __import__("datetime").timedelta(days=2)
                     ) else "normale",
                     row["prochaine_inspection"]),
                )
                generated += 1

        # 3. Vehicle insurance expiring within 30 days
        cursor.execute(
            "SELECT id, immatriculation, assurance_expiration FROM logistics_vehicles "
            "WHERE assurance_expiration IS NOT NULL "
            "AND assurance_expiration <= CURRENT_DATE + 30"
        )
        for row in cursor.fetchall():
            cursor.execute(
                "SELECT id FROM logistics_alerts "
                "WHERE reference_type = 'vehicle' AND reference_id = %s "
                "AND type_alerte = 'assurance_expiration' AND statut = 'active'",
                (row["id"],),
            )
            if not cursor.fetchone():
                cursor.execute(
                    "INSERT INTO logistics_alerts "
                    "(type_alerte, reference_type, reference_id, message, priorite, date_echeance) "
                    "VALUES ('assurance_expiration', 'vehicle', %s, %s, %s, %s)",
                    (row["id"],
                     "Assurance expirant pour véhicule " + (row.get("immatriculation") or "inconnu"),
                     "haute" if str(row["assurance_expiration"]) <= str(
                         __import__("datetime").date.today() + __import__("datetime").timedelta(days=7)
                     ) else "normale",
                     row["assurance_expiration"]),
                )
                generated += 1

        conn.commit()
        return {"generated": generated, "message": f"{generated} alerte(s) générée(s)"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("generate_alerts error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# LOGISTICS AI ENDPOINTS
# ============================================


@router.post("/logistics/ia/analyser")
async def ia_logistique_analyser(user: ErpUser = Depends(get_current_user)):
    """AI-powered logistics analysis. Fetches all logistics data and returns structured analysis."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")

    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    client = _get_logistique_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Service IA non configure")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_DELIVERIES)
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT)
        _ensure_table(cursor, _DDL_LOGISTICS_VEHICLES)
        _ensure_table(cursor, _DDL_LOGISTICS_ALERTS)
        conn.commit()

        # --- Fetch statistics ---
        def _table_exists(tname):
            cursor.execute(
                "SELECT EXISTS (SELECT FROM information_schema.tables "
                "WHERE table_schema = %s AND table_name = %s)",
                (user.schema, tname),
            )
            return cursor.fetchone().get("exists", False)

        livraisons_stats = {"total": 0, "planifiees": 0, "en_cours": 0, "cette_semaine": 0}
        if _table_exists("logistics_deliveries"):
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_deliveries")
            livraisons_stats["total"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_deliveries WHERE statut = 'planifiee'")
            livraisons_stats["planifiees"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_deliveries WHERE statut = 'en_cours'")
            livraisons_stats["en_cours"] = cursor.fetchone()["cnt"]
            cursor.execute(
                "SELECT COUNT(*) as cnt FROM logistics_deliveries "
                "WHERE date_prevue >= date_trunc('week', CURRENT_DATE) "
                "AND date_prevue < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days'"
            )
            livraisons_stats["cette_semaine"] = cursor.fetchone()["cnt"]

        equipements_stats = {"total": 0, "disponibles": 0, "en_utilisation": 0, "en_maintenance": 0}
        if _table_exists("logistics_equipment"):
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_equipment")
            equipements_stats["total"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_equipment WHERE statut = 'disponible'")
            equipements_stats["disponibles"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_equipment WHERE statut = 'en_utilisation'")
            equipements_stats["en_utilisation"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_equipment WHERE statut = 'en_maintenance'")
            equipements_stats["en_maintenance"] = cursor.fetchone()["cnt"]

        vehicules_stats = {"total": 0, "disponibles": 0, "en_deplacement": 0, "km_total": 0}
        if _table_exists("logistics_vehicles"):
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_vehicles")
            vehicules_stats["total"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_vehicles WHERE statut = 'disponible'")
            vehicules_stats["disponibles"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_vehicles WHERE statut = 'en_deplacement'")
            vehicules_stats["en_deplacement"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COALESCE(SUM(kilometrage), 0) as km FROM logistics_vehicles")
            vehicules_stats["km_total"] = float(cursor.fetchone()["km"])

        alertes_actives = 0
        if _table_exists("logistics_alerts"):
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_alerts WHERE statut = 'active'")
            alertes_actives = cursor.fetchone()["cnt"]

        # --- Fetch detailed data ---
        cursor.execute("SELECT * FROM logistics_deliveries ORDER BY created_at DESC LIMIT 20")
        deliveries_raw = [_serialize_row(dict(r)) for r in cursor.fetchall()]

        cursor.execute("SELECT * FROM logistics_equipment")
        equipment_raw = [_serialize_row(dict(r)) for r in cursor.fetchall()]

        cursor.execute("SELECT * FROM logistics_vehicles")
        vehicles_raw = [_serialize_row(dict(r)) for r in cursor.fetchall()]

        prompt_data = json.dumps({
            "statistiques": {
                "livraisons": livraisons_stats,
                "equipements": equipements_stats,
                "vehicules": vehicules_stats,
                "alertes_actives": alertes_actives,
            },
            "dernieres_livraisons": deliveries_raw,
            "equipements": equipment_raw,
            "vehicules": vehicles_raw,
        }, ensure_ascii=False, default=str)

        user_message = (
            "Analyse ces donnees logistiques et retourne une analyse structuree en JSON "
            "avec les sections: score_logistique (0-100), resume, points_forts (liste), "
            "points_amelioration (liste), analyse_livraisons, analyse_equipements, "
            "analyse_vehicules, recommandations_prioritaires (liste).\n\n"
            f"Donnees logistiques:\n{prompt_data}"
        )

        model_name = "claude-opus-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=LOGISTIQUE_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Cost: Opus pricing with 30% markup
        cost = (input_tokens * 0.015 + output_tokens * 0.075) / 1000 * 1.30

        if track_ai_usage:
            try:
                track_ai_usage(user, "logistique_analyser", input_tokens, output_tokens,
                               cost, 0, True, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass

        # Try to parse as JSON
        analysis = response_text
        try:
            analysis = json.loads(response_text)
        except (json.JSONDecodeError, TypeError):
            pass

        return {
            "analysis": analysis,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Logistics AI analyser API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Logistics IA analyser error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de l'analyse")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/logistics/ia/chat")
async def ia_logistique_chat(body: LogistiqueIaChatRequest, user: ErpUser = Depends(get_current_user)):
    """AI chat for logistics questions. Uses Claude Sonnet."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")

    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    client = _get_logistique_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Service IA non configure")

    try:
        user_content = body.question
        if body.context:
            user_content = f"Contexte additionnel:\n{body.context}\n\nQuestion:\n{body.question}"

        model_name = "claude-sonnet-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=LOGISTIQUE_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Cost: Sonnet pricing with 30% markup
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30

        if track_ai_usage:
            try:
                track_ai_usage(user, "logistique_chat", input_tokens, output_tokens,
                               cost, 0, True, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass

        return {
            "response": response_text,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Logistics AI chat API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Logistics IA chat error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chat IA logistique")


@router.post("/logistics/ia/rapport")
async def ia_logistique_rapport(user: ErpUser = Depends(get_current_user)):
    """Generate a logistics optimization report using AI."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")

    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    client = _get_logistique_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Service IA non configure")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOGISTICS_DELIVERIES)
        _ensure_table(cursor, _DDL_LOGISTICS_EQUIPMENT)
        _ensure_table(cursor, _DDL_LOGISTICS_VEHICLES)
        _ensure_table(cursor, _DDL_LOGISTICS_ALERTS)
        conn.commit()

        # --- Fetch statistics ---
        def _table_exists(tname):
            cursor.execute(
                "SELECT EXISTS (SELECT FROM information_schema.tables "
                "WHERE table_schema = %s AND table_name = %s)",
                (user.schema, tname),
            )
            return cursor.fetchone().get("exists", False)

        livraisons_stats = {"total": 0, "planifiees": 0, "en_cours": 0, "cette_semaine": 0}
        if _table_exists("logistics_deliveries"):
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_deliveries")
            livraisons_stats["total"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_deliveries WHERE statut = 'planifiee'")
            livraisons_stats["planifiees"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_deliveries WHERE statut = 'en_cours'")
            livraisons_stats["en_cours"] = cursor.fetchone()["cnt"]

        equipements_stats = {"total": 0, "disponibles": 0, "en_utilisation": 0, "en_maintenance": 0}
        if _table_exists("logistics_equipment"):
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_equipment")
            equipements_stats["total"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_equipment WHERE statut = 'disponible'")
            equipements_stats["disponibles"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_equipment WHERE statut = 'en_utilisation'")
            equipements_stats["en_utilisation"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_equipment WHERE statut = 'en_maintenance'")
            equipements_stats["en_maintenance"] = cursor.fetchone()["cnt"]

        vehicules_stats = {"total": 0, "disponibles": 0, "en_deplacement": 0, "km_total": 0}
        if _table_exists("logistics_vehicles"):
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_vehicles")
            vehicules_stats["total"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_vehicles WHERE statut = 'disponible'")
            vehicules_stats["disponibles"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_vehicles WHERE statut = 'en_deplacement'")
            vehicules_stats["en_deplacement"] = cursor.fetchone()["cnt"]
            cursor.execute("SELECT COALESCE(SUM(kilometrage), 0) as km FROM logistics_vehicles")
            vehicules_stats["km_total"] = float(cursor.fetchone()["km"])

        alertes_actives = 0
        if _table_exists("logistics_alerts"):
            cursor.execute("SELECT COUNT(*) as cnt FROM logistics_alerts WHERE statut = 'active'")
            alertes_actives = cursor.fetchone()["cnt"]

        # --- Fetch detailed data (last 50 deliveries for rapport) ---
        cursor.execute("SELECT * FROM logistics_deliveries ORDER BY created_at DESC LIMIT 50")
        deliveries_raw = [_serialize_row(dict(r)) for r in cursor.fetchall()]

        cursor.execute("SELECT * FROM logistics_equipment")
        equipment_raw = [_serialize_row(dict(r)) for r in cursor.fetchall()]

        cursor.execute("SELECT * FROM logistics_vehicles")
        vehicles_raw = [_serialize_row(dict(r)) for r in cursor.fetchall()]

        prompt_data = json.dumps({
            "statistiques": {
                "livraisons": livraisons_stats,
                "equipements": equipements_stats,
                "vehicules": vehicules_stats,
                "alertes_actives": alertes_actives,
            },
            "dernieres_livraisons": deliveries_raw,
            "equipements": equipment_raw,
            "vehicules": vehicles_raw,
        }, ensure_ascii=False, default=str)

        user_message = (
            "Genere un rapport d'optimisation logistique complet en format Markdown "
            "avec les sections:\n"
            "1. Resume executif\n"
            "2. Analyse des livraisons\n"
            "3. Analyse des equipements\n"
            "4. Analyse de la flotte\n"
            "5. Plan d'action\n"
            "6. Gains potentiels\n"
            "7. KPIs recommandes\n"
            "8. Conclusion\n\n"
            f"Donnees logistiques:\n{prompt_data}"
        )

        model_name = "claude-sonnet-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=LOGISTIQUE_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Cost: Sonnet pricing with 30% markup
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30

        if track_ai_usage:
            try:
                track_ai_usage(user, "logistique_rapport", input_tokens, output_tokens,
                               cost, 0, True, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass

        return {
            "rapport": response_text,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Logistics AI rapport API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Logistics IA rapport error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la generation du rapport")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/logistics/ia/optimiser")
async def ia_logistique_optimiser(body: LogistiqueIaOptimisationRequest, user: ErpUser = Depends(get_current_user)):
    """AI-powered logistics optimization. Returns structured JSON recommendation."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")

    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    client = _get_logistique_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Service IA non configure")

    try:
        prompt_data = json.dumps({
            "besoin": body.besoin,
            "nombre_vehicules": body.nombre_vehicules,
            "nombre_equipements": body.nombre_equipements,
            "nombre_livraisons_semaine": body.nombre_livraisons_semaine,
        }, ensure_ascii=False)

        user_message = (
            "Optimise cette operation logistique et retourne une recommandation "
            "structuree en JSON avec les sections:\n"
            "- titre_solution (string)\n"
            "- description (string)\n"
            "- etapes (liste d'etapes concretes)\n"
            "- ressources_necessaires (liste)\n"
            "- benefices_attendus (liste)\n"
            "- risques (liste)\n"
            "- indicateurs_succes (liste)\n"
            "- alternatives (liste de solutions alternatives)\n\n"
            f"Donnees du besoin:\n{prompt_data}"
        )

        model_name = "claude-sonnet-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=LOGISTIQUE_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Cost: Sonnet pricing with 30% markup
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30

        if track_ai_usage:
            try:
                track_ai_usage(user, "logistique_optimiser", input_tokens, output_tokens,
                               cost, 0, True, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass

        # Try to parse as JSON
        recommendation = response_text
        try:
            recommendation = json.loads(response_text)
        except (json.JSONDecodeError, TypeError):
            pass

        return {
            "recommendation": recommendation,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Logistics AI optimiser API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Logistics IA optimiser error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'optimisation")


# ============================================
# EQUIPMENT RENTAL (Location)
# ============================================


def _recalculate_contrat_totaux(cursor, contrat_id):
    """Recalculate contract totals from line items."""
    cursor.execute(
        "SELECT COALESCE(SUM(montant_ligne), 0) as ht "
        "FROM location_contrat_lignes WHERE contrat_id = %s", (contrat_id,))
    ht = float(cursor.fetchone()["ht"])
    tps = round(ht * 0.05, 2)
    tvq = round(ht * 0.09975, 2)
    total = round(ht + tps + tvq, 2)
    cursor.execute(
        "UPDATE location_contrats SET montant_ht=%s, montant_tps=%s, montant_tvq=%s, "
        "montant_total=%s, updated_at=NOW() WHERE id=%s",
        (ht, tps, tvq, total, contrat_id))


# ── 1. GET /rental/items ──

@router.get("/rental/items")
async def list_rental_items(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    categorie: Optional[str] = None,
    etat: Optional[str] = None,
    disponible: Optional[bool] = None,
):
    """List rental items with pagination and filters."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_ITEMS)
        conn.commit()
        wheres = ["actif = TRUE"]
        params = []
        if categorie:
            wheres.append("categorie = %s")
            params.append(categorie)
        if etat:
            wheres.append("etat = %s")
            params.append(etat)
        if disponible is not None:
            wheres.append("disponible = %s")
            params.append(disponible)
        w = " AND ".join(wheres)
        cursor.execute(f"SELECT COUNT(*) as cnt FROM location_items WHERE {w}", params)
        total = cursor.fetchone()["cnt"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT * FROM location_items WHERE {w} ORDER BY nom ASC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = [_serialize_row(dict(r)) for r in cursor.fetchall()]
        return {"items": items, "total": total}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_rental_items error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 2. POST /rental/items ──

@router.post("/rental/items")
async def create_rental_item(body: RentalItemCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new rental item."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_ITEMS)
        conn.commit()
        cursor.execute(
            "INSERT INTO location_items "
            "(nom, description, categorie, numero_serie, marque, modele, annee_fabrication, "
            "etat, disponible, quantite_totale, quantite_disponible, valeur_achat, valeur_remplacement, "
            "tarif_journalier, tarif_hebdomadaire, tarif_mensuel, caution_requise, assurance_requise, "
            "conditions_location, notes, actif) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,TRUE,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,TRUE) RETURNING id",
            (body.nom, body.description, body.categorie, body.numero_serie,
             body.marque, body.modele, body.annee_fabrication,
             body.etat, body.quantite_totale, body.quantite_totale,
             body.valeur_achat, body.valeur_remplacement,
             body.tarif_journalier, body.tarif_hebdomadaire, body.tarif_mensuel,
             body.caution_requise, body.assurance_requise,
             body.conditions_location, body.notes),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Equipement de location cree"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("create_rental_item error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 3. PUT /rental/items/{item_id} ──

_ALLOWED_ITEM_COLS = {
    "nom", "description", "categorie", "numero_serie", "etat", "disponible",
    "tarif_journalier", "tarif_hebdomadaire", "tarif_mensuel", "notes",
    "marque", "modele", "annee_fabrication", "quantite_totale",
    "valeur_achat", "valeur_remplacement", "caution_requise",
    "assurance_requise", "conditions_location",
}

@router.put("/rental/items/{item_id}")
async def update_rental_item(item_id: int, body: RentalItemUpdate, user: ErpUser = Depends(get_current_user)):
    """Update a rental item."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_ITEMS)
        conn.commit()
        data = body.model_dump(exclude_unset=True)
        if not data:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        sets = []
        params = []
        for col, val in data.items():
            if col in _ALLOWED_ITEM_COLS:
                sets.append(f"{col} = %s")
                params.append(val)
        sets.append("updated_at = NOW()")
        params.append(item_id)
        cursor.execute(
            f"UPDATE location_items SET {', '.join(sets)} WHERE id = %s AND actif = TRUE RETURNING id",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Equipement introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Equipement mis a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("update_rental_item error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 4. DELETE /rental/items/{item_id} ──

@router.delete("/rental/items/{item_id}")
async def delete_rental_item(item_id: int, user: ErpUser = Depends(get_current_user)):
    """Soft-delete a rental item. Blocks if linked to an active contract."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_ITEMS)
        _ensure_table(cursor, _DDL_LOCATION_CONTRAT_LIGNES)
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS)
        conn.commit()
        # Validate that item is not in an active contract (BROUILLON, EN_COURS, ACTIF, RESERVE)
        cursor.execute(
            "SELECT COUNT(*) AS c FROM location_contrat_lignes l "
            "JOIN location_contrats c ON c.id = l.contrat_id "
            "WHERE l.location_item_id = %s "
            "AND COALESCE(c.statut, 'BROUILLON') IN ('BROUILLON', 'EN_COURS', 'ACTIF', 'RESERVE')",
            (item_id,),
        )
        active_count = cursor.fetchone()["c"]
        if active_count and active_count > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Impossible de supprimer: equipement utilise dans {active_count} contrat(s) actif(s)",
            )
        cursor.execute(
            "UPDATE location_items SET actif = FALSE, disponible = FALSE, updated_at = NOW() "
            "WHERE id = %s RETURNING id", (item_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Equipement introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Equipement desactive"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("delete_rental_item error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 5. GET /rental/contracts ──

@router.get("/rental/contracts")
async def list_rental_contracts(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    statut: Optional[str] = None,
):
    """List rental contracts with pagination."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS)
        conn.commit()
        wheres = []
        params = []
        if statut:
            wheres.append("statut = %s")
            params.append(statut)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(f"SELECT COUNT(*) as cnt FROM location_contrats WHERE {w}", params)
        total = cursor.fetchone()["cnt"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT * FROM location_contrats WHERE {w} ORDER BY created_at DESC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = [_serialize_row(dict(r)) for r in cursor.fetchall()]
        return {"items": items, "total": total}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_rental_contracts error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 6. POST /rental/contracts ──

@router.post("/rental/contracts")
async def create_rental_contract(body: RentalContractCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new rental contract."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS)
        # Force atomicity: disable autocommit so INSERT + UPDATE happen in one transaction (lecon #131)
        # Without this, a crash between INSERT and UPDATE leaves a row with numero_contrat = NULL.
        conn.autocommit = False
        # Race-safe numero: INSERT with NULL, RETURNING id, UPDATE with final value (lecon #123)
        cursor.execute(
            "INSERT INTO location_contrats "
            "(numero_contrat, client_type, client_company_id, client_contact_id, client_nom_cache, "
            "project_id, date_debut, date_fin_prevue, duree_type, duree_nombre, "
            "conditions_particulieres, lieu_livraison, lieu_retour, caution_montant, notes) "
            "VALUES (NULL,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (body.client_type, body.client_company_id, body.client_contact_id,
             body.client_nom_cache, body.project_id, body.date_debut, body.date_fin_prevue,
             body.duree_type, body.duree_nombre, body.conditions_particulieres,
             body.lieu_livraison, body.lieu_retour, body.caution_montant, body.notes),
        )
        contrat_id = cursor.fetchone()["id"]
        numero = f"LOC-{contrat_id:05d}"
        cursor.execute(
            "UPDATE location_contrats SET numero_contrat = %s WHERE id = %s",
            (numero, contrat_id),
        )
        conn.commit()
        return {"id": contrat_id, "numero_contrat": numero, "message": "Contrat cree"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("create_rental_contract error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            conn.autocommit = True
        except Exception:
            pass
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 7. GET /rental/contracts/{contract_id} ──

@router.get("/rental/contracts/{contract_id}")
async def get_rental_contract(contract_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a rental contract with its line items."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS)
        _ensure_table(cursor, _DDL_LOCATION_CONTRAT_LIGNES)
        _ensure_table(cursor, _DDL_LOCATION_ITEMS)
        conn.commit()
        cursor.execute("SELECT * FROM location_contrats WHERE id = %s", (contract_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contrat introuvable")
        contrat = _serialize_row(dict(row))
        cursor.execute(
            "SELECT cl.*, li.nom as item_nom "
            "FROM location_contrat_lignes cl "
            "LEFT JOIN location_items li ON cl.location_item_id = li.id "
            "WHERE cl.contrat_id = %s ORDER BY cl.id", (contract_id,))
        lignes = [_serialize_row(dict(r)) for r in cursor.fetchall()]
        return {"contrat": contrat, "lignes": lignes}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_rental_contract error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 8. PUT /rental/contracts/{contract_id} ──

_ALLOWED_CONTRAT_COLS = {
    "statut", "date_fin_prevue", "date_fin_reelle", "conditions_particulieres",
    "lieu_livraison", "lieu_retour", "caution_montant", "caution_recue", "notes",
    "client_nom_cache", "date_debut", "duree_type", "duree_nombre",
}

@router.put("/rental/contracts/{contract_id}")
async def update_rental_contract(contract_id: int, body: RentalContractUpdate, user: ErpUser = Depends(get_current_user)):
    """Update an existing rental contract."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS)
        conn.commit()
        data = body.model_dump(exclude_unset=True)
        if not data:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        sets = []
        params = []
        for col, val in data.items():
            if col in _ALLOWED_CONTRAT_COLS:
                sets.append(f"{col} = %s")
                params.append(val)
        sets.append("updated_at = NOW()")
        params.append(contract_id)
        cursor.execute(
            f"UPDATE location_contrats SET {', '.join(sets)} WHERE id = %s RETURNING id",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contrat introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Contrat mis a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("update_rental_contract error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 9. DELETE /rental/contracts/{contract_id} ──

@router.delete("/rental/contracts/{contract_id}")
async def delete_rental_contract(contract_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a rental contract (only BROUILLON or ANNULE)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS)
        conn.commit()
        cursor.execute("SELECT statut FROM location_contrats WHERE id = %s", (contract_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contrat introuvable")
        if row["statut"] not in ("BROUILLON", "ANNULE"):
            raise HTTPException(status_code=400, detail="Seuls les contrats BROUILLON ou ANNULE peuvent etre supprimes")
        # Cascade-delete child rows (no FK constraints in DDL)
        _ensure_table(cursor, _DDL_LOCATION_RETOURS)
        _ensure_table(cursor, _DDL_LOCATION_CONTRAT_LIGNES)
        conn.commit()
        cursor.execute("DELETE FROM location_retours WHERE contrat_id = %s", (contract_id,))
        cursor.execute("DELETE FROM location_contrat_lignes WHERE contrat_id = %s", (contract_id,))
        cursor.execute("DELETE FROM location_contrats WHERE id = %s RETURNING id", (contract_id,))
        conn.commit()
        return {"id": contract_id, "message": "Contrat supprime"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("delete_rental_contract error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 10. POST /rental/contracts/{contract_id}/lignes ──

def _compute_ligne_duree(date_sortie: Optional[str], date_retour_prevue: Optional[str],
                         tarif_type: Optional[str], fallback_duree: int = 1) -> int:
    """Calcule le nombre de periodes de location selon dates et tarif_type.
    Retourne au minimum 1. fallback_duree utilise si dates manquantes."""
    import math
    from datetime import date
    if not date_sortie or not date_retour_prevue:
        return max(1, fallback_duree)
    try:
        d_sortie = date.fromisoformat(str(date_sortie)[:10])
        d_retour = date.fromisoformat(str(date_retour_prevue)[:10])
        delta_jours = (d_retour - d_sortie).days
        if delta_jours <= 0:
            return max(1, fallback_duree)
        tt = (tarif_type or "JOUR").upper()
        if tt == "JOUR":
            return max(1, delta_jours)
        if tt == "SEMAINE":
            return max(1, math.ceil(delta_jours / 7))
        if tt == "MOIS":
            return max(1, math.ceil(delta_jours / 30))
        if tt == "HEURE":
            return max(1, fallback_duree)  # heures = quantite manuelle
        return max(1, delta_jours)
    except Exception as exc:
        logger.warning("_compute_ligne_duree error: %s", exc)
        return max(1, fallback_duree)


@router.post("/rental/contracts/{contract_id}/lignes")
async def create_contrat_ligne(contract_id: int, body: RentalContratLigneCreate, user: ErpUser = Depends(get_current_user)):
    """Add a line item to a rental contract."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_CONTRAT_LIGNES)
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS)
        conn.commit()
        # Validate contract exists + fetch duree fallback
        cursor.execute("SELECT id, duree_nombre FROM location_contrats WHERE id = %s", (contract_id,))
        contrat = cursor.fetchone()
        if not contrat:
            raise HTTPException(status_code=404, detail="Contrat introuvable")
        qty = body.quantite if body.quantite is not None else 1
        fallback_duree = int(contrat.get("duree_nombre") or 1)
        duree = _compute_ligne_duree(body.date_sortie, body.date_retour_prevue, body.tarif_type, fallback_duree)
        montant_ligne = round(body.tarif_unitaire * qty * duree * (1 - (body.remise_pourcent or 0) / 100), 2)
        cursor.execute(
            "INSERT INTO location_contrat_lignes "
            "(contrat_id, location_item_id, quantite, tarif_unitaire, tarif_type, remise_pourcent, "
            "montant_ligne, date_sortie, date_retour_prevue, etat_sortie, notes_sortie) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (contract_id, body.location_item_id, qty, body.tarif_unitaire,
             body.tarif_type, body.remise_pourcent, montant_ligne,
             body.date_sortie, body.date_retour_prevue, body.etat_sortie, body.notes_sortie),
        )
        row = cursor.fetchone()
        _recalculate_contrat_totaux(cursor, contract_id)
        conn.commit()
        return {"id": row["id"], "montant_ligne": montant_ligne, "message": "Ligne ajoutee"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("create_contrat_ligne error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 11. PUT /rental/contracts/{contract_id}/lignes/{ligne_id} ──

_ALLOWED_LIGNE_COLS = {
    "quantite", "tarif_unitaire", "tarif_type", "remise_pourcent",
    "date_sortie", "date_retour_prevue", "date_retour_reelle",
    "etat_sortie", "etat_retour", "notes_sortie", "notes_retour",
}

@router.put("/rental/contracts/{contract_id}/lignes/{ligne_id}")
async def update_contrat_ligne(contract_id: int, ligne_id: int, body: RentalContratLigneUpdate, user: ErpUser = Depends(get_current_user)):
    """Update a line item of a rental contract."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_CONTRAT_LIGNES)
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS)
        conn.commit()
        data = body.model_dump(exclude_unset=True)
        sets = []
        params = []
        for col, val in data.items():
            if col in _ALLOWED_LIGNE_COLS:
                sets.append(f"{col} = %s")
                params.append(val)
        if not sets:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        params.append(ligne_id)
        params.append(contract_id)
        cursor.execute(
            f"UPDATE location_contrat_lignes SET {', '.join(sets)} "
            f"WHERE id = %s AND contrat_id = %s RETURNING id, tarif_unitaire, quantite, remise_pourcent, "
            f"tarif_type, date_sortie, date_retour_prevue",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Ligne introuvable")
        # Recalculate montant_ligne if pricing OR duration fields changed
        pricing_changed = any(k in data for k in (
            "tarif_unitaire", "quantite", "remise_pourcent",
            "tarif_type", "date_sortie", "date_retour_prevue",
        ))
        if pricing_changed:
            tu_raw = row["tarif_unitaire"]
            tu = float(tu_raw) if tu_raw is not None else 0.0
            q_raw = row["quantite"]
            q = int(q_raw) if q_raw is not None else 1
            rp_raw = row["remise_pourcent"]
            rp = float(rp_raw) if rp_raw is not None else 0.0
            # Fetch contrat duree_nombre as fallback
            cursor.execute("SELECT duree_nombre FROM location_contrats WHERE id = %s", (contract_id,))
            contrat_row = cursor.fetchone()
            fallback_duree = int(contrat_row.get("duree_nombre") or 1) if contrat_row else 1
            duree = _compute_ligne_duree(
                row.get("date_sortie"), row.get("date_retour_prevue"),
                row.get("tarif_type"), fallback_duree,
            )
            ml = round(tu * q * duree * (1 - rp / 100), 2)
            cursor.execute(
                "UPDATE location_contrat_lignes SET montant_ligne = %s WHERE id = %s",
                (ml, ligne_id))
        _recalculate_contrat_totaux(cursor, contract_id)
        conn.commit()
        return {"id": ligne_id, "message": "Ligne mise a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("update_contrat_ligne error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 12. DELETE /rental/contracts/{contract_id}/lignes/{ligne_id} ──

@router.delete("/rental/contracts/{contract_id}/lignes/{ligne_id}")
async def delete_contrat_ligne(contract_id: int, ligne_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a line item from a rental contract."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_CONTRAT_LIGNES)
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS)
        conn.commit()
        cursor.execute(
            "DELETE FROM location_contrat_lignes WHERE id = %s AND contrat_id = %s RETURNING id",
            (ligne_id, contract_id))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Ligne introuvable")
        _recalculate_contrat_totaux(cursor, contract_id)
        conn.commit()
        return {"id": ligne_id, "message": "Ligne supprimee"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("delete_contrat_ligne error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 13. POST /rental/returns ──

@router.post("/rental/returns")
async def create_rental_return(body: RentalRetourCreate, user: ErpUser = Depends(get_current_user)):
    """Record an equipment return."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_RETOURS)
        _ensure_table(cursor, _DDL_LOCATION_CONTRAT_LIGNES)
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS)
        conn.commit()
        # Validate that the ligne exists and belongs to the contract
        cursor.execute(
            "SELECT id FROM location_contrat_lignes WHERE id = %s AND contrat_id = %s",
            (body.ligne_id, body.contrat_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Ligne introuvable pour ce contrat")
        cursor.execute(
            "INSERT INTO location_retours "
            "(contrat_id, ligne_id, location_item_id, etat_avant, etat_apres, "
            "dommages_constates, frais_reparation, frais_nettoyage, frais_retard, commentaires) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (body.contrat_id, body.ligne_id, body.location_item_id,
             body.etat_avant, body.etat_apres, body.dommages_constates,
             body.frais_reparation, body.frais_nettoyage, body.frais_retard,
             body.commentaires),
        )
        retour_row = cursor.fetchone()
        # Update the contract line with return info
        cursor.execute(
            "UPDATE location_contrat_lignes SET date_retour_reelle = NOW(), etat_retour = %s "
            "WHERE id = %s AND contrat_id = %s",
            (body.etat_apres, body.ligne_id, body.contrat_id))
        # Check if ALL lines of this contract have been returned
        cursor.execute(
            "SELECT COUNT(*) as total FROM location_contrat_lignes WHERE contrat_id = %s",
            (body.contrat_id,))
        total_lignes = cursor.fetchone()["total"]
        cursor.execute(
            "SELECT COUNT(*) as returned FROM location_contrat_lignes "
            "WHERE contrat_id = %s AND date_retour_reelle IS NOT NULL",
            (body.contrat_id,))
        returned_lignes = cursor.fetchone()["returned"]
        if total_lignes > 0 and total_lignes == returned_lignes:
            cursor.execute(
                "UPDATE location_contrats SET statut = 'RETOURNE', date_fin_reelle = NOW(), "
                "updated_at = NOW() WHERE id = %s", (body.contrat_id,))
        conn.commit()
        return {"id": retour_row["id"], "message": "Retour enregistre",
                "contrat_complet": total_lignes > 0 and total_lignes == returned_lignes}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("create_rental_return error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 14. GET /rental/returns ──

@router.get("/rental/returns")
async def list_rental_returns(
    user: ErpUser = Depends(get_current_user),
    contrat_id: Optional[int] = None,
):
    """List equipment returns with optional contract filter."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_RETOURS)
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS)
        _ensure_table(cursor, _DDL_LOCATION_ITEMS)
        conn.commit()
        wheres = []
        params = []
        if contrat_id is not None:
            wheres.append("r.contrat_id = %s")
            params.append(contrat_id)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(
            f"SELECT r.*, c.numero_contrat, li.nom as item_nom "
            f"FROM location_retours r "
            f"LEFT JOIN location_contrats c ON r.contrat_id = c.id "
            f"LEFT JOIN location_items li ON r.location_item_id = li.id "
            f"WHERE {w} ORDER BY r.created_at DESC",
            params,
        )
        items = [_serialize_row(dict(r)) for r in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_rental_returns error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 15. GET /rental/statistics ──

@router.get("/rental/statistics")
async def get_rental_stats(user: ErpUser = Depends(get_current_user)):
    """Return rental statistics."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS)
        conn.commit()
        stats = {"total": 0, "actifs": 0, "par_statut": {}, "montant_ht": 0, "montant_total": 0, "equipements_loues": 0}
        cursor.execute("SELECT COUNT(*) as total FROM location_contrats")
        stats["total"] = cursor.fetchone()["total"]
        cursor.execute(
            "SELECT COUNT(*) as cnt FROM location_contrats "
            "WHERE statut IN ('ACTIF', 'EN_COURS', 'RESERVE')")
        stats["actifs"] = cursor.fetchone()["cnt"]
        cursor.execute(
            "SELECT statut, COUNT(*) as cnt FROM location_contrats GROUP BY statut")
        for row in cursor.fetchall():
            stats["par_statut"][row["statut"]] = row["cnt"]
        cursor.execute(
            "SELECT COALESCE(SUM(montant_ht), 0) as ht, COALESCE(SUM(montant_total), 0) as mt "
            "FROM location_contrats")
        sums = cursor.fetchone()
        stats["montant_ht"] = float(sums["ht"])
        stats["montant_total"] = float(sums["mt"])
        try:
            _ensure_table(cursor, _DDL_LOCATION_CONTRAT_LIGNES)
            conn.commit()
            cursor.execute(
                "SELECT COUNT(DISTINCT location_item_id) as cnt FROM location_contrat_lignes cl "
                "JOIN location_contrats c ON cl.contrat_id = c.id "
                "WHERE c.statut IN ('ACTIF', 'EN_COURS', 'RESERVE')")
            stats["equipements_loues"] = cursor.fetchone()["cnt"]
        except Exception:
            pass
        return stats
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_rental_stats error: %s", exc)
        return {"total": 0, "actifs": 0, "par_statut": {}, "montant_ht": 0, "montant_total": 0,
                "equipements_loues": 0, "error": "Erreur interne"}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 16. GET /rental/employees ──

@router.get("/rental/employees")
async def list_rental_employees(
    user: ErpUser = Depends(get_current_user),
    disponible_only: Optional[bool] = None,
    metier: Optional[str] = None,
):
    """List employees configured for rental/lending."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_EMPLOYEE_LOCATION)
        conn.commit()
        wheres = []
        params = []
        if disponible_only is True:
            wheres.append("el.disponible_location = TRUE")
        if metier:
            wheres.append("el.metier_principal ILIKE %s")
            params.append(f"%{metier}%")
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(
            f"SELECT el.*, e.nom, e.prenom, e.email, e.telephone "
            f"FROM employee_location el "
            f"LEFT JOIN employees e ON el.employee_id = e.id "
            f"WHERE {w} ORDER BY e.nom ASC",
            params,
        )
        items = [_serialize_row(dict(r)) for r in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_rental_employees error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 17. PUT /rental/employees/{employee_id}/config ──

@router.put("/rental/employees/{employee_id}/config")
async def update_employee_location_config(employee_id: int, body: RentalEmployeeConfigUpdate, user: ErpUser = Depends(get_current_user)):
    """Configure or update an employee's rental/lending settings."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_EMPLOYEE_LOCATION)
        conn.commit()
        data = body.model_dump(exclude_unset=True)
        if not data:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        cols = list(data.keys())
        vals = list(data.values())
        set_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols)
        insert_cols = ["employee_id"] + cols
        placeholders = ", ".join(["%s"] * len(insert_cols))
        cursor.execute(
            f"INSERT INTO employee_location ({', '.join(insert_cols)}) "
            f"VALUES ({placeholders}) "
            f"ON CONFLICT (employee_id) DO UPDATE SET {set_clause}, updated_at = NOW() "
            f"RETURNING id",
            [employee_id] + vals,
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "employee_id": employee_id, "message": "Configuration mise a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("update_employee_location_config error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 18. GET /rental/employees/contracts ──

@router.get("/rental/employees/contracts")
async def list_employee_rental_contracts(
    user: ErpUser = Depends(get_current_user),
    statut: Optional[str] = None,
    employee_id: Optional[int] = None,
):
    """List employee lending contracts."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS_EMPLOYES)
        conn.commit()
        wheres = []
        params = []
        if statut:
            wheres.append("lce.statut = %s")
            params.append(statut)
        if employee_id is not None:
            wheres.append("lce.employee_id = %s")
            params.append(employee_id)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(
            f"SELECT lce.*, e.nom as employee_nom, e.prenom as employee_prenom "
            f"FROM location_contrats_employes lce "
            f"LEFT JOIN employees e ON lce.employee_id = e.id "
            f"WHERE {w} ORDER BY lce.created_at DESC",
            params,
        )
        items = [_serialize_row(dict(r)) for r in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_employee_rental_contracts error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 19. POST /rental/employees/contracts ──

@router.post("/rental/employees/contracts")
async def create_employee_rental_contract(body: RentalEmployeeContractCreate, user: ErpUser = Depends(get_current_user)):
    """Create an employee lending contract."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS_EMPLOYES)
        _ensure_table(cursor, _DDL_EMPLOYEE_LOCATION)
        # Force atomicity: disable autocommit so INSERT + UPDATE happen in one transaction (lecon #131)
        conn.autocommit = False
        # Race-safe numero: INSERT with NULL, RETURNING id, UPDATE with final value (lecon #123)
        cursor.execute(
            "INSERT INTO location_contrats_employes "
            "(numero_contrat, employee_id, client_company_id, project_id, "
            "date_debut, date_fin_prevue, tarif_type, tarif_unitaire, "
            "heures_prevues, lieu_travail, description_mission, notes) "
            "VALUES (NULL,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (body.employee_id, body.client_company_id, body.project_id,
             body.date_debut, body.date_fin_prevue, body.tarif_type, body.tarif_unitaire,
             body.heures_prevues, body.lieu_travail, body.description_mission, body.notes),
        )
        contrat_id = cursor.fetchone()["id"]
        numero = f"EMP-{contrat_id:05d}"
        cursor.execute(
            "UPDATE location_contrats_employes SET numero_contrat = %s WHERE id = %s",
            (numero, contrat_id),
        )
        # Note: Contract created as BROUILLON by default, employee status unchanged.
        # Status transition to EN_LOCATION happens via PUT /rental/employees/contracts/{id}
        # when statut is set to EN_COURS.
        conn.commit()
        return {"id": contrat_id, "numero_contrat": numero, "message": "Contrat employe cree"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("create_employee_rental_contract error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            conn.autocommit = True
        except Exception:
            pass
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 20. PUT /rental/employees/contracts/{contract_id} ──

_ALLOWED_EMP_CONTRAT_COLS = {
    "statut", "date_fin_reelle", "heures_reelles", "montant_facture", "notes",
    "date_fin_prevue", "tarif_type", "tarif_unitaire", "heures_prevues",
    "lieu_travail", "description_mission",
}

@router.put("/rental/employees/contracts/{contract_id}")
async def update_employee_rental_contract(contract_id: int, body: RentalEmployeeContractUpdate, user: ErpUser = Depends(get_current_user)):
    """Update an employee lending contract."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS_EMPLOYES)
        _ensure_table(cursor, _DDL_EMPLOYEE_LOCATION)
        conn.commit()
        data = body.model_dump(exclude_unset=True)
        if not data:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        sets = []
        params = []
        for col, val in data.items():
            if col in _ALLOWED_EMP_CONTRAT_COLS:
                sets.append(f"{col} = %s")
                params.append(val)
        sets.append("updated_at = NOW()")
        params.append(contract_id)
        cursor.execute(
            f"UPDATE location_contrats_employes SET {', '.join(sets)} "
            f"WHERE id = %s RETURNING id, employee_id",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contrat employe introuvable")
        # Sync employee status based on new contract status
        new_statut = data.get("statut")
        emp_new_statut = None
        if new_statut in ("TERMINE", "ANNULE", "FACTURE"):
            emp_new_statut = "DISPONIBLE"
        elif new_statut in ("EN_COURS", "ACTIF"):
            emp_new_statut = "EN_LOCATION"
        if emp_new_statut:
            cursor.execute(
                "INSERT INTO employee_location (employee_id, statut_location) "
                "VALUES (%s, %s) "
                "ON CONFLICT (employee_id) DO UPDATE SET statut_location = %s, updated_at = NOW()",
                (row["employee_id"], emp_new_statut, emp_new_statut))
        conn.commit()
        return {"id": row["id"], "message": "Contrat employe mis a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("update_employee_rental_contract error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 21. POST /rental/employees/contracts/{contract_id}/heures ──

@router.post("/rental/employees/contracts/{contract_id}/heures")
async def create_employee_heures(contract_id: int, body: RentalEmployeeHeuresCreate, user: ErpUser = Depends(get_current_user)):
    """Record employee hours for a lending contract."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_EMPLOYES_HEURES)
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS_EMPLOYES)
        conn.commit()
        # Validate the parent contract exists
        cursor.execute("SELECT id FROM location_contrats_employes WHERE id = %s", (contract_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Contrat employe introuvable")
        cursor.execute(
            "INSERT INTO location_employes_heures "
            "(contrat_id, date_travail, heures_normales, heures_supplementaires, "
            "description_taches, notes) "
            "VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
            (contract_id, body.date_travail, body.heures_normales,
             body.heures_supplementaires, body.description_taches, body.notes),
        )
        row = cursor.fetchone()
        total_heures = (body.heures_normales or 0) + (body.heures_supplementaires or 0)
        cursor.execute(
            "UPDATE location_contrats_employes "
            "SET heures_reelles = COALESCE(heures_reelles, 0) + %s, updated_at = NOW() "
            "WHERE id = %s", (total_heures, contract_id))
        conn.commit()
        return {"id": row["id"], "heures_ajoutees": total_heures, "message": "Heures enregistrees"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("create_employee_heures error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur interne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 22. GET /rental/employees/stats ──

@router.get("/rental/employees/stats")
async def get_rental_employees_stats(user: ErpUser = Depends(get_current_user)):
    """Return employee rental/lending statistics."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_EMPLOYEE_LOCATION)
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS_EMPLOYES)
        conn.commit()
        stats = {
            "total_employes": 0, "disponibles": 0, "en_location": 0,
            "contrats_actifs": 0,
            "heures_totales": 0, "montant_facture": 0,
        }
        cursor.execute("SELECT COUNT(*) as cnt FROM employee_location")
        stats["total_employes"] = cursor.fetchone()["cnt"]
        cursor.execute("SELECT COUNT(*) as cnt FROM employee_location WHERE statut_location = 'DISPONIBLE'")
        stats["disponibles"] = cursor.fetchone()["cnt"]
        cursor.execute("SELECT COUNT(*) as cnt FROM employee_location WHERE statut_location = 'EN_LOCATION'")
        stats["en_location"] = cursor.fetchone()["cnt"]
        cursor.execute("SELECT COUNT(*) as cnt FROM location_contrats_employes WHERE statut IN ('EN_COURS', 'ACTIF')")
        stats["contrats_actifs"] = cursor.fetchone()["cnt"]
        cursor.execute(
            "SELECT COALESCE(SUM(heures_reelles), 0) as h, COALESCE(SUM(montant_facture), 0) as m "
            "FROM location_contrats_employes")
        sums = cursor.fetchone()
        stats["heures_totales"] = float(sums["h"])
        stats["montant_facture"] = float(sums["m"])
        return stats
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_rental_employees_stats error: %s", exc)
        return {"total_employes": 0, "disponibles": 0, "en_location": 0,
                "contrats_actifs": 0,
                "heures_totales": 0, "montant_facture": 0, "error": "Erreur interne"}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 23. POST /rental/ia/chat ──

@router.post("/rental/ia/chat")
async def ia_location_chat(body: LocationIaChatRequest, user: ErpUser = Depends(get_current_user)):
    """AI chat for equipment rental questions. Uses Claude Sonnet."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")

    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    client = _get_location_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Service IA non configure")

    try:
        user_content = body.question
        if body.context:
            user_content = f"Contexte additionnel:\n{body.context}\n\nQuestion:\n{body.question}"

        model_name = "claude-sonnet-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=LOCATION_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Cost: Sonnet pricing with 30% markup
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30

        if track_ai_usage:
            try:
                track_ai_usage(user, "location_chat", input_tokens, output_tokens,
                               cost, 0, True, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass

        return {
            "response": response_text,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Location AI chat API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Location IA chat error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chat IA location")


# ── 24. POST /rental/ia/recommander ──

@router.post("/rental/ia/recommander")
async def ia_location_recommander(body: LocationIaRecommandationRequest, user: ErpUser = Depends(get_current_user)):
    """AI-powered equipment recommendation for a project. Uses Claude Opus."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")

    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    client = _get_location_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Service IA non configure")

    try:
        prompt_data = json.dumps({
            "description_projet": body.description_projet,
            "budget": body.budget,
            "duree_jours": body.duree_jours,
        }, ensure_ascii=False)

        user_message = (
            "Recommande les equipements necessaires pour ce projet de construction et retourne "
            "une reponse structuree en JSON avec les sections:\n"
            "- equipements_essentiels (liste avec nom, quantite, tarif_estime_jour, justification)\n"
            "- equipements_optionnels (liste avec nom, quantite, tarif_estime_jour, justification)\n"
            "- cout_estime (total_jour, total_semaine, total_projet)\n"
            "- conseils (liste de recommandations pratiques)\n\n"
            f"Donnees du projet:\n{prompt_data}"
        )

        model_name = "claude-opus-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=LOCATION_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Cost: Opus pricing with 30% markup
        cost = (input_tokens * 0.015 + output_tokens * 0.075) / 1000 * 1.30

        if track_ai_usage:
            try:
                track_ai_usage(user, "location_recommander", input_tokens, output_tokens,
                               cost, 0, True, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass

        # Try to parse as JSON
        recommendation = response_text
        try:
            recommendation = json.loads(response_text)
        except (json.JSONDecodeError, TypeError):
            pass

        return {
            "recommendation": recommendation,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Location AI recommander API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Location IA recommander error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recommandation")


# ── 25. POST /rental/ia/analyser-contrat ──

@router.post("/rental/ia/analyser-contrat")
async def ia_location_analyser_contrat(body: dict, user: ErpUser = Depends(get_current_user)):
    """AI analysis of a rental contract. Uses Claude Opus."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    contrat_id = body.get("contrat_id")
    if not contrat_id:
        raise HTTPException(status_code=400, detail="contrat_id requis")

    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")

    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    client = _get_location_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Service IA non configure")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, _DDL_LOCATION_CONTRATS)
        _ensure_table(cursor, _DDL_LOCATION_CONTRAT_LIGNES)
        _ensure_table(cursor, _DDL_LOCATION_ITEMS)
        conn.commit()

        cursor.execute("SELECT * FROM location_contrats WHERE id = %s", (contrat_id,))
        contrat_row = cursor.fetchone()
        if not contrat_row:
            raise HTTPException(status_code=404, detail="Contrat introuvable")
        contrat_data = _serialize_row(dict(contrat_row))

        cursor.execute(
            "SELECT cl.*, li.nom as item_nom, li.categorie as item_categorie "
            "FROM location_contrat_lignes cl "
            "LEFT JOIN location_items li ON cl.location_item_id = li.id "
            "WHERE cl.contrat_id = %s", (contrat_id,))
        lignes_data = [_serialize_row(dict(r)) for r in cursor.fetchall()]

        prompt_data = json.dumps({
            "contrat": contrat_data,
            "lignes": lignes_data,
        }, ensure_ascii=False, default=str)

        user_message = (
            "Analyse ce contrat de location d'equipements de construction et retourne "
            "une analyse structuree en JSON avec les sections:\n"
            "- score_contrat (0-100)\n"
            "- resume\n"
            "- points_forts (liste)\n"
            "- risques (liste)\n"
            "- recommandations (liste)\n"
            "- analyse_tarification (comparaison marche)\n"
            "- duree_optimale_suggeree\n\n"
            f"Donnees du contrat:\n{prompt_data}"
        )

        model_name = "claude-opus-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=LOCATION_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Cost: Opus pricing with 30% markup
        cost = (input_tokens * 0.015 + output_tokens * 0.075) / 1000 * 1.30

        if track_ai_usage:
            try:
                track_ai_usage(user, "location_analyser_contrat", input_tokens, output_tokens,
                               cost, 0, True, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass

        # Try to parse as JSON
        analysis = response_text
        try:
            analysis = json.loads(response_text)
        except (json.JSONDecodeError, TypeError):
            pass

        return {
            "analysis": analysis,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Location AI analyser-contrat API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Location IA analyser-contrat error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de l'analyse du contrat")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ── 26. POST /rental/ia/checklist ──

@router.post("/rental/ia/checklist")
async def ia_location_checklist(body: LocationIaChecklistRequest, user: ErpUser = Depends(get_current_user)):
    """AI-generated checklist for equipment rental. Uses Claude Sonnet."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")

    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    client = _get_location_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Service IA non configure")

    try:
        user_message = (
            f"Genere une checklist complete d'inspection pour la location d'un equipement "
            f"de type '{body.equipement_type}' pour une duree de '{body.duree_location}'.\n\n"
            "Inclus:\n"
            "- Inspection pre-location (avant sortie)\n"
            "- Verification pendant l'utilisation\n"
            "- Inspection au retour\n"
            "- Points de securite CNESST\n"
            "- Documents requis\n"
            "- Certifications operateur necessaires"
        )

        model_name = "claude-sonnet-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=LOCATION_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Cost: Sonnet pricing with 30% markup
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30

        if track_ai_usage:
            try:
                track_ai_usage(user, "location_checklist", input_tokens, output_tokens,
                               cost, 0, True, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass

        return {
            "checklist": response_text,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Location AI checklist API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Location IA checklist error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la generation de la checklist")


# ── 27. POST /rental/ia/location-vs-achat ──

@router.post("/rental/ia/location-vs-achat")
async def ia_location_vs_achat(body: LocationIaLocationVsAchatRequest, user: ErpUser = Depends(get_current_user)):
    """AI comparison of renting vs buying equipment. Uses Claude Sonnet."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")

    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    client = _get_location_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Service IA non configure")

    try:
        prompt_data = json.dumps({
            "equipement": body.equipement,
            "prix_achat": body.prix_achat,
            "tarif_location_jour": body.tarif_location_jour,
            "utilisation_jours_an": body.utilisation_jours_an,
        }, ensure_ascii=False)

        user_message = (
            "Compare l'achat vs la location de cet equipement et retourne une analyse "
            "structuree en JSON avec les sections:\n"
            "- recommandation ('ACHAT' ou 'LOCATION')\n"
            "- seuil_rentabilite_jours (nombre de jours ou l'achat devient plus rentable)\n"
            "- cout_annuel_location\n"
            "- cout_annuel_achat (incluant amortissement, entretien, assurance)\n"
            "- economie_annuelle\n"
            "- analyse_5_ans (projection sur 5 ans)\n"
            "- facteurs_decisifs (liste)\n"
            "- conclusion\n\n"
            f"Donnees:\n{prompt_data}"
        )

        model_name = "claude-sonnet-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=LOCATION_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Cost: Sonnet pricing with 30% markup
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30

        if track_ai_usage:
            try:
                track_ai_usage(user, "location_compare_achat", input_tokens, output_tokens,
                               cost, 0, True, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass

        # Try to parse as JSON
        analysis = response_text
        try:
            analysis = json.loads(response_text)
        except (json.JSONDecodeError, TypeError):
            pass

        return {
            "analysis": analysis,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Location AI location-vs-achat API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Location IA location-vs-achat error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la comparaison location vs achat")


# ============================================
# MAINTENANCE — CRUD complet + IA
# ============================================


def _compute_next_maintenance(derniere_date_str: Optional[str], frequence_type: str, frequence_valeur: int) -> Optional[str]:
    """Calcule la prochaine date de maintenance basee sur la frequence."""
    if not derniere_date_str:
        return None
    if not frequence_valeur or frequence_valeur <= 0:
        return None
    try:
        from datetime import datetime, timedelta
        date_str = str(derniere_date_str)[:10]
        if not date_str:
            return None
        base = datetime.fromisoformat(date_str)
        if frequence_type == "JOURS":
            return (base + timedelta(days=frequence_valeur)).date().isoformat()
        if frequence_type == "SEMAINES":
            return (base + timedelta(weeks=frequence_valeur)).date().isoformat()
        if frequence_type == "MOIS":
            return (base + timedelta(days=frequence_valeur * 30)).date().isoformat()
        return None
    except Exception as exc:
        logger.warning("_compute_next_maintenance error: %s", exc)
        return None


# ─────────────────────────────────────
# Maintenance Types (5 endpoints)
# ─────────────────────────────────────

@router.get("/maintenance/types")
async def list_maintenance_types(
    user: ErpUser = Depends(get_current_user),
    actif_only: bool = True,
    categorie: Optional[str] = None,
):
    """List maintenance types catalog."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        wheres = []
        params = []
        if actif_only:
            wheres.append("actif = TRUE")
        if categorie:
            wheres.append("categorie = %s")
            params.append(categorie)
        w = " WHERE " + " AND ".join(wheres) if wheres else ""
        cursor.execute(
            f"SELECT id, nom, description, categorie, frequence_jours, checklist_json, "
            f"duree_estimee_heures, cout_estime, competences_requises, pieces_requises_json, "
            f"actif, created_at FROM maintenance_types{w} ORDER BY nom ASC",
            params,
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_maintenance_types error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur chargement types maintenance")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/maintenance/types")
async def create_maintenance_type(body: MaintenanceTypeCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new maintenance type."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        cursor.execute(
            "INSERT INTO maintenance_types (nom, description, categorie, frequence_jours, "
            "checklist_json, duree_estimee_heures, cout_estime, competences_requises, "
            "pieces_requises_json, actif) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                body.nom, body.description, body.categorie, body.frequence_jours,
                body.checklist_json, body.duree_estimee_heures, body.cout_estime,
                body.competences_requises, body.pieces_requises_json, body.actif,
            ),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Type de maintenance cree"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_maintenance_type error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur creation type maintenance")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/maintenance/types/{type_id}")
async def update_maintenance_type(type_id: int, body: MaintenanceTypeUpdate, user: ErpUser = Depends(get_current_user)):
    """Update a maintenance type."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        updates = body.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        sets = [f"{k} = %s" for k in updates.keys()]
        params = list(updates.values()) + [type_id]
        cursor.execute(
            f"UPDATE maintenance_types SET {', '.join(sets)} WHERE id = %s RETURNING id",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Type introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Type mis a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_maintenance_type error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur mise a jour type")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/maintenance/types/{type_id}")
async def delete_maintenance_type(type_id: int, user: ErpUser = Depends(get_current_user)):
    """Soft delete a maintenance type."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        cursor.execute(
            "UPDATE maintenance_types SET actif = FALSE WHERE id = %s RETURNING id",
            (type_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Type introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Type desactive"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_maintenance_type error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur suppression type")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ─────────────────────────────────────
# Maintenance Planification (5 endpoints)
# ─────────────────────────────────────

@router.get("/maintenance/planification")
async def list_maintenance_planification(
    user: ErpUser = Depends(get_current_user),
    actif_only: bool = True,
    equipement_type: Optional[str] = None,
    equipement_id: Optional[int] = None,
):
    """List preventive maintenance schedule."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        wheres = []
        params = []
        if actif_only:
            wheres.append("p.actif = TRUE")
        if equipement_type:
            wheres.append("p.equipement_type = %s")
            params.append(equipement_type)
        if equipement_id is not None:
            wheres.append("p.equipement_id = %s")
            params.append(equipement_id)
        w = " WHERE " + " AND ".join(wheres) if wheres else ""
        cursor.execute(
            f"SELECT p.*, t.nom AS type_nom, t.categorie AS type_categorie "
            f"FROM maintenance_planification p "
            f"LEFT JOIN maintenance_types t ON p.maintenance_type_id = t.id"
            f"{w} ORDER BY p.prochaine_maintenance ASC NULLS LAST, p.created_at DESC",
            params,
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_maintenance_planification error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur chargement planification")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/maintenance/planification")
async def create_maintenance_planification(
    body: MaintenancePlanificationCreate, user: ErpUser = Depends(get_current_user)
):
    """Create a new preventive maintenance schedule."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if body.frequence_valeur is not None and body.frequence_valeur <= 0:
        raise HTTPException(status_code=400, detail="La frequence doit etre superieure a 0")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        prochaine = body.prochaine_maintenance
        if not prochaine and body.derniere_maintenance:
            prochaine = _compute_next_maintenance(
                body.derniere_maintenance, body.frequence_type or "JOURS", body.frequence_valeur or 30
            )
        cursor.execute(
            "INSERT INTO maintenance_planification (equipement_type, equipement_id, maintenance_type_id, "
            "nom_planification, description, frequence_type, frequence_valeur, derniere_maintenance, "
            "prochaine_maintenance, seuil_alerte_jours, priorite, responsable_id, actif, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                body.equipement_type, body.equipement_id, body.maintenance_type_id,
                body.nom_planification, body.description, body.frequence_type, body.frequence_valeur,
                body.derniere_maintenance, prochaine, body.seuil_alerte_jours,
                body.priorite, body.responsable_id, body.actif, body.notes,
            ),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Planification creee"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_maintenance_planification error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur creation planification")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/maintenance/planification/{planif_id}")
async def update_maintenance_planification(
    planif_id: int, body: MaintenancePlanificationUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update a maintenance planification."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if body.frequence_valeur is not None and body.frequence_valeur <= 0:
        raise HTTPException(status_code=400, detail="La frequence doit etre superieure a 0")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        updates = body.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        sets = [f"{k} = %s" for k in updates.keys()]
        sets.append("updated_at = NOW()")
        params = list(updates.values()) + [planif_id]
        cursor.execute(
            f"UPDATE maintenance_planification SET {', '.join(sets)} WHERE id = %s RETURNING id",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Planification introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Planification mise a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_maintenance_planification error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur mise a jour planification")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/maintenance/planification/{planif_id}")
async def delete_maintenance_planification(planif_id: int, user: ErpUser = Depends(get_current_user)):
    """Soft delete a maintenance planification."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        cursor.execute(
            "UPDATE maintenance_planification SET actif = FALSE, updated_at = NOW() "
            "WHERE id = %s RETURNING id",
            (planif_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Planification introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Planification desactivee"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_maintenance_planification error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur suppression planification")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# Legacy alias: /maintenance/preventive -> /maintenance/planification
@router.get("/maintenance/preventive")
async def get_preventive_schedule(user: ErpUser = Depends(get_current_user)):
    """Legacy endpoint: return preventive maintenance schedule."""
    return await list_maintenance_planification(user=user, actif_only=True)


# ─────────────────────────────────────
# Maintenance Demandes (5 endpoints)
# ─────────────────────────────────────

@router.get("/maintenance/requests")
async def list_maintenance_requests(
    user: ErpUser = Depends(get_current_user),
    statut: Optional[str] = None,
    equipement_type: Optional[str] = None,
    equipement_id: Optional[int] = None,
    limit: int = 100,
):
    """List maintenance requests with optional filters."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        wheres = []
        params = []
        if statut:
            wheres.append("statut = %s")
            params.append(statut)
        if equipement_type:
            wheres.append("equipement_type = %s")
            params.append(equipement_type)
        if equipement_id is not None:
            wheres.append("equipement_id = %s")
            params.append(equipement_id)
        w = " WHERE " + " AND ".join(wheres) if wheres else ""
        params.append(max(1, min(limit, 500)))
        cursor.execute(
            f"SELECT id, numero_demande, equipement_type, equipement_id, planification_id, "
            f"type_maintenance, priorite, statut, titre, description, symptomes, demandeur_id, "
            f"date_demande, date_souhaitee, date_planifiee, date_debut, date_fin, "
            f"technicien_interne_id, fournisseur_externe_id, cout_estime, cout_reel, "
            f"temps_estime_heures, temps_reel_heures, cause_panne, solution, notes, "
            f"created_at, updated_at FROM maintenance_demandes{w} "
            f"ORDER BY created_at DESC LIMIT %s",
            params,
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_maintenance_requests error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur chargement demandes")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/maintenance/requests/{request_id}")
async def get_maintenance_request(request_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single maintenance request with its pieces."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        cursor.execute("SELECT * FROM maintenance_demandes WHERE id = %s", (request_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Demande introuvable")
        demande = _serialize_row(row)
        cursor.execute(
            "SELECT id, piece_nom, piece_reference, inventory_item_id, quantite, "
            "cout_unitaire, cout_total, fournisseur_id, created_at "
            "FROM maintenance_pieces WHERE demande_id = %s ORDER BY id ASC",
            (request_id,),
        )
        pieces = [_serialize_row(r) for r in cursor.fetchall()]
        cursor.execute(
            "SELECT id, demande_id, date_intervention, technicien_id, fournisseur_id, "
            "type_intervention, description_travaux, duree_heures, statut, observations, "
            "recommandations, entreprise_emettrice_id, created_at "
            "FROM maintenance_interventions WHERE demande_id = %s ORDER BY date_intervention DESC",
            (request_id,),
        )
        interventions = [_serialize_row(r) for r in cursor.fetchall()]
        return {"demande": demande, "pieces": pieces, "interventions": interventions}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_maintenance_request error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur chargement demande")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/maintenance/requests")
async def create_maintenance_request(body: MaintenanceRequestCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new maintenance request."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        numero = _gen_numero("MR")
        titre = body.titre or (body.description[:80] if body.description else "Demande maintenance")
        type_m = body.type_maintenance or body.type_demande or "CORRECTIVE"
        cursor.execute(
            "INSERT INTO maintenance_demandes (numero_demande, equipement_type, equipement_id, "
            "planification_id, type_maintenance, priorite, statut, titre, description, symptomes, "
            "demandeur_id, date_souhaitee, cout_estime, temps_estime_heures, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s, 'DEMANDE', %s, %s, %s, %s, %s, %s, %s, %s) "
            "RETURNING id, numero_demande",
            (
                numero, body.equipement_type or "INVENTORY", body.equipement_id or 0,
                body.planification_id, type_m, body.priorite or "NORMALE",
                titre, body.description, body.symptomes, body.demandeur_id,
                body.date_souhaitee, body.cout_estime, body.temps_estime_heures, body.notes,
            ),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "numero_demande": row["numero_demande"], "message": "Demande creee"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_maintenance_request error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur creation demande")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/maintenance/requests/{request_id}")
async def update_maintenance_request(
    request_id: int, body: MaintenanceRequestUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update an existing maintenance request."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        updates = body.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        sets = [f"{k} = %s" for k in updates.keys()]
        sets.append("updated_at = NOW()")
        params = list(updates.values()) + [request_id]
        cursor.execute(
            f"UPDATE maintenance_demandes SET {', '.join(sets)} WHERE id = %s RETURNING id, statut",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Demande introuvable")
        # Historique automatique lors de transition vers TERMINE
        if updates.get("statut") == "TERMINE":
            try:
                cursor.execute(
                    "SELECT equipement_type, equipement_id, description, cout_reel, temps_reel_heures "
                    "FROM maintenance_demandes WHERE id = %s",
                    (request_id,),
                )
                d = cursor.fetchone()
                if d:
                    cursor.execute(
                        "INSERT INTO maintenance_historique (equipement_type, equipement_id, demande_id, "
                        "type_evenement, description, cout, duree_heures) "
                        "VALUES (%s, %s, %s, 'MAINTENANCE', %s, %s, %s)",
                        (
                            d["equipement_type"], d["equipement_id"], request_id,
                            d.get("description"), d.get("cout_reel"), d.get("temps_reel_heures"),
                        ),
                    )
            except Exception as exc:
                logger.warning("Auto-insert historique on demande %s failed: %s", request_id, exc)
        conn.commit()
        return {"id": row["id"], "message": "Demande mise a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_maintenance_request error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur mise a jour demande")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/maintenance/requests/{request_id}")
async def delete_maintenance_request(request_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a maintenance request (only if not EN_COURS or TERMINE)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        cursor.execute("SELECT statut FROM maintenance_demandes WHERE id = %s", (request_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Demande introuvable")
        if row["statut"] in ("EN_COURS", "TERMINE"):
            raise HTTPException(status_code=400, detail="Impossible de supprimer une demande en cours ou terminee")
        # Cascade delete pieces
        cursor.execute("DELETE FROM maintenance_pieces WHERE demande_id = %s", (request_id,))
        cursor.execute("DELETE FROM maintenance_interventions WHERE demande_id = %s", (request_id,))
        cursor.execute("DELETE FROM maintenance_demandes WHERE id = %s RETURNING id", (request_id,))
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Demande supprimee"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_maintenance_request error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur suppression demande")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ─────────────────────────────────────
# Maintenance Interventions (5 endpoints)
# ─────────────────────────────────────

@router.get("/maintenance/interventions")
async def list_maintenance_interventions(
    user: ErpUser = Depends(get_current_user),
    statut: Optional[str] = None,
    demande_id: Optional[int] = None,
    technicien_id: Optional[int] = None,
):
    """List maintenance interventions with optional filters."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        wheres = []
        params = []
        if statut:
            wheres.append("i.statut = %s")
            params.append(statut)
        if demande_id is not None:
            wheres.append("i.demande_id = %s")
            params.append(demande_id)
        if technicien_id is not None:
            wheres.append("i.technicien_id = %s")
            params.append(technicien_id)
        w = " WHERE " + " AND ".join(wheres) if wheres else ""
        cursor.execute(
            f"SELECT i.*, d.numero_demande, d.titre AS demande_titre, d.equipement_type, "
            f"d.equipement_id "
            f"FROM maintenance_interventions i "
            f"LEFT JOIN maintenance_demandes d ON i.demande_id = d.id"
            f"{w} ORDER BY i.date_intervention DESC LIMIT 100",
            params,
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_maintenance_interventions error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur chargement interventions")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/maintenance/interventions/{intervention_id}")
async def get_maintenance_intervention(intervention_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single intervention with its pieces."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        cursor.execute(
            "SELECT i.*, d.numero_demande, d.titre AS demande_titre, d.equipement_type, d.equipement_id "
            "FROM maintenance_interventions i "
            "LEFT JOIN maintenance_demandes d ON i.demande_id = d.id "
            "WHERE i.id = %s",
            (intervention_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Intervention introuvable")
        intervention = _serialize_row(row)
        cursor.execute(
            "SELECT * FROM maintenance_pieces WHERE intervention_id = %s ORDER BY id ASC",
            (intervention_id,),
        )
        pieces = [_serialize_row(r) for r in cursor.fetchall()]
        return {"intervention": intervention, "pieces": pieces}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_maintenance_intervention error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur chargement intervention")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/maintenance/interventions")
async def create_maintenance_intervention(
    body: MaintenanceInterventionCreate, user: ErpUser = Depends(get_current_user)
):
    """Create a new intervention (attached to a demande)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        cursor.execute("SELECT id FROM maintenance_demandes WHERE id = %s", (body.demande_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Demande parent introuvable")
        cursor.execute(
            "INSERT INTO maintenance_interventions (demande_id, date_intervention, technicien_id, "
            "fournisseur_id, type_intervention, description_travaux, duree_heures, statut, "
            "observations, recommandations, signature_technicien, entreprise_emettrice_id) "
            "VALUES (%s, COALESCE(%s, NOW()), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                body.demande_id, body.date_intervention, body.technicien_id, body.fournisseur_id,
                body.type_intervention, body.description_travaux, body.duree_heures, body.statut or "EN_COURS",
                body.observations, body.recommandations, body.signature_technicien, body.entreprise_emettrice_id,
            ),
        )
        row = cursor.fetchone()
        # Auto-update demande statut to EN_COURS if it was DEMANDE/APPROUVE/PLANIFIE
        cursor.execute(
            "UPDATE maintenance_demandes SET statut = 'EN_COURS', date_debut = COALESCE(date_debut, NOW()), "
            "updated_at = NOW() "
            "WHERE id = %s AND statut IN ('DEMANDE', 'APPROUVE', 'PLANIFIE')",
            (body.demande_id,),
        )
        conn.commit()
        return {"id": row["id"], "message": "Intervention creee"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_maintenance_intervention error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur creation intervention")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/maintenance/interventions/{intervention_id}")
async def update_maintenance_intervention(
    intervention_id: int, body: MaintenanceInterventionUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update an intervention (auto-close demande when statut=TERMINE)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        updates = body.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        sets = [f"{k} = %s" for k in updates.keys()]
        params = list(updates.values()) + [intervention_id]
        cursor.execute(
            f"UPDATE maintenance_interventions SET {', '.join(sets)} WHERE id = %s RETURNING id, demande_id, statut",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Intervention introuvable")
        # Auto-close parent demande when intervention terminee + insert historique
        if updates.get("statut") == "TERMINE" and row.get("demande_id"):
            demande_id = row["demande_id"]
            cursor.execute(
                "UPDATE maintenance_demandes SET statut = 'TERMINE', date_fin = NOW(), updated_at = NOW() "
                "WHERE id = %s AND statut NOT IN ('TERMINE', 'ANNULE') "
                "RETURNING id",
                (demande_id,),
            )
            closed = cursor.fetchone()
            # Si la demande a effectivement ete fermee, inserer dans historique
            if closed:
                try:
                    cursor.execute(
                        "SELECT equipement_type, equipement_id, description, cout_reel, temps_reel_heures "
                        "FROM maintenance_demandes WHERE id = %s",
                        (demande_id,),
                    )
                    d = cursor.fetchone()
                    if d:
                        cursor.execute(
                            "INSERT INTO maintenance_historique (equipement_type, equipement_id, demande_id, "
                            "type_evenement, description, cout, duree_heures) "
                            "VALUES (%s, %s, %s, 'MAINTENANCE', %s, %s, %s)",
                            (
                                d["equipement_type"], d["equipement_id"], demande_id,
                                d.get("description"), d.get("cout_reel"), d.get("temps_reel_heures"),
                            ),
                        )
                except Exception as exc:
                    logger.warning("Auto-insert historique on intervention %s failed: %s", intervention_id, exc)
        conn.commit()
        return {"id": row["id"], "message": "Intervention mise a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_maintenance_intervention error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur mise a jour intervention")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/maintenance/interventions/{intervention_id}")
async def delete_maintenance_intervention(intervention_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete an intervention."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        cursor.execute("DELETE FROM maintenance_pieces WHERE intervention_id = %s", (intervention_id,))
        cursor.execute("DELETE FROM maintenance_interventions WHERE id = %s RETURNING id", (intervention_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Intervention introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Intervention supprimee"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_maintenance_intervention error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur suppression intervention")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ─────────────────────────────────────
# Maintenance Pieces (3 endpoints)
# ─────────────────────────────────────

@router.get("/maintenance/pieces")
async def list_maintenance_pieces(
    user: ErpUser = Depends(get_current_user),
    demande_id: Optional[int] = None,
    intervention_id: Optional[int] = None,
):
    """List maintenance pieces (optionally filtered by demande or intervention)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        wheres = []
        params = []
        if demande_id is not None:
            wheres.append("demande_id = %s")
            params.append(demande_id)
        if intervention_id is not None:
            wheres.append("intervention_id = %s")
            params.append(intervention_id)
        w = " WHERE " + " AND ".join(wheres) if wheres else ""
        cursor.execute(
            f"SELECT id, demande_id, intervention_id, piece_nom, piece_reference, inventory_item_id, "
            f"quantite, cout_unitaire, cout_total, fournisseur_id, created_at "
            f"FROM maintenance_pieces{w} ORDER BY created_at DESC LIMIT 200",
            params,
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_maintenance_pieces error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur chargement pieces")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/maintenance/pieces")
async def create_maintenance_piece(body: MaintenancePieceCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new piece entry (and optionally decrement inventory stock)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        cout_total = body.cout_total
        if cout_total is None and body.cout_unitaire is not None and body.quantite is not None:
            cout_total = float(body.cout_unitaire) * float(body.quantite)
        cursor.execute(
            "INSERT INTO maintenance_pieces (demande_id, intervention_id, piece_nom, piece_reference, "
            "inventory_item_id, quantite, cout_unitaire, cout_total, fournisseur_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                body.demande_id, body.intervention_id, body.piece_nom, body.piece_reference,
                body.inventory_item_id, body.quantite or 1, body.cout_unitaire, cout_total,
                body.fournisseur_id,
            ),
        )
        row = cursor.fetchone()
        # Decrement inventory stock if linked to inventory_items
        if body.inventory_item_id and body.quantite:
            try:
                cursor.execute(
                    "SELECT EXISTS (SELECT FROM information_schema.tables "
                    "WHERE table_schema = %s AND table_name = 'inventory_items')",
                    (user.schema,),
                )
                if cursor.fetchone().get("exists", False):
                    cursor.execute(
                        "UPDATE inventory_items SET quantite = GREATEST(0, COALESCE(quantite, 0) - %s) "
                        "WHERE id = %s",
                        (body.quantite, body.inventory_item_id),
                    )
            except Exception:
                pass
        conn.commit()
        return {"id": row["id"], "message": "Piece ajoutee"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_maintenance_piece error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur ajout piece")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/maintenance/pieces/{piece_id}")
async def delete_maintenance_piece(piece_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a piece entry."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        cursor.execute("DELETE FROM maintenance_pieces WHERE id = %s RETURNING id", (piece_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Piece introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Piece supprimee"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_maintenance_piece error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur suppression piece")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ─────────────────────────────────────
# Maintenance Historique (2 endpoints)
# ─────────────────────────────────────

@router.get("/maintenance/historique")
async def list_maintenance_historique(
    user: ErpUser = Depends(get_current_user),
    equipement_type: Optional[str] = None,
    equipement_id: Optional[int] = None,
    limit: int = 100,
):
    """List maintenance historique for an equipement."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        wheres = []
        params = []
        if equipement_type:
            wheres.append("equipement_type = %s")
            params.append(equipement_type)
        if equipement_id is not None:
            wheres.append("equipement_id = %s")
            params.append(equipement_id)
        w = " WHERE " + " AND ".join(wheres) if wheres else ""
        params.append(max(1, min(limit, 500)))
        cursor.execute(
            f"SELECT id, equipement_type, equipement_id, demande_id, type_evenement, date_evenement, "
            f"description, cout, duree_heures, technicien, compteur_heures, compteur_km, notes, created_at "
            f"FROM maintenance_historique{w} ORDER BY date_evenement DESC LIMIT %s",
            params,
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_maintenance_historique error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur chargement historique")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/maintenance/historique")
async def create_maintenance_historique(
    body: MaintenanceHistoriqueCreate, user: ErpUser = Depends(get_current_user)
):
    """Record a manual historique entry."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        cursor.execute(
            "INSERT INTO maintenance_historique (equipement_type, equipement_id, demande_id, type_evenement, "
            "date_evenement, description, cout, duree_heures, technicien, compteur_heures, compteur_km, notes) "
            "VALUES (%s, %s, %s, %s, COALESCE(%s, NOW()), %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                body.equipement_type, body.equipement_id, body.demande_id, body.type_evenement,
                body.date_evenement, body.description, body.cout, body.duree_heures, body.technicien,
                body.compteur_heures, body.compteur_km, body.notes,
            ),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Entree historique creee"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_maintenance_historique error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur creation entree historique")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ─────────────────────────────────────
# Maintenance Compteurs (2 endpoints)
# ─────────────────────────────────────

@router.get("/maintenance/compteurs")
async def list_maintenance_compteurs(
    user: ErpUser = Depends(get_current_user),
    equipement_type: Optional[str] = None,
    equipement_id: Optional[int] = None,
):
    """List counter readings for an equipement."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        wheres = []
        params = []
        if equipement_type:
            wheres.append("equipement_type = %s")
            params.append(equipement_type)
        if equipement_id is not None:
            wheres.append("equipement_id = %s")
            params.append(equipement_id)
        w = " WHERE " + " AND ".join(wheres) if wheres else ""
        cursor.execute(
            f"SELECT id, equipement_type, equipement_id, type_compteur, valeur_actuelle, "
            f"date_releve, releve_par_id, notes FROM maintenance_compteurs{w} "
            f"ORDER BY date_releve DESC LIMIT 100",
            params,
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_maintenance_compteurs error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur chargement compteurs")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/maintenance/compteurs")
async def create_maintenance_compteur(
    body: MaintenanceCompteurCreate, user: ErpUser = Depends(get_current_user)
):
    """Record a new counter reading."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        cursor.execute(
            "INSERT INTO maintenance_compteurs (equipement_type, equipement_id, type_compteur, "
            "valeur_actuelle, date_releve, releve_par_id, notes) "
            "VALUES (%s, %s, %s, %s, COALESCE(%s, NOW()), %s, %s) RETURNING id",
            (
                body.equipement_type, body.equipement_id, body.type_compteur, body.valeur_actuelle,
                body.date_releve, body.releve_par_id, body.notes,
            ),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Releve enregistre"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_maintenance_compteur error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur creation releve")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ─────────────────────────────────────
# Maintenance Alertes (4 endpoints)
# ─────────────────────────────────────

@router.get("/maintenance/alertes")
async def list_maintenance_alertes(
    user: ErpUser = Depends(get_current_user),
    non_lues_only: bool = False,
    priorite: Optional[str] = None,
):
    """List maintenance alerts."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        wheres = []
        params = []
        if non_lues_only:
            wheres.append("lue = FALSE")
        if priorite:
            wheres.append("priorite = %s")
            params.append(priorite)
        w = " WHERE " + " AND ".join(wheres) if wheres else ""
        cursor.execute(
            f"SELECT id, equipement_type, equipement_id, planification_id, type_alerte, priorite, "
            f"titre, message, date_alerte, date_echeance, lue, traitee, traite_par_id, date_traitement, "
            f"created_at FROM maintenance_alertes{w} "
            f"ORDER BY CASE priorite WHEN 'CRITIQUE' THEN 1 WHEN 'HAUTE' THEN 2 "
            f"WHEN 'NORMALE' THEN 3 ELSE 4 END, date_alerte DESC LIMIT 100",
            params,
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_maintenance_alertes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur chargement alertes")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/maintenance/alertes")
async def create_maintenance_alerte(
    body: MaintenanceAlerteCreate, user: ErpUser = Depends(get_current_user)
):
    """Create a manual alert."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        cursor.execute(
            "INSERT INTO maintenance_alertes (equipement_type, equipement_id, planification_id, "
            "type_alerte, priorite, titre, message, date_echeance) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                body.equipement_type, body.equipement_id, body.planification_id,
                body.type_alerte, body.priorite or "NORMALE", body.titre, body.message, body.date_echeance,
            ),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Alerte creee"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_maintenance_alerte error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur creation alerte")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/maintenance/alertes/{alerte_id}")
async def update_maintenance_alerte(
    alerte_id: int, body: MaintenanceAlerteUpdate, user: ErpUser = Depends(get_current_user)
):
    """Mark alert as read or processed."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        updates = body.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        sets = [f"{k} = %s" for k in updates.keys()]
        if updates.get("traitee"):
            sets.append("date_traitement = NOW()")
        params = list(updates.values()) + [alerte_id]
        cursor.execute(
            f"UPDATE maintenance_alertes SET {', '.join(sets)} WHERE id = %s RETURNING id",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Alerte introuvable")
        conn.commit()
        return {"id": row["id"], "message": "Alerte mise a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_maintenance_alerte error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur mise a jour alerte")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/maintenance/alertes/generate")
async def generate_maintenance_alertes(user: ErpUser = Depends(get_current_user)):
    """Auto-generate alerts based on planifications due (single query + dedup, max 500)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    # SAVEPOINT exige un bloc transactionnel. psycopg2 pool retourne parfois
    # des connexions en autocommit=True (lecon #122) — dans ce mode SAVEPOINT
    # echoue avec "SAVEPOINT can only be used in transaction blocks".
    # Forcer autocommit=False avant tout SAVEPOINT, restaurer dans le finally.
    prev_autocommit = None
    try:
        prev_autocommit = conn.autocommit
        if prev_autocommit:
            conn.autocommit = False
    except Exception:
        pass
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        # UNIQUE INDEX partial pour prevenir les doublons d'alertes non traitees
        # (race condition safe: deux threads paralleles ne peuvent pas inserer 2 alertes
        # actives pour la meme planification/type)
        # Wrap in SAVEPOINT: concurrent workers on a fresh tenant can race
        # on pg_class_relname_nsp_index. Without SAVEPOINT, the failed
        # CREATE INDEX leaves the txn in aborted state and the SELECT below
        # crashes with "current transaction is aborted".
        cursor.execute("SAVEPOINT sp_maint_alertes_idx")
        try:
            cursor.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_maint_alertes_dedup "
                "ON maintenance_alertes(planification_id, type_alerte) "
                "WHERE traitee = FALSE AND planification_id IS NOT NULL"
            )
            cursor.execute("RELEASE SAVEPOINT sp_maint_alertes_idx")
        except Exception as exc:
            try:
                cursor.execute("ROLLBACK TO SAVEPOINT sp_maint_alertes_idx")
            except Exception:
                pass
            _msg = str(exc).lower()
            if not any(tok in _msg for tok in ("duplicate key", "pg_class_relname", "already exists")):
                logger.warning("idx_maint_alertes_dedup create failed: %s", exc)
            else:
                logger.warning("idx_maint_alertes_dedup race: %s", exc)
        # Single query: planifications actives dues, SANS alerte non traitee existante (LEFT JOIN anti-duplicate)
        cursor.execute(
            "SELECT p.id, p.equipement_type, p.equipement_id, p.nom_planification, "
            "p.prochaine_maintenance, p.seuil_alerte_jours, p.priorite "
            "FROM maintenance_planification p "
            "LEFT JOIN maintenance_alertes a "
            "  ON a.planification_id = p.id AND a.traitee = FALSE "
            "WHERE p.actif = TRUE "
            "  AND p.prochaine_maintenance IS NOT NULL "
            "  AND p.prochaine_maintenance <= CURRENT_DATE + COALESCE(p.seuil_alerte_jours, 7) "
            "  AND a.id IS NULL "
            "LIMIT 500"
        )
        rows = cursor.fetchall()
        if not rows:
            return {"generated": 0, "message": "Aucune alerte a generer"}
        from datetime import date, datetime
        today = date.today()
        # Batch insert des nouvelles alertes avec ON CONFLICT DO NOTHING (race-safe)
        insert_values = []
        for p in rows:
            proch = p["prochaine_maintenance"]
            if isinstance(proch, datetime):
                proch_date = proch.date()
            elif isinstance(proch, date):
                proch_date = proch
            else:
                proch_date = None
            is_retard = proch_date is not None and proch_date < today
            type_alerte = "MAINTENANCE_RETARD" if is_retard else "MAINTENANCE_DUE"
            titre = f"{'Retard' if is_retard else 'Due'}: {p['nom_planification']}"
            message = f"Prochaine maintenance prevue le {proch}"
            insert_values.append((
                p["equipement_type"], p["equipement_id"], p["id"], type_alerte,
                p["priorite"] or "NORMALE", titre, message, proch,
            ))
        # ON CONFLICT cible l'index partial idx_maint_alertes_dedup (dedup race-safe)
        cursor.executemany(
            "INSERT INTO maintenance_alertes (equipement_type, equipement_id, planification_id, "
            "type_alerte, priorite, titre, message, date_echeance) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (planification_id, type_alerte) "
            "WHERE traitee = FALSE AND planification_id IS NOT NULL DO NOTHING",
            insert_values,
        )
        generated = cursor.rowcount if cursor.rowcount >= 0 else len(insert_values)
        conn.commit()
        return {"generated": generated, "message": f"{generated} alertes generees"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("generate_maintenance_alertes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur generation alertes")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        # Restaurer l'autocommit avant de retourner la connexion au pool.
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception:
                pass
        conn.close()


# ─────────────────────────────────────
# Maintenance Statistics (1 endpoint enrichi)
# ─────────────────────────────────────

@router.get("/maintenance/statistics")
async def get_maintenance_stats(user: ErpUser = Depends(get_current_user)):
    """Return aggregated maintenance statistics."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_maintenance_tables(cursor)
        stats = {
            "total": 0,
            "par_statut": {},
            "par_priorite": {},
            "cout_reel": 0.0,
            "cout_estime": 0.0,
            "en_cours": 0,
            "en_attente": 0,
            "terminees_mois": 0,
            "alertes_non_lues": 0,
            "planifications_actives": 0,
            "planifications_retard": 0,
            "interventions_mois": 0,
        }
        cursor.execute("SELECT COUNT(*) AS c FROM maintenance_demandes")
        stats["total"] = cursor.fetchone()["c"]
        cursor.execute("SELECT statut, COUNT(*) AS c FROM maintenance_demandes GROUP BY statut")
        stats["par_statut"] = {row["statut"]: row["c"] for row in cursor.fetchall()}
        cursor.execute("SELECT priorite, COUNT(*) AS c FROM maintenance_demandes GROUP BY priorite")
        stats["par_priorite"] = {row["priorite"]: row["c"] for row in cursor.fetchall()}
        cursor.execute(
            "SELECT COALESCE(SUM(cout_reel), 0) AS cr, COALESCE(SUM(cout_estime), 0) AS ce "
            "FROM maintenance_demandes"
        )
        r = cursor.fetchone()
        stats["cout_reel"] = float(r["cr"] or 0)
        stats["cout_estime"] = float(r["ce"] or 0)
        cursor.execute(
            "SELECT COUNT(*) AS c FROM maintenance_demandes WHERE statut = 'EN_COURS'"
        )
        stats["en_cours"] = cursor.fetchone()["c"]
        cursor.execute(
            "SELECT COUNT(*) AS c FROM maintenance_demandes "
            "WHERE statut IN ('DEMANDE', 'APPROUVE', 'PLANIFIE', 'EN_ATTENTE_PIECES')"
        )
        stats["en_attente"] = cursor.fetchone()["c"]
        cursor.execute(
            "SELECT COUNT(*) AS c FROM maintenance_demandes "
            "WHERE statut = 'TERMINE' AND date_fin >= date_trunc('month', NOW())"
        )
        stats["terminees_mois"] = cursor.fetchone()["c"]
        cursor.execute(
            "SELECT COUNT(*) AS c FROM maintenance_alertes WHERE lue = FALSE AND traitee = FALSE"
        )
        stats["alertes_non_lues"] = cursor.fetchone()["c"]
        cursor.execute(
            "SELECT COUNT(*) AS c FROM maintenance_planification WHERE actif = TRUE"
        )
        stats["planifications_actives"] = cursor.fetchone()["c"]
        cursor.execute(
            "SELECT COUNT(*) AS c FROM maintenance_planification "
            "WHERE actif = TRUE AND prochaine_maintenance IS NOT NULL "
            "AND prochaine_maintenance < CURRENT_DATE"
        )
        stats["planifications_retard"] = cursor.fetchone()["c"]
        cursor.execute(
            "SELECT COUNT(*) AS c FROM maintenance_interventions "
            "WHERE date_intervention >= date_trunc('month', NOW())"
        )
        stats["interventions_mois"] = cursor.fetchone()["c"]
        return stats
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_maintenance_stats error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur chargement statistiques")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ─────────────────────────────────────
# Maintenance IA (6 endpoints)
# ─────────────────────────────────────

@router.post("/maintenance/ia/chat")
async def ia_maintenance_chat(body: MaintenanceIaChatRequest, user: ErpUser = Depends(get_current_user)):
    """Chat expert maintenance (Claude Sonnet)."""
    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=402, detail=error_msg or "Credits IA epuises")
    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")
    client = _get_maintenance_ai_client()
    if not client:
        raise HTTPException(status_code=503, detail="Service IA non configure")
    try:
        prompt = body.question
        if body.context:
            prompt = f"CONTEXTE:\n{body.context}\n\nQUESTION:\n{body.question}"
        model_name = "claude-sonnet-4-6"
        response = client.messages.create(
            model=model_name,
            max_tokens=32000,
            temperature=0.4,
            system=MAINTENANCE_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens if response.usage else 0
        output_tokens = response.usage.output_tokens if response.usage else 0
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30
        if track_ai_usage:
            try:
                track_ai_usage(user, "maintenance_chat", input_tokens, output_tokens,
                               cost_usd=cost, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass
        return {
            "response": text,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Maintenance AI chat API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Maintenance IA chat error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chat IA")


@router.post("/maintenance/ia/diagnose")
async def ia_maintenance_diagnose(
    body: MaintenanceIaDiagnoseRequest, user: ErpUser = Depends(get_current_user)
):
    """Diagnostic equipement (Claude Opus, retour JSON)."""
    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=402, detail=error_msg or "Credits IA epuises")
    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")
    client = _get_maintenance_ai_client()
    if not client:
        raise HTTPException(status_code=503, detail="Service IA non configure")
    try:
        prompt = f"""Diagnostique ce probleme d'equipement de construction:

EQUIPEMENT: {body.equipement}

SYMPTOMES OBSERVES:
{body.symptomes}

HISTORIQUE DE MAINTENANCE:
{body.historique or "Non disponible"}

Produis un diagnostic en JSON STRICT:
{{
    "diagnostic_probable": "description du probleme identifie",
    "causes_possibles": [
        {{"cause": "description", "probabilite": "haute/moyenne/basse", "verification": "comment verifier"}}
    ],
    "urgence": "critique/haute/moyenne/basse",
    "actions_immediates": ["action 1", "action 2"],
    "reparation_recommandee": {{
        "description": "description",
        "complexite": "simple/moyenne/complexe",
        "temps_estime": "duree",
        "competences_requises": ["competence 1"]
    }},
    "pieces_probables": ["piece 1"],
    "cout_estime": {{"pieces": "fourchette", "main_oeuvre": "fourchette", "total": "fourchette"}},
    "prevention": "conseil de prevention"
}}

Reponds UNIQUEMENT avec le JSON, aucun texte avant/apres."""
        model_name = "claude-opus-4-7"
        response = client.messages.create(
            model=model_name,
            max_tokens=32000,
            temperature=0.3,
            system=MAINTENANCE_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text if response.content else ""
        text = text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        try:
            diagnostic = json.loads(text)
        except Exception:
            diagnostic = {"raw": text, "error": "Reponse non-JSON"}
        input_tokens = response.usage.input_tokens if response.usage else 0
        output_tokens = response.usage.output_tokens if response.usage else 0
        cache_creation = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
        # Opus 4.7: $15/M input, $75/M output, $18.75/M cache write, $1.50/M cache read
        cost = (
            input_tokens * 15 / 1_000_000
            + output_tokens * 75 / 1_000_000
            + cache_creation * 18.75 / 1_000_000
            + cache_read * 1.50 / 1_000_000
        ) * 1.30  # 30% markup
        if track_ai_usage:
            try:
                track_ai_usage(user, "maintenance_diagnose", input_tokens, output_tokens,
                               cost_usd=cost, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass
        return {
            "diagnostic": diagnostic,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Maintenance AI diagnose API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Maintenance IA diagnose error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du diagnostic")


@router.post("/maintenance/ia/preventive")
async def ia_maintenance_preventive(
    body: MaintenanceIaPreventiveRequest, user: ErpUser = Depends(get_current_user)
):
    """Plan de maintenance preventive recommande (Claude Opus, JSON)."""
    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=402, detail=error_msg or "Credits IA epuises")
    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")
    client = _get_maintenance_ai_client()
    if not client:
        raise HTTPException(status_code=503, detail="Service IA non configure")
    try:
        prompt = f"""Suggere un plan de maintenance preventive pour cet equipement:

EQUIPEMENT: {body.equipement}
UTILISATION: {body.utilisation}
DERNIERE MAINTENANCE: {body.derniere_maintenance or "Non specifiee"}

Produis un plan en JSON STRICT:
{{
    "plan_maintenance": [
        {{"tache": "description", "frequence": "quotidien/hebdomadaire/mensuel/trimestriel/annuel",
          "duree_estimee": "duree", "competence_requise": "niveau",
          "pieces_consommables": ["piece 1"], "priorite": "haute/moyenne/basse"}}
    ],
    "inspections_recommandees": [
        {{"element": "element", "frequence": "frequence", "points_verification": ["point 1"]}}
    ],
    "pieces_stock_recommandees": ["piece 1"],
    "cout_annuel_estime": "montant",
    "benefices_attendus": ["benefice 1"],
    "alertes_a_configurer": ["alerte 1"]
}}

Reponds UNIQUEMENT avec le JSON."""
        model_name = "claude-opus-4-7"
        response = client.messages.create(
            model=model_name,
            max_tokens=32000,
            temperature=0.3,
            system=MAINTENANCE_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text if response.content else ""
        text = text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        try:
            plan = json.loads(text)
        except Exception:
            plan = {"raw": text, "error": "Reponse non-JSON"}
        input_tokens = response.usage.input_tokens if response.usage else 0
        output_tokens = response.usage.output_tokens if response.usage else 0
        cache_creation = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
        # Opus 4.7: $15/M input, $75/M output, $18.75/M cache write, $1.50/M cache read
        cost = (
            input_tokens * 15 / 1_000_000
            + output_tokens * 75 / 1_000_000
            + cache_creation * 18.75 / 1_000_000
            + cache_read * 1.50 / 1_000_000
        ) * 1.30  # 30% markup
        if track_ai_usage:
            try:
                track_ai_usage(user, "maintenance_preventive", input_tokens, output_tokens,
                               cost_usd=cost, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass
        return {
            "plan": plan,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Maintenance AI preventive API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Maintenance IA preventive error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la generation du plan")


@router.post("/maintenance/ia/analyze-intervention")
async def ia_maintenance_analyze_intervention(
    body: MaintenanceIaAnalyzeInterventionRequest, user: ErpUser = Depends(get_current_user)
):
    """Analyse d'une intervention planifiee (Claude Opus, JSON)."""
    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=402, detail=error_msg or "Credits IA epuises")
    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")
    client = _get_maintenance_ai_client()
    if not client:
        raise HTTPException(status_code=503, detail="Service IA non configure")
    # Si demande_id fourni, on enrichit depuis la BD
    equipement = body.equipement or "Non specifie"
    type_m = body.type_maintenance or "CORRECTIVE"
    description = body.description or ""
    date_planifiee = body.date_planifiee or "Non definie"
    duree = body.duree_estimee or "Non definie"
    priorite = body.priorite or "NORMALE"
    cout_est = body.cout_estime or 0
    if body.demande_id and not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if body.demande_id:
        conn = db.get_conn()
        cursor = None
        try:
            db.set_tenant(conn, user.schema)
            cursor = conn.cursor()
            _ensure_maintenance_tables(cursor)
            cursor.execute(
                "SELECT titre, description, type_maintenance, priorite, date_planifiee, "
                "temps_estime_heures, cout_estime, equipement_type, equipement_id "
                "FROM maintenance_demandes WHERE id = %s",
                (body.demande_id,),
            )
            d = cursor.fetchone()
            if d:
                equipement = f"{d.get('equipement_type', '')} #{d.get('equipement_id', '')}"
                type_m = d.get("type_maintenance") or type_m
                description = d.get("description") or description
                date_planifiee = str(d.get("date_planifiee") or date_planifiee)
                duree = f"{d.get('temps_estime_heures', 0)}h"
                priorite = d.get("priorite") or priorite
                cout_est = float(d.get("cout_estime") or 0)
        finally:
            if cursor:
                cursor.close()
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()
    try:
        prompt = f"""Analyse cette intervention de maintenance:

EQUIPEMENT: {equipement}
INTERVENTION:
- Type: {type_m}
- Description: {description}
- Date prevue: {date_planifiee}
- Duree estimee: {duree}
- Priorite: {priorite}
- Cout estime: {cout_est} $

Produis une analyse en JSON STRICT:
{{
    "score_planification": 0-100,
    "points_positifs": ["point 1"],
    "ameliorations_suggeres": [
        {{"suggestion": "desc", "impact": "impact", "priorite": "haute/moyenne/basse"}}
    ],
    "risques_identifies": ["risque 1"],
    "verification_pre_intervention": ["verification 1"],
    "outils_necessaires": ["outil 1"],
    "mesures_securite": ["mesure 1"],
    "conseil_global": "conseil strategique"
}}

Reponds UNIQUEMENT avec le JSON."""
        model_name = "claude-opus-4-7"
        response = client.messages.create(
            model=model_name,
            max_tokens=32000,
            temperature=0.3,
            system=MAINTENANCE_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text if response.content else ""
        text = text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        try:
            analysis = json.loads(text)
        except Exception:
            analysis = {"raw": text, "error": "Reponse non-JSON"}
        input_tokens = response.usage.input_tokens if response.usage else 0
        output_tokens = response.usage.output_tokens if response.usage else 0
        cache_creation = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
        # Opus 4.7: $15/M input, $75/M output, $18.75/M cache write, $1.50/M cache read
        cost = (
            input_tokens * 15 / 1_000_000
            + output_tokens * 75 / 1_000_000
            + cache_creation * 18.75 / 1_000_000
            + cache_read * 1.50 / 1_000_000
        ) * 1.30  # 30% markup
        if track_ai_usage:
            try:
                track_ai_usage(user, "maintenance_analyze_intervention", input_tokens, output_tokens,
                               cost_usd=cost, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass
        return {
            "analysis": analysis,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Maintenance AI analyze API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Maintenance IA analyze error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'analyse")


@router.post("/maintenance/ia/checklist")
async def ia_maintenance_checklist(
    body: MaintenanceIaChecklistRequest, user: ErpUser = Depends(get_current_user)
):
    """Genere une checklist d'inspection (Claude Sonnet, texte formate)."""
    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=402, detail=error_msg or "Credits IA epuises")
    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")
    client = _get_maintenance_ai_client()
    if not client:
        raise HTTPException(status_code=503, detail="Service IA non configure")
    try:
        prompt = f"""Genere une checklist complete pour cette maintenance:

TYPE DE MAINTENANCE: {body.type_maintenance}
EQUIPEMENT: {body.equipement}

La checklist doit inclure:
1. Preparation (EPI, outils, pieces)
2. Securisation de l'equipement (LOTO si necessaire)
3. Points d'inspection detailles
4. Taches de maintenance a effectuer
5. Verifications post-maintenance
6. Documentation a completer

Formate la checklist de maniere claire avec des cases a cocher (carre vide) et des sections bien identifiees.
Inclus les valeurs de reference (pressions, niveaux, couples de serrage) quand applicable."""
        model_name = "claude-sonnet-4-6"
        response = client.messages.create(
            model=model_name,
            max_tokens=32000,
            temperature=0.3,
            system=MAINTENANCE_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens if response.usage else 0
        output_tokens = response.usage.output_tokens if response.usage else 0
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30
        if track_ai_usage:
            try:
                track_ai_usage(user, "maintenance_checklist", input_tokens, output_tokens,
                               cost_usd=cost, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass
        return {
            "checklist": text,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Maintenance AI checklist API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Maintenance IA checklist error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la generation de checklist")


@router.post("/maintenance/ia/estimate-cost")
async def ia_maintenance_estimate_cost(
    body: MaintenanceIaEstimateCostRequest, user: ErpUser = Depends(get_current_user)
):
    """Estimation couts de reparation (Claude Opus, JSON)."""
    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=402, detail=error_msg or "Credits IA epuises")
    if _check_credits:
        ok, balance = _check_credits(user)
        if not ok:
            raise HTTPException(status_code=402, detail="Credits IA insuffisants")
    client = _get_maintenance_ai_client()
    if not client:
        raise HTTPException(status_code=503, detail="Service IA non configure")
    try:
        prompt = f"""Estime les couts de reparation pour ce probleme:

EQUIPEMENT: {body.equipement}
PROBLEME: {body.probleme}
URGENCE: {body.urgence}

Produis une estimation en JSON STRICT (tous les montants en CAD):
{{
    "estimation_pieces": {{
        "liste": [{{"piece": "nom", "prix_estime": 0, "quantite": 1}}],
        "total_pieces": 0
    }},
    "estimation_main_oeuvre": {{
        "heures_estimees": 0,
        "taux_horaire_moyen": 0,
        "total_main_oeuvre": 0
    }},
    "frais_additionnels": [{{"description": "frais", "montant": 0}}],
    "total_estime": {{"minimum": 0, "maximum": 0, "probable": 0}},
    "delai_estime": "duree",
    "options_alternatives": [
        {{"option": "description", "cout": 0, "avantages": "avantages", "inconvenients": "inconvenients"}}
    ],
    "recommandation": "reparer/remplacer/autre",
    "justification": "explication"
}}

Reponds UNIQUEMENT avec le JSON."""
        model_name = "claude-opus-4-7"
        response = client.messages.create(
            model=model_name,
            max_tokens=32000,
            temperature=0.3,
            system=MAINTENANCE_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text if response.content else ""
        text = text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        try:
            estimate = json.loads(text)
        except Exception:
            estimate = {"raw": text, "error": "Reponse non-JSON"}
        input_tokens = response.usage.input_tokens if response.usage else 0
        output_tokens = response.usage.output_tokens if response.usage else 0
        cache_creation = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
        # Opus 4.7: $15/M input, $75/M output, $18.75/M cache write, $1.50/M cache read
        cost = (
            input_tokens * 15 / 1_000_000
            + output_tokens * 75 / 1_000_000
            + cache_creation * 18.75 / 1_000_000
            + cache_read * 1.50 / 1_000_000
        ) * 1.30  # 30% markup
        if track_ai_usage:
            try:
                track_ai_usage(user, "maintenance_estimate_cost", input_tokens, output_tokens,
                               cost_usd=cost, model=model_name)
            except Exception:
                pass
        if _deduct_credits:
            try:
                _deduct_credits(user, cost)
            except Exception:
                pass
        return {
            "estimate": estimate,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 4),
                "model": model_name,
            },
        }
    except HTTPException:
        raise
    except _AnthropicAPIError as exc:
        status = getattr(exc, "status_code", 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse")
        if status == 529:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge")
        logger.error("Maintenance AI estimate API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur service IA")
    except Exception as exc:
        logger.error("Maintenance IA estimate error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'estimation")


# ============================================
# WEATHER (Meteo)
# ============================================

@router.get("/weather/stations")
async def list_weather_stations(user: ErpUser = Depends(get_current_user)):
    """Return available Quebec weather stations."""
    stations = [
        {"code": "YUL", "name": "Montreal", "lat": 45.5017, "lon": -73.5673},
        {"code": "YQB", "name": "Quebec", "lat": 46.8139, "lon": -71.2080},
        {"code": "YOW", "name": "Gatineau", "lat": 45.4765, "lon": -75.7013},
        {"code": "YQT", "name": "Trois-Rivieres", "lat": 46.3432, "lon": -72.5419},
        {"code": "YSH", "name": "Sherbrooke", "lat": 45.4010, "lon": -71.8884},
        {"code": "YSB", "name": "Saguenay", "lat": 48.4279, "lon": -71.0685},
        {"code": "YRI", "name": "Rimouski", "lat": 48.4489, "lon": -68.5243},
    ]
    return {"stations": stations}


@router.get("/weather/forecast")
async def get_weather_forecast(
    user: ErpUser = Depends(get_current_user),
    lat: float = Query(45.5017),
    lon: float = Query(-73.5673),
):
    """Get weather forecast from Open-Meteo API."""
    try:
        import urllib.request
        import urllib.error
        import json
        url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={lat}&longitude={lon}"
            f"&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max"
            f"&timezone=America/Montreal&forecast_days=7"
        )
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
        daily = data.get("daily", {})
        forecasts = []
        dates = daily.get("time", [])
        for i, date in enumerate(dates):
            forecasts.append({
                "date": date,
                "temp_max": daily.get("temperature_2m_max", [None])[i],
                "temp_min": daily.get("temperature_2m_min", [None])[i],
                "precipitation": daily.get("precipitation_sum", [None])[i],
                "wind_max": daily.get("wind_speed_10m_max", [None])[i],
            })
        return {"forecasts": forecasts, "latitude": lat, "longitude": lon}
    except urllib.error.HTTPError as exc:
        logger.warning("get_weather_forecast upstream %s: %s", exc.code, exc.reason)
        return {"forecasts": [], "error": "Service meteo temporairement indisponible"}
    except Exception as exc:
        logger.error("get_weather_forecast error: %s", exc)
        return {"forecasts": [], "error": "Erreur interne"}


# ============================================
# REAL ESTATE (Immobilier)
# ============================================

@router.get("/realestate/projects")
async def list_realestate_projects(user: ErpUser = Depends(get_current_user)):
    # Try realestate_projects first (newer table), fallback to immo_projets
    # Both tables share the same column names: nom, type_projet, date_debut, date_fin_prevue
    items = _tenant_query(
        user,
        "SELECT id, nom, type_projet, statut, adresse, ville, budget_total, "
        "date_debut, date_fin_prevue, created_at "
        "FROM realestate_projects ORDER BY created_at DESC LIMIT 50",
        table_check="realestate_projects",
    )
    if not items:
        items = _tenant_query(
            user,
            "SELECT id, nom, type_projet, statut, adresse, ville, budget_total, "
            "date_debut, date_fin_prevue, created_at "
            "FROM immo_projets ORDER BY created_at DESC LIMIT 50",
            table_check="immo_projets",
        )
    return {"items": items}


@router.post("/realestate/projects")
async def create_realestate_project(body: RealEstateProjectCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new real estate project."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, """
            CREATE TABLE IF NOT EXISTS realestate_projects (
                id SERIAL PRIMARY KEY,
                nom VARCHAR(255),
                type_projet VARCHAR(50),
                adresse VARCHAR(255),
                ville VARCHAR(100),
                budget_total NUMERIC(14,2),
                date_debut DATE,
                date_fin_prevue DATE,
                statut VARCHAR(30) DEFAULT 'PLANIFIE',
                description TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        cursor.execute(
            "INSERT INTO realestate_projects (nom, type_projet, adresse, ville, budget_total, date_debut, description) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id, nom, statut",
            (body.nom, body.type_projet, body.adresse, body.ville, body.budget_total, body.date_debut, body.description),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "nom": row["nom"], "statut": row["statut"], "message": "Projet immobilier créé"}
    except Exception as exc:
        conn.rollback()
        logger.error("create_realestate_project error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/realestate/projects/{project_id}")
async def get_realestate_project(project_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single real estate project with its units."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Try realestate_projects first, then immo_projets
        project = None
        for table in ("realestate_projects", "immo_projets"):
            try:
                cursor.execute(
                    "SELECT EXISTS (SELECT FROM information_schema.tables "
                    "WHERE table_schema = %s AND table_name = %s)",
                    (user.schema, table),
                )
                if cursor.fetchone().get("exists", False):
                    cursor.execute(f"SELECT * FROM {table} WHERE id = %s", (project_id,))
                    row = cursor.fetchone()
                    if row:
                        project = _serialize_row(row)
                        break
            except Exception:
                pass
        if not project:
            raise HTTPException(status_code=404, detail="Projet introuvable")
        # Try to get units
        units = []
        for units_table in ("realestate_units", "immo_unites"):
            try:
                cursor.execute(
                    "SELECT EXISTS (SELECT FROM information_schema.tables "
                    "WHERE table_schema = %s AND table_name = %s)",
                    (user.schema, units_table),
                )
                if cursor.fetchone().get("exists", False):
                    cursor.execute(f"SELECT * FROM {units_table} WHERE project_id = %s", (project_id,))
                    units = [_serialize_row(r) for r in cursor.fetchall()]
                    break
            except Exception:
                pass
        return {"project": project, "units": units}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_realestate_project error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/realestate/projects/{project_id}/units")
async def create_unit(project_id: int, body: UnitCreate, user: ErpUser = Depends(get_current_user)):
    """Create a unit within a real estate project."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_table(cursor, """
            CREATE TABLE IF NOT EXISTS realestate_units (
                id SERIAL PRIMARY KEY,
                project_id INT,
                numero VARCHAR(20),
                type_unite VARCHAR(30) DEFAULT 'CONDO',
                superficie_m2 NUMERIC(10,2),
                prix_vente NUMERIC(14,2),
                statut VARCHAR(30) DEFAULT 'DISPONIBLE',
                acheteur_nom VARCHAR(255),
                date_vente DATE,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        cursor.execute(
            "INSERT INTO realestate_units (project_id, numero, type_unite, superficie_m2, prix_vente, statut) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id, numero, statut",
            (project_id, body.numero, body.type_unite, body.superficie_m2, body.prix_vente, body.statut),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "numero": row["numero"], "statut": row["statut"], "message": "Unité créée"}
    except Exception as exc:
        conn.rollback()
        logger.error("create_unit error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/realestate/statistics")
async def get_realestate_stats(user: ErpUser = Depends(get_current_user)):
    """Return real estate statistics."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        stats = {
            "total_projets": 0,
            "total_unites": 0,
            "unites_vendues": 0,
            "budget_total": 0,
            "ca_total_ventes": 0,
        }
        # Check projects table (realestate_projects or immo_projets)
        for proj_table in ("realestate_projects", "immo_projets"):
            cursor.execute(
                "SELECT EXISTS (SELECT FROM information_schema.tables "
                "WHERE table_schema = %s AND table_name = %s)",
                (user.schema, proj_table),
            )
            if cursor.fetchone().get("exists", False):
                cursor.execute(f"SELECT COUNT(*) as cnt FROM {proj_table}")
                stats["total_projets"] = cursor.fetchone()["cnt"]
                try:
                    cursor.execute(f"SELECT COALESCE(SUM(budget_total), 0) as bt FROM {proj_table}")
                    stats["budget_total"] = float(cursor.fetchone()["bt"])
                except Exception:
                    pass
                break
        # Check units table (realestate_units or immo_unites)
        for units_table in ("realestate_units", "immo_unites"):
            cursor.execute(
                "SELECT EXISTS (SELECT FROM information_schema.tables "
                "WHERE table_schema = %s AND table_name = %s)",
                (user.schema, units_table),
            )
            if cursor.fetchone().get("exists", False):
                cursor.execute(f"SELECT COUNT(*) as cnt FROM {units_table}")
                stats["total_unites"] = cursor.fetchone()["cnt"]
                try:
                    cursor.execute(
                        f"SELECT COUNT(*) as cnt FROM {units_table} WHERE statut = 'VENDU'"
                    )
                    stats["unites_vendues"] = cursor.fetchone()["cnt"]
                except Exception:
                    pass
                try:
                    cursor.execute(
                        f"SELECT COALESCE(SUM(prix_vente), 0) as ca FROM {units_table} WHERE statut = 'VENDU'"
                    )
                    stats["ca_total_ventes"] = float(cursor.fetchone()["ca"])
                except Exception:
                    pass
                break
        return stats
    except Exception as exc:
        logger.error("get_realestate_stats error: %s", exc)
        return {
            "total_projets": 0, "total_unites": 0, "unites_vendues": 0,
            "budget_total": 0, "ca_total_ventes": 0, "error": "Erreur interne",
        }
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()
