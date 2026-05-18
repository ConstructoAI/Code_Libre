/**
 * ERP React Frontend - Calculators API Wrapper
 *
 * 13 calculateurs construction Quebec avec 50+ sous-endpoints,
 * 6 endpoints IA Claude Opus 4.6, et persistance historique par tenant.
 *
 * Backend: ERP_REACT/backend/routers/calculators.py (3160 lignes)
 */

import api from './client';

// ============================================
// SHARED / METADATA
// ============================================

export interface Calculator {
  id: string;
  category?: string;
  name: string;
  icon?: string;
  description: string;
}

export interface CalculatorCategory {
  label: string;
  color: string;
  icon: string;
}

export interface ConversionTables {
  longueur: Record<string, number>;
  surface: Record<string, number>;
  volume: Record<string, number>;
  poids: Record<string, number>;
  pression: Record<string, number>;
  temperature: Record<string, string>;
  dms?: Record<string, string>;
}


// ============================================
// CONCRETE
// ============================================

export interface ConcreteInput {
  longueur: number;
  largeur: number;
  epaisseur: number;
  perte_pct?: number;
  classe_beton?: string;
}

export interface ConcreteClasseInfo {
  description: string;
  resistance_mpa: number;
  ec_max: number;
  air_pct: number;
  enrobage_mm: number;
}

export interface ConcreteResult {
  volumeM3: number;
  perteM3: number;
  volumeTotalM3: number;
  surfaceM2: number;
  cimentKg: number;
  sableKg: number;
  gravierKg: number;
  eauLitres: number;
  sacs30Kg: number;
  sacs40Kg: number;
  classeBeton: ConcreteClasseInfo;
  surfaceCoffrageM2: number;
  feuillesCoffrage4x8: number;
}

export interface ConcreteDosageInput {
  volume_m3: number;
  resistance_mpa: '15MPa' | '20MPa' | '25MPa' | '30MPa' | '32MPa' | '35MPa' | '40MPa';
}

export interface ConcreteDosageResult {
  resistanceMpa: string;
  volumeM3: number;
  ecRatio: number;
  dosageParM3: Record<string, number>;
  quantitesTotales: {
    cimentKg: number;
    sableKg: number;
    gravierKg: number;
    eauLitres: number;
  };
  ratio: string;
  sacs30Kg: number;
  sacs40Kg: number;
}

export interface ConcreteRebarInput {
  longueur_m: number;
  largeur_m: number;
  enrobage_mm?: number;
  espacement_mm?: number;
  barre_type: '10M' | '15M' | '20M' | '25M' | '30M' | '35M' | '45M' | '55M';
  nb_lits?: number;
  perte_pct?: number;
}

export interface ConcreteRebarResult {
  barreType: string;
  proprietesBarre: { diametreMm: number; aireMm2: number; masseKgM: number };
  nbBarresLongitudinales: number;
  nbBarresTransversales: number;
  longueurTotaleM: number;
  longueurAvecPerteM: number;
  nbBarresStandard6m: number;
  masseTotaleKg: number;
  masseTotaleLb: number;
  nbLits: number;
  espacementMm: number;
}

export interface ConcreteCureInput {
  resistance_finale_mpa: number;
  age_jours: number;
  temperature_c: number;
  ciment_type?: 'GU' | 'HE' | 'MS' | 'HS';
}

export interface ConcreteCureResult {
  cimentType: string;
  description: string;
  ageJours: number;
  temperatureC: number;
  facteurMaturite: number;
  ageEffectifJours: number;
  resistanceFinaleMpa: number;
  resistanceCouranteMpa: number;
  pctResistanceFinale: number;
  tempsCureMinimumJours: number;
  recommandations: Record<string, number>;
}

export interface ConcreteFormworkInput {
  longueur_m: number;
  hauteur_m: number;
  epaisseur_coffrage_mm?: number;
}

export interface ConcreteFormworkResult {
  surfaceMurM2: number;
  surfaceCoffrageTotaleM2: number;
  feuilles4x8: number;
  nbEtais2x4: number;
  boisMontantsM: number;
}

export interface ConcreteExcavationInput {
  longueur_m: number;
  largeur_m: number;
  profondeur_m: number;
  type_sol?: 'terre_ordinaire' | 'argile' | 'sable' | 'gravier' | 'roc';
}

export interface ConcreteExcavationResult {
  typeSol: string;
  facteurFoisonnement: number;
  volumeCompactM3: number;
  volumeFoisonneM3: number;
  volumeFoisonneYd3: number;
  nbCamions12yd3: number;
  poidsEstimeTonnes: number;
}

export interface ConcreteTalusInput {
  profondeur_m: number;
  type_sol?: 'roc' | 'argile_dure' | 'argile_molle' | 'sable' | 'sol_meuble';
}

export interface ConcreteTalusResult {
  typeSol: string;
  description: string;
  ratioHV: number;
  angleDegres: number;
  profondeurM: number;
  distanceHorizontaleM: number;
  volumeAdditionnelM3: number;
  exigencesCnesst: string[];
}

export interface ConcreteStairsInput {
  hauteur_totale_mm: number;
  largeur_m?: number;
  epaisseur_dalle_mm?: number;
  giron_cible_mm?: number;
  hauteur_marche_cible_mm?: number;
}

export interface ConcreteStairsResult {
  nbMarches: number;
  hauteurMarcheMm: number;
  gironMm: number;
  blondel2rG: number;
  blondelConforme: boolean;
  longueurReculementMm: number;
  longueurDalleMm: number;
  volumeMarchesM3: number;
  volumeDalleM3: number;
  volumeTotalM3: number;
  cimentKg: number;
  sableKg: number;
  gravierKg: number;
  eauLitres: number;
}


// ============================================
// STAIRS
// ============================================

export interface StairInput {
  hauteur_totale: number;
  giron_cible?: number;
  hauteur_marche_cible?: number;
  usage?: 'residentiel' | 'commercial';
  largeur_m?: number;
}

export interface StairResult {
  usage: string;
  codeLabel: string;
  nbMarches: number;
  hauteurMarcheMm: number;
  gironMm: number;
  largeurMm: number;
  formule2rG: number;
  blondelOptimal: number;
  conformeCcq: boolean;
  conformeBlondel: boolean;
  conformiteDetail: Record<string, boolean>;
  reculementMm: number;
  penteDegres: number;
  ligneFouleeMm: number;
  hauteurTotaleMm: number;
  criteresCode: Record<string, unknown>;
  evaluationConfort: string;
}

export interface StairMaterialsInput {
  nb_marches: number;
  largeur_m?: number;
  materiau?: 'beton' | 'bois' | 'acier';
  essence_bois?: 'pin' | 'epinette' | 'erable' | 'chene' | 'merisier';
}

export interface StairGardeCorpsInput {
  longueur_m: number;
  hauteur_mm?: number;
  espacement_barreaux_mm?: number;
  usage?: 'residentiel' | 'commercial';
}

export interface StairGardeCorpsResult {
  usage: string;
  longueurM: number;
  hauteurMm: number;
  conformeHauteur: boolean;
  conformeBarreaux: boolean;
  conformeGlobal: boolean;
  nbBarreaux: number;
  nbPoteaux: number;
  longueurMainCouranteM: number;
  diametreMainCouranteMm: number;
  espacementBarreauxMm: number;
  criteresCode: Record<string, number>;
}


// ============================================
// ELECTRICAL
// ============================================

export interface ElectricalInput {
  puissance_watts: number;
  tension_volts?: number;
  longueur_cable_m?: number;
  facteur_puissance?: number;
  chute_tension_max_pct?: number;
  conducteur?: 'cuivre' | 'aluminium';
  type_circuit?: 'monophase' | 'triphase';
}

export interface ElectricalResult {
  courantAmperes: number;
  conducteur: string;
  typeCircuit: string;
  sectionMinMm2: number;
  awgRecommande: string;
  sectionRecommandeeMm2: number;
  ampacite60: number;
  ampacite75: number;
  ampacite90: number;
  chuteTensionVolts: number;
  chuteTensionPct: number;
  conformiteChute: string;
  disjoncteurAmperes: number;
}

export interface ElectricalResidentialInput {
  surface_habitable_m2: number;
  chauffage_kw?: number;
  climatisation_kw?: number;
  cuisiniere_kw?: number;
  secheuse_kw?: number;
  chauffe_eau_kw?: number;
  autres_charges_kw?: number;
}

export interface ElectricalResidentialResult {
  surfaceM2: number;
  chargeBaseW: number;
  hvacW: number;
  cuisiniereWDemande: number;
  secheuseWDemande: number;
  chauffeEauW: number;
  autresWDemande: number;
  totalDemandeW: number;
  totalDemandeKw: number;
  courantService240v: number;
  calibreServiceRecommandeA: number;
  articleCce: string;
}

export interface ElectricalLightingInput {
  surface_m2: number;
  type_local?: string;
  flux_luminaire_lm?: number;
  uf?: number;
  mf?: number;
}

export interface ElectricalLightingResult {
  typeLocal: string;
  surfaceM2: number;
  luxRequis: number;
  luxMinCode: number;
  fluxLuminaireLm: number;
  facteurUtilisation: number;
  facteurMaintenance: number;
  nbLuminaires: number;
  dispositionGrille: string;
  espacementM: number;
  fluxTotalRequisLm: number;
}

export interface ElectricalGroundingInput {
  resistivite_sol?: number;
  longueur_piquet_m?: number;
  diametre_piquet_m?: number;
  nb_piquets?: number;
}

export interface ElectricalGroundingResult {
  resistiviteSol: number;
  longueurPiquetM: number;
  diametrePiquetM: number;
  nbPiquets: number;
  resistancePiquetUniqueOhms: number;
  resistanceTotaleOhms: number;
  conformeHydroQuebec: boolean;
  seuilHydroQuebecOhms: number;
  recommandation: string;
}


// ============================================
// ROOFING
// ============================================

export interface RoofingInput {
  longueur_m: number;
  largeur_m: number;
  pente_ratio?: number;
  debord_m?: number;
  perte_pct?: number;
  type_materiau?: string;
}

export interface RoofingResult {
  surfaceBaseM2: number;
  facteurPente: number;
  penteDegres: number;
  surfacePenteM2: number;
  perteM2: number;
  surfaceTotaleM2: number;
  nbSquares: number;
  nbPaquetsBardeaux: number;
  rouleauxSousCouche: number;
  membraneGlaceRouleaux: number;
  boitesClous: number;
  materiau: string;
  coutMateriauCad: number;
  coutPoseCad: number;
  coutTotalCad: number;
}

export interface RoofingVentilationInput {
  surface_comble_m2: number;
  pare_vapeur?: boolean;
}

export interface RoofingVentilationResult {
  surfaceCombleM2: number;
  pareVapeur: boolean;
  ratioVentilation: string;
  articleCcq: string;
  nfaTotalPo2: number;
  nfaEntreePo2: number;
  nfaSortiePo2: number;
  soffiteContinuPi: number;
  nbTurbines12po: number;
  eventFaitierPi: number;
}

export interface RoofingGuttersInput {
  surface_toit_m2: number;
  perimetre_m: number;
  type_gouttiere?: '4po' | '5po' | '6po' | '7po';
}

export interface RoofingGuttersResult {
  surfaceToitM2: number;
  surfaceToitPi2: number;
  typeGouttiere: string;
  capaciteParDescentePi2: number;
  nbDescentes: number;
  longueurGouttieresM: number;
  longueurGouttieresPi: number;
  nbSupports: number;
  nbAngles: number;
  nbEmbouts: number;
}

export interface RoofingSnowLoadInput {
  province?: 'QC' | 'ON' | 'BC' | 'AB';
  ville: string;
  type_couverture?: string;
}

export interface RoofingSnowLoadResult {
  province: string;
  ville: string;
  typeCouverture: string;
  chargeNeigeKpa: number;
  chargeNeigeLbPi2: number;
  chargeMorteLbPi2: number;
  chargeDesignKpa: number;
  chargeDesignLbPi2: number;
  norme: string;
}


// ============================================
// PAINTING
// ============================================

export interface PaintingInput {
  longueur_m: number;
  largeur_m: number;
  hauteur_m?: number;
  nb_portes?: number;
  nb_fenetres?: number;
  type_peinture?: string;
  surface_type?: string;
  methode?: 'pinceau' | 'rouleau' | 'airless' | 'hvlp' | 'electrostatique' | 'conventionnel';
  nb_couches?: number;
}

export interface PaintingResult {
  typePeinture: string;
  solidesPct: number;
  dftUmTheorique: number;
  surfaceMursM2: number;
  surfacePlafondM2: number;
  deductionsM2: number;
  surfaceNetteM2: number;
  surfaceTotaleM2: number;
  facteurAbsorption: number;
  efficaciteTransfert: number;
  couvertureEffectiveM2L: number;
  litresParCouche: number;
  litresTotal: number;
  gallonsTotal: number;
  nbCouches: number;
  coutPeintureHt: number;
  tps: number;
  tvq: number;
  coutTotalTtc: number;
  coutParM2Ttc: number;
  tempsSecH: number;
  tempsRecouvrementH: number;
  tempsCompletH: number;
}

export interface PaintingDFTInput {
  volume_ml: number;
  solides_pct: number;
  surface_m2: number;
}

export interface PaintingDFTResult {
  volumeMl: number;
  solidesPct: number;
  surfaceM2: number;
  dftUm: number;
  dftMils: number;
  couvertureTheoriqueM2L: number;
  evaluation: string;
}

export interface PaintingDewPointInput {
  temperature_air_c: number;
  humidite_relative_pct: number;
  temperature_surface_c: number;
}

export interface PaintingDewPointResult {
  temperatureAirC: number;
  humiditeRelativePct: number;
  temperatureSurfaceC: number;
  pointRoseeC: number;
  margeSecuriteC: number;
  applicationSecuritaire: boolean;
  recommandation: string;
}


// ============================================
// PLUMBING
// ============================================

export interface PlumbingInput {
  nb_toilettes?: number;
  nb_lavabos?: number;
  nb_douches?: number;
  nb_baignoires?: number;
  nb_lave_vaisselle?: number;
  nb_machines_laver?: number;
  nb_evier_cuisine?: number;
  nb_evier_bar?: number;
  nb_urinoir?: number;
  nb_drain_plancher?: number;
}

export interface PlumbingDrainDiameter {
  dfuMax: number;
  pouces: string;
  mm: number;
}

export interface PlumbingDetailItem {
  type: string;
  nombre: number;
  dfuUnitaire: number;
  dfuTotal: number;
  wsfuUnitaire: number;
  wsfuTotal: number;
}

export interface PlumbingResult {
  totalDfu: number;
  totalWsfu: number;
  debitGpm: number;
  debitLpm: number;
  diametreDrain: PlumbingDrainDiameter;
  nbAppareils: number;
  detailAppareils: PlumbingDetailItem[];
  code: string;
}

export interface PlumbingHazenWilliamsInput {
  debit_gpm: number;
  longueur_pi: number;
  diametre_pouce: number;
  materiau?: string;
}

export interface PlumbingHazenWilliamsResult {
  debitGpm: number;
  longueurPi: number;
  diametrePouce: number;
  materiau: string;
  coefficientC: number;
  perteChargePi: number;
  perteChargePsi: number;
  vitessePiS: number;
  evaluationVitesse: string;
}

export interface PlumbingWaterHeaterInput {
  nb_chambres: number;
  nb_salles_bain: number;
  nb_personnes?: number;
}

export interface PlumbingWaterHeaterResult {
  nbChambres: number;
  nbSallesBain: number;
  nbPersonnes: number;
  capaciteGallons: number;
  capaciteLitres: number;
  firstHourRatingMin: number;
  consommationPointeEstimee: number;
  adequat: boolean;
  typeRecommande: string;
}

export interface PlumbingDrainSlopeInput {
  diametre_pouce: number;
  longueur_m: number;
  pente_pct?: number;
}

export interface PlumbingDrainSlopeResult {
  diametrePouce: number;
  longueurM: number;
  pentePctAppliquee: number;
  penteRecommandeePct: number;
  chuteM: number;
  chutePo: number;
  conformeCnp: boolean;
  recommandation: string;
}


// ============================================
// HVAC
// ============================================

export interface HvacInput {
  surface_m2: number;
  hauteur_plafond_m?: number;
  isolation?: 'faible' | 'moyenne' | 'bonne' | 'excellente';
  zone_climatique?: 'montreal' | 'quebec' | 'gatineau' | 'sherbrooke' | 'saguenay' | 'rimouski' | 'val_dor' | 'nord';
}

export interface HvacResult {
  surfaceM2: number;
  hauteurPlafondM: number;
  isolation: string;
  zoneClimatique: string;
  tHiverC: number;
  tEteC: number;
  hdd: number;
  pertesBaseW: number;
  facteurZone: number;
  pertesAjusteesW: number;
  pertesDesignW: number;
  btuH: number;
  btuParPi2: number;
  tonnageClim: number;
  volumeM3: number;
  cfmVentilation: number;
  equipementRecommandeBtu: number;
  facteurSecuritePct: number;
}

export interface HvacDuctInput {
  cfm: number;
  type_circuit?: 'residentiel_principal' | 'residentiel_branche' | 'commercial' | 'industriel';
}

export interface HvacDuctResult {
  cfm: number;
  typeCircuit: string;
  vitesseRecommandeeFpm: string;
  diametreCalculePo: number;
  diametreStandardPo: number;
  aireSectionPi2: number;
  vitesseReelleFpm: number;
  conforme: boolean;
}

export interface HvacCfmInput {
  volume_m3: number;
  type_piece?: string;
}

export interface HvacCfmResult {
  volumeM3: number;
  volumePi3: number;
  typePiece: string;
  ach: number;
  cfmRequis: number;
}

export interface HvacHrvInput {
  surface_m2: number;
  nb_chambres: number;
  nb_occupants?: number;
}

export interface HvacHrvResult {
  surfaceM2: number;
  surfacePi2: number;
  nbChambres: number;
  nbOccupants: number;
  cfmBaseSurface: number;
  cfmChambres: number;
  cfmMin622: number;
  cfmOccupants: number;
  cfmRecommande: number;
  tailleHrvRecommandeeCfm: number;
  norme: string;
}

export interface HvacCoolingInput {
  surface_vitree_m2: number;
  orientation?: 'nord' | 'sud' | 'est' | 'ouest' | 'mixte';
  shgc?: number;
  rayonnement_w_m2?: number;
  nb_occupants?: number;
  equipements_w?: number;
}

export interface HvacCoolingResult {
  surfaceVitreeM2: number;
  orientation: string;
  facteurOrientation: number;
  shgc: number;
  rayonnementWM2: number;
  gainSolaireW: number;
  gainOccupantsW: number;
  gainEquipementsW: number;
  gainTotalW: number;
  gainTotalBtuH: number;
  tonnageClimRequis: number;
}


// ============================================
// WELDING
// ============================================

export interface WeldingInput {
  type_joint?: 'bout_a_bout' | 'en_T' | 'recouvrement' | 'angle';
  epaisseur_mm?: number;
  longueur_soudure_mm?: number;
  procede?: 'SMAW' | 'GMAW' | 'FCAW' | 'GTAW' | 'SAW';
  electrode?: string;
}

export interface WeldingResult {
  typeJoint: string;
  procede: string;
  epaisseurMm: number;
  longueurSoudureMm: number;
  gorgeMm: number;
  jambeMm: number;
  volumeSoudureMm3: number;
  volumeSoudureCm3: number;
  poidsMetalDeposeG: number;
  consommationElectrodeG: number;
  facteurWaste: number;
  tauxDepotKgH: Record<string, number>;
}

export interface WeldingHeatInputInput {
  tension_v?: number;
  amperage_a?: number;
  vitesse_mm_min?: number;
}

export interface WeldingHeatInputResult {
  tensionV: number;
  amperageA: number;
  vitesseMmMin: number;
  heatInputKjMm: number;
  heatInputJMm: number;
  evaluationAcierCarbone: string;
  evaluationInoxAluminium: string;
}

export interface WeldingPreheatInput {
  carbone_pct?: number;
  manganese_pct?: number;
  chrome_pct?: number;
  molybdene_pct?: number;
  vanadium_pct?: number;
  nickel_pct?: number;
  cuivre_pct?: number;
  epaisseur_mm?: number;
}

export interface WeldingPreheatResult {
  carboneEquivalent: number;
  niveauRisqueFissuration: string;
  epaisseurMm: number;
  temperaturePrechauffageC: number;
  formule: string;
  composition: Record<string, number>;
}

export interface WeldingConsumableInput {
  poids_metal_depose_g: number;
  procede?: 'SMAW' | 'GMAW' | 'FCAW' | 'GTAW' | 'SAW';
}

export interface WeldingConsumableResult {
  procede: string;
  poidsMetalDeposeG: number;
  facteurWaste: number;
  consommationTotaleG: number;
  consommationTotaleKg: number;
  nbElectrodes332: number;
  nbBobines15kg: number;
}


// ============================================
// BENDING
// ============================================

export interface BendingInput {
  longueur_piece_mm: number;
  epaisseur_mm: number;
  angle_pliage_deg?: number;
  rayon_interieur_mm?: number;
  largeur_piece_mm?: number;
  materiau?: string;
}

export interface BendingResult {
  materiau: string;
  epaisseurMm: number;
  anglePliageDeg: number;
  rayonInterieurMm: number;
  largeurPieceMm: number;
  rOverT: number;
  kFactor: number;
  bendAllowanceMm: number;
  outsideSetbackMm: number;
  bendDeductionMm: number;
  longueurDeveloppeeMm: number;
  ouvertureVMm: number;
  tonnageRequisKn: number;
  tonnageParMetreKnM: number;
  rayonMinimumMm: number;
  risqueFissure: boolean;
  springback90Deg: number;
  utsMpa: number;
}

export interface BendingSpringbackInput {
  angle_voulu_deg?: number;
  materiau?: string;
}

export interface BendingSpringbackResult {
  materiau: string;
  angleVouluDeg: number;
  springback90Deg: number;
  springbackCalculeDeg: number;
  angleAPlierDeg: number;
}

export interface BendingMinRadiusInput {
  epaisseur_mm: number;
  materiau?: string;
}

export interface BendingMinRadiusResult {
  materiau: string;
  epaisseurMm: number;
  facteurRmin: number;
  rayonMinimumMm: number;
  rayonMinimumPo: number;
}


// ============================================
// METAL WEIGHT
// ============================================

export interface MetalWeightInput {
  forme: 'plaque' | 'tube_rond' | 'tube_carre' | 'barre_ronde' | 'barre_carree' | 'angle' | 'poutre_i' | 'profil_w' | 'profil_c';
  materiau: string;
  dimensions: Record<string, number | string>;
}

export interface MetalWeightResult {
  forme: string;
  materiau: string;
  materiauLabel?: string;
  densiteKgM3?: number;
  prixCadKg?: number;
  volumeM3?: number;
  volumeCm3?: number;
  poidsKg: number;
  poidsLb: number;
  coutEstimeCad?: number;
  section?: string;
  profil?: Record<string, number>;
  longueurM?: number;
  masseTotaleKg?: number;
  masseTotaleLb?: number;
  masseParMetreKgM?: number;
}


// ============================================
// TAXES
// ============================================

export interface TaxesInput {
  montant_ht: number;
}

export interface TaxesResult {
  montantHt: number;
  tps: number;
  tvq: number;
  totalTtc: number;
  tauxTps: number;
  tauxTvq: number;
}


// ============================================
// CHARGE TRIBUTAIRE (PAYROLL)
// ============================================

export interface ChargeTributaireInput {
  salaire_brut: number;
  type_employe?: 'regulier' | 'construction_ccq';
}

export interface ChargeTributaireResult {
  salaireBrut: number;
  typeEmploye: string;
  deductionsEmploye: {
    rrq: number;
    rqap: number;
    ae: number;
    impotFederal: number;
    impotProvincial: number;
    total: number;
  };
  chargesEmployeur: {
    rrq: number;
    rqap: number;
    ae: number;
    cnesst: number;
    fss: number;
    ccq?: number;
    total: number;
  };
  salaireNet: number;
  coutTotalEmployeur: number;
}


// ============================================
// CHARGE TRIBUTAIRE COMPLETE (STRUCTURAL)
// ============================================

export interface ChargeTributaireCompleteInput {
  type_element?: 'poutre' | 'linteau' | 'colonne';
  type_materiau?: 'bois_dimensionnel' | 'lvl';
  section?: string;
  ply_count?: number;
  portee_mm?: number;
  charge_morte_kpa?: number;
  charge_vive_kpa?: number;
  charge_neige_kpa?: number;
  largeur_tributaire_m?: number;
  type_utilisation?: 'plancher' | 'toit' | 'linteau';
}

export interface VerificationItem {
  ok: boolean;
  ratio: number;
  [key: string]: unknown;
}

export interface ChargeTributaireCompleteResult {
  titre: string;
  materiau: {
    type: string;
    grade: string;
    section: string;
    plyCount: number;
    bMm: number;
    dMm: number;
    fbMpa: number;
    fvMpa: number;
    eMpa: number;
  };
  sectionProperties: {
    iMm4: number;
    sMm3: number;
    aMm2: number;
  };
  charges: Record<string, number>;
  combinaisonsCnbc: {
    combos: Record<string, number>;
    wUlsKnM: number;
    wSlsKnM: number;
    comboGouvernante: string;
  };
  efforts: {
    porteeMm: number;
    mMaxKnm: number;
    vMaxKn: number;
    deltaMm: number;
  };
  resistanceCsaO86: {
    mrKnm: number;
    vrKn: number;
    kd: number;
    kl: number;
  };
  verification: {
    flexion: VerificationItem;
    cisaillement: VerificationItem;
    fleche: VerificationItem;
    globalOk: boolean;
    verdict: string;
  };
  svgDiagram: string;
}

export interface StructuralMaterials {
  boisDimensionnel: {
    sections: string[];
    grades: Record<string, string>;
    dimensions: Record<string, { b: number; d: number; label?: string }>;
    proprietes: Record<string, { fb: number; fv: number; E: number; name: string }>;
  };
  lvl: {
    sections: string[];
    grades: Record<string, string>;
    dimensions: Record<string, { b: number; d: number; label?: string }>;
    proprietes: Record<string, { fb: number; fv: number; E: number; name: string }>;
  };
  profilesW: string[];
  profilesC: string[];
  limitesFleche: Record<string, { ratio: number; description: string }>;
}

export interface SnowLoads {
  provinces: Record<string, Record<string, number>>;
}


// ============================================
// HISTORY
// ============================================

export interface CalculatorHistoryItem {
  id: number;
  calculatorId: string;
  subcalcId?: string;
  label: string;
  inputs: Record<string, unknown>;
  results: Record<string, unknown>;
  notes?: string;
  userId?: number;
  createdAt: string;
}

export interface HistoryCreateInput {
  calculator_id: string;
  subcalc_id?: string;
  label: string;
  inputs: Record<string, unknown>;
  results: Record<string, unknown>;
  notes?: string;
}

export interface HistoryStats {
  total: number;
  parCalculateur: { calculatorId: string; count: number }[];
  parJour30: { jour: string; count: number }[];
}


// ============================================
// AI
// ============================================

export interface AiChatRequest {
  calculator_id?: string;
  question: string;
  include_context?: boolean;
}

export interface AiChatResponse {
  response: string;
  calculatorId?: string;
}

export interface AiAnalyzeRequest {
  calculator_id: string;
  inputs: Record<string, unknown>;
  results: Record<string, unknown>;
}

export interface AiAnalyzeResult {
  scoreConformite: number;
  evaluationGlobale: string;
  pointsForts: string[];
  pointsAttention: string[];
  recommandations: string[];
  normesCitees: string[];
  risques: string[];
  optimisationsPossibles: string[];
}

export interface AiRecommendRequest {
  calculator_id: string;
  objectif: string;
  contraintes?: string;
}

export interface AiRecommendResult {
  approcheRecommandee: string;
  etapes: string[];
  materiauxRecommandes: string[];
  considerationsNormes: string[];
  coutsEstimes: string;
  alertes: string[];
}

export interface AiExplainNormRequest {
  norme: string;
  contexte?: string;
}

export interface AiExplainNormResult {
  titreOfficiel: string;
  organismeEmetteur: string;
  versionAnnee: string;
  explication: string;
  exigencesPrincipales: string[];
  exemplesApplication: string[];
  referencesCroisees: string[];
  note: string;
}

export interface AiDiagnoseRequest {
  calculator_id: string;
  probleme: string;
  symptomes?: string;
}

export interface AiDiagnoseResult {
  diagnosticPrincipal: string;
  causesProbables: string[];
  testsVerification: string[];
  solutionsRecommandees: string[];
  urgence: string;
  interventionProfessionnelle: boolean;
  coutApproximatifCad: string;
}

export interface AiOptimizeRequest {
  calculator_id: string;
  inputs_actuels: Record<string, unknown>;
  objectif_optimisation: 'cout' | 'performance' | 'ecologique' | 'delai';
}

export interface AiOptimizeResult {
  objectif: string;
  suggestions: {
    changement: string;
    impactEstime: string;
    difficulte: string;
    priorite: number;
  }[];
  economiesPotentielles: string;
  risquesChangement: string[];
  recommandationFinale: string;
}


// ============================================
// CONSTANTS & RESOURCES
// ============================================

export interface CalculatorConstants {
  metaux: Record<string, { label: string; densite: number; prixCadKg: number }>;
  profilesW: string[];
  profilesC: string[];
  dosagesBeton: Record<string, Record<string, number>>;
  classesBeton: Record<string, ConcreteClasseInfo>;
  barresArmature: Record<string, { diametreMm: number; aireMm2: number; masseKgM: number }>;
  foisonnement: Record<string, number>;
  pentesTalusCnesst: Record<string, { ratioHV: number; angleDeg: number; description: string }>;
  awgTable: { awg: string; sectionMm2: number; ampacite60: number; ampacite75: number; ampacite90: number }[];
  eclairageNiveaux: Record<string, { luxMin: number; luxRecommande: number }>;
  dfuAppareils: Record<string, { label: string; dfu: number; wsfu: number }>;
  diametresDrain: { dfuMax: number; pouces: string; mm: number }[];
  hazenWilliamsC: Record<string, number>;
  chauffeEauCapacite: Record<string, number>;
  hvacFactors: Record<string, { label: string; wattsM2: number }>;
  zonesClimatiques: Record<string, { label: string; facteur: number; tHiverC: number; tEteC: number; hdd: number }>;
  achRecommande: Record<string, number>;
  vitessesConduit: Record<string, { min: number; max: number }>;
  shgcOrientation: Record<string, number>;
  pentesToiture: Record<string, number>;
  materiauxToiture: Record<string, { label: string; coutCarre: number; coutPose: number }>;
  chargesMortesToiture: Record<string, number>;
  gouttieresCapacite: Record<string, number>;
  typesPeinture: Record<string, {
    label: string;
    solidesPct: number;
    couvertureM2L: number;
    dftUm: number;
    voc: number;
    secH: number;
    recouvrementH: number;
    completH: number;
    prixL: number;
  }>;
  facteursAbsorption: Record<string, number>;
  efficaciteTransfert: Record<string, number>;
  electrodesSmaw: Record<string, {
    label: string;
    resistanceMpa: number;
    positions: string;
    courant: string;
    penetration: string;
    usage: string;
  }>;
  filsGmaw: Record<string, { label: string; resistanceMpa: number; gaz: string; usage: string }>;
  gazProtection: Record<string, { label: string; debitLMin: string; usage: string }>;
  tauxDepot: Record<string, { min: number; max: number; efficacite: number }>;
  electrodeWaste: Record<string, number>;
  materiauxPliage: Record<string, {
    label: string;
    limiteElastMpa: number;
    resistanceMpa: number;
    moduleGpa: number;
    kFactor: number;
    rminFacteur: number;
    tonnageFacteur: number;
    springback90: number;
  }>;
  kFactorTable: { rT: number; k: number }[];
  boisDimensions: Record<string, { b: number; d: number; label: string }>;
  boisProprietes: Record<string, { fb: number; fv: number; E: number; name: string }>;
  lvlDimensions: Record<string, { b: number; d: number; label: string }>;
  lvlProprietes: Record<string, { fb: number; fv: number; E: number; name: string }>;
  limitesFleche: Record<string, { ratio: number; description: string }>;
  chargesNeige: Record<string, Record<string, number>>;
  escaliersCcq: Record<string, Record<string, number | string>>;
  essencesBoisEscalier: Record<string, { label: string; densiteKgM3: number; prixM3: number }>;
  blondelMin: number;
  blondelMax: number;
  blondelOpt: number;
  tpsRate: number;
  tvqRate: number;
  tauxDeductionsEmploye: Record<string, number>;
  tauxChargesEmployeur: Record<string, number>;
}

export interface CalculatorResources {
  calculateurs: Calculator[];
  categories: Record<string, CalculatorCategory>;
  conseils: Record<string, string[]>;
}


// ============================================
// API FUNCTIONS
// ============================================

// ---- list + resources + conversions ----

export async function listCalculators(): Promise<{ calculators: Calculator[] }> {
  const { data } = await api.get('/calculators');
  return data;
}

export async function getCalculatorConstants(): Promise<CalculatorConstants> {
  const { data } = await api.get('/calculators/constants');
  return data;
}

export async function getCalculatorResources(): Promise<CalculatorResources> {
  const { data } = await api.get('/calculators/resources');
  return data;
}

export async function getConversions(): Promise<ConversionTables> {
  const { data } = await api.get('/calculators/conversions');
  return data;
}


// ---- concrete ----

export async function calcConcrete(body: ConcreteInput): Promise<ConcreteResult> {
  const { data } = await api.post('/calculators/concrete', body);
  return data;
}

export async function calcConcreteDosage(body: ConcreteDosageInput): Promise<ConcreteDosageResult> {
  const { data } = await api.post('/calculators/concrete/dosage', body);
  return data;
}

export async function calcConcreteRebar(body: ConcreteRebarInput): Promise<ConcreteRebarResult> {
  const { data } = await api.post('/calculators/concrete/rebar', body);
  return data;
}

export async function calcConcreteCure(body: ConcreteCureInput): Promise<ConcreteCureResult> {
  const { data } = await api.post('/calculators/concrete/cure', body);
  return data;
}

export async function calcConcreteFormwork(body: ConcreteFormworkInput): Promise<ConcreteFormworkResult> {
  const { data } = await api.post('/calculators/concrete/formwork', body);
  return data;
}

export async function calcConcreteExcavation(body: ConcreteExcavationInput): Promise<ConcreteExcavationResult> {
  const { data } = await api.post('/calculators/concrete/excavation', body);
  return data;
}

export async function calcConcreteTalus(body: ConcreteTalusInput): Promise<ConcreteTalusResult> {
  const { data } = await api.post('/calculators/concrete/talus', body);
  return data;
}

export async function calcConcreteStairs(body: ConcreteStairsInput): Promise<ConcreteStairsResult> {
  const { data } = await api.post('/calculators/concrete/stairs', body);
  return data;
}


// ---- stairs ----

export async function calcStairs(body: StairInput): Promise<StairResult> {
  const { data } = await api.post('/calculators/stairs', body);
  return data;
}

export async function calcStairsMaterials(body: StairMaterialsInput): Promise<Record<string, unknown>> {
  const { data } = await api.post('/calculators/stairs/materials', body);
  return data;
}

export async function calcStairsGardeCorps(body: StairGardeCorpsInput): Promise<StairGardeCorpsResult> {
  const { data } = await api.post('/calculators/stairs/garde-corps', body);
  return data;
}


// ---- electrical ----

export async function calcElectrical(body: ElectricalInput): Promise<ElectricalResult> {
  const { data } = await api.post('/calculators/electrical', body);
  return data;
}

export async function calcElectricalResidential(body: ElectricalResidentialInput): Promise<ElectricalResidentialResult> {
  const { data } = await api.post('/calculators/electrical/residential', body);
  return data;
}

export async function calcElectricalLighting(body: ElectricalLightingInput): Promise<ElectricalLightingResult> {
  const { data } = await api.post('/calculators/electrical/lighting', body);
  return data;
}

export async function calcElectricalGrounding(body: ElectricalGroundingInput): Promise<ElectricalGroundingResult> {
  const { data } = await api.post('/calculators/electrical/grounding', body);
  return data;
}


// ---- roofing ----

export async function calcRoofing(body: RoofingInput): Promise<RoofingResult> {
  const { data } = await api.post('/calculators/roofing', body);
  return data;
}

export async function calcRoofingVentilation(body: RoofingVentilationInput): Promise<RoofingVentilationResult> {
  const { data } = await api.post('/calculators/roofing/ventilation', body);
  return data;
}

export async function calcRoofingGutters(body: RoofingGuttersInput): Promise<RoofingGuttersResult> {
  const { data } = await api.post('/calculators/roofing/gutters', body);
  return data;
}

export async function calcRoofingSnowLoad(body: RoofingSnowLoadInput): Promise<RoofingSnowLoadResult> {
  const { data } = await api.post('/calculators/roofing/snow-load', body);
  return data;
}


// ---- painting ----

export async function calcPainting(body: PaintingInput): Promise<PaintingResult> {
  const { data } = await api.post('/calculators/painting', body);
  return data;
}

export async function calcPaintingDft(body: PaintingDFTInput): Promise<PaintingDFTResult> {
  const { data } = await api.post('/calculators/painting/dft', body);
  return data;
}

export async function calcPaintingDewPoint(body: PaintingDewPointInput): Promise<PaintingDewPointResult> {
  const { data } = await api.post('/calculators/painting/dew-point', body);
  return data;
}


// ---- plumbing ----

export async function calcPlumbing(body: PlumbingInput): Promise<PlumbingResult> {
  const { data } = await api.post('/calculators/plumbing', body);
  return data;
}

export async function calcPlumbingHazenWilliams(body: PlumbingHazenWilliamsInput): Promise<PlumbingHazenWilliamsResult> {
  const { data } = await api.post('/calculators/plumbing/hazen-williams', body);
  return data;
}

export async function calcPlumbingWaterHeater(body: PlumbingWaterHeaterInput): Promise<PlumbingWaterHeaterResult> {
  const { data } = await api.post('/calculators/plumbing/water-heater', body);
  return data;
}

export async function calcPlumbingDrainSlope(body: PlumbingDrainSlopeInput): Promise<PlumbingDrainSlopeResult> {
  const { data } = await api.post('/calculators/plumbing/drain-slope', body);
  return data;
}


// ---- hvac ----

export async function calcHvac(body: HvacInput): Promise<HvacResult> {
  const { data } = await api.post('/calculators/hvac', body);
  return data;
}

export async function calcHvacDuct(body: HvacDuctInput): Promise<HvacDuctResult> {
  const { data } = await api.post('/calculators/hvac/duct', body);
  return data;
}

export async function calcHvacCfm(body: HvacCfmInput): Promise<HvacCfmResult> {
  const { data } = await api.post('/calculators/hvac/cfm', body);
  return data;
}

export async function calcHvacHrv(body: HvacHrvInput): Promise<HvacHrvResult> {
  const { data } = await api.post('/calculators/hvac/hrv', body);
  return data;
}

export async function calcHvacCooling(body: HvacCoolingInput): Promise<HvacCoolingResult> {
  const { data } = await api.post('/calculators/hvac/cooling', body);
  return data;
}


// ---- welding ----

export async function calcWelding(body: WeldingInput): Promise<WeldingResult> {
  const { data } = await api.post('/calculators/welding', body);
  return data;
}

export async function calcWeldingHeatInput(body: WeldingHeatInputInput): Promise<WeldingHeatInputResult> {
  const { data } = await api.post('/calculators/welding/heat-input', body);
  return data;
}

export async function calcWeldingPreheat(body: WeldingPreheatInput): Promise<WeldingPreheatResult> {
  const { data } = await api.post('/calculators/welding/preheat', body);
  return data;
}

export async function calcWeldingConsumable(body: WeldingConsumableInput): Promise<WeldingConsumableResult> {
  const { data } = await api.post('/calculators/welding/consumable', body);
  return data;
}


// ---- bending ----

export async function calcBending(body: BendingInput): Promise<BendingResult> {
  const { data } = await api.post('/calculators/bending', body);
  return data;
}

export async function calcBendingSpringback(body: BendingSpringbackInput): Promise<BendingSpringbackResult> {
  const { data } = await api.post('/calculators/bending/springback', body);
  return data;
}

export async function calcBendingMinRadius(body: BendingMinRadiusInput): Promise<BendingMinRadiusResult> {
  const { data } = await api.post('/calculators/bending/min-radius', body);
  return data;
}


// ---- metal weight ----

export async function calcMetalWeight(body: MetalWeightInput): Promise<MetalWeightResult> {
  const { data } = await api.post('/calculators/metal-weight', body);
  return data;
}


// ---- taxes + payroll ----

export async function calcTaxes(body: TaxesInput): Promise<TaxesResult> {
  const { data } = await api.post('/calculators/taxes', body);
  return data;
}

export async function calcChargeTributaire(body: ChargeTributaireInput): Promise<ChargeTributaireResult> {
  const { data } = await api.post('/calculators/charge-tributaire', body);
  return data;
}


// ---- structural ----

export async function calcStructural(body: ChargeTributaireCompleteInput): Promise<ChargeTributaireCompleteResult> {
  const { data } = await api.post('/calculators/charge-tributaire-complete', body);
  return data;
}

export async function getStructuralMaterials(): Promise<StructuralMaterials> {
  const { data } = await api.get('/calculators/charge-tributaire-complete/materials');
  return data;
}

export async function getSnowLoads(): Promise<SnowLoads> {
  const { data } = await api.get('/calculators/charge-tributaire-complete/snow-loads');
  return data;
}


// ---- history ----

export async function listHistory(calculatorId?: string, limit = 100): Promise<{ items: CalculatorHistoryItem[]; total: number }> {
  const params: Record<string, string | number> = { limit };
  if (calculatorId) params.calculator_id = calculatorId;
  const { data } = await api.get('/calculators/history', { params });
  return data;
}

export async function createHistory(body: HistoryCreateInput): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/calculators/history', body);
  return data;
}

export async function deleteHistoryItem(id: number): Promise<{ id: number; deleted: boolean }> {
  const { data } = await api.delete(`/calculators/history/${id}`);
  return data;
}

export async function clearHistory(calculatorId?: string): Promise<{ deleted: number }> {
  const params: Record<string, string> = {};
  if (calculatorId) params.calculator_id = calculatorId;
  const { data } = await api.delete('/calculators/history', { params });
  return data;
}

export async function getHistoryStats(): Promise<HistoryStats> {
  const { data } = await api.get('/calculators/history/stats');
  return data;
}


// ---- ai ----

export async function aiChat(body: AiChatRequest): Promise<AiChatResponse> {
  const { data } = await api.post('/calculators/ai/chat', body);
  return data;
}

export async function aiAnalyze(body: AiAnalyzeRequest): Promise<AiAnalyzeResult> {
  const { data } = await api.post('/calculators/ai/analyze', body);
  return data;
}

export async function aiRecommend(body: AiRecommendRequest): Promise<AiRecommendResult> {
  const { data } = await api.post('/calculators/ai/recommend', body);
  return data;
}

export async function aiExplainNorm(body: AiExplainNormRequest): Promise<AiExplainNormResult> {
  const { data } = await api.post('/calculators/ai/explain-norm', body);
  return data;
}

export async function aiDiagnose(body: AiDiagnoseRequest): Promise<AiDiagnoseResult> {
  const { data } = await api.post('/calculators/ai/diagnose', body);
  return data;
}

export async function aiOptimize(body: AiOptimizeRequest): Promise<AiOptimizeResult> {
  const { data } = await api.post('/calculators/ai/optimize', body);
  return data;
}
