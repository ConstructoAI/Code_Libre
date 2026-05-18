"""
ERP React - Calculators Router (feature parity with Streamlit + docs specs)

13 construction calculators with 50+ sub-endpoints:
- Concrete (CSA A23.1): volume, dosage 15-40 MPa, rebar 10M-55M, cure ACI 209,
  formwork, Blondel stairs, excavation, CNESST slopes
- Stairs (CCQ 9.8/3.4): dimensions, materials, garde-corps
- Electrical (CCE): cable sizing, residential load 8-200, lighting lumens, grounding
- Roofing (CCQ 9.26): surface, bardeaux, ventilation 1:150/1:300, flashing, gutters
- Painting: surface, DFT film, Magnus dew point, dilution
- Plumbing (CNP): DFU, WSFU, Hazen-Williams, water heater FHR
- HVAC (ASHRAE): heat load, ducts, CFM, HRV/ERV
- Welding (CSA W47.1, AWS D1.1): angle weld, heat input, CE preheat
- Bending: flat pattern, tonnage, springback, min radius
- Metal weight: 20+ materials + W/C profiles
- Taxes Quebec (TPS 5% + TVQ 9.975%)
- Payroll charges (RRQ, RQAP, AE, CNESST, FSS, CCQ)
- Structural analysis (CNBC/CSA O86): beam with SVG diagram

Plus:
- 6 AI endpoints (Claude Opus 4.6): chat, analyze, recommend, explain-norm,
  diagnose-problem, optimize
- Calculator history persistence (multi-tenant)
- Resource/constants endpoints
"""

import json
import logging
import math
import os
import time as time_module
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Dict, Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from ..erp_auth import ErpUser, get_current_user
from .. import erp_database as db
from .ai import _check_credits, _deduct_credits, check_ai_guard, track_ai_usage
from .calculators_data import (
    ACI_209,
    ACH_RECOMMANDE,
    AWG_TABLE,
    BARRES_ARMATURE,
    BLONDEL_MAX,
    BLONDEL_MIN,
    BLONDEL_OPT,
    BOIS_DIMENSIONS,
    BOIS_PROPRIETES,
    CALC_AI_SYSTEM_PROMPT,
    CALCULATEURS_LISTE,
    CATEGORIES_CALCS,
    CHARGES_MORTES_TOITURE,
    CHARGES_NEIGE,
    CHAUFFE_EAU_CAPACITE,
    CLASSES_BETON,
    CONSEILS_CALCULATEURS,
    CURE_TIME_MIN,
    DFU_APPAREILS,
    DIAMETRES_DRAIN,
    DOSAGES_BETON,
    ECLAIRAGE_NIVEAUX,
    EFFICACITE_TRANSFERT,
    ELECTRODE_WASTE,
    ELECTRODES_SMAW,
    ESCALIERS_CCQ,
    ESSENCES_BOIS_ESCALIER,
    FACTEURS_ABSORPTION,
    FILS_GMAW,
    FOISONNEMENT,
    GAZ_PROTECTION,
    GOUTTIERES_CAPACITE,
    HAZEN_WILLIAMS_C,
    HVAC_FACTORS,
    K_FACTOR_TABLE,
    LIMITES_FLECHE,
    LVL_DIMENSIONS,
    LVL_PROPRIETES,
    MATERIAUX_PLIAGE,
    MATERIAUX_TOITURE,
    METAL_DENSITIES_LEGACY,
    METAUX,
    PENTES_TALUS_CNESST,
    PENTES_TOITURE,
    PROFILES_C,
    PROFILES_W,
    RESISTIVITE_ALUMINIUM,
    RESISTIVITE_CUIVRE,
    SHGC_ORIENTATION,
    TAUX_CHARGES_EMPLOYEUR,
    TAUX_DEDUCTIONS_EMPLOYE,
    TAUX_DEPOT,
    TPS_RATE,
    TVQ_RATE,
    TYPES_PEINTURE,
    V_DIE_OPENING,
    VITESSES_CONDUIT,
    ZONES_CLIMATIQUES,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/calculators", tags=["Calculators"])


# ============================================
# AI CLIENT + PRICING
# ============================================

try:
    import anthropic
    _anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
except (ImportError, Exception) as exc:  # pragma: no cover
    _anthropic_client = None
    logger.warning("Anthropic SDK not available: %s", exc)

CALC_AI_MODEL = "claude-opus-4-7"
CALC_AI_MAX_TOKENS = 32000
# Opus 4.7 pricing with 30% markup: $15/M input, $75/M output,
# $18.75/M cache write, $1.50/M cache read.
CALC_PRICING_INPUT_PER_M = 15.0
CALC_PRICING_OUTPUT_PER_M = 75.0
CALC_PRICING_CACHE_WRITE_PER_M = 18.75
CALC_PRICING_CACHE_READ_PER_M = 1.50
CALC_PRICING_MARKUP = 1.30


# ============================================
# PYDANTIC MODELS - shared
# ============================================

ShortStr = Annotated[str, Field(min_length=1, max_length=200)]
MediumStr = Annotated[str, Field(min_length=1, max_length=500)]
LongStr = Annotated[str, Field(min_length=1, max_length=2000)]


# ---- CONCRETE ----

class ConcreteInput(BaseModel):
    longueur: float = Field(..., gt=0, le=1000)
    largeur: float = Field(..., gt=0, le=1000)
    epaisseur: float = Field(..., gt=0, le=10)
    perte_pct: float = Field(10.0, ge=0, le=100)
    classe_beton: Optional[str] = Field("C-2", max_length=20)  # C-1..S-2


class ConcreteDosageInput(BaseModel):
    volume_m3: float = Field(..., gt=0, le=10000)
    resistance_mpa: Literal["15MPa", "20MPa", "25MPa", "30MPa", "32MPa", "35MPa", "40MPa"] = "25MPa"


class ConcreteRebarInput(BaseModel):
    longueur_m: float = Field(..., gt=0, le=1000)
    largeur_m: float = Field(..., gt=0, le=1000)
    enrobage_mm: float = Field(50, ge=15, le=200)
    espacement_mm: float = Field(300, ge=50, le=600)
    barre_type: Literal["10M", "15M", "20M", "25M", "30M", "35M", "45M", "55M"] = "15M"
    nb_lits: int = Field(1, ge=1, le=4)
    perte_pct: float = Field(10.0, ge=0, le=50)


class ConcreteCureInput(BaseModel):
    resistance_finale_mpa: float = Field(25, gt=0, le=100)
    age_jours: float = Field(7, gt=0, le=365)
    temperature_c: float = Field(20, ge=-30, le=50)
    ciment_type: Literal["GU", "HE", "MS", "HS"] = "GU"


class ConcreteFormworkInput(BaseModel):
    longueur_m: float = Field(..., gt=0, le=1000)
    hauteur_m: float = Field(..., gt=0, le=100)
    epaisseur_coffrage_mm: float = Field(19, gt=0, le=100)  # 3/4 inch plywood


class ConcreteExcavationInput(BaseModel):
    longueur_m: float = Field(..., gt=0, le=1000)
    largeur_m: float = Field(..., gt=0, le=1000)
    profondeur_m: float = Field(..., gt=0, le=20)
    type_sol: Literal["terre_ordinaire", "argile", "sable", "gravier", "roc"] = "terre_ordinaire"


class ConcreteTalusInput(BaseModel):
    profondeur_m: float = Field(..., gt=0, le=30)
    type_sol: Literal["roc", "argile_dure", "argile_molle", "sable", "sol_meuble"] = "sol_meuble"


class ConcreteStairsInput(BaseModel):
    hauteur_totale_mm: float = Field(..., gt=0, le=10000)
    largeur_m: float = Field(1.0, gt=0, le=5)
    epaisseur_dalle_mm: float = Field(150, gt=0, le=500)
    giron_cible_mm: float = Field(280, ge=200, le=400)
    hauteur_marche_cible_mm: float = Field(175, ge=100, le=250)


# ---- STAIRS ----

class StairInput(BaseModel):
    hauteur_totale: float = Field(..., gt=0, le=10000)  # mm
    giron_cible: float = Field(260, ge=200, le=400)
    hauteur_marche_cible: float = Field(180, ge=100, le=250)
    usage: Literal["residentiel", "commercial"] = "residentiel"
    largeur_m: float = Field(1.0, gt=0, le=5)


class StairMaterialsInput(BaseModel):
    nb_marches: int = Field(..., ge=1, le=50)
    largeur_m: float = Field(1.0, gt=0, le=5)
    materiau: Literal["beton", "bois", "acier"] = "bois"
    essence_bois: Optional[Literal["pin", "epinette", "erable", "chene", "merisier"]] = "pin"


class StairGardeCorpsInput(BaseModel):
    longueur_m: float = Field(..., gt=0, le=50)
    hauteur_mm: float = Field(965, ge=800, le=1200)
    espacement_barreaux_mm: float = Field(100, ge=50, le=150)
    usage: Literal["residentiel", "commercial"] = "residentiel"


# ---- ELECTRICAL ----

class ElectricalInput(BaseModel):
    puissance_watts: float = Field(..., gt=0, le=1_000_000)
    tension_volts: float = Field(120, gt=0, le=1000)
    longueur_cable_m: float = Field(10, gt=0, le=5000)
    facteur_puissance: float = Field(1.0, ge=0.1, le=1.0)
    chute_tension_max_pct: float = Field(3.0, ge=0.1, le=10)
    conducteur: Literal["cuivre", "aluminium"] = "cuivre"
    type_circuit: Literal["monophase", "triphase"] = "monophase"


class ElectricalResidentialInput(BaseModel):
    surface_habitable_m2: float = Field(..., gt=0, le=10000)
    chauffage_kw: float = Field(0, ge=0, le=100)
    climatisation_kw: float = Field(0, ge=0, le=100)
    cuisiniere_kw: float = Field(12, ge=0, le=50)
    secheuse_kw: float = Field(5, ge=0, le=20)
    chauffe_eau_kw: float = Field(4.5, ge=0, le=20)
    autres_charges_kw: float = Field(0, ge=0, le=100)


class ElectricalLightingInput(BaseModel):
    surface_m2: float = Field(..., gt=0, le=10000)
    type_local: Literal["salon", "cuisine", "chambre", "bureau", "atelier", "couloir", "salle_bain", "industriel", "commercial"] = "salon"
    flux_luminaire_lm: float = Field(1600, gt=0, le=100000)
    uf: float = Field(0.5, ge=0.2, le=0.9)
    mf: float = Field(0.8, ge=0.5, le=1.0)


class ElectricalGroundingInput(BaseModel):
    resistivite_sol: float = Field(100, gt=0, le=10000)  # ohm.m
    longueur_piquet_m: float = Field(3, gt=0, le=10)
    diametre_piquet_m: float = Field(0.016, gt=0, le=0.1)
    nb_piquets: int = Field(1, ge=1, le=20)


# ---- ROOFING ----

class RoofingInput(BaseModel):
    longueur_m: float = Field(..., gt=0, le=1000)
    largeur_m: float = Field(..., gt=0, le=1000)
    pente_ratio: float = Field(4.0, ge=0, le=24)
    debord_m: float = Field(0.3, ge=0, le=2)
    perte_pct: float = Field(15.0, ge=0, le=50)
    type_materiau: Optional[str] = Field("bardeau_architect", max_length=50)


class RoofingVentilationInput(BaseModel):
    surface_comble_m2: float = Field(..., gt=0, le=10000)
    pare_vapeur: bool = True  # 1:300 vs 1:150


class RoofingGuttersInput(BaseModel):
    surface_toit_m2: float = Field(..., gt=0, le=10000)
    perimetre_m: float = Field(..., gt=0, le=1000)
    type_gouttiere: Literal["4po", "5po", "6po", "7po"] = "5po"


class RoofingSnowLoadInput(BaseModel):
    province: Literal["QC", "ON", "BC", "AB"] = "QC"
    ville: str = Field("Montreal", min_length=1, max_length=100)
    type_couverture: Optional[str] = Field("bardeau_architect", max_length=50)


# ---- PAINTING ----

class PaintingInput(BaseModel):
    longueur_m: float = Field(..., gt=0, le=1000)
    largeur_m: float = Field(..., gt=0, le=1000)
    hauteur_m: float = Field(2.44, gt=0, le=20)
    nb_portes: int = Field(1, ge=0, le=100)
    nb_fenetres: int = Field(2, ge=0, le=100)
    type_peinture: Optional[str] = Field("latex_interieur", max_length=50)
    surface_type: Literal["gypse_neuf", "gypse_peint", "platre", "beton_neuf", "beton_scelle", "bois_neuf", "bois_peint", "metal", "stucco", "brique"] = "gypse_peint"
    methode: Literal["pinceau", "rouleau", "airless", "hvlp", "electrostatique", "conventionnel"] = "rouleau"
    nb_couches: int = Field(2, ge=1, le=10)


class PaintingDFTInput(BaseModel):
    volume_ml: float = Field(..., gt=0, le=1_000_000)
    solides_pct: float = Field(..., gt=0, le=100)
    surface_m2: float = Field(..., gt=0, le=10000)


class PaintingDewPointInput(BaseModel):
    temperature_air_c: float = Field(..., ge=-50, le=60)
    # gt=0: math.log(0) crashes. Also clamped above 0.1 below as safety.
    humidite_relative_pct: float = Field(..., gt=0, le=100)
    temperature_surface_c: float = Field(..., ge=-50, le=60)


# ---- PLUMBING ----

class PlumbingInput(BaseModel):
    nb_toilettes: int = Field(1, ge=0, le=1000)
    nb_lavabos: int = Field(1, ge=0, le=1000)
    nb_douches: int = Field(1, ge=0, le=1000)
    nb_baignoires: int = Field(0, ge=0, le=1000)
    nb_lave_vaisselle: int = Field(0, ge=0, le=1000)
    nb_machines_laver: int = Field(0, ge=0, le=1000)
    nb_evier_cuisine: int = Field(0, ge=0, le=1000)
    nb_evier_bar: int = Field(0, ge=0, le=1000)
    nb_urinoir: int = Field(0, ge=0, le=1000)
    nb_drain_plancher: int = Field(0, ge=0, le=1000)


class PlumbingHazenWilliamsInput(BaseModel):
    debit_gpm: float = Field(..., gt=0, le=10000)
    longueur_pi: float = Field(..., gt=0, le=10000)
    diametre_pouce: float = Field(..., gt=0, le=12)
    materiau: Literal["cuivre", "pex", "cpvc", "pvc", "abs", "acier_galv_neuf", "acier_galv_usage", "fonte_neuve", "fonte_usee", "beton"] = "cuivre"


class PlumbingWaterHeaterInput(BaseModel):
    nb_chambres: int = Field(..., ge=1, le=20)
    nb_salles_bain: int = Field(..., ge=1, le=20)
    nb_personnes: int = Field(2, ge=1, le=50)


class PlumbingDrainSlopeInput(BaseModel):
    diametre_pouce: float = Field(..., gt=0, le=12)
    longueur_m: float = Field(..., gt=0, le=100)
    pente_pct: float = Field(2.0, ge=0.5, le=10)


# ---- HVAC ----

class HvacInput(BaseModel):
    surface_m2: float = Field(..., gt=0, le=10000)
    hauteur_plafond_m: float = Field(2.44, gt=0, le=20)
    isolation: Literal["faible", "moyenne", "bonne", "excellente"] = "moyenne"
    zone_climatique: Literal["montreal", "quebec", "gatineau", "sherbrooke", "saguenay", "rimouski", "val_dor", "nord"] = "montreal"


class HvacDuctInput(BaseModel):
    cfm: float = Field(..., gt=0, le=100000)
    type_circuit: Literal["residentiel_principal", "residentiel_branche", "commercial", "industriel"] = "residentiel_principal"


class HvacCfmInput(BaseModel):
    volume_m3: float = Field(..., gt=0, le=100000)
    type_piece: Literal["salon", "chambre", "cuisine", "salle_bain", "sous_sol", "garage", "atelier", "commercial", "restaurant", "laboratoire"] = "salon"


class HvacHrvInput(BaseModel):
    surface_m2: float = Field(..., gt=0, le=10000)
    nb_chambres: int = Field(..., ge=0, le=50)
    nb_occupants: int = Field(2, ge=0, le=500)


class HvacCoolingInput(BaseModel):
    surface_vitree_m2: float = Field(..., ge=0, le=10000)
    orientation: Literal["nord", "sud", "est", "ouest", "mixte"] = "mixte"
    shgc: float = Field(0.3, ge=0, le=1)
    rayonnement_w_m2: float = Field(700, ge=0, le=2000)
    nb_occupants: int = Field(4, ge=0, le=500)
    equipements_w: float = Field(500, ge=0, le=100000)


# ---- WELDING ----

class WeldingInput(BaseModel):
    type_joint: Literal["bout_a_bout", "en_T", "recouvrement", "angle"] = "angle"
    epaisseur_mm: float = Field(6, gt=0, le=100)
    longueur_soudure_mm: float = Field(300, gt=0, le=100000)
    procede: Literal["SMAW", "GMAW", "FCAW", "GTAW", "SAW"] = "SMAW"
    electrode: Optional[str] = Field(None, max_length=20)


class WeldingHeatInputInput(BaseModel):
    tension_v: float = Field(25, gt=0, le=100)
    amperage_a: float = Field(150, gt=0, le=2000)
    vitesse_mm_min: float = Field(150, gt=0, le=10000)


class WeldingPreheatInput(BaseModel):
    carbone_pct: float = Field(0.2, ge=0, le=2)
    manganese_pct: float = Field(0.6, ge=0, le=3)
    chrome_pct: float = Field(0, ge=0, le=30)
    molybdene_pct: float = Field(0, ge=0, le=10)
    vanadium_pct: float = Field(0, ge=0, le=5)
    nickel_pct: float = Field(0, ge=0, le=40)
    cuivre_pct: float = Field(0, ge=0, le=5)
    epaisseur_mm: float = Field(12, gt=0, le=200)


class WeldingConsumableInput(BaseModel):
    poids_metal_depose_g: float = Field(..., gt=0, le=1_000_000)
    procede: Literal["SMAW", "GMAW", "FCAW", "GTAW", "SAW"] = "SMAW"


# ---- BENDING ----

class BendingInput(BaseModel):
    longueur_piece_mm: float = Field(..., gt=0, le=10000)
    epaisseur_mm: float = Field(..., gt=0, le=100)
    angle_pliage_deg: float = Field(90, gt=0, le=180)
    rayon_interieur_mm: Optional[float] = Field(None, gt=0, le=100)
    largeur_piece_mm: float = Field(100, gt=0, le=10000)
    materiau: Literal["acier_doux_a36", "inox_304", "inox_316", "alu_6061_t6", "alu_5052_h32", "cuivre", "titane_gr2", "galvanise"] = "acier_doux_a36"


class BendingSpringbackInput(BaseModel):
    angle_voulu_deg: float = Field(90, gt=0, le=180)
    materiau: Literal["acier_doux_a36", "inox_304", "inox_316", "alu_6061_t6", "alu_5052_h32", "cuivre", "titane_gr2", "galvanise"] = "acier_doux_a36"


class BendingMinRadiusInput(BaseModel):
    epaisseur_mm: float = Field(..., gt=0, le=100)
    materiau: Literal["acier_doux_a36", "inox_304", "inox_316", "alu_6061_t6", "alu_5052_h32", "cuivre", "titane_gr2", "galvanise"] = "acier_doux_a36"


# ---- METAL WEIGHT ----

class MetalWeightInput(BaseModel):
    forme: Literal[
        "plaque", "tube_rond", "tube_carre",
        "barre_ronde", "barre_carree", "angle", "poutre_i", "profil_w", "profil_c"
    ]
    materiau: str = Field("acier_a36", min_length=1, max_length=50)
    # Allows string values for profil_w/profil_c section_key
    dimensions: Dict[str, Union[str, float]] = Field(...)


# ---- TAXES ----

class TaxesInput(BaseModel):
    montant_ht: float = Field(..., ge=0, le=1_000_000_000)


# ---- PAYROLL CHARGES ----

class ChargeTributaireInput(BaseModel):
    salaire_brut: float = Field(..., gt=0, le=10_000_000)
    type_employe: Literal["regulier", "construction_ccq"] = "regulier"


# ---- STRUCTURAL (CNBC/CSA O86) ----

class ChargeTributaireCompleteInput(BaseModel):
    type_element: Literal["poutre", "linteau", "colonne"] = "poutre"
    type_materiau: Literal["bois_dimensionnel", "lvl"] = "bois_dimensionnel"
    section: str = Field("2x10", min_length=1, max_length=30)
    ply_count: int = Field(1, ge=1, le=6)
    portee_mm: float = Field(3000, gt=0, le=50000)
    charge_morte_kpa: float = Field(0.5, ge=0, le=100)
    charge_vive_kpa: float = Field(1.9, ge=0, le=100)
    charge_neige_kpa: float = Field(0, ge=0, le=100)
    largeur_tributaire_m: float = Field(3.0, gt=0, le=50)
    type_utilisation: Literal["plancher", "toit", "linteau"] = "plancher"


# ---- HISTORY ----

# Max size constraints on Dict[str, Any] fields to prevent DoS via huge payloads
MAX_DICT_KEYS = 100
MAX_DICT_JSON_SIZE = 50_000  # 50KB serialized


def _validate_dict_size(v, field_name="dict"):
    """Reject dicts with > 100 keys or > 50KB serialized size (DoS guard)."""
    if not isinstance(v, dict):
        return v
    if len(v) > MAX_DICT_KEYS:
        raise ValueError(f"{field_name}: maximum {MAX_DICT_KEYS} cles")
    try:
        json_str = json.dumps(v, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name}: non serialisable en JSON")
    if len(json_str) > MAX_DICT_JSON_SIZE:
        raise ValueError(f"{field_name}: taille maximum {MAX_DICT_JSON_SIZE} octets")
    return v


class HistoryCreate(BaseModel):
    calculator_id: str = Field(..., min_length=1, max_length=100)
    subcalc_id: Optional[str] = Field(None, max_length=100)
    label: str = Field(..., min_length=1, max_length=200)
    inputs: Dict[str, Any] = Field(default_factory=dict)
    results: Dict[str, Any] = Field(default_factory=dict)
    notes: Optional[str] = Field(None, max_length=2000)

    @model_validator(mode="after")
    def _validate_sizes(self):
        _validate_dict_size(self.inputs, "inputs")
        _validate_dict_size(self.results, "results")
        return self


# ---- AI ----

class AiChatRequest(BaseModel):
    calculator_id: Optional[str] = Field(None, max_length=100)
    question: str = Field(..., min_length=1, max_length=2000)
    include_context: bool = True


class AiAnalyzeRequest(BaseModel):
    calculator_id: str = Field(..., min_length=1, max_length=100)
    inputs: Dict[str, Any] = Field(default_factory=dict)
    results: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_sizes(self):
        _validate_dict_size(self.inputs, "inputs")
        _validate_dict_size(self.results, "results")
        return self


class AiRecommendRequest(BaseModel):
    calculator_id: str = Field(..., min_length=1, max_length=100)
    objectif: str = Field(..., min_length=1, max_length=1000)
    contraintes: Optional[str] = Field(None, max_length=1000)


class AiExplainNormRequest(BaseModel):
    norme: str = Field(..., min_length=1, max_length=200)
    contexte: Optional[str] = Field(None, max_length=1000)


class AiDiagnoseRequest(BaseModel):
    calculator_id: str = Field(..., min_length=1, max_length=100)
    probleme: str = Field(..., min_length=1, max_length=2000)
    symptomes: Optional[str] = Field(None, max_length=2000)


class AiOptimizeRequest(BaseModel):
    calculator_id: str = Field(..., min_length=1, max_length=100)
    inputs_actuels: Dict[str, Any] = Field(default_factory=dict)
    objectif_optimisation: Literal["cout", "performance", "ecologique", "delai"] = "cout"

    @model_validator(mode="after")
    def _validate_sizes(self):
        _validate_dict_size(self.inputs_actuels, "inputs_actuels")
        return self


# ============================================
# HELPERS
# ============================================

def _require_tenant(user: ErpUser):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")


def _safe_rollback(conn) -> None:
    if conn is None:
        return
    try:
        conn.rollback()
    except Exception as exc:
        logger.warning("rollback failed: %s", exc)


def _serialize(row) -> dict:
    if row is None:
        return {}
    d = dict(row)
    for key, val in list(d.items()):
        if isinstance(val, Decimal):
            d[key] = float(val)
        elif isinstance(val, (date, datetime)):
            d[key] = val.isoformat()
    return d


def _parse_json_field(value):
    if value is None:
        return {}
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning("_parse_json_field decode error: %s", exc)
            return {}
    return {}


def _ensure_calculators_tables(cursor, conn):
    """Create calculator_history table if absent."""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS calculator_history (
            id SERIAL PRIMARY KEY,
            calculator_id TEXT NOT NULL,
            subcalc_id TEXT,
            label TEXT NOT NULL,
            inputs JSONB DEFAULT '{}',
            results JSONB DEFAULT '{}',
            notes TEXT,
            user_id INTEGER,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # CREATE INDEX IF NOT EXISTS can race between two workers on a fresh
    # tenant (pg_class_relname_nsp_index). Wrap in SAVEPOINT so the race
    # does not abort the outer transaction.
    cursor.execute("SAVEPOINT sp_calc_history_idx")
    try:
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_calc_history_calc "
            "ON calculator_history(calculator_id, created_at DESC)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_calc_history_created "
            "ON calculator_history(created_at DESC)"
        )
        cursor.execute("RELEASE SAVEPOINT sp_calc_history_idx")
    except Exception as exc:
        try:
            cursor.execute("ROLLBACK TO SAVEPOINT sp_calc_history_idx")
        except Exception:
            pass
        _msg = str(exc).lower()
        if not any(tok in _msg for tok in ("duplicate key", "pg_class_relname", "already exists")):
            raise
        logger.warning("calculator_history index race: %s", exc)
    conn.commit()


def _get_tenant_cursor(user: ErpUser):
    """Return (conn, cursor) with tenant context set and tables ensured.

    Forces autocommit=False for explicit transaction control (lecon #131).
    Explicitly cleans up connection on post-get_conn failure to prevent
    pool exhaustion (lecon #73).
    """
    _require_tenant(user)
    conn = db.get_conn()
    try:
        try:
            conn.autocommit = False
        except Exception as exc:
            logger.warning("conn.autocommit = False failed: %s", exc)
        cursor = conn.cursor()
        db.set_tenant(conn, user.schema)
        _ensure_calculators_tables(cursor, conn)
        return conn, cursor
    except Exception:
        try:
            db.reset_tenant(conn)
        except Exception as reset_exc:
            logger.warning("reset_tenant on exception failed: %s", reset_exc)
        try:
            conn.close()
        except Exception as close_exc:
            logger.warning("conn.close on exception failed: %s", close_exc)
        raise


def _close_tenant(conn, cursor):
    if cursor:
        try:
            cursor.close()
        except Exception as exc:
            logger.warning("cursor close failed: %s", exc)
    if conn:
        try:
            db.reset_tenant(conn)
        except Exception as exc:
            logger.warning("reset_tenant failed: %s", exc)
        try:
            conn.close()
        except Exception as exc:
            logger.warning("conn close failed: %s", exc)


def _guard_ai(user: ErpUser):
    if not _anthropic_client:
        raise HTTPException(status_code=503, detail="Service IA non disponible")
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")
    credits_ok, _balance = _check_credits(user)
    if not credits_ok:
        raise HTTPException(
            status_code=402,
            detail="Credits IA epuises. Veuillez recharger votre solde pour continuer.",
        )


def _ai_cost(
    input_tokens: int,
    output_tokens: int,
    cache_creation_tokens: int = 0,
    cache_read_tokens: int = 0,
) -> float:
    # Opus 4.7: $15/M input, $75/M output, $18.75/M cache write, $1.50/M cache read.
    return (
        input_tokens * CALC_PRICING_INPUT_PER_M / 1_000_000
        + output_tokens * CALC_PRICING_OUTPUT_PER_M / 1_000_000
        + cache_creation_tokens * CALC_PRICING_CACHE_WRITE_PER_M / 1_000_000
        + cache_read_tokens * CALC_PRICING_CACHE_READ_PER_M / 1_000_000
    ) * CALC_PRICING_MARKUP


def _strip_markdown_json(text: str) -> str:
    """Remove ```json / ```python / ``` wrappers around AI responses."""
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) >= 2:
            inner = parts[1]
            first_nl = inner.find("\n")
            if first_nl != -1:
                first_line = inner[:first_nl].strip()
                if first_line and not first_line.startswith(("{", "[", '"')):
                    inner = inner[first_nl + 1:]
            text = inner.strip()
    return text


def _call_claude_json(user: ErpUser, feature: str, prompt: str, temperature: float = 0.3) -> dict:
    _guard_ai(user)
    start = time_module.time()
    try:
        response = _anthropic_client.messages.create(
            model=CALC_AI_MODEL,
            max_tokens=CALC_AI_MAX_TOKENS,
            temperature=temperature,
            system=CALC_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
    except HTTPException:
        raise
    except Exception as exc:
        msg = str(exc).lower()
        if "overload" in msg or "529" in msg:
            logger.warning("Claude overload (%s): %s", feature, exc)
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge. Reessayer dans quelques instants.")
        if "too_large" in msg or "413" in msg:
            logger.warning("Claude too_large (%s): %s", feature, exc)
            raise HTTPException(status_code=413, detail="Requete trop volumineuse pour l'IA.")
        logger.error("Claude API error (%s): %s", feature, exc)
        raise HTTPException(status_code=502, detail="Service IA temporairement indisponible")

    elapsed = time_module.time() - start
    input_tokens = getattr(response.usage, "input_tokens", 0)
    output_tokens = getattr(response.usage, "output_tokens", 0)
    cache_creation_tokens = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
    cache_read_tokens = getattr(response.usage, "cache_read_input_tokens", 0) or 0
    cost = _ai_cost(input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens)

    text = ""
    for block in response.content:
        if hasattr(block, "text"):
            text += block.text
    text = _strip_markdown_json(text)

    if not text:
        logger.error("AI empty response (%s)", feature)
        raise HTTPException(status_code=502, detail="Reponse IA vide, veuillez reessayer")
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.error("AI JSON parse error (%s): %s | text=%r", feature, exc, text[:500])
        raise HTTPException(status_code=502, detail="Reponse IA invalide, veuillez reessayer")
    if not isinstance(parsed, dict):
        logger.error("AI JSON must be a dict (%s), got %s: %r", feature, type(parsed).__name__, text[:500])
        raise HTTPException(status_code=502, detail="Reponse IA invalide (format inattendu)")

    try:
        track_ai_usage(
            user, feature, input_tokens, output_tokens, cost,
            int(elapsed * 1000), success=True, model=CALC_AI_MODEL,
        )
        _deduct_credits(user, cost)
    except Exception as track_exc:
        logger.warning("track_ai_usage failed (%s): %s", feature, track_exc)

    return parsed


def _call_claude_text(user: ErpUser, feature: str, prompt: str, temperature: float = 0.3) -> str:
    _guard_ai(user)
    start = time_module.time()
    try:
        response = _anthropic_client.messages.create(
            model=CALC_AI_MODEL,
            max_tokens=CALC_AI_MAX_TOKENS,
            temperature=temperature,
            system=CALC_AI_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
    except HTTPException:
        raise
    except Exception as exc:
        msg = str(exc).lower()
        if "overload" in msg or "529" in msg:
            raise HTTPException(status_code=503, detail="Service IA temporairement surcharge. Reessayer dans quelques instants.")
        if "too_large" in msg or "413" in msg:
            raise HTTPException(status_code=413, detail="Requete trop volumineuse pour l'IA.")
        logger.error("Claude API error (%s): %s", feature, exc)
        raise HTTPException(status_code=502, detail="Service IA temporairement indisponible")

    elapsed = time_module.time() - start
    input_tokens = getattr(response.usage, "input_tokens", 0)
    output_tokens = getattr(response.usage, "output_tokens", 0)
    cache_creation_tokens = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
    cache_read_tokens = getattr(response.usage, "cache_read_input_tokens", 0) or 0
    cost = _ai_cost(input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens)

    text = ""
    for block in response.content:
        if hasattr(block, "text"):
            text += block.text
    text = text.strip()

    if not text:
        logger.error("AI empty text response (%s)", feature)
        raise HTTPException(status_code=502, detail="Reponse IA vide, veuillez reessayer")

    try:
        track_ai_usage(
            user, feature, input_tokens, output_tokens, cost,
            int(elapsed * 1000), success=True, model=CALC_AI_MODEL,
        )
        _deduct_credits(user, cost)
    except Exception as track_exc:
        logger.warning("track_ai_usage failed (%s): %s", feature, track_exc)

    return text


# ============================================
# CALCULATION HELPERS
# ============================================

def _interpolate_k_factor(r_over_t: float) -> float:
    """Linear interpolation in K_FACTOR_TABLE for R/T ratio."""
    if r_over_t <= K_FACTOR_TABLE[0]["r_t"]:
        return K_FACTOR_TABLE[0]["k"]
    if r_over_t >= K_FACTOR_TABLE[-1]["r_t"]:
        return K_FACTOR_TABLE[-1]["k"]
    for i in range(len(K_FACTOR_TABLE) - 1):
        if K_FACTOR_TABLE[i]["r_t"] <= r_over_t <= K_FACTOR_TABLE[i + 1]["r_t"]:
            x0, y0 = K_FACTOR_TABLE[i]["r_t"], K_FACTOR_TABLE[i]["k"]
            x1, y1 = K_FACTOR_TABLE[i + 1]["r_t"], K_FACTOR_TABLE[i + 1]["k"]
            if x1 == x0:
                return y0
            return y0 + (y1 - y0) * (r_over_t - x0) / (x1 - x0)
    return 0.33


def _find_awg(section_mm2: float) -> Dict[str, Any]:
    """Find smallest AWG that can carry the required section."""
    for row in AWG_TABLE:
        if row["section_mm2"] >= section_mm2:
            return dict(row)
    return dict(AWG_TABLE[-1])


def _find_drain_diameter(dfu: int) -> Dict[str, Any]:
    for row in DIAMETRES_DRAIN:
        if dfu <= row["dfu_max"]:
            return dict(row)
    return dict(DIAMETRES_DRAIN[-1])


def _cure_time_min(temperature_c: float) -> int:
    if temperature_c > 20:
        return CURE_TIME_MIN["above_20"]
    if temperature_c > 10:
        return CURE_TIME_MIN["10_20"]
    if temperature_c > 5:
        return CURE_TIME_MIN["5_10"]
    return CURE_TIME_MIN["0_5"]


def _v_die_opening(thickness: float) -> float:
    for row in V_DIE_OPENING:
        if thickness <= row["epaisseur_max_mm"]:
            return thickness * row["v_facteur"]
    return thickness * 12


# ============================================
# CONCRETE ENDPOINTS
# ============================================

@router.post("/concrete")
async def calc_concrete(body: ConcreteInput, user: ErpUser = Depends(get_current_user)):
    """Basic concrete volume + dosage (CSA A23.1)."""
    vol = body.longueur * body.largeur * body.epaisseur
    waste = vol * body.perte_pct / 100
    total = vol + waste
    surface = body.longueur * body.largeur

    # Use default 25MPa dosage
    dosage = DOSAGES_BETON["25MPa"]
    ciment = total * dosage["ciment"]
    sable = total * dosage["sable"]
    gravier = total * dosage["gravier"]
    eau = total * dosage["eau"]

    classe = CLASSES_BETON.get(body.classe_beton or "C-2", CLASSES_BETON["C-2"])

    # Bags (Quebec 30 kg standard or 40 kg)
    sacs_30 = math.ceil(ciment / 30)
    sacs_40 = math.ceil(ciment / 40)

    # Formwork estimate (all perimeter sides)
    perimetre = 2 * (body.longueur + body.largeur)
    surface_coffrage = perimetre * body.epaisseur
    feuilles_coffrage = math.ceil(surface_coffrage / 2.97)  # 4x8 sheet = 2.97 m2

    return {
        "volume_m3": round(vol, 3),
        "perte_m3": round(waste, 3),
        "volume_total_m3": round(total, 3),
        "surface_m2": round(surface, 2),
        "ciment_kg": round(ciment, 1),
        "sable_kg": round(sable, 1),
        "gravier_kg": round(gravier, 1),
        "eau_litres": round(eau, 1),
        "sacs_30_kg": sacs_30,
        "sacs_40_kg": sacs_40,
        "classe_beton": classe,
        "surface_coffrage_m2": round(surface_coffrage, 2),
        "feuilles_coffrage_4x8": feuilles_coffrage,
    }


@router.post("/concrete/dosage")
async def calc_concrete_dosage(body: ConcreteDosageInput, user: ErpUser = Depends(get_current_user)):
    """Dosage detaille pour une classe de resistance specifique (CSA A23.1)."""
    dosage = DOSAGES_BETON[body.resistance_mpa]
    vol = body.volume_m3

    ciment = vol * dosage["ciment"]
    sable = vol * dosage["sable"]
    gravier = vol * dosage["gravier"]
    eau = vol * dosage["eau"]

    return {
        "resistance_mpa": body.resistance_mpa,
        "volume_m3": vol,
        "ec_ratio": dosage["ec_ratio"],
        "dosage_par_m3": dict(dosage),
        "quantites_totales": {
            "ciment_kg": round(ciment, 1),
            "sable_kg": round(sable, 1),
            "gravier_kg": round(gravier, 1),
            "eau_litres": round(eau, 1),
        },
        "ratio": f"1:{round(dosage['sable']/dosage['ciment'], 2)}:{round(dosage['gravier']/dosage['ciment'], 2)}",
        "sacs_30_kg": math.ceil(ciment / 30),
        "sacs_40_kg": math.ceil(ciment / 40),
    }


@router.post("/concrete/rebar")
async def calc_concrete_rebar(body: ConcreteRebarInput, user: ErpUser = Depends(get_current_user)):
    """Quantite d'armature pour dalle (grille 2 directions)."""
    longueur_eff = body.longueur_m - 2 * (body.enrobage_mm / 1000)
    largeur_eff = body.largeur_m - 2 * (body.enrobage_mm / 1000)
    espacement_m = body.espacement_mm / 1000

    barres_long = math.ceil(largeur_eff / espacement_m) + 1
    barres_larg = math.ceil(longueur_eff / espacement_m) + 1

    longueur_totale = (barres_long * longueur_eff + barres_larg * largeur_eff) * body.nb_lits
    longueur_avec_perte = longueur_totale * (1 + body.perte_pct / 100)

    barre = BARRES_ARMATURE[body.barre_type]
    masse_totale = longueur_avec_perte * barre["masse_kg_m"]
    masse_lb = masse_totale * 2.20462

    # Barres standard 6m
    nb_barres_standard = math.ceil(longueur_avec_perte / 6)

    return {
        "barre_type": body.barre_type,
        "proprietes_barre": dict(barre),
        "nb_barres_longitudinales": barres_long,
        "nb_barres_transversales": barres_larg,
        "longueur_totale_m": round(longueur_totale, 2),
        "longueur_avec_perte_m": round(longueur_avec_perte, 2),
        "nb_barres_standard_6m": nb_barres_standard,
        "masse_totale_kg": round(masse_totale, 2),
        "masse_totale_lb": round(masse_lb, 2),
        "nb_lits": body.nb_lits,
        "espacement_mm": body.espacement_mm,
    }


@router.post("/concrete/cure")
async def calc_concrete_cure(body: ConcreteCureInput, user: ErpUser = Depends(get_current_user)):
    """Developpement resistance + temps de cure (ACI 209)."""
    coef = ACI_209[body.ciment_type]
    t = body.age_jours
    # f(t) = f28 * t / (a + b*t)
    facteur_maturite = 1.0
    if body.temperature_c < 0:
        facteur_maturite = 0
    elif body.temperature_c < 10:
        facteur_maturite = 0.5
    elif body.temperature_c < 20:
        facteur_maturite = 0.8

    t_effective = t * facteur_maturite
    if t_effective <= 0:
        resistance_courante = 0
        pct_finale = 0
    else:
        resistance_courante = body.resistance_finale_mpa * t_effective / (coef["a"] + coef["b"] * t_effective)
        pct_finale = (resistance_courante / body.resistance_finale_mpa) * 100

    temps_min_cure = _cure_time_min(body.temperature_c)

    return {
        "ciment_type": body.ciment_type,
        "description": coef["description"],
        "age_jours": body.age_jours,
        "temperature_c": body.temperature_c,
        "facteur_maturite": facteur_maturite,
        "age_effectif_jours": round(t_effective, 2),
        "resistance_finale_mpa": body.resistance_finale_mpa,
        "resistance_courante_mpa": round(resistance_courante, 2),
        "pct_resistance_finale": round(pct_finale, 1),
        "temps_cure_minimum_jours": temps_min_cure,
        "recommandations": {
            "3_jours_pct": 30 if body.temperature_c < 10 else 50,
            "7_jours_pct": 60 if body.temperature_c < 10 else 70,
            "14_jours_pct": 80,
            "28_jours_pct": 100,
        },
    }


@router.post("/concrete/formwork")
async def calc_concrete_formwork(body: ConcreteFormworkInput, user: ErpUser = Depends(get_current_user)):
    """Coffrage pour un mur (surface + feuilles)."""
    surface_mur = body.longueur_m * body.hauteur_m
    # Both sides of wall
    surface_totale = 2 * surface_mur
    # 4x8 sheet = 1.22 x 2.44 = 2.9768 m2
    feuilles_4x8 = math.ceil(surface_totale / 2.9768 * 1.05)  # 5% waste
    # Support beams (2x4 every 60 cm)
    nb_etais = math.ceil(body.longueur_m / 0.6 + 1)

    return {
        "surface_mur_m2": round(surface_mur, 2),
        "surface_coffrage_totale_m2": round(surface_totale, 2),
        "feuilles_4x8": feuilles_4x8,
        "nb_etais_2x4": nb_etais,
        "bois_montants_m": round(body.hauteur_m * nb_etais, 2),
    }


@router.post("/concrete/excavation")
async def calc_concrete_excavation(body: ConcreteExcavationInput, user: ErpUser = Depends(get_current_user)):
    """Volume excavation avec foisonnement + nb camions."""
    volume_compact = body.longueur_m * body.largeur_m * body.profondeur_m
    facteur = FOISONNEMENT[body.type_sol]
    volume_foisonne = volume_compact * facteur
    volume_yd3 = volume_foisonne * 1.30795
    # Camion standard 12 yd3
    nb_camions = math.ceil(volume_yd3 / 12)
    poids_estime_tonnes = volume_compact * 1.8  # typical 1800 kg/m3

    return {
        "type_sol": body.type_sol,
        "facteur_foisonnement": facteur,
        "volume_compact_m3": round(volume_compact, 2),
        "volume_foisonne_m3": round(volume_foisonne, 2),
        "volume_foisonne_yd3": round(volume_yd3, 2),
        "nb_camions_12yd3": nb_camions,
        "poids_estime_tonnes": round(poids_estime_tonnes, 2),
    }


@router.post("/concrete/talus")
async def calc_concrete_talus(body: ConcreteTalusInput, user: ErpUser = Depends(get_current_user)):
    """Pente securitaire talus (CNESST)."""
    talus = PENTES_TALUS_CNESST[body.type_sol]
    h = body.profondeur_m
    distance_horizontale = h * talus["ratio_h_v"]

    exigences = []
    if h > 1.2:
        exigences.append("Inspection quotidienne par personne qualifiee (CNESST)")
    if h > 3:
        exigences.append("Analyse par ingenieur recommandee")
    if h > 6:
        exigences.append("Analyse par ingenieur OBLIGATOIRE")
    if h < 1.2:
        exigences.append("Travail securitaire sans pente particuliere")

    return {
        "type_sol": body.type_sol,
        "description": talus["description"],
        "ratio_h_v": talus["ratio_h_v"],
        "angle_degres": talus["angle_deg"],
        "profondeur_m": h,
        "distance_horizontale_m": round(distance_horizontale, 2),
        "volume_additionnel_m3": round(distance_horizontale * h / 2, 2),  # per lineal metre
        "exigences_cnesst": exigences,
    }


@router.post("/concrete/stairs")
async def calc_concrete_stairs(body: ConcreteStairsInput, user: ErpUser = Depends(get_current_user)):
    """Escaliers beton: dimensions + volume (Blondel)."""
    nb_marches = max(1, round(body.hauteur_totale_mm / body.hauteur_marche_cible_mm))
    hauteur_marche = body.hauteur_totale_mm / nb_marches
    giron = body.giron_cible_mm
    blondel = 2 * hauteur_marche + giron
    blondel_ok = BLONDEL_MIN <= blondel <= BLONDEL_MAX

    # Volume marches (triangles)
    v_marche = 0.5 * (hauteur_marche / 1000) * (giron / 1000) * body.largeur_m * (nb_marches - 1)

    # Volume dalle inclinee
    longueur_reculement = (giron / 1000) * (nb_marches - 1)
    longueur_dalle = math.sqrt((body.hauteur_totale_mm / 1000) ** 2 + longueur_reculement ** 2)
    v_dalle = longueur_dalle * body.largeur_m * (body.epaisseur_dalle_mm / 1000)

    volume_total = (v_marche + v_dalle) * 1.10  # 10% waste

    # Use 30 MPa for stairs (C-3 exposure)
    dosage = DOSAGES_BETON["30MPa"]
    ciment = volume_total * dosage["ciment"]

    return {
        "nb_marches": nb_marches,
        "hauteur_marche_mm": round(hauteur_marche, 1),
        "giron_mm": round(giron, 1),
        "blondel_2r_g": round(blondel, 1),
        "blondel_conforme": blondel_ok,
        "longueur_reculement_mm": round(longueur_reculement * 1000, 0),
        "longueur_dalle_mm": round(longueur_dalle * 1000, 0),
        "volume_marches_m3": round(v_marche, 3),
        "volume_dalle_m3": round(v_dalle, 3),
        "volume_total_m3": round(volume_total, 3),
        "ciment_kg": round(ciment, 1),
        "sable_kg": round(volume_total * dosage["sable"], 1),
        "gravier_kg": round(volume_total * dosage["gravier"], 1),
        "eau_litres": round(volume_total * dosage["eau"], 1),
    }


# ============================================
# STAIRS ENDPOINTS
# ============================================

@router.post("/stairs")
async def calc_stairs(body: StairInput, user: ErpUser = Depends(get_current_user)):
    """Dimensions escalier (CCQ 9.8 residentiel / 3.4 commercial)."""
    code = ESCALIERS_CCQ[body.usage]

    nb_marches = max(1, round(body.hauteur_totale / body.hauteur_marche_cible))
    hauteur_marche = body.hauteur_totale / nb_marches
    giron = body.giron_cible
    blondel = 2 * hauteur_marche + giron
    reculement = giron * (nb_marches - 1)
    pente_deg = math.degrees(math.atan(hauteur_marche / giron)) if giron > 0 else 0
    longueur_foulee = math.sqrt(body.hauteur_totale ** 2 + reculement ** 2)

    # Conformite par critere
    conformite = {
        "contremarche": code["contremarche_min"] <= hauteur_marche <= code["contremarche_max"],
        "giron": code["giron_min"] <= giron <= code["giron_max"],
        "blondel": BLONDEL_MIN <= blondel <= BLONDEL_MAX,
        "largeur": (body.largeur_m * 1000) >= code["largeur_min"],
        "pente": 20 <= pente_deg <= 45,
    }
    conforme_global = all(conformite.values())

    return {
        "usage": body.usage,
        "code_label": code["label"],
        "nb_marches": nb_marches,
        "hauteur_marche_mm": round(hauteur_marche, 1),
        "giron_mm": round(giron, 1),
        "largeur_mm": round(body.largeur_m * 1000, 0),
        "formule_2r_g": round(blondel, 1),
        "blondel_optimal": BLONDEL_OPT,
        "conforme_ccq": conforme_global,
        "conforme_blondel": BLONDEL_MIN <= blondel <= BLONDEL_MAX,
        "conformite_detail": conformite,
        "reculement_mm": round(reculement, 1),
        "pente_degres": round(pente_deg, 1),
        "ligne_foulee_mm": round(longueur_foulee, 1),
        "hauteur_totale_mm": body.hauteur_totale,
        "criteres_code": dict(code),
        "evaluation_confort": (
            "Trop faible" if pente_deg < 25 else
            "Acceptable" if pente_deg <= 42 else
            "Echelle/raide"
        ),
    }


@router.post("/stairs/materials")
async def calc_stairs_materials(body: StairMaterialsInput, user: ErpUser = Depends(get_current_user)):
    """Materiaux requis pour escalier selon type (bois / beton / acier)."""
    nb_contremarches = body.nb_marches
    nb_girons = body.nb_marches - 1

    if body.materiau == "bois":
        # Bois: marches + contremarches + limons
        essence = body.essence_bois or "pin"
        bois_data = ESSENCES_BOIS_ESCALIER.get(essence, ESSENCES_BOIS_ESCALIER["pin"])
        # Marches 2x10 (38x235 mm), 30 mm thick typical
        v_marche = body.largeur_m * 0.280 * 0.030  # 30mm thick
        v_marches_total = v_marche * nb_girons
        # Contremarches 2x8 (38x184)
        v_contre = body.largeur_m * 0.175 * 0.020
        v_contre_total = v_contre * nb_contremarches
        # 2 limons 2x12 (38x286)
        longueur_limon = math.sqrt((nb_contremarches * 0.175) ** 2 + (nb_girons * 0.280) ** 2) + 0.5
        v_limons = 2 * longueur_limon * 0.038 * 0.286
        v_total = v_marches_total + v_contre_total + v_limons
        poids = v_total * bois_data["densite_kg_m3"]
        cout = v_total * bois_data["prix_m3"]

        return {
            "materiau": "bois",
            "essence": essence,
            "essence_label": bois_data["label"],
            "nb_marches": nb_girons,
            "nb_contremarches": nb_contremarches,
            "longueur_limon_m": round(longueur_limon, 2),
            "volume_bois_m3": round(v_total, 4),
            "poids_estime_kg": round(poids, 1),
            "cout_estime_cad": round(cout, 2),
            "detail": {
                "marches_m3": round(v_marches_total, 4),
                "contremarches_m3": round(v_contre_total, 4),
                "limons_m3": round(v_limons, 4),
            },
        }
    elif body.materiau == "beton":
        hauteur_totale = nb_contremarches * 0.175
        reculement = nb_girons * 0.280
        v_marches = 0.5 * 0.175 * 0.280 * body.largeur_m * nb_girons
        longueur_dalle = math.sqrt(hauteur_totale ** 2 + reculement ** 2)
        v_dalle = longueur_dalle * body.largeur_m * 0.150  # 150 mm slab
        v_total = (v_marches + v_dalle) * 1.10
        dosage = DOSAGES_BETON["30MPa"]
        return {
            "materiau": "beton",
            "volume_total_m3": round(v_total, 3),
            "ciment_kg": round(v_total * dosage["ciment"], 1),
            "sable_kg": round(v_total * dosage["sable"], 1),
            "gravier_kg": round(v_total * dosage["gravier"], 1),
            "eau_litres": round(v_total * dosage["eau"], 1),
            "sacs_30kg": math.ceil(v_total * dosage["ciment"] / 30),
            "hauteur_totale_m": round(hauteur_totale, 2),
            "reculement_m": round(reculement, 2),
        }
    else:  # acier
        hauteur_totale = nb_contremarches * 0.175
        reculement = nb_girons * 0.280
        longueur_limon = math.sqrt(hauteur_totale ** 2 + reculement ** 2)
        # 2 limons C200x18 (17.9 kg/m)
        masse_limons = 2 * longueur_limon * 17.9
        # Marches 6mm diamond plate
        masse_marches = nb_girons * body.largeur_m * 0.280 * 0.006 * 7850
        masse_totale = masse_limons + masse_marches
        return {
            "materiau": "acier",
            "longueur_limon_m": round(longueur_limon, 2),
            "masse_limons_kg": round(masse_limons, 2),
            "masse_marches_kg": round(masse_marches, 2),
            "masse_totale_kg": round(masse_totale, 2),
            "cout_estime_cad": round(masse_totale * 1.20, 2),
        }


@router.post("/stairs/garde-corps")
async def calc_stairs_garde_corps(body: StairGardeCorpsInput, user: ErpUser = Depends(get_current_user)):
    """Garde-corps et main courante (CCQ 9.8.7 / 3.4)."""
    code = ESCALIERS_CCQ[body.usage]
    conforme_hauteur = code["main_courante_h_min"] <= body.hauteur_mm <= code["main_courante_h_max"]
    conforme_barreaux = body.espacement_barreaux_mm <= code["barreaux_max"]

    # Number of balusters
    nb_barreaux = math.ceil(body.longueur_m * 1000 / body.espacement_barreaux_mm) + 1
    nb_poteaux = math.ceil(body.longueur_m / 2.0) + 1  # post every 2m

    return {
        "usage": body.usage,
        "longueur_m": body.longueur_m,
        "hauteur_mm": body.hauteur_mm,
        "conforme_hauteur": conforme_hauteur,
        "conforme_barreaux": conforme_barreaux,
        "conforme_global": conforme_hauteur and conforme_barreaux,
        "nb_barreaux": nb_barreaux,
        "nb_poteaux": nb_poteaux,
        "longueur_main_courante_m": round(body.longueur_m + 0.3, 2),  # +prolongation
        "diametre_main_courante_mm": code["main_courante_diam"],
        "espacement_barreaux_mm": body.espacement_barreaux_mm,
        "criteres_code": {
            "main_courante_h_min": code["main_courante_h_min"],
            "main_courante_h_max": code["main_courante_h_max"],
            "barreaux_max": code["barreaux_max"],
        },
    }


# ============================================
# ELECTRICAL ENDPOINTS
# ============================================

@router.post("/electrical")
async def calc_electrical(body: ElectricalInput, user: ErpUser = Depends(get_current_user)):
    """Calibrage cable + chute de tension (CCE Article 4-004)."""
    courant = body.puissance_watts / (body.tension_volts * body.facteur_puissance)
    rho = RESISTIVITE_CUIVRE if body.conducteur == "cuivre" else RESISTIVITE_ALUMINIUM
    k = 2 if body.type_circuit == "monophase" else math.sqrt(3)

    # Section minimale (mm2) for target voltage drop
    section_min = (k * rho * body.longueur_cable_m * courant) / (body.tension_volts * body.chute_tension_max_pct / 100)

    # Find recommended AWG
    awg_row = _find_awg(section_min)

    # Real voltage drop with selected section
    chute_reelle_v = (k * rho * body.longueur_cable_m * courant) / awg_row["section_mm2"]
    chute_reelle_pct = (chute_reelle_v / body.tension_volts) * 100

    # Breaker sizing
    if courant <= 12:
        disjoncteur = 15
    elif courant <= 16:
        disjoncteur = 20
    elif courant <= 24:
        disjoncteur = 30
    elif courant <= 32:
        disjoncteur = 40
    elif courant <= 50:
        disjoncteur = 60
    elif courant <= 80:
        disjoncteur = 100
    else:
        disjoncteur = math.ceil(courant / 25) * 25

    conformite_chute = "Excellent" if chute_reelle_pct <= 3 else "Acceptable" if chute_reelle_pct <= 5 else "Non conforme"

    return {
        "courant_amperes": round(courant, 2),
        "conducteur": body.conducteur,
        "type_circuit": body.type_circuit,
        "section_min_mm2": round(section_min, 2),
        "awg_recommande": awg_row["awg"],
        "section_recommandee_mm2": awg_row["section_mm2"],
        "ampacite_60": awg_row["ampacite_60"],
        "ampacite_75": awg_row["ampacite_75"],
        "ampacite_90": awg_row["ampacite_90"],
        "chute_tension_volts": round(chute_reelle_v, 2),
        "chute_tension_pct": round(chute_reelle_pct, 2),
        "conformite_chute": conformite_chute,
        "disjoncteur_amperes": disjoncteur,
    }


@router.post("/electrical/residential")
async def calc_electrical_residential(body: ElectricalResidentialInput, user: ErpUser = Depends(get_current_user)):
    """Charge residentielle selon CCE Article 8-200."""
    # Methode standard CCE 8-200
    # Base: 5 kW pour 90 m2 + 1 kW par 90 m2 additionnel
    base_watts = 5000
    if body.surface_habitable_m2 > 90:
        tranches = math.ceil((body.surface_habitable_m2 - 90) / 90)
        base_watts += tranches * 1000

    # Charges electriques additionnelles
    chauffage_w = body.chauffage_kw * 1000
    clim_w = body.climatisation_kw * 1000
    # Only larger of heating or cooling counted
    hvac_w = max(chauffage_w, clim_w)

    cuisiniere_w = body.cuisiniere_kw * 1000
    secheuse_w = body.secheuse_kw * 1000
    chauffe_eau_w = body.chauffe_eau_kw * 1000
    autres_w = body.autres_charges_kw * 1000

    # Demand factors
    total_w = base_watts + hvac_w + (cuisiniere_w * 0.80) + (secheuse_w * 0.75) + chauffe_eau_w + (autres_w * 0.75)

    courant_240v = total_w / 240

    # Service recommendation
    if courant_240v <= 100:
        service = 100
    elif courant_240v <= 125:
        service = 125
    elif courant_240v <= 150:
        service = 150
    elif courant_240v <= 200:
        service = 200
    elif courant_240v <= 400:
        service = 400
    else:
        service = 600

    return {
        "surface_m2": body.surface_habitable_m2,
        "charge_base_w": base_watts,
        "hvac_w": hvac_w,
        "cuisiniere_w_demande": round(cuisiniere_w * 0.80, 0),
        "secheuse_w_demande": round(secheuse_w * 0.75, 0),
        "chauffe_eau_w": chauffe_eau_w,
        "autres_w_demande": round(autres_w * 0.75, 0),
        "total_demande_w": round(total_w, 0),
        "total_demande_kw": round(total_w / 1000, 2),
        "courant_service_240v": round(courant_240v, 1),
        "calibre_service_recommande_a": service,
        "article_cce": "8-200",
    }


@router.post("/electrical/lighting")
async def calc_electrical_lighting(body: ElectricalLightingInput, user: ErpUser = Depends(get_current_user)):
    """Calcul nombre de luminaires (methode des lumens)."""
    niveaux = ECLAIRAGE_NIVEAUX.get(body.type_local, ECLAIRAGE_NIVEAUX["salon"])
    lux_requis = niveaux["lux_recommande"]

    # n = (E * A) / (Phi * UF * MF)
    nb_luminaires = (lux_requis * body.surface_m2) / (body.flux_luminaire_lm * body.uf * body.mf)
    nb_luminaires = math.ceil(nb_luminaires)

    # Disposition en grille
    cote_m = math.sqrt(body.surface_m2)
    grille = math.ceil(math.sqrt(nb_luminaires))
    espacement = cote_m / grille if grille > 0 else 0

    return {
        "type_local": body.type_local,
        "surface_m2": body.surface_m2,
        "lux_requis": lux_requis,
        "lux_min_code": niveaux["lux_min"],
        "flux_luminaire_lm": body.flux_luminaire_lm,
        "facteur_utilisation": body.uf,
        "facteur_maintenance": body.mf,
        "nb_luminaires": nb_luminaires,
        "disposition_grille": f"{grille} x {grille}",
        "espacement_m": round(espacement, 2),
        "flux_total_requis_lm": round(lux_requis * body.surface_m2, 0),
    }


@router.post("/electrical/grounding")
async def calc_electrical_grounding(body: ElectricalGroundingInput, user: ErpUser = Depends(get_current_user)):
    """Mise a la terre - resistance (piquets)."""
    # R = rho / (2*pi*L) * (ln(4L/d) - 1)
    L = body.longueur_piquet_m
    d = body.diametre_piquet_m
    rho = body.resistivite_sol
    if d <= 0 or L <= 0:
        raise HTTPException(status_code=400, detail="Dimensions invalides")
    r_single = (rho / (2 * math.pi * L)) * (math.log(4 * L / d) - 1)

    # Multiple rods in parallel (with coupling factor 1.15)
    if body.nb_piquets > 1:
        r_total = r_single / body.nb_piquets * 1.15
    else:
        r_total = r_single

    conforme_hq = r_total <= 25

    return {
        "resistivite_sol": rho,
        "longueur_piquet_m": L,
        "diametre_piquet_m": d,
        "nb_piquets": body.nb_piquets,
        "resistance_piquet_unique_ohms": round(r_single, 2),
        "resistance_totale_ohms": round(r_total, 2),
        "conforme_hydro_quebec": conforme_hq,
        "seuil_hydro_quebec_ohms": 25,
        "recommandation": "Ajouter des piquets ou ameliorer le sol" if not conforme_hq else "Conforme",
    }


# ============================================
# ROOFING ENDPOINTS
# ============================================

@router.post("/roofing")
async def calc_roofing(body: RoofingInput, user: ErpUser = Depends(get_current_user)):
    """Surface toiture + quantites bardeaux."""
    pente_facteur = math.sqrt(1 + (body.pente_ratio / 12) ** 2)
    surface_base = (body.longueur_m + 2 * body.debord_m) * (body.largeur_m + 2 * body.debord_m)
    surface_pente = surface_base * pente_facteur
    perte = surface_pente * body.perte_pct / 100
    surface_totale = surface_pente + perte

    nb_squares = surface_totale / 9.29
    nb_paquets = math.ceil(nb_squares * 3)  # 3 bundles/square
    # Underlayment rolls (~93 m2/roll)
    rouleaux_sous_couche = math.ceil(surface_totale / 93)
    # Ice shield ~15% of surface, 65 ft/roll
    membrane_glace = math.ceil(surface_totale * 0.15 / 20)  # 20 m2/roll
    # Nails: 320/bundle, 5000/box
    boites_clous = math.ceil(nb_paquets * 320 / 5000)

    # Cost estimation
    mat_key = body.type_materiau or "bardeau_architect"
    materiau = MATERIAUX_TOITURE.get(mat_key, MATERIAUX_TOITURE["bardeau_architect"])
    cout_materiau = nb_squares * materiau["cout_carre"]
    cout_pose = nb_squares * materiau["cout_pose"]
    cout_total = cout_materiau + cout_pose

    return {
        "surface_base_m2": round(surface_base, 2),
        "facteur_pente": round(pente_facteur, 3),
        "pente_degres": round(math.degrees(math.atan(body.pente_ratio / 12)), 1),
        "surface_pente_m2": round(surface_pente, 2),
        "perte_m2": round(perte, 2),
        "surface_totale_m2": round(surface_totale, 2),
        "nb_squares": round(nb_squares, 2),
        "nb_paquets_bardeaux": nb_paquets,
        "rouleaux_sous_couche": rouleaux_sous_couche,
        "membrane_glace_rouleaux": membrane_glace,
        "boites_clous": boites_clous,
        "materiau": materiau["label"],
        "cout_materiau_cad": round(cout_materiau, 2),
        "cout_pose_cad": round(cout_pose, 2),
        "cout_total_cad": round(cout_total, 2),
    }


@router.post("/roofing/ventilation")
async def calc_roofing_ventilation(body: RoofingVentilationInput, user: ErpUser = Depends(get_current_user)):
    """Ventilation combles CCQ 9.19.1 (1:300 avec pare-vapeur, 1:150 sans)."""
    ratio = 300 if body.pare_vapeur else 150
    surface_pi2 = body.surface_comble_m2 * 10.7639
    nfa_total_pi2 = surface_pi2 / ratio  # sq ft
    nfa_total_po2 = nfa_total_pi2 * 144  # sq in

    # 50/50 split
    nfa_entree_po2 = nfa_total_po2 / 2
    nfa_sortie_po2 = nfa_total_po2 / 2

    # Soffite continu: ~9 po2/pi lineal
    # Turbine 12": ~150 po2/unit
    # Event faitier: ~18 po2/pi
    soffite_pi = nfa_entree_po2 / 9
    turbines = math.ceil(nfa_sortie_po2 / 150)
    faitier_pi = nfa_sortie_po2 / 18

    return {
        "surface_comble_m2": body.surface_comble_m2,
        "pare_vapeur": body.pare_vapeur,
        "ratio_ventilation": f"1:{ratio}",
        "article_ccq": "9.19.1" + (" + 9.25.3" if body.pare_vapeur else ""),
        "nfa_total_po2": round(nfa_total_po2, 1),
        "nfa_entree_po2": round(nfa_entree_po2, 1),
        "nfa_sortie_po2": round(nfa_sortie_po2, 1),
        "soffite_continu_pi": round(soffite_pi, 1),
        "nb_turbines_12po": turbines,
        "event_faitier_pi": round(faitier_pi, 1),
    }


@router.post("/roofing/gutters")
async def calc_roofing_gutters(body: RoofingGuttersInput, user: ErpUser = Depends(get_current_user)):
    """Gouttieres et descentes (capacite CCQ 9.14.6)."""
    surface_pi2 = body.surface_toit_m2 * 10.7639
    capacite = GOUTTIERES_CAPACITE.get(body.type_gouttiere, 1000)
    nb_descentes = max(2, math.ceil(surface_pi2 / capacite))
    longueur_gouttieres = body.perimetre_m

    # Supports every 60 cm
    nb_supports = math.ceil(longueur_gouttieres / 0.6)
    # Angles (assume rectangular)
    nb_angles = 4
    # Embouts
    nb_embouts = nb_descentes * 2

    return {
        "surface_toit_m2": body.surface_toit_m2,
        "surface_toit_pi2": round(surface_pi2, 1),
        "type_gouttiere": body.type_gouttiere,
        "capacite_par_descente_pi2": capacite,
        "nb_descentes": nb_descentes,
        "longueur_gouttieres_m": round(longueur_gouttieres, 2),
        "longueur_gouttieres_pi": round(longueur_gouttieres * 3.2808, 1),
        "nb_supports": nb_supports,
        "nb_angles": nb_angles,
        "nb_embouts": nb_embouts,
    }


@router.post("/roofing/snow-load")
async def calc_roofing_snow_load(body: RoofingSnowLoadInput, user: ErpUser = Depends(get_current_user)):
    """Charge de neige + charge morte combinee (CNBC 4.1.6)."""
    province_data = CHARGES_NEIGE.get(body.province, {})
    charge_neige = province_data.get(body.ville, 2.5)  # kPa default

    # Charge morte toiture
    dead_load = CHARGES_MORTES_TOITURE.get(body.type_couverture or "bardeau_asphalte", 2.5)
    # Add structure + plafond
    dead_total_lb_pi2 = dead_load + 5.0 + 2.0  # structure + plafond

    # Convert snow load kPa to lb/ft2 (1 kPa = 20.885 lb/ft2)
    neige_lb_pi2 = charge_neige * 20.885

    charge_design_kpa = charge_neige + (dead_total_lb_pi2 / 20.885)
    charge_design_lb_pi2 = charge_design_kpa * 20.885

    return {
        "province": body.province,
        "ville": body.ville,
        "type_couverture": body.type_couverture,
        "charge_neige_kpa": charge_neige,
        "charge_neige_lb_pi2": round(neige_lb_pi2, 2),
        "charge_morte_lb_pi2": round(dead_total_lb_pi2, 2),
        "charge_design_kpa": round(charge_design_kpa, 2),
        "charge_design_lb_pi2": round(charge_design_lb_pi2, 2),
        "norme": "CNBC 4.1.6",
    }


# ============================================
# PAINTING ENDPOINTS
# ============================================

@router.post("/painting")
async def calc_painting(body: PaintingInput, user: ErpUser = Depends(get_current_user)):
    """Peinture - surface, quantites, couts (TPS/TVQ)."""
    perimetre = 2 * (body.longueur_m + body.largeur_m)
    surface_murs = perimetre * body.hauteur_m
    surface_plafond = body.longueur_m * body.largeur_m
    deduction_portes = body.nb_portes * 2.0  # standard 2 m2
    deduction_fenetres = body.nb_fenetres * 1.5  # standard 1.5 m2
    surface_nette = max(0, surface_murs - deduction_portes - deduction_fenetres)
    surface_totale = surface_nette + surface_plafond

    type_peinture = TYPES_PEINTURE.get(body.type_peinture or "latex_interieur", TYPES_PEINTURE["latex_interieur"])
    facteur_abs = FACTEURS_ABSORPTION.get(body.surface_type, 1.0)
    efficacite = EFFICACITE_TRANSFERT.get(body.methode, 0.90)

    couverture_effective = type_peinture["couverture_m2_l"] / facteur_abs * efficacite
    litres_couche = surface_totale / couverture_effective
    litres_total = litres_couche * body.nb_couches * 1.10  # 10% waste

    gallons = litres_total / 3.785
    cout_peinture = litres_total * type_peinture["prix_l"]
    tps = cout_peinture * TPS_RATE
    tvq = cout_peinture * TVQ_RATE
    total_ttc = cout_peinture + tps + tvq
    cout_par_m2 = total_ttc / surface_totale if surface_totale > 0 else 0

    return {
        "type_peinture": type_peinture["label"],
        "solides_pct": type_peinture["solides_pct"],
        "dft_um_theorique": type_peinture["dft_um"],
        "surface_murs_m2": round(surface_murs, 2),
        "surface_plafond_m2": round(surface_plafond, 2),
        "deductions_m2": round(deduction_portes + deduction_fenetres, 2),
        "surface_nette_m2": round(surface_nette, 2),
        "surface_totale_m2": round(surface_totale, 2),
        "facteur_absorption": facteur_abs,
        "efficacite_transfert": efficacite,
        "couverture_effective_m2_l": round(couverture_effective, 2),
        "litres_par_couche": round(litres_couche, 2),
        "litres_total": round(litres_total, 2),
        "gallons_total": round(gallons, 2),
        "nb_couches": body.nb_couches,
        "cout_peinture_ht": round(cout_peinture, 2),
        "tps": round(tps, 2),
        "tvq": round(tvq, 2),
        "cout_total_ttc": round(total_ttc, 2),
        "cout_par_m2_ttc": round(cout_par_m2, 2),
        "temps_sec_h": type_peinture["sec_h"],
        "temps_recouvrement_h": type_peinture["recouvrement_h"],
        "temps_complet_h": type_peinture["complet_h"],
    }


@router.post("/painting/dft")
async def calc_painting_dft(body: PaintingDFTInput, user: ErpUser = Depends(get_current_user)):
    """Epaisseur film sec (DFT) micron."""
    # DFT (um) = (Volume_mL * Solids%) / (Surface_m2 * 1000)
    dft_um = (body.volume_ml * body.solides_pct / 100) / (body.surface_m2) / 1000 * 1000
    # Theoretical coverage
    couverture_theorique = (body.solides_pct / 100 * 10000) / dft_um if dft_um > 0 else 0

    # Evaluation
    if dft_um < 25:
        evaluation = "Trop mince - risque de fissuration, non protection"
    elif dft_um <= 40:
        evaluation = "Interieur residentiel OK"
    elif dft_um <= 60:
        evaluation = "Exterieur OK"
    elif dft_um <= 150:
        evaluation = "Industriel OK"
    else:
        evaluation = "Trop epais - risque de coulures"

    return {
        "volume_ml": body.volume_ml,
        "solides_pct": body.solides_pct,
        "surface_m2": body.surface_m2,
        "dft_um": round(dft_um, 1),
        "dft_mils": round(dft_um / 25.4, 2),
        "couverture_theorique_m2_l": round(couverture_theorique, 2),
        "evaluation": evaluation,
    }


@router.post("/painting/dew-point")
async def calc_painting_dew_point(body: PaintingDewPointInput, user: ErpUser = Depends(get_current_user)):
    """Point de rosee (formule Magnus) pour application peinture."""
    T = body.temperature_air_c
    RH = max(body.humidite_relative_pct, 0.1)  # Safety against log(0)
    # alpha = ln(RH/100) + (17.27 * T) / (237.7 + T)
    alpha = math.log(RH / 100) + (17.27 * T) / (237.7 + T)
    denom = 17.27 - alpha
    if abs(denom) < 1e-6:
        raise HTTPException(status_code=400, detail="Conditions thermodynamiques extremes - point de rosee indefini")
    dew_point = (237.7 * alpha) / denom

    # Condition: surface > dew_point + 3 C
    marge = body.temperature_surface_c - dew_point
    application_ok = marge >= 3

    return {
        "temperature_air_c": T,
        "humidite_relative_pct": RH,
        "temperature_surface_c": body.temperature_surface_c,
        "point_rosee_c": round(dew_point, 2),
        "marge_securite_c": round(marge, 2),
        "application_securitaire": application_ok,
        "recommandation": (
            f"OK - Marge de {marge:.1f} C >= 3 C requise"
            if application_ok
            else f"DANGER - Augmenter la temperature surface de {3 - marge:.1f} C"
        ),
    }


# ============================================
# PLUMBING ENDPOINTS
# ============================================

@router.post("/plumbing")
async def calc_plumbing(body: PlumbingInput, user: ErpUser = Depends(get_current_user)):
    """DFU + WSFU + diametre drain (CNP)."""
    appareils = {
        "toilette": body.nb_toilettes,
        "lavabo": body.nb_lavabos,
        "douche": body.nb_douches,
        "baignoire": body.nb_baignoires,
        "evier_cuisine": body.nb_evier_cuisine,
        "evier_bar": body.nb_evier_bar,
        "lave_vaisselle": body.nb_lave_vaisselle,
        "machine_laver": body.nb_machines_laver,
        "drain_plancher": body.nb_drain_plancher,
        "urinoir": body.nb_urinoir,
    }

    total_dfu = 0
    total_wsfu = 0
    nb_appareils = 0
    detail = []
    for key, count in appareils.items():
        if count > 0:
            info = DFU_APPAREILS[key]
            dfu = count * info["dfu"]
            wsfu = count * info["wsfu"]
            total_dfu += dfu
            total_wsfu += wsfu
            nb_appareils += count
            detail.append({
                "type": info["label"],
                "nombre": count,
                "dfu_unitaire": info["dfu"],
                "dfu_total": dfu,
                "wsfu_unitaire": info["wsfu"],
                "wsfu_total": wsfu,
            })

    drain = _find_drain_diameter(total_dfu)

    # WSFU -> GPM conversion
    if total_wsfu <= 10:
        gpm = total_wsfu
    else:
        gpm = 5.3 * math.sqrt(total_wsfu)

    return {
        "total_dfu": total_dfu,
        "total_wsfu": round(total_wsfu, 1),
        "debit_gpm": round(gpm, 1),
        "debit_lpm": round(gpm * 3.785, 1),
        "diametre_drain": drain,
        "nb_appareils": nb_appareils,
        "detail_appareils": detail,
        "code": "CNP - Code National de Plomberie",
    }


@router.post("/plumbing/hazen-williams")
async def calc_plumbing_hazen_williams(body: PlumbingHazenWilliamsInput, user: ErpUser = Depends(get_current_user)):
    """Perte de charge Hazen-Williams."""
    c = HAZEN_WILLIAMS_C[body.materiau]
    Q = body.debit_gpm
    L = body.longueur_pi
    d = body.diametre_pouce

    # hf = 4.52 * Q^1.852 * L / (C^1.852 * d^4.87)
    hf_pi = (4.52 * (Q ** 1.852) * L) / ((c ** 1.852) * (d ** 4.87))
    hf_psi = hf_pi / 2.31

    # Velocity: V = Q / (2.448 * d2)
    velocity_fps = Q / (2.448 * d ** 2)

    # Evaluation
    if velocity_fps < 4:
        eval_velocity = "Faible - OK"
    elif velocity_fps <= 6:
        eval_velocity = "Optimal"
    elif velocity_fps <= 8:
        eval_velocity = "Limite acceptable"
    else:
        eval_velocity = "Trop eleve - risque de bruit/coup de belier"

    return {
        "debit_gpm": Q,
        "longueur_pi": L,
        "diametre_pouce": d,
        "materiau": body.materiau,
        "coefficient_c": c,
        "perte_charge_pi": round(hf_pi, 2),
        "perte_charge_psi": round(hf_psi, 2),
        "vitesse_pi_s": round(velocity_fps, 2),
        "evaluation_vitesse": eval_velocity,
    }


@router.post("/plumbing/water-heater")
async def calc_plumbing_water_heater(body: PlumbingWaterHeaterInput, user: ErpUser = Depends(get_current_user)):
    """Dimensionnement chauffe-eau (capacite gallons)."""
    key = f"{body.nb_chambres}-{body.nb_salles_bain}"
    capacite = CHAUFFE_EAU_CAPACITE.get(key)
    if capacite is None:
        # Fallback: 20 + 10 per bedroom + 10 per bathroom
        capacite = 20 + 10 * body.nb_chambres + 10 * body.nb_salles_bain

    # FHR = 70% of tank capacity (typical)
    fhr_min = capacite * 0.70

    # Check against expected peak (45 gal per person morning)
    expected_peak = body.nb_personnes * 12  # 12 gal pointe matin
    adequat = fhr_min >= expected_peak

    return {
        "nb_chambres": body.nb_chambres,
        "nb_salles_bain": body.nb_salles_bain,
        "nb_personnes": body.nb_personnes,
        "capacite_gallons": capacite,
        "capacite_litres": round(capacite * 3.785, 1),
        "first_hour_rating_min": round(fhr_min, 1),
        "consommation_pointe_estimee": expected_peak,
        "adequat": adequat,
        "type_recommande": (
            "Reservoir electrique" if capacite <= 60 else
            "Reservoir gaz haute recuperation"
        ),
    }


@router.post("/plumbing/drain-slope")
async def calc_plumbing_drain_slope(body: PlumbingDrainSlopeInput, user: ErpUser = Depends(get_current_user)):
    """Pente drain - distance max et chute."""
    # Standard: 1/4 po/pi pour d <= 3 po, 1/8 po/pi pour > 3 po
    if body.diametre_pouce <= 3:
        pente_recommandee_pct = 2.08
    else:
        pente_recommandee_pct = 1.04

    chute_m = body.longueur_m * (body.pente_pct / 100)
    chute_po = chute_m * 39.37

    conforme = body.pente_pct >= (1.0 if body.diametre_pouce > 3 else 2.0)

    return {
        "diametre_pouce": body.diametre_pouce,
        "longueur_m": body.longueur_m,
        "pente_pct_appliquee": body.pente_pct,
        "pente_recommandee_pct": pente_recommandee_pct,
        "chute_m": round(chute_m, 3),
        "chute_po": round(chute_po, 2),
        "conforme_cnp": conforme,
        "recommandation": (
            "Conforme CNP" if conforme else
            f"Augmenter pente a {pente_recommandee_pct}% minimum"
        ),
    }


# ============================================
# HVAC ENDPOINTS
# ============================================

@router.post("/hvac")
async def calc_hvac(body: HvacInput, user: ErpUser = Depends(get_current_user)):
    """Charge thermique - pertes chaleur + BTU + tonnage."""
    isolation_data = HVAC_FACTORS[body.isolation]
    zone_data = ZONES_CLIMATIQUES[body.zone_climatique]

    watts_m2 = isolation_data["watts_m2"]
    pertes_base = body.surface_m2 * watts_m2
    pertes_ajustees = pertes_base * zone_data["facteur"]
    # Add 10% safety factor
    pertes_design = pertes_ajustees * 1.10

    btu_h = pertes_design * 3.412
    tonnage = btu_h / 12000
    volume = body.surface_m2 * body.hauteur_plafond_m
    cfm_air_changes = (volume * 35.315 / 60) * 8  # 8 ACH

    btu_per_sqft = btu_h / (body.surface_m2 * 10.7639)

    # Equipment size recommendation (standard sizes)
    equip_sizes_btu = [40000, 60000, 80000, 100000, 120000, 140000, 160000, 180000, 200000]
    equip_recommande = next((s for s in equip_sizes_btu if s >= btu_h), 200000)

    return {
        "surface_m2": body.surface_m2,
        "hauteur_plafond_m": body.hauteur_plafond_m,
        "isolation": isolation_data["label"],
        "zone_climatique": zone_data["label"],
        "t_hiver_c": zone_data["t_hiver_c"],
        "t_ete_c": zone_data["t_ete_c"],
        "hdd": zone_data["hdd"],
        "pertes_base_w": round(pertes_base, 0),
        "facteur_zone": zone_data["facteur"],
        "pertes_ajustees_w": round(pertes_ajustees, 0),
        "pertes_design_w": round(pertes_design, 0),
        "btu_h": round(btu_h, 0),
        "btu_par_pi2": round(btu_per_sqft, 1),
        "tonnage_clim": round(tonnage, 2),
        "volume_m3": round(volume, 1),
        "cfm_ventilation": round(cfm_air_changes, 0),
        "equipement_recommande_btu": equip_recommande,
        "facteur_securite_pct": 10,
    }


@router.post("/hvac/duct")
async def calc_hvac_duct(body: HvacDuctInput, user: ErpUser = Depends(get_current_user)):
    """Dimensionnement conduit rond (vitesse recommandee)."""
    vitesses = VITESSES_CONDUIT[body.type_circuit]
    vitesse_fpm = (vitesses["min"] + vitesses["max"]) / 2

    # d = sqrt(4 * CFM / (pi * V))
    diametre_pi = math.sqrt(4 * body.cfm / (math.pi * vitesse_fpm))
    diametre_po = diametre_pi * 12
    # Round to nearest standard size (4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20)
    standard = [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 24, 30]
    diametre_standard = next((s for s in standard if s >= diametre_po), 30)

    # Actual velocity with chosen size
    aire_pi2 = math.pi * (diametre_standard / 24) ** 2
    vitesse_reelle = body.cfm / aire_pi2

    return {
        "cfm": body.cfm,
        "type_circuit": body.type_circuit,
        "vitesse_recommandee_fpm": f"{vitesses['min']}-{vitesses['max']}",
        "diametre_calcule_po": round(diametre_po, 2),
        "diametre_standard_po": diametre_standard,
        "aire_section_pi2": round(aire_pi2, 3),
        "vitesse_reelle_fpm": round(vitesse_reelle, 0),
        "conforme": vitesses["min"] <= vitesse_reelle <= vitesses["max"],
    }


@router.post("/hvac/cfm")
async def calc_hvac_cfm(body: HvacCfmInput, user: ErpUser = Depends(get_current_user)):
    """CFM requis par ACH (changes d'air par heure)."""
    ach = ACH_RECOMMANDE.get(body.type_piece, 4)
    volume_pi3 = body.volume_m3 * 35.315
    cfm = (volume_pi3 * ach) / 60

    return {
        "volume_m3": body.volume_m3,
        "volume_pi3": round(volume_pi3, 1),
        "type_piece": body.type_piece,
        "ach": ach,
        "cfm_requis": round(cfm, 0),
    }


@router.post("/hvac/hrv")
async def calc_hvac_hrv(body: HvacHrvInput, user: ErpUser = Depends(get_current_user)):
    """Dimensionnement HRV/ERV (ASHRAE 62.2)."""
    # CFM = 0.03 * Surface_pi2 + 7.5 * (Chambres + 1)
    surface_pi2 = body.surface_m2 * 10.7639
    cfm_surface = 0.03 * surface_pi2
    cfm_chambres = 7.5 * (body.nb_chambres + 1)
    cfm_min_62_2 = cfm_surface + cfm_chambres

    # Alternative: occupants
    cfm_occupants = body.nb_occupants * 20

    cfm_recommande = max(cfm_min_62_2, cfm_occupants)

    # Standard HRV sizes (50, 75, 100, 125, 150, 200, 250, 300, 400)
    standard = [50, 75, 100, 125, 150, 200, 250, 300, 400]
    taille_recommandee = next((s for s in standard if s >= cfm_recommande), 400)

    return {
        "surface_m2": body.surface_m2,
        "surface_pi2": round(surface_pi2, 1),
        "nb_chambres": body.nb_chambres,
        "nb_occupants": body.nb_occupants,
        "cfm_base_surface": round(cfm_surface, 1),
        "cfm_chambres": round(cfm_chambres, 1),
        "cfm_min_62_2": round(cfm_min_62_2, 1),
        "cfm_occupants": cfm_occupants,
        "cfm_recommande": round(cfm_recommande, 1),
        "taille_hrv_recommandee_cfm": taille_recommandee,
        "norme": "ASHRAE 62.2",
    }


@router.post("/hvac/cooling")
async def calc_hvac_cooling(body: HvacCoolingInput, user: ErpUser = Depends(get_current_user)):
    """Charge de climatisation (gains solaires + occupants + equipements)."""
    orientation_factor = SHGC_ORIENTATION[body.orientation]

    # Gain solaire
    gain_solaire = body.surface_vitree_m2 * body.shgc * body.rayonnement_w_m2 * orientation_factor

    # Gain occupants (400 BTU/h = 117 W per person)
    gain_occupants = body.nb_occupants * 117

    # Gain equipements
    gain_equip = body.equipements_w

    gain_total_w = gain_solaire + gain_occupants + gain_equip
    gain_total_btu = gain_total_w * 3.412
    tonnage = gain_total_btu / 12000

    return {
        "surface_vitree_m2": body.surface_vitree_m2,
        "orientation": body.orientation,
        "facteur_orientation": orientation_factor,
        "shgc": body.shgc,
        "rayonnement_w_m2": body.rayonnement_w_m2,
        "gain_solaire_w": round(gain_solaire, 0),
        "gain_occupants_w": round(gain_occupants, 0),
        "gain_equipements_w": round(gain_equip, 0),
        "gain_total_w": round(gain_total_w, 0),
        "gain_total_btu_h": round(gain_total_btu, 0),
        "tonnage_clim_requis": round(tonnage, 2),
    }


# ============================================
# WELDING ENDPOINTS
# ============================================

@router.post("/welding")
async def calc_welding(body: WeldingInput, user: ErpUser = Depends(get_current_user)):
    """Parametres soudure d'angle + consommation."""
    # Gorge (throat) = 0.707 * leg for fillet
    gorge = body.epaisseur_mm * 0.707
    jambe = body.epaisseur_mm

    # Volume soudure (triangle cross-section)
    volume_mm3 = (gorge * jambe / 2) * body.longueur_soudure_mm
    volume_cm3 = volume_mm3 / 1000

    # Mass (steel density 7.85 g/cm3)
    poids_metal = volume_cm3 * 7.85

    # Consumption including waste
    waste_factor = ELECTRODE_WASTE.get(body.procede, 1.2)
    consommation_g = poids_metal * waste_factor

    # Deposition rate
    depot = TAUX_DEPOT.get(body.procede, {})

    return {
        "type_joint": body.type_joint,
        "procede": body.procede,
        "epaisseur_mm": body.epaisseur_mm,
        "longueur_soudure_mm": body.longueur_soudure_mm,
        "gorge_mm": round(gorge, 2),
        "jambe_mm": round(jambe, 2),
        "volume_soudure_mm3": round(volume_mm3, 1),
        "volume_soudure_cm3": round(volume_cm3, 3),
        "poids_metal_depose_g": round(poids_metal, 2),
        "consommation_electrode_g": round(consommation_g, 2),
        "facteur_waste": waste_factor,
        "taux_depot_kg_h": depot,
    }


@router.post("/welding/heat-input")
async def calc_welding_heat_input(body: WeldingHeatInputInput, user: ErpUser = Depends(get_current_user)):
    """Heat input (J/mm et kJ/mm)."""
    # HI = (V * A * 60) / (vitesse_mm_min * 1000)  in kJ/mm
    hi_kj_mm = (body.tension_v * body.amperage_a * 60) / (body.vitesse_mm_min * 1000)
    hi_j_mm = hi_kj_mm * 1000

    # Evaluation
    if hi_kj_mm < 1.0:
        evaluation_ac = "Trop faible pour acier carbone"
        evaluation_inox = "OK pour inox/alu"
    elif hi_kj_mm <= 1.5:
        evaluation_ac = "Faible pour acier carbone"
        evaluation_inox = "Optimal inox/alu"
    elif hi_kj_mm <= 3.0:
        evaluation_ac = "Optimal acier carbone"
        evaluation_inox = "Eleve pour inox"
    else:
        evaluation_ac = "Trop eleve - risque de grossissement grains"
        evaluation_inox = "Trop eleve"

    return {
        "tension_v": body.tension_v,
        "amperage_a": body.amperage_a,
        "vitesse_mm_min": body.vitesse_mm_min,
        "heat_input_kj_mm": round(hi_kj_mm, 3),
        "heat_input_j_mm": round(hi_j_mm, 1),
        "evaluation_acier_carbone": evaluation_ac,
        "evaluation_inox_aluminium": evaluation_inox,
    }


@router.post("/welding/preheat")
async def calc_welding_preheat(body: WeldingPreheatInput, user: ErpUser = Depends(get_current_user)):
    """Carbone equivalent (IIW) + temperature prechauffage."""
    # CE = C + Mn/6 + (Cr+Mo+V)/5 + (Ni+Cu)/15
    ce = (body.carbone_pct
          + body.manganese_pct / 6
          + (body.chrome_pct + body.molybdene_pct + body.vanadium_pct) / 5
          + (body.nickel_pct + body.cuivre_pct) / 15)

    # Preheat recommendation
    if ce < 0.40:
        preheat = 50 if body.epaisseur_mm > 25 else 0
        risque = "Faible"
    elif ce < 0.50:
        preheat = 100 if body.epaisseur_mm > 25 else 75
        risque = "Modere"
    elif ce < 0.60:
        preheat = 150 if body.epaisseur_mm > 25 else 100
        risque = "Eleve"
    else:
        preheat = 200 if body.epaisseur_mm > 25 else 150
        risque = "Tres eleve"

    return {
        "carbone_equivalent": round(ce, 4),
        "niveau_risque_fissuration": risque,
        "epaisseur_mm": body.epaisseur_mm,
        "temperature_prechauffage_c": preheat,
        "formule": "CE = C + Mn/6 + (Cr+Mo+V)/5 + (Ni+Cu)/15",
        "composition": {
            "c": body.carbone_pct,
            "mn": body.manganese_pct,
            "cr": body.chrome_pct,
            "mo": body.molybdene_pct,
            "v": body.vanadium_pct,
            "ni": body.nickel_pct,
            "cu": body.cuivre_pct,
        },
    }


@router.post("/welding/consumable")
async def calc_welding_consumable(body: WeldingConsumableInput, user: ErpUser = Depends(get_current_user)):
    """Consommation reelle d'electrode/fil selon procede."""
    waste = ELECTRODE_WASTE.get(body.procede, 1.2)
    consommation = body.poids_metal_depose_g * waste

    # Electrode count (3/32 = 0.027 kg each typical E7018)
    nb_electrodes = math.ceil(consommation / 27)  # 27g per electrode average
    # Wire spools (MIG 15 kg typical)
    nb_bobines = math.ceil(consommation / 15000)

    return {
        "procede": body.procede,
        "poids_metal_depose_g": body.poids_metal_depose_g,
        "facteur_waste": waste,
        "consommation_totale_g": round(consommation, 2),
        "consommation_totale_kg": round(consommation / 1000, 3),
        "nb_electrodes_3_32": nb_electrodes,
        "nb_bobines_15kg": nb_bobines,
    }


# ============================================
# BENDING ENDPOINTS
# ============================================

@router.post("/bending")
async def calc_bending(body: BendingInput, user: ErpUser = Depends(get_current_user)):
    """Developpement + tonnage + rayon (Air Bending)."""
    mat = MATERIAUX_PLIAGE[body.materiau]
    t = body.epaisseur_mm
    r = body.rayon_interieur_mm if body.rayon_interieur_mm is not None else t
    angle_rad = math.radians(body.angle_pliage_deg)

    # K-factor based on R/T ratio or material default
    r_over_t = r / t if t > 0 else 1
    k_table = _interpolate_k_factor(r_over_t)
    k_mat = mat["k_factor"]
    k_factor = (k_table + k_mat) / 2  # average both

    # Bend allowance
    ba = angle_rad * (r + k_factor * t)
    # Outside setback
    ossb = 2 * (r + t) * math.tan(angle_rad / 2)
    # Bend deduction
    bd = ossb - ba

    # Flat pattern length
    longueur_dev = body.longueur_piece_mm - bd

    # V-die opening
    v_die = _v_die_opening(t)

    # Tonnage: P = (1.42 * UTS * t^2 * L) / (V * 1000)
    uts = mat["resistance_mpa"]
    tonnage_brut = (1.42 * uts * t ** 2 * body.largeur_piece_mm) / (1000 * v_die)
    tonnage = tonnage_brut * mat["tonnage_facteur"]

    # Min radius
    rmin = mat["rmin_facteur"] * t

    # Fissure check
    fissure_risque = r < rmin

    return {
        "materiau": mat["label"],
        "epaisseur_mm": t,
        "angle_pliage_deg": body.angle_pliage_deg,
        "rayon_interieur_mm": r,
        "largeur_piece_mm": body.largeur_piece_mm,
        "r_over_t": round(r_over_t, 3),
        "k_factor": round(k_factor, 3),
        "bend_allowance_mm": round(ba, 2),
        "outside_setback_mm": round(ossb, 2),
        "bend_deduction_mm": round(bd, 2),
        "longueur_developpee_mm": round(longueur_dev, 2),
        "ouverture_v_mm": round(v_die, 1),
        "tonnage_requis_kn": round(tonnage, 1),
        "tonnage_par_metre_kn_m": round(tonnage / (body.largeur_piece_mm / 1000), 1),
        "rayon_minimum_mm": round(rmin, 2),
        "risque_fissure": fissure_risque,
        "springback_90_deg": mat["springback_90"],
        "uts_mpa": uts,
    }


@router.post("/bending/springback")
async def calc_bending_springback(body: BendingSpringbackInput, user: ErpUser = Depends(get_current_user)):
    """Angle reel a plier pour compenser springback."""
    mat = MATERIAUX_PLIAGE[body.materiau]
    springback_90 = mat["springback_90"]
    # Scale springback proportional to angle (approximate)
    springback = springback_90 * (body.angle_voulu_deg / 90)
    angle_a_plier = body.angle_voulu_deg + springback

    return {
        "materiau": mat["label"],
        "angle_voulu_deg": body.angle_voulu_deg,
        "springback_90_deg": springback_90,
        "springback_calcule_deg": round(springback, 2),
        "angle_a_plier_deg": round(angle_a_plier, 2),
    }


@router.post("/bending/min-radius")
async def calc_bending_min_radius(body: BendingMinRadiusInput, user: ErpUser = Depends(get_current_user)):
    """Rayon minimum sans fissure."""
    mat = MATERIAUX_PLIAGE[body.materiau]
    rmin = mat["rmin_facteur"] * body.epaisseur_mm
    return {
        "materiau": mat["label"],
        "epaisseur_mm": body.epaisseur_mm,
        "facteur_rmin": mat["rmin_facteur"],
        "rayon_minimum_mm": round(rmin, 2),
        "rayon_minimum_po": round(rmin / 25.4, 3),
    }


# ============================================
# METAL WEIGHT ENDPOINTS
# ============================================

def _compute_metal_volume(forme: str, dims: Dict[str, float]) -> float:
    """Return volume in m3. Dimensions in mm."""
    try:
        if forme == "plaque":
            longueur = dims["longueur"] / 1000
            largeur = dims["largeur"] / 1000
            epaisseur = dims["epaisseur"] / 1000
            if longueur <= 0 or largeur <= 0 or epaisseur <= 0:
                raise HTTPException(status_code=400, detail="Dimensions plaque doivent etre positives")
            return longueur * largeur * epaisseur
        elif forme == "tube_rond":
            r_ext = dims["rayon_ext"] / 1000
            r_int = dims["rayon_int"] / 1000
            longueur = dims["longueur"] / 1000
            if r_ext <= 0 or longueur <= 0:
                raise HTTPException(status_code=400, detail="Dimensions tube_rond doivent etre positives")
            if r_int >= r_ext:
                raise HTTPException(status_code=400, detail="Rayon interieur doit etre inferieur au rayon exterieur")
            return math.pi * (r_ext ** 2 - r_int ** 2) * longueur
        elif forme == "tube_carre":
            cote_ext = dims["cote_ext"] / 1000
            ep = dims["epaisseur"] / 1000
            longueur = dims["longueur"] / 1000
            if ep <= 0 or cote_ext <= 0 or longueur <= 0:
                raise HTTPException(status_code=400, detail="Dimensions tube_carre doivent etre positives")
            if 2 * ep >= cote_ext:
                raise HTTPException(status_code=400, detail="Epaisseur trop grande pour le cote exterieur du tube carre")
            cote_int = cote_ext - 2 * ep
            return (cote_ext ** 2 - cote_int ** 2) * longueur
        elif forme == "barre_ronde":
            rayon = dims["rayon"] / 1000
            longueur = dims["longueur"] / 1000
            if rayon <= 0 or longueur <= 0:
                raise HTTPException(status_code=400, detail="Dimensions barre_ronde doivent etre positives")
            return math.pi * rayon ** 2 * longueur
        elif forme == "barre_carree":
            cote = dims["cote"] / 1000
            longueur = dims["longueur"] / 1000
            if cote <= 0 or longueur <= 0:
                raise HTTPException(status_code=400, detail="Dimensions barre_carree doivent etre positives")
            return cote ** 2 * longueur
        elif forme == "angle":
            a = dims["aile_a"] / 1000
            b = dims["aile_b"] / 1000
            ep = dims["epaisseur"] / 1000
            longueur = dims["longueur"] / 1000
            if a <= 0 or b <= 0 or ep <= 0 or longueur <= 0:
                raise HTTPException(status_code=400, detail="Dimensions angle doivent etre positives")
            if ep >= min(a, b):
                raise HTTPException(status_code=400, detail="Epaisseur trop grande pour les ailes de la corniere")
            area = a * ep + (b - ep) * ep
            return area * longueur
        elif forme == "poutre_i":
            h = dims["hauteur"] / 1000
            bf = dims["largeur_aile"] / 1000
            tw = dims["epaisseur_ame"] / 1000
            tf = dims["epaisseur_aile"] / 1000
            longueur = dims["longueur"] / 1000
            if h <= 0 or bf <= 0 or tw <= 0 or tf <= 0 or longueur <= 0:
                raise HTTPException(status_code=400, detail="Dimensions poutre_i doivent etre positives")
            if 2 * tf >= h:
                raise HTTPException(status_code=400, detail="Epaisseur aile trop grande pour la hauteur de la poutre")
            area = 2 * bf * tf + (h - 2 * tf) * tw
            return area * longueur
    except KeyError as exc:
        logger.warning("metal_weight dimension missing: %s", exc)
        raise HTTPException(status_code=400, detail="Dimension requise manquante pour cette forme")
    return 0.0


@router.post("/metal-weight")
async def calc_metal_weight(body: MetalWeightInput, user: ErpUser = Depends(get_current_user)):
    """Poids metal - tous profiles + 20 materiaux."""
    # W or C profile lookup
    if body.forme == "profil_w":
        section_raw = body.dimensions.get("section_key")
        if not isinstance(section_raw, str) or section_raw not in PROFILES_W:
            raise HTTPException(status_code=400, detail="Section W invalide")
        profile = PROFILES_W[section_raw]
        try:
            longueur_m = float(body.dimensions.get("longueur", 1000)) / 1000
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Longueur invalide")
        if longueur_m <= 0:
            raise HTTPException(status_code=400, detail="Longueur doit etre positive")
        masse_totale = profile["masse_kg_m"] * longueur_m
        return {
            "forme": "profil_w",
            "section": section_raw,
            "profil": profile,
            "longueur_m": longueur_m,
            "masse_totale_kg": round(masse_totale, 3),
            "masse_totale_lb": round(masse_totale * 2.20462, 2),
            "masse_par_metre_kg_m": profile["masse_kg_m"],
        }
    if body.forme == "profil_c":
        section_raw = body.dimensions.get("section_key")
        if not isinstance(section_raw, str) or section_raw not in PROFILES_C:
            raise HTTPException(status_code=400, detail="Section C invalide")
        profile = PROFILES_C[section_raw]
        try:
            longueur_m = float(body.dimensions.get("longueur", 1000)) / 1000
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Longueur invalide")
        if longueur_m <= 0:
            raise HTTPException(status_code=400, detail="Longueur doit etre positive")
        masse_totale = profile["masse_kg_m"] * longueur_m
        return {
            "forme": "profil_c",
            "section": section_raw,
            "profil": profile,
            "longueur_m": longueur_m,
            "masse_totale_kg": round(masse_totale, 3),
            "masse_totale_lb": round(masse_totale * 2.20462, 2),
            "masse_par_metre_kg_m": profile["masse_kg_m"],
        }

    # Regular shape - convert all values to float (Pydantic allows str for section_key)
    numeric_dims: Dict[str, float] = {}
    try:
        for k, v in body.dimensions.items():
            numeric_dims[k] = float(v)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Dimensions doivent etre numeriques pour cette forme")
    volume = _compute_metal_volume(body.forme, numeric_dims)

    # Material lookup (support legacy short keys)
    if body.materiau in METAUX:
        mat = METAUX[body.materiau]
        densite = mat["densite"]
        label = mat["label"]
        prix = mat["prix_cad_kg"]
    elif body.materiau in METAL_DENSITIES_LEGACY:
        densite = METAL_DENSITIES_LEGACY[body.materiau]
        label = body.materiau.capitalize()
        prix = 1.50  # legacy fallback
    else:
        logger.warning("calc_metal_weight unknown materiau: %s", body.materiau)
        raise HTTPException(status_code=400, detail="Materiau non reconnu. Consultez /calculators/constants pour la liste valide")

    poids_kg = volume * densite
    poids_lb = poids_kg * 2.20462
    cout = poids_kg * prix

    return {
        "forme": body.forme,
        "materiau": body.materiau,
        "materiau_label": label,
        "densite_kg_m3": densite,
        "prix_cad_kg": prix,
        "volume_m3": round(volume, 6),
        "volume_cm3": round(volume * 1e6, 2),
        "poids_kg": round(poids_kg, 3),
        "poids_lb": round(poids_lb, 3),
        "cout_estime_cad": round(cout, 2),
    }


# ============================================
# TAXES QUEBEC
# ============================================

@router.post("/taxes")
async def calc_taxes(body: TaxesInput, user: ErpUser = Depends(get_current_user)):
    """TPS + TVQ Quebec."""
    tps = body.montant_ht * TPS_RATE
    tvq = body.montant_ht * TVQ_RATE
    total_ttc = body.montant_ht + tps + tvq
    return {
        "montant_ht": round(body.montant_ht, 2),
        "tps": round(tps, 2),
        "tvq": round(tvq, 2),
        "total_ttc": round(total_ttc, 2),
        "taux_tps": TPS_RATE * 100,
        "taux_tvq": TVQ_RATE * 100,
    }


# ============================================
# PAYROLL CHARGES
# ============================================

@router.post("/charge-tributaire")
async def calc_charge_tributaire(body: ChargeTributaireInput, user: ErpUser = Depends(get_current_user)):
    """Deductions employe + charges employeur (Quebec 2024)."""
    sb = body.salaire_brut

    # Employee deductions
    rrq_emp = sb * TAUX_DEDUCTIONS_EMPLOYE["rrq"]
    rqap_emp = sb * TAUX_DEDUCTIONS_EMPLOYE["rqap"]
    ae_emp = sb * TAUX_DEDUCTIONS_EMPLOYE["ae"]
    impot_federal = sb * TAUX_DEDUCTIONS_EMPLOYE["impot_federal"]
    impot_provincial = sb * TAUX_DEDUCTIONS_EMPLOYE["impot_provincial"]
    total_deductions = rrq_emp + rqap_emp + ae_emp + impot_federal + impot_provincial

    # Employer charges
    rrq_er = sb * TAUX_CHARGES_EMPLOYEUR["rrq"]
    rqap_er = sb * TAUX_CHARGES_EMPLOYEUR["rqap"]
    ae_er = sb * TAUX_CHARGES_EMPLOYEUR["ae"]
    cnesst = sb * TAUX_CHARGES_EMPLOYEUR["cnesst"]
    fss = sb * TAUX_CHARGES_EMPLOYEUR["fss"]
    ccq = 0.0
    if body.type_employe == "construction_ccq":
        ccq = sb * TAUX_CHARGES_EMPLOYEUR["ccq"]
    total_charges = rrq_er + rqap_er + ae_er + cnesst + fss + ccq

    salaire_net = sb - total_deductions
    cout_total = sb + total_charges

    deductions_employe = {
        "rrq": round(rrq_emp, 2),
        "rqap": round(rqap_emp, 2),
        "ae": round(ae_emp, 2),
        "impot_federal": round(impot_federal, 2),
        "impot_provincial": round(impot_provincial, 2),
        "total": round(total_deductions, 2),
    }

    charges_employeur = {
        "rrq": round(rrq_er, 2),
        "rqap": round(rqap_er, 2),
        "ae": round(ae_er, 2),
        "cnesst": round(cnesst, 2),
        "fss": round(fss, 2),
        "total": round(total_charges, 2),
    }
    if body.type_employe == "construction_ccq":
        charges_employeur["ccq"] = round(ccq, 2)

    return {
        "salaire_brut": round(sb, 2),
        "type_employe": body.type_employe,
        "deductions_employe": deductions_employe,
        "charges_employeur": charges_employeur,
        "salaire_net": round(salaire_net, 2),
        "cout_total_employeur": round(cout_total, 2),
    }


# ============================================
# STRUCTURAL ANALYSIS (CNBC/CSA O86)
# ============================================

def _generate_beam_svg(portee_mm: float, w_sls: float, type_element: str, section: str) -> str:
    """Generate SVG beam diagram with supports, distributed load, and span dimension."""
    width = 600
    height = 280
    margin_x = 60
    beam_y = 160
    beam_len = width - 2 * margin_x
    support_h = 30
    load_zone_top = 50
    load_zone_bot = beam_y - 15

    w_label = f"w = {w_sls:.2f} kN/m"
    span_label = f"L = {portee_mm:.0f} mm"
    title_label = f"{type_element.capitalize()} {section}"

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
  <style>
    text {{ font-family: Arial, sans-serif; font-size: 13px; fill: #333; }}
    .title {{ font-size: 15px; font-weight: bold; }}
    .dim {{ font-size: 12px; fill: #555; }}
    .load {{ fill: #2563eb; }}
    .beam {{ stroke: #1e293b; stroke-width: 4; }}
    .support {{ fill: #64748b; stroke: #334155; stroke-width: 1.5; }}
    .arrow {{ stroke: #2563eb; stroke-width: 1.5; fill: #2563eb; }}
    .load-rect {{ fill: #dbeafe; stroke: #2563eb; stroke-width: 1; opacity: 0.6; }}
    .dim-line {{ stroke: #888; stroke-width: 1; stroke-dasharray: 4,3; }}
  </style>
  <text x="{width / 2}" y="22" text-anchor="middle" class="title">{title_label}</text>
  <rect x="{margin_x}" y="{load_zone_top}" width="{beam_len}" height="{load_zone_bot - load_zone_top}" class="load-rect"/>
'''
    num_arrows = 12
    for i in range(num_arrows + 1):
        ax = margin_x + i * beam_len / num_arrows
        svg += f'  <line x1="{ax:.1f}" y1="{load_zone_top}" x2="{ax:.1f}" y2="{load_zone_bot}" class="arrow"/>\n'
        svg += f'  <polygon points="{ax:.1f},{load_zone_bot} {ax - 3:.1f},{load_zone_bot - 8} {ax + 3:.1f},{load_zone_bot - 8}" class="arrow"/>\n'

    svg += f'''  <text x="{width / 2}" y="{load_zone_top - 6}" text-anchor="middle" class="load" style="font-size:12px;">{w_label}</text>
  <line x1="{margin_x}" y1="{beam_y}" x2="{margin_x + beam_len}" y2="{beam_y}" class="beam"/>
  <polygon points="{margin_x},{beam_y + 2} {margin_x - 15},{beam_y + 2 + support_h} {margin_x + 15},{beam_y + 2 + support_h}" class="support"/>
  <polygon points="{margin_x + beam_len},{beam_y + 2} {margin_x + beam_len - 15},{beam_y + 2 + support_h} {margin_x + beam_len + 15},{beam_y + 2 + support_h}" class="support"/>
  <line x1="{margin_x - 25}" y1="{beam_y + 2 + support_h}" x2="{margin_x + beam_len + 25}" y2="{beam_y + 2 + support_h}" style="stroke:#94a3b8;stroke-width:2;"/>
  <line x1="{margin_x}" y1="{beam_y + support_h + 25}" x2="{margin_x + beam_len}" y2="{beam_y + support_h + 25}" class="dim-line"/>
  <text x="{width / 2}" y="{beam_y + support_h + 45}" text-anchor="middle" class="dim">{span_label}</text>
</svg>'''
    return svg


@router.post("/charge-tributaire-complete")
async def calc_charge_tributaire_complete(body: ChargeTributaireCompleteInput, user: ErpUser = Depends(get_current_user)):
    """Analyse structurale complete (CNBC/CSA O86)."""
    if body.type_materiau == "bois_dimensionnel":
        dims = BOIS_DIMENSIONS.get(body.section)
        if not dims:
            raise HTTPException(
                status_code=400,
                detail="Section de bois non disponible. Consultez /calculators/charge-tributaire-complete/materials",
            )
        props = BOIS_PROPRIETES["SPF_No2"]
    elif body.type_materiau == "lvl":
        dims = LVL_DIMENSIONS.get(body.section)
        if not dims:
            raise HTTPException(
                status_code=400,
                detail="Section LVL non disponible. Consultez /calculators/charge-tributaire-complete/materials",
            )
        props = LVL_PROPRIETES["2.0E"]
    else:
        raise HTTPException(status_code=400, detail="Type de materiau non supporte")

    b_mm = dims["b"] * body.ply_count
    d_mm = dims["d"]
    fb_mpa = props["fb"]
    fv_mpa = props["fv"]
    E_mpa = props["E"]
    mat_name = props["name"]

    # Section properties
    I_mm4 = b_mm * d_mm ** 3 / 12.0
    S_mm3 = b_mm * d_mm ** 2 / 6.0
    A_mm2 = b_mm * d_mm

    # Line loads (kN/m)
    w_dead = body.charge_morte_kpa * body.largeur_tributaire_m
    w_live = body.charge_vive_kpa * body.largeur_tributaire_m
    w_snow = body.charge_neige_kpa * body.largeur_tributaire_m

    # CNBC load combinations
    combo1 = 1.4 * w_dead
    combo2 = 1.25 * w_dead + 1.5 * w_live
    combo3 = 1.25 * w_dead + 1.5 * w_snow if w_snow > 0 else 0.0
    combo4 = 1.25 * w_dead + 1.5 * w_live + 0.5 * w_snow

    combos = {"1.4D": round(combo1, 4), "1.25D+1.5L": round(combo2, 4)}
    if w_snow > 0:
        combos["1.25D+1.5S"] = round(combo3, 4)
    combos["1.25D+1.5L+0.5S"] = round(combo4, 4)

    w_uls = max(combo1, combo2, combo3, combo4)
    w_sls = w_dead + w_live + w_snow

    combo_values = [combo1, combo2, combo3, combo4]
    combo_names = ["1.4D", "1.25D+1.5L", "1.25D+1.5S", "1.25D+1.5L+0.5S"]
    governing_combo = combo_names[combo_values.index(w_uls)]

    # Beam analysis
    L_m = body.portee_mm / 1000.0
    L_mm = body.portee_mm

    M_max_kNm = w_uls * L_m ** 2 / 8.0
    V_max_kN = w_uls * L_m / 2.0

    w_sls_N_per_mm = w_sls  # 1 kN/m = 1 N/mm
    delta_mm = (5.0 * w_sls_N_per_mm * L_mm ** 4) / (384.0 * E_mpa * I_mm4)

    Kd = 1.0
    Kl = 1.0

    Mr_Nmm = fb_mpa * S_mm3 * Kd * Kl
    Mr_kNm = Mr_Nmm / 1.0e6

    Vr_N = fv_mpa * (2.0 / 3.0) * A_mm2 * Kd
    Vr_kN = Vr_N / 1000.0

    deflection_ratio_key = body.type_utilisation
    if body.type_element == "linteau":
        deflection_ratio_key = "linteau"
    limite = LIMITES_FLECHE.get(deflection_ratio_key, LIMITES_FLECHE["plancher"])
    deflection_ratio = limite["ratio"]
    delta_limit_mm = L_mm / deflection_ratio

    flexion_ok = M_max_kNm <= Mr_kNm
    cisaillement_ok = V_max_kN <= Vr_kN
    fleche_ok = delta_mm <= delta_limit_mm

    ratio_flexion = M_max_kNm / Mr_kNm if Mr_kNm > 0 else 999.0
    ratio_cisaillement = V_max_kN / Vr_kN if Vr_kN > 0 else 999.0
    ratio_fleche = delta_mm / delta_limit_mm if delta_limit_mm > 0 else 999.0

    global_ok = flexion_ok and cisaillement_ok and fleche_ok

    svg_diagram = _generate_beam_svg(body.portee_mm, w_sls, body.type_element, body.section)

    return {
        "titre": f"Analyse structurale - {body.type_element.capitalize()} {body.section} ({body.ply_count} pli{'s' if body.ply_count > 1 else ''})",
        "materiau": {
            "type": body.type_materiau,
            "grade": mat_name,
            "section": body.section,
            "ply_count": body.ply_count,
            "b_mm": b_mm,
            "d_mm": d_mm,
            "fb_mpa": fb_mpa,
            "fv_mpa": fv_mpa,
            "e_mpa": E_mpa,
        },
        "section_properties": {
            "I_mm4": round(I_mm4, 1),
            "S_mm3": round(S_mm3, 1),
            "A_mm2": round(A_mm2, 1),
        },
        "charges": {
            "charge_morte_kpa": body.charge_morte_kpa,
            "charge_vive_kpa": body.charge_vive_kpa,
            "charge_neige_kpa": body.charge_neige_kpa,
            "largeur_tributaire_m": body.largeur_tributaire_m,
            "w_dead_kN_m": round(w_dead, 4),
            "w_live_kN_m": round(w_live, 4),
            "w_snow_kN_m": round(w_snow, 4),
        },
        "combinaisons_cnbc": {
            "combos": combos,
            "w_uls_kn_m": round(w_uls, 4),
            "w_sls_kn_m": round(w_sls, 4),
            "combo_gouvernante": governing_combo,
        },
        "efforts": {
            "portee_mm": body.portee_mm,
            "m_max_knm": round(M_max_kNm, 3),
            "v_max_kn": round(V_max_kN, 3),
            "delta_mm": round(delta_mm, 2),
        },
        "resistance_csa_o86": {
            "mr_knm": round(Mr_kNm, 3),
            "vr_kn": round(Vr_kN, 3),
            "kd": Kd,
            "kl": Kl,
        },
        "verification": {
            "flexion": {
                "ok": flexion_ok,
                "ratio": round(ratio_flexion, 3),
                "m_max_knm": round(M_max_kNm, 3),
                "mr_knm": round(Mr_kNm, 3),
            },
            "cisaillement": {
                "ok": cisaillement_ok,
                "ratio": round(ratio_cisaillement, 3),
                "v_max_kn": round(V_max_kN, 3),
                "vr_kn": round(Vr_kN, 3),
            },
            "fleche": {
                "ok": fleche_ok,
                "ratio": round(ratio_fleche, 3),
                "delta_mm": round(delta_mm, 2),
                "limite_mm": round(delta_limit_mm, 2),
                "critere": limite["description"],
            },
            "global_ok": global_ok,
            "verdict": "CONFORME" if global_ok else "NON CONFORME",
        },
        "svg_diagram": svg_diagram,
    }


@router.get("/charge-tributaire-complete/materials")
async def get_structural_materials(user: ErpUser = Depends(get_current_user)):
    """Catalogue sections et grades structuraux."""
    return {
        "bois_dimensionnel": {
            "sections": list(BOIS_DIMENSIONS.keys()),
            "grades": {k: v["name"] for k, v in BOIS_PROPRIETES.items()},
            "dimensions": BOIS_DIMENSIONS,
            "proprietes": BOIS_PROPRIETES,
        },
        "lvl": {
            "sections": list(LVL_DIMENSIONS.keys()),
            "grades": {k: v["name"] for k, v in LVL_PROPRIETES.items()},
            "dimensions": LVL_DIMENSIONS,
            "proprietes": LVL_PROPRIETES,
        },
        "profiles_w": list(PROFILES_W.keys()),
        "profiles_c": list(PROFILES_C.keys()),
        "limites_fleche": LIMITES_FLECHE,
    }


@router.get("/charge-tributaire-complete/snow-loads")
async def get_snow_loads(user: ErpUser = Depends(get_current_user)):
    """Charges de neige par province/ville (CNBC 4.1.6)."""
    return {"provinces": CHARGES_NEIGE}


# ============================================
# CONVERSIONS
# ============================================

@router.get("/conversions")
async def get_conversion_tables(user: ErpUser = Depends(get_current_user)):
    """Tables de conversion construction."""
    return {
        "longueur": {
            "m_to_ft": 3.28084,
            "ft_to_m": 0.3048,
            "in_to_mm": 25.4,
            "mm_to_in": 0.03937,
            "yd_to_m": 0.9144,
            "m_to_yd": 1.09361,
        },
        "surface": {
            "m2_to_ft2": 10.7639,
            "ft2_to_m2": 0.0929,
            "acre_to_m2": 4046.86,
            "m2_to_acre": 0.000247,
            "hectare_to_m2": 10000,
        },
        "volume": {
            "m3_to_ft3": 35.3147,
            "ft3_to_m3": 0.02832,
            "m3_to_yd3": 1.30795,
            "yd3_to_m3": 0.7646,
            "litre_to_gallon": 0.26417,
            "gallon_to_litre": 3.78541,
        },
        "poids": {
            "kg_to_lbs": 2.20462,
            "lbs_to_kg": 0.45359,
            "tonne_to_lbs": 2204.62,
            "lbs_to_tonne": 0.000454,
        },
        "pression": {
            "psi_to_kpa": 6.89476,
            "kpa_to_psi": 0.14504,
            "bar_to_psi": 14.5038,
            "psi_to_bar": 0.06895,
        },
        "temperature": {
            "c_to_f_formula": "F = C * 9/5 + 32",
            "f_to_c_formula": "C = (F - 32) * 5/9",
        },
        "dms": {
            "description": "DMS = Degres.Minutes.Secondes (ex: 45.3015 = 45 deg 30 min 15 sec)",
        },
    }


# ============================================
# HISTORY ENDPOINTS
# ============================================

@router.get("/history")
async def list_history(
    user: ErpUser = Depends(get_current_user),
    calculator_id: Optional[str] = Query(None, max_length=100),
    limit: int = Query(100, ge=1, le=500),
):
    """Lister l'historique des calculs."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        if calculator_id:
            cursor.execute(
                """SELECT * FROM calculator_history
                   WHERE calculator_id = %s
                   ORDER BY created_at DESC LIMIT %s""",
                (calculator_id, limit),
            )
        else:
            cursor.execute(
                """SELECT * FROM calculator_history
                   ORDER BY created_at DESC LIMIT %s""",
                (limit,),
            )
        items = []
        for row in cursor.fetchall():
            d = _serialize(row)
            d["inputs"] = _parse_json_field(row.get("inputs"))
            d["results"] = _parse_json_field(row.get("results"))
            items.append(d)
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_history error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la lecture de l'historique")
    finally:
        _close_tenant(conn, cursor)


@router.post("/history")
async def create_history(body: HistoryCreate, user: ErpUser = Depends(get_current_user)):
    """Sauvegarder un calcul dans l'historique."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute(
            """INSERT INTO calculator_history (
                calculator_id, subcalc_id, label, inputs, results, notes, user_id
            ) VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s, %s) RETURNING id""",
            (
                body.calculator_id,
                body.subcalc_id,
                body.label,
                json.dumps(body.inputs),
                json.dumps(body.results),
                body.notes,
                getattr(user, "id", None),
            ),
        )
        row = cursor.fetchone()
        if not row:
            _safe_rollback(conn)
            raise HTTPException(status_code=500, detail="Erreur lors de la sauvegarde")
        conn.commit()
        return {"id": row["id"], "message": "Calcul sauvegarde"}
    except HTTPException:
        raise
    except Exception as exc:
        _safe_rollback(conn)
        logger.error("create_history error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la sauvegarde")
    finally:
        _close_tenant(conn, cursor)


@router.delete("/history/{item_id}")
async def delete_history_item(item_id: int, user: ErpUser = Depends(get_current_user)):
    """Supprimer un calcul de l'historique."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute("DELETE FROM calculator_history WHERE id = %s", (item_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Calcul introuvable")
        conn.commit()
        return {"id": item_id, "deleted": True}
    except HTTPException:
        raise
    except Exception as exc:
        _safe_rollback(conn)
        logger.error("delete_history_item error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression")
    finally:
        _close_tenant(conn, cursor)


@router.delete("/history")
async def clear_history(
    user: ErpUser = Depends(get_current_user),
    calculator_id: Optional[str] = Query(None, max_length=100),
):
    """Effacer l'historique (tout ou par calculateur)."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        if calculator_id:
            cursor.execute("DELETE FROM calculator_history WHERE calculator_id = %s", (calculator_id,))
        else:
            cursor.execute("DELETE FROM calculator_history")
        deleted = cursor.rowcount
        conn.commit()
        return {"deleted": deleted}
    except HTTPException:
        raise
    except Exception as exc:
        _safe_rollback(conn)
        logger.error("clear_history error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'effacement")
    finally:
        _close_tenant(conn, cursor)


@router.get("/history/stats")
async def get_history_stats(user: ErpUser = Depends(get_current_user)):
    """Statistiques sur l'historique des calculs."""
    conn = None
    cursor = None
    try:
        conn, cursor = _get_tenant_cursor(user)
        cursor.execute("SELECT COUNT(*) AS total FROM calculator_history")
        total_row = cursor.fetchone()
        total = total_row["total"] if total_row else 0

        cursor.execute(
            """SELECT calculator_id, COUNT(*) AS count
               FROM calculator_history
               GROUP BY calculator_id
               ORDER BY count DESC"""
        )
        par_calc = [_serialize(r) for r in cursor.fetchall()]

        cursor.execute(
            """SELECT DATE_TRUNC('day', created_at)::date AS jour, COUNT(*) AS count
               FROM calculator_history
               WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
               GROUP BY jour
               ORDER BY jour DESC"""
        )
        par_jour = [_serialize(r) for r in cursor.fetchall()]

        return {
            "total": total,
            "par_calculateur": par_calc,
            "par_jour_30": par_jour,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_history_stats error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du calcul des stats")
    finally:
        _close_tenant(conn, cursor)


# ============================================
# AI ENDPOINTS (Claude Opus 4.6)
# ============================================

@router.post("/ai/chat")
async def ai_chat(body: AiChatRequest, user: ErpUser = Depends(get_current_user)):
    """Chat expert construction Quebec (Claude Opus 4.6)."""
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question vide")

    calc_context = ""
    if body.calculator_id:
        # Add calculator-specific context
        calc_info = next((c for c in CALCULATEURS_LISTE if c["id"] == body.calculator_id), None)
        if calc_info:
            calc_context = f"\n\nContexte: L'utilisateur travaille actuellement avec le calculateur <calc>{calc_info['name']} - {calc_info['description']}</calc>"

    prompt = f"""<user_question>
{question}
</user_question>
{calc_context}

Reponds en francais quebecois, de maniere claire et professionnelle. Si pertinent, cite les articles de normes/lois (CCQ, CNBC, CSA, CCE, CNP, ASHRAE). Structure ta reponse pour etre facile a lire."""

    text = _call_claude_text(user, "calc_chat", prompt, temperature=0.4)
    return {"response": text, "calculator_id": body.calculator_id}


@router.post("/ai/analyze")
async def ai_analyze(body: AiAnalyzeRequest, user: ErpUser = Depends(get_current_user)):
    """Analyse d'un calcul avec score de conformite."""
    calc_info = next((c for c in CALCULATEURS_LISTE if c["id"] == body.calculator_id), None)
    calc_name = calc_info["name"] if calc_info else body.calculator_id

    prompt = f"""Tu analyses un calcul de <calc>{calc_name}</calc> effectue par un professionnel de la construction au Quebec.

<inputs>
{json.dumps(body.inputs, indent=2, ensure_ascii=False)}
</inputs>

<results>
{json.dumps(body.results, indent=2, ensure_ascii=False)}
</results>

Analyse ce calcul en profondeur et retourne un JSON avec ces cles exactes:
{{
  "score_conformite": <int 0-100>,
  "evaluation_globale": "<string 1-2 phrases>",
  "points_forts": [<list of strings>],
  "points_attention": [<list of strings>],
  "recommandations": [<list of strings>],
  "normes_citees": [<list of code references, e.g. "CCQ 9.8", "CSA A23.1 Table X">],
  "risques": [<list of strings>],
  "optimisations_possibles": [<list of strings>]
}}

Retourne SEULEMENT le JSON, sans markdown ni commentaires."""

    return _call_claude_json(user, "calc_analyze", prompt, temperature=0.3)


@router.post("/ai/recommend")
async def ai_recommend(body: AiRecommendRequest, user: ErpUser = Depends(get_current_user)):
    """Recommandations d'un expert pour un objectif specifique."""
    calc_info = next((c for c in CALCULATEURS_LISTE if c["id"] == body.calculator_id), None)
    calc_name = calc_info["name"] if calc_info else body.calculator_id

    objectif = body.objectif.strip()
    contraintes = (body.contraintes or "").strip()

    prompt = f"""En tant qu'expert en <calc>{calc_name}</calc> au Quebec, donne des recommandations pratiques pour:

<objectif>
{objectif}
</objectif>

{f"<contraintes>{chr(10)}{contraintes}{chr(10)}</contraintes>" if contraintes else ""}

Retourne un JSON avec:
{{
  "approche_recommandee": "<string 2-3 phrases>",
  "etapes": [<list of strings>],
  "materiaux_recommandes": [<list>],
  "considerations_normes": [<list>],
  "couts_estimes": "<string>",
  "alertes": [<list of warnings>]
}}

JSON seul."""

    return _call_claude_json(user, "calc_recommend", prompt, temperature=0.4)


@router.post("/ai/explain-norm")
async def ai_explain_norm(body: AiExplainNormRequest, user: ErpUser = Depends(get_current_user)):
    """Expliquer une norme ou un article de code."""
    norme = body.norme.strip()
    contexte = (body.contexte or "").strip()

    prompt = f"""Explique la norme/article suivant en detail:

<norme>{norme}</norme>
{f"<contexte>{contexte}</contexte>" if contexte else ""}

Retourne un JSON:
{{
  "titre_officiel": "<string>",
  "organisme_emetteur": "<string>",
  "version_annee": "<string>",
  "explication": "<string paragraphe detaille>",
  "exigences_principales": [<list of strings>],
  "exemples_application": [<list>],
  "references_croisees": [<list>],
  "note": "<string - limites ou avertissements>"
}}

Si tu n'es pas certain, mentionne-le dans note. JSON seul."""

    return _call_claude_json(user, "calc_explain_norm", prompt, temperature=0.2)


@router.post("/ai/diagnose")
async def ai_diagnose(body: AiDiagnoseRequest, user: ErpUser = Depends(get_current_user)):
    """Diagnostiquer un probleme pour un calculateur specifique."""
    calc_info = next((c for c in CALCULATEURS_LISTE if c["id"] == body.calculator_id), None)
    calc_name = calc_info["name"] if calc_info else body.calculator_id

    probleme = body.probleme.strip()
    symptomes = (body.symptomes or "").strip()

    prompt = f"""Diagnostique le probleme suivant pour <calc>{calc_name}</calc>:

<probleme>
{probleme}
</probleme>

{f"<symptomes>{chr(10)}{symptomes}{chr(10)}</symptomes>" if symptomes else ""}

Retourne un JSON:
{{
  "diagnostic_principal": "<string>",
  "causes_probables": [<list of strings>],
  "tests_verification": [<list>],
  "solutions_recommandees": [<list of strings>],
  "urgence": "<faible|moderee|elevee|critique>",
  "intervention_professionnelle": <true|false>,
  "cout_approximatif_cad": "<string range>"
}}

JSON seul."""

    return _call_claude_json(user, "calc_diagnose", prompt, temperature=0.3)


@router.post("/ai/optimize")
async def ai_optimize(body: AiOptimizeRequest, user: ErpUser = Depends(get_current_user)):
    """Suggestions d'optimisation (cout/performance/ecologique/delai)."""
    calc_info = next((c for c in CALCULATEURS_LISTE if c["id"] == body.calculator_id), None)
    calc_name = calc_info["name"] if calc_info else body.calculator_id

    prompt = f"""Optimise la configuration suivante pour <calc>{calc_name}</calc> avec objectif d'optimisation = <objectif>{body.objectif_optimisation}</objectif>.

<inputs_actuels>
{json.dumps(body.inputs_actuels, indent=2, ensure_ascii=False)}
</inputs_actuels>

Retourne un JSON:
{{
  "objectif": "{body.objectif_optimisation}",
  "suggestions": [
    {{"changement": "<string>", "impact_estime": "<string>", "difficulte": "<facile|moyenne|difficile>", "priorite": <int 1-5>}}
  ],
  "economies_potentielles": "<string>",
  "risques_changement": [<list>],
  "recommandation_finale": "<string>"
}}

JSON seul."""

    return _call_claude_json(user, "calc_optimize", prompt, temperature=0.4)


# ============================================
# CONSTANTS & RESOURCES
# ============================================

@router.get("/constants")
async def get_constants(user: ErpUser = Depends(get_current_user)):
    """Retourne toutes les constantes/tables utilisees par le frontend."""
    return {
        "metaux": METAUX,
        "profilesW": list(PROFILES_W.keys()),
        "profilesC": list(PROFILES_C.keys()),
        "dosagesBeton": DOSAGES_BETON,
        "classesBeton": CLASSES_BETON,
        "barresArmature": BARRES_ARMATURE,
        "foisonnement": FOISONNEMENT,
        "pentesTalusCnesst": PENTES_TALUS_CNESST,
        "awgTable": AWG_TABLE,
        "eclairageNiveaux": ECLAIRAGE_NIVEAUX,
        "dfuAppareils": DFU_APPAREILS,
        "diametresDrain": DIAMETRES_DRAIN,
        "hazenWilliamsC": HAZEN_WILLIAMS_C,
        "chauffeEauCapacite": CHAUFFE_EAU_CAPACITE,
        "hvacFactors": HVAC_FACTORS,
        "zonesClimatiques": ZONES_CLIMATIQUES,
        "achRecommande": ACH_RECOMMANDE,
        "vitessesConduit": VITESSES_CONDUIT,
        "shgcOrientation": SHGC_ORIENTATION,
        "pentesToiture": PENTES_TOITURE,
        "materiauxToiture": MATERIAUX_TOITURE,
        "chargesMortesToiture": CHARGES_MORTES_TOITURE,
        "gouttieresCapacite": GOUTTIERES_CAPACITE,
        "typesPeinture": TYPES_PEINTURE,
        "facteursAbsorption": FACTEURS_ABSORPTION,
        "efficaciteTransfert": EFFICACITE_TRANSFERT,
        "electrodesSmaw": ELECTRODES_SMAW,
        "filsGmaw": FILS_GMAW,
        "gazProtection": GAZ_PROTECTION,
        "tauxDepot": TAUX_DEPOT,
        "electrodeWaste": ELECTRODE_WASTE,
        "materiauxPliage": MATERIAUX_PLIAGE,
        "kFactorTable": K_FACTOR_TABLE,
        "boisDimensions": BOIS_DIMENSIONS,
        "boisProprietes": BOIS_PROPRIETES,
        "lvlDimensions": LVL_DIMENSIONS,
        "lvlProprietes": LVL_PROPRIETES,
        "limitesFleche": LIMITES_FLECHE,
        "chargesNeige": CHARGES_NEIGE,
        "escaliersCcq": ESCALIERS_CCQ,
        "essencesBoisEscalier": ESSENCES_BOIS_ESCALIER,
        "blondelMin": BLONDEL_MIN,
        "blondelMax": BLONDEL_MAX,
        "blondelOpt": BLONDEL_OPT,
        "tpsRate": TPS_RATE,
        "tvqRate": TVQ_RATE,
        "tauxDeductionsEmploye": TAUX_DEDUCTIONS_EMPLOYE,
        "tauxChargesEmployeur": TAUX_CHARGES_EMPLOYEUR,
    }


@router.get("/resources")
async def get_resources(user: ErpUser = Depends(get_current_user)):
    """Listes + conseils pratiques par calculateur."""
    return {
        "calculateurs": CALCULATEURS_LISTE,
        "categories": CATEGORIES_CALCS,
        "conseils": CONSEILS_CALCULATEURS,
    }


@router.get("")
async def list_calculators(user: ErpUser = Depends(get_current_user)):
    """Liste des calculateurs disponibles."""
    return {"calculators": CALCULATEURS_LISTE}
