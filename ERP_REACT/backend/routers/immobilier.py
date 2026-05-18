"""
ERP React - Immobilier (Real Estate) Router
Terrains, projets immobiliers, financement, unites, inspections, paiements.
Gestion complete du cycle immobilier pour la construction.

Includes: deblocages, phases de construction, commercialisation, livraisons,
documents, calculateurs financiers, et integration IA (Claude).
"""

import asyncio
import os
import json
import logging
import random
import string
import math
import threading
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from typing import Optional, List

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
except ImportError:
    anthropic = None

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/immobilier", tags=["Immobilier"])


def _gen_numero(prefix: str, k: int = 5) -> str:
    """Generate a reference number like TER-12345. Caller should retry on UNIQUE collision."""
    return f"{prefix}-{''.join(random.choices(string.digits, k=k))}"


def _empty_to_none(v):
    """Convert empty strings to None — used on date fields to avoid PostgreSQL
    'invalid input syntax for type date: ""' errors when frontend sends blank dates."""
    return None if isinstance(v, str) and v.strip() == "" else v


# ============================================
# PYDANTIC MODELS
# ============================================

def _strip_non_empty(v):
    """Strip whitespace and reject empty strings. Passes None through.
    Used by required-name validators to block `""`/`"   "` inputs."""
    if v is None:
        return v
    v = str(v).strip()
    if not v:
        raise ValueError("Ne peut pas etre vide")
    return v


class TerrainCreate(BaseModel):
    # `adresse` is NOT NULL on the DB side — enforce it here so the client
    # gets a 422 instead of a 500 from the INSERT.
    adresse: str
    ville: Optional[str] = None
    code_postal: Optional[str] = None
    superficie_m2: Optional[float] = None
    zonage: Optional[str] = None
    proprietaire_nom: Optional[str] = None
    proprietaire_contact: Optional[str] = None
    prix_demande: Optional[float] = None
    prix_offre: Optional[float] = None
    evaluation_municipale: Optional[float] = None
    notes: Optional[str] = None
    statut: str = "Prospection"
    # New enriched fields
    numero_lot: Optional[str] = None
    numero_cadastre: Optional[str] = None
    superficie_pi2: Optional[float] = None
    potentiel_construction: Optional[str] = None
    prix_final: Optional[float] = None
    date_offre: Optional[str] = None
    date_acquisition: Optional[str] = None
    evaluation_marchande: Optional[float] = None
    score_faisabilite: Optional[int] = None
    servitudes: Optional[str] = None
    contraintes_environnementales: Optional[str] = None
    acces_services: Optional[str] = None
    certificat_localisation: Optional[bool] = None
    etude_sol: Optional[bool] = None
    permis_preliminaire: Optional[bool] = None

    _adresse_validator = field_validator("adresse", mode="before")(_strip_non_empty)
    _empty_dates = field_validator("date_offre", "date_acquisition", mode="before")(_empty_to_none)


class TerrainUpdate(BaseModel):
    adresse: Optional[str] = None
    ville: Optional[str] = None
    code_postal: Optional[str] = None
    superficie_m2: Optional[float] = None
    zonage: Optional[str] = None
    proprietaire_nom: Optional[str] = None
    proprietaire_contact: Optional[str] = None
    prix_demande: Optional[float] = None
    prix_offre: Optional[float] = None
    evaluation_municipale: Optional[float] = None
    notes: Optional[str] = None
    statut: Optional[str] = None
    # New enriched fields
    numero_lot: Optional[str] = None
    numero_cadastre: Optional[str] = None
    superficie_pi2: Optional[float] = None
    potentiel_construction: Optional[str] = None
    prix_final: Optional[float] = None
    date_offre: Optional[str] = None
    date_acquisition: Optional[str] = None
    evaluation_marchande: Optional[float] = None
    score_faisabilite: Optional[int] = None
    servitudes: Optional[str] = None
    contraintes_environnementales: Optional[str] = None
    acces_services: Optional[str] = None
    certificat_localisation: Optional[bool] = None
    etude_sol: Optional[bool] = None
    permis_preliminaire: Optional[bool] = None

    _empty_dates = field_validator("date_offre", "date_acquisition", mode="before")(_empty_to_none)


class ProjetCreate(BaseModel):
    nom_projet: str
    terrain_id: Optional[int] = None
    type_projet: Optional[str] = None
    nombre_logements: int = 0
    budget_total: float = 0
    cout_terrain: float = 0
    cout_construction: float = 0
    revenus_ventes_estimes: float = 0
    roi_estime_pct: float = 0
    date_debut_planifiee: Optional[str] = None
    date_fin_planifiee: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    statut: str = "Planification"

    _empty_dates = field_validator("date_debut_planifiee", "date_fin_planifiee", mode="before")(_empty_to_none)


class ProjetUpdate(BaseModel):
    nom_projet: Optional[str] = None
    terrain_id: Optional[int] = None
    type_projet: Optional[str] = None
    nombre_logements: Optional[int] = None
    budget_total: Optional[float] = None
    cout_terrain: Optional[float] = None
    cout_construction: Optional[float] = None
    revenus_ventes_estimes: Optional[float] = None
    roi_estime_pct: Optional[float] = None
    date_debut_planifiee: Optional[str] = None
    date_fin_planifiee: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    statut: Optional[str] = None

    _empty_dates = field_validator("date_debut_planifiee", "date_fin_planifiee", mode="before")(_empty_to_none)


class FinancementCreate(BaseModel):
    projet_id: Optional[int] = None
    banque: Optional[str] = None
    type_pret: Optional[str] = None
    montant_demande: float = 0
    montant_approuve: float = 0
    taux_interet_annuel: float = 0
    duree_amortissement_annees: int = 25
    mise_de_fonds_pct: float = 0
    mise_de_fonds_montant: float = 0
    date_demande: Optional[str] = None
    date_approbation: Optional[str] = None
    notes: Optional[str] = None
    statut: str = "En preparation"
    # New enriched fields
    conseiller_nom: Optional[str] = None
    conseiller_contact: Optional[str] = None
    taux_type: Optional[str] = None
    frequence_paiement: Optional[str] = None
    garanties_requises: Optional[str] = None
    assurance_pret_schl: Optional[bool] = None
    prime_schl_pct: Optional[float] = None
    prime_schl_montant: Optional[float] = None
    ratio_pret_valeur_pct: Optional[float] = None
    ratio_couverture_dette: Optional[float] = None
    test_resistance_taux: Optional[float] = None
    financement_progressif: Optional[bool] = True
    calendrier_deblocages: Optional[str] = None
    interets_intercalaires_estimes: Optional[float] = None
    frais_evaluation: Optional[float] = None
    frais_notaire: Optional[float] = None
    frais_ouverture: Optional[float] = None
    autres_frais: Optional[float] = None
    date_deblocage_initial: Optional[str] = None
    date_echeance: Optional[str] = None

    _empty_dates = field_validator(
        "date_demande", "date_approbation", "date_deblocage_initial", "date_echeance",
        mode="before",
    )(_empty_to_none)


class FinancementUpdate(BaseModel):
    projet_id: Optional[int] = None
    banque: Optional[str] = None
    type_pret: Optional[str] = None
    montant_demande: Optional[float] = None
    montant_approuve: Optional[float] = None
    taux_interet_annuel: Optional[float] = None
    duree_amortissement_annees: Optional[int] = None
    mise_de_fonds_pct: Optional[float] = None
    mise_de_fonds_montant: Optional[float] = None
    date_demande: Optional[str] = None
    date_approbation: Optional[str] = None
    notes: Optional[str] = None
    statut: Optional[str] = None
    # New enriched fields
    conseiller_nom: Optional[str] = None
    conseiller_contact: Optional[str] = None
    taux_type: Optional[str] = None
    frequence_paiement: Optional[str] = None
    garanties_requises: Optional[str] = None
    assurance_pret_schl: Optional[bool] = None
    prime_schl_pct: Optional[float] = None
    prime_schl_montant: Optional[float] = None
    ratio_pret_valeur_pct: Optional[float] = None
    ratio_couverture_dette: Optional[float] = None
    test_resistance_taux: Optional[float] = None
    financement_progressif: Optional[bool] = None
    calendrier_deblocages: Optional[str] = None
    interets_intercalaires_estimes: Optional[float] = None
    frais_evaluation: Optional[float] = None
    frais_notaire: Optional[float] = None
    frais_ouverture: Optional[float] = None
    autres_frais: Optional[float] = None
    date_deblocage_initial: Optional[str] = None
    date_echeance: Optional[str] = None

    _empty_dates = field_validator(
        "date_demande", "date_approbation", "date_deblocage_initial", "date_echeance",
        mode="before",
    )(_empty_to_none)


class UniteCreate(BaseModel):
    projet_id: int
    numero_unite: Optional[str] = None
    type_unite: str = "Condo"
    superficie_m2: Optional[float] = None
    nombre_chambres: int = 0
    nombre_salles_bain: int = 0
    etage: Optional[int] = None
    prix_vente: float = 0
    loyer_mensuel: float = 0
    statut: str = "Disponible"
    acheteur_nom: Optional[str] = None
    date_vente_finale: Optional[str] = None
    notes: Optional[str] = None
    # New enriched fields
    sous_type: Optional[str] = None
    superficie_pi2: Optional[float] = None
    orientation: Optional[str] = None
    acheteur_contact: Optional[str] = None
    date_promesse_achat: Optional[str] = None
    locataire_nom: Optional[str] = None
    date_debut_bail: Optional[str] = None
    duree_bail_mois: Optional[int] = None
    equipements: Optional[str] = None
    finitions_speciales: Optional[str] = None

    _empty_dates = field_validator(
        "date_vente_finale", "date_promesse_achat", "date_debut_bail",
        mode="before",
    )(_empty_to_none)


class UniteUpdate(BaseModel):
    numero_unite: Optional[str] = None
    type_unite: Optional[str] = None
    superficie_m2: Optional[float] = None
    nombre_chambres: Optional[int] = None
    nombre_salles_bain: Optional[int] = None
    etage: Optional[int] = None
    prix_vente: Optional[float] = None
    loyer_mensuel: Optional[float] = None
    statut: Optional[str] = None
    acheteur_nom: Optional[str] = None
    date_vente_finale: Optional[str] = None
    notes: Optional[str] = None
    # New enriched fields
    sous_type: Optional[str] = None
    superficie_pi2: Optional[float] = None
    orientation: Optional[str] = None
    acheteur_contact: Optional[str] = None
    date_promesse_achat: Optional[str] = None
    locataire_nom: Optional[str] = None
    date_debut_bail: Optional[str] = None
    duree_bail_mois: Optional[int] = None
    equipements: Optional[str] = None
    finitions_speciales: Optional[str] = None

    _empty_dates = field_validator(
        "date_vente_finale", "date_promesse_achat", "date_debut_bail",
        mode="before",
    )(_empty_to_none)


class InspectionCreate(BaseModel):
    projet_id: Optional[int] = None
    type_inspection: Optional[str] = None
    date_planifiee: Optional[str] = None
    date_realisee: Optional[str] = None
    inspecteur_nom: Optional[str] = None
    statut: str = "Planifiee"
    resultat: Optional[str] = None
    nombre_deficiences: int = 0
    notes: Optional[str] = None
    # New enriched fields
    phase_id: Optional[int] = None
    unite_id: Optional[int] = None
    categorie: Optional[str] = None
    inspecteur_organisme: Optional[str] = None
    inspecteur_numero_permis: Optional[str] = None
    inspecteur_contact: Optional[str] = None
    score_conformite: Optional[int] = None
    deficiences_mineures: Optional[int] = 0
    deficiences_majeures: Optional[int] = 0
    deficiences_critiques: Optional[int] = 0
    liste_deficiences: Optional[str] = None
    corrections_requises: Optional[bool] = None
    date_limite_corrections: Optional[str] = None
    corrections_effectuees: Optional[bool] = None
    date_corrections: Optional[str] = None
    reinspection_requise: Optional[bool] = None
    date_reinspection: Optional[str] = None
    reinspection_reussie: Optional[bool] = None
    rapport_inspection: Optional[str] = None
    photos_jointes: Optional[bool] = None
    certificat_emis: Optional[bool] = None
    numero_certificat: Optional[str] = None
    conforme_cnb: Optional[bool] = None
    conforme_cce: Optional[bool] = None
    conforme_csst: Optional[bool] = None
    conforme_municipal: Optional[bool] = None
    cout_inspection: Optional[float] = None
    cout_corrections: Optional[float] = None

    _empty_dates = field_validator(
        "date_planifiee", "date_realisee", "date_limite_corrections",
        "date_corrections", "date_reinspection",
        mode="before",
    )(_empty_to_none)


class InspectionUpdate(BaseModel):
    projet_id: Optional[int] = None
    type_inspection: Optional[str] = None
    date_planifiee: Optional[str] = None
    date_realisee: Optional[str] = None
    inspecteur_nom: Optional[str] = None
    statut: Optional[str] = None
    resultat: Optional[str] = None
    nombre_deficiences: Optional[int] = None
    notes: Optional[str] = None
    # New enriched fields
    phase_id: Optional[int] = None
    unite_id: Optional[int] = None
    categorie: Optional[str] = None
    inspecteur_organisme: Optional[str] = None
    inspecteur_numero_permis: Optional[str] = None
    inspecteur_contact: Optional[str] = None
    score_conformite: Optional[int] = None
    deficiences_mineures: Optional[int] = None
    deficiences_majeures: Optional[int] = None
    deficiences_critiques: Optional[int] = None
    liste_deficiences: Optional[str] = None
    corrections_requises: Optional[bool] = None
    date_limite_corrections: Optional[str] = None
    corrections_effectuees: Optional[bool] = None
    date_corrections: Optional[str] = None
    reinspection_requise: Optional[bool] = None
    date_reinspection: Optional[str] = None
    reinspection_reussie: Optional[bool] = None
    rapport_inspection: Optional[str] = None
    photos_jointes: Optional[bool] = None
    certificat_emis: Optional[bool] = None
    numero_certificat: Optional[str] = None
    conforme_cnb: Optional[bool] = None
    conforme_cce: Optional[bool] = None
    conforme_csst: Optional[bool] = None
    conforme_municipal: Optional[bool] = None
    cout_inspection: Optional[float] = None
    cout_corrections: Optional[float] = None

    _empty_dates = field_validator(
        "date_planifiee", "date_realisee", "date_limite_corrections",
        "date_corrections", "date_reinspection",
        mode="before",
    )(_empty_to_none)


class PaiementCreate(BaseModel):
    projet_id: Optional[int] = None
    type_paiement: Optional[str] = None
    categorie: str = "Depense"
    montant: float = 0
    description: Optional[str] = None
    beneficiaire: Optional[str] = None
    date_paiement: Optional[str] = None
    statut: str = "Prevu"
    notes: Optional[str] = None

    _empty_dates = field_validator("date_paiement", mode="before")(_empty_to_none)


class MensualiteRequest(BaseModel):
    capital: float
    taux_annuel: float
    duree_annees: int


# --- New CRUD models ---

class DeblocageCreate(BaseModel):
    financement_id: int
    etape_construction: Optional[str] = None
    pourcentage_etape: Optional[float] = None
    montant_prevu: Optional[float] = None
    date_prevue: Optional[str] = None
    notes: Optional[str] = None

    _empty_dates = field_validator("date_prevue", mode="before")(_empty_to_none)


class DeblocageUpdate(BaseModel):
    etape_construction: Optional[str] = None
    pourcentage_etape: Optional[float] = None
    montant_prevu: Optional[float] = None
    montant_reel: Optional[float] = None
    statut: Optional[str] = None
    date_prevue: Optional[str] = None
    date_demande: Optional[str] = None
    date_approbation: Optional[str] = None
    date_deblocage: Optional[str] = None
    inspection_requise: Optional[bool] = None
    inspection_effectuee: Optional[bool] = None
    date_inspection: Optional[str] = None
    rapport_inspection: Optional[str] = None
    notes: Optional[str] = None

    _empty_dates = field_validator(
        "date_prevue", "date_demande", "date_approbation", "date_deblocage", "date_inspection",
        mode="before",
    )(_empty_to_none)


class PhaseConstructionCreate(BaseModel):
    projet_id: int
    nom_phase: str
    numero_phase: Optional[int] = 1
    statut: Optional[str] = "A venir"
    pourcentage_completion: Optional[float] = 0
    date_debut_prevue: Optional[str] = None
    date_fin_prevue: Optional[str] = None
    budget_prevu: Optional[float] = None
    inspection_requise: Optional[bool] = True
    conforme_cnb: Optional[bool] = None
    materiaux_commandes: Optional[bool] = False
    materiaux_recus: Optional[bool] = False
    retards_jours: Optional[int] = 0
    raison_retard: Optional[str] = None
    notes: Optional[str] = None

    _empty_dates = field_validator(
        "date_debut_prevue", "date_fin_prevue",
        mode="before",
    )(_empty_to_none)


class PhaseConstructionUpdate(BaseModel):
    nom_phase: Optional[str] = None
    numero_phase: Optional[int] = None
    statut: Optional[str] = None
    pourcentage_completion: Optional[float] = None
    date_debut_prevue: Optional[str] = None
    date_debut_reelle: Optional[str] = None
    date_fin_prevue: Optional[str] = None
    date_fin_reelle: Optional[str] = None
    budget_prevu: Optional[float] = None
    cout_reel: Optional[float] = None
    inspection_requise: Optional[bool] = None
    inspection_approuvee: Optional[bool] = None
    conforme_cnb: Optional[bool] = None
    materiaux_commandes: Optional[bool] = None
    materiaux_recus: Optional[bool] = None
    retards_jours: Optional[int] = None
    raison_retard: Optional[str] = None
    problemes_rencontres: Optional[str] = None
    notes: Optional[str] = None

    _empty_dates = field_validator(
        "date_debut_prevue", "date_debut_reelle", "date_fin_prevue", "date_fin_reelle",
        mode="before",
    )(_empty_to_none)


class CommercialisationCreate(BaseModel):
    projet_id: int
    strategie_vente: Optional[str] = None
    prix_moyen_vente: Optional[float] = None
    loyer_moyen: Optional[float] = None
    objectif_pre_ventes_pct: Optional[float] = None
    budget_marketing: Optional[float] = None
    site_web: Optional[str] = None
    courtier_nom: Optional[str] = None
    commission_courtier_pct: Optional[float] = None
    date_lancement: Optional[str] = None
    date_journee_portes_ouvertes: Optional[str] = None
    brochure_prete: Optional[bool] = None
    plans_vente_prets: Optional[bool] = None
    maquette_3d: Optional[bool] = None
    notes: Optional[str] = None

    _empty_dates = field_validator(
        "date_lancement", "date_journee_portes_ouvertes",
        mode="before",
    )(_empty_to_none)


class CommercialisationUpdate(BaseModel):
    strategie_vente: Optional[str] = None
    prix_moyen_vente: Optional[float] = None
    loyer_moyen: Optional[float] = None
    objectif_pre_ventes_pct: Optional[float] = None
    budget_marketing: Optional[float] = None
    site_web: Optional[str] = None
    courtier_nom: Optional[str] = None
    commission_courtier_pct: Optional[float] = None
    date_lancement: Optional[str] = None
    date_journee_portes_ouvertes: Optional[str] = None
    brochure_prete: Optional[bool] = None
    plans_vente_prets: Optional[bool] = None
    maquette_3d: Optional[bool] = None
    notes: Optional[str] = None
    statut: Optional[str] = None
    nombre_unites_vendues: Optional[int] = None
    nombre_unites_louees: Optional[int] = None
    taux_pre_ventes_actuel_pct: Optional[float] = None
    cout_marketing_reel: Optional[float] = None

    _empty_dates = field_validator(
        "date_lancement", "date_journee_portes_ouvertes",
        mode="before",
    )(_empty_to_none)


class LivraisonCreate(BaseModel):
    unite_id: int
    projet_id: int
    beneficiaire_nom: Optional[str] = None
    beneficiaire_type: Optional[str] = "Acheteur"
    date_livraison_prevue: Optional[str] = None
    inspection_pre_livraison: Optional[bool] = False
    liste_deficiences: Optional[str] = None
    deficiences_corrigees: Optional[bool] = False
    cles_remises: Optional[bool] = False
    acte_vente_signe: Optional[bool] = False
    bail_signe: Optional[bool] = False
    manuel_copropriete: Optional[bool] = False
    plans_conformes: Optional[bool] = False
    certificat_conformite: Optional[bool] = False
    garantie_legale_vice_cache: Optional[bool] = True
    garantie_gcr: Optional[bool] = False
    duree_garantie_mois: Optional[int] = None
    note_satisfaction: Optional[int] = None
    commentaires_client: Optional[str] = None
    notes: Optional[str] = None

    _empty_dates = field_validator("date_livraison_prevue", mode="before")(_empty_to_none)


class LivraisonUpdate(BaseModel):
    beneficiaire_nom: Optional[str] = None
    beneficiaire_type: Optional[str] = None
    date_livraison_prevue: Optional[str] = None
    date_livraison_reelle: Optional[str] = None
    inspection_pre_livraison: Optional[bool] = None
    inspection_reussie: Optional[bool] = None
    liste_deficiences: Optional[str] = None
    deficiences_corrigees: Optional[bool] = None
    cles_remises: Optional[bool] = None
    acte_vente_signe: Optional[bool] = None
    bail_signe: Optional[bool] = None
    manuel_copropriete: Optional[bool] = None
    plans_conformes: Optional[bool] = None
    certificat_conformite: Optional[bool] = None
    garantie_legale_vice_cache: Optional[bool] = None
    garantie_gcr: Optional[bool] = None
    duree_garantie_mois: Optional[int] = None
    note_satisfaction: Optional[int] = None
    commentaires_client: Optional[str] = None
    statut: Optional[str] = None
    notes: Optional[str] = None

    _empty_dates = field_validator(
        "date_livraison_prevue", "date_livraison_reelle",
        mode="before",
    )(_empty_to_none)


class DocumentCreate(BaseModel):
    projet_id: int
    nom_document: str
    categorie: Optional[str] = None
    type_fichier: Optional[str] = None
    description: Optional[str] = None
    chemin_fichier: Optional[str] = None
    taille_kb: Optional[int] = None
    confidentiel: Optional[bool] = False
    date_document: Optional[str] = None
    date_expiration: Optional[str] = None
    notes: Optional[str] = None

    _empty_dates = field_validator(
        "date_document", "date_expiration",
        mode="before",
    )(_empty_to_none)


# --- Calculator models ---

class AmortissementRequest(BaseModel):
    capital: float
    taux_annuel: float
    duree_annees: int
    frequence: str = "Mensuel"


class InteretsIntercalairesRequest(BaseModel):
    montant_emprunte: float
    taux_annuel: float
    duree_construction_mois: int


class PrimeSCHLRequest(BaseModel):
    montant_pret: float
    valeur_propriete: float


class RoiRequest(BaseModel):
    investissement_total: float
    revenus_annuels: float
    depenses_annuelles: float
    duree_annees: int = 5


class CoutTotalRequest(BaseModel):
    capital: float
    taux_annuel: float
    duree_annees: int


# --- AI models ---

class IaChatRequest(BaseModel):
    question: str
    context: Optional[str] = None


class IaOptimisationRequest(BaseModel):
    cout_total_projet: float
    revenus_annuels: float
    nombre_unites: int
    type_projet: str = "location"


# ============================================
# TABLE INITIALIZATION (defensive migration)
# ============================================

# Cache process-global des schemas deja initialises. Sans ce cache, chaque
# requete sur les 24 endpoints immobilier executait des ALTER TABLE ADD COLUMN
# IF NOT EXISTS + CREATE INDEX IF NOT EXISTS qui prennent des AccessExclusive
# Lock. Deux requetes concurrentes deadlockaient (Process A waits for
# AccessShareLock blocked by Process B doing AccessExclusiveLock, et vice-
# versa). Avec ce cache, le DDL ne tourne qu'une fois par worker x schema.
_IMMO_ENSURED_SCHEMAS: set = set()
_IMMO_ENSURED_LOCK = threading.Lock()


def _ensure_immo_tables(cursor):
    """Create immobilier tables if they don't exist. Idempotent + memoized.

    Memoized par (worker process, schema). Une fois qu'un schema a ete
    initialise, les appels suivants sont des no-op pour eviter le deadlock
    cause par des ALTER TABLE concurrents.

    Les SAVEPOINT utilises plus bas (via _run_in_savepoint) exigent un bloc
    transactionnel. psycopg2 pool peut retourner des connexions en
    autocommit=True (lecon #122) — dans ce mode SAVEPOINT echoue avec
    "SAVEPOINT can only be used in transaction blocks".

    On bascule temporairement en autocommit=False, on commit les DDL a la fin,
    et on restaure l'etat d'origine pour ne pas polluer le pool psycopg2.
    """
    conn = cursor.connection

    # Detecter le schema courant pour la cle de cache.
    schema_key = None
    try:
        cursor.execute("SELECT current_schema()")
        row = cursor.fetchone()
        if row:
            schema_key = row[0] if not isinstance(row, dict) else row.get("current_schema")
    except Exception:
        schema_key = None

    if schema_key:
        with _IMMO_ENSURED_LOCK:
            if schema_key in _IMMO_ENSURED_SCHEMAS:
                return  # deja initialise pour ce schema dans ce worker

    prev_autocommit = None
    try:
        prev_autocommit = conn.autocommit
    except Exception:
        pass

    try:
        if prev_autocommit:
            try:
                conn.autocommit = False
            except Exception:
                pass

        # Serialiser les DDL concurrents inter-workers via advisory lock pour
        # le premier worker qui touche un schema. Sans ce lock, si le cache
        # est froid sur 2 workers en meme temps, ils relancent en parallele
        # les ALTER TABLE et redeadlockent. pg_advisory_xact_lock est libere
        # automatiquement au commit.
        if schema_key:
            try:
                cursor.execute(
                    "SELECT pg_advisory_xact_lock(hashtext(%s))",
                    (f"{schema_key}:immo_ensure",),
                )
            except Exception as lock_exc:
                # Si l'advisory lock echoue, on log et on continue sans
                # serialisation. Le risque de deadlock revient mais le cache
                # process-global limite l'impact aux premieres requetes.
                logger.warning("immobilier: pg_advisory_xact_lock failed for %s: %s",
                               schema_key, lock_exc)

            # Double-checked locking : re-verifier le cache APRES avoir acquis
            # le lock. Si un autre thread/worker a fait le DDL pendant qu'on
            # attendait le lock, on peut sauter le travail. Sans ce check,
            # les N waiters refont tous le DDL serialise (correct mais
            # gaspille parsing/catalog scans sur cold start).
            with _IMMO_ENSURED_LOCK:
                if schema_key in _IMMO_ENSURED_SCHEMAS:
                    try:
                        conn.commit()  # libere le lock pris ci-dessus
                    except Exception:
                        pass
                    return

        _run_immo_tables_ddl(cursor)

        # Committer les DDL immediatement pour (1) garantir la visibilite aux
        # autres workers et (2) liberer le verrou de transaction avant de
        # restaurer autocommit.
        try:
            conn.commit()
            if schema_key:
                with _IMMO_ENSURED_LOCK:
                    _IMMO_ENSURED_SCHEMAS.add(schema_key)
        except Exception as commit_exc:
            # Double-fault logging: si le rollback echoue aussi, on veut savoir
            # pourquoi (connexion fermee, transaction corrompue, etc.) pour ne
            # pas masquer un probleme d'infrastructure.
            try:
                conn.rollback()
            except Exception as rollback_exc:
                logger.error(
                    "immobilier: commit AND rollback failed. "
                    "commit=%s | rollback=%s",
                    commit_exc, rollback_exc,
                )
            raise
    finally:
        # Restaurer l'etat d'origine pour ne pas polluer le pool.
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception as restore_exc:
                # Log explicite: si la restauration echoue (connexion fermee,
                # transaction aborted), la connexion ne devrait PAS etre retournee
                # au pool dans un etat incoherent. L'endpoint appelant fera
                # conn.close() dans son finally, ce qui la retire du pool.
                logger.warning(
                    "immobilier: restore conn.autocommit=%s failed: %s",
                    prev_autocommit, restore_exc,
                )


def _run_immo_tables_ddl(cursor):
    """Body interne de _ensure_immo_tables. Extrait pour permettre l'encadrement
    autocommit/commit/restore sans reecrire toute la logique DDL."""

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS immo_terrains (
            id SERIAL PRIMARY KEY,
            numero_dossier TEXT UNIQUE,
            statut TEXT DEFAULT 'Prospection',
            adresse TEXT,
            ville TEXT,
            code_postal TEXT,
            superficie_m2 NUMERIC,
            zonage TEXT,
            proprietaire_nom TEXT,
            proprietaire_contact TEXT,
            prix_demande NUMERIC,
            prix_offre NUMERIC,
            evaluation_municipale NUMERIC,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS immo_projets (
            id SERIAL PRIMARY KEY,
            numero_projet TEXT UNIQUE,
            nom_projet TEXT NOT NULL,
            statut TEXT DEFAULT 'Planification',
            terrain_id INTEGER,
            type_projet TEXT,
            nombre_logements INTEGER DEFAULT 0,
            budget_total NUMERIC DEFAULT 0,
            cout_terrain NUMERIC DEFAULT 0,
            cout_construction NUMERIC DEFAULT 0,
            revenus_ventes_estimes NUMERIC DEFAULT 0,
            roi_estime_pct NUMERIC DEFAULT 0,
            date_debut_planifiee DATE,
            date_fin_planifiee DATE,
            description TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS immo_financement (
            id SERIAL PRIMARY KEY,
            projet_id INTEGER,
            numero_financement TEXT UNIQUE,
            statut TEXT DEFAULT 'En preparation',
            banque TEXT,
            type_pret TEXT,
            montant_demande NUMERIC DEFAULT 0,
            montant_approuve NUMERIC DEFAULT 0,
            taux_interet_annuel NUMERIC DEFAULT 0,
            duree_amortissement_annees INTEGER DEFAULT 25,
            mise_de_fonds_pct NUMERIC DEFAULT 0,
            mise_de_fonds_montant NUMERIC DEFAULT 0,
            date_demande DATE,
            date_approbation DATE,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS immo_unites (
            id SERIAL PRIMARY KEY,
            projet_id INTEGER NOT NULL,
            numero_unite TEXT,
            type_unite TEXT DEFAULT 'Condo',
            superficie_m2 NUMERIC,
            nombre_chambres INTEGER DEFAULT 0,
            nombre_salles_bain INTEGER DEFAULT 0,
            etage INTEGER,
            prix_vente NUMERIC DEFAULT 0,
            loyer_mensuel NUMERIC DEFAULT 0,
            statut TEXT DEFAULT 'Disponible',
            acheteur_nom TEXT,
            date_vente_finale DATE,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS immo_inspections (
            id SERIAL PRIMARY KEY,
            projet_id INTEGER,
            type_inspection TEXT,
            date_planifiee DATE,
            date_realisee DATE,
            inspecteur_nom TEXT,
            statut TEXT DEFAULT 'Planifiee',
            resultat TEXT,
            nombre_deficiences INTEGER DEFAULT 0,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS immo_paiements (
            id SERIAL PRIMARY KEY,
            projet_id INTEGER,
            type_paiement TEXT,
            categorie TEXT DEFAULT 'Depense',
            montant NUMERIC DEFAULT 0,
            description TEXT,
            beneficiaire TEXT,
            date_paiement DATE,
            statut TEXT DEFAULT 'Prevu',
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Defensive column migrations (tables may pre-exist without newer columns).
    # MUST match every non-PK column in the CREATE TABLE above, otherwise
    # tenants with legacy schemas will fail on INSERT.
    for col, typedef in [
        ("numero_projet", "TEXT"),
        ("nom_projet", "TEXT DEFAULT ''"),
        ("statut", "TEXT DEFAULT 'Planification'"),
        ("terrain_id", "INTEGER"),
        ("type_projet", "TEXT"),
        ("nombre_logements", "INTEGER DEFAULT 0"),
        ("budget_total", "NUMERIC DEFAULT 0"),
        ("cout_terrain", "NUMERIC DEFAULT 0"),
        ("cout_construction", "NUMERIC DEFAULT 0"),
        ("revenus_ventes_estimes", "NUMERIC DEFAULT 0"),
        ("roi_estime_pct", "NUMERIC DEFAULT 0"),
        ("date_debut_planifiee", "DATE"),
        ("date_fin_planifiee", "DATE"),
        ("description", "TEXT"),
        ("notes", "TEXT"),
        ("created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("created_by", "TEXT"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE immo_projets ADD COLUMN IF NOT EXISTS {col} {typedef}")
        except Exception:
            pass

    # Unique indexes on numero_* (separate from ADD COLUMN because pre-existing
    # tables may lack the UNIQUE constraint from the original CREATE TABLE).
    # Each DDL is wrapped in a SAVEPOINT so that a concurrent race between two
    # workers (pg_class_relname_nsp_index duplicate) or a duplicate value in
    # legacy data does not abort the outer transaction and cascade into
    # "current transaction is aborted" on the next cursor.execute.
    def _run_in_savepoint(sp_name: str, sql_statements: tuple, warn_label: str):
        cursor.execute(f"SAVEPOINT {sp_name}")
        try:
            for stmt in sql_statements:
                cursor.execute(stmt)
            cursor.execute(f"RELEASE SAVEPOINT {sp_name}")
        except Exception as exc:
            try:
                cursor.execute(f"ROLLBACK TO SAVEPOINT {sp_name}")
            except Exception:
                pass
            logger.warning("%s skip: %s", warn_label, type(exc).__name__)

    _run_in_savepoint(
        "sp_immo_projets_num_idx",
        (
            "CREATE UNIQUE INDEX IF NOT EXISTS immo_projets_numero_projet_key "
            "ON immo_projets(numero_projet) WHERE numero_projet IS NOT NULL",
        ),
        "immo_projets numero_projet index",
    )
    _run_in_savepoint(
        "sp_immo_terrains_num_idx",
        (
            "ALTER TABLE immo_terrains ADD COLUMN IF NOT EXISTS numero_dossier TEXT",
            "CREATE UNIQUE INDEX IF NOT EXISTS immo_terrains_numero_dossier_key "
            "ON immo_terrains(numero_dossier) WHERE numero_dossier IS NOT NULL",
        ),
        "immo_terrains numero_dossier migration",
    )
    _run_in_savepoint(
        "sp_immo_financement_num_idx",
        (
            "ALTER TABLE immo_financement ADD COLUMN IF NOT EXISTS numero_financement TEXT",
            "CREATE UNIQUE INDEX IF NOT EXISTS immo_financement_numero_key "
            "ON immo_financement(numero_financement) WHERE numero_financement IS NOT NULL",
        ),
        "immo_financement numero_financement migration",
    )

    # --- immo_terrains: original + enriched columns ---
    for col, typedef in [
        # Original (CREATE TABLE)
        ("statut", "TEXT DEFAULT 'Prospection'"),
        ("adresse", "TEXT"),
        ("ville", "TEXT"),
        ("code_postal", "TEXT"),
        ("superficie_m2", "NUMERIC"),
        ("zonage", "TEXT"),
        ("proprietaire_nom", "TEXT"),
        ("proprietaire_contact", "TEXT"),
        ("prix_demande", "NUMERIC"),
        ("prix_offre", "NUMERIC"),
        ("evaluation_municipale", "NUMERIC"),
        ("notes", "TEXT"),
        ("created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("created_by", "TEXT"),
        # Enriched
        ("numero_lot", "TEXT"),
        ("numero_cadastre", "TEXT"),
        ("superficie_pi2", "NUMERIC"),
        ("potentiel_construction", "TEXT"),
        ("prix_final", "NUMERIC"),
        ("date_offre", "DATE"),
        ("date_acquisition", "DATE"),
        ("evaluation_marchande", "NUMERIC"),
        ("score_faisabilite", "INTEGER"),
        ("servitudes", "TEXT"),
        ("contraintes_environnementales", "TEXT"),
        ("acces_services", "TEXT"),
        ("certificat_localisation", "BOOLEAN"),
        ("etude_sol", "BOOLEAN"),
        ("permis_preliminaire", "BOOLEAN"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE immo_terrains ADD COLUMN IF NOT EXISTS {col} {typedef}")
        except Exception:
            pass

    # --- immo_financement: original + enriched columns ---
    for col, typedef in [
        # Original (CREATE TABLE)
        ("projet_id", "INTEGER"),
        ("statut", "TEXT DEFAULT 'En preparation'"),
        ("banque", "TEXT"),
        ("type_pret", "TEXT"),
        ("montant_demande", "NUMERIC DEFAULT 0"),
        ("montant_approuve", "NUMERIC DEFAULT 0"),
        ("taux_interet_annuel", "NUMERIC DEFAULT 0"),
        ("duree_amortissement_annees", "INTEGER DEFAULT 25"),
        ("mise_de_fonds_pct", "NUMERIC DEFAULT 0"),
        ("mise_de_fonds_montant", "NUMERIC DEFAULT 0"),
        ("date_demande", "DATE"),
        ("date_approbation", "DATE"),
        ("notes", "TEXT"),
        ("created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("created_by", "TEXT"),
        # Enriched
        ("conseiller_nom", "TEXT"),
        ("conseiller_contact", "TEXT"),
        ("taux_type", "TEXT"),
        ("frequence_paiement", "TEXT"),
        ("garanties_requises", "TEXT"),
        ("assurance_pret_schl", "BOOLEAN"),
        ("prime_schl_pct", "NUMERIC"),
        ("prime_schl_montant", "NUMERIC"),
        ("ratio_pret_valeur_pct", "NUMERIC"),
        ("ratio_couverture_dette", "NUMERIC"),
        ("test_resistance_taux", "NUMERIC"),
        ("financement_progressif", "BOOLEAN DEFAULT TRUE"),
        ("calendrier_deblocages", "TEXT"),
        ("interets_intercalaires_estimes", "NUMERIC"),
        ("frais_evaluation", "NUMERIC"),
        ("frais_notaire", "NUMERIC"),
        ("frais_ouverture", "NUMERIC"),
        ("autres_frais", "NUMERIC"),
        ("date_deblocage_initial", "DATE"),
        ("date_echeance", "DATE"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE immo_financement ADD COLUMN IF NOT EXISTS {col} {typedef}")
        except Exception:
            pass

    # --- immo_unites: original + enriched columns ---
    # Note: projet_id is NOT NULL in CREATE TABLE but we add it without
    # constraint here — legacy tables with data would reject NOT NULL.
    for col, typedef in [
        # Original (CREATE TABLE)
        ("projet_id", "INTEGER"),
        ("numero_unite", "TEXT"),
        ("type_unite", "TEXT DEFAULT 'Condo'"),
        ("superficie_m2", "NUMERIC"),
        ("nombre_chambres", "INTEGER DEFAULT 0"),
        ("nombre_salles_bain", "INTEGER DEFAULT 0"),
        ("etage", "INTEGER"),
        ("prix_vente", "NUMERIC DEFAULT 0"),
        ("loyer_mensuel", "NUMERIC DEFAULT 0"),
        ("statut", "TEXT DEFAULT 'Disponible'"),
        ("acheteur_nom", "TEXT"),
        ("date_vente_finale", "DATE"),
        ("notes", "TEXT"),
        ("created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        # Enriched
        ("sous_type", "TEXT"),
        ("superficie_pi2", "NUMERIC"),
        ("orientation", "TEXT"),
        ("acheteur_contact", "TEXT"),
        ("date_promesse_achat", "DATE"),
        ("locataire_nom", "TEXT"),
        ("date_debut_bail", "DATE"),
        ("duree_bail_mois", "INTEGER"),
        ("equipements", "TEXT"),
        ("finitions_speciales", "TEXT"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE immo_unites ADD COLUMN IF NOT EXISTS {col} {typedef}")
        except Exception:
            pass

    # --- immo_inspections: original + enriched columns ---
    for col, typedef in [
        # Original (CREATE TABLE)
        ("projet_id", "INTEGER"),
        ("type_inspection", "TEXT"),
        ("date_planifiee", "DATE"),
        ("date_realisee", "DATE"),
        ("inspecteur_nom", "TEXT"),
        ("statut", "TEXT DEFAULT 'Planifiee'"),
        ("resultat", "TEXT"),
        ("nombre_deficiences", "INTEGER DEFAULT 0"),
        ("notes", "TEXT"),
        ("created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("created_by", "TEXT"),
        # Enriched
        ("phase_id", "INTEGER"),
        ("unite_id", "INTEGER"),
        ("categorie", "TEXT"),
        ("inspecteur_organisme", "TEXT"),
        ("inspecteur_numero_permis", "TEXT"),
        ("inspecteur_contact", "TEXT"),
        ("score_conformite", "INTEGER"),
        ("deficiences_mineures", "INTEGER DEFAULT 0"),
        ("deficiences_majeures", "INTEGER DEFAULT 0"),
        ("deficiences_critiques", "INTEGER DEFAULT 0"),
        ("liste_deficiences", "TEXT"),
        ("corrections_requises", "BOOLEAN"),
        ("date_limite_corrections", "DATE"),
        ("corrections_effectuees", "BOOLEAN"),
        ("date_corrections", "DATE"),
        ("reinspection_requise", "BOOLEAN"),
        ("date_reinspection", "DATE"),
        ("reinspection_reussie", "BOOLEAN"),
        ("rapport_inspection", "TEXT"),
        ("photos_jointes", "BOOLEAN"),
        ("certificat_emis", "BOOLEAN"),
        ("numero_certificat", "TEXT"),
        ("conforme_cnb", "BOOLEAN"),
        ("conforme_cce", "BOOLEAN"),
        ("conforme_csst", "BOOLEAN"),
        ("conforme_municipal", "BOOLEAN"),
        ("cout_inspection", "NUMERIC"),
        ("cout_corrections", "NUMERIC"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE immo_inspections ADD COLUMN IF NOT EXISTS {col} {typedef}")
        except Exception:
            pass

    # --- immo_paiements: all CREATE TABLE columns ---
    for col, typedef in [
        ("projet_id", "INTEGER"),
        ("type_paiement", "TEXT"),
        ("categorie", "TEXT DEFAULT 'Depense'"),
        ("montant", "NUMERIC DEFAULT 0"),
        ("description", "TEXT"),
        ("beneficiaire", "TEXT"),
        ("date_paiement", "DATE"),
        ("statut", "TEXT DEFAULT 'Prevu'"),
        ("notes", "TEXT"),
        ("created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE immo_paiements ADD COLUMN IF NOT EXISTS {col} {typedef}")
        except Exception:
            pass

    # --- New table: immo_deblocages ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS immo_deblocages (
            id SERIAL PRIMARY KEY,
            financement_id INTEGER NOT NULL,
            numero_deblocage TEXT,
            etape_construction TEXT,
            pourcentage_etape NUMERIC DEFAULT 0,
            montant_prevu NUMERIC DEFAULT 0,
            montant_reel NUMERIC,
            statut TEXT DEFAULT 'Prevu',
            date_prevue DATE,
            date_demande DATE,
            date_approbation DATE,
            date_deblocage DATE,
            inspection_requise BOOLEAN DEFAULT TRUE,
            inspection_effectuee BOOLEAN DEFAULT FALSE,
            date_inspection DATE,
            rapport_inspection TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT
        )
    """)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_immo_deblocages_financement "
        "ON immo_deblocages (financement_id)"
    )

    # --- New table: immo_construction_phases ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS immo_construction_phases (
            id SERIAL PRIMARY KEY,
            projet_id INTEGER NOT NULL,
            nom_phase TEXT NOT NULL,
            numero_phase INTEGER DEFAULT 1,
            statut TEXT DEFAULT 'A venir',
            pourcentage_completion NUMERIC DEFAULT 0,
            date_debut_prevue DATE,
            date_debut_reelle DATE,
            date_fin_prevue DATE,
            date_fin_reelle DATE,
            duree_prevue_jours INTEGER,
            duree_reelle_jours INTEGER,
            budget_prevu NUMERIC,
            cout_reel NUMERIC,
            variance_budget NUMERIC,
            entrepreneur_id INTEGER,
            superviseur_id INTEGER,
            inspection_requise BOOLEAN DEFAULT TRUE,
            inspection_approuvee BOOLEAN DEFAULT FALSE,
            date_inspection DATE,
            conforme_cnb BOOLEAN,
            materiaux_commandes BOOLEAN DEFAULT FALSE,
            materiaux_recus BOOLEAN DEFAULT FALSE,
            retards_jours INTEGER DEFAULT 0,
            raison_retard TEXT,
            problemes_rencontres TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT
        )
    """)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_immo_phases_projet "
        "ON immo_construction_phases (projet_id)"
    )

    # --- New table: immo_commercialisation ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS immo_commercialisation (
            id SERIAL PRIMARY KEY,
            projet_id INTEGER NOT NULL,
            strategie_vente TEXT,
            prix_moyen_vente NUMERIC,
            loyer_moyen NUMERIC,
            objectif_pre_ventes_pct NUMERIC,
            taux_pre_ventes_actuel_pct NUMERIC DEFAULT 0,
            nombre_unites_vendues INTEGER DEFAULT 0,
            nombre_unites_louees INTEGER DEFAULT 0,
            budget_marketing NUMERIC,
            cout_marketing_reel NUMERIC DEFAULT 0,
            site_web TEXT,
            courtier_nom TEXT,
            commission_courtier_pct NUMERIC,
            date_lancement DATE,
            date_journee_portes_ouvertes DATE,
            brochure_prete BOOLEAN DEFAULT FALSE,
            plans_vente_prets BOOLEAN DEFAULT FALSE,
            maquette_3d BOOLEAN DEFAULT FALSE,
            statut TEXT DEFAULT 'Planification',
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT
        )
    """)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_immo_commercialisation_projet "
        "ON immo_commercialisation (projet_id)"
    )

    # --- New table: immo_livraisons ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS immo_livraisons (
            id SERIAL PRIMARY KEY,
            unite_id INTEGER NOT NULL,
            projet_id INTEGER NOT NULL,
            numero_livraison TEXT,
            beneficiaire_nom TEXT,
            beneficiaire_type TEXT DEFAULT 'Acheteur',
            date_livraison_prevue DATE,
            date_livraison_reelle DATE,
            inspection_pre_livraison BOOLEAN DEFAULT FALSE,
            date_inspection_pre_livraison DATE,
            liste_deficiences TEXT,
            deficiences_corrigees BOOLEAN DEFAULT FALSE,
            cles_remises BOOLEAN DEFAULT FALSE,
            acte_vente_signe BOOLEAN DEFAULT FALSE,
            bail_signe BOOLEAN DEFAULT FALSE,
            manuel_copropriete BOOLEAN DEFAULT FALSE,
            plans_conformes BOOLEAN DEFAULT FALSE,
            certificat_conformite BOOLEAN DEFAULT FALSE,
            garantie_legale_vice_cache BOOLEAN DEFAULT TRUE,
            garantie_gcr BOOLEAN DEFAULT FALSE,
            duree_garantie_mois INTEGER,
            date_fin_garantie DATE,
            formulaire_satisfaction_remis BOOLEAN DEFAULT FALSE,
            note_satisfaction INTEGER,
            commentaires_client TEXT,
            reclamations_ouvertes INTEGER DEFAULT 0,
            statut TEXT DEFAULT 'Planifiee',
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT
        )
    """)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_immo_livraisons_unite "
        "ON immo_livraisons (unite_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_immo_livraisons_projet "
        "ON immo_livraisons (projet_id)"
    )

    # --- New table: immo_documents ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS immo_documents (
            id SERIAL PRIMARY KEY,
            projet_id INTEGER NOT NULL,
            nom_document TEXT NOT NULL,
            categorie TEXT,
            type_fichier TEXT,
            description TEXT,
            chemin_fichier TEXT,
            taille_kb INTEGER,
            confidentiel BOOLEAN DEFAULT FALSE,
            date_document DATE,
            date_expiration DATE,
            statut TEXT DEFAULT 'ACTIF',
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT
        )
    """)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_immo_documents_projet "
        "ON immo_documents (projet_id)"
    )

    # --- Defensive table: immo_transactions ---
    # Listed in _cb_tables for ALTER but never CREATEd in legacy tenants.
    # Prod DB logs (~4 occurrences over 33h) showed `relation "immo_transactions"
    # does not exist` from a SELECT path that we couldn't locate in the
    # current codebase (likely a residual SQL view, function, or external
    # query). Defensively creating an empty table is harmless for tenants
    # that already have it (IF NOT EXISTS) and silences the error log noise.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS immo_transactions (
            id SERIAL PRIMARY KEY,
            projet_id INTEGER,
            unite_id INTEGER,
            type_transaction TEXT,
            montant NUMERIC,
            date_transaction DATE,
            description TEXT,
            statut TEXT DEFAULT 'ACTIF',
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT
        )
    """)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_immo_transactions_projet "
        "ON immo_transactions (projet_id)"
    )

    # Defensive migrations for new tables (existing tenants may have old schema)
    for col, typedef in [
        ("duree_prevue_jours", "INTEGER"),
        ("duree_reelle_jours", "INTEGER"),
        ("cout_reel", "NUMERIC"),
        ("variance_budget", "NUMERIC"),
        ("entrepreneur_id", "INTEGER"),
        ("superviseur_id", "INTEGER"),
        ("inspection_approuvee", "BOOLEAN DEFAULT FALSE"),
        ("date_inspection", "DATE"),
        ("materiaux_commandes", "BOOLEAN DEFAULT FALSE"),
        ("materiaux_recus", "BOOLEAN DEFAULT FALSE"),
        ("retards_jours", "INTEGER DEFAULT 0"),
        ("raison_retard", "TEXT"),
        ("problemes_rencontres", "TEXT"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE immo_construction_phases ADD COLUMN IF NOT EXISTS {col} {typedef}")
        except Exception:
            pass

    for col, typedef in [
        ("taux_pre_ventes_actuel_pct", "NUMERIC DEFAULT 0"),
        ("nombre_unites_vendues", "INTEGER DEFAULT 0"),
        ("nombre_unites_louees", "INTEGER DEFAULT 0"),
        ("cout_marketing_reel", "NUMERIC DEFAULT 0"),
        ("date_journee_portes_ouvertes", "DATE"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE immo_commercialisation ADD COLUMN IF NOT EXISTS {col} {typedef}")
        except Exception:
            pass

    for col, typedef in [
        ("date_inspection_pre_livraison", "DATE"),
        ("liste_deficiences", "TEXT"),
        ("deficiences_corrigees", "BOOLEAN DEFAULT FALSE"),
        ("cles_remises", "BOOLEAN DEFAULT FALSE"),
        ("acte_vente_signe", "BOOLEAN DEFAULT FALSE"),
        ("bail_signe", "BOOLEAN DEFAULT FALSE"),
        ("manuel_copropriete", "BOOLEAN DEFAULT FALSE"),
        ("plans_conformes", "BOOLEAN DEFAULT FALSE"),
        ("certificat_conformite", "BOOLEAN DEFAULT FALSE"),
        ("garantie_legale_vice_cache", "BOOLEAN DEFAULT TRUE"),
        ("garantie_gcr", "BOOLEAN DEFAULT FALSE"),
        ("duree_garantie_mois", "INTEGER"),
        ("date_fin_garantie", "DATE"),
        ("formulaire_satisfaction_remis", "BOOLEAN DEFAULT FALSE"),
        ("reclamations_ouvertes", "INTEGER DEFAULT 0"),
        ("inspection_reussie", "BOOLEAN"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE immo_livraisons ADD COLUMN IF NOT EXISTS {col} {typedef}")
        except Exception:
            pass

    for col, typedef in [
        ("statut", "TEXT DEFAULT 'ACTIF'"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE immo_documents ADD COLUMN IF NOT EXISTS {col} {typedef}")
        except Exception:
            pass

    # --- Defensive created_by column for tables missing it ---
    # Older tenants were provisioned before created_by was added to the immo_*
    # CREATE TABLE definitions. Without this, create_* raise
    # "column created_by does not exist". Each ALTER is wrapped in a SAVEPOINT
    # so a single failure (e.g. transaction already aborted by an earlier
    # ALTER in _ensure_immo_tables) cannot cascade and block the rest.
    _cb_tables = (
        "immo_paiements", "immo_unites", "immo_projets", "immo_terrains",
        "immo_financement", "immo_inspections", "immo_deblocages",
        "immo_construction_phases", "immo_commercialisation",
        "immo_livraisons", "immo_documents", "immo_transactions",
    )
    for tbl in _cb_tables:
        sp = f"sp_cb_{tbl}"
        try:
            cursor.execute(f"SAVEPOINT {sp}")
            # Skip if relation absent in this tenant: avoids "relation X does
            # not exist" PG ERROR logs that pollute Render dashboards. Some
            # tables (e.g. immo_transactions) are listed defensively but never
            # created in older tenants.
            cursor.execute("SELECT to_regclass(%s) AS reg", (tbl,))
            row = cursor.fetchone()
            reg = row.get('reg') if isinstance(row, dict) else (row[0] if row else None)
            if not reg:
                cursor.execute(f"RELEASE SAVEPOINT {sp}")
                continue
            cursor.execute(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS created_by TEXT")
            cursor.execute(f"RELEASE SAVEPOINT {sp}")
        except Exception as exc:
            try:
                cursor.execute(f"ROLLBACK TO SAVEPOINT {sp}")
            except Exception:
                pass
            # Log unexpected failures; ADD COLUMN IF NOT EXISTS is idempotent
            # so the only real reasons to land here are transaction-level or
            # permission problems the operator should see.
            logger.debug("ALTER %s ADD created_by skipped: %s", tbl, exc)

    # Indexes (existing)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_immo_terrains_statut "
        "ON immo_terrains (statut)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_immo_projets_statut_terrain "
        "ON immo_projets (statut, terrain_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_immo_financement_projet "
        "ON immo_financement (projet_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_immo_unites_projet "
        "ON immo_unites (projet_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_immo_inspections_projet "
        "ON immo_inspections (projet_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_immo_paiements_projet "
        "ON immo_paiements (projet_id)"
    )


# ============================================
# CONSTANTS
# ============================================

STANDARD_PHASES = [
    "Excavation et terrassement",
    "Fondations",
    "Structure (charpente)",
    "Toiture",
    "Enveloppe exterieure",
    "Plomberie et electricite (rough-in)",
    "CVC (Chauffage, Ventilation, Climatisation)",
    "Isolation",
    "Gypse",
    "Finitions interieures",
    "Amenagement paysager",
    "Inspections finales",
]

DEBLOCAGE_STAGES = [
    ("Terrain et preparation", 10),
    ("Fondations", 15),
    ("Charpente et structure", 25),
    ("Toiture et enveloppe", 15),
    ("Plomberie, electricite, CVC", 20),
    ("Finitions interieures", 10),
    ("Finition finale et nettoyage", 5),
]

IMMO_AI_SYSTEM_PROMPT = """Tu es un expert-conseil specialise en financement et developpement de projets immobiliers de construction au Quebec.

1. PROJETS IMMOBILIERS:
- Tu connais parfaitement le cycle de developpement immobilier au Quebec: acquisition de terrain, etude de faisabilite, financement, construction, commercialisation, livraison.
- Tu maitrises les types de projets: condominiums, maisons en rangee, logements locatifs, projets mixtes (commercial/residentiel), conversion/renovation.
- Tu connais les etapes de construction standard et les inspections requises par le Code national du batiment (CNB).

2. FINANCEMENT DE CONSTRUCTION:
- Tu es expert en financement de construction au Quebec: prets hypothecaires de construction, financements progressifs (deblocages par etapes), mises de fonds, ratio pret-valeur.
- Tu connais les exigences de la SCHL (Societe canadienne d'hypotheques et de logement): primes d'assurance, ratios, tests de resistance.
- Tu maitrises les calculs: amortissement, interets intercalaires, primes SCHL, cout total d'emprunt, ROI.

3. BANQUES ET INSTITUTIONS:
- Tu connais les principales institutions financieres au Quebec: Desjardins, Banque Nationale, TD, RBC, BMO, Scotia, CIBC, Banque Laurentienne, First National, CMLS.
- Tu connais leurs programmes de financement de construction et leurs criteres d'approbation.
- Tu peux conseiller sur le choix de l'institution en fonction du type de projet et du profil de l'emprunteur.

4. ANALYSE FINANCIERE:
- Tu peux analyser un projet immobilier complet: faisabilite, rentabilite, risques.
- Tu calcules les ratios financiers: ROI, TRI (taux de rendement interne), ratio de couverture de dette, ratio pret-valeur, cash-on-cash return.
- Tu evalues les couts de construction au Quebec: cout/pi2 par type de projet, frais connexes (notaire, evaluation, droits de mutation, taxes).

5. FISCALITE ET COUTS AU QUEBEC:
- TPS: 5%, TVQ: 9.975% (applicables sur construction neuve, remboursements partiels possibles)
- Droits de mutation (taxe de bienvenue): bareme progressif provincial + surtaxe possible selon municipalite
- Frais de notaire construction: typiquement 1,500$ - 3,000$
- Evaluation professionnelle: 350$ - 800$ selon le projet
- Permis de construction: variable selon municipalite (0.5% - 2% de la valeur)

6. COMMERCIALISATION:
- Tu connais les strategies de pre-vente et de mise en marche au Quebec.
- Tu peux conseiller sur le positionnement, le prix, la strategie marketing.
- Tu connais les obligations legales (plan de garantie GCR, contrats preliminaires, declaration de copropriete).

ROLE: Tu reponds de maniere precise, chiffree et actionnable. Tu donnes des recommandations concretes basees sur les donnees du projet. Tu identifies les risques et les opportunites. Tu utilises le vocabulaire immobilier quebecois standard."""


# ============================================
# DASHBOARD
# ============================================

@router.get("/dashboard")
async def get_immobilier_dashboard(user: ErpUser = Depends(get_current_user)):
    """Get immobilier module dashboard statistics."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        # Total terrains
        cursor.execute("SELECT COUNT(*) as total FROM immo_terrains")
        total_terrains = cursor.fetchone()["total"]

        # Terrains by status
        cursor.execute(
            "SELECT statut, COUNT(*) as count FROM immo_terrains GROUP BY statut ORDER BY statut"
        )
        terrains_by_status = [dict(row) for row in cursor.fetchall()]

        # Total projets
        cursor.execute("SELECT COUNT(*) as total FROM immo_projets")
        total_projets = cursor.fetchone()["total"]

        # Projets by status
        cursor.execute(
            "SELECT statut, COUNT(*) as count FROM immo_projets GROUP BY statut ORDER BY statut"
        )
        projets_by_status = [dict(row) for row in cursor.fetchall()]

        # Financement totals
        cursor.execute(
            "SELECT COALESCE(SUM(montant_demande), 0) as total_demande, "
            "COALESCE(SUM(montant_approuve), 0) as total_approuve "
            "FROM immo_financement"
        )
        fin_row = cursor.fetchone()
        total_financement_demande = float(fin_row["total_demande"])
        total_financement_approuve = float(fin_row["total_approuve"])

        # Unites stats
        cursor.execute("SELECT COUNT(*) as total FROM immo_unites")
        total_unites = cursor.fetchone()["total"]

        cursor.execute(
            "SELECT COUNT(*) as count FROM immo_unites WHERE statut = 'Vendu'"
        )
        unites_vendues = cursor.fetchone()["count"]

        cursor.execute(
            "SELECT COUNT(*) as count FROM immo_unites WHERE statut = 'Disponible'"
        )
        unites_disponibles = cursor.fetchone()["count"]

        return {
            "total_terrains": total_terrains,
            "terrains_by_status": terrains_by_status,
            "total_projets": total_projets,
            "projets_by_status": projets_by_status,
            "total_financement_demande": total_financement_demande,
            "total_financement_approuve": total_financement_approuve,
            "total_unites": total_unites,
            "unites_vendues": unites_vendues,
            "unites_disponibles": unites_disponibles,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_immobilier_dashboard error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement du tableau de bord immobilier")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# TERRAINS ENDPOINTS
# ============================================

@router.get("/terrains")
async def list_terrains(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    statut: Optional[str] = None,
):
    """List terrains with pagination, search, and status filter."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        where_clauses = []
        params = []

        if search:
            where_clauses.append(
                "(LOWER(COALESCE(adresse,'')) LIKE %s OR LOWER(COALESCE(ville,'')) LIKE %s "
                "OR LOWER(COALESCE(numero_dossier,'')) LIKE %s OR LOWER(COALESCE(proprietaire_nom,'')) LIKE %s)"
            )
            s = f"%{search.lower()}%"
            params.extend([s, s, s, s])

        if statut:
            where_clauses.append("statut = %s")
            params.append(statut)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        # Count
        cursor.execute(
            f"SELECT COUNT(*) as total FROM immo_terrains WHERE {where_sql}", params
        )
        total = cursor.fetchone()["total"]

        # Fetch page
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT * FROM immo_terrains WHERE {where_sql} "
            f"ORDER BY updated_at DESC NULLS LAST "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("created_at", "updated_at", "date_offre", "date_acquisition"):
                if d.get(k):
                    d[k] = str(d[k])
            for k in ("prix_demande", "prix_offre", "evaluation_municipale", "superficie_m2",
                       "superficie_pi2", "prix_final", "evaluation_marchande"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_terrains error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des terrains")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/terrains/{terrain_id}")
async def get_terrain(terrain_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single terrain by ID."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute("SELECT * FROM immo_terrains WHERE id = %s", (terrain_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Terrain non trouvé")

        result = dict(row)
        for k in ("created_at", "updated_at", "date_offre", "date_acquisition"):
            if result.get(k):
                result[k] = str(result[k])
        for k in ("prix_demande", "prix_offre", "evaluation_municipale", "superficie_m2",
                   "superficie_pi2", "prix_final", "evaluation_marchande"):
            if result.get(k) is not None:
                result[k] = float(result[k])

        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_terrain error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation du terrain")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/terrains")
async def create_terrain(body: TerrainCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new terrain."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        # Retry up to 5 times on UNIQUE collision for numero_dossier
        terrain_id = None
        numero_dossier = None
        for _attempt in range(5):
            numero_dossier = _gen_numero("TER")
            try:
                cursor.execute(
                    "INSERT INTO immo_terrains "
                    "(numero_dossier, statut, adresse, ville, code_postal, superficie_m2, zonage, "
                    "proprietaire_nom, proprietaire_contact, prix_demande, prix_offre, "
                    "evaluation_municipale, notes, created_by, "
                    "numero_lot, numero_cadastre, superficie_pi2, potentiel_construction, "
                    "prix_final, date_offre, date_acquisition, evaluation_marchande, "
                    "score_faisabilite, servitudes, contraintes_environnementales, acces_services, "
                    "certificat_localisation, etude_sol, permis_preliminaire, "
                    "created_at, updated_at) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
                    "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
                    "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
                    "RETURNING id",
                    (numero_dossier, body.statut, body.adresse, body.ville, body.code_postal,
                     body.superficie_m2, body.zonage, body.proprietaire_nom, body.proprietaire_contact,
                     body.prix_demande, body.prix_offre, body.evaluation_municipale,
                     # `created_by` is INTEGER on this tenant's schema (not TEXT);
                     # pass user_id, not email.
                     body.notes, str(user.user_id),
                     body.numero_lot, body.numero_cadastre, body.superficie_pi2,
                     body.potentiel_construction, body.prix_final, body.date_offre,
                     body.date_acquisition, body.evaluation_marchande, body.score_faisabilite,
                     body.servitudes, body.contraintes_environnementales, body.acces_services,
                     body.certificat_localisation, body.etude_sol, body.permis_preliminaire),
                )
                row = cursor.fetchone()
                terrain_id = row["id"]
                break
            except Exception as e:
                if "unique" in str(e).lower() or "duplicate" in str(e).lower():
                    conn.rollback()
                    db.set_tenant(conn, user.schema)
                    continue
                raise
        if terrain_id is None:
            raise HTTPException(status_code=500, detail="Impossible de generer un numero de dossier unique")
        conn.commit()

        return {"id": terrain_id, "numero_dossier": numero_dossier, "message": "Terrain créé"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_terrain error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la création du terrain")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/terrains/{terrain_id}")
async def update_terrain(
    terrain_id: int, body: TerrainUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update a terrain."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    ALLOWED_COLS = {
        "adresse", "ville", "code_postal", "superficie_m2", "zonage",
        "proprietaire_nom", "proprietaire_contact", "prix_demande", "prix_offre",
        "evaluation_municipale", "notes", "statut",
        "numero_lot", "numero_cadastre", "superficie_pi2", "potentiel_construction",
        "prix_final", "date_offre", "date_acquisition", "evaluation_marchande",
        "score_faisabilite", "servitudes", "contraintes_environnementales",
        "acces_services", "certificat_localisation", "etude_sol", "permis_preliminaire",
    }
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ a modifier")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [terrain_id]

        cursor.execute(
            f"UPDATE immo_terrains SET {', '.join(set_parts)} WHERE id = %s",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Terrain non trouvé")

        conn.commit()
        return {"message": "Terrain mis à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_terrain error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise à jour du terrain")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/terrains/{terrain_id}")
async def delete_terrain(terrain_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a terrain.

    Nullify immo_projets.terrain_id referencing this terrain (no FK in DDL,
    so without this UPDATE, projets garderaient un terrain_id pointant vers
    un terrain supprime - JOIN renverrait des NULL silencieusement).
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        # Nullify projets pointant vers ce terrain (preferable a un blocage
        # car le projet existe meme sans terrain - on ne perd pas de donnee).
        try:
            cursor.execute(
                "UPDATE immo_projets SET terrain_id = NULL WHERE terrain_id = %s",
                (terrain_id,),
            )
        except Exception as nullify_exc:
            logger.warning("delete_terrain: nullify projets.terrain_id failed: %s",
                           nullify_exc)
            try:
                conn.rollback()
            except Exception:
                pass
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass

        cursor.execute("DELETE FROM immo_terrains WHERE id = %s", (terrain_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Terrain non trouvé")

        conn.commit()
        return {"message": "Terrain supprime"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_terrain error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression du terrain")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# PROJETS ENDPOINTS
# ============================================

@router.get("/projets")
async def list_projets(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    statut: Optional[str] = None,
):
    """List immobilier projets with pagination, search, and status filter."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        where_clauses = []
        params = []

        if search:
            where_clauses.append(
                "(LOWER(COALESCE(nom_projet,'')) LIKE %s OR LOWER(COALESCE(numero_projet,'')) LIKE %s "
                "OR LOWER(COALESCE(type_projet,'')) LIKE %s)"
            )
            s = f"%{search.lower()}%"
            params.extend([s, s, s])

        if statut:
            where_clauses.append("statut = %s")
            params.append(statut)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        # Count
        cursor.execute(
            f"SELECT COUNT(*) as total FROM immo_projets WHERE {where_sql}", params
        )
        total = cursor.fetchone()["total"]

        # Fetch page
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT * FROM immo_projets WHERE {where_sql} "
            f"ORDER BY updated_at DESC NULLS LAST "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("created_at", "updated_at", "date_debut_planifiee", "date_fin_planifiee"):
                if d.get(k):
                    d[k] = str(d[k])
            for k in ("budget_total", "cout_terrain", "cout_construction",
                       "revenus_ventes_estimes", "roi_estime_pct"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_projets error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des projets immobiliers")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/projets/{projet_id}")
async def get_projet(projet_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single immobilier projet by ID, including units count."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute("SELECT * FROM immo_projets WHERE id = %s", (projet_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Projet immobilier non trouvé")

        result = dict(row)
        for k in ("created_at", "updated_at", "date_debut_planifiee", "date_fin_planifiee"):
            if result.get(k):
                result[k] = str(result[k])
        for k in ("budget_total", "cout_terrain", "cout_construction",
                   "revenus_ventes_estimes", "roi_estime_pct"):
            if result.get(k) is not None:
                result[k] = float(result[k])

        # Include units count
        cursor.execute(
            "SELECT COUNT(*) as total, "
            "COUNT(*) FILTER (WHERE statut = 'Disponible') as disponibles, "
            "COUNT(*) FILTER (WHERE statut = 'Vendu') as vendues, "
            "COUNT(*) FILTER (WHERE statut = 'Reserve') as reservees "
            "FROM immo_unites WHERE projet_id = %s",
            (projet_id,),
        )
        unites_row = cursor.fetchone()
        result["unites_count"] = {
            "total": unites_row["total"],
            "disponibles": unites_row["disponibles"],
            "vendues": unites_row["vendues"],
            "reservees": unites_row["reservees"],
        }

        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_projet error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation du projet immobilier")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/projets")
async def create_projet(body: ProjetCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new immobilier projet."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        # Retry up to 5 times on UNIQUE collision for numero_projet
        projet_id = None
        numero_projet = None
        for _attempt in range(5):
            numero_projet = _gen_numero("IMMO")
            try:
                cursor.execute(
                    "INSERT INTO immo_projets "
                    "(numero_projet, nom_projet, statut, terrain_id, type_projet, nombre_logements, "
                    "budget_total, cout_terrain, cout_construction, revenus_ventes_estimes, roi_estime_pct, "
                    "date_debut_planifiee, date_fin_planifiee, description, notes, created_by, "
                    "created_at, updated_at) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
                    "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
                    "RETURNING id",
                    (numero_projet, body.nom_projet, body.statut, body.terrain_id, body.type_projet,
                     body.nombre_logements, body.budget_total, body.cout_terrain, body.cout_construction,
                     body.revenus_ventes_estimes, body.roi_estime_pct,
                     body.date_debut_planifiee, body.date_fin_planifiee,
                     body.description, body.notes, str(user.user_id)),
                )
                row = cursor.fetchone()
                projet_id = row["id"]
                break
            except Exception as e:
                if "unique" in str(e).lower() or "duplicate" in str(e).lower():
                    conn.rollback()
                    db.set_tenant(conn, user.schema)
                    continue
                raise
        if projet_id is None:
            raise HTTPException(status_code=500, detail="Impossible de generer un numero de projet unique")
        conn.commit()

        return {"id": projet_id, "numero_projet": numero_projet, "message": "Projet immobilier créé"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_projet error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la création du projet immobilier")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/projets/{projet_id}")
async def update_projet(
    projet_id: int, body: ProjetUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update an immobilier projet."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    ALLOWED_COLS = {
        "nom_projet", "terrain_id", "type_projet", "nombre_logements",
        "budget_total", "cout_terrain", "cout_construction", "revenus_ventes_estimes",
        "roi_estime_pct", "date_debut_planifiee", "date_fin_planifiee",
        "description", "notes", "statut",
    }
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ a modifier")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [projet_id]

        cursor.execute(
            f"UPDATE immo_projets SET {', '.join(set_parts)} WHERE id = %s",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Projet immobilier non trouvé")

        conn.commit()
        return {"message": "Projet immobilier mis à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_projet error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise à jour du projet immobilier")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/projets/{projet_id}")
async def delete_projet(projet_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete an immobilier projet.

    Cascade manuel vers les tables enfant qui referencent projet_id.
    Aucune FK ON DELETE CASCADE n'est definie dans le DDL des tables immo_*,
    donc sans ce cleanup, supprimer un projet laisse des orphelins dans
    immo_unites, immo_inspections, immo_paiements, immo_financement,
    immo_construction_phases, immo_deblocages, immo_commercialisation,
    immo_livraisons, immo_documents.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    prev_autocommit = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        # Forcer autocommit=False pour que SAVEPOINT fonctionne. psycopg2
        # rejette SAVEPOINT en mode autocommit ("SAVEPOINT can only be used
        # in transaction blocks"). On restaure l'etat d'origine en finally
        # pour ne pas polluer le pool.
        try:
            prev_autocommit = conn.autocommit
        except Exception:
            prev_autocommit = None
        try:
            conn.autocommit = False
        except Exception:
            pass

        # Cleanup cascade vers tables enfant. Chaque DELETE est isole dans
        # un SAVEPOINT pour qu'un echec sur une table (legacy, colonne
        # manquante) ne rollback pas les DELETEs precedents reussis.
        # immo_deblocages utilise financement_id (PAS projet_id) - special-case
        # via subquery. Doit etre supprime AVANT immo_financement.
        # Liste : (table, sql_template) - {pid} = projet_id parametre.
        cascade_steps = (
            ("immo_deblocages",
             "DELETE FROM immo_deblocages WHERE financement_id IN "
             "(SELECT id FROM immo_financement WHERE projet_id = %s)"),
            ("immo_paiements",
             "DELETE FROM immo_paiements WHERE projet_id = %s"),
            ("immo_inspections",
             "DELETE FROM immo_inspections WHERE projet_id = %s"),
            ("immo_livraisons",
             "DELETE FROM immo_livraisons WHERE projet_id = %s"),
            ("immo_commercialisation",
             "DELETE FROM immo_commercialisation WHERE projet_id = %s"),
            ("immo_construction_phases",
             "DELETE FROM immo_construction_phases WHERE projet_id = %s"),
            ("immo_documents",
             "DELETE FROM immo_documents WHERE projet_id = %s"),
            ("immo_financement",
             "DELETE FROM immo_financement WHERE projet_id = %s"),
            ("immo_unites",
             "DELETE FROM immo_unites WHERE projet_id = %s"),
        )
        for idx, (child_tbl, sql) in enumerate(cascade_steps):
            sp_name = f"sp_immo_cascade_{idx}"
            try:
                cursor.execute(f"SAVEPOINT {sp_name}")
                cursor.execute(sql, (projet_id,))
                cursor.execute(f"RELEASE SAVEPOINT {sp_name}")
            except Exception as child_exc:
                logger.warning("delete_projet: cleanup %s failed: %s",
                               child_tbl, child_exc)
                try:
                    cursor.execute(f"ROLLBACK TO SAVEPOINT {sp_name}")
                except Exception:
                    pass

        cursor.execute("DELETE FROM immo_projets WHERE id = %s", (projet_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Projet immobilier non trouvé")

        conn.commit()
        return {"message": "Projet immobilier supprime"}
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("delete_projet error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression du projet immobilier")
    finally:
        # Restaurer autocommit d'origine pour ne pas polluer le pool.
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception:
                pass
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# FINANCEMENT ENDPOINTS
# ============================================

@router.get("/financements")
async def list_financements(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    projet_id: Optional[int] = None,
):
    """List financements with optional projet_id filter.

    Concurrent requests can deadlock when ``_ensure_immo_tables`` runs DDL
    on a cold worker cache (observed in prod 2026-04-30 x2:
    ``list_financements error: deadlock detected``). PostgreSQL aborts one
    of the two transactions automatically; a small retry budget lets the
    aborted attempt run again — by then the cache is warm on the surviving
    transaction's worker, so the second attempt skips the DDL entirely.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    # 5 attempts (was 3): prod logs 2026-04-30 showed two requests still
    # exhausting the budget when DDL ran on cold workers in parallel. With
    # exponential backoff (50ms, 100ms, 200ms, 400ms) the second attempt
    # almost always finds the table cache warm.
    max_attempts = 5
    last_exc: Optional[Exception] = None
    for attempt in range(max_attempts):
        conn = db.get_conn()
        cursor = None
        try:
            db.set_tenant(conn, user.schema)
            cursor = conn.cursor()
            _ensure_immo_tables(cursor)
            conn.commit()

            where_clauses = []
            params = []

            if projet_id is not None:
                where_clauses.append("f.projet_id = %s")
                params.append(projet_id)

            where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

            # Count
            cursor.execute(
                f"SELECT COUNT(*) as total FROM immo_financement f WHERE {where_sql}", params
            )
            total = cursor.fetchone()["total"]

            # Fetch page
            offset = (page - 1) * per_page
            cursor.execute(
                f"SELECT f.*, p.nom_projet "
                f"FROM immo_financement f "
                f"LEFT JOIN immo_projets p ON f.projet_id = p.id "
                f"WHERE {where_sql} "
                f"ORDER BY f.updated_at DESC NULLS LAST "
                f"LIMIT %s OFFSET %s",
                params + [per_page, offset],
            )
            items = []
            for row in cursor.fetchall():
                d = dict(row)
                for k in ("created_at", "updated_at", "date_demande", "date_approbation",
                           "date_deblocage_initial", "date_echeance"):
                    if d.get(k):
                        d[k] = str(d[k])
                for k in ("montant_demande", "montant_approuve", "taux_interet_annuel",
                           "mise_de_fonds_pct", "mise_de_fonds_montant",
                           "prime_schl_pct", "prime_schl_montant", "ratio_pret_valeur_pct",
                           "ratio_couverture_dette", "test_resistance_taux",
                           "interets_intercalaires_estimes", "frais_evaluation",
                           "frais_notaire", "frais_ouverture", "autres_frais"):
                    if d.get(k) is not None:
                        d[k] = float(d[k])
                items.append(d)

            return {"items": items, "total": total, "page": page, "per_page": per_page}
        except HTTPException:
            raise
        except Exception as exc:
            last_exc = exc
            err_str = str(exc).lower()
            is_retryable = "deadlock" in err_str
            if is_retryable and attempt + 1 < max_attempts:
                try:
                    conn.rollback()
                except Exception:
                    pass
                logger.warning(
                    "list_financements deadlock attempt %d/%d, retrying",
                    attempt + 1, max_attempts,
                )
                # Exponential backoff: 50, 100, 200, 400 ms — small enough to
                # stay under the user's request budget, large enough to let
                # the surviving DDL transaction commit. The finally below will
                # close this conn and the next iteration picks a fresh one
                # from the pool.
                # MUST be `await asyncio.sleep` (not `time.sleep`) inside an
                # `async def` route handler — `time.sleep` blocks the entire
                # event loop, freezing all other requests on the worker for
                # up to 50+100+200+400=750ms cumulés.
                await asyncio.sleep(0.05 * (2 ** attempt))
                continue
            logger.error("list_financements error: %s", exc)
            raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des financements")
        finally:
            # Chaque sous-étape protégée individuellement : un cursor.close()
            # qui rate ne doit pas empêcher le reset_tenant ni le conn.close()
            # (sinon on risque une fuite de connexion dans le pool).
            if cursor:
                try:
                    cursor.close()
                except Exception:
                    pass
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass

    # Exhausted retries with a retryable error — surface a 500 with a
    # generic message (do not leak internals — lecon #74).
    if last_exc is not None:
        logger.error(
            "list_financements failed after %d attempts: %s",
            max_attempts, last_exc,
        )
    raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des financements")


@router.get("/financements/{financement_id}")
async def get_financement(financement_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single financement by ID."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute(
            "SELECT f.*, p.nom_projet "
            "FROM immo_financement f "
            "LEFT JOIN immo_projets p ON f.projet_id = p.id "
            "WHERE f.id = %s",
            (financement_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Financement non trouvé")

        result = dict(row)
        for k in ("created_at", "updated_at", "date_demande", "date_approbation",
                   "date_deblocage_initial", "date_echeance"):
            if result.get(k):
                result[k] = str(result[k])
        for k in ("montant_demande", "montant_approuve", "taux_interet_annuel",
                   "mise_de_fonds_pct", "mise_de_fonds_montant",
                   "prime_schl_pct", "prime_schl_montant", "ratio_pret_valeur_pct",
                   "ratio_couverture_dette", "test_resistance_taux",
                   "interets_intercalaires_estimes", "frais_evaluation",
                   "frais_notaire", "frais_ouverture", "autres_frais"):
            if result.get(k) is not None:
                result[k] = float(result[k])

        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_financement error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation du financement")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/financements")
async def create_financement(body: FinancementCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new financement."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        # Retry up to 5 times on UNIQUE collision for numero_financement
        financement_id = None
        numero_financement = None
        for _attempt in range(5):
            numero_financement = _gen_numero("FIN")
            try:
                cursor.execute(
                    "INSERT INTO immo_financement "
                    "(projet_id, numero_financement, statut, banque, type_pret, montant_demande, "
                    "montant_approuve, taux_interet_annuel, duree_amortissement_annees, "
                    "mise_de_fonds_pct, mise_de_fonds_montant, date_demande, date_approbation, "
                    "notes, created_by, "
                    "conseiller_nom, conseiller_contact, taux_type, frequence_paiement, "
                    "garanties_requises, assurance_pret_schl, prime_schl_pct, prime_schl_montant, "
                    "ratio_pret_valeur_pct, ratio_couverture_dette, test_resistance_taux, "
                    "financement_progressif, calendrier_deblocages, interets_intercalaires_estimes, "
                    "frais_evaluation, frais_notaire, frais_ouverture, autres_frais, "
                    "date_deblocage_initial, date_echeance, "
                    "created_at, updated_at) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
                    "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
                    "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
                    "RETURNING id",
                    (body.projet_id, numero_financement, body.statut, body.banque, body.type_pret,
                     body.montant_demande, body.montant_approuve, body.taux_interet_annuel,
                     body.duree_amortissement_annees, body.mise_de_fonds_pct, body.mise_de_fonds_montant,
                     body.date_demande, body.date_approbation, body.notes, str(user.user_id),
                     body.conseiller_nom, body.conseiller_contact, body.taux_type,
                     body.frequence_paiement, body.garanties_requises, body.assurance_pret_schl,
                     body.prime_schl_pct, body.prime_schl_montant, body.ratio_pret_valeur_pct,
                     body.ratio_couverture_dette, body.test_resistance_taux,
                     body.financement_progressif, body.calendrier_deblocages,
                     body.interets_intercalaires_estimes, body.frais_evaluation,
                     body.frais_notaire, body.frais_ouverture, body.autres_frais,
                     body.date_deblocage_initial, body.date_echeance),
                )
                row = cursor.fetchone()
                financement_id = row["id"]
                break
            except Exception as e:
                if "unique" in str(e).lower() or "duplicate" in str(e).lower():
                    conn.rollback()
                    db.set_tenant(conn, user.schema)
                    continue
                raise
        if financement_id is None:
            raise HTTPException(status_code=500, detail="Impossible de generer un numero de financement unique")
        conn.commit()

        return {"id": financement_id, "numero_financement": numero_financement, "message": "Financement créé"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_financement error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la création du financement")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/financements/{financement_id}")
async def update_financement(
    financement_id: int, body: FinancementUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update a financement."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    ALLOWED_COLS = {
        "projet_id", "banque", "type_pret", "montant_demande", "montant_approuve",
        "taux_interet_annuel", "duree_amortissement_annees", "mise_de_fonds_pct",
        "mise_de_fonds_montant", "date_demande", "date_approbation", "notes", "statut",
        "conseiller_nom", "conseiller_contact", "taux_type", "frequence_paiement",
        "garanties_requises", "assurance_pret_schl", "prime_schl_pct", "prime_schl_montant",
        "ratio_pret_valeur_pct", "ratio_couverture_dette", "test_resistance_taux",
        "financement_progressif", "calendrier_deblocages", "interets_intercalaires_estimes",
        "frais_evaluation", "frais_notaire", "frais_ouverture", "autres_frais",
        "date_deblocage_initial", "date_echeance",
    }
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ a modifier")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [financement_id]

        cursor.execute(
            f"UPDATE immo_financement SET {', '.join(set_parts)} WHERE id = %s",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Financement non trouvé")

        conn.commit()
        return {"message": "Financement mis à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_financement error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise à jour du financement")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/financements/{financement_id}")
async def delete_financement(financement_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a financement.

    Cascade vers immo_deblocages (financement_id NOT NULL, no FK in DDL).
    Sans ce cleanup, supprimer un financement laisse les deblocages orphelins
    pointant vers un financement_id inexistant.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        # Cascade delete deblocages enfants AVANT le financement.
        try:
            cursor.execute(
                "DELETE FROM immo_deblocages WHERE financement_id = %s",
                (financement_id,),
            )
        except Exception as cascade_exc:
            logger.warning("delete_financement: cascade deblocages failed: %s",
                           cascade_exc)
            try:
                conn.rollback()
            except Exception:
                pass
            try:
                db.set_tenant(conn, user.schema)
            except Exception:
                pass

        cursor.execute("DELETE FROM immo_financement WHERE id = %s", (financement_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Financement non trouvé")

        conn.commit()
        return {"message": "Financement supprime"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_financement error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression du financement")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# UNITES ENDPOINTS
# ============================================

@router.get("/unites")
async def list_unites(
    user: ErpUser = Depends(get_current_user),
    projet_id: int = Query(..., description="ID du projet immobilier"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    """List unites for a given projet (projet_id required)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        # Count
        cursor.execute(
            "SELECT COUNT(*) as total FROM immo_unites WHERE projet_id = %s",
            (projet_id,),
        )
        total = cursor.fetchone()["total"]

        # Fetch page
        offset = (page - 1) * per_page
        cursor.execute(
            "SELECT * FROM immo_unites WHERE projet_id = %s "
            "ORDER BY numero_unite ASC NULLS LAST, id ASC "
            "LIMIT %s OFFSET %s",
            (projet_id, per_page, offset),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("created_at", "updated_at", "date_vente_finale",
                       "date_promesse_achat", "date_debut_bail"):
                if d.get(k):
                    d[k] = str(d[k])
            for k in ("superficie_m2", "prix_vente", "loyer_mensuel", "superficie_pi2"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_unites error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des unites")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/unites")
async def create_unite(body: UniteCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new unite."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute(
            "INSERT INTO immo_unites "
            "(projet_id, numero_unite, type_unite, superficie_m2, nombre_chambres, "
            "nombre_salles_bain, etage, prix_vente, loyer_mensuel, statut, "
            "acheteur_nom, date_vente_finale, notes, "
            "sous_type, superficie_pi2, orientation, acheteur_contact, "
            "date_promesse_achat, locataire_nom, date_debut_bail, duree_bail_mois, "
            "equipements, finitions_speciales, created_by, "
            "created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
            "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
            "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.projet_id, body.numero_unite, body.type_unite, body.superficie_m2,
             body.nombre_chambres, body.nombre_salles_bain, body.etage,
             body.prix_vente, body.loyer_mensuel, body.statut,
             body.acheteur_nom, body.date_vente_finale, body.notes,
             body.sous_type, body.superficie_pi2, body.orientation,
             body.acheteur_contact, body.date_promesse_achat,
             body.locataire_nom, body.date_debut_bail, body.duree_bail_mois,
             body.equipements, body.finitions_speciales, str(user.user_id)),
        )
        row = cursor.fetchone()
        unite_id = row["id"]
        conn.commit()

        return {"id": unite_id, "message": "Unité créée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_unite error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la création de l'unite")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/unites/{unite_id}")
async def update_unite(
    unite_id: int, body: UniteUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update a unite."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    ALLOWED_COLS = {
        "numero_unite", "type_unite", "superficie_m2", "nombre_chambres",
        "nombre_salles_bain", "etage", "prix_vente", "loyer_mensuel",
        "statut", "acheteur_nom", "date_vente_finale", "notes",
        "sous_type", "superficie_pi2", "orientation", "acheteur_contact",
        "date_promesse_achat", "locataire_nom", "date_debut_bail",
        "duree_bail_mois", "equipements", "finitions_speciales",
    }
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ a modifier")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [unite_id]

        cursor.execute(
            f"UPDATE immo_unites SET {', '.join(set_parts)} WHERE id = %s",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Unite non trouvée")

        conn.commit()
        return {"message": "Unite mise à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_unite error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise à jour de l'unite")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/unites/{unite_id}")
async def delete_unite(unite_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a unite.

    Cascade vers immo_livraisons (unite_id NOT NULL) et immo_paiements
    (unite_id nullable) avant la suppression de l'unite. Sans ce cleanup,
    livraisons/paiements gardent un unite_id pointant vers une unite
    supprimee (no FK in DDL).
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        # Cascade vers tables enfant. Chaque DELETE isole : si une table
        # legacy n'existe pas, on rollback puis on continue.
        for child_tbl in ("immo_livraisons", "immo_paiements"):
            try:
                cursor.execute(
                    f"DELETE FROM {child_tbl} WHERE unite_id = %s",
                    (unite_id,),
                )
            except Exception as cascade_exc:
                logger.warning("delete_unite: cascade %s failed: %s",
                               child_tbl, cascade_exc)
                try:
                    conn.rollback()
                except Exception:
                    pass
                try:
                    db.set_tenant(conn, user.schema)
                except Exception:
                    pass

        cursor.execute("DELETE FROM immo_unites WHERE id = %s", (unite_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Unite non trouvée")

        conn.commit()
        return {"message": "Unite supprimée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_unite error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression de l'unite")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# INSPECTIONS ENDPOINTS
# ============================================

@router.get("/inspections")
async def list_inspections(
    user: ErpUser = Depends(get_current_user),
    projet_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """List inspections with optional projet_id filter."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        where_clauses = []
        params = []

        if projet_id is not None:
            where_clauses.append("i.projet_id = %s")
            params.append(projet_id)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        # Count
        cursor.execute(
            f"SELECT COUNT(*) as total FROM immo_inspections i WHERE {where_sql}", params
        )
        total = cursor.fetchone()["total"]

        # Fetch page
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT i.*, p.nom_projet "
            f"FROM immo_inspections i "
            f"LEFT JOIN immo_projets p ON i.projet_id = p.id "
            f"WHERE {where_sql} "
            f"ORDER BY i.date_planifiee DESC NULLS LAST, i.created_at DESC "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("created_at", "updated_at", "date_planifiee", "date_realisee",
                       "date_limite_corrections", "date_corrections",
                       "date_reinspection", "date_inspection"):
                if d.get(k):
                    d[k] = str(d[k])
            for k in ("cout_inspection", "cout_corrections"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_inspections error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des inspections")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/inspections")
async def create_inspection(body: InspectionCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new inspection."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute(
            "INSERT INTO immo_inspections "
            "(projet_id, type_inspection, date_planifiee, date_realisee, inspecteur_nom, "
            "statut, resultat, nombre_deficiences, notes, created_by, "
            "phase_id, unite_id, categorie, inspecteur_organisme, "
            "inspecteur_numero_permis, inspecteur_contact, score_conformite, "
            "deficiences_mineures, deficiences_majeures, deficiences_critiques, "
            "liste_deficiences, corrections_requises, date_limite_corrections, "
            "corrections_effectuees, date_corrections, reinspection_requise, "
            "date_reinspection, reinspection_reussie, rapport_inspection, "
            "photos_jointes, certificat_emis, numero_certificat, "
            "conforme_cnb, conforme_cce, conforme_csst, conforme_municipal, "
            "cout_inspection, cout_corrections, "
            "created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
            "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
            "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
            "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.projet_id, body.type_inspection, body.date_planifiee, body.date_realisee,
             body.inspecteur_nom, body.statut, body.resultat, body.nombre_deficiences,
             body.notes, str(user.user_id),
             body.phase_id, body.unite_id, body.categorie, body.inspecteur_organisme,
             body.inspecteur_numero_permis, body.inspecteur_contact, body.score_conformite,
             body.deficiences_mineures, body.deficiences_majeures, body.deficiences_critiques,
             body.liste_deficiences, body.corrections_requises, body.date_limite_corrections,
             body.corrections_effectuees, body.date_corrections, body.reinspection_requise,
             body.date_reinspection, body.reinspection_reussie, body.rapport_inspection,
             body.photos_jointes, body.certificat_emis, body.numero_certificat,
             body.conforme_cnb, body.conforme_cce, body.conforme_csst, body.conforme_municipal,
             body.cout_inspection, body.cout_corrections),
        )
        row = cursor.fetchone()
        inspection_id = row["id"]
        conn.commit()

        return {"id": inspection_id, "message": "Inspection créée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_inspection error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la création de l'inspection")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/inspections/{inspection_id}")
async def update_inspection(
    inspection_id: int, body: InspectionUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update an inspection."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    ALLOWED_COLS = {
        "projet_id", "type_inspection", "date_planifiee", "date_realisee",
        "inspecteur_nom", "statut", "resultat", "nombre_deficiences", "notes",
        "phase_id", "unite_id", "categorie", "inspecteur_organisme",
        "inspecteur_numero_permis", "inspecteur_contact", "score_conformite",
        "deficiences_mineures", "deficiences_majeures", "deficiences_critiques",
        "liste_deficiences", "corrections_requises", "date_limite_corrections",
        "corrections_effectuees", "date_corrections", "reinspection_requise",
        "date_reinspection", "reinspection_reussie", "rapport_inspection",
        "photos_jointes", "certificat_emis", "numero_certificat",
        "conforme_cnb", "conforme_cce", "conforme_csst", "conforme_municipal",
        "cout_inspection", "cout_corrections",
    }
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ a modifier")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [inspection_id]

        cursor.execute(
            f"UPDATE immo_inspections SET {', '.join(set_parts)} WHERE id = %s",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Inspection non trouvée")

        conn.commit()
        return {"message": "Inspection mise à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_inspection error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise à jour de l'inspection")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# PAIEMENTS ENDPOINTS
# ============================================

@router.get("/paiements")
async def list_paiements(
    user: ErpUser = Depends(get_current_user),
    projet_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """List paiements with optional projet_id filter."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        where_clauses = []
        params = []

        if projet_id is not None:
            where_clauses.append("pm.projet_id = %s")
            params.append(projet_id)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        # Count
        cursor.execute(
            f"SELECT COUNT(*) as total FROM immo_paiements pm WHERE {where_sql}", params
        )
        total = cursor.fetchone()["total"]

        # Fetch page
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT pm.*, p.nom_projet "
            f"FROM immo_paiements pm "
            f"LEFT JOIN immo_projets p ON pm.projet_id = p.id "
            f"WHERE {where_sql} "
            f"ORDER BY pm.date_paiement DESC NULLS LAST, pm.created_at DESC "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("created_at", "updated_at", "date_paiement"):
                if d.get(k):
                    d[k] = str(d[k])
            if d.get("montant") is not None:
                d["montant"] = float(d["montant"])
            items.append(d)

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_paiements error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des paiements")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/paiements")
async def create_paiement(body: PaiementCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new paiement."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute(
            "INSERT INTO immo_paiements "
            "(projet_id, type_paiement, categorie, montant, description, "
            "beneficiaire, date_paiement, statut, notes, created_by, "
            "created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.projet_id, body.type_paiement, body.categorie, body.montant,
             body.description, body.beneficiaire, body.date_paiement,
             body.statut, body.notes, str(user.user_id)),
        )
        row = cursor.fetchone()
        paiement_id = row["id"]
        conn.commit()

        return {"id": paiement_id, "message": "Paiement créé"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_paiement error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la création du paiement")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# DEBLOCAGES ENDPOINTS
# ============================================

@router.get("/deblocages")
async def list_deblocages(
    user: ErpUser = Depends(get_current_user),
    financement_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
):
    """List deblocages with optional financement_id filter."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        where_clauses = []
        params = []

        if financement_id is not None:
            where_clauses.append("d.financement_id = %s")
            params.append(financement_id)

        if search:
            where_clauses.append(
                "(LOWER(COALESCE(d.etape_construction,'')) LIKE %s "
                "OR LOWER(COALESCE(d.numero_deblocage,'')) LIKE %s)"
            )
            s = f"%{search.lower()}%"
            params.extend([s, s])

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        cursor.execute(
            f"SELECT COUNT(*) as total FROM immo_deblocages d WHERE {where_sql}", params
        )
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT d.* "
            f"FROM immo_deblocages d "
            f"WHERE {where_sql} "
            f"ORDER BY d.updated_at DESC NULLS LAST "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("created_at", "updated_at", "date_prevue", "date_demande",
                       "date_approbation", "date_deblocage", "date_inspection"):
                if d.get(k):
                    d[k] = str(d[k])
            for k in ("pourcentage_etape", "montant_prevu", "montant_reel"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_deblocages error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des deblocages")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/deblocages/{deblocage_id}")
async def get_deblocage(deblocage_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single deblocage by ID."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute("SELECT * FROM immo_deblocages WHERE id = %s", (deblocage_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Deblocage non trouve")

        result = dict(row)
        for k in ("created_at", "updated_at", "date_prevue", "date_demande",
                   "date_approbation", "date_deblocage", "date_inspection"):
            if result.get(k):
                result[k] = str(result[k])
        for k in ("pourcentage_etape", "montant_prevu", "montant_reel"):
            if result.get(k) is not None:
                result[k] = float(result[k])

        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_deblocage error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation du deblocage")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/deblocages")
async def create_deblocage(body: DeblocageCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new deblocage."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        numero_deblocage = _gen_numero("DEB")

        cursor.execute(
            "INSERT INTO immo_deblocages "
            "(financement_id, numero_deblocage, etape_construction, pourcentage_etape, "
            "montant_prevu, date_prevue, notes, created_by, "
            "created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.financement_id, numero_deblocage, body.etape_construction,
             body.pourcentage_etape, body.montant_prevu, body.date_prevue,
             body.notes, str(user.user_id)),
        )
        row = cursor.fetchone()
        deblocage_id = row["id"]
        conn.commit()

        return {"id": deblocage_id, "numero_deblocage": numero_deblocage, "message": "Deblocage cree"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_deblocage error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation du deblocage")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/deblocages/{deblocage_id}")
async def update_deblocage(
    deblocage_id: int, body: DeblocageUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update a deblocage."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    ALLOWED_COLS = {
        "etape_construction", "pourcentage_etape", "montant_prevu", "montant_reel",
        "statut", "date_prevue", "date_demande", "date_approbation", "date_deblocage",
        "inspection_requise", "inspection_effectuee", "date_inspection",
        "rapport_inspection", "notes",
    }
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ a modifier")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [deblocage_id]

        cursor.execute(
            f"UPDATE immo_deblocages SET {', '.join(set_parts)} WHERE id = %s",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Deblocage non trouve")

        conn.commit()
        return {"message": "Deblocage mis a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_deblocage error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour du deblocage")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/deblocages/{deblocage_id}")
async def delete_deblocage(deblocage_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a deblocage."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute("DELETE FROM immo_deblocages WHERE id = %s", (deblocage_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Deblocage non trouve")

        conn.commit()
        return {"message": "Deblocage supprime"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_deblocage error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression du deblocage")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/deblocages/generer-auto")
async def generer_deblocages_auto(
    financement_id: int = Query(...),
    montant_total: float = Query(...),
    user: ErpUser = Depends(get_current_user),
):
    """Auto-generate 7 standard deblocage rows for a financement."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if montant_total <= 0:
        raise HTTPException(status_code=400, detail="Le montant total doit etre superieur a 0")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        # Verify financement exists
        cursor.execute("SELECT id FROM immo_financement WHERE id = %s", (financement_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Financement non trouve")

        created_ids = []
        for etape, pct in DEBLOCAGE_STAGES:
            montant_prevu = round(montant_total * pct / 100, 2)
            numero_deblocage = _gen_numero("DEB")
            cursor.execute(
                "INSERT INTO immo_deblocages "
                "(financement_id, numero_deblocage, etape_construction, pourcentage_etape, "
                "montant_prevu, created_by, created_at, updated_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
                "RETURNING id",
                (financement_id, numero_deblocage, etape, pct, montant_prevu, str(user.user_id)),
            )
            row = cursor.fetchone()
            created_ids.append(row["id"])

        conn.commit()
        return {
            "message": f"{len(created_ids)} deblocages generes automatiquement",
            "ids": created_ids,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("generer_deblocages_auto error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la generation des deblocages")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# PHASES DE CONSTRUCTION ENDPOINTS
# ============================================

@router.get("/phases")
async def list_phases(
    user: ErpUser = Depends(get_current_user),
    projet_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    """List construction phases with optional projet_id filter."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        where_clauses = []
        params = []

        if projet_id is not None:
            where_clauses.append("ph.projet_id = %s")
            params.append(projet_id)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        cursor.execute(
            f"SELECT COUNT(*) as total FROM immo_construction_phases ph WHERE {where_sql}", params
        )
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT ph.*, p.nom_projet "
            f"FROM immo_construction_phases ph "
            f"LEFT JOIN immo_projets p ON ph.projet_id = p.id "
            f"WHERE {where_sql} "
            f"ORDER BY ph.numero_phase ASC, ph.updated_at DESC NULLS LAST "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("created_at", "updated_at", "date_debut_prevue", "date_debut_reelle",
                       "date_fin_prevue", "date_fin_reelle"):
                if d.get(k):
                    d[k] = str(d[k])
            for k in ("pourcentage_completion", "budget_prevu", "cout_reel",
                       "variance_budget"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            for k in ("date_inspection",):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_phases error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des phases")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/phases/types")
async def get_phase_types(user: ErpUser = Depends(get_current_user)):
    """Return the list of standard construction phases."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    return {"phases": STANDARD_PHASES}


@router.get("/phases/{phase_id}")
async def get_phase(phase_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single construction phase by ID."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute(
            "SELECT ph.*, p.nom_projet "
            "FROM immo_construction_phases ph "
            "LEFT JOIN immo_projets p ON ph.projet_id = p.id "
            "WHERE ph.id = %s",
            (phase_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Phase non trouvee")

        result = dict(row)
        for k in ("created_at", "updated_at", "date_debut_prevue", "date_debut_reelle",
                   "date_fin_prevue", "date_fin_reelle"):
            if result.get(k):
                result[k] = str(result[k])
        for k in ("pourcentage_completion", "budget_prevu", "cout_reel",
                   "variance_budget"):
            if result.get(k) is not None:
                result[k] = float(result[k])
        for k in ("date_inspection",):
            if result.get(k):
                result[k] = str(result[k])

        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_phase error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation de la phase")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/phases")
async def create_phase(body: PhaseConstructionCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new construction phase."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute(
            "INSERT INTO immo_construction_phases "
            "(projet_id, nom_phase, numero_phase, statut, pourcentage_completion, "
            "date_debut_prevue, date_fin_prevue, budget_prevu, inspection_requise, "
            "conforme_cnb, materiaux_commandes, materiaux_recus, "
            "retards_jours, raison_retard, notes, created_by, created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
            "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.projet_id, body.nom_phase, body.numero_phase, body.statut,
             body.pourcentage_completion, body.date_debut_prevue, body.date_fin_prevue,
             body.budget_prevu, body.inspection_requise, body.conforme_cnb,
             body.materiaux_commandes, body.materiaux_recus,
             body.retards_jours, body.raison_retard,
             body.notes, str(user.user_id)),
        )
        row = cursor.fetchone()
        phase_id = row["id"]
        conn.commit()

        return {"id": phase_id, "message": "Phase de construction creee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_phase error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la phase")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/phases/{phase_id}")
async def update_phase(
    phase_id: int, body: PhaseConstructionUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update a construction phase."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    ALLOWED_COLS = {
        "nom_phase", "numero_phase", "statut", "pourcentage_completion",
        "date_debut_prevue", "date_debut_reelle", "date_fin_prevue", "date_fin_reelle",
        "budget_prevu", "cout_reel", "inspection_requise", "inspection_approuvee",
        "conforme_cnb", "materiaux_commandes", "materiaux_recus",
        "retards_jours", "raison_retard", "problemes_rencontres", "notes",
    }
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ a modifier")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [phase_id]

        cursor.execute(
            f"UPDATE immo_construction_phases SET {', '.join(set_parts)} WHERE id = %s",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Phase non trouvee")

        conn.commit()
        return {"message": "Phase mise a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_phase error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour de la phase")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/phases/{phase_id}")
async def delete_phase(phase_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a construction phase."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute("DELETE FROM immo_construction_phases WHERE id = %s", (phase_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Phase non trouvee")

        conn.commit()
        return {"message": "Phase supprimee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_phase error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression de la phase")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# COMMERCIALISATION ENDPOINTS
# ============================================

@router.get("/commercialisation")
async def list_commercialisation(
    user: ErpUser = Depends(get_current_user),
    projet_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """List commercialisation records with optional projet_id filter."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        where_clauses = []
        params = []

        if projet_id is not None:
            where_clauses.append("c.projet_id = %s")
            params.append(projet_id)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        cursor.execute(
            f"SELECT COUNT(*) as total FROM immo_commercialisation c WHERE {where_sql}", params
        )
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT c.*, p.nom_projet "
            f"FROM immo_commercialisation c "
            f"LEFT JOIN immo_projets p ON c.projet_id = p.id "
            f"WHERE {where_sql} "
            f"ORDER BY c.updated_at DESC NULLS LAST "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("created_at", "updated_at", "date_lancement",
                       "date_journee_portes_ouvertes"):
                if d.get(k):
                    d[k] = str(d[k])
            for k in ("prix_moyen_vente", "loyer_moyen", "objectif_pre_ventes_pct",
                       "taux_pre_ventes_actuel_pct", "budget_marketing",
                       "cout_marketing_reel", "commission_courtier_pct"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_commercialisation error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation de la commercialisation")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/commercialisation/{comm_id}")
async def get_commercialisation(comm_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single commercialisation record by ID."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute(
            "SELECT c.*, p.nom_projet "
            "FROM immo_commercialisation c "
            "LEFT JOIN immo_projets p ON c.projet_id = p.id "
            "WHERE c.id = %s",
            (comm_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Commercialisation non trouvee")

        result = dict(row)
        for k in ("created_at", "updated_at", "date_lancement",
                   "date_journee_portes_ouvertes"):
            if result.get(k):
                result[k] = str(result[k])
        for k in ("prix_moyen_vente", "loyer_moyen", "objectif_pre_ventes_pct",
                   "taux_pre_ventes_actuel_pct", "budget_marketing",
                   "cout_marketing_reel", "commission_courtier_pct"):
            if result.get(k) is not None:
                result[k] = float(result[k])

        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_commercialisation error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation de la commercialisation")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/commercialisation")
async def create_commercialisation(body: CommercialisationCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new commercialisation record."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute(
            "INSERT INTO immo_commercialisation "
            "(projet_id, strategie_vente, prix_moyen_vente, loyer_moyen, "
            "objectif_pre_ventes_pct, budget_marketing, site_web, courtier_nom, "
            "commission_courtier_pct, date_lancement, date_journee_portes_ouvertes, "
            "brochure_prete, plans_vente_prets, maquette_3d, notes, created_by, "
            "created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
            "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.projet_id, body.strategie_vente, body.prix_moyen_vente,
             body.loyer_moyen, body.objectif_pre_ventes_pct, body.budget_marketing,
             body.site_web, body.courtier_nom, body.commission_courtier_pct,
             body.date_lancement, body.date_journee_portes_ouvertes,
             body.brochure_prete, body.plans_vente_prets,
             body.maquette_3d, body.notes, str(user.user_id)),
        )
        row = cursor.fetchone()
        comm_id = row["id"]
        conn.commit()

        return {"id": comm_id, "message": "Commercialisation creee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_commercialisation error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la commercialisation")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/commercialisation/{comm_id}")
async def update_commercialisation(
    comm_id: int, body: CommercialisationUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update a commercialisation record."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    ALLOWED_COLS = {
        "strategie_vente", "prix_moyen_vente", "loyer_moyen",
        "objectif_pre_ventes_pct", "budget_marketing", "site_web",
        "courtier_nom", "commission_courtier_pct", "date_lancement",
        "date_journee_portes_ouvertes",
        "brochure_prete", "plans_vente_prets", "maquette_3d", "notes",
        "statut", "nombre_unites_vendues", "nombre_unites_louees",
        "taux_pre_ventes_actuel_pct", "cout_marketing_reel",
    }
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ a modifier")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [comm_id]

        cursor.execute(
            f"UPDATE immo_commercialisation SET {', '.join(set_parts)} WHERE id = %s",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Commercialisation non trouvee")

        conn.commit()
        return {"message": "Commercialisation mise a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_commercialisation error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour de la commercialisation")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/commercialisation/{comm_id}")
async def delete_commercialisation(comm_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a commercialisation record."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute("DELETE FROM immo_commercialisation WHERE id = %s", (comm_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Commercialisation non trouvee")

        conn.commit()
        return {"message": "Commercialisation supprimee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_commercialisation error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression de la commercialisation")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# LIVRAISONS ENDPOINTS
# ============================================

@router.get("/livraisons")
async def list_livraisons(
    user: ErpUser = Depends(get_current_user),
    projet_id: Optional[int] = None,
    unite_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """List livraisons with optional projet_id/unite_id filter."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        where_clauses = []
        params = []

        if projet_id is not None:
            where_clauses.append("l.projet_id = %s")
            params.append(projet_id)
        if unite_id is not None:
            where_clauses.append("l.unite_id = %s")
            params.append(unite_id)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        cursor.execute(
            f"SELECT COUNT(*) as total FROM immo_livraisons l WHERE {where_sql}", params
        )
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT l.*, p.nom_projet "
            f"FROM immo_livraisons l "
            f"LEFT JOIN immo_projets p ON l.projet_id = p.id "
            f"WHERE {where_sql} "
            f"ORDER BY l.updated_at DESC NULLS LAST "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("created_at", "updated_at", "date_livraison_prevue",
                       "date_livraison_reelle", "date_inspection_pre_livraison",
                       "date_fin_garantie"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_livraisons error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des livraisons")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/livraisons/{livraison_id}")
async def get_livraison(livraison_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single livraison by ID."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute(
            "SELECT l.*, p.nom_projet "
            "FROM immo_livraisons l "
            "LEFT JOIN immo_projets p ON l.projet_id = p.id "
            "WHERE l.id = %s",
            (livraison_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Livraison non trouvee")

        result = dict(row)
        for k in ("created_at", "updated_at", "date_livraison_prevue",
                   "date_livraison_reelle", "date_inspection_pre_livraison",
                   "date_fin_garantie"):
            if result.get(k):
                result[k] = str(result[k])

        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_livraison error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation de la livraison")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/livraisons")
async def create_livraison(body: LivraisonCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new livraison."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        numero_livraison = _gen_numero("LIV")

        cursor.execute(
            "INSERT INTO immo_livraisons "
            "(unite_id, projet_id, numero_livraison, beneficiaire_nom, beneficiaire_type, "
            "date_livraison_prevue, inspection_pre_livraison, "
            "liste_deficiences, deficiences_corrigees, cles_remises, "
            "acte_vente_signe, bail_signe, manuel_copropriete, "
            "plans_conformes, certificat_conformite, garantie_legale_vice_cache, "
            "garantie_gcr, duree_garantie_mois, "
            "note_satisfaction, commentaires_client, notes, created_by, "
            "created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,"
            "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
            "%s,%s,%s,%s,"
            "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.unite_id, body.projet_id, numero_livraison,
             body.beneficiaire_nom, body.beneficiaire_type,
             body.date_livraison_prevue, body.inspection_pre_livraison,
             body.liste_deficiences, body.deficiences_corrigees, body.cles_remises,
             body.acte_vente_signe, body.bail_signe, body.manuel_copropriete,
             body.plans_conformes, body.certificat_conformite, body.garantie_legale_vice_cache,
             body.garantie_gcr, body.duree_garantie_mois,
             body.note_satisfaction, body.commentaires_client,
             body.notes, str(user.user_id)),
        )
        row = cursor.fetchone()
        livraison_id = row["id"]
        conn.commit()

        return {"id": livraison_id, "numero_livraison": numero_livraison, "message": "Livraison creee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_livraison error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la livraison")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/livraisons/{livraison_id}")
async def update_livraison(
    livraison_id: int, body: LivraisonUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update a livraison."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    ALLOWED_COLS = {
        "beneficiaire_nom", "beneficiaire_type", "date_livraison_prevue",
        "date_livraison_reelle", "inspection_pre_livraison", "inspection_reussie",
        "liste_deficiences", "deficiences_corrigees", "cles_remises",
        "acte_vente_signe", "bail_signe", "manuel_copropriete",
        "plans_conformes", "certificat_conformite", "garantie_legale_vice_cache",
        "garantie_gcr", "duree_garantie_mois",
        "note_satisfaction", "commentaires_client", "statut", "notes",
    }
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ a modifier")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [livraison_id]

        cursor.execute(
            f"UPDATE immo_livraisons SET {', '.join(set_parts)} WHERE id = %s",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Livraison non trouvee")

        conn.commit()
        return {"message": "Livraison mise a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_livraison error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour de la livraison")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/livraisons/{livraison_id}")
async def delete_livraison(livraison_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a livraison."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute("DELETE FROM immo_livraisons WHERE id = %s", (livraison_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Livraison non trouvee")

        conn.commit()
        return {"message": "Livraison supprimee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_livraison error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression de la livraison")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# DOCUMENTS ENDPOINTS
# ============================================

@router.get("/documents")
async def list_documents(
    user: ErpUser = Depends(get_current_user),
    projet_id: Optional[int] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """List documents with optional projet_id/search filter."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        where_clauses = []
        params = []

        if projet_id is not None:
            where_clauses.append("doc.projet_id = %s")
            params.append(projet_id)

        if search:
            where_clauses.append(
                "(LOWER(COALESCE(doc.nom_document,'')) LIKE %s "
                "OR LOWER(COALESCE(doc.categorie,'')) LIKE %s "
                "OR LOWER(COALESCE(doc.description,'')) LIKE %s)"
            )
            s = f"%{search.lower()}%"
            params.extend([s, s, s])

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        cursor.execute(
            f"SELECT COUNT(*) as total FROM immo_documents doc WHERE {where_sql}", params
        )
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT doc.*, p.nom_projet "
            f"FROM immo_documents doc "
            f"LEFT JOIN immo_projets p ON doc.projet_id = p.id "
            f"WHERE {where_sql} "
            f"ORDER BY doc.updated_at DESC NULLS LAST "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("created_at", "updated_at", "date_document", "date_expiration"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_documents error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des documents")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/documents/{document_id}")
async def get_document(document_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single document by ID."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute(
            "SELECT doc.*, p.nom_projet "
            "FROM immo_documents doc "
            "LEFT JOIN immo_projets p ON doc.projet_id = p.id "
            "WHERE doc.id = %s",
            (document_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Document non trouve")

        result = dict(row)
        for k in ("created_at", "updated_at", "date_document", "date_expiration"):
            if result.get(k):
                result[k] = str(result[k])

        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_document error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation du document")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/documents")
async def create_document(body: DocumentCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new document record."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute(
            "INSERT INTO immo_documents "
            "(projet_id, nom_document, categorie, type_fichier, description, "
            "chemin_fichier, taille_kb, confidentiel, date_document, "
            "date_expiration, notes, created_by, "
            "created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
            "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.projet_id, body.nom_document, body.categorie, body.type_fichier,
             body.description, body.chemin_fichier, body.taille_kb,
             body.confidentiel, body.date_document, body.date_expiration,
             body.notes, str(user.user_id)),
        )
        row = cursor.fetchone()
        document_id = row["id"]
        conn.commit()

        return {"id": document_id, "message": "Document cree"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_document error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation du document")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/documents/{document_id}")
async def delete_document(document_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a document record."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        cursor.execute("DELETE FROM immo_documents WHERE id = %s", (document_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Document non trouve")

        conn.commit()
        return {"message": "Document supprime"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_document error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression du document")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# CALCULATORS
# ============================================

@router.post("/calculer-mensualite")
async def calculer_mensualite(body: MensualiteRequest, user: ErpUser = Depends(get_current_user)):
    """Calculate monthly mortgage payment.

    Formula: M = P * [r(1+r)^n] / [(1+r)^n - 1]
    where P = capital, r = monthly interest rate, n = total months.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    try:
        capital = body.capital
        taux_annuel = body.taux_annuel
        duree_annees = body.duree_annees

        if capital <= 0:
            raise HTTPException(status_code=400, detail="Le capital doit etre superieur a 0")
        if taux_annuel < 0:
            raise HTTPException(status_code=400, detail="Le taux d'interet ne peut pas etre negatif")
        if duree_annees <= 0:
            raise HTTPException(status_code=400, detail="La duree doit etre superieure a 0")

        n = duree_annees * 12  # total months

        if taux_annuel == 0:
            # No interest - simple division
            mensualite = capital / n
        else:
            r = (taux_annuel / 100) / 12  # monthly rate
            mensualite = capital * (r * math.pow(1 + r, n)) / (math.pow(1 + r, n) - 1)

        cout_total = mensualite * n
        interets_totaux = cout_total - capital

        return {
            "mensualite": round(mensualite, 2),
            "cout_total": round(cout_total, 2),
            "interets_totaux": round(interets_totaux, 2),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("calculer_mensualite error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du calcul de la mensualite")


@router.post("/calculer-amortissement")
async def calculer_amortissement(body: AmortissementRequest, user: ErpUser = Depends(get_current_user)):
    """Calculate full amortization schedule with support for different payment frequencies."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    try:
        capital = body.capital
        taux_annuel = body.taux_annuel
        duree_annees = body.duree_annees
        frequence = body.frequence

        if capital <= 0:
            raise HTTPException(status_code=400, detail="Le capital doit etre superieur a 0")
        if taux_annuel < 0:
            raise HTTPException(status_code=400, detail="Le taux ne peut pas etre negatif")
        if duree_annees <= 0:
            raise HTTPException(status_code=400, detail="La duree doit etre superieure a 0")

        # Determine periods per year
        freq_map = {
            "Mensuel": 12,
            "Bi-hebdomadaire": 26,
            "Hebdomadaire": 52,
        }
        periodes_par_annee = freq_map.get(frequence, 12)
        n_total = duree_annees * periodes_par_annee

        if taux_annuel == 0:
            paiement = capital / n_total
            tableau = []
            solde = capital
            for i in range(1, n_total + 1):
                interet = 0.0
                capital_rembourse = paiement
                solde -= capital_rembourse
                if solde < 0:
                    solde = 0
                tableau.append({
                    "periode": i,
                    "paiement": round(paiement, 2),
                    "capital": round(capital_rembourse, 2),
                    "interet": 0.0,
                    "solde": round(solde, 2),
                })
            return {
                "tableau": tableau,
                "resume": {
                    "mensualite": round(paiement, 2),
                    "totalInterets": 0.0,
                    "coutTotal": round(capital, 2),
                },
            }

        taux_periodique = (taux_annuel / 100) / periodes_par_annee
        paiement = capital * (taux_periodique * math.pow(1 + taux_periodique, n_total)) / \
                   (math.pow(1 + taux_periodique, n_total) - 1)

        tableau = []
        solde = capital
        total_interets = 0.0

        for i in range(1, n_total + 1):
            interet = solde * taux_periodique
            capital_rembourse = paiement - interet
            solde -= capital_rembourse
            total_interets += interet
            if solde < 0.01:
                solde = 0
            tableau.append({
                "periode": i,
                "paiement": round(paiement, 2),
                "capital": round(capital_rembourse, 2),
                "interet": round(interet, 2),
                "solde": round(solde, 2),
            })

        return {
            "tableau": tableau,
            "resume": {
                "mensualite": round(paiement, 2),
                "totalInterets": round(total_interets, 2),
                "coutTotal": round(capital + total_interets, 2),
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("calculer_amortissement error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du calcul d'amortissement")


@router.post("/calculer-interets-intercalaires")
async def calculer_interets_intercalaires(
    body: InteretsIntercalairesRequest, user: ErpUser = Depends(get_current_user)
):
    """Calculate construction interest (interets intercalaires).
    Distributes montant linearly over months, calculates monthly interest on cumulative balance.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    try:
        montant = body.montant_emprunte
        taux_annuel = body.taux_annuel
        duree_mois = body.duree_construction_mois

        if montant <= 0:
            raise HTTPException(status_code=400, detail="Le montant doit etre superieur a 0")
        if taux_annuel < 0:
            raise HTTPException(status_code=400, detail="Le taux ne peut pas etre negatif")
        if duree_mois <= 0:
            raise HTTPException(status_code=400, detail="La duree doit etre superieure a 0")

        taux_mensuel = (taux_annuel / 100) / 12
        deblocage_mensuel = montant / duree_mois

        detail = []
        solde_cumule = 0.0
        total_interets = 0.0

        for mois in range(1, duree_mois + 1):
            solde_cumule += deblocage_mensuel
            interet = solde_cumule * taux_mensuel
            total_interets += interet
            detail.append({
                "mois": mois,
                "deblocage": round(deblocage_mensuel, 2),
                "soldeCumule": round(solde_cumule, 2),
                "interet": round(interet, 2),
            })

        return {
            "totalInterets": round(total_interets, 2),
            "detail": detail,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("calculer_interets_intercalaires error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du calcul des interets intercalaires")


@router.post("/calculer-prime-schl")
async def calculer_prime_schl(body: PrimeSCHLRequest, user: ErpUser = Depends(get_current_user)):
    """Calculate SCHL insurance premium based on 2025 rates.
    Rates: >95%=4.00%, 90-95=3.10%, 85-90=2.80%, 80-85=2.40%, <80=0%.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    try:
        montant_pret = body.montant_pret
        valeur_propriete = body.valeur_propriete

        if valeur_propriete <= 0:
            raise HTTPException(status_code=400, detail="La valeur de la propriete doit etre superieure a 0")
        if montant_pret <= 0:
            raise HTTPException(status_code=400, detail="Le montant du pret doit etre superieur a 0")
        if montant_pret > valeur_propriete:
            raise HTTPException(status_code=400, detail="Le montant du pret ne peut pas depasser la valeur de la propriete")

        ratio_ltv = (montant_pret / valeur_propriete) * 100

        if ratio_ltv > 95:
            prime_pct = 4.00
        elif ratio_ltv > 90:
            prime_pct = 3.10
        elif ratio_ltv > 85:
            prime_pct = 2.80
        elif ratio_ltv > 80:
            prime_pct = 2.40
        else:
            prime_pct = 0.0

        prime_montant = montant_pret * prime_pct / 100
        pret_total = montant_pret + prime_montant

        return {
            "ratioLtv": round(ratio_ltv, 2),
            "primePct": prime_pct,
            "primeMontant": round(prime_montant, 2),
            "pretTotal": round(pret_total, 2),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("calculer_prime_schl error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du calcul de la prime SCHL")


@router.post("/calculer-roi")
async def calculer_roi(body: RoiRequest, user: ErpUser = Depends(get_current_user)):
    """Calculate return on investment for a real estate project."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    try:
        investissement = body.investissement_total
        revenus = body.revenus_annuels
        depenses = body.depenses_annuelles
        duree = body.duree_annees

        if investissement <= 0:
            raise HTTPException(status_code=400, detail="L'investissement doit etre superieur a 0")
        if duree <= 0:
            raise HTTPException(status_code=400, detail="La duree doit etre superieure a 0")
        if revenus < 0:
            raise HTTPException(status_code=400, detail="Les revenus annuels ne peuvent pas etre negatifs")
        if depenses < 0:
            raise HTTPException(status_code=400, detail="Les depenses annuelles ne peuvent pas etre negatives")

        benefice_net_annuel = revenus - depenses
        roi_pct = (benefice_net_annuel * duree / investissement) * 100

        if benefice_net_annuel > 0:
            periode_recuperation = investissement / benefice_net_annuel
        else:
            periode_recuperation = -1  # never recovered

        return {
            "roiPct": round(roi_pct, 2),
            "beneficeNetAnnuel": round(benefice_net_annuel, 2),
            "periodeRecuperation": round(periode_recuperation, 2) if periode_recuperation > 0 else None,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("calculer_roi error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du calcul du ROI")


@router.post("/calculer-cout-total")
async def calculer_cout_total(body: CoutTotalRequest, user: ErpUser = Depends(get_current_user)):
    """Calculate total borrowing cost (mensualite, total, interests)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    try:
        capital = body.capital
        taux_annuel = body.taux_annuel
        duree_annees = body.duree_annees

        if capital <= 0:
            raise HTTPException(status_code=400, detail="Le capital doit etre superieur a 0")
        if taux_annuel < 0:
            raise HTTPException(status_code=400, detail="Le taux ne peut pas etre negatif")
        if duree_annees <= 0:
            raise HTTPException(status_code=400, detail="La duree doit etre superieure a 0")

        n = duree_annees * 12

        if taux_annuel == 0:
            mensualite = capital / n
            cout_total = capital
            interets_totaux = 0.0
        else:
            r = (taux_annuel / 100) / 12
            mensualite = capital * (r * math.pow(1 + r, n)) / (math.pow(1 + r, n) - 1)
            cout_total = mensualite * n
            interets_totaux = cout_total - capital

        return {
            "mensualite": round(mensualite, 2),
            "coutTotal": round(cout_total, 2),
            "interetsTotaux": round(interets_totaux, 2),
            "capital": round(capital, 2),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("calculer_cout_total error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du calcul du cout total")


# ============================================
# AI ENDPOINTS
# ============================================

def _get_immo_ai_client():
    """Get anthropic client for immobilier AI endpoints."""
    if anthropic is None:
        return None
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return None
    return anthropic.Anthropic(api_key=api_key)


@router.post("/ia/analyser-projet")
async def ia_analyser_projet(
    projet_id: int = Query(...),
    user: ErpUser = Depends(get_current_user),
):
    """AI-powered project analysis. Fetches projet + financement data and returns structured analysis."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")

    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    credits_ok, balance = _check_credits(user)
    if not credits_ok:
        raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    client = _get_immo_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Client Anthropic non configure")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        # Fetch project
        cursor.execute("SELECT * FROM immo_projets WHERE id = %s", (projet_id,))
        projet = cursor.fetchone()
        if not projet:
            raise HTTPException(status_code=404, detail="Projet immobilier non trouve")
        projet_data = dict(projet)
        for k, v in projet_data.items():
            if hasattr(v, 'isoformat'):
                projet_data[k] = v.isoformat()
            elif hasattr(v, '__float__'):
                projet_data[k] = float(v)

        # Fetch financement
        cursor.execute("SELECT * FROM immo_financement WHERE projet_id = %s", (projet_id,))
        fin_rows = cursor.fetchall()
        financements = []
        for fr in fin_rows:
            fd = dict(fr)
            for k, v in fd.items():
                if hasattr(v, 'isoformat'):
                    fd[k] = v.isoformat()
                elif hasattr(v, '__float__'):
                    fd[k] = float(v)
            financements.append(fd)

        # Fetch unites summary
        cursor.execute(
            "SELECT COUNT(*) as total, "
            "COUNT(*) FILTER (WHERE statut = 'Vendu') as vendues, "
            "COUNT(*) FILTER (WHERE statut = 'Disponible') as disponibles, "
            "COALESCE(AVG(prix_vente), 0) as prix_moyen "
            "FROM immo_unites WHERE projet_id = %s",
            (projet_id,),
        )
        unites_summary = dict(cursor.fetchone())
        if unites_summary.get("prix_moyen") is not None:
            unites_summary["prix_moyen"] = float(unites_summary["prix_moyen"])

        prompt_data = json.dumps({
            "projet": projet_data,
            "financements": financements,
            "unites_resume": unites_summary,
        }, ensure_ascii=False, default=str)

        user_message = (
            f"Analyse ce projet immobilier et retourne une analyse structuree en JSON "
            f"avec les sections: faisabilite (score 1-10, justification), "
            f"risques (liste), opportunites (liste), recommandations (liste), "
            f"ratios_financiers (ROI, ratio_pret_valeur, couverture_dette), "
            f"verdict (Favorable/Neutre/Defavorable avec explication).\n\n"
            f"Donnees du projet:\n{prompt_data}"
        )

        model_name = "claude-opus-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=IMMO_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Cost: Opus pricing with 30% markup
        cost = (input_tokens * 0.015 + output_tokens * 0.075) / 1000 * 1.30

        track_ai_usage(user, "immobilier_analyser_projet", input_tokens, output_tokens,
                       cost, 0, True, model=model_name)
        _deduct_credits(user, cost)

        # Try to parse as JSON
        analysis = response_text
        try:
            analysis = json.loads(response_text)
        except (json.JSONDecodeError, TypeError):
            # Return raw text if not parseable
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
    except anthropic.APIError as exc:
        status = getattr(exc, 'status_code', 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse pour l'API IA")
        elif status == 529:
            raise HTTPException(status_code=529, detail="API IA surchargee, reessayez plus tard")
        logger.error("ia_analyser_projet API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur API IA")
    except Exception as exc:
        logger.error("ia_analyser_projet error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'analyse IA du projet")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/ia/chat")
async def ia_chat(body: IaChatRequest, user: ErpUser = Depends(get_current_user)):
    """AI chat for immobilier questions. Uses Claude Sonnet."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")

    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    credits_ok, balance = _check_credits(user)
    if not credits_ok:
        raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    client = _get_immo_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Client Anthropic non configure")

    try:
        user_content = body.question
        if body.context:
            user_content = f"Contexte additionnel:\n{body.context}\n\nQuestion:\n{body.question}"

        model_name = "claude-sonnet-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=IMMO_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Cost: Sonnet pricing with 30% markup
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30

        track_ai_usage(user, "immobilier_chat", input_tokens, output_tokens,
                       cost, 0, True, model=model_name)
        _deduct_credits(user, cost)

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
    except anthropic.APIError as exc:
        status = getattr(exc, 'status_code', 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse pour l'API IA")
        elif status == 529:
            raise HTTPException(status_code=529, detail="API IA surchargee, reessayez plus tard")
        logger.error("ia_chat API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur API IA")
    except Exception as exc:
        logger.error("ia_chat error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chat IA immobilier")


@router.post("/ia/rapport-financement")
async def ia_rapport_financement(
    projet_id: int = Query(...),
    user: ErpUser = Depends(get_current_user),
):
    """Generate a financing report using AI. Fetches projet + financement + deblocages."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")

    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    credits_ok, balance = _check_credits(user)
    if not credits_ok:
        raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    client = _get_immo_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Client Anthropic non configure")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immo_tables(cursor)
        conn.commit()

        # Fetch project
        cursor.execute("SELECT * FROM immo_projets WHERE id = %s", (projet_id,))
        projet = cursor.fetchone()
        if not projet:
            raise HTTPException(status_code=404, detail="Projet immobilier non trouve")
        projet_data = dict(projet)
        for k, v in projet_data.items():
            if hasattr(v, 'isoformat'):
                projet_data[k] = v.isoformat()
            elif hasattr(v, '__float__'):
                projet_data[k] = float(v)

        # Fetch financements
        cursor.execute("SELECT * FROM immo_financement WHERE projet_id = %s", (projet_id,))
        financements = []
        for fr in cursor.fetchall():
            fd = dict(fr)
            for k, v in fd.items():
                if hasattr(v, 'isoformat'):
                    fd[k] = v.isoformat()
                elif hasattr(v, '__float__'):
                    fd[k] = float(v)
            financements.append(fd)

        # Fetch deblocages for each financement
        deblocages_all = []
        for fin in financements:
            cursor.execute(
                "SELECT * FROM immo_deblocages WHERE financement_id = %s ORDER BY pourcentage_etape",
                (fin["id"],),
            )
            for dr in cursor.fetchall():
                dd = dict(dr)
                for k, v in dd.items():
                    if hasattr(v, 'isoformat'):
                        dd[k] = v.isoformat()
                    elif hasattr(v, '__float__'):
                        dd[k] = float(v)
                deblocages_all.append(dd)

        prompt_data = json.dumps({
            "projet": projet_data,
            "financements": financements,
            "deblocages": deblocages_all,
        }, ensure_ascii=False, default=str)

        user_message = (
            f"Genere un rapport de financement complet en markdown pour ce projet immobilier. "
            f"Le rapport doit inclure:\n"
            f"1. Resume executif\n"
            f"2. Structure du financement (montants, taux, conditions)\n"
            f"3. Calendrier des deblocages\n"
            f"4. Analyse des couts (interets intercalaires, frais, primes)\n"
            f"5. Indicateurs financiers (ratio pret-valeur, couverture dette, ROI)\n"
            f"6. Risques et mitigations\n"
            f"7. Recommandations\n\n"
            f"Donnees:\n{prompt_data}"
        )

        model_name = "claude-sonnet-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=IMMO_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Cost: Sonnet pricing with 30% markup
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30

        track_ai_usage(user, "immobilier_rapport_financement", input_tokens, output_tokens,
                       cost, 0, True, model=model_name)
        _deduct_credits(user, cost)

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
    except anthropic.APIError as exc:
        status = getattr(exc, 'status_code', 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse pour l'API IA")
        elif status == 529:
            raise HTTPException(status_code=529, detail="API IA surchargee, reessayez plus tard")
        logger.error("ia_rapport_financement API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur API IA")
    except Exception as exc:
        logger.error("ia_rapport_financement error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la generation du rapport IA")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/ia/optimiser-financement")
async def ia_optimiser_financement(
    body: IaOptimisationRequest, user: ErpUser = Depends(get_current_user)
):
    """AI-powered financing optimization. Returns structured JSON recommendation."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")

    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")

    credits_ok, balance = _check_credits(user)
    if not credits_ok:
        raise HTTPException(status_code=402, detail="Credits IA insuffisants")

    client = _get_immo_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Client Anthropic non configure")

    try:
        prompt_data = json.dumps({
            "cout_total_projet": body.cout_total_projet,
            "revenus_annuels": body.revenus_annuels,
            "nombre_unites": body.nombre_unites,
            "type_projet": body.type_projet,
        }, ensure_ascii=False)

        user_message = (
            f"Optimise le financement de ce projet immobilier et retourne une recommandation "
            f"structuree en JSON avec les sections:\n"
            f"- structure_recommandee (mise_de_fonds_pct, type_pret, duree_recommandee, "
            f"  taux_estime, institution_recommandee)\n"
            f"- calendrier_deblocages (liste d'etapes avec pourcentages)\n"
            f"- optimisations (liste de suggestions concretes pour reduire les couts)\n"
            f"- projections (cashflow_annuel, roi_5ans, valeur_residuelle_estimee)\n"
            f"- score_confiance (1-10 avec justification)\n\n"
            f"Donnees du projet:\n{prompt_data}"
        )

        model_name = "claude-sonnet-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=IMMO_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Cost: Sonnet pricing with 30% markup
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30

        track_ai_usage(user, "immobilier_optimiser_financement", input_tokens, output_tokens,
                       cost, 0, True, model=model_name)
        _deduct_credits(user, cost)

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
    except anthropic.APIError as exc:
        status = getattr(exc, 'status_code', 500)
        if status == 413:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse pour l'API IA")
        elif status == 529:
            raise HTTPException(status_code=529, detail="API IA surchargee, reessayez plus tard")
        logger.error("ia_optimiser_financement API error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur API IA")
    except Exception as exc:
        logger.error("ia_optimiser_financement error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'optimisation IA du financement")
