/**
 * ERP React Frontend - Payroll API Module (Paie CCQ)
 */

import api from './client';

// ============ Types ============

export interface PayrollPeriod {
  id: number;
  dateDebut: string;
  dateFin: string;
  typePeriode: string;
  statut: string;
  createdAt?: string;
  closedAt?: string;
}

export interface PayrollDeductionDetail {
  montant: number;
  taux?: number;
  tauxEffectif?: number;
  palier?: string;
}

export interface PayrollCcqDetail {
  montant: number;
  taux: number;
  applicable: boolean;
}

export interface PayrollCalculation {
  employee: {
    id: number;
    prenom: string;
    nom: string;
    tauxHoraire: number;
    departement?: string;
    poste?: string;
  };
  periode: {
    dateDebut: string;
    dateFin: string;
    typePeriode: string;
  };
  heures: {
    regulieres: number;
    supplementaires: number;
    total: number;
  };
  salaireBrut: number;
  deductionsEmploye: {
    impotFederal: PayrollDeductionDetail;
    impotProvincial: PayrollDeductionDetail;
    rrq: PayrollDeductionDetail;
    rqap: PayrollDeductionDetail;
    ae: PayrollDeductionDetail;
    total: number;
  };
  chargesEmployeur: {
    rrq: PayrollDeductionDetail;
    rqap: PayrollDeductionDetail;
    ae: PayrollDeductionDetail;
    cnesst: PayrollDeductionDetail;
    fss: PayrollDeductionDetail;
    ccq: PayrollCcqDetail;
    total: number;
  };
  salaireNet: number;
  coutTotalEmployeur: number;
}

export interface PayrollEntry {
  id: number;
  periodId: number;
  employeeId: number;
  employe: string;
  departement?: string;
  tauxHoraire: number;
  heuresRegulieres: number;
  heuresSupplementaires: number;
  salaireBrut: number;
  totalDeductions: number;
  totalCharges: number;
  salaireNet: number;
  coutTotal: number;
  isCcq: boolean;
  createdAt?: string;
}

export interface PayrollEntryDetail extends PayrollEntry {
  impotFederal: number;
  impotProvincial: number;
  rrqEmploye: number;
  rqapEmploye: number;
  aeEmploye: number;
  rrqEmployeur: number;
  rqapEmployeur: number;
  aeEmployeur: number;
  cnesst: number;
  fss: number;
  ccq: number;
  poste?: string;
  periodDateDebut?: string;
  periodDateFin?: string;
  typePeriode?: string;
  prenom?: string;
  nom?: string;
  detailJson?: Record<string, unknown>;
}

export interface PayrollGenerateResult {
  message: string;
  periodId: number;
  entries: {
    id: number;
    employeeId: number;
    employe: string;
    heuresRegulieres: number;
    heuresSupplementaires: number;
    salaireBrut: number;
    totalDeductions: number;
    salaireNet: number;
    coutTotal: number;
  }[];
  totals: {
    totalBrut: number;
    totalNet: number;
    totalCoutEmployeur: number;
    nombreEmployes: number;
  };
}

// ============ API Calls ============

export async function listPeriods(params?: {
  page?: number;
  perPage?: number;
}): Promise<{ items: PayrollPeriod[]; total: number }> {
  const { data } = await api.get('/payroll/periods', { params });
  return data;
}

export async function createPeriod(body: {
  dateDebut: string;
  dateFin: string;
  typePeriode: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/payroll/periods', body);
  return data;
}

export async function closePeriod(periodId: number): Promise<{ message: string }> {
  const { data } = await api.put(`/payroll/periods/${periodId}/close`);
  return data;
}

export async function calculatePayroll(
  employeeId: number,
  params: { periodId?: number; dateDebut?: string; dateFin?: string },
): Promise<PayrollCalculation> {
  const { data } = await api.get(`/payroll/calculate/${employeeId}`, { params });
  return data;
}

export async function generatePayroll(periodId: number): Promise<PayrollGenerateResult> {
  const { data } = await api.post('/payroll/generate', { periodId });
  return data;
}

export async function listEntries(params?: {
  periodId?: number;
  page?: number;
  perPage?: number;
}): Promise<{ items: PayrollEntry[]; total: number }> {
  const { data } = await api.get('/payroll/entries', { params });
  return data;
}

export async function getEntry(entryId: number): Promise<PayrollEntryDetail> {
  const { data } = await api.get(`/payroll/entries/${entryId}`);
  return data;
}
