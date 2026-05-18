/**
 * ERP React Frontend - Analytics API Module
 */

import api from './client';

export interface AnalyticsKpis {
  revenusTotal: number;
  projetsActifs: number;
  projetsTermines: number;
  projetsTotal: number;
  employesActifs: number;
  alertesStock: number;
  opportunitesPipeline: number;
  valeurPipeline: number;
  devisTotal: number;
  devisAcceptes: number;
  devisEnvoyes: number;
  devisValeurTotale: number;
  facturesTotal: number;
  facturesSoldeDu: number;
  revenusEncaisses: number;
}

export interface ProjectProfitability {
  id: number;
  nomProjet: string;
  statut: string;
  budget: number;
  coutMainOeuvre: number;
  coutMateriaux: number;
  coutTotal: number;
  marge: number;
  margePct: number;
}

export interface ProjectEvolution {
  mois: string;
  enAttente: number;
  enCours: number;
  termines: number;
  total: number;
}

export interface PipelineItem {
  statut: string;
  nombre: number;
  valeurTotale: number;
  valeurMoyenne: number;
  probaMoyenne: number;
}

export interface EmployeeProductivity {
  id: number;
  employe: string;
  poste: string;
  departement: string;
  joursTravailles: number;
  heuresTotales: number;
  heuresMoyennes: number;
  heuresParJour: number;
  nbProjets: number;
}

export interface DepartmentDistribution {
  departement: string;
  nbEmployes: number;
  heuresTotales: number;
}

export interface RevenueExpense {
  mois: string;
  revenus: number;
  depenses: number;
  marge: number;
  margePct: number;
}

export interface StockAlert {
  id: number;
  nom: string;
  categorie: string;
  stockActuel: number;
  seuilAlerte: number;
  unite: string;
  tauxStock: number;
}

export interface TopClient {
  id: number;
  client: string;
  typeEntreprise: string;
  nbProjets: number;
  caTotal: number;
  caMoyen: number;
  dernierProjet: string | null;
}

// ============ New Power BI types ============

export interface StatusDistribution {
  statut: string;
  count: number;
  montant?: number;
}

export interface HoursTrend {
  mois: string;
  heures: number;
  employes: number;
  pointages: number;
}

export interface FacturesAging {
  tranche: string;
  count: number;
  solde: number;
}

export interface StockSummary {
  totalProduits: number;
  produitsActifs: number;
  categories: number;
  valeurTotale: number;
  alertes: number;
}

// ============ Primary API Functions ============

export async function getKpis(periodDays = 30): Promise<AnalyticsKpis> {
  const { data } = await api.get('/analytics/kpis', { params: { periodDays } });
  return data;
}

export async function getProjectProfitability(periodDays = 90): Promise<{ items: ProjectProfitability[] }> {
  const { data } = await api.get('/analytics/projects/profitability', { params: { periodDays } });
  return data;
}

export async function getProjectEvolution(periodDays = 365): Promise<{ items: ProjectEvolution[] }> {
  const { data } = await api.get('/analytics/projects/evolution', { params: { periodDays } });
  return data;
}

export async function getCommercialPipeline(): Promise<{ items: PipelineItem[] }> {
  const { data } = await api.get('/analytics/commercial/pipeline');
  return data;
}

export async function getEmployeeProductivity(periodDays = 30): Promise<{ items: EmployeeProductivity[] }> {
  const { data } = await api.get('/analytics/hr/productivity', { params: { periodDays } });
  return data;
}

export async function getDepartmentDistribution(periodDays = 30): Promise<{ items: DepartmentDistribution[] }> {
  const { data } = await api.get('/analytics/hr/departments', { params: { periodDays } });
  return data;
}

export async function getRevenueExpenses(periodDays = 365): Promise<{ items: RevenueExpense[] }> {
  const { data } = await api.get('/analytics/finance/revenue-expenses', { params: { periodDays } });
  return data;
}

export async function getStockAlerts(): Promise<{ items: StockAlert[] }> {
  const { data } = await api.get('/analytics/inventory/alerts');
  return data;
}

export async function getTopClients(periodDays = 365): Promise<{ items: TopClient[] }> {
  const { data } = await api.get('/analytics/top-clients', { params: { periodDays } });
  return data;
}

// ============ V2 + Power BI Endpoints ============

export async function getProjectProfitabilityV2() { const { data } = await api.get('/analytics/project-profitability'); return data; }
export async function getWorkstationLoad() { const { data } = await api.get('/analytics/workstation-load'); return data; }
export async function getProjectProgress() { const { data } = await api.get('/analytics/project-progress'); return data; }
export async function getSalesPipeline() { const { data } = await api.get('/analytics/sales-pipeline'); return data; }
export async function getTopClientsV2() { const { data } = await api.get('/analytics/top-clients-revenue'); return data; }
export async function getEmployeeProductivityV2() { const { data } = await api.get('/analytics/employee-productivity'); return data; }
export async function getStockAlertsV2() { const { data } = await api.get('/analytics/stock-alerts'); return data; }
export async function getTopSuppliers() { const { data } = await api.get('/analytics/top-suppliers'); return data; }
export async function getMonthlyRevenue() { const { data } = await api.get('/analytics/monthly-revenue'); return data; }
export async function getStockValue() { const { data } = await api.get('/analytics/stock-value'); return data; }
export async function getTrends() { const { data } = await api.get('/analytics/trends'); return data; }

// New Power BI endpoints
export async function getInvoicesByStatus(): Promise<{ items: StatusDistribution[] }> {
  const { data } = await api.get('/analytics/invoices-by-status');
  return data;
}
export async function getBtByStatus(): Promise<{ items: StatusDistribution[] }> {
  const { data } = await api.get('/analytics/bt-by-status');
  return data;
}
export async function getHoursTrend(periodDays = 365): Promise<{ items: HoursTrend[] }> {
  const { data } = await api.get('/analytics/hours-trend', { params: { periodDays } });
  return data;
}
export async function getFacturesAging(): Promise<{ items: FacturesAging[] }> {
  const { data } = await api.get('/analytics/factures-aging');
  return data;
}
export async function getStockSummary(): Promise<StockSummary> {
  const { data } = await api.get('/analytics/stock-summary');
  return data;
}
