/**
 * ERP React Frontend - Production API Module
 * Work orders + Kanban board data + lines, assignations, comments.
 */

import api from './client';

// ============ Types ============

export interface WorkOrder {
  id: number;
  numeroDocument: string;
  nom: string;
  statut: string;
  priorite: string;
  projectId?: number;
  projectNom?: string;
  dateEcheance?: string;
  dateDebut?: string;
  dateFin?: string;
  montantTotal?: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LineItem {
  id: number;
  formulaireId: number;
  description: string;
  quantite: number;
  unite?: string;
  prixUnitaire: number;
  montantLigne: number;
  sequenceLigne: number;
  produitId?: number;
  produitNom?: string;
  produitCode?: string;
}

export interface Assignation {
  id: number;
  btId: number;
  employeeId: number;
  employeeNom?: string;
  role?: string;
  dateAssignation?: string;
}

export interface BtComment {
  id: number;
  btId: number;
  userId?: string;
  commentText: string;
  createdAt?: string;
}

export interface Operation {
  id: number;
  formulaireBtId: number;
  nom?: string;
  description?: string;
  quantite: number;
  employeeId?: number;
  employeeNom?: string;
  fournisseur: string;
  heuresPrevues: number;
  heuresReelles: number;
  statut: string;
  dateDebut?: string;
  dateFin?: string;
  posteTravail?: string;
  sequenceNumber?: number;
  btNumero?: string;
  btNom?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface KanbanAssignee {
  employeeId: number;
  nom: string;
}

export interface KanbanData {
  projects: { id: string; nom: string; statut: string; priorite: string; dateDebutReel?: string; dateFinReel?: string; budgetTotal?: number; createdAt?: string; assignees?: KanbanAssignee[] }[];
  devis: { id: number; numeroDevis?: string; nom: string; statut: string; investissementTotal?: number; datePrevu?: string; createdAt?: string; assignees?: KanbanAssignee[] }[];
  bonsTravail: { id: number; numero: string; nom: string; statut: string; priorite: string; dateEcheance?: string; createdAt?: string; assignees?: KanbanAssignee[] }[];
  factures?: { id: number; numero?: string; nom: string; statut: string; montantTotal?: number; dateEcheance?: string; createdAt?: string; projectNom?: string }[];
}

// ============ Work Orders CRUD ============

export async function listWorkOrders(params: {
  page?: number; perPage?: number; statut?: string; priorite?: string; search?: string;
} = {}): Promise<{ items: WorkOrder[]; total: number; page: number; perPage: number }> {
  const { data } = await api.get('/production/work-orders', { params });
  return data;
}

export async function getWorkOrder(id: number): Promise<WorkOrder> {
  const { data } = await api.get(`/production/work-orders/${id}`);
  return data;
}

export async function createWorkOrder(body: {
  nom?: string; projectId?: number; priorite?: string;
  dateEcheance?: string; dateDebut?: string; dateFin?: string; notes?: string;
}): Promise<{ id: number; numero: string; nom: string }> {
  const { data } = await api.post('/production/work-orders', body);
  return data;
}

export async function updateWorkOrder(id: number, body: Partial<WorkOrder>): Promise<void> {
  await api.put(`/production/work-orders/${id}`, body);
}

export async function deleteWorkOrder(id: number): Promise<{ hard_deleted?: boolean }> {
  const { data } = await api.delete(`/production/work-orders/${id}`);
  return data || {};
}

export async function restoreWorkOrder(id: number): Promise<void> {
  await api.post(`/production/work-orders/${id}/restore`);
}

// ============ Line Items ============

export async function listLines(btId: number): Promise<{ items: LineItem[] }> {
  const { data } = await api.get(`/production/work-orders/${btId}/lines`);
  return data;
}

export async function addLine(btId: number, body: {
  description: string; quantite?: number; unite?: string; prixUnitaire?: number; produitId?: number;
}): Promise<{ id: number }> {
  const { data } = await api.post(`/production/work-orders/${btId}/lines`, body);
  return data;
}

export async function updateLine(btId: number, lineId: number, body: Partial<LineItem>): Promise<void> {
  await api.put(`/production/work-orders/${btId}/lines/${lineId}`, body);
}

export async function deleteLine(btId: number, lineId: number): Promise<void> {
  await api.delete(`/production/work-orders/${btId}/lines/${lineId}`);
}

// ============ Assignations ============

export async function listAssignations(btId: number): Promise<{ items: Assignation[] }> {
  const { data } = await api.get(`/production/work-orders/${btId}/assignations`);
  return data;
}

export async function addAssignation(btId: number, body: {
  employeeId: number; role?: string;
}): Promise<{ id: number }> {
  const { data } = await api.post(`/production/work-orders/${btId}/assignations`, body);
  return data;
}

export async function removeAssignation(btId: number, assignationId: number): Promise<void> {
  await api.delete(`/production/work-orders/${btId}/assignations/${assignationId}`);
}

// ============ Comments ============

export async function listComments(btId: number): Promise<{ items: BtComment[] }> {
  const { data } = await api.get(`/production/work-orders/${btId}/comments`);
  return data;
}

export async function addComment(btId: number, body: {
  commentText: string;
}): Promise<{ id: number }> {
  const { data } = await api.post(`/production/work-orders/${btId}/comments`, body);
  return data;
}

// ============ Operations ============

export async function listOperations(btId: number): Promise<{ items: Operation[] }> {
  const { data } = await api.get(`/production/work-orders/${btId}/operations`);
  return data;
}

export async function addOperation(btId: number, body: {
  nom?: string; description?: string; quantite?: number;
  employeeId?: number; fournisseur?: string; heuresPrevues?: number;
  statut?: string; dateDebut?: string; dateFin?: string;
  posteTravail?: string;
}): Promise<{ id: number }> {
  const { data } = await api.post(`/production/work-orders/${btId}/operations`, body);
  return data;
}

export async function updateOperation(btId: number, opId: number, body: Partial<Operation>): Promise<void> {
  await api.put(`/production/work-orders/${btId}/operations/${opId}`, body);
}

export async function deleteOperation(btId: number, opId: number): Promise<void> {
  await api.delete(`/production/work-orders/${btId}/operations/${opId}`);
}

export async function listAllOperations(params: {
  page?: number; perPage?: number; statut?: string;
} = {}): Promise<{ items: Operation[]; total: number }> {
  const { data } = await api.get('/production/operations', { params });
  return data;
}

export async function listOperationTypes(): Promise<{ items: string[] }> {
  const { data } = await api.get('/production/operation-types');
  return data;
}

// ============ Calendar Events ============

export interface CalendarEvent {
  id: string;
  type: 'project' | 'project_start' | 'bon_travail' | 'devis' | 'opportunite' | 'bon_commande' | 'facture' | 'interaction' | 'activite';
  title: string;
  date: string;
  dateDebut?: string;
  dateFin?: string;
  statut: string;
  priorite?: string;
  sourceId: string | number;
  numero?: string;
  montant?: number;
}

export async function getCalendarEvents(year: number, month: number): Promise<{ events: CalendarEvent[]; year: number; month: number }> {
  const { data } = await api.get('/production/calendar-events', { params: { year, month } });
  return data;
}

// ============ Statistics ============

export interface ProductionStatistics {
  total: number;
  enCours: number;
  termines: number;
  montantTotal: number;
  assignationsCount: number;
  parStatut: { statut: string; count: number; montant: number }[];
}

export async function getProductionStatistics(): Promise<ProductionStatistics> {
  const { data } = await api.get('/production/statistics');
  return data;
}

// ============ Work Order Detail (full) ============

export interface WorkOrderDetail {
  bt: WorkOrder;
  lignes: LineItem[];
  assignations: Assignation[];
  comments: BtComment[];
  operations: Operation[];
}

export async function getWorkOrderDetail(btId: number): Promise<WorkOrderDetail> {
  const { data } = await api.get(`/production/work-orders/${btId}/detail`);
  return data;
}

// ============ Work Centers ============

export interface WorkCenter {
  id?: number;
  nom: string;
  description?: string;
  capacite?: number;
}

export async function listWorkCenters(): Promise<{ items: WorkCenter[]; message?: string }> {
  const { data } = await api.get('/production/work-centers');
  return data;
}

// ============ Kanban ============

export async function getKanbanData(): Promise<KanbanData> {
  const { data } = await api.get('/production/kanban');
  return data;
}

// ============ Gantt ============

export interface GanttPhase {
  id: number;
  nom: string;
  statut: string;
  dateDebut?: string;
  dateFin?: string;
  progression: number;
  ordre: number;
}

export interface GanttItem {
  id: number;
  nomProjet?: string;
  nom?: string;
  numero?: string;
  statut: string;
  priorite?: string;
  dateDebut?: string;
  dateFin?: string;
  budget?: number;
  projectId?: number;
  projectNom?: string;
  phases?: GanttPhase[];
}

export interface GanttDependency {
  id: number;
  sourceType: string;
  sourceId: string | number;
  targetType: string;
  targetId: string | number;
  dependencyType: string;
  lagDays: number;
}

export async function getGanttProjects(): Promise<{ items: GanttItem[] }> { const { data } = await api.get('/production/gantt/projects'); return data; }
export async function getGanttBonsTravail(): Promise<{ items: GanttItem[] }> { const { data } = await api.get('/production/gantt/bons-travail'); return data; }
export async function getGanttDevis(): Promise<{ items: GanttItem[] }> { const { data } = await api.get('/production/gantt/devis'); return data; }
export async function getGanttBonsCommande(): Promise<{ items: GanttItem[] }> { const { data } = await api.get('/production/gantt/bons-commande'); return data; }
export async function getGanttDependencies(): Promise<{ items: GanttDependency[] }> { const { data } = await api.get('/production/gantt/dependencies'); return data; }
export async function createGanttDependency(body: { sourceType: string; sourceId: string | number; targetType: string; targetId: string | number; dependencyType?: string; lagDays?: number }): Promise<{ id: number; message: string }> { const { data } = await api.post('/production/gantt/dependencies', body); return data; }
export async function deleteGanttDependency(depId: number): Promise<void> { await api.delete(`/production/gantt/dependencies/${depId}`); }
export async function exportGanttCsv() { return api.get('/production/gantt/export-csv', { responseType: 'blob' }); }

// ============ Kanban (Achats + Status Update) ============

export async function getKanbanAchats() { const { data } = await api.get('/production/kanban/achats'); return data; }
export async function updateKanbanStatus(body: { entityType: string; entityId: string; newStatut: string }) { const { data } = await api.put('/production/kanban/update-status', body); return data; }

// ============ Achats Assignations ============

export async function listAchatAssignations(achatId: number): Promise<{ items: { id: number; achatId: number; employeeId: number; employeNom: string; role?: string }[] }> {
  const { data } = await api.get(`/production/achats/${achatId}/assignations`);
  return data;
}

export async function addAchatAssignation(achatId: number, body: { employeeId: number; role?: string }): Promise<{ id: number }> {
  const { data } = await api.post(`/production/achats/${achatId}/assignations`, body);
  return data;
}

export async function removeAchatAssignation(achatId: number, assignationId: number): Promise<void> {
  await api.delete(`/production/achats/${achatId}/assignations/${assignationId}`);
}

// ============ BT HTML Generation ============

export interface GenerateBTHtmlResponse {
  html: string;
  btId: number;
  numero: string;
}

export async function generateBTHtml(btId: number): Promise<GenerateBTHtmlResponse> {
  const { data } = await api.post(`/production/work-orders/${btId}/generate-html`);
  return data;
}

// ============ BT Time Entries ============

export async function getBtTimeEntries(btId: number) {
  const { data } = await api.get(`/production/work-orders/${btId}/time-entries`);
  return data;
}
