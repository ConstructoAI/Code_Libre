/**
 * ERP React Frontend - Maintenance API Module
 * Types, Planification, Requests, Interventions, Pieces, Historique,
 * Compteurs, Alertes, Statistics, AI assistant.
 */

import api from './client';
import type {
  MaintenanceType,
  MaintenancePlanification,
  MaintenanceRequest,
  MaintenanceIntervention,
  MaintenancePiece,
  MaintenanceHistoriqueEntry,
  MaintenanceCompteur,
  MaintenanceAlerte,
  MaintenanceStats,
  MaintenanceIaChatResponse,
  MaintenanceIaJsonResponse,
  MaintenanceIaChecklistResponse,
} from '@/types';

// ============ Types ============

export async function listTypes(params?: {
  actifOnly?: boolean;
  categorie?: string;
}): Promise<{ items: MaintenanceType[] }> {
  const { data } = await api.get('/maintenance/types', { params });
  return { items: data.items ?? [] };
}

export async function createType(body: {
  nom: string;
  description?: string;
  categorie?: string;
  frequenceJours?: number;
  checklistJson?: string;
  dureeEstimeeHeures?: number;
  coutEstime?: number;
  competencesRequises?: string;
  piecesRequisesJson?: string;
  actif?: boolean;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/maintenance/types', body);
  return data;
}

export async function updateType(id: number, body: Partial<{
  nom: string;
  description: string;
  categorie: string;
  frequenceJours: number;
  checklistJson: string;
  dureeEstimeeHeures: number;
  coutEstime: number;
  competencesRequises: string;
  piecesRequisesJson: string;
  actif: boolean;
}>): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/maintenance/types/${id}`, body);
  return data;
}

export async function deleteType(id: number): Promise<{ id: number; message: string }> {
  const { data } = await api.delete(`/maintenance/types/${id}`);
  return data;
}

// ============ Planification ============

export async function listPlanification(params?: {
  actifOnly?: boolean;
  equipementType?: string;
  equipementId?: number;
}): Promise<{ items: MaintenancePlanification[] }> {
  const { data } = await api.get('/maintenance/planification', { params });
  return { items: data.items ?? [] };
}

export async function createPlanification(body: {
  equipementType?: string;
  equipementId: number;
  maintenanceTypeId?: number;
  nomPlanification: string;
  description?: string;
  frequenceType?: string;
  frequenceValeur?: number;
  derniereMaintenance?: string;
  prochaineMaintenance?: string;
  seuilAlerteJours?: number;
  priorite?: string;
  responsableId?: number;
  actif?: boolean;
  notes?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/maintenance/planification', body);
  return data;
}

export async function updatePlanification(id: number, body: Partial<{
  maintenanceTypeId: number;
  nomPlanification: string;
  description: string;
  frequenceType: string;
  frequenceValeur: number;
  derniereMaintenance: string;
  prochaineMaintenance: string;
  seuilAlerteJours: number;
  priorite: string;
  responsableId: number;
  actif: boolean;
  notes: string;
}>): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/maintenance/planification/${id}`, body);
  return data;
}

export async function deletePlanification(id: number): Promise<{ id: number; message: string }> {
  const { data } = await api.delete(`/maintenance/planification/${id}`);
  return data;
}

// Legacy alias
export async function listPreventive(): Promise<{ items: MaintenancePlanification[] }> {
  const { data } = await api.get('/maintenance/preventive');
  return { items: data.items ?? [] };
}

// ============ Requests (Demandes) ============

export async function listRequests(params?: {
  statut?: string;
  equipementType?: string;
  equipementId?: number;
  limit?: number;
}): Promise<{ items: MaintenanceRequest[] }> {
  const { data } = await api.get('/maintenance/requests', { params });
  return { items: data.items ?? [] };
}

export async function getRequest(id: number): Promise<{
  demande: MaintenanceRequest;
  pieces: MaintenancePiece[];
  interventions: MaintenanceIntervention[];
}> {
  const { data } = await api.get(`/maintenance/requests/${id}`);
  return data;
}

export async function createRequest(body: {
  titre?: string;
  description: string;
  typeDemande?: string;
  typeMaintenance?: string;
  priorite?: string;
  equipementId?: number;
  equipementType?: string;
  planificationId?: number;
  symptomes?: string;
  demandeurId?: number;
  dateSouhaitee?: string;
  coutEstime?: number;
  tempsEstimeHeures?: number;
  notes?: string;
}): Promise<{ id: number; numeroDemande: string; message: string }> {
  const { data } = await api.post('/maintenance/requests', body);
  return data;
}

export async function updateRequest(id: number, body: Partial<{
  statut: string;
  titre: string;
  description: string;
  priorite: string;
  typeMaintenance: string;
  symptomes: string;
  dateSouhaitee: string;
  datePlanifiee: string;
  dateDebut: string;
  dateFin: string;
  technicienInterneId: number;
  fournisseurExterneId: number;
  coutEstime: number;
  coutReel: number;
  tempsEstimeHeures: number;
  tempsReelHeures: number;
  causePanne: string;
  solution: string;
  notes: string;
}>): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/maintenance/requests/${id}`, body);
  return data;
}

export async function deleteRequest(id: number): Promise<{ id: number; message: string }> {
  const { data } = await api.delete(`/maintenance/requests/${id}`);
  return data;
}

// ============ Interventions ============

export async function listInterventions(params?: {
  statut?: string;
  demandeId?: number;
  technicienId?: number;
}): Promise<{ items: MaintenanceIntervention[] }> {
  const { data } = await api.get('/maintenance/interventions', { params });
  return { items: data.items ?? [] };
}

export async function getIntervention(id: number): Promise<{
  intervention: MaintenanceIntervention;
  pieces: MaintenancePiece[];
}> {
  const { data } = await api.get(`/maintenance/interventions/${id}`);
  return data;
}

export async function createIntervention(body: {
  demandeId: number;
  dateIntervention?: string;
  technicienId?: number;
  fournisseurId?: number;
  typeIntervention?: string;
  descriptionTravaux?: string;
  dureeHeures?: number;
  statut?: string;
  observations?: string;
  recommandations?: string;
  signatureTechnicien?: string;
  entrepriseEmettriceId?: number;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/maintenance/interventions', body);
  return data;
}

export async function updateIntervention(id: number, body: Partial<{
  dateIntervention: string;
  technicienId: number;
  fournisseurId: number;
  typeIntervention: string;
  descriptionTravaux: string;
  dureeHeures: number;
  statut: string;
  observations: string;
  recommandations: string;
  signatureTechnicien: string;
  entrepriseEmettriceId: number;
}>): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/maintenance/interventions/${id}`, body);
  return data;
}

export async function deleteIntervention(id: number): Promise<{ id: number; message: string }> {
  const { data } = await api.delete(`/maintenance/interventions/${id}`);
  return data;
}

// ============ Pieces ============

export async function listPieces(params?: {
  demandeId?: number;
  interventionId?: number;
}): Promise<{ items: MaintenancePiece[] }> {
  const { data } = await api.get('/maintenance/pieces', { params });
  return { items: data.items ?? [] };
}

export async function createPiece(body: {
  demandeId?: number;
  interventionId?: number;
  pieceNom: string;
  pieceReference?: string;
  inventoryItemId?: number;
  quantite?: number;
  coutUnitaire?: number;
  coutTotal?: number;
  fournisseurId?: number;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/maintenance/pieces', body);
  return data;
}

export async function deletePiece(id: number): Promise<{ id: number; message: string }> {
  const { data } = await api.delete(`/maintenance/pieces/${id}`);
  return data;
}

// ============ Historique ============

export async function listHistorique(params?: {
  equipementType?: string;
  equipementId?: number;
  limit?: number;
}): Promise<{ items: MaintenanceHistoriqueEntry[] }> {
  const { data } = await api.get('/maintenance/historique', { params });
  return { items: data.items ?? [] };
}

export async function createHistoriqueEntry(body: {
  equipementType: string;
  equipementId: number;
  demandeId?: number;
  typeEvenement: string;
  dateEvenement?: string;
  description?: string;
  cout?: number;
  dureeHeures?: number;
  technicien?: string;
  compteurHeures?: number;
  compteurKm?: number;
  notes?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/maintenance/historique', body);
  return data;
}

// ============ Compteurs ============

export async function listCompteurs(params?: {
  equipementType?: string;
  equipementId?: number;
}): Promise<{ items: MaintenanceCompteur[] }> {
  const { data } = await api.get('/maintenance/compteurs', { params });
  return { items: data.items ?? [] };
}

export async function createCompteur(body: {
  equipementType: string;
  equipementId: number;
  typeCompteur?: string;
  valeurActuelle: number;
  dateReleve?: string;
  releveParId?: number;
  notes?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/maintenance/compteurs', body);
  return data;
}

// ============ Alertes ============

export async function listAlertes(params?: {
  nonLuesOnly?: boolean;
  priorite?: string;
}): Promise<{ items: MaintenanceAlerte[] }> {
  const { data } = await api.get('/maintenance/alertes', { params });
  return { items: data.items ?? [] };
}

export async function createAlerte(body: {
  equipementType: string;
  equipementId: number;
  planificationId?: number;
  typeAlerte: string;
  priorite?: string;
  titre: string;
  message?: string;
  dateEcheance?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/maintenance/alertes', body);
  return data;
}

export async function updateAlerte(id: number, body: {
  lue?: boolean;
  traitee?: boolean;
  traiteParId?: number;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/maintenance/alertes/${id}`, body);
  return data;
}

export async function generateAlertes(): Promise<{ generated: number; message: string }> {
  const { data } = await api.post('/maintenance/alertes/generate');
  return data;
}

// ============ Statistics ============

export async function getStats(): Promise<MaintenanceStats> {
  const { data } = await api.get('/maintenance/statistics');
  return data;
}

// ============ IA ============

export async function iaChat(body: {
  question: string;
  context?: string;
}): Promise<MaintenanceIaChatResponse> {
  const { data } = await api.post('/maintenance/ia/chat', body);
  return data;
}

export async function iaDiagnose(body: {
  equipement: string;
  symptomes: string;
  historique?: string;
}): Promise<MaintenanceIaJsonResponse> {
  const { data } = await api.post('/maintenance/ia/diagnose', body);
  return data;
}

export async function iaPreventive(body: {
  equipement: string;
  utilisation: string;
  derniereMaintenance?: string;
}): Promise<MaintenanceIaJsonResponse> {
  const { data } = await api.post('/maintenance/ia/preventive', body);
  return data;
}

export async function iaAnalyzeIntervention(body: {
  demandeId?: number;
  equipement?: string;
  typeMaintenance?: string;
  description?: string;
  datePlanifiee?: string;
  dureeEstimee?: string;
  priorite?: string;
  coutEstime?: number;
}): Promise<MaintenanceIaJsonResponse> {
  const { data } = await api.post('/maintenance/ia/analyze-intervention', body);
  return data;
}

export async function iaChecklist(body: {
  typeMaintenance: string;
  equipement: string;
}): Promise<MaintenanceIaChecklistResponse> {
  const { data } = await api.post('/maintenance/ia/checklist', body);
  return data;
}

export async function iaEstimateCost(body: {
  equipement: string;
  probleme: string;
  urgence?: string;
}): Promise<MaintenanceIaJsonResponse> {
  const { data } = await api.post('/maintenance/ia/estimate-cost', body);
  return data;
}
