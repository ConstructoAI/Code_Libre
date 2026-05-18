import api from './client';

// ============================================================================
// Interfaces - Core Entities
// ============================================================================

export interface Terrain {
  id: number;
  numeroDossier: string;
  statut: string;
  adresse: string;
  ville: string;
  codePostal: string;
  superficieM2: number;
  zonage: string;
  proprietaireNom: string;
  proprietaireContact: string;
  prixDemande: number;
  prixOffre: number;
  evaluationMunicipale: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
  // Enriched fields
  numeroLot: string;
  numeroCadastre: string;
  superficiePi2: number;
  potentielConstruction: string;
  prixFinal: number;
  dateOffre: string | null;
  dateAcquisition: string | null;
  evaluationMarchande: number;
  scoreFaisabilite: number;
  servitudes: string;
  contraintesEnvironnementales: string;
  accesServices: string;
  certificatLocalisation: boolean;
  etudeSol: boolean;
  permisPreliminaire: boolean;
}

export interface ProjetImmo {
  id: number;
  numeroProjet: string;
  nomProjet: string;
  statut: string;
  terrainId: number | null;
  typeProjet: string;
  nombreLogements: number;
  budgetTotal: number;
  coutTerrain: number;
  coutConstruction: number;
  revenusVentesEstimes: number;
  roiEstimePct: number;
  dateDebutPlanifiee: string | null;
  dateFinPlanifiee: string | null;
  description: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  unitesCount?: number;
}

export interface Financement {
  id: number;
  projetId: number;
  numeroFinancement: string;
  statut: string;
  banque: string;
  typePret: string;
  montantDemande: number;
  montantApprouve: number;
  tauxInteretAnnuel: number;
  dureeAmortissementAnnees: number;
  miseDeFondsPct: number;
  miseDeFondsMontant: number;
  dateDemande: string | null;
  dateApprobation: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  // Enriched fields
  conseillerNom: string;
  conseillerContact: string;
  tauxType: string;
  frequencePaiement: string;
  garantiesRequises: string;
  assurancePretSchl: boolean;
  primeSchlPct: number;
  primeSchlMontant: number;
  ratioPretValeurPct: number;
  ratioCouvertureDette: number;
  testResistanceTaux: number;
  financementProgressif: boolean;
  calendrierDeblocages: string;
  interetsIntercalairesEstimes: number;
  fraisEvaluation: number;
  fraisNotaire: number;
  fraisOuverture: number;
  autresFrais: number;
  dateDeblocageInitial: string | null;
  dateEcheance: string | null;
}

export interface Unite {
  id: number;
  projetId: number;
  numeroUnite: string;
  typeUnite: string;
  superficieM2: number;
  nombreChambres: number;
  nombreSallesBain: number;
  etage: number;
  prixVente: number;
  loyerMensuel: number;
  statut: string;
  acheteurNom: string;
  dateVenteFinale: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  // Enriched fields
  sousType: string;
  superficiePi2: number;
  orientation: string;
  acheteurContact: string;
  datePromesseAchat: string | null;
  locataireNom: string;
  dateDebutBail: string | null;
  dureeBailMois: number;
  equipements: string;
  finitionsSpeciales: string;
}

export interface Inspection {
  id: number;
  projetId: number;
  typeInspection: string;
  datePlanifiee: string | null;
  dateRealisee: string | null;
  inspecteurNom: string;
  statut: string;
  resultat: string;
  nombreDeficiences: number;
  notes: string;
  // Enriched fields
  phaseId: number;
  uniteId: number;
  categorie: string;
  inspecteurOrganisme: string;
  inspecteurNumeroPermis: string;
  inspecteurContact: string;
  scoreConformite: number;
  deficiencesMineures: number;
  deficiencesMajeures: number;
  deficiencesCritiques: number;
  listeDeficiences: string;
  correctionsRequises: boolean;
  dateLimiteCorrections: string | null;
  correctionsEffectuees: boolean;
  dateCorrections: string | null;
  reinspectionRequise: boolean;
  dateReinspection: string | null;
  reinspectionReussie: boolean;
  rapportInspection: string;
  photosJointes: boolean;
  certificatEmis: boolean;
  numeroCertificat: string;
  conformeCnb: boolean;
  conformeCce: boolean;
  conformeCsst: boolean;
  conformeMunicipal: boolean;
  coutInspection: number;
  coutCorrections: number;
  createdAt: string;
  updatedAt: string;
}

export interface Paiement {
  id: number;
  projetId: number;
  typePaiement: string;
  categorie: string;
  montant: number;
  description: string;
  beneficiaire: string;
  datePaiement: string | null;
  statut: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Interfaces - New Entities
// ============================================================================

export interface Deblocage {
  id: number;
  financementId: number;
  numeroDeblocage: string;
  etapeConstruction: string;
  pourcentageEtape: number;
  montantPrevu: number;
  montantReel: number;
  statut: string;
  datePrevue: string | null;
  dateDemande: string | null;
  dateApprobation: string | null;
  dateDeblocage: string | null;
  inspectionRequise: boolean;
  inspectionEffectuee: boolean;
  dateInspection: string | null;
  rapportInspection: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface PhaseConstruction {
  id: number;
  projetId: number;
  numeroPhase: number;
  nomPhase: string;
  statut: string;
  pourcentageCompletion: number;
  dateDebutPrevue: string | null;
  dateFinPrevue: string | null;
  dateDebutReelle: string | null;
  dateFinReelle: string | null;
  dureePrevueJours: number;
  dureeReelleJours: number;
  budgetPrevu: number;
  coutReel: number;
  varianceBudget: number;
  entrepreneurId: number;
  superviseurId: number;
  inspectionRequise: boolean;
  inspectionApprouvee: boolean;
  dateInspection: string | null;
  conformeCnb: boolean;
  materiauxCommandes: boolean;
  materiauxRecus: boolean;
  retardsJours: number;
  raisonRetard: string;
  problemesRencontres: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Commercialisation {
  id: number;
  projetId: number;
  strategieVente: string;
  prixMoyenVente: number;
  loyerMoyen: number;
  objectifPreVentesPct: number;
  tauxPreVentesActuelPct: number;
  nombreUnitesVendues: number;
  nombreUnitesLouees: number;
  budgetMarketing: number;
  coutMarketingReel: number;
  siteWeb: string;
  courtierNom: string;
  commissionCourtierPct: number;
  brochurePrete: boolean;
  plansVentePrets: boolean;
  maquette3d: boolean;
  dateLancement: string | null;
  dateJourneePortesOuvertes: string | null;
  statut: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Livraison {
  id: number;
  uniteId: number;
  projetId: number;
  numeroLivraison: string;
  inspectionPreLivraison: boolean;
  dateInspectionPreLivraison: string | null;
  listeDeficiences: string;
  deficiencesCorrigees: boolean;
  dateLivraisonPrevue: string | null;
  dateLivraisonReelle: string | null;
  clesRemises: boolean;
  beneficiaireNom: string;
  beneficiaireType: string;
  acteVenteSigne: boolean;
  bailSigne: boolean;
  manuelCopropriete: boolean;
  plansConformes: boolean;
  certificatConformite: boolean;
  garantieLegaleViceCache: boolean;
  garantieGcr: boolean;
  dureeGarantieMois: number;
  dateFinGarantie: string | null;
  formulaireSatisfactionRemis: boolean;
  noteSatisfaction: number;
  commentairesClient: string;
  reclamationsOuvertes: number;
  inspectionReussie: boolean;
  statut: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentImmo {
  id: number;
  projetId: number;
  categorie: string;
  nomDocument: string;
  description: string;
  cheminFichier: string;
  typeFichier: string;
  tailleKb: number;
  statut: string;
  confidentiel: boolean;
  dateDocument: string | null;
  dateExpiration: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Interfaces - Dashboard & Existing Calculators
// ============================================================================

export interface ImmoDashboard {
  totalTerrains: number;
  terrainsByStatus: { statut: string; count: number }[];
  totalProjets: number;
  projetsByStatus: { statut: string; count: number }[];
  totalFinancementDemande: number;
  totalFinancementApprouve: number;
  totalUnites: number;
  unitesVendues: number;
  unitesDisponibles: number;
}

export interface MensualiteResult {
  mensualite: number;
  coutTotal: number;
  interetsTotaux: number;
}

// ============================================================================
// Interfaces - Calculator Results
// ============================================================================

export interface AmortissementResult {
  tableau: {
    periode: number;
    paiement: number;
    capital: number;
    interet: number;
    solde: number;
  }[];
  resume: {
    mensualite: number;
    totalInterets: number;
    coutTotal: number;
  };
}

export interface InteretsIntercalairesResult {
  totalInterets: number;
  detail: {
    mois: number;
    deblocage: number;
    soldeCumule: number;
    interet: number;
  }[];
}

export interface PrimeSCHLResult {
  ratioLtv: number;
  primePct: number;
  primeMontant: number;
  pretTotal: number;
}

export interface RoiResult {
  roiPct: number;
  beneficeNetAnnuel: number;
  periodeRecuperation: number | null;
}

export interface CoutTotalResult {
  mensualite: number;
  coutTotal: number;
  interetsTotaux: number;
  capital: number;
}

// ============================================================================
// Interfaces - AI Results
// ============================================================================

export interface IaAnalyseResult {
  analysis: unknown;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    model: string;
  };
}

export interface IaChatResult {
  response: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    model: string;
  };
}

export interface IaRapportResult {
  rapport: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    model: string;
  };
}

export interface IaOptimisationResult {
  recommendation: unknown;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    model: string;
  };
}

// ============================================================================
// Dashboard
// ============================================================================

export async function getDashboard(): Promise<ImmoDashboard> {
  const { data } = await api.get('/immobilier/dashboard');
  return data;
}

// ============================================================================
// Terrains CRUD
// ============================================================================

export async function listTerrains(
  params?: { page?: number; perPage?: number; search?: string; statut?: string },
): Promise<{ items: Terrain[]; total: number }> {
  const { data } = await api.get('/immobilier/terrains', { params });
  return data;
}

export async function getTerrain(id: number): Promise<Terrain> {
  const { data } = await api.get(`/immobilier/terrains/${id}`);
  return data;
}

export async function createTerrain(body: Partial<Terrain>): Promise<{ id: number }> {
  const { data } = await api.post('/immobilier/terrains', body);
  return data;
}

export async function updateTerrain(id: number, body: Partial<Terrain>): Promise<void> {
  await api.put(`/immobilier/terrains/${id}`, body);
}

export async function deleteTerrain(id: number): Promise<void> {
  await api.delete(`/immobilier/terrains/${id}`);
}

// ============================================================================
// Projets CRUD
// ============================================================================

export async function listProjets(
  params?: { page?: number; perPage?: number; search?: string; statut?: string },
): Promise<{ items: ProjetImmo[]; total: number }> {
  const { data } = await api.get('/immobilier/projets', { params });
  return data;
}

export async function getProjet(id: number): Promise<ProjetImmo> {
  const { data } = await api.get(`/immobilier/projets/${id}`);
  return data;
}

export async function createProjet(body: Partial<ProjetImmo>): Promise<{ id: number }> {
  const { data } = await api.post('/immobilier/projets', body);
  return data;
}

export async function updateProjet(id: number, body: Partial<ProjetImmo>): Promise<void> {
  await api.put(`/immobilier/projets/${id}`, body);
}

export async function deleteProjet(id: number): Promise<void> {
  await api.delete(`/immobilier/projets/${id}`);
}

// ============================================================================
// Financement CRUD
// ============================================================================

export async function listFinancements(
  params?: { projetId?: number },
): Promise<{ items: Financement[]; total: number }> {
  const { data } = await api.get('/immobilier/financements', { params });
  return data;
}

export async function getFinancement(id: number): Promise<Financement> {
  const { data } = await api.get(`/immobilier/financements/${id}`);
  return data;
}

export async function createFinancement(body: Partial<Financement>): Promise<{ id: number }> {
  const { data } = await api.post('/immobilier/financements', body);
  return data;
}

export async function updateFinancement(id: number, body: Partial<Financement>): Promise<void> {
  await api.put(`/immobilier/financements/${id}`, body);
}

export async function deleteFinancement(id: number): Promise<void> {
  await api.delete(`/immobilier/financements/${id}`);
}

// ============================================================================
// Unites CRUD
// ============================================================================

export async function listUnites(
  projetId: number,
): Promise<{ items: Unite[]; total: number }> {
  const { data } = await api.get('/immobilier/unites', { params: { projetId } });
  return data;
}

export async function createUnite(body: Partial<Unite>): Promise<{ id: number }> {
  const { data } = await api.post('/immobilier/unites', body);
  return data;
}

export async function updateUnite(id: number, body: Partial<Unite>): Promise<void> {
  await api.put(`/immobilier/unites/${id}`, body);
}

export async function deleteUnite(id: number): Promise<void> {
  await api.delete(`/immobilier/unites/${id}`);
}

// ============================================================================
// Inspections CRUD
// ============================================================================

export async function listInspections(
  params?: { projetId?: number },
): Promise<{ items: Inspection[]; total: number }> {
  const { data } = await api.get('/immobilier/inspections', { params });
  return data;
}

export async function createInspection(body: Partial<Inspection>): Promise<{ id: number }> {
  const { data } = await api.post('/immobilier/inspections', body);
  return data;
}

export async function updateInspection(id: number, body: Partial<Inspection>): Promise<void> {
  await api.put(`/immobilier/inspections/${id}`, body);
}

// ============================================================================
// Paiements
// ============================================================================

export async function listPaiements(
  projetId: number,
): Promise<{ items: Paiement[]; total: number }> {
  const { data } = await api.get('/immobilier/paiements', { params: { projetId } });
  return data;
}

export async function createPaiement(body: Partial<Paiement>): Promise<{ id: number }> {
  const { data } = await api.post('/immobilier/paiements', body);
  return data;
}

// ============================================================================
// Deblocages CRUD
// ============================================================================

export async function listDeblocages(
  params?: { financementId?: number; page?: number; perPage?: number; search?: string },
): Promise<{ items: Deblocage[]; total: number }> {
  const { data } = await api.get('/immobilier/deblocages', { params });
  return data;
}

export async function getDeblocage(id: number): Promise<Deblocage> {
  const { data } = await api.get(`/immobilier/deblocages/${id}`);
  return data;
}

export async function createDeblocage(body: Partial<Deblocage>): Promise<{ id: number }> {
  const { data } = await api.post('/immobilier/deblocages', body);
  return data;
}

export async function updateDeblocage(id: number, body: Partial<Deblocage>): Promise<void> {
  await api.put(`/immobilier/deblocages/${id}`, body);
}

export async function deleteDeblocage(id: number): Promise<void> {
  await api.delete(`/immobilier/deblocages/${id}`);
}

export async function genererDeblocagesAuto(
  financementId: number,
  montantTotal: number,
): Promise<{ message: string; ids: number[] }> {
  const { data } = await api.post('/immobilier/deblocages/generer-auto', null, {
    params: { financementId, montantTotal },
  });
  return data;
}

// ============================================================================
// Phases de Construction CRUD
// ============================================================================

export async function listPhases(
  params?: { projetId?: number; page?: number; perPage?: number },
): Promise<{ items: PhaseConstruction[]; total: number }> {
  const { data } = await api.get('/immobilier/phases', { params });
  return data;
}

export async function getPhase(id: number): Promise<PhaseConstruction> {
  const { data } = await api.get(`/immobilier/phases/${id}`);
  return data;
}

export async function createPhase(body: Partial<PhaseConstruction>): Promise<{ id: number }> {
  const { data } = await api.post('/immobilier/phases', body);
  return data;
}

export async function updatePhase(id: number, body: Partial<PhaseConstruction>): Promise<void> {
  await api.put(`/immobilier/phases/${id}`, body);
}

export async function deletePhase(id: number): Promise<void> {
  await api.delete(`/immobilier/phases/${id}`);
}

export async function listPhaseTypes(): Promise<{ phases: string[] }> {
  const { data } = await api.get('/immobilier/phases/types');
  return data;
}

// ============================================================================
// Commercialisation CRUD
// ============================================================================

export async function listCommercialisations(
  params?: { projetId?: number; page?: number; perPage?: number },
): Promise<{ items: Commercialisation[]; total: number }> {
  const { data } = await api.get('/immobilier/commercialisation', { params });
  return data;
}

export async function getCommercialisation(id: number): Promise<Commercialisation> {
  const { data } = await api.get(`/immobilier/commercialisation/${id}`);
  return data;
}

export async function createCommercialisation(body: Partial<Commercialisation>): Promise<{ id: number }> {
  const { data } = await api.post('/immobilier/commercialisation', body);
  return data;
}

export async function updateCommercialisation(id: number, body: Partial<Commercialisation>): Promise<void> {
  await api.put(`/immobilier/commercialisation/${id}`, body);
}

export async function deleteCommercialisation(id: number): Promise<void> {
  await api.delete(`/immobilier/commercialisation/${id}`);
}

// ============================================================================
// Livraisons CRUD
// ============================================================================

export async function listLivraisons(
  params?: { projetId?: number; uniteId?: number; page?: number; perPage?: number },
): Promise<{ items: Livraison[]; total: number }> {
  const { data } = await api.get('/immobilier/livraisons', { params });
  return data;
}

export async function getLivraison(id: number): Promise<Livraison> {
  const { data } = await api.get(`/immobilier/livraisons/${id}`);
  return data;
}

export async function createLivraison(body: Partial<Livraison>): Promise<{ id: number }> {
  const { data } = await api.post('/immobilier/livraisons', body);
  return data;
}

export async function updateLivraison(id: number, body: Partial<Livraison>): Promise<void> {
  await api.put(`/immobilier/livraisons/${id}`, body);
}

export async function deleteLivraison(id: number): Promise<void> {
  await api.delete(`/immobilier/livraisons/${id}`);
}

// ============================================================================
// Documents CRUD
// ============================================================================

export async function listDocuments(
  params?: { projetId?: number; search?: string; page?: number; perPage?: number },
): Promise<{ items: DocumentImmo[]; total: number }> {
  const { data } = await api.get('/immobilier/documents', { params });
  return data;
}

export async function getDocument(id: number): Promise<DocumentImmo> {
  const { data } = await api.get(`/immobilier/documents/${id}`);
  return data;
}

export async function createDocument(body: Partial<DocumentImmo>): Promise<{ id: number }> {
  const { data } = await api.post('/immobilier/documents', body);
  return data;
}

export async function deleteDocument(id: number): Promise<void> {
  await api.delete(`/immobilier/documents/${id}`);
}

// ============================================================================
// Calculators
// ============================================================================

export async function calculerMensualite(
  body: { capital: number; tauxAnnuel: number; dureeAnnees: number },
): Promise<MensualiteResult> {
  const { data } = await api.post('/immobilier/calculer-mensualite', body);
  return data;
}

export async function calculerAmortissement(
  body: { capital: number; tauxAnnuel: number; dureeAnnees: number; frequence?: string },
): Promise<AmortissementResult> {
  const { data } = await api.post('/immobilier/calculer-amortissement', body);
  return data;
}

export async function calculerInteretsIntercalaires(
  body: { montantEmprunte: number; tauxAnnuel: number; dureeConstructionMois: number },
): Promise<InteretsIntercalairesResult> {
  const { data } = await api.post('/immobilier/calculer-interets-intercalaires', body);
  return data;
}

export async function calculerPrimeSCHL(
  body: { montantPret: number; valeurPropriete: number },
): Promise<PrimeSCHLResult> {
  const { data } = await api.post('/immobilier/calculer-prime-schl', body);
  return data;
}

export async function calculerRoi(
  body: { investissementTotal: number; revenusAnnuels: number; depensesAnnuelles: number; dureeAnnees?: number },
): Promise<RoiResult> {
  const { data } = await api.post('/immobilier/calculer-roi', body);
  return data;
}

export async function calculerCoutTotal(
  body: { capital: number; tauxAnnuel: number; dureeAnnees: number },
): Promise<CoutTotalResult> {
  const { data } = await api.post('/immobilier/calculer-cout-total', body);
  return data;
}

// ============================================================================
// AI Endpoints
// ============================================================================

export async function analyserProjet(projetId: number): Promise<IaAnalyseResult> {
  const { data } = await api.post('/immobilier/ia/analyser-projet', null, {
    params: { projetId },
  });
  return data;
}

export async function chatImmobilier(
  body: { question: string; context?: string },
): Promise<IaChatResult> {
  const { data } = await api.post('/immobilier/ia/chat', body);
  return data;
}

export async function rapportFinancement(projetId: number): Promise<IaRapportResult> {
  const { data } = await api.post('/immobilier/ia/rapport-financement', null, {
    params: { projetId },
  });
  return data;
}

export async function optimiserFinancement(
  body: { coutTotalProjet: number; revenusAnnuels: number; nombreUnites: number; typeProjet?: string },
): Promise<IaOptimisationResult> {
  const { data } = await api.post('/immobilier/ia/optimiser-financement', body);
  return data;
}
