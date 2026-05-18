/**
 * ERP React Frontend - Subventions API Module
 * Full feature parity with Streamlit subventions_manager.py.
 * Axios client handles snake_case <-> camelCase transformation automatically.
 */

import api from './client';

// ============================================
// INTERFACES
// ============================================

export interface SubventionCategorie {
  id: number;
  code: string;
  nom: string;
  description?: string;
  ordreAffichage?: number;
}

export interface SubventionProgramme {
  id: number;
  categorieId?: number | null;
  categorieNom?: string;
  categorieCode?: string;
  code?: string;
  nom: string;
  organisme?: string;
  description?: string;
  typeAide?: string;
  niveauGouvernement?: string;
  montantMin?: number | null;
  montantMax?: number | null;
  pourcentageAide?: number | null;
  secteursAdmissibles?: string[];
  criteresEligibilite?: string;
  documentsRequis?: string;
  urlProgramme?: string;
  telephone?: string;
  email?: string;
  dateDebut?: string | null;
  dateFin?: string | null;
  difficulte?: string;
  actif?: boolean;
  scoreEligibilite?: number;
}

export interface SubventionDocument {
  id: number;
  demandeId?: number;
  nom: string;
  typeDocument?: string;
  mimeType?: string;
  taille?: number;
  statut?: string;
  uploadedAt?: string;
  uploadedBy?: number;
}

export interface SubventionDemande {
  id: number;
  programmeId?: number;
  projetId?: number | null;
  companyId?: number | null;
  referenceInterne?: string;
  referenceExterne?: string | null;
  montantDemande?: number | null;
  montantAccorde?: number | null;
  statut: string;
  dateSoumission?: string | null;
  dateDecision?: string | null;
  dateVersement?: string | null;
  notes?: string;
  motifRefus?: string | null;
  programmeNom?: string;
  organisme?: string;
  typeAide?: string;
  niveauGouvernement?: string;
  programmeMontantMax?: number | null;
  criteresEligibilite?: string;
  documentsRequis?: string;
  createdAt?: string;
  updatedAt?: string;
  documents?: SubventionDocument[];
}

export interface SubventionStats {
  totalProgrammes: number;
  totalDemandes: number;
  montantTotalDemande: number;
  montantTotalAccorde: number;
  demandesParStatut: Record<string, number>;
  programmesParCategorie: Array<{ categorie: string; nombre: number }>;
  programmesParNiveau: Array<{ niveau: string; nombre: number }>;
  programmesParType: Array<{ type: string; nombre: number }>;
}

export interface EligibilityProfile {
  taille?: string;
  secteurs: string[];
  region?: string;
  typesProjet: string[];
  budget?: number;
  urgence?: string;
}

export interface EligibilityResult {
  totalEligible: number;
  topMatches: SubventionProgramme[];
  profile: EligibilityProfile;
}

export interface AiAnalyzeEligibilityRequest {
  secteur?: string;
  taille?: string;
  region?: string;
  chiffreAffaires?: number;
  employes?: number;
  projetsPrevus: string[];
}

export interface AiProgrammeMatch {
  nom: string;
  scoreCompatibilite: number;
  raison: string;
  montantPotentiel?: number;
  difficulteObtention?: string;
  actionsRequises: string[];
}

export interface AiEligibilityResult {
  programmesRecommandes: AiProgrammeMatch[];
  programmesAEviter: Array<{ nom: string; raison: string }>;
  strategieRecommandee: string;
  montantTotalPotentiel: number | string;
  prochainesEtapes: string[];
}

export interface AiSuggestResult {
  programmesFederaux: Array<{ nom: string; organisme: string; pertinence: string; montantPossible: string }>;
  programmesProvinciaux: Array<{ nom: string; organisme: string; pertinence: string; montantPossible: string }>;
  creditsImpot: Array<{ nom: string; description: string; economiePotentielle: string }>;
  autresAides: Array<{ type: string; description: string }>;
  montantTotalPotentiel: string;
  strategieFinancement: string;
  attention: string;
}

export interface AiAnalyzeDemandeResult {
  scorePreparation: number;
  pointsForts: string[];
  pointsAAmeliorer: string[];
  documentsManquantsProbables: string[];
  conseilsRedaction: string[];
  risquesRefus: string[];
  estimationDelaiTraitement: string;
  conseilGlobal: string;
}

export interface SubventionConstants {
  statutsDemande: Record<string, { label: string; color: string }>;
  statutsDocument: Record<string, { label: string; color: string }>;
  typesAide: Record<string, { label: string; color: string }>;
  niveauxGouvernement: Record<string, { label: string; color: string }>;
  niveauxDifficulte: Record<string, { label: string; color: string }>;
  secteursActivite: string[];
  regions: string[];
  taillesEntreprise: string[];
  typesProjet: string[];
  niveauxUrgence: string[];
}

export interface SubventionOrganisme {
  nom: string;
  role: string;
  contact?: string | null;
  url?: string | null;
}

export interface PlanPme {
  titre: string;
  montantTotal: string;
  description: string;
  programmes: Array<{ programme: string; enveloppe: string; description: string }>;
}

export interface SubventionResources {
  organismes: SubventionOrganisme[];
  planPme: PlanPme;
  conseils: Array<{ titre: string; items: string[] }>;
}

export interface ProgrammeFilters {
  categorieId?: number;
  typeAide?: string;
  niveauGouvernement?: string;
  difficulte?: string;
  secteur?: string;
  search?: string;
}

// ============================================
// API FUNCTIONS — METADATA
// ============================================

export async function getConstants(): Promise<SubventionConstants> {
  const { data } = await api.get('/subventions/constants');
  return data;
}

export async function getResources(): Promise<SubventionResources> {
  const { data } = await api.get('/subventions/resources');
  return data;
}

// ============================================
// CATEGORIES
// ============================================

export async function listCategories(): Promise<SubventionCategorie[]> {
  const { data } = await api.get('/subventions/categories');
  return data.items ?? [];
}

// ============================================
// PROGRAMMES
// ============================================

export async function listProgrammes(filters?: ProgrammeFilters): Promise<SubventionProgramme[]> {
  const { data } = await api.get('/subventions/programmes', { params: filters });
  return data.items ?? [];
}

export async function getProgramme(id: number): Promise<SubventionProgramme> {
  const { data } = await api.get(`/subventions/programmes/${id}`);
  return data;
}

export async function listExpiringProgrammes(days: number = 30): Promise<SubventionProgramme[]> {
  const { data } = await api.get('/subventions/programmes/expiring', { params: { days } });
  return data.items ?? [];
}

// ============================================
// DEMANDES (Applications)
// ============================================

export async function listDemandes(statut?: string): Promise<SubventionDemande[]> {
  const { data } = await api.get('/subventions/demandes', { params: statut ? { statut } : undefined });
  return data.items ?? [];
}

export async function getDemande(id: number): Promise<SubventionDemande> {
  const { data } = await api.get(`/subventions/demandes/${id}`);
  return data;
}

export interface DemandeCreateBody {
  programmeId: number;
  projetId?: number;
  companyId?: number;
  montantDemande?: number;
  notes?: string;
}

export async function createDemande(body: DemandeCreateBody): Promise<{ id: number; referenceInterne: string; statut: string }> {
  const { data } = await api.post('/subventions/demandes', body);
  return data;
}

export interface DemandeUpdateBody {
  programmeId?: number;
  projetId?: number;
  companyId?: number;
  montantDemande?: number;
  montantAccorde?: number;
  statut?: string;
  dateSoumission?: string;
  dateDecision?: string;
  dateVersement?: string;
  notes?: string;
  motifRefus?: string;
  referenceExterne?: string;
}

export async function updateDemande(id: number, body: DemandeUpdateBody): Promise<{ id: number; updated: boolean }> {
  const { data } = await api.put(`/subventions/demandes/${id}`, body);
  return data;
}

export async function soumettreDemande(id: number): Promise<{ id: number; statut: string }> {
  const { data } = await api.post(`/subventions/demandes/${id}/soumettre`);
  return data;
}

export async function deleteDemande(id: number): Promise<{ id: number; deleted: boolean }> {
  const { data } = await api.delete(`/subventions/demandes/${id}`);
  return data;
}

// ============================================
// DOCUMENTS
// ============================================

export async function uploadDemandeDocument(
  demandeId: number,
  file: File,
  typeDocument?: string,
  onProgress?: (pct: number) => void,
): Promise<SubventionDocument> {
  const formData = new FormData();
  formData.append('file', file);
  if (typeDocument) {
    formData.append('type_document', typeDocument);
  }
  const { data } = await api.post(`/subventions/demandes/${demandeId}/documents`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });
  return data;
}

export async function downloadDocument(documentId: number): Promise<Blob> {
  const { data } = await api.get(`/subventions/documents/${documentId}/download`, {
    responseType: 'blob',
    transformResponse: [(d) => d],
  });
  return data as Blob;
}

export async function updateDocumentStatus(documentId: number, statut: string): Promise<{ id: number; statut: string }> {
  const { data } = await api.put(`/subventions/documents/${documentId}/status`, { statut });
  return data;
}

export async function deleteDocument(documentId: number): Promise<{ id: number; deleted: boolean }> {
  const { data } = await api.delete(`/subventions/documents/${documentId}`);
  return data;
}

// ============================================
// STATISTICS
// ============================================

export async function getStatistics(): Promise<SubventionStats> {
  const { data } = await api.get('/subventions/statistics');
  return data;
}

// ============================================
// ELIGIBILITY (Algorithmic)
// ============================================

export async function checkEligibility(profile: EligibilityProfile): Promise<EligibilityResult> {
  const { data } = await api.post('/subventions/eligibility-check', profile);
  return data;
}

// ============================================
// AI ASSISTANT
// ============================================

export async function aiSuggestProgrammes(
  descriptionProjet: string,
  budget?: number,
): Promise<AiSuggestResult> {
  const { data } = await api.post('/subventions/ai/suggest', { descriptionProjet, budget });
  return data;
}

export async function aiChat(question: string, context?: string): Promise<{ response: string }> {
  const { data } = await api.post('/subventions/ai/chat', { question, context });
  return data;
}

export async function aiGenerateChecklist(programmeId: number): Promise<{ programme: SubventionProgramme; checklist: string }> {
  const { data } = await api.post('/subventions/ai/checklist', { programmeId });
  return data;
}

export async function aiAnalyzeDemande(demandeId: number): Promise<AiAnalyzeDemandeResult> {
  const { data } = await api.post('/subventions/ai/analyze-demande', { demandeId });
  return data;
}

export async function aiAnalyzeEligibility(profile: AiAnalyzeEligibilityRequest): Promise<AiEligibilityResult> {
  const { data } = await api.post('/subventions/ai/analyze-eligibility', profile);
  return data;
}
