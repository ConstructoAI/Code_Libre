"""
ERP React - Fonds de Prevoyance (Loi 16) Router

Module de gestion des fonds de prevoyance pour coproprietes au Quebec.
Conforme aux exigences du Code civil du Quebec et de la Loi 16.

Gere:
- Coproprietes
- Composantes du batiment (inventaire)
- Etudes de fonds de prevoyance (25 ans)
- Projections financieres (3 scenarios: uniforme, progressif, variable)
- Carnet d'entretien
- Attestations de vente
- Assistant IA (Claude) pour recommandations
"""

import json
import logging
import os
from datetime import date
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db

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
router = APIRouter(prefix="/fonds-prevoyance", tags=["Fonds Prevoyance"])


# ============================================
# DONNEES DE REFERENCE (Loi 16)
# ============================================

# Accents preserved to match existing Streamlit-era DB rows (critical for data compatibility).
ETATS_COMPOSANTE = ["Excellent", "Bon", "Moyen", "Mauvais", "Critique"]
TYPES_BATIMENT = ["Résidentiel", "Commercial", "Mixte", "Industriel"]
TYPES_STRUCTURE = ["Bois", "Béton", "Acier", "Mixte"]
QUALITES_CONSTRUCTION = ["Économique", "Base", "Moyenne", "Haut de gamme"]
UNITES_MESURE = ["pi²", "ml", "unité", "système", "ensemble", "m²", "m"]
TYPES_INTERVENTION = ["Entretien", "Réparation", "Remplacement"]
PRIORITES = ["Faible", "Moyenne", "Élevée", "Urgente"]
STATUTS_ENTRETIEN = ["Planifié", "En cours", "Complété", "Reporté", "Annulé"]
STATUTS_ATTESTATION = ["Demandée", "En préparation", "Émise", "Annulée"]
SCENARIOS_PROJECTION = ["uniforme", "progressif", "variable"]

FACTEURS_ETAT = {
    "Excellent": 1.10,
    "Bon": 1.00,
    "Moyen": 0.85,
    "Mauvais": 0.70,
    "Critique": 0.00,
}

ORDRES_PROFESSIONNELS = [
    ("OIQ", "Ordre des ingénieurs du Québec"),
    ("OAQ", "Ordre des architectes du Québec"),
    ("OEAQ", "Ordre des évaluateurs agréés du Québec"),
    ("OTPQ", "Ordre des technologues professionnels du Québec"),
    ("CPA", "Comptables professionnels agréés"),
]

FREQUENCES_ENTRETIEN = [
    ("quotidien", "Quotidien"),
    ("hebdomadaire", "Hebdomadaire"),
    ("mensuel", "Mensuel"),
    ("annuel", "Annuel"),
    ("2ans", "Aux 2 ans"),
    ("3ans", "Aux 3 ans"),
    ("5ans", "Aux 5 ans"),
    ("10ans", "Aux 10 ans"),
    ("ponctuel", "Ponctuel"),
]

# Taxonomy matches Streamlit source exactly (4 top-level categories).
CATEGORIES_COMPOSANTES = {
    "Enveloppe du bâtiment": [
        "Toiture",
        "Façades",
        "Portes et fenêtres",
        "Balcons et terrasses",
        "Soffites et fascias",
    ],
    "Structure": [
        "Fondations",
        "Dalles et planchers",
        "Charpente",
        "Escaliers et accès",
    ],
    "Systèmes mécaniques": [
        "Plomberie",
        "Électricité",
        "Chauffage",
        "Ventilation",
        "Climatisation",
    ],
    "Aménagements communs": [
        "Espaces intérieurs",
        "Ascenseurs et équipements",
        "Aménagement extérieur",
        "Aménagement paysager",
        "Équipements divers",
        "Systèmes de sécurité",
    ],
}


# ============================================
# UTILITAIRES
# ============================================

def _empty_to_none(v):
    """Convert empty strings to None (useful for date fields)."""
    return None if isinstance(v, str) and v.strip() == "" else v


def _strip_non_empty(v):
    """Strip whitespace, reject empty strings. Passes None through."""
    if v is None:
        return v
    v = str(v).strip()
    if not v:
        raise ValueError("Ne peut pas etre vide")
    return v


def _to_float(value: Any) -> Optional[float]:
    """Convert Decimal/numeric DB values to float, preserving None."""
    return None if value is None else float(value)


def _to_str_date(value: Any) -> Optional[str]:
    """Convert date/datetime DB values to str, preserving None."""
    return None if value is None else str(value)


def _calculer_duree_vie_restante(
    annee_installation: Optional[int],
    duree_vie_theorique: Optional[int],
    etat_actuel: Optional[str],
) -> Optional[int]:
    """Calculate remaining life based on installation year, theoretical life, and condition.
    Matches the Streamlit formula exactly. Returns None if inputs insufficient."""
    if annee_installation is None or duree_vie_theorique is None:
        return None
    annee_actuelle = date.today().year
    age_actuel = annee_actuelle - annee_installation
    vie_theorique_restante = duree_vie_theorique - age_actuel
    facteur = FACTEURS_ETAT.get(etat_actuel or "Bon", 1.00)
    if etat_actuel == "Critique":
        return 0
    vie_ajustee = round(vie_theorique_restante * facteur)
    return max(0, vie_ajustee)


def _calculer_cout_futur(cout_actuel: float, annees: int, taux_inflation: float) -> float:
    """Future value with compound inflation: CF = CA x (1 + i)^n."""
    return cout_actuel * ((1 + taux_inflation) ** annees)


def _calculer_contribution_uniforme(
    van_depenses: float, solde_initial: float, taux_rendement: float, periode: int
) -> float:
    """Uniform annual contribution (annuity). C = (VAN - S0) / [(1 - (1+r)^-n) / r].
    Guards against periode <= 0 and taux_rendement <= -1 (undefined math)."""
    if periode is None or periode <= 0:
        return 0.0
    if taux_rendement is not None and taux_rendement > 0 and taux_rendement > -1:
        facteur = (1 - (1 + taux_rendement) ** -periode) / taux_rendement
        if facteur == 0:
            return 0.0
        contribution = (van_depenses - solde_initial) / facteur
    else:
        contribution = (van_depenses - solde_initial) / periode
    return max(0.0, contribution)


def _calculer_valeur_reconstruction(
    superficie: float, qualite: str, type_batiment: str, annee_construction: int
) -> float:
    """Rebuild value estimation (Québec 2025 rates). Matches Streamlit line 299-335."""
    taux_base = {
        "Économique": 250,
        "Base": 325,
        "Moyenne": 387,
        "Haut de gamme": 487,
    }
    facteur_type = {
        "Résidentiel": 1.0,
        "Commercial": 1.15,
        "Mixte": 1.08,
        "Industriel": 0.95,
    }
    age = date.today().year - annee_construction
    if age > 50:
        facteur_age = 0.85
    elif age > 30:
        facteur_age = 0.90
    elif age > 15:
        facteur_age = 0.95
    else:
        facteur_age = 1.0
    valeur = (
        superficie
        * taux_base.get(qualite, 325)
        * facteur_type.get(type_batiment, 1.0)
        * facteur_age
    )
    return round(valeur, 2)


# ============================================
# DDL - CREATION DES TABLES (idempotent)
# ============================================

def _ensure_fp_tables(cursor):
    """Create Fonds de Prevoyance tables if they don't exist. Idempotent.

    Le SAVEPOINT autour des CREATE INDEX (sp_fp_idx) exige un bloc
    transactionnel. psycopg2 pool peut retourner des connexions en
    autocommit=True (lecon #122) — dans ce mode SAVEPOINT echoue avec
    "SAVEPOINT can only be used in transaction blocks".

    On bascule temporairement en autocommit=False, on commit les DDL a la fin,
    et on restaure l'etat d'origine pour ne pas polluer le pool psycopg2.
    Meme pattern que integration.py / immobilier.py / b2b.py / emails.py.
    """
    conn = cursor.connection
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

        _run_fp_tables_ddl(cursor)

        try:
            conn.commit()
        except Exception as commit_exc:
            try:
                conn.rollback()
            except Exception as rollback_exc:
                import logging
                logging.getLogger(__name__).error(
                    "fonds_prevoyance: commit AND rollback failed. "
                    "commit=%s | rollback=%s",
                    commit_exc, rollback_exc,
                )
            raise
    finally:
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception as restore_exc:
                import logging
                logging.getLogger(__name__).warning(
                    "fonds_prevoyance: restore conn.autocommit=%s failed: %s",
                    prev_autocommit, restore_exc,
                )


def _run_fp_tables_ddl(cursor):
    """Body interne de _ensure_fp_tables. Extrait pour permettre
    l'encadrement autocommit/commit/restore sans reecrire la logique DDL."""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS fp_coproprietes (
            id SERIAL PRIMARY KEY,
            nom_copropriete VARCHAR(200) NOT NULL,
            adresse_complete TEXT NOT NULL,
            ville VARCHAR(100),
            code_postal VARCHAR(10),
            annee_construction INTEGER,
            nombre_unites INTEGER,
            superficie_totale_pc DECIMAL(12, 2),
            valeur_reconstruction DECIMAL(14, 2),
            type_batiment VARCHAR(50),
            nombre_etages INTEGER,
            type_structure VARCHAR(50),
            qualite_construction VARCHAR(50),
            notes TEXT,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            derniere_maj TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS fp_composantes_batiment (
            id SERIAL PRIMARY KEY,
            id_copropriete INTEGER REFERENCES fp_coproprietes(id) ON DELETE CASCADE,
            categorie VARCHAR(100) NOT NULL,
            sous_categorie VARCHAR(100),
            description_detaillee TEXT,
            quantite DECIMAL(10, 2),
            unite_mesure VARCHAR(20),
            annee_installation INTEGER,
            duree_vie_theorique INTEGER,
            duree_vie_restante INTEGER,
            etat_actuel VARCHAR(20),
            cout_remplacement_unitaire DECIMAL(12, 2),
            cout_remplacement_total DECIMAL(14, 2),
            date_derniere_inspection DATE,
            notes_inspection TEXT,
            priorite VARCHAR(20),
            photo_url TEXT,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            derniere_maj TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS fp_etudes (
            id SERIAL PRIMARY KEY,
            id_copropriete INTEGER REFERENCES fp_coproprietes(id) ON DELETE CASCADE,
            date_etude DATE NOT NULL,
            professionnel_responsable VARCHAR(200) NOT NULL,
            ordre_professionnel VARCHAR(10),
            numero_permis VARCHAR(50),
            periode_couverte INTEGER DEFAULT 25,
            periode_debut INTEGER,
            periode_fin INTEGER,
            montant_fonds_actuel DECIMAL(14, 2),
            montant_recommande_debut_annee DECIMAL(14, 2),
            contribution_annuelle_recommandee DECIMAL(12, 2),
            methodologie_calcul TEXT,
            taux_inflation_suppose DECIMAL(5, 2),
            taux_rendement_suppose DECIMAL(5, 2),
            contingence_pourcentage DECIMAL(5, 2),
            date_prochaine_revision DATE,
            statut_conformite BOOLEAN DEFAULT FALSE,
            notes TEXT,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            derniere_maj TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS fp_projections (
            id SERIAL PRIMARY KEY,
            id_etude INTEGER REFERENCES fp_etudes(id) ON DELETE CASCADE,
            annee_projection INTEGER NOT NULL,
            scenario VARCHAR(50),
            travaux_prevus TEXT,
            couts_estimes DECIMAL(14, 2),
            inflation_cumulee DECIMAL(14, 2),
            solde_debut_annee DECIMAL(14, 2),
            contributions_annee DECIMAL(12, 2),
            rendements_annee DECIMAL(12, 2),
            depenses_annee DECIMAL(14, 2),
            solde_fin_annee DECIMAL(14, 2),
            deficit_surplus DECIMAL(14, 2),
            notes TEXT
        )
    """)
    # Indexes wrapped in SAVEPOINT: two workers calling generate-projections
    # simultaneously on a fresh tenant can race on pg_class_relname_nsp_index.
    # Without a savepoint the outer transaction aborts and the CREATE TABLE
    # below ("fp_carnet_entretien") crashes with "current transaction is
    # aborted".
    cursor.execute("SAVEPOINT sp_fp_idx")
    try:
        # Unique key to prevent duplicate rows from concurrent generate-projections calls.
        cursor.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_fp_projections_etude_annee_scenario
            ON fp_projections(id_etude, annee_projection, scenario)
        """)
        # Indexes on FK columns for hot read paths.
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_fp_composantes_copro ON fp_composantes_batiment(id_copropriete)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_fp_etudes_copro ON fp_etudes(id_copropriete)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_fp_carnet_copro ON fp_carnet_entretien(id_copropriete)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_fp_attest_copro ON fp_attestations_vente(id_copropriete)")
        cursor.execute("RELEASE SAVEPOINT sp_fp_idx")
    except Exception as exc:
        try:
            cursor.execute("ROLLBACK TO SAVEPOINT sp_fp_idx")
        except Exception:
            pass
        _msg = str(exc).lower()
        if not any(tok in _msg for tok in ("duplicate key", "pg_class_relname", "already exists")):
            raise
        import logging
        logging.getLogger(__name__).warning("fp indexes race: %s", exc)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS fp_carnet_entretien (
            id SERIAL PRIMARY KEY,
            id_copropriete INTEGER REFERENCES fp_coproprietes(id) ON DELETE CASCADE,
            id_composante INTEGER REFERENCES fp_composantes_batiment(id) ON DELETE SET NULL,
            type_intervention VARCHAR(50),
            description_travaux TEXT NOT NULL,
            date_prevue DATE,
            date_realisee DATE,
            frequence VARCHAR(50),
            cout_prevu DECIMAL(12, 2),
            cout_reel DECIMAL(12, 2),
            entrepreneur VARCHAR(200),
            numero_contrat VARCHAR(100),
            garantie_duree INTEGER,
            garantie_expiration DATE,
            statut VARCHAR(20),
            documents_joints TEXT,
            notes TEXT,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            derniere_maj TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS fp_attestations_vente (
            id SERIAL PRIMARY KEY,
            id_copropriete INTEGER REFERENCES fp_coproprietes(id) ON DELETE CASCADE,
            numero_unite VARCHAR(50),
            nom_vendeur VARCHAR(200),
            nom_acheteur VARCHAR(200),
            date_demande DATE NOT NULL,
            date_emission DATE,
            montant_fonds_prevoyance DECIMAL(14, 2),
            montant_recommande DECIMAL(14, 2),
            contributions_arrieres DECIMAL(12, 2),
            travaux_votes_montant DECIMAL(14, 2),
            travaux_votes_description TEXT,
            restrictions_declarations TEXT,
            date_validite DATE,
            emise_par VARCHAR(200),
            statut VARCHAR(20),
            document_pdf_url TEXT,
            notes TEXT,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)


# ============================================
# PYDANTIC MODELS - COPROPRIETES
# ============================================

class CoproprieteCreate(BaseModel):
    nom_copropriete: str
    adresse_complete: str
    ville: Optional[str] = None
    code_postal: Optional[str] = None
    annee_construction: Optional[int] = Field(default=None, ge=1800, le=2100)
    nombre_unites: Optional[int] = Field(default=None, ge=0, le=100000)
    superficie_totale_pc: Optional[float] = Field(default=None, ge=0, le=1e9)
    valeur_reconstruction: Optional[float] = Field(default=None, ge=0, le=1e12)
    type_batiment: Optional[str] = None
    nombre_etages: Optional[int] = Field(default=None, ge=0, le=500)
    type_structure: Optional[str] = None
    qualite_construction: Optional[str] = None
    notes: Optional[str] = None

    _nom_validator = field_validator("nom_copropriete", mode="before")(_strip_non_empty)
    _adresse_validator = field_validator("adresse_complete", mode="before")(_strip_non_empty)


class CoproprieteUpdate(BaseModel):
    nom_copropriete: Optional[str] = None
    adresse_complete: Optional[str] = None
    ville: Optional[str] = None
    code_postal: Optional[str] = None
    annee_construction: Optional[int] = Field(default=None, ge=1800, le=2100)
    nombre_unites: Optional[int] = Field(default=None, ge=0, le=100000)
    superficie_totale_pc: Optional[float] = Field(default=None, ge=0, le=1e9)
    valeur_reconstruction: Optional[float] = Field(default=None, ge=0, le=1e12)
    type_batiment: Optional[str] = None
    nombre_etages: Optional[int] = Field(default=None, ge=0, le=500)
    type_structure: Optional[str] = None
    qualite_construction: Optional[str] = None
    notes: Optional[str] = None


# ============================================
# PYDANTIC MODELS - COMPOSANTES
# ============================================

class ComposanteCreate(BaseModel):
    id_copropriete: int
    categorie: str
    sous_categorie: Optional[str] = None
    description_detaillee: Optional[str] = None
    quantite: Optional[float] = Field(default=None, ge=0, le=1e9)
    unite_mesure: Optional[str] = None
    annee_installation: Optional[int] = Field(default=None, ge=1800, le=2100)
    duree_vie_theorique: Optional[int] = Field(default=None, ge=1, le=200)
    duree_vie_restante: Optional[int] = Field(default=None, ge=0, le=200)
    etat_actuel: Optional[str] = None
    cout_remplacement_unitaire: Optional[float] = Field(default=None, ge=0, le=1e9)
    cout_remplacement_total: Optional[float] = Field(default=None, ge=0, le=1e12)
    date_derniere_inspection: Optional[str] = None
    notes_inspection: Optional[str] = None
    priorite: Optional[str] = None
    photo_url: Optional[str] = None

    _categorie_validator = field_validator("categorie", mode="before")(_strip_non_empty)
    _empty_dates = field_validator("date_derniere_inspection", mode="before")(_empty_to_none)


class ComposanteUpdate(BaseModel):
    categorie: Optional[str] = None
    sous_categorie: Optional[str] = None
    description_detaillee: Optional[str] = None
    quantite: Optional[float] = Field(default=None, ge=0, le=1e9)
    unite_mesure: Optional[str] = None
    annee_installation: Optional[int] = Field(default=None, ge=1800, le=2100)
    duree_vie_theorique: Optional[int] = Field(default=None, ge=1, le=200)
    duree_vie_restante: Optional[int] = Field(default=None, ge=0, le=200)
    etat_actuel: Optional[str] = None
    cout_remplacement_unitaire: Optional[float] = Field(default=None, ge=0, le=1e9)
    cout_remplacement_total: Optional[float] = Field(default=None, ge=0, le=1e12)
    date_derniere_inspection: Optional[str] = None
    notes_inspection: Optional[str] = None
    priorite: Optional[str] = None
    photo_url: Optional[str] = None

    _empty_dates = field_validator("date_derniere_inspection", mode="before")(_empty_to_none)


# ============================================
# PYDANTIC MODELS - ETUDES
# ============================================

class EtudeCreate(BaseModel):
    id_copropriete: int
    date_etude: str
    professionnel_responsable: str
    ordre_professionnel: Optional[str] = None
    numero_permis: Optional[str] = None
    periode_couverte: Optional[int] = Field(default=25, ge=1, le=100)
    periode_debut: Optional[int] = None
    periode_fin: Optional[int] = None
    montant_fonds_actuel: Optional[float] = None
    montant_recommande_debut_annee: Optional[float] = None
    contribution_annuelle_recommandee: Optional[float] = None
    methodologie_calcul: Optional[str] = None
    taux_inflation_suppose: Optional[float] = None
    taux_rendement_suppose: Optional[float] = None
    contingence_pourcentage: Optional[float] = None
    date_prochaine_revision: Optional[str] = None
    statut_conformite: Optional[bool] = False
    notes: Optional[str] = None

    _prof_validator = field_validator("professionnel_responsable", mode="before")(_strip_non_empty)
    _empty_dates = field_validator("date_etude", "date_prochaine_revision", mode="before")(_empty_to_none)


class EtudeUpdate(BaseModel):
    date_etude: Optional[str] = None
    professionnel_responsable: Optional[str] = None
    ordre_professionnel: Optional[str] = None
    numero_permis: Optional[str] = None
    periode_couverte: Optional[int] = Field(default=None, ge=1, le=100)
    periode_debut: Optional[int] = None
    periode_fin: Optional[int] = None
    montant_fonds_actuel: Optional[float] = None
    montant_recommande_debut_annee: Optional[float] = None
    contribution_annuelle_recommandee: Optional[float] = None
    methodologie_calcul: Optional[str] = None
    taux_inflation_suppose: Optional[float] = None
    taux_rendement_suppose: Optional[float] = None
    contingence_pourcentage: Optional[float] = None
    date_prochaine_revision: Optional[str] = None
    statut_conformite: Optional[bool] = None
    notes: Optional[str] = None

    _empty_dates = field_validator("date_etude", "date_prochaine_revision", mode="before")(_empty_to_none)


# ============================================
# PYDANTIC MODELS - PROJECTIONS
# ============================================

class ProjectionsRequest(BaseModel):
    """Request body for generating projections (3 scenarios).
    Rates are expressed as PERCENTAGES (e.g. 2.5 = 2.5%). Bounded to sane ranges."""
    id_copropriete: int
    solde_initial: Optional[float] = Field(default=0.0, ge=0, le=1e12)
    taux_inflation: Optional[float] = Field(default=3.0, ge=-50.0, le=100.0)
    taux_rendement: Optional[float] = Field(default=2.5, ge=-50.0, le=100.0)
    contingence_pct: Optional[float] = Field(default=10.0, ge=0.0, le=100.0)


# ============================================
# PYDANTIC MODELS - CARNET ENTRETIEN
# ============================================

class EntretienCreate(BaseModel):
    id_copropriete: int
    id_composante: Optional[int] = None
    type_intervention: Optional[str] = None
    description_travaux: str
    date_prevue: Optional[str] = None
    date_realisee: Optional[str] = None
    frequence: Optional[str] = None
    cout_prevu: Optional[float] = None
    cout_reel: Optional[float] = None
    entrepreneur: Optional[str] = None
    numero_contrat: Optional[str] = None
    garantie_duree: Optional[int] = None
    garantie_expiration: Optional[str] = None
    statut: Optional[str] = "Planifié"
    documents_joints: Optional[str] = None
    notes: Optional[str] = None

    _desc_validator = field_validator("description_travaux", mode="before")(_strip_non_empty)
    _empty_dates = field_validator(
        "date_prevue", "date_realisee", "garantie_expiration", mode="before"
    )(_empty_to_none)


class EntretienUpdate(BaseModel):
    id_composante: Optional[int] = None
    type_intervention: Optional[str] = None
    description_travaux: Optional[str] = None
    date_prevue: Optional[str] = None
    date_realisee: Optional[str] = None
    frequence: Optional[str] = None
    cout_prevu: Optional[float] = None
    cout_reel: Optional[float] = None
    entrepreneur: Optional[str] = None
    numero_contrat: Optional[str] = None
    garantie_duree: Optional[int] = None
    garantie_expiration: Optional[str] = None
    statut: Optional[str] = None
    documents_joints: Optional[str] = None
    notes: Optional[str] = None

    _empty_dates = field_validator(
        "date_prevue", "date_realisee", "garantie_expiration", mode="before"
    )(_empty_to_none)


# ============================================
# PYDANTIC MODELS - ATTESTATIONS
# ============================================

class AttestationCreate(BaseModel):
    id_copropriete: int
    numero_unite: Optional[str] = None
    nom_vendeur: Optional[str] = None
    nom_acheteur: Optional[str] = None
    date_demande: str
    date_emission: Optional[str] = None
    montant_fonds_prevoyance: Optional[float] = None
    montant_recommande: Optional[float] = None
    contributions_arrieres: Optional[float] = None
    travaux_votes_montant: Optional[float] = None
    travaux_votes_description: Optional[str] = None
    restrictions_declarations: Optional[str] = None
    date_validite: Optional[str] = None
    emise_par: Optional[str] = None
    statut: Optional[str] = "Demandée"
    document_pdf_url: Optional[str] = None
    notes: Optional[str] = None

    _empty_dates = field_validator(
        "date_demande", "date_emission", "date_validite", mode="before"
    )(_empty_to_none)


class AttestationUpdate(BaseModel):
    numero_unite: Optional[str] = None
    nom_vendeur: Optional[str] = None
    nom_acheteur: Optional[str] = None
    date_demande: Optional[str] = None
    date_emission: Optional[str] = None
    montant_fonds_prevoyance: Optional[float] = None
    montant_recommande: Optional[float] = None
    contributions_arrieres: Optional[float] = None
    travaux_votes_montant: Optional[float] = None
    travaux_votes_description: Optional[str] = None
    restrictions_declarations: Optional[str] = None
    date_validite: Optional[str] = None
    emise_par: Optional[str] = None
    statut: Optional[str] = None
    document_pdf_url: Optional[str] = None
    notes: Optional[str] = None

    _empty_dates = field_validator(
        "date_demande", "date_emission", "date_validite", mode="before"
    )(_empty_to_none)


# ============================================
# PYDANTIC MODELS - IA
# ============================================

class IaAnalyzeCoproRequest(BaseModel):
    id_copropriete: int


class IaChatFpRequest(BaseModel):
    question: str
    id_copropriete: Optional[int] = None
    context: Optional[str] = ""

    _q_validator = field_validator("question", mode="before")(_strip_non_empty)


class IaSuggestContributionRequest(BaseModel):
    cout_total_remplacement: float = Field(ge=0, le=1e12)
    nombre_unites: int = Field(ge=1, le=100000)
    horizon_annees: Optional[int] = Field(default=25, ge=1, le=100)
    solde_actuel: Optional[float] = Field(default=0.0, ge=0, le=1e12)


class IaRapportRequest(BaseModel):
    id_copropriete: int


class ValeurReconstructionRequest(BaseModel):
    superficie: float = Field(gt=0, le=1e9)
    qualite: str
    type_batiment: str
    annee_construction: int = Field(ge=1800, le=2100)


# ============================================
# REFERENCE DATA ENDPOINT
# ============================================

@router.get("/reference")
async def get_reference_data(user: ErpUser = Depends(get_current_user)):
    """Return static reference data (categories, orders, etats, etc.) for frontend dropdowns."""
    return {
        "etatsComposante": ETATS_COMPOSANTE,
        "typesBatiment": TYPES_BATIMENT,
        "typesStructure": TYPES_STRUCTURE,
        "qualitesConstruction": QUALITES_CONSTRUCTION,
        "unitesMesure": UNITES_MESURE,
        "typesIntervention": TYPES_INTERVENTION,
        "priorites": PRIORITES,
        "statutsEntretien": STATUTS_ENTRETIEN,
        "statutsAttestation": STATUTS_ATTESTATION,
        "scenariosProjection": SCENARIOS_PROJECTION,
        "ordresProfessionnels": [{"code": c, "nom": n} for c, n in ORDRES_PROFESSIONNELS],
        "frequencesEntretien": [{"code": c, "nom": n} for c, n in FREQUENCES_ENTRETIEN],
        "categoriesComposantes": CATEGORIES_COMPOSANTES,
    }


# ============================================
# ROW SERIALIZATION HELPERS
# ============================================

_COPROPRIETE_NUMERIC = ("superficie_totale_pc", "valeur_reconstruction")
_COPROPRIETE_DATES = ("date_creation", "derniere_maj")

_COMPOSANTE_NUMERIC = (
    "quantite", "cout_remplacement_unitaire", "cout_remplacement_total",
)
_COMPOSANTE_DATES = ("date_derniere_inspection", "date_creation", "derniere_maj")

_ETUDE_NUMERIC = (
    "montant_fonds_actuel", "montant_recommande_debut_annee",
    "contribution_annuelle_recommandee", "taux_inflation_suppose",
    "taux_rendement_suppose", "contingence_pourcentage",
)
_ETUDE_DATES = ("date_etude", "date_prochaine_revision", "date_creation", "derniere_maj")

_PROJECTION_NUMERIC = (
    "couts_estimes", "inflation_cumulee", "solde_debut_annee",
    "contributions_annee", "rendements_annee", "depenses_annee",
    "solde_fin_annee", "deficit_surplus",
)

_ENTRETIEN_NUMERIC = ("cout_prevu", "cout_reel")
_ENTRETIEN_DATES = (
    "date_prevue", "date_realisee", "garantie_expiration",
    "date_creation", "derniere_maj",
)

_ATTESTATION_NUMERIC = (
    "montant_fonds_prevoyance", "montant_recommande", "contributions_arrieres",
    "travaux_votes_montant",
)
_ATTESTATION_DATES = (
    "date_demande", "date_emission", "date_validite", "date_creation",
)


def _serialize_row(row: dict, numeric_fields: tuple, date_fields: tuple) -> dict:
    """Normalize a DB row: convert Decimal to float, dates to strings."""
    d = dict(row)
    for k in numeric_fields:
        if d.get(k) is not None:
            d[k] = float(d[k])
    for k in date_fields:
        if d.get(k) is not None:
            d[k] = str(d[k])
    return d


# ============================================
# ENDPOINTS - COPROPRIETES
# ============================================

@router.get("/coproprietes")
async def list_coproprietes(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
):
    """List coproprietes with pagination and text search.
    Returns each item enriched with counts (nb_composantes, nb_etudes)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        where_clauses = []
        params: List[Any] = []

        if search:
            where_clauses.append(
                "(LOWER(COALESCE(nom_copropriete,'')) LIKE %s "
                "OR LOWER(COALESCE(adresse_complete,'')) LIKE %s "
                "OR LOWER(COALESCE(ville,'')) LIKE %s)"
            )
            s = f"%{search.lower()}%"
            params.extend([s, s, s])

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        cursor.execute(
            f"SELECT COUNT(*) as total FROM fp_coproprietes WHERE {where_sql}",
            params,
        )
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"""
            SELECT c.*,
                   COUNT(DISTINCT comp.id) as nb_composantes,
                   COUNT(DISTINCT e.id) as nb_etudes
            FROM fp_coproprietes c
            LEFT JOIN fp_composantes_batiment comp ON c.id = comp.id_copropriete
            LEFT JOIN fp_etudes e ON c.id = e.id_copropriete
            WHERE {where_sql}
            GROUP BY c.id
            ORDER BY c.derniere_maj DESC NULLS LAST
            LIMIT %s OFFSET %s
            """,
            params + [per_page, offset],
        )
        items = [
            _serialize_row(row, _COPROPRIETE_NUMERIC, _COPROPRIETE_DATES)
            for row in cursor.fetchall()
        ]
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_coproprietes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des coproprietes")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/coproprietes/{copro_id}")
async def get_copropriete(copro_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single copropriete by ID."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute("SELECT * FROM fp_coproprietes WHERE id = %s", (copro_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Copropriete non trouvee")
        return _serialize_row(row, _COPROPRIETE_NUMERIC, _COPROPRIETE_DATES)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_copropriete error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation de la copropriete")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/coproprietes")
async def create_copropriete(body: CoproprieteCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new copropriete."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute(
            """
            INSERT INTO fp_coproprietes (
                nom_copropriete, adresse_complete, ville, code_postal,
                annee_construction, nombre_unites, superficie_totale_pc,
                valeur_reconstruction, type_batiment, nombre_etages,
                type_structure, qualite_construction, notes
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                body.nom_copropriete,
                body.adresse_complete,
                body.ville,
                body.code_postal,
                body.annee_construction,
                body.nombre_unites,
                body.superficie_totale_pc,
                body.valeur_reconstruction,
                body.type_batiment,
                body.nombre_etages,
                body.type_structure,
                body.qualite_construction,
                body.notes,
            ),
        )
        new_id = cursor.fetchone()["id"]
        conn.commit()
        return {"id": new_id}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_copropriete error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la copropriete")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/coproprietes/{copro_id}")
async def update_copropriete(
    copro_id: int,
    body: CoproprieteUpdate,
    user: ErpUser = Depends(get_current_user),
):
    """Update an existing copropriete (partial update)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute("SELECT id FROM fp_coproprietes WHERE id = %s", (copro_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Copropriete non trouvee")

        set_parts = [f"{k} = %s" for k in payload.keys()]
        set_parts.append("derniere_maj = CURRENT_TIMESTAMP")
        params = list(payload.values()) + [copro_id]

        cursor.execute(
            f"UPDATE fp_coproprietes SET {', '.join(set_parts)} WHERE id = %s",
            params,
        )
        conn.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_copropriete error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour de la copropriete")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/coproprietes/{copro_id}")
async def delete_copropriete(copro_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a copropriete (cascades to composantes, etudes, etc.)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute("DELETE FROM fp_coproprietes WHERE id = %s RETURNING id", (copro_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Copropriete non trouvee")
        conn.commit()
        return {"status": "deleted"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_copropriete error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression de la copropriete")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/coproprietes/{copro_id}/statistiques")
async def get_copropriete_statistiques(copro_id: int, user: ErpUser = Depends(get_current_user)):
    """Compute statistics for a copropriete: component counts, replacement costs, critical items, last study."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        # Copropriete existence
        cursor.execute("SELECT * FROM fp_coproprietes WHERE id = %s", (copro_id,))
        copro_row = cursor.fetchone()
        if not copro_row:
            raise HTTPException(status_code=404, detail="Copropriete non trouvee")
        copropriete = _serialize_row(copro_row, _COPROPRIETE_NUMERIC, _COPROPRIETE_DATES)

        # Composantes aggregates
        cursor.execute(
            """
            SELECT COUNT(*) as nb,
                   COALESCE(SUM(cout_remplacement_total), 0) as cout_total
            FROM fp_composantes_batiment WHERE id_copropriete = %s
            """,
            (copro_id,),
        )
        agg = cursor.fetchone()
        nb_composantes = int(agg["nb"]) if agg else 0
        cout_total_remplacement = float(agg["cout_total"]) if agg and agg["cout_total"] is not None else 0.0

        # Repartition par etat
        cursor.execute(
            """
            SELECT COALESCE(etat_actuel, 'Inconnu') as etat, COUNT(*) as nb
            FROM fp_composantes_batiment
            WHERE id_copropriete = %s
            GROUP BY etat_actuel
            """,
            (copro_id,),
        )
        etats = {row["etat"]: int(row["nb"]) for row in cursor.fetchall()}

        # Composantes critiques (<=5 ans de vie restante)
        cursor.execute(
            """
            SELECT * FROM fp_composantes_batiment
            WHERE id_copropriete = %s
              AND duree_vie_restante IS NOT NULL
              AND duree_vie_restante <= 5
            ORDER BY duree_vie_restante ASC NULLS LAST
            """,
            (copro_id,),
        )
        critiques = [
            _serialize_row(row, _COMPOSANTE_NUMERIC, _COMPOSANTE_DATES)
            for row in cursor.fetchall()
        ]

        # Derniere etude
        cursor.execute(
            """
            SELECT * FROM fp_etudes
            WHERE id_copropriete = %s
            ORDER BY date_etude DESC NULLS LAST
            LIMIT 1
            """,
            (copro_id,),
        )
        last_row = cursor.fetchone()
        derniere_etude = (
            _serialize_row(last_row, _ETUDE_NUMERIC, _ETUDE_DATES) if last_row else None
        )

        # Nombre total etudes
        cursor.execute(
            "SELECT COUNT(*) as nb FROM fp_etudes WHERE id_copropriete = %s",
            (copro_id,),
        )
        nb_etudes = int(cursor.fetchone()["nb"])

        return {
            "copropriete": copropriete,
            "nb_composantes": nb_composantes,
            "cout_total_remplacement": cout_total_remplacement,
            "etats": etats,
            "composantes_critiques": critiques,
            "nb_critiques": len(critiques),
            "derniere_etude": derniere_etude,
            "nb_etudes": nb_etudes,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_copropriete_statistiques error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du calcul des statistiques")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# ENDPOINTS - COMPOSANTES
# ============================================

@router.get("/coproprietes/{copro_id}/composantes")
async def list_composantes(
    copro_id: int,
    user: ErpUser = Depends(get_current_user),
    group_by_category: bool = Query(False),
    limit: int = Query(5000, ge=1, le=10000, description="Hard cap to protect memory."),
):
    """List all composantes for a copropriete. Optionally group by category.
    Capped at `limit` rows (default 5000) for memory safety."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute(
            """
            SELECT * FROM fp_composantes_batiment
            WHERE id_copropriete = %s
            ORDER BY categorie, sous_categorie, description_detaillee
            LIMIT %s
            """,
            (copro_id, limit),
        )
        items = [
            _serialize_row(row, _COMPOSANTE_NUMERIC, _COMPOSANTE_DATES)
            for row in cursor.fetchall()
        ]

        if group_by_category:
            grouped: Dict[str, List[dict]] = {}
            for item in items:
                cat = item.get("categorie") or "Autre"
                grouped.setdefault(cat, []).append(item)
            return {"items": items, "grouped": grouped, "total": len(items)}

        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_composantes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des composantes")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/composantes")
async def create_composante(body: ComposanteCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new composante. Auto-calculates duree_vie_restante and cout_remplacement_total."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        duree_vie_restante = (
            body.duree_vie_restante
            if body.duree_vie_restante is not None
            else _calculer_duree_vie_restante(
                body.annee_installation, body.duree_vie_theorique, body.etat_actuel
            )
        )

        cout_total = body.cout_remplacement_total
        if cout_total is None and body.quantite is not None and body.cout_remplacement_unitaire is not None:
            cout_total = float(body.quantite) * float(body.cout_remplacement_unitaire)

        cursor.execute(
            """
            INSERT INTO fp_composantes_batiment (
                id_copropriete, categorie, sous_categorie, description_detaillee,
                quantite, unite_mesure, annee_installation, duree_vie_theorique,
                duree_vie_restante, etat_actuel, cout_remplacement_unitaire,
                cout_remplacement_total, date_derniere_inspection, notes_inspection,
                priorite, photo_url
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                body.id_copropriete,
                body.categorie,
                body.sous_categorie,
                body.description_detaillee,
                body.quantite,
                body.unite_mesure,
                body.annee_installation,
                body.duree_vie_theorique,
                duree_vie_restante,
                body.etat_actuel,
                body.cout_remplacement_unitaire,
                cout_total,
                body.date_derniere_inspection,
                body.notes_inspection,
                body.priorite or "Moyenne",
                body.photo_url,
            ),
        )
        new_id = cursor.fetchone()["id"]
        conn.commit()
        return {"id": new_id, "duree_vie_restante": duree_vie_restante, "cout_remplacement_total": cout_total}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_composante error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la composante")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/composantes/{comp_id}")
async def update_composante(
    comp_id: int,
    body: ComposanteUpdate,
    user: ErpUser = Depends(get_current_user),
):
    """Update a composante (partial). Recomputes duree_vie_restante/cout_total when relevant fields change."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute("SELECT * FROM fp_composantes_batiment WHERE id = %s", (comp_id,))
        existing = cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Composante non trouvee")

        merged = dict(existing)
        merged.update(payload)

        # Recompute if any contributing field was in the payload
        if any(k in payload for k in ("annee_installation", "duree_vie_theorique", "etat_actuel")):
            payload["duree_vie_restante"] = _calculer_duree_vie_restante(
                merged.get("annee_installation"),
                merged.get("duree_vie_theorique"),
                merged.get("etat_actuel"),
            )

        if any(k in payload for k in ("quantite", "cout_remplacement_unitaire")):
            q = merged.get("quantite")
            u = merged.get("cout_remplacement_unitaire")
            if q is not None and u is not None:
                payload["cout_remplacement_total"] = float(q) * float(u)

        set_parts = [f"{k} = %s" for k in payload.keys()]
        set_parts.append("derniere_maj = CURRENT_TIMESTAMP")
        params = list(payload.values()) + [comp_id]

        cursor.execute(
            f"UPDATE fp_composantes_batiment SET {', '.join(set_parts)} WHERE id = %s",
            params,
        )
        conn.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_composante error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour de la composante")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/composantes/{comp_id}")
async def delete_composante(comp_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a composante."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute(
            "DELETE FROM fp_composantes_batiment WHERE id = %s RETURNING id", (comp_id,)
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Composante non trouvee")
        conn.commit()
        return {"status": "deleted"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_composante error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression de la composante")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# ENDPOINTS - ETUDES
# ============================================

@router.get("/coproprietes/{copro_id}/etudes")
async def list_etudes(copro_id: int, user: ErpUser = Depends(get_current_user)):
    """List all etudes for a copropriete, most recent first."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute(
            """
            SELECT * FROM fp_etudes
            WHERE id_copropriete = %s
            ORDER BY date_etude DESC NULLS LAST
            """,
            (copro_id,),
        )
        items = [
            _serialize_row(row, _ETUDE_NUMERIC, _ETUDE_DATES)
            for row in cursor.fetchall()
        ]
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_etudes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des etudes")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/etudes/{etude_id}")
async def get_etude(etude_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single etude by ID."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute("SELECT * FROM fp_etudes WHERE id = %s", (etude_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Etude non trouvee")
        return _serialize_row(row, _ETUDE_NUMERIC, _ETUDE_DATES)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_etude error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation de l'etude")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/etudes")
async def create_etude(body: EtudeCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new etude de fonds de prevoyance."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute(
            """
            INSERT INTO fp_etudes (
                id_copropriete, date_etude, professionnel_responsable,
                ordre_professionnel, numero_permis, periode_couverte,
                periode_debut, periode_fin, montant_fonds_actuel,
                montant_recommande_debut_annee, contribution_annuelle_recommandee,
                methodologie_calcul, taux_inflation_suppose, taux_rendement_suppose,
                contingence_pourcentage, date_prochaine_revision,
                statut_conformite, notes
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                body.id_copropriete,
                body.date_etude,
                body.professionnel_responsable,
                body.ordre_professionnel,
                body.numero_permis,
                body.periode_couverte,
                body.periode_debut,
                body.periode_fin,
                body.montant_fonds_actuel,
                body.montant_recommande_debut_annee,
                body.contribution_annuelle_recommandee,
                body.methodologie_calcul,
                body.taux_inflation_suppose,
                body.taux_rendement_suppose,
                body.contingence_pourcentage,
                body.date_prochaine_revision,
                body.statut_conformite,
                body.notes,
            ),
        )
        new_id = cursor.fetchone()["id"]
        conn.commit()
        return {"id": new_id}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_etude error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de l'etude")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/etudes/{etude_id}")
async def update_etude(
    etude_id: int,
    body: EtudeUpdate,
    user: ErpUser = Depends(get_current_user),
):
    """Update an etude (partial update)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute("SELECT id FROM fp_etudes WHERE id = %s", (etude_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Etude non trouvee")

        set_parts = [f"{k} = %s" for k in payload.keys()]
        set_parts.append("derniere_maj = CURRENT_TIMESTAMP")
        params = list(payload.values()) + [etude_id]

        cursor.execute(
            f"UPDATE fp_etudes SET {', '.join(set_parts)} WHERE id = %s",
            params,
        )
        conn.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_etude error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour de l'etude")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/etudes/{etude_id}")
async def delete_etude(etude_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete an etude (cascades to projections)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute("DELETE FROM fp_etudes WHERE id = %s RETURNING id", (etude_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Etude non trouvee")
        conn.commit()
        return {"status": "deleted"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_etude error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression de l'etude")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# ENDPOINTS - PROJECTIONS
# ============================================

def _generer_3_scenarios(
    composantes: List[Dict],
    solde_initial: float,
    taux_inflation: float,
    taux_rendement: float,
    periode: int = 25,
) -> Dict[str, Any]:
    """Generate the 3 projection scenarios (uniforme, progressif, variable).
    Ports the Streamlit logic verbatim with the same formulas."""
    annee_debut = date.today().year
    depenses: Dict[int, float] = {}

    for comp in composantes:
        dvr = comp.get("duree_vie_restante") or 0
        annee_remplacement = annee_debut + dvr
        cout = float(comp.get("cout_remplacement_total") or 0)
        if annee_remplacement <= annee_debut + periode and cout > 0:
            cout_futur = _calculer_cout_futur(cout, dvr, taux_inflation)
            depenses[annee_remplacement] = depenses.get(annee_remplacement, 0.0) + cout_futur

    # Fallback when no expenses are projected (e.g., no composantes yet)
    if not depenses:
        depenses = {annee_debut + 5: 50000.0, annee_debut + 15: 100000.0}

    # --- Scenario 1: uniforme ---
    van_depenses = sum(
        montant / ((1 + taux_rendement) ** (annee - annee_debut))
        for annee, montant in depenses.items()
        if annee >= annee_debut
    )
    contribution_uniforme = _calculer_contribution_uniforme(
        van_depenses, solde_initial, taux_rendement, periode
    )

    projections_uniforme: List[Dict] = []
    solde = solde_initial
    for annee in range(annee_debut, annee_debut + periode):
        depense = depenses.get(annee, 0.0)
        rendement = solde * taux_rendement
        solde_debut = solde
        solde += contribution_uniforme + rendement - depense
        projections_uniforme.append({
            "annee": annee,
            "solde_debut": round(solde_debut, 2),
            "contribution": round(contribution_uniforme, 2),
            "rendement": round(rendement, 2),
            "depenses": round(depense, 2),
            "solde_fin": round(solde, 2),
        })
    scenario_uniforme = {
        "nom": "Contribution uniforme",
        "description": "Meme montant chaque annee - Equite intergenerationnelle parfaite",
        "contribution_annuelle": round(contribution_uniforme, 2),
        "contribution_totale": round(contribution_uniforme * periode, 2),
        "solde_final": round(solde, 2),
        "projections": projections_uniforme,
    }

    # --- Scenario 2: progressif (3%/year increase) ---
    taux_augmentation = 0.03
    contribution_initiale = 1000.0
    best_contribution = contribution_initiale
    for _ in range(100):
        s = solde_initial
        c = contribution_initiale
        for annee in range(annee_debut, annee_debut + periode):
            depense = depenses.get(annee, 0.0)
            rendement = s * taux_rendement
            s += c + rendement - depense
            c *= (1 + taux_augmentation)
        if s >= 0:
            best_contribution = contribution_initiale
            contribution_initiale *= 0.95
        else:
            contribution_initiale *= 1.1

    projections_progressif: List[Dict] = []
    solde = solde_initial
    contribution = best_contribution
    contribution_totale = 0.0
    for annee in range(annee_debut, annee_debut + periode):
        depense = depenses.get(annee, 0.0)
        rendement = solde * taux_rendement
        solde_debut = solde
        solde += contribution + rendement - depense
        contribution_totale += contribution
        projections_progressif.append({
            "annee": annee,
            "solde_debut": round(solde_debut, 2),
            "contribution": round(contribution, 2),
            "rendement": round(rendement, 2),
            "depenses": round(depense, 2),
            "solde_fin": round(solde, 2),
        })
        contribution *= (1 + taux_augmentation)
    scenario_progressif = {
        "nom": "Contribution progressive",
        "description": f"Augmentation de {taux_augmentation*100:.0f}% par an - Allege le fardeau initial",
        "contribution_initiale": round(best_contribution, 2),
        "contribution_finale": round(contribution / (1 + taux_augmentation), 2),
        "contribution_totale": round(contribution_totale, 2),
        "solde_final": round(solde, 2),
        "projections": projections_progressif,
    }

    # --- Scenario 3: variable ---
    marge_securite = 0.15
    projections_variable: List[Dict] = []
    solde = solde_initial
    contribution_totale_var = 0.0
    for annee in range(annee_debut, annee_debut + periode):
        depense = depenses.get(annee, 0.0)
        rendement = solde * taux_rendement
        annee_suivante = annee + 1
        depense_suivante = depenses.get(annee_suivante, 0.0)
        solde_cible = max(depense_suivante * (1 + marge_securite), 50000.0)
        solde_apres_depense = solde + rendement - depense
        contribution = max(0.0, solde_cible - solde_apres_depense)
        solde_debut = solde
        solde = solde_apres_depense + contribution
        contribution_totale_var += contribution
        projections_variable.append({
            "annee": annee,
            "solde_debut": round(solde_debut, 2),
            "contribution": round(contribution, 2),
            "rendement": round(rendement, 2),
            "depenses": round(depense, 2),
            "solde_fin": round(solde, 2),
        })
    contributions = [p["contribution"] for p in projections_variable]
    scenario_variable = {
        "nom": "Contribution variable",
        "description": "Ajustee chaque annee selon les besoins - Marge de securite 15%",
        "contribution_moyenne": round(contribution_totale_var / periode, 2) if periode else 0.0,
        "contribution_minimale": round(min(contributions), 2) if contributions else 0.0,
        "contribution_maximale": round(max(contributions), 2) if contributions else 0.0,
        "contribution_totale": round(contribution_totale_var, 2),
        "solde_final": round(solde, 2),
        "projections": projections_variable,
    }

    return {
        "uniforme": scenario_uniforme,
        "progressif": scenario_progressif,
        "variable": scenario_variable,
        "depenses_prevues": {str(k): round(v, 2) for k, v in depenses.items()},
    }


@router.post("/etudes/{etude_id}/generer-projections")
async def generer_projections(
    etude_id: int,
    body: ProjectionsRequest,
    user: ErpUser = Depends(get_current_user),
    save: bool = Query(False, description="If true, persists the selected scenario to fp_projections"),
    scenario: Optional[str] = Query(None, description="Scenario to persist: uniforme, progressif, or variable"),
):
    """Generate the 3 scenarios for an etude. Optionally persists one scenario."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    if save and scenario not in SCENARIOS_PROJECTION:
        raise HTTPException(
            status_code=400,
            detail=f"scenario doit etre l'un de: {', '.join(SCENARIOS_PROJECTION)}",
        )

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        # Verify etude and fetch period info
        cursor.execute("SELECT * FROM fp_etudes WHERE id = %s", (etude_id,))
        etude_row = cursor.fetchone()
        if not etude_row:
            raise HTTPException(status_code=404, detail="Étude non trouvée")

        # Cross-check: the etude must belong to the copropriete in the payload.
        # Prevents cross-copropriete writes when the frontend has stale state.
        if int(etude_row.get("id_copropriete") or 0) != int(body.id_copropriete):
            raise HTTPException(
                status_code=400,
                detail="L'étude sélectionnée n'appartient pas à cette copropriété",
            )

        # Clamp to [1, 100] to prevent div-by-zero and runaway loops.
        periode = max(1, min(100, int(etude_row.get("periode_couverte") or 25)))

        # Load composantes for projection inputs
        cursor.execute(
            "SELECT * FROM fp_composantes_batiment WHERE id_copropriete = %s",
            (body.id_copropriete,),
        )
        composantes = [
            _serialize_row(row, _COMPOSANTE_NUMERIC, _COMPOSANTE_DATES)
            for row in cursor.fetchall()
        ]

        taux_inflation = (body.taux_inflation or 3.0) / 100.0
        taux_rendement = (body.taux_rendement or 2.5) / 100.0
        solde_initial = body.solde_initial or 0.0

        result = _generer_3_scenarios(
            composantes, solde_initial, taux_inflation, taux_rendement, periode
        )

        if save and scenario:
            # Clear previous projections for this scenario+etude combo.
            cursor.execute(
                "DELETE FROM fp_projections WHERE id_etude = %s AND scenario = %s",
                (etude_id, scenario),
            )

            projections_list = result[scenario]["projections"]
            for p in projections_list:
                depense = p["depenses"]
                # Deficit/surplus vs a zero-reserve baseline equals the end-of-year balance.
                deficit_surplus = p["solde_fin"]
                cursor.execute(
                    """
                    INSERT INTO fp_projections (
                        id_etude, annee_projection, scenario, travaux_prevus,
                        couts_estimes, inflation_cumulee, solde_debut_annee,
                        contributions_annee, rendements_annee, depenses_annee,
                        solde_fin_annee, deficit_surplus, notes
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        etude_id,
                        p["annee"],
                        scenario,
                        None,
                        depense,
                        None,  # inflation_cumulee intentionally null — cannot be derived accurately from aggregate yearly data.
                        p["solde_debut"],
                        p["contribution"],
                        p["rendement"],
                        depense,
                        p["solde_fin"],
                        round(deficit_surplus, 2),
                        None,
                    ),
                )
            conn.commit()

        return result
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("generer_projections error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la generation des projections")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/etudes/{etude_id}/projections")
async def list_projections(
    etude_id: int,
    user: ErpUser = Depends(get_current_user),
    scenario: Optional[str] = Query(None),
):
    """List saved projections for an etude, optionally filtered by scenario."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        if scenario:
            cursor.execute(
                """
                SELECT * FROM fp_projections
                WHERE id_etude = %s AND scenario = %s
                ORDER BY annee_projection ASC
                """,
                (etude_id, scenario),
            )
        else:
            cursor.execute(
                """
                SELECT * FROM fp_projections
                WHERE id_etude = %s
                ORDER BY scenario, annee_projection ASC
                """,
                (etude_id,),
            )
        items = [
            _serialize_row(row, _PROJECTION_NUMERIC, tuple())
            for row in cursor.fetchall()
        ]
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_projections error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des projections")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# ENDPOINTS - CARNET D'ENTRETIEN
# ============================================

@router.get("/coproprietes/{copro_id}/entretiens")
async def list_entretiens(
    copro_id: int,
    user: ErpUser = Depends(get_current_user),
    statut: Optional[str] = Query(None),
    limit: int = Query(5000, ge=1, le=10000, description="Hard cap to protect memory."),
):
    """List all maintenance entries for a copropriete (capped at `limit` rows)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        if statut:
            cursor.execute(
                """
                SELECT * FROM fp_carnet_entretien
                WHERE id_copropriete = %s AND statut = %s
                ORDER BY COALESCE(date_prevue, date_creation) DESC
                LIMIT %s
                """,
                (copro_id, statut, limit),
            )
        else:
            cursor.execute(
                """
                SELECT * FROM fp_carnet_entretien
                WHERE id_copropriete = %s
                ORDER BY COALESCE(date_prevue, date_creation) DESC
                LIMIT %s
                """,
                (copro_id, limit),
            )
        items = [
            _serialize_row(row, _ENTRETIEN_NUMERIC, _ENTRETIEN_DATES)
            for row in cursor.fetchall()
        ]
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_entretiens error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation du carnet d'entretien")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/entretiens")
async def create_entretien(body: EntretienCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new maintenance entry."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute(
            """
            INSERT INTO fp_carnet_entretien (
                id_copropriete, id_composante, type_intervention, description_travaux,
                date_prevue, date_realisee, frequence, cout_prevu, cout_reel,
                entrepreneur, numero_contrat, garantie_duree, garantie_expiration,
                statut, documents_joints, notes
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                body.id_copropriete,
                body.id_composante,
                body.type_intervention,
                body.description_travaux,
                body.date_prevue,
                body.date_realisee,
                body.frequence,
                body.cout_prevu,
                body.cout_reel,
                body.entrepreneur,
                body.numero_contrat,
                body.garantie_duree,
                body.garantie_expiration,
                body.statut or "Planifie",
                body.documents_joints,
                body.notes,
            ),
        )
        new_id = cursor.fetchone()["id"]
        conn.commit()
        return {"id": new_id}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_entretien error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de l'entretien")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/entretiens/{entretien_id}")
async def update_entretien(
    entretien_id: int,
    body: EntretienUpdate,
    user: ErpUser = Depends(get_current_user),
):
    """Update a maintenance entry (partial)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute("SELECT id FROM fp_carnet_entretien WHERE id = %s", (entretien_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Entretien non trouve")

        set_parts = [f"{k} = %s" for k in payload.keys()]
        set_parts.append("derniere_maj = CURRENT_TIMESTAMP")
        params = list(payload.values()) + [entretien_id]

        cursor.execute(
            f"UPDATE fp_carnet_entretien SET {', '.join(set_parts)} WHERE id = %s",
            params,
        )
        conn.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_entretien error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour de l'entretien")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/entretiens/{entretien_id}")
async def delete_entretien(entretien_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a maintenance entry."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute(
            "DELETE FROM fp_carnet_entretien WHERE id = %s RETURNING id", (entretien_id,)
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Entretien non trouve")
        conn.commit()
        return {"status": "deleted"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_entretien error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression de l'entretien")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# ENDPOINTS - ATTESTATIONS DE VENTE
# ============================================

@router.get("/coproprietes/{copro_id}/attestations")
async def list_attestations(
    copro_id: int,
    user: ErpUser = Depends(get_current_user),
    statut: Optional[str] = Query(None),
    limit: int = Query(5000, ge=1, le=10000, description="Hard cap to protect memory."),
):
    """List all sale attestations for a copropriete (capped at `limit` rows)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        if statut:
            cursor.execute(
                """
                SELECT * FROM fp_attestations_vente
                WHERE id_copropriete = %s AND statut = %s
                ORDER BY date_demande DESC
                LIMIT %s
                """,
                (copro_id, statut, limit),
            )
        else:
            cursor.execute(
                """
                SELECT * FROM fp_attestations_vente
                WHERE id_copropriete = %s
                ORDER BY date_demande DESC
                LIMIT %s
                """,
                (copro_id, limit),
            )
        items = [
            _serialize_row(row, _ATTESTATION_NUMERIC, _ATTESTATION_DATES)
            for row in cursor.fetchall()
        ]
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_attestations error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des attestations")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/attestations")
async def create_attestation(body: AttestationCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new sale attestation."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute(
            """
            INSERT INTO fp_attestations_vente (
                id_copropriete, numero_unite, nom_vendeur, nom_acheteur,
                date_demande, date_emission, montant_fonds_prevoyance,
                montant_recommande, contributions_arrieres, travaux_votes_montant,
                travaux_votes_description, restrictions_declarations, date_validite,
                emise_par, statut, document_pdf_url, notes
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                body.id_copropriete,
                body.numero_unite,
                body.nom_vendeur,
                body.nom_acheteur,
                body.date_demande,
                body.date_emission,
                body.montant_fonds_prevoyance,
                body.montant_recommande,
                body.contributions_arrieres,
                body.travaux_votes_montant,
                body.travaux_votes_description,
                body.restrictions_declarations,
                body.date_validite,
                body.emise_par,
                body.statut or "Demandee",
                body.document_pdf_url,
                body.notes,
            ),
        )
        new_id = cursor.fetchone()["id"]
        conn.commit()
        return {"id": new_id}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("create_attestation error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de l'attestation")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/attestations/{attest_id}")
async def update_attestation(
    attest_id: int,
    body: AttestationUpdate,
    user: ErpUser = Depends(get_current_user),
):
    """Update a sale attestation (partial)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute("SELECT id FROM fp_attestations_vente WHERE id = %s", (attest_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Attestation non trouvee")

        set_parts = [f"{k} = %s" for k in payload.keys()]
        params = list(payload.values()) + [attest_id]

        cursor.execute(
            f"UPDATE fp_attestations_vente SET {', '.join(set_parts)} WHERE id = %s",
            params,
        )
        conn.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_attestation error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour de l'attestation")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/attestations/{attest_id}")
async def delete_attestation(attest_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a sale attestation."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute(
            "DELETE FROM fp_attestations_vente WHERE id = %s RETURNING id", (attest_id,)
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Attestation non trouvee")
        conn.commit()
        return {"status": "deleted"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_attestation error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression de l'attestation")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# ENDPOINTS - IA (Claude)
# ============================================

FP_AI_SYSTEM_PROMPT = """Tu es un expert-conseil specialise en fonds de prevoyance pour coproprietes au Quebec.
Tu possedes une expertise approfondie sur:

LOI 16 DU QUEBEC (Loi modifiant le Code civil - 2018):
- Obligation d'etude du fonds de prevoyance tous les 5 ans
- Carnet d'entretien obligatoire depuis 2020
- Evaluation par professionnel designe (ingenieur, architecte, evaluateur agree, technologue)
- Periode de planification minimale de 25 ans
- Attestation de fonds lors de vente d'unite (Art. 1069 C.c.Q.)

CALCULS FINANCIERS:
- Valeur actualisee nette (VAN)
- Inflation composee (taux moyen 2-3% Quebec)
- Rendement des placements (taux conservateur 2-4%)
- Contribution uniforme vs progressive
- Cotisations speciales vs cotisations regulieres

COMPOSANTES DE BATIMENT:
- Durees de vie de reference (toiture 25-30 ans, fenetres 25-35 ans, etc.)
- Facteurs d'ajustement selon l'etat (Excellent +10%, Critique 0%)
- Couts de remplacement actualises ($ 2025)
- Priorisation des travaux

CARNET D'ENTRETIEN:
- Entretien preventif vs correctif
- Frequences d'intervention recommandees
- Garanties et contrats de service
- Documentation obligatoire

TON ROLE:
1. Repondre aux questions sur les fonds de prevoyance avec precision
2. Analyser les donnees de coproprietes pour identifier les risques
3. Recommander des actions concretes basees sur les meilleures pratiques
4. Vulgariser les concepts complexes pour les administrateurs
5. Toujours mentionner quand une consultation professionnelle est requise

IMPORTANT: Tu donnes des conseils educatifs. Pour les decisions officielles,
tu recommandes toujours de consulter un professionnel designe (OIQ, OAQ, OEAQ, OTPQ).

Reponds toujours en francais quebecois, de maniere professionnelle et structuree."""


def _get_fp_ai_client():
    """Return an Anthropic client instance or None if not configured."""
    if anthropic is None:
        return None
    api_key = os.getenv("ANTHROPIC_API_KEY", "") or os.getenv("CLAUDE_API_KEY", "")
    if not api_key:
        return None
    return anthropic.Anthropic(api_key=api_key)


def _require_ai_access(user: ErpUser):
    """Raises HTTPException if AI is not usable for this user."""
    if check_ai_guard is None:
        raise HTTPException(status_code=503, detail="Module IA non disponible")
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")
    credits_ok, _ = _check_credits(user)
    if not credits_ok:
        raise HTTPException(status_code=402, detail="Credits IA insuffisants")


def _strip_json_fences(text: str) -> str:
    """Strip leading/trailing ```json fences if present."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```")[1]
        if t.startswith("json"):
            t = t[4:]
        t = t.strip()
    return t


def _load_copro_stats(cursor, copro_id: int) -> Optional[Dict]:
    """Load copropriete + aggregated stats in one helper. Returns None if copropriete missing."""
    cursor.execute("SELECT * FROM fp_coproprietes WHERE id = %s", (copro_id,))
    copro_row = cursor.fetchone()
    if not copro_row:
        return None
    copropriete = _serialize_row(copro_row, _COPROPRIETE_NUMERIC, _COPROPRIETE_DATES)

    cursor.execute(
        """
        SELECT COUNT(*) as nb,
               COALESCE(SUM(cout_remplacement_total), 0) as cout_total,
               COUNT(*) FILTER (
                   WHERE duree_vie_restante IS NOT NULL AND duree_vie_restante <= 5
               ) as nb_critiques
        FROM fp_composantes_batiment WHERE id_copropriete = %s
        """,
        (copro_id,),
    )
    agg = cursor.fetchone()

    cursor.execute(
        """
        SELECT COALESCE(etat_actuel, 'Inconnu') as etat, COUNT(*) as nb
        FROM fp_composantes_batiment WHERE id_copropriete = %s
        GROUP BY etat_actuel
        """,
        (copro_id,),
    )
    etats = {row["etat"]: int(row["nb"]) for row in cursor.fetchall()}

    cursor.execute(
        """
        SELECT * FROM fp_etudes
        WHERE id_copropriete = %s
        ORDER BY date_etude DESC NULLS LAST LIMIT 1
        """,
        (copro_id,),
    )
    last_etude_row = cursor.fetchone()
    derniere_etude = (
        _serialize_row(last_etude_row, _ETUDE_NUMERIC, _ETUDE_DATES) if last_etude_row else None
    )

    return {
        "copropriete": copropriete,
        "nb_composantes": int(agg["nb"]) if agg else 0,
        "cout_total_remplacement": float(agg["cout_total"]) if agg and agg["cout_total"] else 0.0,
        "nb_critiques": int(agg["nb_critiques"]) if agg else 0,
        "etats": etats,
        "derniere_etude": derniere_etude,
    }


@router.post("/ia/analyze-copropriete")
async def ia_analyze_copropriete(
    body: IaAnalyzeCoproRequest,
    user: ErpUser = Depends(get_current_user),
):
    """AI health check + structured recommendations for a copropriete.
    Returns JSON with score, risk level, recommendations, Loi 16 compliance."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    _require_ai_access(user)

    client = _get_fp_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Client Anthropic non configure")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        stats = _load_copro_stats(cursor, body.id_copropriete)
        if stats is None:
            raise HTTPException(status_code=404, detail="Copropriete non trouvee")

        copro = stats["copropriete"]
        derniere_etude = stats.get("derniere_etude")
        etude_info = "Aucune etude de fonds enregistree."
        if derniere_etude:
            etude_info = (
                f"\nDerniere etude: {derniere_etude.get('date_etude')}\n"
                f"- Montant actuel du fonds: {float(derniere_etude.get('montant_fonds_actuel') or 0):,.2f} $\n"
                f"- Montant recommande: {float(derniere_etude.get('montant_recommande_debut_annee') or 0):,.2f} $\n"
                f"- Contribution annuelle recommandee: {float(derniere_etude.get('contribution_annuelle_recommandee') or 0):,.2f} $"
            )

        prompt = (
            f"Analyse cette copropriete et fournis des recommandations structurees:\n\n"
            f"COPROPRIETE: {copro.get('nom_copropriete') or 'Inconnu'}\n"
            f"- Annee construction: {copro.get('annee_construction') or 'N/A'}\n"
            f"- Nombre d'unites: {copro.get('nombre_unites') or 'N/A'}\n"
            f"- Superficie: {float(copro.get('superficie_totale_pc') or 0):,.0f} pi2\n"
            f"- Valeur reconstruction: {float(copro.get('valeur_reconstruction') or 0):,.2f} $\n\n"
            f"COMPOSANTES DU BATIMENT:\n"
            f"- Nombre total: {stats['nb_composantes']}\n"
            f"- Cout total remplacement estime: {stats['cout_total_remplacement']:,.2f} $\n"
            f"- Composantes critiques (<=5 ans restants): {stats['nb_critiques']}\n"
            f"- Etat des composantes: {json.dumps(stats['etats'], ensure_ascii=False)}\n\n"
            f"FONDS DE PREVOYANCE:{etude_info}\n\n"
            "Produis une analyse en JSON avec ce format exact:\n"
            "{\n"
            '    "score_sante": 0-100,\n'
            '    "niveau_risque": "faible/moyen/eleve/critique",\n'
            '    "resume_situation": "Resume en 2-3 phrases",\n'
            '    "points_attention": ["point 1", "point 2", "point 3"],\n'
            '    "recommandations_immediates": ["action urgente 1", "action urgente 2"],\n'
            '    "recommandations_moyen_terme": ["action 1", "action 2"],\n'
            '    "estimation_contribution_adequate": montant_annuel_suggere_en_dollars,\n'
            '    "conformite_loi16": {\n'
            '        "etude_a_jour": true/false,\n'
            '        "carnet_requis": true/false,\n'
            '        "prochaine_echeance": "description"\n'
            "    },\n"
            '    "conseil_expert": "Conseil personnalise detaille"\n'
            "}"
        )

        model_name = "claude-opus-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=FP_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Opus pricing: $15/1M input, $75/1M output, 30% markup
        cost = (input_tokens * 0.015 + output_tokens * 0.075) / 1000 * 1.30

        if track_ai_usage is not None:
            track_ai_usage(
                user, "fonds_prevoyance_analyze",
                input_tokens, output_tokens, cost, 0, True, model=model_name,
            )
        if _deduct_credits is not None:
            _deduct_credits(user, cost)

        analysis: Any = response_text
        try:
            analysis = json.loads(_strip_json_fences(response_text))
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
    except Exception as exc:
        if anthropic is not None and isinstance(exc, anthropic.APIError):
            status = getattr(exc, "status_code", 500)
            if status == 413:
                raise HTTPException(status_code=413, detail="Requete trop volumineuse pour l'API IA")
            if status == 529:
                raise HTTPException(status_code=529, detail="API IA surchargee, reessayez plus tard")
            logger.error("ia_analyze_copropriete API error: %s", exc)
            raise HTTPException(status_code=500, detail="Erreur API IA")
        logger.error("ia_analyze_copropriete error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'analyse IA de la copropriete")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/ia/chat")
async def ia_chat_fp(
    body: IaChatFpRequest,
    user: ErpUser = Depends(get_current_user),
):
    """AI chat for Fonds de Prevoyance / Loi 16 expert questions (Sonnet for cost-efficiency)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    _require_ai_access(user)

    client = _get_fp_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Client Anthropic non configure")

    # Load copropriete context if id provided (reuses helper, keeps logic DRY)
    context_str = body.context or ""
    if body.id_copropriete:
        conn = db.get_conn()
        cursor = None
        try:
            db.set_tenant(conn, user.schema)
            cursor = conn.cursor()
            _ensure_fp_tables(cursor)
            conn.commit()
            stats = _load_copro_stats(cursor, body.id_copropriete)
            if stats is not None:
                copro = stats["copropriete"]
                context_str = (
                    f"COPROPRIETE: {copro.get('nom_copropriete')}, "
                    f"annee {copro.get('annee_construction')}, "
                    f"{copro.get('nombre_unites')} unites. "
                    f"Composantes: {stats['nb_composantes']} (critiques: {stats['nb_critiques']}). "
                    f"Cout remplacement total: {stats['cout_total_remplacement']:,.0f} $. "
                    f"{context_str}".strip()
                )
        except Exception as exc:
            logger.warning("ia_chat_fp context loading failed: %s", exc)
        finally:
            if cursor:
                cursor.close()
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()

    user_content = body.question
    if context_str:
        user_content = f"CONTEXTE:\n{context_str}\n\nQUESTION:\n{body.question}"

    try:
        model_name = "claude-sonnet-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=FP_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Sonnet pricing: $3/1M input, $15/1M output, 30% markup
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30

        if track_ai_usage is not None:
            track_ai_usage(
                user, "fonds_prevoyance_chat",
                input_tokens, output_tokens, cost, 0, True, model=model_name,
            )
        if _deduct_credits is not None:
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
    except Exception as exc:
        if anthropic is not None and isinstance(exc, anthropic.APIError):
            status = getattr(exc, "status_code", 500)
            if status == 413:
                raise HTTPException(status_code=413, detail="Requete trop volumineuse pour l'API IA")
            if status == 529:
                raise HTTPException(status_code=529, detail="API IA surchargee, reessayez plus tard")
            logger.error("ia_chat_fp API error: %s", exc)
            raise HTTPException(status_code=500, detail="Erreur API IA")
        logger.error("ia_chat_fp error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chat IA")


@router.post("/ia/suggest-contribution")
async def ia_suggest_contribution(
    body: IaSuggestContributionRequest,
    user: ErpUser = Depends(get_current_user),
):
    """Suggest optimal annual contribution (uniform + progressive) using AI."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    _require_ai_access(user)

    client = _get_fp_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Client Anthropic non configure")

    prompt = (
        f"Calcule la contribution annuelle optimale pour un fonds de prevoyance:\n\n"
        f"DONNEES:\n"
        f"- Cout total de remplacement des composantes: {body.cout_total_remplacement:,.2f} $\n"
        f"- Solde actuel du fonds: {(body.solde_actuel or 0):,.2f} $\n"
        f"- Nombre d'unites: {body.nombre_unites}\n"
        f"- Periode de planification: {body.horizon_annees or 25} ans\n"
        f"- Taux d'inflation estime: 2.5%\n"
        f"- Taux de rendement estime: 3%\n\n"
        "Reponds en JSON:\n"
        "{\n"
        '    "contribution_uniforme": montant_annuel,\n'
        '    "contribution_progressive": {\n'
        '        "annee_1_5": montant,\n'
        '        "annee_6_15": montant,\n'
        '        "annee_16_25": montant\n'
        "    },\n"
        '    "contribution_par_unite_mensuelle": montant,\n'
        '    "deficit_estime": montant_si_aucun_changement,\n'
        '    "adequation_actuelle": pourcentage_0_100,\n'
        '    "explication": "explication en 2-3 phrases",\n'
        '    "avertissement": "si applicable"\n'
        "}"
    )

    try:
        model_name = "claude-sonnet-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=FP_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30

        if track_ai_usage is not None:
            track_ai_usage(
                user, "fonds_prevoyance_suggest_contribution",
                input_tokens, output_tokens, cost, 0, True, model=model_name,
            )
        if _deduct_credits is not None:
            _deduct_credits(user, cost)

        recommendation: Any = response_text
        try:
            recommendation = json.loads(_strip_json_fences(response_text))
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
    except Exception as exc:
        if anthropic is not None and isinstance(exc, anthropic.APIError):
            status = getattr(exc, "status_code", 500)
            if status == 413:
                raise HTTPException(status_code=413, detail="Requete trop volumineuse pour l'API IA")
            if status == 529:
                raise HTTPException(status_code=529, detail="API IA surchargee, reessayez plus tard")
            logger.error("ia_suggest_contribution API error: %s", exc)
            raise HTTPException(status_code=500, detail="Erreur API IA")
        logger.error("ia_suggest_contribution error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suggestion de contribution")


@router.post("/ia/rapport-recommandations")
async def ia_rapport_recommandations(
    body: IaRapportRequest,
    user: ErpUser = Depends(get_current_user),
):
    """Generate a complete Markdown recommendations report for a copropriete."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    _require_ai_access(user)

    client = _get_fp_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Client Anthropic non configuré")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_fp_tables(cursor)
        conn.commit()

        cursor.execute("SELECT * FROM fp_coproprietes WHERE id = %s", (body.id_copropriete,))
        copro_row = cursor.fetchone()
        if not copro_row:
            raise HTTPException(status_code=404, detail="Copropriété non trouvée")
        copropriete = _serialize_row(copro_row, _COPROPRIETE_NUMERIC, _COPROPRIETE_DATES)

        cursor.execute(
            """
            SELECT * FROM fp_composantes_batiment
            WHERE id_copropriete = %s
              AND duree_vie_restante IS NOT NULL
              AND duree_vie_restante <= 5
            ORDER BY duree_vie_restante ASC NULLS LAST
            LIMIT 10
            """,
            (body.id_copropriete,),
        )
        critiques = [
            _serialize_row(row, _COMPOSANTE_NUMERIC, _COMPOSANTE_DATES)
            for row in cursor.fetchall()
        ]

        cursor.execute(
            """
            SELECT * FROM fp_etudes
            WHERE id_copropriete = %s
            ORDER BY date_etude DESC NULLS LAST LIMIT 1
            """,
            (body.id_copropriete,),
        )
        etude_row = cursor.fetchone()
        etude = (
            _serialize_row(etude_row, _ETUDE_NUMERIC, _ETUDE_DATES) if etude_row else None
        )

        critiques_str = "\n".join(
            f"- {c.get('description_detaillee') or c.get('categorie') or 'N/A'}: "
            f"{c.get('duree_vie_restante') or 'N/A'} ans restants, "
            f"coût: {float(c.get('cout_remplacement_total') or 0):,.0f} $"
            for c in critiques
        ) or "Aucune composante critique"

        etude_str = "Aucune étude enregistrée"
        if etude:
            etude_str = (
                f"\nDate: {etude.get('date_etude')}\n"
                f"Professionnel: {etude.get('professionnel_responsable')}\n"
                f"Fonds actuel: {float(etude.get('montant_fonds_actuel') or 0):,.0f} $\n"
                f"Recommandé: {float(etude.get('montant_recommande_debut_annee') or 0):,.0f} $\n"
                f"Contribution annuelle: {float(etude.get('contribution_annuelle_recommandee') or 0):,.0f} $"
            )

        prompt = (
            f"Génère un rapport de recommandations complet pour cette copropriété:\n\n"
            f"COPROPRIÉTÉ: {copropriete.get('nom_copropriete')}\n"
            f"Adresse: {copropriete.get('adresse_complete')}\n"
            f"Année construction: {copropriete.get('annee_construction')}\n"
            f"Unités: {copropriete.get('nombre_unites')}\n"
            f"Valeur reconstruction: {float(copropriete.get('valeur_reconstruction') or 0):,.0f} $\n\n"
            f"COMPOSANTES CRITIQUES (≤5 ans):\n{critiques_str}\n\n"
            f"DERNIÈRE ÉTUDE:{etude_str}\n\n"
            "Génère un rapport structuré en format Markdown avec:\n"
            "1. 📊 Synthèse de la situation\n"
            "2. ⚠️ Alertes et priorités\n"
            "3. 💰 Recommandations financières\n"
            "4. 🔧 Plan d'entretien suggéré\n"
            "5. 📅 Échéancier recommandé\n"
            "6. ✅ Conformité Loi 16\n"
            "7. 💡 Conseils pratiques\n\n"
            "Le rapport doit être professionnel et actionnable."
        )

        model_name = "claude-opus-4-20250514"
        with client.messages.stream(
            model=model_name,
            max_tokens=32000,
            system=FP_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            response = stream.get_final_message()

        response_text = response.content[0].text if response.content else ""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
        cost = (input_tokens * 0.015 + output_tokens * 0.075) / 1000 * 1.30

        if track_ai_usage is not None:
            track_ai_usage(
                user, "fonds_prevoyance_rapport",
                input_tokens, output_tokens, cost, 0, True, model=model_name,
            )
        if _deduct_credits is not None:
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
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        if anthropic is not None and isinstance(exc, anthropic.APIError):
            status = getattr(exc, "status_code", 500)
            if status == 413:
                raise HTTPException(status_code=413, detail="Requête trop volumineuse pour l'API IA")
            if status == 529:
                raise HTTPException(status_code=529, detail="API IA surchargée, réessayez plus tard")
            logger.error("ia_rapport_recommandations API error: %s", exc)
            raise HTTPException(status_code=500, detail="Erreur API IA")
        logger.error("ia_rapport_recommandations error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la génération du rapport")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/calculer-valeur-reconstruction")
async def calculer_valeur_reconstruction(
    body: ValeurReconstructionRequest,
    user: ErpUser = Depends(get_current_user),
):
    """Estimate the rebuild value of a building (Québec 2025 rates)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    try:
        valeur = _calculer_valeur_reconstruction(
            body.superficie, body.qualite, body.type_batiment, body.annee_construction,
        )
        return {"valeur_reconstruction": valeur}
    except Exception as exc:
        logger.error("calculer_valeur_reconstruction error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur de calcul")

