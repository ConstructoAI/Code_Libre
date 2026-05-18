/**
 * ERP React Frontend - Conformite RBQ/CCQ API Module
 * Full feature parity with Streamlit conformite_construction.py.
 * Axios client handles snake_case <-> camelCase transformation automatically.
 */

import api from './client';

// ============================================
// INTERFACES - Constants & Resources
// ============================================

export interface RbqCategorie {
  code: string;
  label: string;
  groupe: string;
}

export interface MetierCcq {
  nom: string;
  qualifications: string[];
}

export interface TypeAttestation {
  code: string;
  label: string;
  organisme: string;
  description: string;
}

export interface StatutLabel {
  label: string;
  color: string;
}

export interface ComplianceConstants {
  statutsLicence: Record<string, StatutLabel>;
  statutsCarteCcq: Record<string, StatutLabel>;
  statutsAttestation: Record<string, StatutLabel>;
  niveauxRisque: Record<string, StatutLabel>;
  priorites: Record<string, StatutLabel>;
  graviteNonConformite: Record<string, StatutLabel>;
  categoriesRbq: RbqCategorie[];
  metiersCcq: MetierCcq[];
  typesAttestation: TypeAttestation[];
  typesProjet: string[];
  regions: string[];
  typesTravaux: string[];
  typesProjetFormation: string[];
}

export interface Organisme {
  nom: string;
  role: string;
  contact?: string | null;
  url?: string | null;
}

export interface ConseilPratique {
  titre: string;
  items: string[];
}

export interface ComplianceResources {
  organismes: Organisme[];
  conseils: ConseilPratique[];
}

// ============================================
// INTERFACES - Licences RBQ
// ============================================

export interface RbqLicence {
  id: number;
  numeroLicence: string;
  nomEntreprise: string;
  categories: string[];
  dateEmission?: string | null;
  dateExpiration?: string | null;
  statut: string;
  cautionnement?: number | null;
  assuranceResponsabilite?: number | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface LicenceCreateBody {
  numeroLicence: string;
  nomEntreprise: string;
  categories: string[];
  dateEmission?: string;
  dateExpiration?: string;
  statut?: string;
  cautionnement?: number;
  assuranceResponsabilite?: number;
  notes?: string;
}

export interface LicenceUpdateBody {
  numeroLicence?: string;
  nomEntreprise?: string;
  categories?: string[];
  dateEmission?: string;
  dateExpiration?: string;
  statut?: string;
  cautionnement?: number;
  assuranceResponsabilite?: number;
  notes?: string;
}

// ============================================
// INTERFACES - Cartes CCQ
// ============================================

export interface CcqCarte {
  id: number;
  employeeId: number;
  numeroCarte: string;
  metierPrincipal: string;
  qualification?: string | null;
  metiersAdditionnels: string[];
  heuresTotales?: number;
  dateEmission?: string | null;
  dateRenouvellement?: string | null;
  aspConstruction?: boolean;
  statut: string;
  notes?: string | null;
  employeNom?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CarteCreateBody {
  employeeId: number;
  numeroCarte: string;
  metierPrincipal: string;
  qualification?: string;
  metiersAdditionnels?: string[];
  heuresTotales?: number;
  dateEmission?: string;
  dateRenouvellement?: string;
  aspConstruction?: boolean;
  statut?: string;
  notes?: string;
}

export interface CarteUpdateBody {
  numeroCarte?: string;
  metierPrincipal?: string;
  qualification?: string;
  metiersAdditionnels?: string[];
  heuresTotales?: number;
  dateEmission?: string;
  dateRenouvellement?: string;
  aspConstruction?: boolean;
  statut?: string;
  notes?: string;
}

// ============================================
// INTERFACES - Attestations
// ============================================

export interface Attestation {
  id: number;
  type: string;
  numero: string;
  dateEmission?: string | null;
  dateExpiration?: string | null;
  statut: string;
  fichierNom?: string | null;
  mimeType?: string | null;
  taille?: number | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AttestationCreateBody {
  type: string;
  numero: string;
  dateEmission?: string;
  dateExpiration?: string;
  statut?: string;
  notes?: string;
}

export interface AttestationUpdateBody {
  type?: string;
  numero?: string;
  dateEmission?: string;
  dateExpiration?: string;
  statut?: string;
  notes?: string;
}

// ============================================
// INTERFACES - Stats & Alertes
// ============================================

export interface ComplianceStats {
  totalLicences: number;
  licencesActives: number;
  licencesExpirees: number;
  licencesARenouveler: number;
  totalCartes: number;
  cartesActives: number;
  cartesExpirees: number;
  cartesARenouveler: number;
  totalAttestations: number;
  attestationsValides: number;
  attestationsExpirees: number;
  attestationsARenouveler: number;
  cautionnementTotal: number;
  assuranceTotale: number;
  scoreConformite: number;
  repartitionLicencesCategorie: Array<{ categorie: string; nombre: number }>;
  repartitionCartesMetier: Array<{ metier: string; nombre: number }>;
  repartitionAttestationsType: Array<{ type: string; nombre: number }>;
}

export interface Alerte {
  type: string;
  priorite: string;
  itemId: number;
  message: string;
  dateReference?: string | null;
}

// ============================================
// INTERFACES - AI Results
// ============================================

export interface AiNonConformite {
  element: string;
  gravite: string;
  action: string;
}

export interface AiRisque {
  risque: string;
  probabilite: string;
  impact: string;
}

export interface AiRenouvellementUrgent {
  element: string;
  echeance: string;
  action?: string;
  joursRestants?: number;
  cout?: number;
  priorite?: string;
}

export interface AiRecommandation {
  priorite: string;
  action: string;
  delai: string;
}

export interface AiAnalyzeResult {
  scoreConformite?: number;
  niveauRisque?: string;
  resume?: string;
  pointsConformes?: string[];
  nonConformites?: AiNonConformite[];
  risquesIdentifies?: AiRisque[];
  renouvellementsUrgents?: AiRenouvellementUrgent[];
  recommandations?: AiRecommandation[];
  estimationCoutsMiseConformite?: string;
}

export interface AiVerifyProjectResult {
  licencesRbqRequises?: Array<{ categorie: string; description: string; obligatoire: boolean }>;
  metiersCcqRequis?: Array<{ metier: string; nombreEstime: number; qualification: string }>;
  permisRequis?: Array<{ type: string; organisme: string; description: string }>;
  attestationsRequises?: Array<{ type: string; organisme: string; validite: string }>;
  cautionnementMinimum?: number;
  assuranceResponsabiliteMinimum?: number;
  ratioCompagnonApprenti?: string;
  exigencesSecurite?: string[];
  inspectionsPrevues?: string[];
  estimationDelaiConformite?: string;
  alertes?: string[];
}

export interface AiSearchRegulationsResult {
  interpretation?: string;
  resultats?: Array<{
    titre: string;
    source: string;
    reference: string;
    resume: string;
    lienOfficiel?: string;
  }>;
  reponseDirecte?: string;
  pointsImportants?: string[];
  misesEnGarde?: string[];
  ressourcesComplementaires?: string[];
}

export interface AiPredictRenewalsResult {
  calendrier12Mois?: Array<{
    mois: string;
    elements: string[];
    coutEstime: number;
    actionsRequises: string[];
  }>;
  renouvellementsUrgents?: AiRenouvellementUrgent[];
  coutAnnuelEstime?: number;
  budgetRecommandeMensuel?: number;
  risquesExpiration?: Array<{ element: string; consequence: string }>;
  recommandationsPlanification?: string[];
}

export interface AiGenerateRapportResult {
  titreRapport?: string;
  dateGeneration?: string;
  periodeCouverte?: string;
  resumeExecutif?: string;
  scoreGlobal?: number;
  evaluationScore?: string;
  conformiteRbq?: {
    statut?: string;
    pointsForts?: string[];
    pointsAmelioration?: string[];
    actionsRequises?: string[];
  };
  conformiteCcq?: {
    statut?: string;
    ratioCompagnonApprenti?: string;
    pointsForts?: string[];
    pointsAmelioration?: string[];
  };
  attestations?: {
    statut?: string;
    details?: string[];
  };
  risquesIdentifies?: Array<{ risque: string; niveau: string; mitigation: string }>;
  planAction?: Array<{ action: string; responsable: string; echeance: string; priorite: string }>;
  conclusion?: string;
  prochaineRevision?: string;
}

export interface AiFormation {
  titre: string;
  organisme: string;
  duree: string;
  coutEstime: number;
  publicCible: string[];
  priorite: string;
  benefices: string[];
}

export interface AiRecommendFormationsResult {
  analyseCompetences?: {
    forces?: string[];
    lacunes?: string[];
    opportunites?: string[];
  };
  formationsRecommandees?: AiFormation[];
  certificationsSuggerees?: Array<{ certification: string; organisme: string; avantages: string }>;
  planDeveloppement?: Array<{ trimestre: string; formations: string[]; objectif: string }>;
  budgetFormationAnnuelSuggere?: number;
  retourInvestissement?: string;
}

// ============================================
// API FUNCTIONS - Metadata
// ============================================

export async function getConstants(): Promise<ComplianceConstants> {
  const { data } = await api.get('/conformite/constants');
  return data;
}

export async function getResources(): Promise<ComplianceResources> {
  const { data } = await api.get('/conformite/resources');
  return data;
}

// ============================================
// API FUNCTIONS - Licences RBQ
// ============================================

export async function listLicences(params?: {
  statut?: string;
  categorie?: string;
  search?: string;
}): Promise<RbqLicence[]> {
  const { data } = await api.get('/conformite/licences', { params });
  return data.items ?? [];
}

export async function listExpiringLicences(days: number = 60): Promise<RbqLicence[]> {
  const { data } = await api.get('/conformite/licences/expiring', { params: { days } });
  return data.items ?? [];
}

export async function getLicence(id: number): Promise<RbqLicence> {
  const { data } = await api.get(`/conformite/licences/${id}`);
  return data;
}

export async function createLicence(body: LicenceCreateBody): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/conformite/licences', body);
  return data;
}

export async function updateLicence(id: number, body: LicenceUpdateBody): Promise<{ id: number; updated: boolean }> {
  const { data } = await api.put(`/conformite/licences/${id}`, body);
  return data;
}

export async function deleteLicence(id: number): Promise<{ id: number; deleted: boolean }> {
  const { data } = await api.delete(`/conformite/licences/${id}`);
  return data;
}

// ============================================
// API FUNCTIONS - Cartes CCQ
// ============================================

export async function listCartes(params?: {
  statut?: string;
  metier?: string;
  search?: string;
}): Promise<CcqCarte[]> {
  const { data } = await api.get('/conformite/cartes', { params });
  return data.items ?? [];
}

export async function listExpiringCartes(days: number = 60): Promise<CcqCarte[]> {
  const { data } = await api.get('/conformite/cartes/expiring', { params: { days } });
  return data.items ?? [];
}

export async function getCarte(id: number): Promise<CcqCarte> {
  const { data } = await api.get(`/conformite/cartes/${id}`);
  return data;
}

export async function createCarte(body: CarteCreateBody): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/conformite/cartes', body);
  return data;
}

export async function updateCarte(id: number, body: CarteUpdateBody): Promise<{ id: number; updated: boolean }> {
  const { data } = await api.put(`/conformite/cartes/${id}`, body);
  return data;
}

export async function deleteCarte(id: number): Promise<{ id: number; deleted: boolean }> {
  const { data } = await api.delete(`/conformite/cartes/${id}`);
  return data;
}

// ============================================
// API FUNCTIONS - Attestations
// ============================================

export async function listAttestations(params?: {
  statut?: string;
  type?: string;
}): Promise<Attestation[]> {
  const { data } = await api.get('/conformite/attestations', { params });
  return data.items ?? [];
}

export async function listExpiringAttestations(days: number = 30): Promise<Attestation[]> {
  const { data } = await api.get('/conformite/attestations/expiring', { params: { days } });
  return data.items ?? [];
}

export async function getAttestation(id: number): Promise<Attestation> {
  const { data } = await api.get(`/conformite/attestations/${id}`);
  return data;
}

export async function createAttestation(body: AttestationCreateBody): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/conformite/attestations', body);
  return data;
}

export async function updateAttestation(
  id: number,
  body: AttestationUpdateBody,
): Promise<{ id: number; updated: boolean }> {
  const { data } = await api.put(`/conformite/attestations/${id}`, body);
  return data;
}

export async function deleteAttestation(id: number): Promise<{ id: number; deleted: boolean }> {
  const { data } = await api.delete(`/conformite/attestations/${id}`);
  return data;
}

export async function uploadAttestationFile(
  attestationId: number,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ id: number; fichierNom: string; mimeType: string; taille: number; uploaded: boolean }> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post(`/conformite/attestations/${attestationId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });
  return data;
}

export async function downloadAttestationFile(attestationId: number): Promise<Blob> {
  const { data } = await api.get(`/conformite/attestations/${attestationId}/download`, {
    responseType: 'blob',
    transformResponse: [(d) => d],
  });
  return data as Blob;
}

// ============================================
// API FUNCTIONS - Statistics & Alertes
// ============================================

export async function getStatistics(): Promise<ComplianceStats> {
  const { data } = await api.get('/conformite/statistics');
  return data;
}

export async function listAlertes(): Promise<Alerte[]> {
  const { data } = await api.get('/conformite/alertes');
  return data.items ?? [];
}

// ============================================
// API FUNCTIONS - AI Assistant
// ============================================

export async function aiAnalyzeConformite(): Promise<AiAnalyzeResult> {
  const { data } = await api.post('/conformite/ai/analyze');
  return data;
}

export async function aiChat(question: string, includeContext: boolean = true): Promise<{ response: string }> {
  const { data } = await api.post('/conformite/ai/chat', { question, includeContext });
  return data;
}

export async function aiVerifyProject(payload: {
  typeProjet: string;
  valeur: number;
  region: string;
  travaux: string[];
}): Promise<AiVerifyProjectResult> {
  const { data } = await api.post('/conformite/ai/verify-project', payload);
  return data;
}

export async function aiSearchRegulations(query: string): Promise<AiSearchRegulationsResult> {
  const { data } = await api.post('/conformite/ai/search-regulations', { query });
  return data;
}

export async function aiPredictRenewals(): Promise<AiPredictRenewalsResult> {
  const { data } = await api.post('/conformite/ai/predict-renewals');
  return data;
}

export async function aiGenerateRapport(): Promise<AiGenerateRapportResult> {
  const { data } = await api.post('/conformite/ai/generate-rapport');
  return data;
}

export async function aiRecommendFormations(projetsPrevus: string[] = []): Promise<AiRecommendFormationsResult> {
  const { data } = await api.post('/conformite/ai/recommend-formations', { projetsPrevus });
  return data;
}
