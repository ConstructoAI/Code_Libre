/**
 * ERP React Frontend - Employees API Module
 */

import api from './client';

export interface Employee {
  id: number;
  prenom: string;
  nom: string;
  email?: string;
  telephone?: string;
  poste?: string;
  departement?: string;
  statut: string;
  typeContrat?: string;
  dateEmbauche?: string;
  salaire?: number;
  tauxHoraire?: number;
  notes?: string;
  pinCode?: string;
  canApproveTimecards?: boolean;
  createdAt?: string;
  updatedAt?: string;
  competences?: Competence[];
  timeEntries?: TimeEntry[];
}

export interface Competence {
  id: number;
  nomCompetence: string;
  niveau: string;
  dateObtention?: string;
  certifie: boolean;
}

export interface TimeEntry {
  id: number;
  employeeId: number;
  projectId?: string;
  operationId?: number;
  operationNom?: string;
  punchIn?: string;
  punchOut?: string;
  totalHours?: number;
  notes?: string;
  typeTravail?: string;
  validated?: boolean;
  billable?: boolean;
  isBilled?: boolean;
  employeNom?: string;
  clientNom?: string;
  nomProjet?: string;
  formulaireBtId?: number;
  btNumero?: string;
}

export interface PayrollItem {
  id: number;
  employe: string;
  poste?: string;
  departement?: string;
  heuresTotales: number;
  taux: number;
  salaireBrut: number;
  deductions: number;
  salaireNet: number;
}

export async function listEmployees(params?: {
  page?: number; perPage?: number; search?: string; departement?: string; statut?: string;
}): Promise<{ items: Employee[]; total: number }> {
  const { data } = await api.get('/employees', { params });
  return data;
}

export async function getEmployee(id: number): Promise<Employee> {
  const { data } = await api.get(`/employees/${id}`);
  return data;
}

export async function createEmployee(body: Partial<Employee>): Promise<{ id: number }> {
  const { data } = await api.post('/employees', body);
  return data;
}

export async function updateEmployee(id: number, body: Partial<Employee>): Promise<void> {
  await api.put(`/employees/${id}`, body);
}

export async function listTimeEntries(params?: {
  employeeId?: number; projectId?: string; page?: number; perPage?: number; btId?: number;
}): Promise<{ items: TimeEntry[]; total: number }> {
  const { data } = await api.get('/employees/time-entries', { params });
  return data;
}

export async function createTimeEntry(body: {
  employeeId: number; projectId?: string; punchIn?: string;
  punchOut?: string; totalHours?: number; notes?: string;
  formulaireBtId?: number; operationId?: number; typeTravail?: string;
  billable?: boolean;
}): Promise<{ id: number }> {
  const { data } = await api.post('/employees/time-entries', body);
  return data;
}

export async function getPayrollSummary(periodDays?: number): Promise<{
  items: PayrollItem[]; totalBrut: number; totalEmployes: number;
}> {
  const { data } = await api.get('/employees/payroll-summary', {
    params: periodDays ? { periodDays } : undefined,
  });
  return data;
}

export async function validateTimeEntry(entryId: number): Promise<{ message: string }> {
  const { data } = await api.put(`/employees/time-entries/${entryId}/validate`);
  return data;
}

export async function updateTimeEntry(entryId: number, body: {
  employeeId?: number; projectId?: string; operationId?: number | null;
  formulaireBtId?: number | null; punchIn?: string; punchOut?: string;
  totalHours?: number; notes?: string; typeTravail?: string;
  billable?: boolean; validated?: boolean;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/employees/time-entries/${entryId}`, body);
  return data;
}

export async function deleteTimeEntry(entryId: number): Promise<{ message: string }> {
  const { data } = await api.delete(`/employees/time-entries/${entryId}`);
  return data;
}

export async function getWeeklyTimesheet(params?: {
  employeeId?: number; weekStart?: string;
}): Promise<{
  weekStart: string; weekEnd: string;
  jours: Array<{ jour: string; date: string; entries: TimeEntry[]; totalHeures: number }>;
  totalSemaine: number;
}> {
  const { data } = await api.get('/employees/time-entries/weekly', { params });
  return data;
}

export async function getHoursByProject(): Promise<{
  items: Array<{ id: string; nomProjet: string; heures: number; nbEmployes: number }>;
}> {
  const { data } = await api.get('/employees/time-entries/by-project');
  return data;
}

export async function exportTimeEntriesCsv(params?: {
  employeeId?: number; dateDebut?: string; dateFin?: string;
}) {
  return api.get('/employees/time-entries/export-csv', { params, responseType: 'blob' });
}

export async function getEmployeeStatistics(): Promise<{
  total: number; actifs: number;
  parStatut: Array<{ statut: string; count: number }>;
  parDepartement: Array<{ departement: string; count: number }>;
}> {
  const { data } = await api.get('/employees/statistics');
  return data;
}
