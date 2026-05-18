/**
 * ERP React Frontend - Documents (Dossiers) API Module
 */

import axios from 'axios';
import api from './client';
import { toCamelCase } from './client';

// ============================================
// Public axios instance — NO auth interceptor
// ============================================
// Used for /documents/public/* endpoints so that no JWT from the currently
// logged-in user leaks into requests that are meant to be made without auth.
// Keeps the same snake_case -> camelCase response transform as `api`.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || '';
const API_PREFIX = '/api/erp/v1';
const apiPublic = axios.create({
  baseURL: `${API_BASE}${API_PREFIX}`,
  headers: { 'Content-Type': 'application/json' },
});
apiPublic.interceptors.response.use((response) => {
  // Guard both Blob and ArrayBuffer — symmetry with api/client.ts:97-113.
  if (
    response.data &&
    !(response.data instanceof Blob) &&
    !(response.data instanceof ArrayBuffer)
  ) {
    response.data = toCamelCase(response.data);
  }
  return response;
});


export interface Document {
  id: number;
  titre: string;
  typeDossier: string;
  statut: string;
  priorite: string;
  projectId?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DocumentCreate {
  titre: string;
  typeDossier?: string;
  priorite?: string;
  projectId?: string;
  notes?: string;
}

export async function getDocuments(params: {
  page?: number; perPage?: number; statut?: string;
} = {}): Promise<{ items: Document[]; total: number; page: number; perPage: number }> {
  const { data } = await api.get('/documents', { params });
  return data;
}

export async function getDocument(id: number): Promise<Document> {
  const { data } = await api.get(`/documents/${id}`);
  return data;
}

export async function createDocument(body: DocumentCreate): Promise<{ id: number }> {
  const { data } = await api.post('/documents', body);
  return data;
}

export async function updateDocument(id: number, body: Partial<DocumentCreate>): Promise<void> {
  await api.put(`/documents/${id}`, body);
}

export async function deleteDocument(id: number): Promise<void> {
  await api.delete(`/documents/${id}`);
}

// ============================================
// ATTACHMENTS (Pieces jointes)
// ============================================

export const uploadAttachment = (
  dossierId: number,
  file: File,
  onUploadProgress?: (progressEvent: { loaded: number; total?: number }) => void,
) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post(`/documents/${dossierId}/attachments`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress,
  });
};

export const getAttachments = (dossierId: number) =>
  api.get(`/documents/${dossierId}/attachments`);

export const downloadAttachment = (dossierId: number, attId: number) =>
  api.get(`/documents/${dossierId}/attachments/${attId}/download`, {
    responseType: 'blob',
  });

/**
 * Fetch the attachment as a blob for inline preview (no Content-Disposition
 * attachment). Used by DocumentViewer to render PDFs/images/text in a modal
 * without triggering a download prompt.
 */
export const previewAttachment = (dossierId: number, attId: number) =>
  api.get(`/documents/${dossierId}/attachments/${attId}/preview`, {
    responseType: 'blob',
  });

export const deleteAttachment = (dossierId: number, attId: number) =>
  api.delete(`/documents/${dossierId}/attachments/${attId}`);

// ============================================
// ETAPES (Checklist steps)
// ============================================

export interface Etape {
  id: number;
  dossierId: number;
  titre: string;
  description?: string;
  statut: string;
  ordre: number;
  completedAt?: string;
  completedBy?: string;
  createdAt?: string;
}

export async function getDossierEtapes(dossierId: number): Promise<{ items: Etape[] }> {
  const { data } = await api.get(`/documents/${dossierId}/etapes`);
  return data;
}

export async function createDossierEtape(dossierId: number, body: { titre: string; description?: string; ordre?: number }): Promise<{ id: number }> {
  const { data } = await api.post(`/documents/${dossierId}/etapes`, body);
  return data;
}

export async function toggleEtape(dossierId: number, etapeId: number): Promise<{ id: number; statut: string }> {
  const { data } = await api.put(`/documents/${dossierId}/etapes/${etapeId}/toggle`);
  return data;
}

// ============================================
// NOTES
// ============================================

export interface NoteAttachment {
  nom: string;
  type: string;
  taille: number;
}

export interface DossierNote {
  id: number;
  dossierId: number;
  contenu: string;
  createdBy?: string;
  createdAt?: string;
  attachments?: NoteAttachment[];
  categorie?: string;
  isPinned?: boolean;
}

export async function getDossierNotes(dossierId: number): Promise<{ items: DossierNote[] }> {
  const { data } = await api.get(`/documents/${dossierId}/notes`);
  return data;
}

export async function createDossierNote(dossierId: number, body: { contenu: string }): Promise<{ id: number }> {
  const { data } = await api.post(`/documents/${dossierId}/notes`, body);
  return data;
}

export async function createDossierNoteWithFiles(dossierId: number, contenu: string, files: File[]): Promise<{ id: number }> {
  const formData = new FormData();
  formData.append('contenu', contenu);
  for (const f of files) {
    formData.append('files', f);
  }
  const { data } = await api.post(`/documents/${dossierId}/notes-with-files`, formData);
  return data;
}

export async function deleteDossierNote(dossierId: number, noteId: number): Promise<void> {
  await api.delete(`/documents/${dossierId}/notes/${noteId}`);
}

// ============================================
// LIENS (cliquables)
// ============================================
export interface DossierLien {
  id: number;
  dossierId: number;
  url: string;
  description?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export async function getDossierLiens(dossierId: number): Promise<{ items: DossierLien[] }> {
  const { data } = await api.get(`/documents/${dossierId}/liens`);
  return data;
}

export async function createDossierLien(
  dossierId: number,
  body: { url: string; description?: string },
): Promise<{ id: number }> {
  const { data } = await api.post(`/documents/${dossierId}/liens`, body);
  return data;
}

export async function updateDossierLien(
  dossierId: number,
  lienId: number,
  body: { url?: string; description?: string },
): Promise<void> {
  await api.put(`/documents/${dossierId}/liens/${lienId}`, body);
}

export async function deleteDossierLien(dossierId: number, lienId: number): Promise<void> {
  await api.delete(`/documents/${dossierId}/liens/${lienId}`);
}

export async function downloadNoteAttachment(dossierId: number, noteId: number, attIndex: number) {
  return api.get(`/documents/${dossierId}/notes/${noteId}/attachment/${attIndex}`, { responseType: 'blob' });
}

// ============================================
// NOTES — AI FEATURES
// ============================================

export interface NoteAiEnrichResult {
  contenuEnrichi: string;
  categorie: string;
  actions: string[];
  tokensInput: number;
  tokensOutput: number;
}

export interface NoteAiSummaryResult {
  resume: string;
  problemesOuverts: string[];
  actionsEnAttente: string[];
  nbNotesAnalysees: number;
  tokensInput: number;
  tokensOutput: number;
}

export async function aiEnrichNote(dossierId: number, contenu: string): Promise<NoteAiEnrichResult> {
  const { data } = await api.post(`/documents/${dossierId}/notes/ai/enrich`, { contenu });
  return data;
}

export async function aiAnalyzePhoto(dossierId: number, file: File, contexte?: string): Promise<NoteAiEnrichResult> {
  const form = new FormData();
  form.append('file', file);
  if (contexte) form.append('contexte', contexte);
  const { data } = await api.post(`/documents/${dossierId}/notes/ai/analyze-photo`, form);
  return data;
}

export async function aiSummarizeNotes(dossierId: number): Promise<NoteAiSummaryResult> {
  const { data } = await api.post(`/documents/${dossierId}/notes/ai/summary`);
  return data;
}

export async function toggleNotePin(dossierId: number, noteId: number): Promise<{ isPinned: boolean }> {
  const { data } = await api.patch(`/documents/${dossierId}/notes/${noteId}/pin`);
  return data;
}

export async function updateNoteCategorie(dossierId: number, noteId: number, categorie: string): Promise<void> {
  await api.patch(`/documents/${dossierId}/notes/${noteId}/categorie`, { categorie });
}

// ============================================
// LINKED ITEMS (Elements lies)
// ============================================

export interface LinkedItems {
  projets: Array<{ id: number; nomProjet?: string; statut?: string }>;
  devis: Array<{ id: number; numeroDevis?: string; nomProjet?: string; statut?: string }>;
  bonsTravail: Array<{ id: number; numeroDocument?: string; nom?: string; statut?: string }>;
  bonsCommande: Array<{ id: number; numero?: string; statut?: string; montantTotal?: number }>;
  factures: Array<{ id: number; numeroFacture?: string; clientNom?: string; montantTotal?: number; statut?: string }>;
}

export async function getDossierLinked(dossierId: number): Promise<LinkedItems> {
  const { data } = await api.get(`/documents/${dossierId}/linked`);
  return data;
}

// Link / Unlink items to dossier
export type LinkableType = 'devis' | 'projet' | 'bon_travail' | 'bon_commande' | 'facture' | 'demande_prix';

export interface LinkableItem {
  id: number;
  label: string;
  statut?: string;
}

export async function getLinkableItems(dossierId: number, itemType: LinkableType): Promise<{ items: LinkableItem[] }> {
  const { data } = await api.get(`/documents/${dossierId}/linkable`, { params: { itemType } });
  return data;
}

export async function linkItemToDossier(dossierId: number, itemType: LinkableType, itemId: number): Promise<void> {
  await api.post(`/documents/${dossierId}/link`, { itemType, itemId });
}

export async function unlinkItemFromDossier(dossierId: number, itemType: LinkableType, itemId: number): Promise<void> {
  await api.delete(`/documents/${dossierId}/link/${itemType}/${itemId}`);
}

// ============================================
// SHARE (Partage public par token)
// ============================================

export interface ShareLink {
  token: string;
  lien: string;
  expirationJours: number;
}

export interface ShareInfo {
  active: boolean;
  token?: string;
  lien?: string;
  createdAt?: string;
  expiresAt?: string;
  totalViews?: number;
  totalDownloads?: number;
  lastViewedAt?: string;
  lastDownloadedAt?: string;
}

export async function generateShareLink(dossierId: number): Promise<ShareLink> {
  const { data } = await api.post(`/documents/${dossierId}/share`);
  return data;
}

export async function revokeShareLink(dossierId: number): Promise<{ revoked: number }> {
  const { data } = await api.delete(`/documents/${dossierId}/share`);
  return data;
}

export async function getShareInfo(dossierId: number): Promise<ShareInfo> {
  const { data } = await api.get(`/documents/${dossierId}/share-info`);
  return data;
}

// ============================================
// PUBLIC (via token, no auth)
// ============================================

export interface PublicAttachment {
  id: number;
  originalName: string;
  contentType?: string;
  fileSize?: number;
  category?: string;
  createdAt?: string;
}

export interface PublicDossier {
  dossier: {
    id: number;
    numero?: string;
    titre?: string;
    type?: string;
    statut?: string;
  };
  attachments: PublicAttachment[];
  enterpriseName: string;
}

export async function getPublicDossier(token: string): Promise<PublicDossier> {
  const { data } = await apiPublic.get(`/documents/public/${token}`);
  return data;
}

export function publicAttachmentViewUrl(token: string, attId: number): string {
  // Full URL for iframe/anchor target. Uses the same base as apiPublic (no auth).
  const base = (apiPublic.defaults.baseURL || '').replace(/\/$/, '');
  return `${base}/documents/public/${token}/attachments/${attId}`;
}

export async function downloadPublicAttachment(token: string, attId: number) {
  return apiPublic.get(`/documents/public/${token}/attachments/${attId}/download`, {
    responseType: 'blob',
  });
}

// ============================================
// STATISTICS
// ============================================

export interface DossierStatistics {
  total: number;
  ouverts: number;
  termines: number;
  parStatut: Array<{ statut: string; count: number }>;
}

export async function getDossierStatistics(): Promise<DossierStatistics> {
  const { data } = await api.get('/documents/statistics');
  return data;
}

// ============================================
// FICHE 360
// ============================================

export interface Dossier360 {
  dossier: {
    id: number;
    numeroDossier: string;
    titre: string;
    statut: string;
    typeDossier: string;
    clientNom?: string;
    notes?: string;
    dateOuverture?: string;
    createdAt?: string;
  };
  opportunite: {
    id: number;
    nom: string;
    numeroOpportunite: string;
    statut: string;
    montantEstime?: number;
    probabilite?: number;
    source?: string;
    companyNom?: string;
    dateCloturePrevue?: string;
    createdAt?: string;
  } | null;
  devis: Array<{
    id: number;
    numeroDevis: string;
    nomProjet?: string;
    statut: string;
    totalTravaux?: number;
    investissementTotal?: number;
    createdAt?: string;
  }>;
  projets: Array<{
    id: number;
    nomProjet: string;
    statut: string;
    priorite?: string;
    budgetTotal?: number;
    dateDebutReel?: string;
    dateFinReel?: string;
    datePrevu?: string;
  }>;
  bonsTravail: Array<{
    id: number;
    numeroDocument: string;
    nom?: string;
    statut: string;
    priorite?: string;
    montantTotal?: number;
    dateEcheance?: string;
  }>;
  factures: Array<{
    id: number;
    numeroFacture: string;
    clientNom?: string;
    statut: string;
    montantHt?: number;
    montantTtc?: number;
    montantPaye?: number;
    soldeDu?: number;
    dateFacture?: string;
    dateEcheance?: string;
  }>;
  bonsCommande: Array<{
    id: number;
    numero: string;
    fournisseurNom?: string;
    statut: string;
    montantTotal?: number;
    total?: number;
    dateCommande?: string;
    dateLivraisonPrevue?: string;
  }>;
  demandesPrix: Array<{
    id: number;
    numeroDocument: string;
    nom?: string;
    statut: string;
    priorite?: string;
    montantTotal?: number;
    dateEcheance?: string;
  }>;
  pointage: Array<{
    id: number;
    employeeId: number;
    prenom?: string;
    nom?: string;
    punchIn?: string;
    punchOut?: string;
    totalHours?: number;
    totalCost?: number;
    typeTravail?: string;
    validated?: boolean;
  }>;
  comptabilite: {
    budgetTotal: number;
    totalDevis: number;
    totalFacture: number;
    totalPaye: number;
    totalSoldeDu: number;
    totalHeures: number;
    totalCoutMainOeuvre: number;
    totalAchats: number;
    totalCouts: number;
    margeEstimee: number;
    nbFactures: number;
    nbFacturesPayees: number;
    nbFacturesEnRetard: number;
    nbBonsCommande: number;
    nbDemandesPrix: number;
  };
  documents: Array<{
    id: number;
    nomFichier: string;
    categorie?: string;
    taille?: number;
    createdAt?: string;
    source?: string;
  }>;
}

export async function getDossier360(dossierId: number): Promise<Dossier360> {
  const { data } = await api.get(`/documents/${dossierId}/360`);
  return data;
}
