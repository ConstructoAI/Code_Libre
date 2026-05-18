/**
 * ERP React Frontend - CRM / Ventes API Module
 * Opportunities, interactions, pipeline, and statistics.
 */

import api from './client';

// ============ Interfaces ============

export interface Opportunity {
  id: number;
  nom: string;
  numeroOpportunite?: string;
  companyId?: number;
  contactId?: number;
  montantEstime?: number;
  probabilite?: number;
  statut: string;
  dateCloturePrevue?: string;
  notes?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  companyNom?: string;
  contactPrenom?: string;
  contactNom?: string;
  devisId?: number;
  projetId?: number;
  dossierId?: number;
  convertedAt?: string;
  interactions?: Interaction[];
  activities?: Activity[];
}

export interface OpportunityCreate {
  nom: string;
  companyId?: number;
  contactId?: number;
  clientNomDirect?: string;
  montantEstime?: number;
  probabilite?: number;
  statut?: string;
  dateCloturePrevue?: string;
  notes?: string;
  source?: string;
  poClient?: string;
  priorite?: string;
  description?: string;
  dateSoumission?: string;
  dateDebutPrevu?: string;
  dateFinPrevue?: string;
}

export interface Interaction {
  id: number;
  companyId?: number;
  contactId?: number;
  opportunityId?: number;
  typeInteraction: string;
  resume: string;
  details?: string;
  dateInteraction?: string;
  suiviPrevu?: string;
  createdAt?: string;
  companyNom?: string;
  opportunityNom?: string;
}

export interface InteractionCreate {
  companyId?: number;
  contactId?: number;
  opportunityId?: number;
  typeInteraction?: string;
  resume: string;
  details?: string;
  dateInteraction?: string;
  suiviPrevu?: string;
}

export interface PipelineStage {
  statut: string;
  count: number;
  totalMontant: number;
  avgProbabilite: number;
}

export interface CrmStats {
  summary: {
    total: number;
    gagnes: number;
    perdus: number;
    enCours: number;
    montantGagne: number;
    montantEnCours: number;
    tauxConversion: number;
    delaiMoyenJours: number;
  };
  topClients: Array<{
    id: number;
    nom: string;
    nbOpportunites: number;
    montantTotal: number;
  }>;
  activity: {
    interactions30j: number;
  };
}

// ============ Opportunities ============

export async function listOpportunities(params: {
  page?: number;
  perPage?: number;
  search?: string;
  statut?: string;
  companyId?: number;
} = {}): Promise<{ items: Opportunity[]; total: number; page: number; perPage: number }> {
  const { data } = await api.get('/crm/opportunities', { params });
  return data;
}

export async function getOpportunity(id: number): Promise<Opportunity> {
  const { data } = await api.get(`/crm/opportunities/${id}`);
  return data;
}

export async function createOpportunity(body: OpportunityCreate): Promise<{ id: number }> {
  const { data } = await api.post('/crm/opportunities', body);
  return data;
}

export async function updateOpportunity(id: number, body: Partial<OpportunityCreate>): Promise<void> {
  await api.put(`/crm/opportunities/${id}`, body);
}

export async function deleteOpportunity(id: number): Promise<void> {
  await api.delete(`/crm/opportunities/${id}`);
}

// ============ Interactions ============

export async function listInteractions(params: {
  page?: number;
  perPage?: number;
  companyId?: number;
  opportunityId?: number;
  typeInteraction?: string;
} = {}): Promise<{ items: Interaction[]; total: number; page: number; perPage: number }> {
  const { data } = await api.get('/crm/interactions', { params });
  return data;
}

export async function createInteraction(body: InteractionCreate): Promise<{ id: number }> {
  const { data } = await api.post('/crm/interactions', body);
  return data;
}

// ============ CRM-Devis Integration ============

export async function createDevisFromOpportunity(opportunityId: number): Promise<{
  devisId: number; devisNumero: string; message: string;
}> {
  const { data } = await api.post(`/crm/opportunities/${opportunityId}/create-devis`);
  return data;
}

// ============ Pipeline & Stats ============

export async function getPipeline(): Promise<{ stages: PipelineStage[] }> {
  const { data } = await api.get('/crm/pipeline');
  return data;
}

export async function getStats(): Promise<CrmStats> {
  const { data } = await api.get('/crm/stats');
  return data;
}

// ============ Activities ============

export interface Activity {
  id: number;
  typeActivite: string;
  sujet: string;
  description?: string;
  dateActivite?: string;
  dureeMinutes?: number;
  companyId?: number;
  contactId?: number;
  opportunityId?: number;
  createdBy?: string;
  statut?: string;
  createdAt?: string;
  companyNom?: string;
}

export interface ActivityCreate {
  typeActivite?: string;
  sujet: string;
  description?: string;
  dateActivite?: string;
  dureeMinutes?: number;
  companyId?: number;
  contactId?: number;
  opportunityId?: number;
}

export async function listActivities(params: {
  page?: number;
  perPage?: number;
} = {}): Promise<{ items: Activity[]; total: number; page: number; perPage: number }> {
  const { data } = await api.get('/crm/activities', { params });
  return data;
}

export async function createActivity(body: ActivityCreate): Promise<{ id: number }> {
  const { data } = await api.post('/crm/activities', body);
  return data;
}

// ============ Calendar ============

export interface CrmCalendarEvent {
  type: string;
  title: string;
  date: string;
  sourceId?: number;
  sousType?: string;
}

export async function getCrmCalendar(params: { year: number; month: number }): Promise<{ events: CrmCalendarEvent[] }> {
  const { data } = await api.get('/crm/calendar', { params });
  return data;
}

// ============ Timeline ============

export interface TimelineItem {
  type: string;
  id: number;
  titre: string;
  date?: string;
  sousType?: string;
  companyId?: number;
  companyNom?: string;
}

export async function getCrmTimeline(params?: { companyId?: number; limit?: number }): Promise<{ items: TimelineItem[] }> {
  const { data } = await api.get('/crm/timeline', { params });
  return data;
}

// ============ Qualification ============

export interface QualificationItem {
  opportunityId: number;
  nom: string;
  companyNom?: string;
  montantEstime?: number;
  probabilite?: number;
  statut?: string;
  score: number;
  categorie: string;
  details: string[];
}

export async function getQualifications(): Promise<{ items: QualificationItem[] }> {
  const { data } = await api.get('/crm/qualification');
  return data;
}

// ============ B.A.T. Qualification ============

export interface BATQualification {
  exists: boolean;
  id?: number;
  opportunityId?: number;
  scoreBudget?: number;
  scoreAutorite?: number;
  scoreTiming?: number;
  scoreCompatibilite?: number;
  scoreTotal?: number;
  categorie?: string;
  reponsesGrille?: Record<string, number>;
  notesQualification?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BATQualificationSave {
  opportunityId: number;
  scoreBudget: number;
  scoreAutorite: number;
  scoreTiming: number;
  scoreCompatibilite: number;
  scoreTotal: number;
  categorie: string;
  reponsesGrille?: Record<string, number>;
  notesQualification?: string;
}

// ============================================
// OPPORTUNITY ASSIGNATIONS
// ============================================

export async function listOpportunityAssignations(oppId: number): Promise<{ items: { id: number; opportunityId: number; employeeId: number; employeNom: string; role?: string }[] }> {
  const { data } = await api.get(`/crm/opportunities/${oppId}/assignations`);
  return data;
}

export async function addOpportunityAssignation(oppId: number, body: { employeeId: number; role?: string }): Promise<{ id: number }> {
  const { data } = await api.post(`/crm/opportunities/${oppId}/assignations`, body);
  return data;
}

export async function removeOpportunityAssignation(oppId: number, assignationId: number): Promise<void> {
  await api.delete(`/crm/opportunities/${oppId}/assignations/${assignationId}`);
}

export async function reorderOpportunities(orderedIds: number[]): Promise<void> {
  await api.put('/crm/opportunities/reorder', { orderedIds });
}

export async function getAllBATScores(): Promise<{ scores: Record<number, { scoreTotal: number; categorie: string }> }> {
  const { data } = await api.get('/crm/qualification/bat/all');
  return data;
}

export async function getBATQualification(opportunityId: number): Promise<BATQualification> {
  const { data } = await api.get(`/crm/qualification/bat/${opportunityId}`);
  return data;
}

export async function saveBATQualification(body: BATQualificationSave): Promise<{ id: number; scoreTotal: number; categorie: string }> {
  const { data } = await api.post('/crm/qualification/bat', body);
  return data;
}
