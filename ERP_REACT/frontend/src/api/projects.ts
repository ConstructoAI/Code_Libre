/**
 * ERP React Frontend - Projects API Module
 */

import api from './client';

export interface Project {
  id: number;
  nomProjet: string;
  numeroProjet?: string;
  clientCompanyId?: number;
  clientContactId?: number;
  clientNomCache?: string;
  clientNom?: string;
  clientNomDirect?: string;
  poClient?: string;
  statut: string;
  priorite: string;
  typeProjet?: string;
  tache?: string;
  dateDebutReel?: string;
  dateFinReel?: string;
  dateDebut?: string;
  dateFin?: string;
  dateSoumis?: string;
  datePrevu?: string;
  budgetTotal?: number;
  budget?: number;
  prixEstime?: number;
  description?: string;
  gestionnaire?: string;
  notes?: string;
  adresseChantier?: string;
  villeChantier?: string;
  devisId?: number;
  createdAt?: string;
  updatedAt?: string;
  phases?: ProjectPhase[];
  assignments?: ProjectAssignment[];
}

export interface ProjectPhase {
  id: number;
  nom: string;
  description?: string;
  ordre: number;
  statut: string;
  dateDebut?: string;
  dateFin?: string;
  progression: number;
}

export interface ProjectAssignment {
  id: number;
  employeeId: number;
  roleProjet: string;
  employeNom: string;
}

export async function listProjects(params: {
  page?: number; perPage?: number; search?: string; statut?: string; priorite?: string;
} = {}): Promise<{ items: Project[]; total: number; page: number; perPage: number }> {
  const { data } = await api.get('/projects', { params });
  return data;
}

export async function getProject(id: number | string): Promise<Project> {
  const { data } = await api.get(`/projects/${id}`);
  return data;
}

export async function createProject(body: Partial<Project>): Promise<{ id: number; numeroProjet?: string | null; message?: string }> {
  // Note: backend retourne `numero_projet` mais l'intercepteur axios convertit
  // snake_case -> camelCase, donc le consommateur reçoit `numeroProjet`.
  const { data } = await api.post('/projects', body);
  return data;
}

export async function updateProject(id: number | string, body: Partial<Project>): Promise<void> {
  await api.put(`/projects/${id}`, body);
}

export async function createPhase(projectId: string, body: {
  nom: string; description?: string; ordre?: number; dateDebut?: string; dateFin?: string;
}): Promise<{ id: number }> {
  const { data } = await api.post(`/projects/${projectId}/phases`, body);
  return data;
}

// ============ Project Notes (IA) ============

export interface ProjectNote {
  id: number;
  projectId: string;
  titre: string;
  contenu: string;
  categorie?: string;
  sousCategorie?: string;
  confidence?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectNoteCreate {
  titre: string;
  contenu: string;
  categorie?: string;
}

export async function listProjectNotes(projectId: string): Promise<{ items: ProjectNote[] }> {
  const { data } = await api.get(`/projects/${projectId}/notes`);
  return data;
}

export async function createProjectNote(projectId: string, body: ProjectNoteCreate): Promise<{ id: number }> {
  const { data } = await api.post(`/projects/${projectId}/notes`, body);
  return data;
}

export async function categorizeNote(projectId: string, noteId: number): Promise<{
  noteId: number; categorie: string; sousCategorie: string; confidence: number;
}> {
  const { data } = await api.post(`/projects/${projectId}/notes/${noteId}/categorize`);
  return data;
}

// ============ Project → Dossier Link ============

export async function getProjectDossier(projectId: string): Promise<{
  dossier: { id: number; numeroDossier: string; titre: string; statut: string; typeDossier: string } | null;
}> {
  const { data } = await api.get(`/projects/${projectId}/dossier`);
  return data;
}

// ============ Project Financials ============

export interface ProjectFinancials {
  projectId: number;
  budget: number;
  revenus: {
    devis: { items: { id: number; numero: string; description: string; montant: number }[]; total: number };
    factures: { items: { id: number; numero: string; client: string; statut: string; montant: number; paye: number; solde: number }[]; total: number; paye: number };
    total: number;
  };
  depenses: {
    materiaux: { items: { id: number; numero: string; fournisseur: string; statut: string; montant: number }[]; total: number };
    mainOeuvre: { items: { employeId: number; employe: string; poste: string; heures: number; cout: number }[]; total: number; heures: number };
    total: number;
  };
  marge: number;
  margePct: number;
}

export async function getProjectFinancials(projectId: number | string): Promise<ProjectFinancials> {
  const { data } = await api.get(`/projects/${projectId}/financials`);
  return data;
}

// ============ Statistics / Duplicate / Export / Batch ============

export async function getProjectStatistics(): Promise<{
  total: number; en_cours: number; termines: number; budget_total: number;
  par_statut: { statut: string; count: number; budget: number }[];
}> {
  const { data } = await api.get('/projects/statistics');
  return data;
}

export async function duplicateProject(projectId: number | string): Promise<{ id: number; numeroProjet?: string | null; message: string }> {
  const { data } = await api.post(`/projects/duplicate/${projectId}`);
  return data;
}

export async function exportProjectsCsv(): Promise<Blob> {
  const { data } = await api.get('/projects/export-csv', { responseType: 'blob' });
  return data;
}

export async function batchUpdateProjects(body: {
  projectIds: (string | number)[]; statut?: string; priorite?: string;
}): Promise<{ updated: number; message: string }> {
  const { data } = await api.post('/projects/batch-update', {
    project_ids: body.projectIds,
    statut: body.statut,
    priorite: body.priorite,
  });
  return data;
}

// ============ Gantt Data ============

export interface GanttPhase {
  id: number;
  nom: string;
  description?: string;
  ordre: number;
  statut: string;
  assignee?: string;
  dateDebut?: string;
  dateFin?: string;
  progression: number;
}

export interface GanttProject {
  id: number;
  nomProjet: string;
  statut: string;
  priorite: string;
  dateDebutReel?: string;
  dateFinReel?: string;
  dateDebut?: string;
  dateFin?: string;
  budgetTotal?: number;
  budget?: number;
  gestionnaire?: string;
  numero?: string;
  projectNom?: string;
  fournisseur?: string;
  montant?: number;
  phases: GanttPhase[];
}

export async function getGanttData(): Promise<{ items: GanttProject[] }> {
  const { data } = await api.get('/projects/gantt');
  return data;
}

// ============ Project Assignments ============

export async function listProjectAssignments(projectId: string): Promise<{ items: ProjectAssignment[] }> {
  const { data } = await api.get(`/projects/${projectId}/assignments`);
  return data;
}

export async function addProjectAssignment(projectId: string, body: { employeeId: number; roleProjet?: string }): Promise<{ id: number }> {
  const { data } = await api.post(`/projects/${projectId}/assignments`, body);
  return data;
}

export async function removeProjectAssignment(projectId: string, assignmentId: number): Promise<void> {
  await api.delete(`/projects/${projectId}/assignments/${assignmentId}`);
}

// ============ Phase Update ============

export async function updatePhase(projectId: string, phaseId: number, body: Record<string, unknown>): Promise<void> {
  await api.put(`/projects/${projectId}/phases/${phaseId}`, body);
}

export async function deleteProject(id: string): Promise<void> {
  await api.delete(`/projects/${id}`);
}
