/**
 * ERP React Frontend - Accounting API Module
 */

import api from './client';

export interface ChartAccount {
  id: number;
  code: string;
  nom: string;
  type: string;
  classe?: string;
  sousClasse?: string;
  description?: string;
  parentId?: number;
  niveau: number;
  actif: boolean;
  soldeNormal: string;
  estDetail?: boolean;
}

export interface JournalEntry {
  id: number;
  numeroEcriture: string;
  dateEcriture: string;
  libelle: string;
  typeJournal: string;
  referenceExterne?: string;
  projetId?: string;
  statut: string;
  montantTotal?: number;
  valide?: boolean;
  createdBy?: string;
  validatedBy?: string;
  notes?: string;
  createdAt?: string;
  lines?: JournalLine[];
}

export interface JournalLine {
  id: number;
  compteId?: number;
  compteCode?: string;
  libelle?: string;
  debit: number;
  credit: number;
  projetId?: string;
}

export interface Invoice {
  id: number;
  numero?: string;
  numeroFacture?: string;
  clientNom?: string;
  clientCompanyId?: number;
  projectId?: number;
  devisId?: number;
  dateFacture?: string;
  dateEcheance?: string;
  statut: string;
  conditionsPaiement?: string;
  montantHt?: number;
  montantTps?: number;
  montantTvq?: number;
  montantTotal?: number;
  montantTtc?: number;
  montantPaye?: number;
  soldeDu?: number;
  notes?: string;
  notesInternes?: string;
  createdAt?: string;
  // Conformite Revenu Quebec / Note de credit
  typeDocument?: 'FACTURE' | 'AVOIR' | 'ACOMPTE' | 'PROFORMA';
  factureOrigineId?: number;
  factureOrigineNumero?: string;
  motifAvoir?: string;
  // Rappels & recurrence
  rappelsActifs?: boolean;
  dernierRappelLe?: string;
  nbRappelsEnvoyes?: number;
  factureRecurrenteId?: number;
}

export interface InvoiceLine {
  id: number;
  factureId?: number;
  description?: string;
  quantite?: number;
  prixUnitaire?: number;
  montant?: number;
  montantLigne?: number;
  sequenceLigne?: number;
  categorie?: string;
  notes?: string;
}

export interface FinancialSummary {
  totalFactures: number;
  facturesPayees: number;
  facturesRetard: number;
  caTotal: number;
  totalEncaisse: number;
  totalSoldeDu: number;
  totalEcritures: number;
  ecrituresBrouillon: number;
  totalComptes: number;
}

export async function getChartOfAccounts(): Promise<{ items: ChartAccount[] }> {
  const { data } = await api.get('/accounting/chart-of-accounts');
  return data;
}

export async function listJournalEntries(params?: {
  page?: number; perPage?: number; statut?: string; typeEntry?: string;
}): Promise<{ items: JournalEntry[]; total: number }> {
  const { data } = await api.get('/accounting/journal', { params });
  return data;
}

export async function getJournalEntry(id: number): Promise<JournalEntry> {
  const { data } = await api.get(`/accounting/journal/${id}`);
  return data;
}

export async function createJournalEntry(body: {
  libelle: string; typeJournal?: string; referenceExterne?: string; projetId?: string; notes?: string;
}): Promise<{ id: number; numero: string; message: string }> {
  const { data } = await api.post('/accounting/journal', body);
  return data;
}

export async function addJournalLine(entryId: number, body: {
  compteId: number; compteCode?: string; libelle?: string;
  debit?: number; credit?: number;
}): Promise<{ id: number }> {
  const { data } = await api.post(`/accounting/journal/${entryId}/lines`, body);
  return data;
}

/**
 * Creation atomique entete + lignes en une transaction (atomicite garantie).
 * A preferer a createJournalEntry + N x addJournalLine qui peut laisser une
 * ecriture parente desequilibree si une ligne echoue.
 */
export async function createJournalEntryWithLines(body: {
  libelle: string;
  typeJournal?: string;
  referenceExterne?: string;
  projetId?: number;
  notes?: string;
  lignes: Array<{
    compteId?: number;
    compteCode?: string;
    libelle?: string;
    debit?: number;
    credit?: number;
    projetId?: number;
  }>;
}): Promise<{
  id: number;
  numeroEcriture: string;
  linesCount: number;
  montantTotal: number;
  message: string;
}> {
  // Backend accepts snake_case via Pydantic — transform pour match
  const payload = {
    libelle: body.libelle,
    type_journal: body.typeJournal,
    reference_externe: body.referenceExterne,
    projet_id: body.projetId,
    notes: body.notes,
    lignes: body.lignes.map((l) => ({
      compte_id: l.compteId,
      compte_code: l.compteCode,
      libelle: l.libelle,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
      projet_id: l.projetId,
    })),
  };
  const { data } = await api.post('/accounting/journal/with-lines', payload);
  return {
    id: data.id,
    numeroEcriture: data.numero_ecriture,
    linesCount: data.lines_count,
    montantTotal: data.montant_total,
    message: data.message,
  };
}

export async function validateJournalEntry(entryId: number): Promise<{ message: string }> {
  const { data } = await api.put(`/accounting/journal/${entryId}/validate`);
  return data;
}

export async function listInvoices(params?: {
  page?: number; perPage?: number; statut?: string; search?: string;
}): Promise<{ items: Invoice[]; total: number }> {
  const { data } = await api.get('/accounting/invoices', { params });
  return data;
}

export async function getInvoice(id: number): Promise<Invoice> {
  const { data } = await api.get(`/accounting/invoices/${id}`);
  return data;
}

export async function createInvoice(body: {
  clientCompanyId?: number; fournisseurId?: number; typeDestinataire?: string;
  projectId?: number; devisId?: number;
  dateFacture?: string; dateEcheance?: string;
  conditionsPaiement?: string; notes?: string;
  numeroFactureFournisseur?: string;
}): Promise<{ id: number; numeroFacture: string; message: string }> {
  const { data } = await api.post('/accounting/invoices', body);
  return data;
}

export interface InvoiceScanResult {
  fournisseurNom: string;
  fournisseurId: number | null;
  numeroFacture: string;
  dateFacture: string;
  dateEcheance: string | null;
  conditionsPaiement: string;
  montantHt: number;
  tps: number;
  tvq: number;
  montantTtc: number;
  lignes: { description: string; quantite: number; prixUnitaire: number; montant: number }[];
  notes: string;
  confiance: string;
  tokensInput: number;
  tokensOutput: number;
}

export async function scanInvoice(file: File): Promise<InvoiceScanResult> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/accounting/invoices/ai/scan', form);
  return data;
}

export async function updateInvoice(
  id: number,
  body: {
    clientCompanyId?: number; projectId?: number;
    dateFacture?: string; dateEcheance?: string;
    conditionsPaiement?: string; notes?: string;
    notesInternes?: string; statut?: string;
  }
): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/accounting/invoices/${id}`, body);
  return data;
}

export async function getInvoiceLines(invoiceId: number): Promise<{ items: InvoiceLine[] }> {
  const { data } = await api.get(`/accounting/invoices/${invoiceId}/lines`);
  return data;
}

export async function getFinancialSummary(): Promise<FinancialSummary> {
  const { data } = await api.get('/accounting/summary');
  return data;
}

// ============================================
// GRAND LIVRE (General Ledger)
// ============================================

export async function getLedger(params: {
  compteCode: string;
  dateDebut?: string;
  dateFin?: string;
  page?: number;
  perPage?: number;
}) {
  const { data } = await api.get('/accounting/ledger', { params });
  return data;
}

export async function getLedgerAccounts() {
  const { data } = await api.get('/accounting/ledger/accounts');
  return data;
}

export async function getTrialBalance(params?: { dateFin?: string }) {
  const { data } = await api.get('/accounting/trial-balance', { params });
  return data;
}

// ============================================
// ETATS FINANCIERS (Financial Statements)
// ============================================

export async function getBalanceSheet(params?: { dateFin?: string }) {
  const { data } = await api.get('/accounting/balance-sheet', { params });
  return data;
}

export async function getIncomeStatement(params?: {
  dateDebut?: string;
  dateFin?: string;
}) {
  const { data } = await api.get('/accounting/income-statement', { params });
  return data;
}

export async function getCashFlow(params?: {
  dateDebut?: string;
  dateFin?: string;
}) {
  const { data } = await api.get('/accounting/cash-flow', { params });
  return data;
}

// ============================================
// CENTRES DE COUTS (Cost Centers)
// ============================================

export async function getCostCenters() {
  const { data } = await api.get('/accounting/cost-centers');
  return data;
}

export async function createCostCenter(body: {
  code: string;
  nom: string;
  type?: string;
  description?: string;
  budgetAnnuel?: number;
}) {
  const { data } = await api.post('/accounting/cost-centers', body);
  return data;
}

export async function getCostCenterTransactions(
  centerId: number,
  params?: { page?: number; perPage?: number }
) {
  const { data } = await api.get(`/accounting/cost-centers/${centerId}/transactions`, { params });
  return data;
}

export async function getCostCentersSummary() {
  const { data } = await api.get('/accounting/cost-centers/summary');
  return data;
}

// ============================================
// FACTURE LIGNES + PAIEMENTS
// ============================================

export async function addInvoiceLine(
  invoiceId: number,
  body: { description: string; quantite?: number; prixUnitaire?: number }
) {
  const { data } = await api.post(`/accounting/invoices/${invoiceId}/lines`, body);
  return data;
}

export async function updateInvoiceLine(
  invoiceId: number,
  lineId: number,
  body: { description?: string; quantite?: number; prixUnitaire?: number }
) {
  const { data } = await api.put(`/accounting/invoices/${invoiceId}/lines/${lineId}`, body);
  return data;
}

export async function deleteInvoiceLine(invoiceId: number, lineId: number) {
  const { data } = await api.delete(`/accounting/invoices/${invoiceId}/lines/${lineId}`);
  return data;
}

export async function deleteInvoice(invoiceId: number): Promise<{
  message: string;
  id: number;
  // Backend retourne `reversed_entries` mais l'intercepteur axios (client.ts:110)
  // convertit en camelCase: `reversedEntries`.
  reversedEntries: number;  // 0 si BROUILLON, >0 si ANNULEE avec contre-passation
}> {
  const { data } = await api.delete(`/accounting/invoices/${invoiceId}`);
  return data;
}

export async function recordInvoicePayment(
  invoiceId: number,
  body: { montant: number; datePaiement?: string; modePaiement?: string; reference?: string }
) {
  const { data } = await api.post(`/accounting/invoices/${invoiceId}/payment`, body);
  return data;
}

// ============================================
// TRANSACTIONS (Revenues + Expenses)
// ============================================

export async function listTransactions(params?: {
  typeFilter?: string;
  page?: number;
  perPage?: number;
}): Promise<{ items: any[]; total: number }> {
  const { data } = await api.get('/accounting/transactions', { params });
  return data;
}

// ============================================
// FINANCIAL DASHBOARD
// ============================================

export async function syncAccounting(): Promise<{
  message: string;
  facturesSynced: number;
  paiementsSynced: number;
  bcSynced: number;
  laborSynced: number;
  payrollSynced: number;
  totalSynced: number;
}> {
  const { data } = await api.post('/accounting/sync-all');
  return {
    message: data.message,
    facturesSynced: data.factures_synced ?? 0,
    paiementsSynced: data.paiements_synced ?? 0,
    bcSynced: data.bc_synced ?? 0,
    laborSynced: data.labor_synced ?? 0,
    payrollSynced: data.payroll_synced ?? 0,
    totalSynced: data.total_synced ?? 0,
  };
}

export async function getFinancialDashboard(): Promise<{
  monthlyData: { mois: string; revenus: number; depenses: number; profit: number }[];
  totals: { ca: number; depenses: number; profit: number };
}> {
  const { data } = await api.get('/accounting/dashboard');
  return data;
}

// ============================================
// PERIODES COMPTABLES (Accounting Periods)
// ============================================

export async function listPeriods(): Promise<{ items: any[]; total: number }> {
  const { data } = await api.get('/accounting/periods');
  return data;
}

export async function createPeriod(body: {
  nom?: string;
  anneeFiscale: number;
  periode: number;
  dateDebut: string;
  dateFin: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/accounting/periods', body);
  return data;
}

export async function closePeriod(periodId: number): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/accounting/periods/${periodId}/close`);
  return data;
}

// ============ EXPORTS CSV ============

async function _downloadCsv(url: string, filename: string, params?: Record<string, any>) {
  const { data } = await api.get(url, { params, responseType: 'blob', transformResponse: [(d: any) => d] });
  const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export const exportJournalCsv = (params?: { dateDebut?: string; dateFin?: string }) =>
  _downloadCsv('/accounting/export/journal/csv', 'journal_comptable.csv', params);

export const exportTrialBalanceCsv = (params?: { dateFin?: string }) =>
  _downloadCsv('/accounting/export/trial-balance/csv', 'balance_verification.csv', params);

export const exportChartOfAccountsCsv = () =>
  _downloadCsv('/accounting/export/chart-of-accounts/csv', 'plan_comptable.csv');

export const exportLedgerCsv = (params: { compteCode: string; dateDebut?: string; dateFin?: string }) =>
  _downloadCsv('/accounting/export/ledger/csv', `grand_livre_${params.compteCode}.csv`, params);

export const exportTaxDeclarationCsv = (params: { dateDebut: string; dateFin: string }) =>
  _downloadCsv('/accounting/export/tax-declaration/csv', `declaration_taxes.csv`, params);

export const exportQuickbooksIif = (params?: { dateDebut?: string; dateFin?: string }) =>
  _downloadCsv('/accounting/export/quickbooks/iif', 'export_quickbooks.iif', params);

export const exportSage50Csv = (params?: { dateDebut?: string; dateFin?: string }) =>
  _downloadCsv('/accounting/export/sage50/csv', 'export_sage50.csv', params);

// ============ TAX DECLARATION ============

export interface TaxDeclaration {
  periode: { dateDebut: string; dateFin: string };
  tps: { collectee: number; payee: number; netDu: number };
  tvq: { collectee: number; payee: number; netDu: number };
  totalNet: number;
  breakdown: {
    mois: string;
    tpsCollectee: number; tpsPayee: number; tpsNet: number;
    tvqCollectee: number; tvqPayee: number; tvqNet: number;
  }[];
}

export async function getTaxDeclaration(params: { dateDebut: string; dateFin: string }): Promise<TaxDeclaration> {
  const { data } = await api.get('/accounting/tax-declaration', { params });
  return data;
}

// ============ RETENUES DE CHANTIER (Holdbacks) ============

export interface Holdback {
  id: number; factureId: number; numeroFacture?: string; clientNom?: string;
  montantRetenu: number; tauxRetenue: number;
  dateFinTravaux?: string; dateLiberation?: string; statut: string;
  notes?: string; createdAt?: string;
}

export async function listHoldbacks(params?: { statut?: string; page?: number; perPage?: number }): Promise<{ items: Holdback[]; total: number }> {
  const { data } = await api.get('/accounting/holdbacks', { params });
  return data;
}

export async function createHoldback(body: { factureId: number; montantRetenu?: number; tauxRetenue?: number; dateFinTravaux?: string; notes?: string }) {
  const { data } = await api.post('/accounting/holdbacks', body);
  return data;
}

export async function releaseHoldback(id: number, body?: { dateLiberation?: string; montantLibere?: number }) {
  const { data } = await api.put(`/accounting/holdbacks/${id}/release`, body || {});
  return data;
}

export async function listUpcomingHoldbacks(days?: number) {
  const { data } = await api.get('/accounting/holdbacks/upcoming', { params: { days: days || 35 } });
  return data;
}

// ============ IMMOBILISATIONS (Fixed Assets) ============

export interface FixedAsset {
  id: number; nom: string; description?: string; categorie: string;
  numeroSerie?: string; dateAcquisition: string; coutAcquisition: number;
  dureeVieMois: number; methodeAmortissement: string; tauxDegressif?: number;
  valeurResiduelle: number; statut: string; amortCumule?: number; valeurNette?: number;
  notes?: string; createdAt?: string;
}

export async function listFixedAssets(params?: { page?: number; perPage?: number; categorie?: string }): Promise<{ items: FixedAsset[]; total: number }> {
  const { data } = await api.get('/accounting/fixed-assets', { params });
  return data;
}

export async function createFixedAsset(body: {
  nom: string; description?: string; categorie?: string; numeroSerie?: string;
  dateAcquisition: string; coutAcquisition: number; dureeVieMois?: number;
  methodeAmortissement?: string; tauxDegressif?: number; valeurResiduelle?: number;
  notes?: string;
}) {
  const { data } = await api.post('/accounting/fixed-assets', body);
  return data;
}

export async function getFixedAssetsSummary() {
  const { data } = await api.get('/accounting/fixed-assets/summary');
  return data;
}

export async function getDepreciationSchedule(assetId: number) {
  const { data } = await api.get(`/accounting/fixed-assets/${assetId}/schedule`);
  return data;
}

export async function generateDepreciation(mois: string) {
  const { data } = await api.post('/accounting/fixed-assets/generate-depreciation', null, { params: { mois } });
  return data;
}

// ============================================
// RÉCURRENCE — Templates de factures récurrentes
// ============================================

export interface RecurringInvoiceLine {
  description: string;
  quantite: number;
  prixUnitaire: number;
  unite?: string;
}

export type RecurringFrequence =
  | 'hebdomadaire'
  | 'bimensuel'
  | 'mensuel'
  | 'bimestriel'
  | 'trimestriel'
  | 'semestriel'
  | 'annuel';

export type RecurringStatut = 'ACTIVE' | 'PAUSEE' | 'TERMINEE' | 'ANNULEE';

export interface RecurringInvoice {
  id: number;
  nom: string;
  clientCompanyId: number;
  clientNom?: string;
  projectId?: number;
  frequence: RecurringFrequence;
  intervalCount: number;
  dateDebut: string;
  dateFin?: string;
  prochaineDate: string;
  nbOccurrencesMax?: number;
  nbOccurrencesGenerees: number;
  nbRestantes?: number | null;
  derniereGenerationLe?: string;
  derniereFactureId?: number;
  statut: RecurringStatut;
  statutFactureGenere: 'BROUILLON' | 'ENVOYEE';
  autoEnvoiEmail: boolean;
  emailDestinataire?: string;
  conditionsPaiement?: string;
  notes?: string;
  notesInternes?: string;
  templateLignes: RecurringInvoiceLine[];
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export async function listRecurringInvoices(params?: {
  statut?: RecurringStatut;
  page?: number;
  perPage?: number;
}): Promise<{ items: RecurringInvoice[]; total: number }> {
  const { data } = await api.get('/accounting/recurring-invoices', { params });
  return data;
}

export async function getRecurringInvoice(id: number): Promise<RecurringInvoice> {
  const { data } = await api.get(`/accounting/recurring-invoices/${id}`);
  return data;
}

export async function createRecurringInvoice(body: {
  nom: string;
  clientCompanyId: number;
  projectId?: number;
  frequence: RecurringFrequence;
  intervalCount?: number;
  dateDebut: string;
  dateFin?: string;
  nbOccurrencesMax?: number;
  statutFactureGenere?: 'BROUILLON' | 'ENVOYEE';
  autoEnvoiEmail?: boolean;
  emailDestinataire?: string;
  conditionsPaiement?: string;
  notes?: string;
  notesInternes?: string;
  lignes: RecurringInvoiceLine[];
}): Promise<{ id: number; message: string; prochaineDate: string }> {
  const payload = {
    nom: body.nom,
    client_company_id: body.clientCompanyId,
    project_id: body.projectId,
    frequence: body.frequence,
    interval_count: body.intervalCount ?? 1,
    date_debut: body.dateDebut,
    date_fin: body.dateFin,
    nb_occurrences_max: body.nbOccurrencesMax,
    statut_facture_genere: body.statutFactureGenere ?? 'BROUILLON',
    auto_envoi_email: body.autoEnvoiEmail ?? false,
    email_destinataire: body.emailDestinataire,
    conditions_paiement: body.conditionsPaiement,
    notes: body.notes,
    notes_internes: body.notesInternes,
    lignes: body.lignes.map((l) => ({
      description: l.description,
      quantite: l.quantite,
      prix_unitaire: l.prixUnitaire,
      unite: l.unite,
    })),
  };
  const { data } = await api.post('/accounting/recurring-invoices', payload);
  return data;
}

export async function updateRecurringInvoice(
  id: number,
  body: Partial<{
    nom: string;
    clientCompanyId: number;
    projectId: number;
    frequence: RecurringFrequence;
    intervalCount: number;
    dateFin: string;
    nbOccurrencesMax: number;
    statutFactureGenere: 'BROUILLON' | 'ENVOYEE';
    autoEnvoiEmail: boolean;
    emailDestinataire: string;
    conditionsPaiement: string;
    notes: string;
    notesInternes: string;
    lignes: RecurringInvoiceLine[];
    prochaineDate: string;
  }>
): Promise<{ id: number; message: string }> {
  const payload: any = {};
  if (body.nom !== undefined) payload.nom = body.nom;
  if (body.clientCompanyId !== undefined) payload.client_company_id = body.clientCompanyId;
  if (body.projectId !== undefined) payload.project_id = body.projectId;
  if (body.frequence !== undefined) payload.frequence = body.frequence;
  if (body.intervalCount !== undefined) payload.interval_count = body.intervalCount;
  if (body.dateFin !== undefined) payload.date_fin = body.dateFin;
  if (body.nbOccurrencesMax !== undefined) payload.nb_occurrences_max = body.nbOccurrencesMax;
  if (body.statutFactureGenere !== undefined) payload.statut_facture_genere = body.statutFactureGenere;
  if (body.autoEnvoiEmail !== undefined) payload.auto_envoi_email = body.autoEnvoiEmail;
  if (body.emailDestinataire !== undefined) payload.email_destinataire = body.emailDestinataire;
  if (body.conditionsPaiement !== undefined) payload.conditions_paiement = body.conditionsPaiement;
  if (body.notes !== undefined) payload.notes = body.notes;
  if (body.notesInternes !== undefined) payload.notes_internes = body.notesInternes;
  if (body.prochaineDate !== undefined) payload.prochaine_date = body.prochaineDate;
  if (body.lignes !== undefined) {
    payload.lignes = body.lignes.map((l) => ({
      description: l.description,
      quantite: l.quantite,
      prix_unitaire: l.prixUnitaire,
      unite: l.unite,
    }));
  }
  const { data } = await api.put(`/accounting/recurring-invoices/${id}`, payload);
  return data;
}

export async function deleteRecurringInvoice(id: number): Promise<{ id: number; message: string }> {
  const { data } = await api.delete(`/accounting/recurring-invoices/${id}`);
  return data;
}

export async function pauseRecurringInvoice(id: number): Promise<{ id: number; statut: string; message: string }> {
  const { data } = await api.post(`/accounting/recurring-invoices/${id}/pause`);
  return data;
}

export async function resumeRecurringInvoice(id: number): Promise<{ id: number; statut: string; message: string }> {
  const { data } = await api.post(`/accounting/recurring-invoices/${id}/resume`);
  return data;
}

export async function generateRecurringNow(id: number): Promise<{ id: number; recurringId: number; message: string }> {
  // L'intercepteur axios convertit snake_case → camelCase (client.ts:110)
  const { data } = await api.post(`/accounting/recurring-invoices/${id}/generate-now`);
  return data;
}

// ============================================
// RAPPELS DE PAIEMENT
// ============================================

export interface InvoiceReminder {
  id: number;
  factureId: number;
  niveau: 1 | 2 | 3 | 4;
  dateEnvoi: string;
  destinataire: string;
  sujet?: string;
  statut: 'ENVOYE' | 'OUVERT' | 'ECHEC';
  erreur?: string;
  envoyePar?: string;
  auto: boolean;
  createdAt?: string;
}

export async function sendInvoiceReminder(
  invoiceId: number,
  body: {
    niveau: 1 | 2 | 3 | 4;
    toEmailOverride?: string;
    messageOverride?: string;
  }
): Promise<{ id: number; invoiceId: number; niveau: number; message: string }> {
  const payload = {
    niveau: body.niveau,
    to_email_override: body.toEmailOverride,
    message_override: body.messageOverride,
    auto: false,
  };
  // L'intercepteur axios convertit snake_case → camelCase (client.ts:110)
  const { data } = await api.post(`/accounting/invoices/${invoiceId}/send-reminder`, payload);
  return data;
}

export async function listInvoiceReminders(
  invoiceId: number
): Promise<{ items: InvoiceReminder[]; total: number }> {
  const { data } = await api.get(`/accounting/invoices/${invoiceId}/reminders`);
  return data;
}

export async function toggleInvoiceReminders(
  invoiceId: number
): Promise<{ id: number; rappelsActifs: boolean }> {
  // L'intercepteur axios convertit snake_case → camelCase (client.ts:110)
  const { data } = await api.put(`/accounting/invoices/${invoiceId}/reminders/toggle`);
  return data;
}

// ============ Invoice HTML Generation ============

export interface GenerateInvoiceHtmlResponse {
  html: string;
  invoiceId: number;
  numero: string;
}

export async function generateInvoiceHtml(invoiceId: number): Promise<GenerateInvoiceHtmlResponse> {
  const { data } = await api.post(`/accounting/invoices/${invoiceId}/generate-html`);
  return data;
}

// ============ Invoice PDF / Email / Avoir ============

/**
 * Telecharge la facture au format PDF (rendu via WeasyPrint cote backend).
 * Force le download navigateur en utilisant un blob.
 */
export async function downloadInvoicePdf(invoiceId: number, filename?: string): Promise<void> {
  const { data } = await api.get(`/accounting/invoices/${invoiceId}/pdf`, {
    responseType: 'blob',
    transformResponse: [(d: any) => d],
  });
  const blob = new Blob([data], { type: 'application/pdf' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename || `facture-${invoiceId}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

/**
 * Reponse de sendInvoiceByEmail.
 * NOTE: les cles sont en camelCase car l'intercepteur axios (client.ts:110)
 * convertit automatiquement les responses snake_case -> camelCase via
 * transformKeys. Le backend retourne snake_case mais le code TS lit camel.
 */
export interface SendInvoiceResponse {
  message: string;
  invoiceId: number;
  toEmail: string;
  statut: string;
  pdfSizeBytes: number;
  journalEntryId?: number;
}

/**
 * Envoie la facture par courriel au destinataire avec PDF en piece jointe.
 * Bascule statut BROUILLON -> ENVOYEE + cree ecriture comptable automatiquement.
 */
export async function sendInvoiceByEmail(
  invoiceId: number,
  body: {
    toEmail: string;
    cc?: string;
    bcc?: string;
    subjectOverride?: string;
    messageOverride?: string;
  }
): Promise<SendInvoiceResponse> {
  const payload = {
    to_email: body.toEmail,
    cc: body.cc || undefined,
    bcc: body.bcc || undefined,
    subject_override: body.subjectOverride || undefined,
    message_override: body.messageOverride || undefined,
  };
  const { data } = await api.post(`/accounting/invoices/${invoiceId}/send`, payload);
  return data;
}

/**
 * Reponse de createCreditNote.
 * camelCase apres conversion automatique par l'intercepteur axios.
 */
export interface CreditNoteResponse {
  id: number;
  numeroFacture: string;
  typeDocument: 'AVOIR';
  factureOrigineId: number;
  montantTtc: number;
  statut: string;
  message: string;
}

/**
 * Cree une note de credit (AVOIR) referencant une facture origine.
 * Conformite Revenu Quebec art. 350 LTVQ pour rembourser des taxes.
 */
export async function createCreditNote(
  invoiceId: number,
  body: {
    raison: string;
    montantTotal?: number;
    dateAvoir?: string;
    notesInternes?: string;
  }
): Promise<CreditNoteResponse> {
  const payload = {
    raison: body.raison,
    montant_total: body.montantTotal,
    date_avoir: body.dateAvoir || undefined,
    notes_internes: body.notesInternes || undefined,
  };
  const { data } = await api.post(`/accounting/invoices/${invoiceId}/credit-note`, payload);
  return data;
}
