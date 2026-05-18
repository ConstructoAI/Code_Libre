/**
 * ERP React Frontend - Comptabilite Page
 * Accounting: journal, invoices, chart of accounts, financial summary.
 */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Calculator, Receipt, BookOpen, DollarSign, FileText, AlertCircle,
  CheckCircle, Clock, Plus, X, Printer, BarChart3, Target,
  ArrowUpDown, PieChart, Calendar, Lock, Eye, Pencil, RefreshCw,
  Camera, Sparkles, Upload, Send, Trash2, Mail, FileMinus2, Download,
  Repeat, Bell, History, Play, Pause,
} from 'lucide-react';
import * as accountingApi from '@/api/accounting';
import { openInvoiceExport } from '@/api/exports';
import * as companiesApi from '@/api/companies';
import * as projectsApi from '@/api/projects';
import * as suppliersApi from '@/api/suppliers';
import type { JournalEntry, Invoice, ChartAccount, FinancialSummary, InvoiceScanResult } from '@/api/accounting';
import type { Company } from '@/api/companies';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Alert } from '@/components/ui/Alert';
import StatCard from '@/components/dashboard/StatCard';
import { formatDate, formatCurrency } from '@/utils/format';

/**
 * Parse un montant en supportant la virgule francaise (1,50 -> 1.5).
 * Returns 0 pour valeurs vides ou invalides.
 * Returns 0 pour montants negatifs (refus silencieux UI; le backend valide aussi).
 */
const parseAmount = (s: string | number | undefined): number => {
  if (s === undefined || s === null || s === '') return 0;
  const str = String(s).trim().replace(',', '.');
  const n = parseFloat(str);
  if (isNaN(n) || n < 0) return 0;
  return n;
};

type TabKey = 'factures' | 'recurring' | 'journal' | 'plan_comptable' | 'grand_livre' | 'etats_financiers' | 'centres_couts' | 'transactions' | 'dashboard_financier' | 'periodes' | 'retenues' | 'immobilisations';

const TABS: { key: TabKey; label: string; shortLabel: string; icon: React.ReactNode }[] = [
  { key: 'factures', label: 'Factures', shortLabel: 'Factures', icon: <Receipt size={16} /> },
  { key: 'recurring', label: 'Récurrence', shortLabel: 'Récur.', icon: <Repeat size={16} /> },
  { key: 'journal', label: 'Journal', shortLabel: 'Journal', icon: <BookOpen size={16} /> },
  { key: 'transactions', label: 'Transactions', shortLabel: 'Trans.', icon: <ArrowUpDown size={16} /> },
  { key: 'dashboard_financier', label: 'Dashboard', shortLabel: 'Dash.', icon: <PieChart size={16} /> },
  { key: 'plan_comptable', label: 'Plan comptable', shortLabel: 'Plan', icon: <FileText size={16} /> },
  { key: 'grand_livre', label: 'Grand Livre', shortLabel: 'G.Livre', icon: <Calculator size={16} /> },
  { key: 'etats_financiers', label: 'États Financiers', shortLabel: 'États', icon: <BarChart3 size={16} /> },
  { key: 'centres_couts', label: 'Centres de Coûts', shortLabel: 'Coûts', icon: <Target size={16} /> },
  { key: 'periodes', label: 'Périodes', shortLabel: 'Périodes', icon: <Calendar size={16} /> },
  { key: 'retenues', label: 'Retenues', shortLabel: 'Ret.', icon: <Lock size={16} /> },
  { key: 'immobilisations', label: 'Immobilisations', shortLabel: 'Immo.', icon: <Target size={16} /> },
];

const INVOICE_STATUT_COLORS: Record<string, 'blue' | 'green' | 'yellow' | 'red' | 'gray' | 'indigo'> = {
  'BROUILLON': 'gray', 'ENVOYEE': 'indigo', 'PAYEE': 'green',
  'PARTIELLE': 'yellow', 'PARTIELLEMENT_PAYEE': 'yellow',
  'EN_RETARD': 'red', 'ANNULEE': 'gray',
};

const INVOICE_STATUT_LABEL: Record<string, string> = {
  'BROUILLON': 'Brouillon', 'ENVOYEE': 'Envoyée', 'PAYEE': 'Payée',
  'PARTIELLE': 'Part. payée', 'PARTIELLEMENT_PAYEE': 'Part. payée',
  'EN_RETARD': 'En retard', 'ANNULEE': 'Annulée',
};

const INVOICE_PIPELINE_STEPS = [
  { key: 'BROUILLON', label: 'Brouillon', desc: 'Modifiable, pas envoyée' },
  { key: 'ENVOYEE', label: 'Envoyée', desc: 'Génère écriture comptable' },
  { key: 'PARTIELLEMENT_PAYEE', label: 'Part. payée', desc: 'Paiement partiel reçu' },
  { key: 'PAYEE', label: 'Payée', desc: 'Solde à zéro' },
];

const JOURNAL_STATUT_COLORS: Record<string, 'blue' | 'green' | 'gray'> = {
  'BROUILLON': 'gray', 'VALIDEE': 'green', 'ANNULEE': 'gray',
};

const PAIEMENT_OPTIONS = [
  { value: 'Net 15', label: 'Net 15' },
  { value: 'Net 30', label: 'Net 30' },
  { value: 'Net 45', label: 'Net 45' },
  { value: 'Net 60', label: 'Net 60' },
  { value: 'Net 90', label: 'Net 90' },
];

const JOURNAL_TYPE_OPTIONS = [
  { value: 'VENTE', label: 'Vente' },
  { value: 'ACHAT', label: 'Achat' },
  { value: 'SALAIRE', label: 'Salaire' },
  { value: 'AJUSTEMENT', label: 'Ajustement' },
  { value: 'AUTRE', label: 'Autre' },
];

// ============================================
// Local types for Etats Financiers + Dashboard
// (les endpoints retournent des structures dynamiques, on liste
// les champs effectivement consommes par le JSX)
// ============================================
interface BalanceLine { code?: string; nom?: string; solde?: number }
interface BalanceSheetData {
  actifsCourtTerme?: BalanceLine[];
  actifsLongTerme?: BalanceLine[];
  passifsCourtTerme?: BalanceLine[];
  passifsLongTerme?: BalanceLine[];
  capitaux?: BalanceLine[];
  capitauxPropres?: BalanceLine[];
  totalActifsCourtTerme?: number;
  totalActifsLongTerme?: number;
  totalPassifsCourtTerme?: number;
  totalPassifsLongTerme?: number;
  totalCapitaux?: number;
  totalCapitauxPropres?: number;
  totalActifs?: number;
  actifTotal?: number;
  totalPassifsEtCapitaux?: number;
}

interface IncomeStatementLine { code?: string; nom?: string; montant?: number }
interface IncomeStatementData {
  revenus?: IncomeStatementLine[];
  coutsContrats?: IncomeStatementLine[];
  couts?: IncomeStatementLine[];
  coutsVentes?: IncomeStatementLine[];
  fraisExploitation?: IncomeStatementLine[];
  totalRevenus?: number;
  totalCoutsContrats?: number;
  totalFraisExploitation?: number;
  margeBrute?: number;
  resultatNet?: number;
}

interface CashFlowRow {
  mois?: string;
  month?: string;
  entrees?: number;
  inflows?: number;
  sorties?: number;
  outflows?: number;
  net?: number;
}

interface DashboardMonthlyRow {
  mois: string;
  revenus: number;
  depenses: number;
  profit: number;
}

interface DashboardData {
  monthlyData?: DashboardMonthlyRow[];
  totals?: { ca?: number; depenses?: number; profit?: number };
}

export default function ComptabilitePage() {
  const [tab, setTab] = useState<TabKey>('factures');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 20;

  // Summary
  const [summary, setSummary] = useState<FinancialSummary | null>(null);

  // Invoices
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesTotal, setInvoicesTotal] = useState(0);
  const [invoiceStatut, setInvoiceStatut] = useState('');

  // Journal
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [journalTotal, setJournalTotal] = useState(0);

  // Chart of accounts
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);

  // Grand Livre
  const [ledgerAccounts, setLedgerAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);

  // États Financiers
  const [_trialBalance, _setTrialBalance] = useState<any>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetData | null>(null);
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatementData | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowRow[]>([]);
  const [finSubTab, setFinSubTab] = useState<'bilan' | 'resultats' | 'flux' | 'taxes'>('bilan');
  const [taxDeclaration, setTaxDeclaration] = useState<any>(null);
  const [taxPeriod, setTaxPeriod] = useState({ dateDebut: `${new Date().getFullYear()}-01-01`, dateFin: `${new Date().getFullYear()}-12-31` });

  // Centres de Couts
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [costCentersSummary, setCostCentersSummary] = useState<any[]>([]);
  const [showCreateCostCenter, setShowCreateCostCenter] = useState(false);
  const [costCenterForm, setCostCenterForm] = useState({ code: '', nom: '', type: '', budgetAnnuel: '' });
  const [costCenterFormLoading, setCostCenterFormLoading] = useState(false);
  const [costCenterFormError, setCostCenterFormError] = useState<string | null>(null);

  // Transactions
  const [transactions, setTransactions] = useState<any[]>([]);
  const [transactionsTotal, setTransactionsTotal] = useState(0);
  const [transactionTypeFilter, setTransactionTypeFilter] = useState('');

  // Dashboard Financier
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);

  // Periodes Comptables
  const [periods, setPeriods] = useState<any[]>([]);
  const [showCreatePeriod, setShowCreatePeriod] = useState(false);
  const [periodForm, setPeriodForm] = useState({ nom: '', anneeFiscale: '', periode: '', dateDebut: '', dateFin: '' });
  const [periodFormLoading, setPeriodFormLoading] = useState(false);
  const [periodFormError, setPeriodFormError] = useState<string | null>(null);

  // Retenues de Chantier
  const [holdbacks, setHoldbacks] = useState<any[]>([]);
  const [holdbacksTotal, setHoldbacksTotal] = useState(0);

  // Immobilisations
  const [fixedAssets, setFixedAssets] = useState<any[]>([]);
  const [fixedAssetsTotal, setFixedAssetsTotal] = useState(0);
  const [fixedAssetsSummary, setFixedAssetsSummary] = useState<any>(null);
  const [showCreateAsset, setShowCreateAsset] = useState(false);
  const [assetForm, setAssetForm] = useState({ nom: '', categorie: 'EQUIPEMENT', dateAcquisition: '', coutAcquisition: '', dureeVieMois: '60', methodeAmortissement: 'LINEAIRE', valeurResiduelle: '0', notes: '' });
  const [assetFormLoading, setAssetFormLoading] = useState(false);
  const [depreciationMonth, setDepreciationMonth] = useState(new Date().toISOString().slice(0, 7));

  // Create Invoice state
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState<{
    clientCompanyId: string; projectId: string; dateFacture: string;
    dateEcheance: string; conditionsPaiement: string; notes: string; notesInternes: string;
    fournisseurId?: string; typeDestinataire?: string; numeroFactureFournisseur?: string;
  }>({
    clientCompanyId: '',
    projectId: '',
    dateFacture: new Date().toISOString().split('T')[0],
    dateEcheance: '',
    conditionsPaiement: 'Net 30',
    notes: '',
    notesInternes: '',
  });
  const [invoiceLines, setInvoiceLines] = useState([
    { description: '', quantite: 1, prixUnitaire: 0 },
    { description: '', quantite: 1, prixUnitaire: 0 },
    { description: '', quantite: 1, prixUnitaire: 0 },
  ]);
  const [invoiceFormLoading, setInvoiceFormLoading] = useState(false);
  const [invoiceFormError, setInvoiceFormError] = useState<string | null>(null);
  const [companiesList, setCompaniesList] = useState<Company[]>([]);
  const [suppliersList, setSuppliersList] = useState<{ id: number; nom: string }[]>([]);

  // AI Scan state
  const [showScanInvoice, setShowScanInvoice] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<InvoiceScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanFileRef = useRef<HTMLInputElement>(null);
  const [_contactsList, setContactsList] = useState<{ id: number; prenom: string; nomFamille?: string; nom?: string; companyNom?: string }[]>([]);
  const [projectsList, setProjectsList] = useState<{ id: number; nomProjet: string }[]>([]);

  // Payment state
  const [showPayment, setShowPayment] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [paymentForm, setPaymentForm] = useState({ montant: '', datePaiement: '', modePaiement: 'Virement', reference: '' });
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Invoice HTML preview state
  const [invoiceHtmlContent, setInvoiceHtmlContent] = useState('');
  const [showInvoiceHtmlPreview, setShowInvoiceHtmlPreview] = useState(false);
  const [invoiceHtmlLoading, setInvoiceHtmlLoading] = useState<number | null>(null);

  // Edit Invoice state
  const [showEditInvoice, setShowEditInvoice] = useState(false);
  const [editInvoiceId, setEditInvoiceId] = useState<number | null>(null);
  const [editInvoiceForm, setEditInvoiceForm] = useState({
    clientCompanyId: '',
    projectId: '',
    dateFacture: '',
    dateEcheance: '',
    conditionsPaiement: 'Net 30',
    notes: '',
    notesInternes: '',
    statut: 'BROUILLON',
  });
  const [editInvoiceLines, setEditInvoiceLines] = useState<{ id?: number; description: string; quantite: number; prixUnitaire: number }[]>([]);
  const [editInvoiceNumero, setEditInvoiceNumero] = useState('');
  const [editInvoiceFormLoading, setEditInvoiceFormLoading] = useState(false);
  const [editInvoiceFormError, setEditInvoiceFormError] = useState<string | null>(null);

  // Send Invoice by Email state (modal)
  const [showSendInvoice, setShowSendInvoice] = useState(false);
  const [sendInvoiceTarget, setSendInvoiceTarget] = useState<Invoice | null>(null);
  const [sendInvoiceForm, setSendInvoiceForm] = useState({
    toEmail: '', cc: '', subjectOverride: '', messageOverride: '',
  });
  const [sendInvoiceLoading, setSendInvoiceLoading] = useState(false);
  const [sendInvoiceError, setSendInvoiceError] = useState<string | null>(null);

  // Credit Note (avoir / note de credit) state
  const [showCreditNote, setShowCreditNote] = useState(false);
  const [creditNoteTarget, setCreditNoteTarget] = useState<Invoice | null>(null);
  const [creditNoteForm, setCreditNoteForm] = useState({
    raison: '', montantTotal: '', dateAvoir: '', notesInternes: '',
  });
  const [creditNoteLoading, setCreditNoteLoading] = useState(false);
  const [creditNoteError, setCreditNoteError] = useState<string | null>(null);

  // PDF download tracking (par invoice id)
  const [pdfLoadingId, setPdfLoadingId] = useState<number | null>(null);

  // Track manuelle edition date_echeance (pour eviter auto-recalcul ecrasant)
  const [dateEcheanceTouched, setDateEcheanceTouched] = useState(false);

  // Recurring invoice state (modal "Convertir en recurrente")
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [recurringSourceInvoice, setRecurringSourceInvoice] = useState<Invoice | null>(null);
  const [recurringForm, setRecurringForm] = useState({
    nom: '',
    frequence: 'mensuel' as accountingApi.RecurringFrequence,
    intervalCount: 1,
    dateDebut: new Date().toISOString().split('T')[0],
    dateFin: '',
    nbOccurrencesMax: '',
    statutFactureGenere: 'BROUILLON' as 'BROUILLON' | 'ENVOYEE',
    autoEnvoiEmail: false,
    emailDestinataire: '',
    notes: '',
  });
  const [recurringLoading, setRecurringLoading] = useState(false);
  const [recurringError, setRecurringError] = useState<string | null>(null);

  // Reminder send state
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderTarget, setReminderTarget] = useState<Invoice | null>(null);
  const [reminderForm, setReminderForm] = useState<{
    niveau: 1 | 2 | 3 | 4;
    toEmailOverride: string;
    messageOverride: string;
  }>({
    niveau: 1,
    toEmailOverride: '',
    messageOverride: '',
  });
  const [reminderLoading, setReminderLoading] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);

  // Reminders history modal
  const [showRemindersHistory, setShowRemindersHistory] = useState(false);
  const [remindersHistoryItems, setRemindersHistoryItems] = useState<accountingApi.InvoiceReminder[]>([]);
  const [remindersHistoryLoading, setRemindersHistoryLoading] = useState(false);
  const [remindersHistoryInvoice, setRemindersHistoryInvoice] = useState<Invoice | null>(null);

  // Recurring templates list (FIX P0 B5: gestion templates dans onglet dédié)
  const [recurringList, setRecurringList] = useState<accountingApi.RecurringInvoice[]>([]);
  const [recurringTotal, setRecurringTotal] = useState(0);
  const [recurringStatutFilter, setRecurringStatutFilter] = useState<accountingApi.RecurringStatut | ''>('');
  const [recurringPage, setRecurringPage] = useState(1);
  const [recurringActionLoading, setRecurringActionLoading] = useState<number | null>(null);

  // Sync state
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const hasSyncedRef = useRef(false);

  // Loading state pour la suppression de facture (race condition guard)
  const [isDeletingInvoice, setIsDeletingInvoice] = useState<number | null>(null);
  // Info message lorsqu'une suppression auto contre-passee a reussi
  const [deleteSuccessMessage, setDeleteSuccessMessage] = useState<{ message: string; reversed: number } | null>(null);

  // Cleanup tracker for async imports (prevent setState after unmount)
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Auto-open from ?open= query param (cross-navigation from Dossier 360)
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenHandled = useRef(false);
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId && !autoOpenHandled.current && invoices.length > 0) {
      const inv = invoices.find((i) => i.id === Number(openId));
      if (inv) {
        autoOpenHandled.current = true;
        setTab('factures');
        openEditInvoice(inv);
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('open');
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [searchParams, invoices]);

  // Create Journal Entry state
  const [showCreateJournal, setShowCreateJournal] = useState(false);
  const [journalForm, setJournalForm] = useState({
    description: '',
    type: 'VENTE',
  });
  const [journalLines, setJournalLines] = useState<{ compteCode: string; libelle: string; debit: string; credit: string }[]>([
    { compteCode: '', libelle: '', debit: '', credit: '' },
    { compteCode: '', libelle: '', debit: '', credit: '' },
  ]);
  const [journalFormLoading, setJournalFormLoading] = useState(false);
  const [journalFormError, setJournalFormError] = useState<string | null>(null);

  // Derive balance debit-credit pour validation cote front
  const journalLinesBalance = useMemo(() => {
    let totalDebit = 0;
    let totalCredit = 0;
    for (const l of journalLines) {
      const d = parseAmount(l.debit);
      const c = parseAmount(l.credit);
      totalDebit += d;
      totalCredit += c;
    }
    return totalDebit - totalCredit;
  }, [journalLines]);

  const journalLinesNonEmpty = useMemo(
    () => journalLines.filter((l) => parseAmount(l.debit) > 0 || parseAmount(l.credit) > 0),
    [journalLines]
  );

  // Lignes valides envoyables au backend = montant non nul ET compte_code rempli.
  // Backend Pydantic exige >= 2 lignes valides; le bouton "Creer" doit donc
  // verifier ce critere strict (pas juste >= 2 lignes avec montant).
  const journalLinesValid = useMemo(
    () => journalLinesNonEmpty.filter((l) => l.compteCode.trim().length > 0),
    [journalLinesNonEmpty]
  );

  const journalIsBalanced = Math.abs(journalLinesBalance) <= 0.01;
  const journalCanCreate = journalIsBalanced
    && !!journalForm.description.trim()
    && journalLinesValid.length >= 2;

  const fetchSummary = useCallback(async () => {
    try {
      const s = await accountingApi.getFinancialSummary();
      setSummary(s);
    } catch { /* ignore */ }
  }, []);

  const fetchInvoices = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await accountingApi.listInvoices({
        page, perPage, statut: invoiceStatut || undefined,
      });
      setInvoices(res.items);
      setInvoicesTotal(res.total);
    } catch (err: any) { setError(err?.response?.data?.detail || 'Erreur lors du chargement des factures'); }
    finally { setIsLoading(false); }
  }, [page, invoiceStatut]);

  const fetchJournal = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await accountingApi.listJournalEntries({ page, perPage });
      setJournal(res.items);
      setJournalTotal(res.total);
    } catch (err: any) { setError(err?.response?.data?.detail || 'Erreur lors du chargement du journal'); }
    finally { setIsLoading(false); }
  }, [page]);

  // FIX P0 B5: fetch des templates recurrents pour onglet dédié
  const fetchRecurring = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await accountingApi.listRecurringInvoices({
        statut: recurringStatutFilter || undefined,
        page: recurringPage,
        perPage,
      });
      setRecurringList(res.items);
      setRecurringTotal(res.total);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors du chargement des templates recurrents');
    } finally {
      setIsLoading(false);
    }
  }, [recurringPage, recurringStatutFilter]);

  // Handlers actions templates récurrents
  const handlePauseRecurring = async (id: number) => {
    if (recurringActionLoading !== null) return;
    setRecurringActionLoading(id);
    try {
      await accountingApi.pauseRecurringInvoice(id);
      setDeleteSuccessMessage({ message: `Template #${id} en pause`, reversed: 0 });
      fetchRecurring();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur pause template');
    } finally {
      setRecurringActionLoading(null);
    }
  };

  const handleResumeRecurring = async (id: number) => {
    if (recurringActionLoading !== null) return;
    setRecurringActionLoading(id);
    try {
      await accountingApi.resumeRecurringInvoice(id);
      setDeleteSuccessMessage({ message: `Template #${id} reactive`, reversed: 0 });
      fetchRecurring();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur reactivation template');
    } finally {
      setRecurringActionLoading(null);
    }
  };

  const handleGenerateNowRecurring = async (id: number) => {
    if (recurringActionLoading !== null) return;
    if (!window.confirm(`Generer immediatement une facture depuis le template #${id} ?`)) return;
    setRecurringActionLoading(id);
    try {
      const res = await accountingApi.generateRecurringNow(id);
      setDeleteSuccessMessage({
        message: `Facture #${res.id} generee depuis le template #${id}`,
        reversed: 0,
      });
      fetchRecurring();
      fetchInvoices();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur generation immediate');
    } finally {
      setRecurringActionLoading(null);
    }
  };

  const handleDeleteRecurring = async (id: number) => {
    if (recurringActionLoading !== null) return;
    if (!window.confirm(`Annuler definitivement le template #${id} ? Les factures deja generees resteront intactes.`)) return;
    setRecurringActionLoading(id);
    try {
      await accountingApi.deleteRecurringInvoice(id);
      setDeleteSuccessMessage({ message: `Template #${id} annule`, reversed: 0 });
      fetchRecurring();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur suppression template');
    } finally {
      setRecurringActionLoading(null);
    }
  };

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await accountingApi.getChartOfAccounts();
      setAccounts(res.items);
    } catch (err: any) { setError(err?.response?.data?.detail || 'Erreur lors du chargement du plan comptable'); }
    finally { setIsLoading(false); }
  }, []);

  const fetchCompaniesForDropdown = useCallback(async () => {
    try {
      const res = await companiesApi.listCompanies({ page: 1, perPage: 100 });
      setCompaniesList(res.items);
    } catch { /* ignore */ }
  }, []);

  const fetchLedgerAccounts = useCallback(async () => {
    try {
      const res = await accountingApi.getLedgerAccounts();
      setLedgerAccounts(res.items || []);
    } catch { /* ignore */ }
  }, []);

  const fetchLedgerForAccount = useCallback(async (compteCode: string) => {
    if (!compteCode) return;
    setIsLoading(true);
    try {
      const res = await accountingApi.getLedger({ compteCode });
      setLedgerEntries(res.items || []);
    } catch (err: any) { setError(err?.response?.data?.detail || 'Erreur chargement grand livre'); }
    finally { setIsLoading(false); }
  }, []);

  const fetchBalanceSheet = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!hasSyncedRef.current) {
        try { await accountingApi.syncAccounting(); hasSyncedRef.current = true; } catch { /* non-blocking */ }
      }
      const res = await accountingApi.getBalanceSheet();
      setBalanceSheet(res);
    } catch (err: any) { setError(err?.response?.data?.detail || 'Erreur chargement bilan'); }
    finally { setIsLoading(false); }
  }, []);

  const fetchIncomeStatement = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await accountingApi.getIncomeStatement();
      setIncomeStatement(res);
    } catch (err: any) { setError(err?.response?.data?.detail || 'Erreur chargement resultats'); }
    finally { setIsLoading(false); }
  }, []);

  const fetchCashFlow = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await accountingApi.getCashFlow();
      setCashFlow(res.items || res.months || []);
    } catch (err: any) { setError(err?.response?.data?.detail || 'Erreur chargement flux'); }
    finally { setIsLoading(false); }
  }, []);

  const fetchCostCenters = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await accountingApi.getCostCenters();
      setCostCenters(res.items || []);
    } catch (err: any) { setError(err?.response?.data?.detail || 'Erreur chargement centres de couts'); }
    finally { setIsLoading(false); }
  }, []);

  const fetchCostCentersSummary = useCallback(async () => {
    try {
      if (!hasSyncedRef.current) {
        try { await accountingApi.syncAccounting(); hasSyncedRef.current = true; } catch { /* non-blocking */ }
      }
      const res = await accountingApi.getCostCentersSummary();
      setCostCentersSummary(res.items || []);
    } catch { /* ignore */ }
  }, []);

  const fetchTransactions = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await accountingApi.listTransactions({
        page, perPage, typeFilter: transactionTypeFilter || undefined,
      });
      setTransactions(res.items || []);
      setTransactionsTotal(res.total || 0);
    } catch (err: any) { setError(err?.response?.data?.detail || 'Erreur chargement transactions'); }
    finally { setIsLoading(false); }
  }, [page, transactionTypeFilter]);

  const fetchDashboard = useCallback(async () => {
    setIsLoading(true);
    try {
      // Auto-sync on first load to generate journal entries from factures/BC
      if (!hasSyncedRef.current) {
        try { await accountingApi.syncAccounting(); hasSyncedRef.current = true; } catch { /* non-blocking */ }
      }
      const res = await accountingApi.getFinancialDashboard();
      setDashboardData(res);
    } catch (err: any) { setError(err?.response?.data?.detail || 'Erreur chargement dashboard'); }
    finally { setIsLoading(false); }
  }, []);

  const handleManualSync = useCallback(async () => {
    setSyncLoading(true);
    setSyncMessage(null);
    try {
      const res = await accountingApi.syncAccounting();
      setSyncMessage(res.message);
      hasSyncedRef.current = true;
      // Refresh current tab data
      if (tab === 'factures') fetchInvoices();
      else if (tab === 'journal') fetchJournal();
      else if (tab === 'dashboard_financier') fetchDashboard();
      else if (tab === 'etats_financiers') fetchBalanceSheet();
      else if (tab === 'centres_couts') { fetchCostCenters(); fetchCostCentersSummary(); }
      else if (tab === 'transactions') fetchTransactions();
      else if (tab === 'grand_livre') fetchLedgerAccounts();
      else if (tab === 'plan_comptable') fetchAccounts();
      fetchSummary();
    } catch (err: any) {
      setSyncMessage(err?.response?.data?.detail || 'Erreur de synchronisation');
    } finally { setSyncLoading(false); }
  }, [tab, fetchInvoices, fetchJournal, fetchDashboard, fetchBalanceSheet, fetchCostCenters, fetchCostCentersSummary, fetchTransactions, fetchLedgerAccounts, fetchAccounts, fetchSummary]);

  const fetchPeriods = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await accountingApi.listPeriods();
      setPeriods(res.items || []);
    } catch (err: any) { setError(err?.response?.data?.detail || 'Erreur chargement périodes'); }
    finally { setIsLoading(false); }
  }, []);

  const fetchHoldbacks = useCallback(async () => {
    setIsLoading(true);
    try { const res = await accountingApi.listHoldbacks({ page, perPage }); setHoldbacks(res.items); setHoldbacksTotal(res.total); }
    catch (err: any) { setError(err?.response?.data?.detail || 'Erreur holdbacks'); }
    finally { setIsLoading(false); }
  }, [page]);

  const fetchFixedAssets = useCallback(async () => {
    setIsLoading(true);
    try { const res = await accountingApi.listFixedAssets({ page, perPage }); setFixedAssets(res.items); setFixedAssetsTotal(res.total); }
    catch (err: any) { setError(err?.response?.data?.detail || 'Erreur immobilisations'); }
    finally { setIsLoading(false); }
  }, [page]);

  const fetchFixedAssetsSummary = useCallback(async () => {
    try { const res = await accountingApi.getFixedAssetsSummary(); setFixedAssetsSummary(res); }
    catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { setPage(1); }, [tab, invoiceStatut, transactionTypeFilter]);
  useEffect(() => {
    if (tab === 'factures') fetchInvoices();
    else if (tab === 'recurring') fetchRecurring();
    else if (tab === 'journal') fetchJournal();
    else if (tab === 'plan_comptable') fetchAccounts();
    else if (tab === 'grand_livre') { fetchLedgerAccounts(); setLedgerEntries([]); }
    else if (tab === 'etats_financiers') fetchBalanceSheet();
    else if (tab === 'centres_couts') { fetchCostCenters(); fetchCostCentersSummary(); }
    else if (tab === 'transactions') fetchTransactions();
    else if (tab === 'dashboard_financier') fetchDashboard();
    else if (tab === 'periodes') fetchPeriods();
    else if (tab === 'retenues') fetchHoldbacks();
    else if (tab === 'immobilisations') { fetchFixedAssets(); fetchFixedAssetsSummary(); }
  }, [tab, fetchInvoices, fetchRecurring, fetchJournal, fetchAccounts, fetchLedgerAccounts, fetchBalanceSheet, fetchCostCenters, fetchCostCentersSummary, fetchTransactions, fetchDashboard, fetchPeriods, fetchHoldbacks, fetchFixedAssets, fetchFixedAssetsSummary]);

  const fetchProjectsForDropdown = useCallback(async () => {
    try {
      const res = await projectsApi.listProjects({ page: 1, perPage: 100 });
      setProjectsList(res.items || []);
    } catch { /* ignore */ }
  }, []);

  const fetchSuppliersForDropdown = useCallback(async () => {
    try {
      // Backend /suppliers cape per_page a 100 (Query(le=100)) -- demander plus retourne 422.
      const res = await suppliersApi.listSuppliers({ page: 1, perPage: 100 });
      setSuppliersList((res.items || []).map((s: any) => ({ id: s.id, nom: s.nom })));
    } catch { /* ignore */ }
  }, []);

  const openCreateInvoice = (prefill?: { isSupplier?: boolean; fournisseurId?: string; dateFacture?: string; dateEcheance?: string; conditionsPaiement?: string; notes?: string; numeroFactureFournisseur?: string }) => {
    const dateFactureValue = prefill?.dateFacture || new Date().toISOString().split('T')[0];
    const conditionsValue = prefill?.conditionsPaiement || 'Net 30';

    // Pre-calculer dateEcheance directement. Le useEffect d'auto-calcul ne
    // re-tourne pas si on reset dateEcheance="" car ses deps n'incluent pas
    // dateEcheance — il ne reagit qu'a un changement de dateFacture ou
    // conditionsPaiement. Sans ce calcul direct, le champ reste vide a
    // l'ouverture de la modal (placeholder "aaaa-mm-jj" visible).
    let dateEcheanceValue = prefill?.dateEcheance || '';
    if (!dateEcheanceValue && dateFactureValue && conditionsValue) {
      try {
        const baseDate = new Date(dateFactureValue);
        if (!isNaN(baseDate.getTime())) {
          const match = conditionsValue.match(/\d+/);
          const days = match ? parseInt(match[0], 10) : 30;
          baseDate.setDate(baseDate.getDate() + days);
          dateEcheanceValue = baseDate.toISOString().split('T')[0];
        }
      } catch { /* keep empty if parse fail */ }
    }

    setInvoiceForm({
      clientCompanyId: prefill?.isSupplier ? '' : '',
      projectId: '',
      dateFacture: dateFactureValue,
      dateEcheance: dateEcheanceValue,
      conditionsPaiement: conditionsValue,
      notes: prefill?.notes || '',
      notesInternes: '',
      ...(prefill?.isSupplier ? { fournisseurId: prefill.fournisseurId || '', typeDestinataire: 'fournisseur', numeroFactureFournisseur: prefill.numeroFactureFournisseur || '' } : {}),
    });
    setInvoiceLines([
      { description: '', quantite: 1, prixUnitaire: 0 },
      { description: '', quantite: 1, prixUnitaire: 0 },
      { description: '', quantite: 1, prixUnitaire: 0 },
    ]);
    setInvoiceFormError(null);
    fetchCompaniesForDropdown();
    fetchProjectsForDropdown();
    fetchSuppliersForDropdown();
    // Async import + fetch contacts: guard contre setState apres unmount
    import('@/api/companies')
      .then((m) => m.listContacts({ perPage: 100 }))
      .then((res) => {
        if (!isMountedRef.current) return;
        setContactsList(res.items);
      })
      .catch(() => { /* silently ignore */ });
    setShowCreateInvoice(true);
  };

  const handleScanInvoice = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setScanning(true);
    setScanError(null);
    setScanResult(null);
    setShowScanInvoice(true);
    try {
      const result = await accountingApi.scanInvoice(file);
      setScanResult(result);
    } catch (err: any) {
      setScanError(err?.response?.data?.detail || 'Erreur lors du scan IA');
    } finally {
      setScanning(false);
    }
  };

  const handleApplyScanResult = () => {
    if (!scanResult) return;
    // Pre-fill create invoice form with scan data
    const lines = (scanResult.lignes || []).map((l) => ({
      description: l.description || '',
      quantite: l.quantite || 1,
      prixUnitaire: l.prixUnitaire || 0,
    }));
    if (lines.length === 0) lines.push({ description: '', quantite: 1, prixUnitaire: 0 });

    openCreateInvoice({
      isSupplier: true,
      fournisseurId: scanResult.fournisseurId ? String(scanResult.fournisseurId) : '',
      dateFacture: scanResult.dateFacture || new Date().toISOString().split('T')[0],
      dateEcheance: scanResult.dateEcheance || '',
      conditionsPaiement: scanResult.conditionsPaiement || 'Net 30',
      notes: scanResult.notes || '',
      numeroFactureFournisseur: scanResult.numeroFacture || '',
    });
    setInvoiceLines(lines.length >= 1 ? lines : [{ description: '', quantite: 1, prixUnitaire: 0 }]);
    setShowScanInvoice(false);
    setScanResult(null);
  };

  const invoiceSubtotal = invoiceLines.reduce((sum, l) => sum + (l.quantite * l.prixUnitaire), 0);
  const invoiceTPS = Math.round(invoiceSubtotal * 0.05 * 100) / 100;
  const invoiceTVQ = Math.round(invoiceSubtotal * 0.09975 * 100) / 100;
  const invoiceTotal = Math.round((invoiceSubtotal + invoiceTPS + invoiceTVQ) * 100) / 100;

  const updateInvoiceLine = (idx: number, field: string, value: any) => {
    setInvoiceLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const addInvoiceLine = () => {
    setInvoiceLines((prev) => [...prev, { description: '', quantite: 1, prixUnitaire: 0 }]);
  };

  const removeInvoiceLine = (idx: number) => {
    setInvoiceLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleCreateInvoice = async () => {
    const isSupplier = invoiceForm.typeDestinataire === 'fournisseur';
    if (!isSupplier && !invoiceForm.clientCompanyId) {
      setInvoiceFormError('Veuillez sélectionner un client');
      return;
    }
    if (isSupplier && !invoiceForm.fournisseurId) {
      setInvoiceFormError('Veuillez sélectionner un fournisseur');
      return;
    }
    setInvoiceFormLoading(true);
    setInvoiceFormError(null);
    try {
      const res = await accountingApi.createInvoice({
        clientCompanyId: invoiceForm.clientCompanyId ? parseInt(invoiceForm.clientCompanyId) : undefined,
        fournisseurId: invoiceForm.fournisseurId ? parseInt(invoiceForm.fournisseurId) : undefined,
        typeDestinataire: isSupplier ? 'fournisseur' : 'client',
        projectId: invoiceForm.projectId ? parseInt(invoiceForm.projectId) : undefined,
        dateFacture: invoiceForm.dateFacture || undefined,
        dateEcheance: invoiceForm.dateEcheance || undefined,
        conditionsPaiement: invoiceForm.conditionsPaiement || undefined,
        notes: invoiceForm.notes || undefined,
        numeroFactureFournisseur: invoiceForm.numeroFactureFournisseur || undefined,
      });
      // Add lines to the created invoice
      const validLines = invoiceLines.filter((l) => l.description.trim() && l.prixUnitaire > 0);
      let lineErrors = 0;
      for (const line of validLines) {
        try {
          await accountingApi.addInvoiceLine(res.id, {
            description: line.description,
            quantite: line.quantite,
            prixUnitaire: line.prixUnitaire,
          });
        } catch {
          lineErrors++;
        }
      }
      setShowCreateInvoice(false);
      if (lineErrors > 0) {
        setError(`Facture créée mais ${lineErrors} ligne(s) n'ont pas pu être ajoutée(s)`);
      }
      fetchInvoices();
      fetchSummary();
    } catch (err: any) {
      setInvoiceFormError(err?.response?.data?.detail || 'Erreur lors de la création de la facture');
    } finally {
      setInvoiceFormLoading(false);
    }
  };

  const openEditInvoice = async (inv: Invoice) => {
    setEditInvoiceId(inv.id);
    setEditInvoiceNumero(inv.numeroFacture || inv.numero || '');
    setEditInvoiceFormError(null);
    fetchCompaniesForDropdown();
    fetchProjectsForDropdown();
    // Fetch full invoice to get all fields (list endpoint is partial)
    let full = inv;
    try {
      full = await accountingApi.getInvoice(inv.id);
    } catch { /* use partial data from list */ }
    setEditInvoiceForm({
      clientCompanyId: full.clientCompanyId ? String(full.clientCompanyId) : '',
      projectId: full.projectId ? String(full.projectId) : '',
      dateFacture: full.dateFacture || '',
      dateEcheance: full.dateEcheance || '',
      conditionsPaiement: full.conditionsPaiement || 'Net 30',
      notes: full.notes || '',
      notesInternes: full.notesInternes || '',
      statut: full.statut || 'BROUILLON',
    });
    // Fetch existing lines
    try {
      const res = await accountingApi.getInvoiceLines(inv.id);
      const lines = res.items.map((l: any) => ({
        id: l.id,
        description: l.description || '',
        quantite: l.quantite ?? 1,
        prixUnitaire: l.prixUnitaire ?? 0,
      }));
      setEditInvoiceLines(lines.length > 0 ? lines : [{ description: '', quantite: 1, prixUnitaire: 0 }]);
    } catch {
      setEditInvoiceLines([{ description: '', quantite: 1, prixUnitaire: 0 }]);
    }
    setShowEditInvoice(true);
  };

  const editInvoiceSubtotal = editInvoiceLines.reduce((sum, l) => sum + (l.quantite * l.prixUnitaire), 0);
  const editInvoiceTPS = Math.round(editInvoiceSubtotal * 0.05 * 100) / 100;
  const editInvoiceTVQ = Math.round(editInvoiceSubtotal * 0.09975 * 100) / 100;
  const editInvoiceTotal = Math.round((editInvoiceSubtotal + editInvoiceTPS + editInvoiceTVQ) * 100) / 100;

  const updateEditInvoiceLine = (idx: number, field: string, value: any) => {
    setEditInvoiceLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const addEditInvoiceLine = () => {
    setEditInvoiceLines((prev) => [...prev, { description: '', quantite: 1, prixUnitaire: 0 }]);
  };

  const removeEditInvoiceLine = (idx: number) => {
    setEditInvoiceLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateInvoice = async () => {
    if (!editInvoiceId) return;
    setEditInvoiceFormLoading(true);
    setEditInvoiceFormError(null);
    try {
      // Update main invoice fields
      await accountingApi.updateInvoice(editInvoiceId, {
        clientCompanyId: editInvoiceForm.clientCompanyId ? parseInt(editInvoiceForm.clientCompanyId) : undefined,
        projectId: editInvoiceForm.projectId ? parseInt(editInvoiceForm.projectId) : undefined,
        dateFacture: editInvoiceForm.dateFacture || undefined,
        dateEcheance: editInvoiceForm.dateEcheance || undefined,
        conditionsPaiement: editInvoiceForm.conditionsPaiement || undefined,
        notes: editInvoiceForm.notes || undefined,
        notesInternes: editInvoiceForm.notesInternes || undefined,
        statut: editInvoiceForm.statut || undefined,
      });

      // Sync lines: delete removed, update existing, add new
      const existingRes = await accountingApi.getInvoiceLines(editInvoiceId);
      const existingIds = new Set(existingRes.items.map((l: any) => l.id));
      const editIds = new Set(editInvoiceLines.filter((l) => l.id).map((l) => l.id));
      let lineErrors = 0;

      // Delete lines that were removed
      for (const existing of existingRes.items) {
        if (!editIds.has(existing.id)) {
          try { await accountingApi.deleteInvoiceLine(editInvoiceId, existing.id); } catch { lineErrors++; }
        }
      }

      // Update existing lines and add new ones
      for (const line of editInvoiceLines) {
        if (!line.description.trim() && line.prixUnitaire === 0) continue;
        if (line.id && existingIds.has(line.id)) {
          try {
            await accountingApi.updateInvoiceLine(editInvoiceId, line.id, {
              description: line.description,
              quantite: line.quantite,
              prixUnitaire: line.prixUnitaire,
            });
          } catch { lineErrors++; }
        } else {
          try {
            await accountingApi.addInvoiceLine(editInvoiceId, {
              description: line.description,
              quantite: line.quantite,
              prixUnitaire: line.prixUnitaire,
            });
          } catch { lineErrors++; }
        }
      }

      setShowEditInvoice(false);
      if (lineErrors > 0) {
        setError(`Facture modifiée mais ${lineErrors} ligne(s) n'ont pas pu être sauvegardée(s)`);
      }
      fetchInvoices();
      fetchSummary();
    } catch (err: any) {
      setEditInvoiceFormError(err?.response?.data?.detail || 'Erreur lors de la modification de la facture');
    } finally {
      setEditInvoiceFormLoading(false);
    }
  };

  const openPayment = (inv: Invoice) => {
    setPaymentInvoice(inv);
    setPaymentForm({ montant: String(inv.soldeDu || inv.montantTtc || inv.montantTotal || 0), datePaiement: '', modePaiement: 'Virement', reference: '' });
    setPaymentError(null);
    setShowPayment(true);
  };

  const handlePayment = async () => {
    if (!paymentInvoice || !paymentForm.montant) return;
    const montant = parseAmount(paymentForm.montant);
    if (montant <= 0) { setPaymentError('Le montant doit être supérieur à 0'); return; }
    setPaymentLoading(true);
    setPaymentError(null);
    try {
      await accountingApi.recordInvoicePayment(paymentInvoice.id, {
        montant: parseAmount(paymentForm.montant),
        datePaiement: paymentForm.datePaiement || undefined,
        modePaiement: paymentForm.modePaiement || undefined,
        reference: paymentForm.reference || undefined,
      });
      setShowPayment(false);
      fetchInvoices();
      fetchSummary();
    } catch (err: any) {
      setPaymentError(err?.response?.data?.detail || 'Erreur lors de l\'enregistrement du paiement');
    } finally {
      setPaymentLoading(false);
    }
  };

  // Modal de confirmation envoi (recap detaille avant action irreversible)
  const [sendConfirmInvoice, setSendConfirmInvoice] = useState<Invoice | null>(null);
  const [sendConfirmLoading, setSendConfirmLoading] = useState(false);

  const openSendConfirm = (inv: Invoice) => {
    if (inv.statut !== 'BROUILLON') return;
    // Guard facture vide: pas d'envoi avec montant 0$ (ecriture comptable
    // VENTES sans contenu = incoherence comptable)
    const ttc = inv.montantTtc || inv.montantTotal || 0;
    if (ttc <= 0) {
      setError('Impossible d\'envoyer une facture sans montant. Ajoutez au moins une ligne avec un prix > 0.');
      return;
    }
    setSendConfirmInvoice(inv);
  };

  const handleSendInvoice = async () => {
    const inv = sendConfirmInvoice;
    if (!inv) return;
    setSendConfirmLoading(true);
    try {
      await accountingApi.updateInvoice(inv.id, { statut: 'ENVOYEE' });
      setSendConfirmInvoice(null);
      fetchInvoices();
      fetchSummary();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors de l\'envoi de la facture');
    } finally {
      setSendConfirmLoading(false);
    }
  };

  const handleDeleteInvoice = async (inv: Invoice) => {
    if (inv.statut !== 'BROUILLON' && inv.statut !== 'ANNULEE') return;
    if (isDeletingInvoice !== null) return; // guard race condition
    if (!window.confirm(`Supprimer definitivement la facture ${inv.numeroFacture || inv.numero || inv.id}? Cette action est irreversible.`)) return;
    setIsDeletingInvoice(inv.id);
    try {
      const res = await accountingApi.deleteInvoice(inv.id);
      // Backend renvoie un message detaille si contre-passation auto
      const msg = res?.message || 'Facture supprimee';
      // L'intercepteur axios (client.ts:110) convertit snake_case -> camelCase
      // sur toutes les responses JSON. Le backend retourne `reversed_entries`,
      // mais le code TS doit lire `reversedEntries` (post-transformation).
      const reversed = (res as any)?.reversedEntries ?? (res as any)?.reversed_entries ?? 0;
      setDeleteSuccessMessage({ message: msg, reversed });
      fetchInvoices();
      fetchSummary();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors de la suppression de la facture');
    } finally {
      setIsDeletingInvoice(null);
    }
  };

  // Auto-calcul date_echeance depuis date_facture + conditions_paiement
  // (n'ecrase pas la valeur si user a deja edite manuellement)
  const parsePaymentDays = (conditions: string): number => {
    const match = conditions.match(/\d+/);
    return match ? parseInt(match[0], 10) : 30;
  };

  useEffect(() => {
    if (dateEcheanceTouched) return;
    if (!invoiceForm.dateFacture || !invoiceForm.conditionsPaiement) return;
    try {
      const baseDate = new Date(invoiceForm.dateFacture);
      if (isNaN(baseDate.getTime())) return;
      const days = parsePaymentDays(invoiceForm.conditionsPaiement);
      baseDate.setDate(baseDate.getDate() + days);
      const isoStr = baseDate.toISOString().split('T')[0];
      if (isoStr !== invoiceForm.dateEcheance) {
        setInvoiceForm((prev) => ({ ...prev, dateEcheance: isoStr }));
      }
    } catch { /* silently ignore date parse errors */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceForm.dateFacture, invoiceForm.conditionsPaiement, dateEcheanceTouched]);

  // Reset dateEcheanceTouched a chaque ouverture de la modal creation
  useEffect(() => {
    if (showCreateInvoice) {
      setDateEcheanceTouched(false);
    }
  }, [showCreateInvoice]);

  // ============================================
  // Send Invoice by Email (avec PDF en piece jointe)
  // ============================================
  const openSendInvoiceModal = (inv: Invoice) => {
    // Bloquer si facture pas dans un statut envoyable
    const allowedStatuts = new Set(['BROUILLON', 'ENVOYEE', 'PARTIELLEMENT_PAYEE', 'EN_RETARD']);
    if (!allowedStatuts.has(inv.statut)) {
      setError(`Impossible d'envoyer une facture ${inv.statut}.`);
      return;
    }
    const ttc = inv.montantTtc || inv.montantTotal || 0;
    if (ttc <= 0) {
      setError('Impossible d\'envoyer une facture sans montant. Ajoutez au moins une ligne.');
      return;
    }
    setSendInvoiceTarget(inv);
    // Pre-remplir email depuis le client si dispo
    const company = companiesList.find((c) => c.id === inv.clientCompanyId);
    const defaultEmail = (company as any)?.email || '';
    const numero = inv.numeroFacture || inv.numero || `#${inv.id}`;
    setSendInvoiceForm({
      toEmail: defaultEmail,
      cc: '',
      subjectOverride: `Facture ${numero}`,
      messageOverride: '',
    });
    setSendInvoiceError(null);
    setShowSendInvoice(true);
  };

  // Regex email stricte (cote client): doit matcher le validator Pydantic backend
  // (accounting.py InvoiceSendRequest._validate_email_format) pour eviter
  // un aller-retour 422.
  const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

  const handleSendInvoiceEmail = async () => {
    if (!sendInvoiceTarget) return;
    const email = sendInvoiceForm.toEmail.trim();
    if (!EMAIL_REGEX.test(email)) {
      setSendInvoiceError('Adresse courriel destinataire invalide (format local@domaine.tld attendu)');
      return;
    }
    setSendInvoiceLoading(true);
    setSendInvoiceError(null);
    try {
      await accountingApi.sendInvoiceByEmail(sendInvoiceTarget.id, {
        toEmail: email,
        cc: sendInvoiceForm.cc?.trim() || undefined,
        subjectOverride: sendInvoiceForm.subjectOverride?.trim() || undefined,
        messageOverride: sendInvoiceForm.messageOverride?.trim() || undefined,
      });
      setShowSendInvoice(false);
      setSendInvoiceTarget(null);
      fetchInvoices();
      fetchSummary();
    } catch (err: any) {
      setSendInvoiceError(err?.response?.data?.detail || 'Erreur lors de l\'envoi du courriel');
    } finally {
      setSendInvoiceLoading(false);
    }
  };

  // ============================================
  // Note de credit (AVOIR)
  // ============================================
  const openCreditNoteModal = (inv: Invoice) => {
    if (inv.statut === 'BROUILLON') {
      setError('Impossible de creer un avoir pour une facture BROUILLON. La facture doit avoir ete envoyee.');
      return;
    }
    const ttc = inv.montantTtc || inv.montantTotal || 0;
    if (ttc <= 0) {
      setError('Facture origine sans montant — impossible de creer un avoir.');
      return;
    }
    setCreditNoteTarget(inv);
    setCreditNoteForm({
      raison: '',
      montantTotal: String(ttc),
      dateAvoir: new Date().toISOString().split('T')[0],
      notesInternes: '',
    });
    setCreditNoteError(null);
    setShowCreditNote(true);
  };

  const handleCreateCreditNote = async () => {
    if (!creditNoteTarget) return;
    const raison = creditNoteForm.raison.trim();
    if (raison.length < 3) {
      setCreditNoteError('Veuillez indiquer une raison detaillee (3 caracteres min).');
      return;
    }
    const montant = parseAmount(creditNoteForm.montantTotal);
    if (montant <= 0) {
      setCreditNoteError('Le montant de l\'avoir doit etre superieur a 0.');
      return;
    }
    setCreditNoteLoading(true);
    setCreditNoteError(null);
    try {
      const res = await accountingApi.createCreditNote(creditNoteTarget.id, {
        raison,
        montantTotal: montant,
        dateAvoir: creditNoteForm.dateAvoir || undefined,
        notesInternes: creditNoteForm.notesInternes?.trim() || undefined,
      });
      setShowCreditNote(false);
      setCreditNoteTarget(null);
      setError(null);
      setDeleteSuccessMessage({
        message: `Note de credit ${res.numeroFacture} creee en BROUILLON (id #${res.id}). Editez-la puis envoyez-la pour generer l'ecriture comptable.`,
        reversed: 0,
      });
      fetchInvoices();
      fetchSummary();
    } catch (err: any) {
      setCreditNoteError(err?.response?.data?.detail || 'Erreur lors de la creation de la note de credit');
    } finally {
      setCreditNoteLoading(false);
    }
  };

  // ============================================
  // Récurrence — Convertir une facture en template recurrent
  // ============================================
  const openRecurringModal = async (inv: Invoice) => {
    // Pre-rempli depuis la facture source
    const companyEmail = (companiesList.find((c) => c.id === inv.clientCompanyId) as any)?.email || '';
    const numero = inv.numeroFacture || inv.numero || `#${inv.id}`;
    setRecurringSourceInvoice(inv);
    setRecurringForm({
      nom: `Recurrent depuis ${numero}`,
      frequence: 'mensuel',
      intervalCount: 1,
      dateDebut: new Date(new Date().setDate(new Date().getDate() + 30)).toISOString().split('T')[0],
      dateFin: '',
      nbOccurrencesMax: '',
      statutFactureGenere: 'BROUILLON',
      autoEnvoiEmail: false,
      emailDestinataire: companyEmail,
      notes: inv.notes || '',
    });
    setRecurringError(null);
    setShowRecurringModal(true);
  };

  const handleCreateRecurring = async () => {
    if (!recurringSourceInvoice) return;
    const nom = recurringForm.nom.trim();
    if (nom.length < 3) {
      setRecurringError('Nom du template requis (min 3 caracteres)');
      return;
    }
    if (!recurringSourceInvoice.clientCompanyId) {
      setRecurringError('Facture source sans client — impossible');
      return;
    }
    if (recurringForm.autoEnvoiEmail && !EMAIL_REGEX.test(recurringForm.emailDestinataire.trim())) {
      setRecurringError('Adresse courriel destinataire invalide pour envoi automatique');
      return;
    }
    setRecurringLoading(true);
    setRecurringError(null);
    try {
      // Charger les lignes de la facture source
      const linesRes = await accountingApi.getInvoiceLines(recurringSourceInvoice.id);
      const lignes = linesRes.items
        .filter((l) => (l.description || '').trim() && (l.prixUnitaire || 0) > 0)
        .map((l) => ({
          description: l.description || '',
          quantite: l.quantite ?? 1,
          prixUnitaire: l.prixUnitaire ?? 0,
          unite: 'unite',
        }));
      if (lignes.length === 0) {
        setRecurringError('La facture source n\'a aucune ligne facturable');
        setRecurringLoading(false);
        return;
      }
      const res = await accountingApi.createRecurringInvoice({
        nom,
        clientCompanyId: recurringSourceInvoice.clientCompanyId,
        projectId: recurringSourceInvoice.projectId,
        frequence: recurringForm.frequence,
        intervalCount: recurringForm.intervalCount,
        dateDebut: recurringForm.dateDebut,
        dateFin: recurringForm.dateFin || undefined,
        nbOccurrencesMax: recurringForm.nbOccurrencesMax
          ? parseInt(recurringForm.nbOccurrencesMax, 10)
          : undefined,
        statutFactureGenere: recurringForm.statutFactureGenere,
        autoEnvoiEmail: recurringForm.autoEnvoiEmail,
        emailDestinataire: recurringForm.autoEnvoiEmail
          ? recurringForm.emailDestinataire.trim()
          : undefined,
        conditionsPaiement: recurringSourceInvoice.conditionsPaiement,
        notes: recurringForm.notes || undefined,
        lignes,
      });
      setShowRecurringModal(false);
      setRecurringSourceInvoice(null);
      setDeleteSuccessMessage({
        message: `Template recurrent #${res.id} cree. Prochaine generation: ${res.prochaineDate || recurringForm.dateDebut}`,
        reversed: 0,
      });
    } catch (err: any) {
      setRecurringError(err?.response?.data?.detail || 'Erreur creation template recurrent');
    } finally {
      setRecurringLoading(false);
    }
  };

  // ============================================
  // Rappels de paiement — Envoi manuel + historique
  // ============================================
  const openReminderModal = (inv: Invoice) => {
    // Bloquer si statut incompatible
    if (!['ENVOYEE', 'PARTIELLEMENT_PAYEE', 'EN_RETARD'].includes(inv.statut)) {
      setError('Rappel possible uniquement pour factures ENVOYEE, PARTIELLEMENT_PAYEE ou EN_RETARD');
      return;
    }
    setReminderTarget(inv);
    // Niveau suggere: le prochain niveau apres le dernier deja envoye
    // (cap a 4 = mise en demeure). Si aucun rappel: niveau 1.
    const nbDeja = inv.nbRappelsEnvoyes || 0;
    const niveauSuggere = Math.min(nbDeja + 1, 4) as 1 | 2 | 3 | 4;
    setReminderForm({
      niveau: niveauSuggere,
      toEmailOverride: '',
      messageOverride: '',
    });
    setReminderError(null);
    setShowReminderModal(true);
  };

  const handleSendReminder = async () => {
    if (!reminderTarget) return;
    if (reminderForm.toEmailOverride && !EMAIL_REGEX.test(reminderForm.toEmailOverride.trim())) {
      setReminderError('Adresse courriel override invalide');
      return;
    }
    setReminderLoading(true);
    setReminderError(null);
    try {
      await accountingApi.sendInvoiceReminder(reminderTarget.id, {
        niveau: reminderForm.niveau,
        toEmailOverride: reminderForm.toEmailOverride?.trim() || undefined,
        messageOverride: reminderForm.messageOverride?.trim() || undefined,
      });
      setShowReminderModal(false);
      setReminderTarget(null);
      fetchInvoices();
      setDeleteSuccessMessage({
        message: `Rappel niveau ${reminderForm.niveau} envoye`,
        reversed: 0,
      });
    } catch (err: any) {
      setReminderError(err?.response?.data?.detail || 'Echec d\'envoi du rappel');
    } finally {
      setReminderLoading(false);
    }
  };

  const openRemindersHistory = async (inv: Invoice) => {
    setRemindersHistoryInvoice(inv);
    setShowRemindersHistory(true);
    setRemindersHistoryLoading(true);
    try {
      const res = await accountingApi.listInvoiceReminders(inv.id);
      setRemindersHistoryItems(res.items);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur chargement historique rappels');
      setRemindersHistoryItems([]);
    } finally {
      setRemindersHistoryLoading(false);
    }
  };

  const handleToggleReminders = async (inv: Invoice) => {
    try {
      const res = await accountingApi.toggleInvoiceReminders(inv.id);
      // axios interceptor convertit snake_case → camelCase, donc rappelsActifs
      const nouvelEtat = (res as any).rappelsActifs ?? (res as any).rappels_actifs;
      setDeleteSuccessMessage({
        message: nouvelEtat
          ? 'Rappels automatiques REACTIVES pour cette facture'
          : 'Rappels automatiques DESACTIVES pour cette facture',
        reversed: 0,
      });
      // Rafraichir reminderTarget local pour que le bouton dans la modal
      // reflete le nouvel etat sans devoir fermer/rouvrir la modal.
      if (reminderTarget && reminderTarget.id === inv.id) {
        setReminderTarget({ ...reminderTarget, rappelsActifs: nouvelEtat });
      }
      fetchInvoices();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur changement statut rappels');
    }
  };

  // ============================================
  // Download PDF (facture ou avoir)
  // ============================================
  const handleDownloadPdf = async (inv: Invoice) => {
    if (pdfLoadingId !== null) return;
    setPdfLoadingId(inv.id);
    try {
      const numero = inv.numeroFacture || inv.numero || `facture-${inv.id}`;
      await accountingApi.downloadInvoicePdf(inv.id, `${numero}.pdf`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors du telechargement du PDF');
    } finally {
      setPdfLoadingId(null);
    }
  };

  const openCreateJournal = () => {
    setJournalForm({ description: '', type: 'VENTE' });
    setJournalLines([
      { compteCode: '', libelle: '', debit: '', credit: '' },
      { compteCode: '', libelle: '', debit: '', credit: '' },
    ]);
    setJournalFormError(null);
    setShowCreateJournal(true);
  };

  const updateJournalLine = (idx: number, field: 'compteCode' | 'libelle' | 'debit' | 'credit', value: string) => {
    setJournalLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const addJournalLineRow = () => {
    setJournalLines((prev) => [...prev, { compteCode: '', libelle: '', debit: '', credit: '' }]);
  };

  const removeJournalLineRow = (idx: number) => {
    setJournalLines((prev) => prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev);
  };

  const handleCreateJournal = async () => {
    if (!journalCanCreate) return;
    setJournalFormLoading(true);
    setJournalFormError(null);
    try {
      // Endpoint atomique: entete + lignes en une seule transaction.
      // Echec partiel impossible (validation Pydantic + rollback DB si raise).
      await accountingApi.createJournalEntryWithLines({
        libelle: journalForm.description,
        typeJournal: journalForm.type || undefined,
        lignes: journalLinesNonEmpty
          .filter((line) => line.compteCode.trim())
          .map((line) => ({
            compteCode: line.compteCode.trim(),
            libelle: line.libelle || journalForm.description,
            debit: parseAmount(line.debit),
            credit: parseAmount(line.credit),
          })),
      });
      setShowCreateJournal(false);
      fetchJournal();
    } catch (err: any) {
      setJournalFormError(err?.response?.data?.detail || 'Erreur lors de la création de l\'écriture');
    } finally {
      setJournalFormLoading(false);
    }
  };

  const openCreateCostCenter = () => {
    setCostCenterForm({ code: '', nom: '', type: '', budgetAnnuel: '' });
    setCostCenterFormError(null);
    setShowCreateCostCenter(true);
  };

  const handleCreateCostCenter = async () => {
    if (!costCenterForm.code.trim() || !costCenterForm.nom.trim()) return;
    setCostCenterFormLoading(true);
    setCostCenterFormError(null);
    try {
      await accountingApi.createCostCenter({
        code: costCenterForm.code,
        nom: costCenterForm.nom,
        type: costCenterForm.type || undefined,
        budgetAnnuel: costCenterForm.budgetAnnuel ? parseAmount(costCenterForm.budgetAnnuel) : undefined,
      });
      setShowCreateCostCenter(false);
      fetchCostCenters();
      fetchCostCentersSummary();
    } catch (err: any) {
      setCostCenterFormError(err?.response?.data?.detail || 'Erreur lors de la création du centre de coûts');
    } finally {
      setCostCenterFormLoading(false);
    }
  };

  const openCreatePeriod = () => {
    setPeriodForm({ nom: '', anneeFiscale: '', periode: '', dateDebut: '', dateFin: '' });
    setPeriodFormError(null);
    setShowCreatePeriod(true);
  };

  const handleCreatePeriod = async () => {
    if (!periodForm.anneeFiscale || !periodForm.periode || !periodForm.dateDebut || !periodForm.dateFin) return;
    setPeriodFormLoading(true);
    setPeriodFormError(null);
    try {
      await accountingApi.createPeriod({
        nom: periodForm.nom || undefined,
        anneeFiscale: parseInt(periodForm.anneeFiscale),
        periode: parseInt(periodForm.periode),
        dateDebut: periodForm.dateDebut,
        dateFin: periodForm.dateFin,
      });
      setShowCreatePeriod(false);
      fetchPeriods();
    } catch (err: any) {
      setPeriodFormError(err?.response?.data?.detail || 'Erreur lors de la création de la période');
    } finally {
      setPeriodFormLoading(false);
    }
  };

  const handleClosePeriod = async (periodId: number) => {
    if (!confirm('Êtes-vous sûr de vouloir clôturer cette période ? Cette action est irréversible.')) return;
    try {
      await accountingApi.closePeriod(periodId);
      fetchPeriods();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors de la clôture de la période');
    }
  };

  const handleFinSubTabChange = (sub: 'bilan' | 'resultats' | 'flux' | 'taxes') => {
    setFinSubTab(sub);
    if (sub === 'bilan') fetchBalanceSheet();
    else if (sub === 'resultats') fetchIncomeStatement();
    else if (sub === 'flux') fetchCashFlow();
    else if (sub === 'taxes') fetchTaxDeclaration();
  };

  const fetchTaxDeclaration = useCallback(async () => {
    try {
      const res = await accountingApi.getTaxDeclaration(taxPeriod);
      setTaxDeclaration(res);
    } catch { /* ignore */ }
  }, [taxPeriod]);

  const totalPages = Math.ceil(
    (tab === 'factures' ? invoicesTotal : tab === 'journal' ? journalTotal : tab === 'transactions' ? transactionsTotal : 0) / perPage
  );

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}
      {deleteSuccessMessage && (
        <Alert
          type={deleteSuccessMessage.reversed > 0 ? 'info' : 'success'}
          onClose={() => setDeleteSuccessMessage(null)}
        >
          {deleteSuccessMessage.message}
        </Alert>
      )}
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Comptabilité</h2>

      {/* Financial Summary */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="CA total" value={formatCurrency(summary.caTotal)} icon={<DollarSign size={20} />} color="green" />
          <StatCard label="Encaisse" value={formatCurrency(summary.totalEncaisse)} icon={<CheckCircle size={20} />} color="blue" />
          <StatCard label="Solde du" value={formatCurrency(summary.totalSoldeDu)} icon={<AlertCircle size={20} />} color={summary.totalSoldeDu > 0 ? 'red' : 'green'} />
          <StatCard label="Factures en retard" value={summary.facturesRetard} icon={<Clock size={20} />} color={summary.facturesRetard > 0 ? 'red' : 'green'} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto scrollbar-hide">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-2.5 md:px-4 py-2 md:py-2.5 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.key ? 'border-seaop-primary-600 text-seaop-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.icon} <span className="md:hidden">{t.shortLabel}</span><span className="hidden md:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Sync button + message */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
          {syncMessage && (
            <Alert type="info" onClose={() => setSyncMessage(null)}>{syncMessage}</Alert>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<RefreshCw size={14} className={syncLoading ? 'animate-spin' : ''} />}
          onClick={handleManualSync}
          disabled={syncLoading}
        >
          {syncLoading ? 'Synchronisation...' : 'Synchroniser'}
        </Button>
      </div>

      {/* Filters + Action buttons */}
      {tab === 'factures' && (
        <div className="flex items-center justify-between gap-3">
          <div className="w-full sm:w-48">
            <Select options={[
              { value: '', label: 'Tous les statuts' },
              { value: 'BROUILLON', label: 'Brouillon' },
              { value: 'ENVOYEE', label: 'Envoyée' },
              { value: 'PAYEE', label: 'Payee' },
              { value: 'EN_RETARD', label: 'En retard' },
              { value: 'ANNULEE', label: 'Annulée' },
            ]} value={invoiceStatut} onChange={(e) => setInvoiceStatut(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => scanFileRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/40"
            >
              <Camera size={16} />
              Scanner facture IA
            </button>
            <input ref={scanFileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleScanInvoice} />
            <Button leftIcon={<Plus size={16} />} onClick={() => openCreateInvoice()}>Nouvelle facture</Button>
          </div>
        </div>
      )}

      {tab === 'journal' && (
        <div className="flex justify-end gap-2 flex-wrap">
          <Button variant="ghost" onClick={() => accountingApi.exportJournalCsv()}>Export CSV</Button>
          <Button variant="ghost" onClick={() => accountingApi.exportQuickbooksIif()}>QuickBooks IIF</Button>
          <Button variant="ghost" onClick={() => accountingApi.exportSage50Csv()}>Sage 50 CSV</Button>
          <Button leftIcon={<Plus size={16} />} onClick={openCreateJournal}>Nouvelle ecriture</Button>
        </div>
      )}

      {tab === 'plan_comptable' && (
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => accountingApi.exportChartOfAccountsCsv()}>Export CSV</Button>
        </div>
      )}

      {tab === 'grand_livre' && (
        <div className="flex items-center gap-3">
          <div className="w-full sm:w-64">
            <Select
              options={[
                { value: '', label: 'Sélectionner un compte' },
                ...ledgerAccounts.map((a: any) => ({
                  value: a.code,
                  label: `${a.code} - ${a.nom}`,
                })),
              ]}
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
            />
          </div>
          <Button onClick={() => fetchLedgerForAccount(selectedAccount)} disabled={!selectedAccount}>Charger</Button>
        </div>
      )}

      {tab === 'etats_financiers' && (
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto scrollbar-hide">
          {([
            { key: 'bilan' as const, label: 'Bilan' },
            { key: 'resultats' as const, label: 'Résultats' },
            { key: 'flux' as const, label: 'Flux de trésorerie' },
            { key: 'taxes' as const, label: 'Taxes TPS/TVQ' },
          ]).map((st) => (
            <button key={st.key} onClick={() => handleFinSubTabChange(st.key)}
              className={`px-2.5 md:px-4 py-2 md:py-2.5 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                finSubTab === st.key ? 'border-seaop-primary-600 text-seaop-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {st.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'transactions' && (
        <div className="flex items-center justify-between gap-3">
          <div className="w-full sm:w-48">
            <Select options={[
              { value: '', label: 'Tous les types' },
              { value: 'revenus', label: 'Revenus' },
              { value: 'depenses', label: 'Dépenses' },
            ]} value={transactionTypeFilter} onChange={(e) => setTransactionTypeFilter(e.target.value)} />
          </div>
        </div>
      )}

      {tab === 'periodes' && (
        <div className="flex justify-end">
          <Button leftIcon={<Plus size={16} />} onClick={openCreatePeriod}>Nouvelle période</Button>
        </div>
      )}

      {tab === 'centres_couts' && (
        <div className="flex justify-end">
          <Button leftIcon={<Plus size={16} />} onClick={openCreateCostCenter}>Nouveau centre de couts</Button>
        </div>
      )}

      {isLoading ? <SkeletonPage /> : (
        <>
          {/* INVOICES */}
          {tab === 'factures' && (
            <>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Numéro</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Client</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Échéance</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total TTC</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Payé</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Solde</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase w-32">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="px-4 py-3 font-mono text-xs">{inv.numeroFacture || inv.numero || '--'}</td>
                          <td className="px-4 py-3 text-gray-900 dark:text-white">{inv.clientNom || '--'}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(inv.dateFacture)}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(inv.dateEcheance)}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(inv.montantTtc || inv.montantTotal || 0)}</td>
                          <td className="px-4 py-3 text-right text-green-600">{formatCurrency(inv.montantPaye || 0)}</td>
                          <td className="px-4 py-3 text-right text-red-600 font-medium">{formatCurrency(inv.soldeDu || 0)}</td>
                          <td className="px-4 py-3 text-center"><Badge color={INVOICE_STATUT_COLORS[inv.statut] || 'gray'} size="sm">{INVOICE_STATUT_LABEL[inv.statut] || inv.statut}</Badge></td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {inv.statut !== 'PAYEE' && inv.statut !== 'ANNULEE' && (
                                <button
                                  onClick={() => openEditInvoice(inv)}
                                  className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                  title="Modifier la facture"
                                >
                                  <Pencil size={14} />
                                </button>
                              )}
                              {inv.statut === 'BROUILLON' && (
                                <button
                                  onClick={() => openSendConfirm(inv)}
                                  className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                                  title="Envoyer la facture (genere ecriture comptable)"
                                >
                                  <Send size={14} />
                                </button>
                              )}
                              {inv.statut !== 'PAYEE' && inv.statut !== 'ANNULEE' && inv.statut !== 'PARTIELLE' && (
                                <button
                                  onClick={() => openSendInvoiceModal(inv)}
                                  className="p-1.5 rounded text-gray-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                                  title="Envoyer par courriel (avec PDF en piece jointe)"
                                >
                                  <Mail size={14} />
                                </button>
                              )}
                              {inv.statut !== 'PAYEE' && inv.statut !== 'ANNULEE' && (
                                <button
                                  onClick={() => openPayment(inv)}
                                  className="p-1.5 rounded text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                                  title="Enregistrer un paiement"
                                >
                                  <DollarSign size={14} />
                                </button>
                              )}
                              {inv.statut !== 'BROUILLON' && inv.statut !== 'ANNULEE' && inv.typeDocument !== 'AVOIR' && (
                                <button
                                  onClick={() => openCreditNoteModal(inv)}
                                  className="p-1.5 rounded text-gray-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                                  title="Creer une note de credit (avoir) referencant cette facture"
                                >
                                  <FileMinus2 size={14} />
                                </button>
                              )}
                              {inv.statut !== 'ANNULEE' && inv.typeDocument !== 'AVOIR' && (
                                <button
                                  onClick={() => openRecurringModal(inv)}
                                  className="p-1.5 rounded text-gray-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/20"
                                  title="Convertir en facture recurrente (mensuelle, trimestrielle, etc.)"
                                >
                                  <Repeat size={14} />
                                </button>
                              )}
                              {(inv.statut === 'ENVOYEE' || inv.statut === 'PARTIELLEMENT_PAYEE' || inv.statut === 'EN_RETARD') && (
                                <button
                                  onClick={() => openReminderModal(inv)}
                                  className="p-1.5 rounded text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                  title="Envoyer un rappel de paiement"
                                >
                                  <Bell size={14} />
                                </button>
                              )}
                              {(inv.nbRappelsEnvoyes || 0) > 0 && (
                                <button
                                  onClick={() => openRemindersHistory(inv)}
                                  className="p-1.5 rounded text-gray-400 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                  title={`Historique des rappels (${inv.nbRappelsEnvoyes})`}
                                >
                                  <History size={14} />
                                </button>
                              )}
                              {(inv.statut === 'BROUILLON' || inv.statut === 'ANNULEE') && (
                                <button
                                  onClick={() => handleDeleteInvoice(inv)}
                                  disabled={isDeletingInvoice === inv.id}
                                  className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Supprimer la facture (BROUILLON ou ANNULEE sans ecriture comptable)"
                                >
                                  {isDeletingInvoice === inv.id ? <Clock size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                </button>
                              )}
                              <button
                                onClick={async () => {
                                  setInvoiceHtmlLoading(inv.id);
                                  try {
                                    const res = await accountingApi.generateInvoiceHtml(inv.id);
                                    setInvoiceHtmlContent(res.html);
                                    setShowInvoiceHtmlPreview(true);
                                  } catch { /* silent */ }
                                  finally { setInvoiceHtmlLoading(null); }
                                }}
                                className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20"
                                title="Aperçu HTML"
                              >
                                {invoiceHtmlLoading === inv.id ? <Clock size={14} className="animate-spin" /> : <Eye size={14} />}
                              </button>
                              <button
                                onClick={() => handleDownloadPdf(inv)}
                                disabled={pdfLoadingId === inv.id}
                                className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20 disabled:opacity-50"
                                title="Telecharger PDF (avec snapshot emetteur)"
                              >
                                {pdfLoadingId === inv.id ? <Clock size={14} className="animate-spin" /> : <Download size={14} />}
                              </button>
                              <button
                                onClick={() => openInvoiceExport(inv.id)}
                                className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20"
                                title="Imprimer (ouvre HTML)"
                              >
                                <Printer size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {invoices.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Aucune facture</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {invoices.map((inv) => (
                  <div key={inv.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-xs text-seaop-primary-600">{inv.numeroFacture || inv.numero || '--'}</span>
                      <Badge color={INVOICE_STATUT_COLORS[inv.statut] || 'gray'} size="sm">{INVOICE_STATUT_LABEL[inv.statut] || inv.statut}</Badge>
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{inv.clientNom || '--'}</p>
                    <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                      <span>{formatDate(inv.dateFacture)}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(inv.montantTtc || inv.montantTotal || 0)}</span>
                    </div>
                    {(inv.soldeDu || 0) > 0 && (
                      <div className="flex items-center justify-between mt-1 text-xs">
                        <span className="text-gray-500">Solde du</span>
                        <span className="text-red-600 font-medium">{formatCurrency(inv.soldeDu || 0)}</span>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                      {inv.statut !== 'PAYEE' && inv.statut !== 'ANNULEE' && (
                        <button onClick={() => openEditInvoice(inv)} className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20" title="Modifier"><Pencil size={14} /></button>
                      )}
                      {inv.statut === 'BROUILLON' && (
                        <button onClick={() => openSendConfirm(inv)} className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20" title="Envoyer"><Send size={14} /></button>
                      )}
                      {inv.statut !== 'PAYEE' && inv.statut !== 'ANNULEE' && inv.statut !== 'PARTIELLE' && (
                        <button onClick={() => openSendInvoiceModal(inv)} className="p-1.5 rounded text-gray-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20" title="Courriel + PDF"><Mail size={14} /></button>
                      )}
                      {inv.statut !== 'PAYEE' && inv.statut !== 'ANNULEE' && (
                        <button onClick={() => openPayment(inv)} className="p-1.5 rounded text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20" title="Paiement"><DollarSign size={14} /></button>
                      )}
                      {inv.statut !== 'BROUILLON' && inv.statut !== 'ANNULEE' && inv.typeDocument !== 'AVOIR' && (
                        <button onClick={() => openCreditNoteModal(inv)} className="p-1.5 rounded text-gray-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20" title="Note de credit"><FileMinus2 size={14} /></button>
                      )}
                      {inv.statut !== 'ANNULEE' && inv.typeDocument !== 'AVOIR' && (
                        <button onClick={() => openRecurringModal(inv)} className="p-1.5 rounded text-gray-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/20" title="Recurrence"><Repeat size={14} /></button>
                      )}
                      {(inv.statut === 'ENVOYEE' || inv.statut === 'PARTIELLEMENT_PAYEE' || inv.statut === 'EN_RETARD') && (
                        <button onClick={() => openReminderModal(inv)} className="p-1.5 rounded text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20" title="Rappel"><Bell size={14} /></button>
                      )}
                      {(inv.nbRappelsEnvoyes || 0) > 0 && (
                        <button onClick={() => openRemindersHistory(inv)} className="p-1.5 rounded text-gray-400 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20" title={`Historique rappels (${inv.nbRappelsEnvoyes})`}><History size={14} /></button>
                      )}
                      {(inv.statut === 'BROUILLON' || inv.statut === 'ANNULEE') && (
                        <button onClick={() => handleDeleteInvoice(inv)} disabled={isDeletingInvoice === inv.id} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed" title="Supprimer">{isDeletingInvoice === inv.id ? <Clock size={14} className="animate-spin" /> : <Trash2 size={14} />}</button>
                      )}
                      <button onClick={async () => { setInvoiceHtmlLoading(inv.id); try { const res = await accountingApi.generateInvoiceHtml(inv.id); setInvoiceHtmlContent(res.html); setShowInvoiceHtmlPreview(true); } catch {} finally { setInvoiceHtmlLoading(null); } }} className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20" title="Aperçu">{invoiceHtmlLoading === inv.id ? <Clock size={14} className="animate-spin" /> : <Eye size={14} />}</button>
                      <button onClick={() => handleDownloadPdf(inv)} disabled={pdfLoadingId === inv.id} className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20 disabled:opacity-50" title="PDF">{pdfLoadingId === inv.id ? <Clock size={14} className="animate-spin" /> : <Download size={14} />}</button>
                      <button onClick={() => openInvoiceExport(inv.id)} className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20" title="Imprimer"><Printer size={14} /></button>
                    </div>
                  </div>
                ))}
                {invoices.length === 0 && <p className="text-sm text-gray-400 text-center py-8">Aucune facture</p>}
              </div>
            </>
          )}

          {/* RECURRING TEMPLATES (P0 B5 — gestion templates récurrents) */}
          {tab === 'recurring' && (
            <>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="w-full sm:w-48">
                  <Select
                    options={[
                      { value: '', label: 'Tous les statuts' },
                      { value: 'ACTIVE', label: 'Actifs' },
                      { value: 'PAUSEE', label: 'En pause' },
                      { value: 'TERMINEE', label: 'Terminés' },
                      { value: 'ANNULEE', label: 'Annulés' },
                    ]}
                    value={recurringStatutFilter}
                    onChange={(e) => setRecurringStatutFilter(e.target.value as accountingApi.RecurringStatut | '')}
                  />
                </div>
                <p className="text-xs text-gray-500 italic">
                  Pour créer un nouveau template: cliquer sur l'icône <Repeat size={12} className="inline" /> d'une facture existante dans l'onglet Factures.
                </p>
              </div>
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Client</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Fréquence</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Prochaine</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Générées</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Auto Email</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase w-32">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {recurringList.map((r) => (
                        <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{r.nom}</td>
                          <td className="px-4 py-3 text-gray-500">{r.clientNom || '--'}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {r.intervalCount && r.intervalCount > 1 ? `${r.intervalCount}× ` : ''}{r.frequence}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(r.prochaineDate)}</td>
                          <td className="px-4 py-3 text-right font-medium">
                            {r.nbOccurrencesGenerees}
                            {r.nbOccurrencesMax ? ` / ${r.nbOccurrencesMax}` : ''}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge
                              color={r.statut === 'ACTIVE' ? 'green' : r.statut === 'PAUSEE' ? 'yellow' : r.statut === 'TERMINEE' ? 'blue' : 'gray'}
                              size="sm"
                            >
                              {r.statut}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-center text-xs">
                            {r.autoEnvoiEmail ? '✓' : '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {r.statut === 'ACTIVE' && (
                                <button
                                  onClick={() => handlePauseRecurring(r.id)}
                                  disabled={recurringActionLoading === r.id}
                                  className="p-1.5 rounded text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 disabled:opacity-50"
                                  title="Mettre en pause"
                                >
                                  {recurringActionLoading === r.id ? <Clock size={14} className="animate-spin" /> : <Pause size={14} />}
                                </button>
                              )}
                              {r.statut === 'PAUSEE' && (
                                <button
                                  onClick={() => handleResumeRecurring(r.id)}
                                  disabled={recurringActionLoading === r.id}
                                  className="p-1.5 rounded text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50"
                                  title="Réactiver"
                                >
                                  {recurringActionLoading === r.id ? <Clock size={14} className="animate-spin" /> : <Play size={14} />}
                                </button>
                              )}
                              {(r.statut === 'ACTIVE' || r.statut === 'PAUSEE') && (
                                <button
                                  onClick={() => handleGenerateNowRecurring(r.id)}
                                  disabled={recurringActionLoading === r.id}
                                  className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
                                  title="Générer immédiatement une facture"
                                >
                                  <Send size={14} />
                                </button>
                              )}
                              {r.statut !== 'ANNULEE' && (
                                <button
                                  onClick={() => handleDeleteRecurring(r.id)}
                                  disabled={recurringActionLoading === r.id}
                                  className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                                  title="Annuler le template (les factures déjà générées restent intactes)"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {recurringList.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                            Aucun template récurrent. Créez-en un depuis l'onglet Factures avec le bouton <Repeat size={12} className="inline" />.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {recurringList.map((r) => (
                  <div key={r.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-medium text-sm text-gray-900 dark:text-white truncate">{r.nom}</span>
                      <Badge
                        color={r.statut === 'ACTIVE' ? 'green' : r.statut === 'PAUSEE' ? 'yellow' : r.statut === 'TERMINEE' ? 'blue' : 'gray'}
                        size="sm"
                      >
                        {r.statut}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-500">{r.clientNom || '--'}</p>
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>{r.intervalCount && r.intervalCount > 1 ? `${r.intervalCount}× ` : ''}{r.frequence}</span>
                      <span>Prochaine: {formatDate(r.prochaineDate)}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Générées: {r.nbOccurrencesGenerees}{r.nbOccurrencesMax ? ` / ${r.nbOccurrencesMax}` : ''}
                      {r.autoEnvoiEmail && ' · Auto-email ✓'}
                    </div>
                    <div className="flex flex-wrap items-center gap-1 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                      {r.statut === 'ACTIVE' && (
                        <button onClick={() => handlePauseRecurring(r.id)} disabled={recurringActionLoading === r.id} className="p-1.5 rounded text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 disabled:opacity-50" title="Pause">
                          {recurringActionLoading === r.id ? <Clock size={14} className="animate-spin" /> : <Pause size={14} />}
                        </button>
                      )}
                      {r.statut === 'PAUSEE' && (
                        <button onClick={() => handleResumeRecurring(r.id)} disabled={recurringActionLoading === r.id} className="p-1.5 rounded text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50" title="Réactiver">
                          {recurringActionLoading === r.id ? <Clock size={14} className="animate-spin" /> : <Play size={14} />}
                        </button>
                      )}
                      {(r.statut === 'ACTIVE' || r.statut === 'PAUSEE') && (
                        <button onClick={() => handleGenerateNowRecurring(r.id)} disabled={recurringActionLoading === r.id} className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50" title="Générer">
                          <Send size={14} />
                        </button>
                      )}
                      {r.statut !== 'ANNULEE' && (
                        <button onClick={() => handleDeleteRecurring(r.id)} disabled={recurringActionLoading === r.id} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50" title="Annuler">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {recurringList.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-8">
                    Aucun template récurrent. Créez-en un depuis l'onglet Factures avec le bouton <Repeat size={12} className="inline" />.
                  </p>
                )}
              </div>
            </>
          )}

          {/* JOURNAL */}
          {tab === 'journal' && (
            <>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Numéro</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Description</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Montant</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {journal.map((j) => (
                        <tr key={j.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="px-4 py-3 font-mono text-xs">{j.numeroEcriture}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(j.dateEcriture)}</td>
                          <td className="px-4 py-3 text-gray-900 dark:text-white">{j.libelle}</td>
                          <td className="px-4 py-3 text-gray-500">{j.typeJournal}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(j.montantTotal || 0)}</td>
                          <td className="px-4 py-3 text-center"><Badge color={JOURNAL_STATUT_COLORS[j.statut] || 'gray'} size="sm">{j.statut}</Badge></td>
                        </tr>
                      ))}
                      {journal.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucune ecriture</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {journal.map((j) => (
                  <div key={j.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-xs text-seaop-primary-600">{j.numeroEcriture}</span>
                      <Badge color={JOURNAL_STATUT_COLORS[j.statut] || 'gray'} size="sm">{j.statut}</Badge>
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{j.libelle}</p>
                    <div className="flex items-center justify-between mt-1.5 text-xs text-gray-500">
                      <span>{formatDate(j.dateEcriture)} - {j.typeJournal}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(j.montantTotal || 0)}</span>
                    </div>
                  </div>
                ))}
                {journal.length === 0 && <p className="text-sm text-gray-400 text-center py-8">Aucune ecriture</p>}
              </div>
            </>
          )}

          {/* CHART OF ACCOUNTS */}
          {tab === 'plan_comptable' && (
            <Card padding="sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Code</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Solde normal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {accounts.map((a) => (
                      <tr key={a.id} className={`hover:bg-gray-50 dark:hover:bg-gray-800/30 ${a.niveau === 1 ? 'font-semibold bg-gray-50 dark:bg-gray-800/20' : ''}`}>
                        <td className="px-4 py-2 font-mono text-xs" style={{ paddingLeft: `${(a.niveau - 1) * 20 + 16}px` }}>{a.code}</td>
                        <td className="px-4 py-2 text-gray-900 dark:text-white">{a.nom}</td>
                        <td className="px-4 py-2 text-gray-500">{a.type}</td>
                        <td className="px-4 py-2 text-center text-xs text-gray-400">{a.soldeNormal}</td>
                      </tr>
                    ))}
                    {accounts.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Aucun compte</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* GRAND LIVRE */}
          {tab === 'grand_livre' && (
            <Card padding="sm">
              {ledgerEntries.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-400">
                  Sélectionnez un compte et cliquez sur Charger pour afficher le grand livre
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">No Ecriture</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Libelle</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Debit</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Credit</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Solde cumulatif</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {ledgerEntries.map((entry: any, idx: number) => (
                        <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(entry.dateEcriture)}</td>
                          <td className="px-4 py-3 font-mono text-xs">{entry.numeroEcriture || '--'}</td>
                          <td className="px-4 py-3 text-gray-900 dark:text-white">{entry.libelle || entry.description || '--'}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(entry.debit || 0)}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(entry.credit || 0)}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(entry.soldeCumulatif || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {/* ETATS FINANCIERS */}
          {tab === 'etats_financiers' && (
            <>
              {/* Bilan */}
              {finSubTab === 'bilan' && balanceSheet && (
                <Card padding="sm">
                  <div className="overflow-x-auto">
                    <h3 className="px-4 py-3 text-lg font-semibold text-gray-900 dark:text-white">Bilan</h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Compte</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Solde</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {/* Actifs court terme */}
                        <tr className="bg-gray-50 dark:bg-gray-800/20">
                          <td colSpan={2} className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Actifs court terme</td>
                        </tr>
                        {(balanceSheet.actifsCourtTerme || []).map((a: any, i: number) => (
                          <tr key={`act-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                            <td className="px-4 py-2 pl-8 text-gray-900 dark:text-white">{a.code} - {a.nom}</td>
                            <td className="px-4 py-2 text-right">{formatCurrency(a.solde || 0)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-gray-300 dark:border-gray-600">
                          <td className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Total actifs court terme</td>
                          <td className="px-4 py-2 text-right font-semibold">{formatCurrency(balanceSheet.totalActifsCourtTerme || 0)}</td>
                        </tr>

                        {/* Actifs long terme */}
                        <tr className="bg-gray-50 dark:bg-gray-800/20">
                          <td colSpan={2} className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Actifs long terme</td>
                        </tr>
                        {(balanceSheet.actifsLongTerme || []).map((a: any, i: number) => (
                          <tr key={`alt-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                            <td className="px-4 py-2 pl-8 text-gray-900 dark:text-white">{a.code} - {a.nom}</td>
                            <td className="px-4 py-2 text-right">{formatCurrency(a.solde || 0)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-gray-300 dark:border-gray-600">
                          <td className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Total actifs long terme</td>
                          <td className="px-4 py-2 text-right font-semibold">{formatCurrency(balanceSheet.totalActifsLongTerme || 0)}</td>
                        </tr>

                        {/* Passifs court terme */}
                        <tr className="bg-gray-50 dark:bg-gray-800/20">
                          <td colSpan={2} className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Passifs court terme</td>
                        </tr>
                        {(balanceSheet.passifsCourtTerme || []).map((a: any, i: number) => (
                          <tr key={`pct-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                            <td className="px-4 py-2 pl-8 text-gray-900 dark:text-white">{a.code} - {a.nom}</td>
                            <td className="px-4 py-2 text-right">{formatCurrency(a.solde || 0)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-gray-300 dark:border-gray-600">
                          <td className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Total passifs court terme</td>
                          <td className="px-4 py-2 text-right font-semibold">{formatCurrency(balanceSheet.totalPassifsCourtTerme || 0)}</td>
                        </tr>

                        {/* Passifs long terme */}
                        <tr className="bg-gray-50 dark:bg-gray-800/20">
                          <td colSpan={2} className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Passifs long terme</td>
                        </tr>
                        {(balanceSheet.passifsLongTerme || []).map((a: any, i: number) => (
                          <tr key={`plt-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                            <td className="px-4 py-2 pl-8 text-gray-900 dark:text-white">{a.code} - {a.nom}</td>
                            <td className="px-4 py-2 text-right">{formatCurrency(a.solde || 0)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-gray-300 dark:border-gray-600">
                          <td className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Total passifs long terme</td>
                          <td className="px-4 py-2 text-right font-semibold">{formatCurrency(balanceSheet.totalPassifsLongTerme || 0)}</td>
                        </tr>

                        {/* Capitaux propres */}
                        <tr className="bg-gray-50 dark:bg-gray-800/20">
                          <td colSpan={2} className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Capitaux propres</td>
                        </tr>
                        {(balanceSheet.capitaux || balanceSheet.capitauxPropres || []).map((a: any, i: number) => (
                          <tr key={`cp-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                            <td className="px-4 py-2 pl-8 text-gray-900 dark:text-white">{a.code} - {a.nom}</td>
                            <td className="px-4 py-2 text-right">{formatCurrency(a.solde || 0)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-gray-300 dark:border-gray-600">
                          <td className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Total capitaux propres</td>
                          <td className="px-4 py-2 text-right font-semibold">{formatCurrency(balanceSheet.totalCapitaux || balanceSheet.totalCapitauxPropres || 0)}</td>
                        </tr>

                        {/* Final totals */}
                        <tr className="border-t-2 border-gray-400 dark:border-gray-500 bg-gray-100 dark:bg-gray-700/50">
                          <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">Actif total</td>
                          <td className="px-4 py-3 text-right font-bold">{formatCurrency(balanceSheet.totalActifs || balanceSheet.actifTotal || 0)}</td>
                        </tr>
                        <tr className="bg-gray-100 dark:bg-gray-700/50">
                          <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">Passif + Capitaux propres</td>
                          <td className="px-4 py-3 text-right font-bold">{formatCurrency(balanceSheet.totalPassifsEtCapitaux || ((balanceSheet.totalPassifsCourtTerme || 0) + (balanceSheet.totalPassifsLongTerme || 0) + (balanceSheet.totalCapitaux || 0)))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
              {finSubTab === 'bilan' && !balanceSheet && !isLoading && (
                <div className="px-4 py-8 text-center text-gray-400">Aucune donnée de bilan disponible</div>
              )}

              {/* Resultats */}
              {finSubTab === 'resultats' && incomeStatement && (
                <Card padding="sm">
                  <div className="overflow-x-auto">
                    <h3 className="px-4 py-3 text-lg font-semibold text-gray-900 dark:text-white">État des résultats</h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Poste</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Montant</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {/* Revenus */}
                        <tr className="bg-gray-50 dark:bg-gray-800/20">
                          <td colSpan={2} className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Revenus</td>
                        </tr>
                        {(incomeStatement.revenus || []).map((r: any, i: number) => (
                          <tr key={`rev-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                            <td className="px-4 py-2 pl-8 text-gray-900 dark:text-white">{r.code} - {r.nom}</td>
                            <td className="px-4 py-2 text-right">{formatCurrency(r.solde || r.montant || 0)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-gray-300 dark:border-gray-600">
                          <td className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Total revenus</td>
                          <td className="px-4 py-2 text-right font-semibold text-green-600">{formatCurrency(incomeStatement.totalRevenus || 0)}</td>
                        </tr>

                        {/* Couts */}
                        <tr className="bg-gray-50 dark:bg-gray-800/20">
                          <td colSpan={2} className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Couts des ventes</td>
                        </tr>
                        {(incomeStatement.coutsContrats || incomeStatement.couts || incomeStatement.coutsVentes || []).map((c: any, i: number) => (
                          <tr key={`cout-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                            <td className="px-4 py-2 pl-8 text-gray-900 dark:text-white">{c.code} - {c.nom}</td>
                            <td className="px-4 py-2 text-right">{formatCurrency(c.solde || c.montant || 0)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-gray-300 dark:border-gray-600">
                          <td className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Total couts des ventes</td>
                          <td className="px-4 py-2 text-right font-semibold text-red-600">{formatCurrency(incomeStatement.totalCoutsContrats || 0)}</td>
                        </tr>
                        <tr className="border-t border-gray-300 dark:border-gray-600 bg-blue-50 dark:bg-blue-900/20">
                          <td className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Marge brute</td>
                          <td className="px-4 py-2 text-right font-semibold">{formatCurrency(incomeStatement.margeBrute || 0)}</td>
                        </tr>

                        {/* Frais */}
                        <tr className="bg-gray-50 dark:bg-gray-800/20">
                          <td colSpan={2} className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Frais d'exploitation</td>
                        </tr>
                        {(incomeStatement.fraisExploitation || []).map((f: any, i: number) => (
                          <tr key={`frais-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                            <td className="px-4 py-2 pl-8 text-gray-900 dark:text-white">{f.code} - {f.nom}</td>
                            <td className="px-4 py-2 text-right">{formatCurrency(f.solde || f.montant || 0)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-gray-300 dark:border-gray-600">
                          <td className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">Total frais d'exploitation</td>
                          <td className="px-4 py-2 text-right font-semibold text-red-600">{formatCurrency(incomeStatement.totalFraisExploitation || 0)}</td>
                        </tr>

                        {/* Resultat net */}
                        <tr className="border-t-2 border-gray-400 dark:border-gray-500 bg-gray-100 dark:bg-gray-700/50">
                          <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">Resultat net</td>
                          <td className={`px-4 py-3 text-right font-bold ${(incomeStatement.resultatNet || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(incomeStatement.resultatNet || 0)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
              {finSubTab === 'resultats' && !incomeStatement && !isLoading && (
                <div className="px-4 py-8 text-center text-gray-400">Aucune donnée de resultats disponible</div>
              )}

              {/* Flux de tresorerie */}
              {/* Taxes TPS/TVQ */}
              {finSubTab === 'taxes' && (
                <Card padding="sm">
                  <div className="px-4 py-3 flex flex-wrap items-end gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Début</label>
                      <Input type="date" value={taxPeriod.dateDebut} onChange={(e) => setTaxPeriod(p => ({ ...p, dateDebut: e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Fin</label>
                      <Input type="date" value={taxPeriod.dateFin} onChange={(e) => setTaxPeriod(p => ({ ...p, dateFin: e.target.value }))} />
                    </div>
                    <Button onClick={fetchTaxDeclaration}>Calculer</Button>
                    {taxDeclaration && (
                      <Button variant="ghost" onClick={() => accountingApi.exportTaxDeclarationCsv(taxPeriod)}>
                        <Calculator size={14} className="mr-1" /> Export CSV
                      </Button>
                    )}
                  </div>
                  {taxDeclaration && (
                    <div className="px-4 pb-4 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
                          <div className="text-xs text-gray-500 uppercase">TPS Net</div>
                          <div className={`text-lg font-bold ${taxDeclaration.tps?.netDu >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {formatCurrency(taxDeclaration.tps?.netDu || 0)}
                          </div>
                          <div className="text-xs text-gray-400">Collectee: {formatCurrency(taxDeclaration.tps?.collectee || 0)} | Payee: {formatCurrency(taxDeclaration.tps?.payee || 0)}</div>
                        </div>
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
                          <div className="text-xs text-gray-500 uppercase">TVQ Net</div>
                          <div className={`text-lg font-bold ${taxDeclaration.tvq?.netDu >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {formatCurrency(taxDeclaration.tvq?.netDu || 0)}
                          </div>
                          <div className="text-xs text-gray-400">Collectee: {formatCurrency(taxDeclaration.tvq?.collectee || 0)} | Payee: {formatCurrency(taxDeclaration.tvq?.payee || 0)}</div>
                        </div>
                        <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-center">
                          <div className="text-xs text-gray-500 uppercase">Total Net Du</div>
                          <div className={`text-xl font-bold ${taxDeclaration.totalNet >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {formatCurrency(taxDeclaration.totalNet || 0)}
                          </div>
                          <div className="text-xs text-gray-400">{taxDeclaration.totalNet >= 0 ? 'A remettre au gouvernement' : 'Remboursement a recevoir'}</div>
                        </div>
                      </div>
                      {taxDeclaration.breakdown?.length > 0 && (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Mois</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">TPS Collectee</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">TPS Payee</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">TPS Net</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">TVQ Collectee</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">TVQ Payee</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">TVQ Net</th>
                            </tr>
                          </thead>
                          <tbody>
                            {taxDeclaration.breakdown.map((m: any, i: number) => (
                              <tr key={i} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                                <td className="px-3 py-2 font-medium">{m.mois}</td>
                                <td className="px-3 py-2 text-right">{formatCurrency(m.tpsCollectee || 0)}</td>
                                <td className="px-3 py-2 text-right">{formatCurrency(m.tpsPayee || 0)}</td>
                                <td className="px-3 py-2 text-right font-medium">{formatCurrency(m.tpsNet || 0)}</td>
                                <td className="px-3 py-2 text-right">{formatCurrency(m.tvqCollectee || 0)}</td>
                                <td className="px-3 py-2 text-right">{formatCurrency(m.tvqPayee || 0)}</td>
                                <td className="px-3 py-2 text-right font-medium">{formatCurrency(m.tvqNet || 0)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                  {!taxDeclaration && !isLoading && (
                    <div className="px-4 py-8 text-center text-gray-400">Sélectionnez une période et cliquez Calculer</div>
                  )}
                </Card>
              )}

              {finSubTab === 'flux' && (
                <Card padding="sm">
                  <div className="overflow-x-auto">
                    <h3 className="px-4 py-3 text-lg font-semibold text-gray-900 dark:text-white">Flux de tresorerie</h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Mois</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Entrées</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Sorties</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Net</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {cashFlow.map((row: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                            <td className="px-4 py-3 text-gray-900 dark:text-white">{row.mois || row.month || '--'}</td>
                            <td className="px-4 py-3 text-right text-green-600">{formatCurrency(row.entrees || row.inflows || 0)}</td>
                            <td className="px-4 py-3 text-right text-red-600">{formatCurrency(row.sorties || row.outflows || 0)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${(row.net || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {formatCurrency(row.net || 0)}
                            </td>
                          </tr>
                        ))}
                        {cashFlow.length === 0 && (
                          <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Aucune donnée de flux disponible</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}

          {/* TRANSACTIONS */}
          {tab === 'transactions' && (
            <>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Référence</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Description</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Montant</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {transactions.map((t: any, idx: number) => (
                        <tr key={`${t.typeTransaction}-${t.id}-${idx}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="px-4 py-3">
                            <Badge color={t.typeTransaction === 'revenus' ? 'green' : 'red'} size="sm">
                              {t.typeTransaction === 'revenus' ? 'Revenu' : 'Depense'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{t.reference || '--'}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(t.dateTransaction)}</td>
                          <td className="px-4 py-3 text-gray-900 dark:text-white">{t.description || '--'}</td>
                          <td className={`px-4 py-3 text-right font-medium ${t.typeTransaction === 'revenus' ? 'text-green-600' : 'text-red-600'}`}>
                            {t.typeTransaction === 'depenses' ? '-' : ''}{formatCurrency(t.montant || 0)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge color={t.statut === 'PAYEE' ? 'green' : t.statut === 'EN_RETARD' ? 'red' : 'blue'} size="sm">{t.statut || '--'}</Badge>
                          </td>
                        </tr>
                      ))}
                      {transactions.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucune transaction</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {transactions.map((t: any, idx: number) => (
                  <div key={`${t.typeTransaction}-${t.id}-${idx}`} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <Badge color={t.typeTransaction === 'revenus' ? 'green' : 'red'} size="sm">
                        {t.typeTransaction === 'revenus' ? 'Revenu' : 'Depense'}
                      </Badge>
                      <Badge color={t.statut === 'PAYEE' ? 'green' : t.statut === 'EN_RETARD' ? 'red' : 'blue'} size="sm">{t.statut || '--'}</Badge>
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{t.description || '--'}</p>
                    <div className="flex items-center justify-between mt-1.5 text-xs text-gray-500">
                      <span>{formatDate(t.dateTransaction)} {t.reference ? `- ${t.reference}` : ''}</span>
                      <span className={`font-medium ${t.typeTransaction === 'revenus' ? 'text-green-600' : 'text-red-600'}`}>
                        {t.typeTransaction === 'depenses' ? '-' : ''}{formatCurrency(t.montant || 0)}
                      </span>
                    </div>
                  </div>
                ))}
                {transactions.length === 0 && <p className="text-sm text-gray-400 text-center py-8">Aucune transaction</p>}
              </div>
            </>
          )}

          {/* DASHBOARD FINANCIER */}
          {tab === 'dashboard_financier' && dashboardData && (
            <div className="space-y-4">
              {/* Totals summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard label="Chiffre d'affaires" value={formatCurrency(dashboardData.totals?.ca || 0)} icon={<DollarSign size={20} />} color="green" />
                <StatCard label="Dépenses totales" value={formatCurrency(dashboardData.totals?.depenses || 0)} icon={<AlertCircle size={20} />} color="red" />
                <StatCard label="Profit net" value={formatCurrency(dashboardData.totals?.profit || 0)} icon={<CheckCircle size={20} />} color={(dashboardData.totals?.profit || 0) >= 0 ? 'green' : 'red'} />
              </div>

              {/* Monthly breakdown table */}
              <Card padding="sm">
                <div className="overflow-x-auto">
                  <h3 className="px-4 py-3 text-lg font-semibold text-gray-900 dark:text-white">Ventilation mensuelle</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Mois</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Revenus</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Dépenses</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Profit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {(dashboardData.monthlyData || []).map((row: any, idx: number) => (
                        <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{row.mois || '--'}</td>
                          <td className="px-4 py-3 text-right text-green-600">{formatCurrency(row.revenus || 0)}</td>
                          <td className="px-4 py-3 text-right text-red-600">{formatCurrency(row.depenses || 0)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${(row.profit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(row.profit || 0)}
                          </td>
                        </tr>
                      ))}
                      {(dashboardData.monthlyData || []).length === 0 && (
                        <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Aucune donnée mensuelle</td></tr>
                      )}
                    </tbody>
                    {(dashboardData.monthlyData || []).length > 0 && (
                      <tfoot>
                        <tr className="border-t-2 border-gray-400 dark:border-gray-500 bg-gray-100 dark:bg-gray-700/50">
                          <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">Total</td>
                          <td className="px-4 py-3 text-right font-bold text-green-600">{formatCurrency(dashboardData.totals?.ca || 0)}</td>
                          <td className="px-4 py-3 text-right font-bold text-red-600">{formatCurrency(dashboardData.totals?.depenses || 0)}</td>
                          <td className={`px-4 py-3 text-right font-bold ${(dashboardData.totals?.profit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(dashboardData.totals?.profit || 0)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </Card>
            </div>
          )}
          {tab === 'dashboard_financier' && !dashboardData && !isLoading && (
            <div className="px-4 py-8 text-center text-gray-400">Aucune donnée de dashboard disponible</div>
          )}

          {/* PERIODES COMPTABLES */}
          {tab === 'periodes' && (
            <>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Début</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Fin</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Clôturée par</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase w-32">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {periods.map((p: any) => (
                        <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{p.nom || `P${p.periode} - ${p.anneeFiscale}`}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(p.dateDebut)}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(p.dateFin)}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge color={p.statut === 'CLOTUREE' ? 'gray' : 'green'} size="sm">{p.statut}</Badge>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{p.cloturePar || '--'}</td>
                          <td className="px-4 py-3 text-center">
                            {p.statut === 'OUVERTE' && (
                              <Button size="sm" variant="ghost" leftIcon={<Lock size={14} />} onClick={() => handleClosePeriod(p.id)}>
                                Cloturer
                              </Button>
                            )}
                            {p.statut === 'CLOTUREE' && (
                              <span className="text-xs text-gray-400">{formatDate(p.clotureAt)}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {periods.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucune période comptable</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {periods.map((p: any) => (
                  <div key={p.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate mr-2">{p.nom || `P${p.periode} - ${p.anneeFiscale}`}</span>
                      <Badge color={p.statut === 'CLOTUREE' ? 'gray' : 'green'} size="sm">{p.statut}</Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{formatDate(p.dateDebut)} - {formatDate(p.dateFin)}</span>
                    </div>
                    {p.statut === 'OUVERTE' && (
                      <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                        <Button size="sm" variant="ghost" leftIcon={<Lock size={14} />} onClick={() => handleClosePeriod(p.id)}>
                          Cloturer
                        </Button>
                      </div>
                    )}
                    {p.statut === 'CLOTUREE' && p.cloturePar && (
                      <div className="text-xs text-gray-400 mt-1">Clôturée par: {p.cloturePar}</div>
                    )}
                  </div>
                ))}
                {periods.length === 0 && <p className="text-sm text-gray-400 text-center py-8">Aucune période comptable</p>}
              </div>
            </>
          )}

          {/* CENTRES DE COUTS */}
          {tab === 'centres_couts' && (
            <div className="space-y-4">
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Code</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Budget annuel</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {costCenters.map((cc: any) => (
                        <tr key={cc.id || cc.code} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="px-4 py-3 font-mono text-xs">{cc.code}</td>
                          <td className="px-4 py-3 text-gray-900 dark:text-white">{cc.nom}</td>
                          <td className="px-4 py-3 text-gray-500">{cc.type || '--'}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(cc.budgetAnnuel || 0)}</td>
                        </tr>
                      ))}
                      {costCenters.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Aucun centre de couts</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {costCenters.map((cc: any) => (
                  <div key={cc.id || cc.code} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs text-seaop-primary-600">{cc.code}</span>
                      <span className="text-xs text-gray-500">{cc.type || '--'}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{cc.nom}</p>
                    <div className="text-xs text-gray-500 mt-1">Budget: {formatCurrency(cc.budgetAnnuel || 0)}</div>
                  </div>
                ))}
                {costCenters.length === 0 && <p className="text-sm text-gray-400 text-center py-8">Aucun centre de couts</p>}
              </div>

              {/* Summary */}
              {costCentersSummary.length > 0 && (
                <Card padding="sm">
                  <h3 className="px-4 py-3 text-lg font-semibold text-gray-900 dark:text-white">Résumé des coûts par centre</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Centre</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Budget</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Dépenses</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Ecart</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {costCentersSummary.map((s: any, idx: number) => {
                          const budget = s.budgetAnnuel || 0;
                          const depenses = s.totalDebit || s.solde || 0;
                          const ecart = budget - depenses;
                          return (
                            <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                              <td className="px-4 py-3 text-gray-900 dark:text-white">{s.code} - {s.nom}</td>
                              <td className="px-4 py-3 text-right">{formatCurrency(budget)}</td>
                              <td className="px-4 py-3 text-right">{formatCurrency(depenses)}</td>
                              <td className={`px-4 py-3 text-right font-medium ${ecart >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {formatCurrency(ecart)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />}
        </>
      )}

      {/* RETENUES DE CHANTIER */}
      {tab === 'retenues' && (
        <>
          <Card padding="sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Facture</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Client</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Montant Retenu</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Fin Travaux</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Liberation</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {holdbacks.map((h: any) => (
                    <tr key={h.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-3 font-medium">{h.numeroFacture || `#${h.factureId}`}</td>
                      <td className="px-4 py-3">{h.clientNom || '--'}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatCurrency(h.montantRetenu || 0)}</td>
                      <td className="px-4 py-3">{h.dateFinTravaux ? formatDate(h.dateFinTravaux) : '--'}</td>
                      <td className="px-4 py-3">{h.dateLiberation ? formatDate(h.dateLiberation) : '--'}</td>
                      <td className="px-4 py-3"><Badge color={h.statut === 'LIBEREE' ? 'green' : 'yellow'}>{h.statut}</Badge></td>
                      <td className="px-4 py-3">
                        {h.statut === 'RETENUE' && (
                          <Button size="sm" variant="ghost" onClick={async () => {
                            try { await accountingApi.releaseHoldback(h.id); fetchHoldbacks(); } catch { setError('Erreur liberation'); }
                          }}>Liberer</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {holdbacks.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucune retenue de chantier</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* IMMOBILISATIONS */}
      {tab === 'immobilisations' && (
        <>
          {fixedAssetsSummary && (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500 uppercase">Nombre d'actifs</div>
                <div className="text-lg font-bold text-blue-600">{fixedAssetsSummary.nombreActifs || 0}</div>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500 uppercase">Coût d'acquisition</div>
                <div className="text-lg font-bold text-green-600">{formatCurrency(fixedAssetsSummary.totalCout || 0)}</div>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500 uppercase">Amortissement cumule</div>
                <div className="text-lg font-bold text-red-600">{formatCurrency(fixedAssetsSummary.totalAmortCumule || 0)}</div>
              </div>
              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500 uppercase">Valeur nette</div>
                <div className="text-lg font-bold">{formatCurrency(fixedAssetsSummary.valeurNetteTotal || 0)}</div>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <div className="flex items-center gap-2">
              <Input type="month" value={depreciationMonth} onChange={(e) => setDepreciationMonth(e.target.value)} />
              <Button variant="ghost" onClick={async () => {
                try { const res = await accountingApi.generateDepreciation(depreciationMonth); setError(null); fetchFixedAssets(); fetchFixedAssetsSummary(); alert(res.message); }
                catch (err: any) { setError(err?.response?.data?.detail || 'Erreur'); }
              }}>Générer amortissement</Button>
            </div>
            <Button leftIcon={<Plus size={16} />} onClick={() => setShowCreateAsset(true)}>Nouvel actif</Button>
          </div>
          <Card padding="sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Catégorie</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date Acq.</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Coût</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Amort. Cumule</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Valeur Nette</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Methode</th>
                  </tr>
                </thead>
                <tbody>
                  {fixedAssets.map((a: any) => (
                    <tr key={a.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-3 font-medium">{a.nom}</td>
                      <td className="px-4 py-3"><Badge color="blue">{a.categorie}</Badge></td>
                      <td className="px-4 py-3">{formatDate(a.dateAcquisition)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(a.coutAcquisition || 0)}</td>
                      <td className="px-4 py-3 text-right text-red-600">{formatCurrency(a.amortCumule || 0)}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatCurrency(a.valeurNette || 0)}</td>
                      <td className="px-4 py-3 text-xs">{a.methodeAmortissement} ({a.dureeVieMois}m)</td>
                    </tr>
                  ))}
                  {fixedAssets.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucune immobilisation</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Create Asset Modal */}
      {showCreateAsset && (
        <Modal isOpen={showCreateAsset} onClose={() => setShowCreateAsset(false)} title="Nouvelle Immobilisation" size="lg">
          <div className="space-y-3">
            <Input label="Nom" value={assetForm.nom} onChange={(e) => setAssetForm(f => ({ ...f, nom: e.target.value }))} />
            <Select label="Catégorie" options={[
              { value: 'EQUIPEMENT', label: 'Equipement' }, { value: 'VEHICULE', label: 'Vehicule' },
              { value: 'BATIMENT', label: 'Batiment' }, { value: 'MOBILIER', label: 'Mobilier' },
              { value: 'INFORMATIQUE', label: 'Informatique' },
            ]} value={assetForm.categorie} onChange={(e) => setAssetForm(f => ({ ...f, categorie: e.target.value }))} />
            <Input label="Date d'acquisition" type="date" value={assetForm.dateAcquisition} onChange={(e) => setAssetForm(f => ({ ...f, dateAcquisition: e.target.value }))} />
            <Input label="Coût d'acquisition ($)" type="number" min="0" value={assetForm.coutAcquisition} onChange={(e) => setAssetForm(f => ({ ...f, coutAcquisition: e.target.value }))} />
            <Input label="Durée de vie (mois)" type="number" value={assetForm.dureeVieMois} onChange={(e) => setAssetForm(f => ({ ...f, dureeVieMois: e.target.value }))} />
            <Select label="Méthode" options={[
              { value: 'LINEAIRE', label: 'Linéaire' }, { value: 'DEGRESSIF', label: 'Dégressif' },
            ]} value={assetForm.methodeAmortissement} onChange={(e) => setAssetForm(f => ({ ...f, methodeAmortissement: e.target.value }))} />
            <Input label="Valeur residuelle ($)" type="number" min="0" value={assetForm.valeurResiduelle} onChange={(e) => setAssetForm(f => ({ ...f, valeurResiduelle: e.target.value }))} />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowCreateAsset(false)}>Annuler</Button>
              <Button isLoading={assetFormLoading} disabled={!assetForm.nom || !assetForm.dateAcquisition || !assetForm.coutAcquisition} onClick={async () => {
                if (!assetForm.nom || !assetForm.dateAcquisition || !parseAmount(assetForm.coutAcquisition)) {
                  setError('Nom, date et cout requis'); return;
                }
                setAssetFormLoading(true);
                try {
                  await accountingApi.createFixedAsset({
                    nom: assetForm.nom, categorie: assetForm.categorie,
                    dateAcquisition: assetForm.dateAcquisition,
                    coutAcquisition: parseAmount(assetForm.coutAcquisition),
                    dureeVieMois: parseInt(assetForm.dureeVieMois) || 60,
                    methodeAmortissement: assetForm.methodeAmortissement,
                    valeurResiduelle: parseAmount(assetForm.valeurResiduelle),
                    notes: assetForm.notes,
                  });
                  setShowCreateAsset(false);
                  fetchFixedAssets(); fetchFixedAssetsSummary();
                } catch (err: any) { setError(err?.response?.data?.detail || 'Erreur'); }
                finally { setAssetFormLoading(false); }
              }}>Créer</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create Invoice Modal */}
      {/* Scan Invoice Modal */}
      <Modal isOpen={showScanInvoice} onClose={() => { setShowScanInvoice(false); setScanResult(null); setScanError(null); }} title="Scanner facture fournisseur avec IA" size="lg">
        <div className="space-y-4">
          {scanning && (
            <div className="flex flex-col items-center py-8">
              <Spinner />
              <p className="text-sm text-gray-500 mt-3">Analyse de la facture en cours...</p>
              <p className="text-xs text-gray-400 mt-1">Claude Vision extrait les donnees</p>
            </div>
          )}
          {scanError && <Alert type="error" onClose={() => setScanError(null)}>{scanError}</Alert>}
          {scanResult && !scanning && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={16} className="text-purple-500" />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Donnees extraites</span>
                <span className={`ml-auto px-2 py-0.5 rounded text-xs font-medium ${
                  scanResult.confiance === 'haute' ? 'bg-green-100 text-green-700' :
                  scanResult.confiance === 'moyenne' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  Confiance: {scanResult.confiance}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Fournisseur:</span> <span className="font-medium">{scanResult.fournisseurNom || '—'}</span></div>
                <div><span className="text-gray-500">No facture:</span> <span className="font-medium">{scanResult.numeroFacture || '—'}</span></div>
                <div><span className="text-gray-500">Date:</span> <span className="font-medium">{scanResult.dateFacture || '—'}</span></div>
                <div><span className="text-gray-500">Échéance:</span> <span className="font-medium">{scanResult.dateEcheance || '—'}</span></div>
                <div><span className="text-gray-500">Sous-total HT:</span> <span className="font-medium">{scanResult.montantHt?.toFixed(2)} $</span></div>
                <div><span className="text-gray-500">TPS:</span> <span className="font-medium">{scanResult.tps?.toFixed(2)} $</span></div>
                <div><span className="text-gray-500">TVQ:</span> <span className="font-medium">{scanResult.tvq?.toFixed(2)} $</span></div>
                <div><span className="text-gray-500">Total TTC:</span> <span className="font-bold text-green-600">{scanResult.montantTtc?.toFixed(2)} $</span></div>
              </div>
              {scanResult.lignes.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">{scanResult.lignes.length} ligne(s):</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {scanResult.lignes.map((l, i) => (
                      <div key={i} className="flex justify-between text-xs bg-gray-50 dark:bg-gray-800 px-2 py-1 rounded">
                        <span className="truncate flex-1">{l.description}</span>
                        <span className="ml-2 font-medium">{l.montant?.toFixed(2)} $</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {scanResult.notes && <p className="text-xs text-gray-400 italic">{scanResult.notes}</p>}
              <div className="flex gap-2 pt-2">
                <Button onClick={handleApplyScanResult} className="flex-1" leftIcon={<CheckCircle size={16} />}>
                  Créer la facture fournisseur
                </Button>
                <Button variant="ghost" onClick={() => { setShowScanInvoice(false); setScanResult(null); }}>Annuler</Button>
              </div>
            </div>
          )}
          {!scanning && !scanResult && !scanError && (
            <div className="text-center py-8">
              <Camera size={48} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-gray-500">Sélectionnez une photo ou un PDF de facture fournisseur</p>
              <Button className="mt-4" onClick={() => scanFileRef.current?.click()} leftIcon={<Upload size={16} />}>
                Choisir un fichier
              </Button>
            </div>
          )}
        </div>
      </Modal>

      <Modal isOpen={showCreateInvoice} onClose={() => setShowCreateInvoice(false)} title={((invoiceForm).typeDestinataire === 'fournisseur') ? 'Nouvelle Facture Fournisseur' : 'Nouvelle Facture Client'} size="xl">
        <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-1">
          {invoiceFormError && <Alert type="error" onClose={() => setInvoiceFormError(null)}>{invoiceFormError}</Alert>}

          {/* Informations essentielles */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Informations essentielles</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(invoiceForm).typeDestinataire === 'fournisseur' ? (
                <>
                  <Select
                    label="Fournisseur"
                    options={[
                      { value: '', label: 'Sélectionner un fournisseur' },
                      ...suppliersList.map((s) => ({ value: String(s.id), label: s.nom })),
                    ]}
                    value={(invoiceForm).fournisseurId || ''}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, fournisseurId: e.target.value })}
                  />
                  <Input
                    label="No facture fournisseur"
                    value={(invoiceForm).numeroFactureFournisseur || ''}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, numeroFactureFournisseur: e.target.value })}
                    placeholder="Ex: INV-2026-001"
                  />
                </>
              ) : (
              <Select
                label="Client (Entreprise)"
                options={[
                  { value: '', label: 'Sélectionner une entreprise' },
                  ...companiesList.map((c) => ({ value: String(c.id), label: c.nom })),
                ]}
                value={invoiceForm.clientCompanyId}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, clientCompanyId: e.target.value })}
              />
              )}
              <Input
                label="Date d'emission"
                type="date"
                value={invoiceForm.dateFacture}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, dateFacture: e.target.value })}
              />
              <Input
                label={`Date d'echeance${!dateEcheanceTouched ? ' (auto)' : ''}`}
                type="date"
                value={invoiceForm.dateEcheance}
                onChange={(e) => {
                  setDateEcheanceTouched(true);
                  setInvoiceForm({ ...invoiceForm, dateEcheance: e.target.value });
                }}
                min={invoiceForm.dateFacture}
              />
              <Select
                label="Projet"
                options={[
                  { value: '', label: 'Aucun projet' },
                  ...projectsList.map((p) => ({ value: String(p.id), label: p.nomProjet || `Projet #${p.id}` })),
                ]}
                value={invoiceForm.projectId}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, projectId: e.target.value })}
              />
              <Select
                label="Conditions"
                options={PAIEMENT_OPTIONS}
                value={invoiceForm.conditionsPaiement}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, conditionsPaiement: e.target.value })}
              />
            </div>
          </div>

          {/* Detail de la facture - Lignes */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Detail de la facture</h4>
            <div className="space-y-2">
              {/* Header */}
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 uppercase px-1">
                <div className="col-span-6">Description</div>
                <div className="col-span-2">Qte</div>
                <div className="col-span-2">Prix unit.</div>
                <div className="col-span-1">Montant</div>
                <div className="col-span-1"></div>
              </div>
              {invoiceLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-6">
                    <input
                      type="text"
                      placeholder="Description du service/produit"
                      value={line.description}
                      onChange={(e) => updateInvoiceLine(idx, 'description', e.target.value)}
                      className="erp-input text-sm"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      value={line.quantite}
                      onChange={(e) => updateInvoiceLine(idx, 'quantite', parseAmount(e.target.value))}
                      className="erp-input text-sm text-center"
                      min={0}
                      step={0.01}
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      value={line.prixUnitaire || ''}
                      onChange={(e) => updateInvoiceLine(idx, 'prixUnitaire', parseAmount(e.target.value))}
                      className="erp-input text-sm text-right"
                      min={0}
                      step={0.01}
                    />
                  </div>
                  <div className="col-span-1 text-sm text-right text-gray-600 font-medium">
                    {formatCurrency(line.quantite * line.prixUnitaire)}
                  </div>
                  <div className="col-span-1 text-center">
                    {invoiceLines.length > 1 && (
                      <button onClick={() => removeInvoiceLine(idx)} className="p-1 text-gray-400 hover:text-red-500">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <Button size="sm" variant="ghost" leftIcon={<Plus size={14} />} onClick={addInvoiceLine}>
                Ajouter une ligne
              </Button>
            </div>

            {/* Totaux */}
            <div className="mt-4 flex justify-between items-start">
              <div className="text-sm text-gray-500 space-y-1">
                <p>Sous-total: {formatCurrency(invoiceSubtotal)}</p>
                <p>TPS (5%): {formatCurrency(invoiceTPS)}</p>
                <p>TVQ (9,975%): {formatCurrency(invoiceTVQ)}</p>
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                TOTAL: {formatCurrency(invoiceTotal)}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Options avancees</h4>
            <Textarea
              label="Notes pour le client"
              value={invoiceForm.notes}
              onChange={(e) => setInvoiceForm({ ...invoiceForm, notes: e.target.value })}
              rows={2}
            />
            <div className="mt-3">
              <Textarea
                label="Notes internes (non visibles)"
                value={invoiceForm.notesInternes}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, notesInternes: e.target.value })}
                rows={2}
              />
            </div>
          </div>

          <div className="flex justify-center pt-2">
            <Button onClick={handleCreateInvoice} isLoading={invoiceFormLoading} className="px-12">
              Créer la facture
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Invoice Modal */}
      <Modal isOpen={showEditInvoice} onClose={() => setShowEditInvoice(false)} title={`Modifier la facture ${editInvoiceNumero}`} size="xl">
        <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-1">
          {editInvoiceFormError && <Alert type="error" onClose={() => setEditInvoiceFormError(null)}>{editInvoiceFormError}</Alert>}

          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Informations essentielles</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="Client (Entreprise)"
                options={[
                  { value: '', label: 'Sélectionner une entreprise' },
                  ...companiesList.map((c) => ({ value: String(c.id), label: c.nom })),
                ]}
                value={editInvoiceForm.clientCompanyId}
                onChange={(e) => setEditInvoiceForm({ ...editInvoiceForm, clientCompanyId: e.target.value })}
              />
              <Input
                label="Date d'emission"
                type="date"
                value={editInvoiceForm.dateFacture}
                onChange={(e) => setEditInvoiceForm({ ...editInvoiceForm, dateFacture: e.target.value })}
              />
              <Select
                label="Projet"
                options={[
                  { value: '', label: 'Aucun projet' },
                  ...projectsList.map((p) => ({ value: String(p.id), label: p.nomProjet || `Projet #${p.id}` })),
                ]}
                value={editInvoiceForm.projectId}
                onChange={(e) => setEditInvoiceForm({ ...editInvoiceForm, projectId: e.target.value })}
              />
              <Select
                label="Conditions"
                options={PAIEMENT_OPTIONS}
                value={editInvoiceForm.conditionsPaiement}
                onChange={(e) => setEditInvoiceForm({ ...editInvoiceForm, conditionsPaiement: e.target.value })}
              />
              <Input
                label="Date d'échéance"
                type="date"
                value={editInvoiceForm.dateEcheance}
                onChange={(e) => setEditInvoiceForm({ ...editInvoiceForm, dateEcheance: e.target.value })}
              />
            </div>
          </div>

          {/* Pipeline visuel du statut — workflow guide */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Statut de la facture</h4>
              <Badge color={INVOICE_STATUT_COLORS[editInvoiceForm.statut] || 'gray'} size="sm">
                {INVOICE_STATUT_LABEL[editInvoiceForm.statut] || editInvoiceForm.statut}
              </Badge>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
              <div className="flex items-center gap-1 overflow-x-auto">
                {INVOICE_PIPELINE_STEPS.map((step, idx) => {
                  const currentIdx = INVOICE_PIPELINE_STEPS.findIndex((s) => s.key === editInvoiceForm.statut);
                  const isActive = step.key === editInvoiceForm.statut;
                  const isPast = currentIdx > idx;
                  const isAnnulee = editInvoiceForm.statut === 'ANNULEE';
                  // PARTIELLEMENT_PAYEE et PAYEE sont des etats derives d'un
                  // paiement reel — pas de saut manuel via pipeline. L'user
                  // doit passer par le bouton "Payer" (DollarSign) dans la
                  // table pour enregistrer un paiement.
                  const isPaymentDerived = step.key === 'PARTIELLEMENT_PAYEE' || step.key === 'PAYEE';
                  const disabled = isPaymentDerived && !isActive && !isPast;
                  return (
                    <div key={step.key} className="flex items-center flex-1 min-w-[110px]">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => !disabled && setEditInvoiceForm({ ...editInvoiceForm, statut: step.key })}
                        title={disabled ? `${step.desc} — accessible uniquement via le bouton Payer ($)` : step.desc}
                        className={`flex-1 px-2 py-2 rounded text-xs font-medium transition-colors ${
                          isActive ? 'bg-seaop-primary-600 text-white shadow-sm'
                          : isPast && !isAnnulee ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 hover:bg-green-200'
                          : disabled ? 'bg-gray-100 text-gray-400 border border-gray-200 dark:bg-gray-800 dark:text-gray-600 dark:border-gray-700 cursor-not-allowed'
                          : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {isPast && !isAnnulee && <CheckCircle size={12} />}
                          {disabled && <Lock size={10} />}
                          {step.label}
                        </div>
                      </button>
                      {idx < INVOICE_PIPELINE_STEPS.length - 1 && (
                        <div className={`h-0.5 w-2 ${isPast && !isAnnulee ? 'bg-green-400' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <div className="text-xs text-gray-500">
                  {INVOICE_PIPELINE_STEPS.find((s) => s.key === editInvoiceForm.statut)?.desc || (editInvoiceForm.statut === 'ANNULEE' ? 'Facture annulée — supprimable si pas d\'écriture comptable liée' : editInvoiceForm.statut === 'EN_RETARD' ? 'Échéance dépassée sans paiement' : '')}
                </div>
                <div className="flex gap-2">
                  {editInvoiceForm.statut !== 'EN_RETARD' && (
                    <button type="button" onClick={() => setEditInvoiceForm({ ...editInvoiceForm, statut: 'EN_RETARD' })} className="text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">Marquer en retard</button>
                  )}
                  {editInvoiceForm.statut !== 'ANNULEE' && (
                    <button type="button" onClick={() => setEditInvoiceForm({ ...editInvoiceForm, statut: 'ANNULEE' })} className="text-xs px-2 py-1 rounded text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700">Annuler la facture</button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Detail de la facture</h4>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 uppercase px-1">
                <div className="col-span-6">Description</div>
                <div className="col-span-2">Qte</div>
                <div className="col-span-2">Prix unit.</div>
                <div className="col-span-1">Montant</div>
                <div className="col-span-1"></div>
              </div>
              {editInvoiceLines.map((line, idx) => (
                <div key={line.id || `new-${idx}`} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-6">
                    <input
                      type="text"
                      placeholder="Description du service/produit"
                      value={line.description}
                      onChange={(e) => updateEditInvoiceLine(idx, 'description', e.target.value)}
                      className="erp-input text-sm"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      value={line.quantite}
                      onChange={(e) => updateEditInvoiceLine(idx, 'quantite', parseAmount(e.target.value))}
                      className="erp-input text-sm text-center"
                      min={0}
                      step={0.01}
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      value={line.prixUnitaire || ''}
                      onChange={(e) => updateEditInvoiceLine(idx, 'prixUnitaire', parseAmount(e.target.value))}
                      className="erp-input text-sm text-right"
                      min={0}
                      step={0.01}
                    />
                  </div>
                  <div className="col-span-1 text-sm text-right text-gray-600 font-medium">
                    {formatCurrency(line.quantite * line.prixUnitaire)}
                  </div>
                  <div className="col-span-1 text-center">
                    {editInvoiceLines.length > 1 && (
                      <button onClick={() => removeEditInvoiceLine(idx)} className="p-1 text-gray-400 hover:text-red-500">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <Button size="sm" variant="ghost" leftIcon={<Plus size={14} />} onClick={addEditInvoiceLine}>
                Ajouter une ligne
              </Button>
            </div>

            <div className="mt-4 flex justify-between items-start">
              <div className="text-sm text-gray-500 space-y-1">
                <p>Sous-total: {formatCurrency(editInvoiceSubtotal)}</p>
                <p>TPS (5%): {formatCurrency(editInvoiceTPS)}</p>
                <p>TVQ (9,975%): {formatCurrency(editInvoiceTVQ)}</p>
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                TOTAL: {formatCurrency(editInvoiceTotal)}
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Options avancees</h4>
            <Textarea
              label="Notes pour le client"
              value={editInvoiceForm.notes}
              onChange={(e) => setEditInvoiceForm({ ...editInvoiceForm, notes: e.target.value })}
              rows={2}
            />
            <div className="mt-3">
              <Textarea
                label="Notes internes (non visibles)"
                value={editInvoiceForm.notesInternes}
                onChange={(e) => setEditInvoiceForm({ ...editInvoiceForm, notesInternes: e.target.value })}
                rows={2}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowEditInvoice(false)}>Annuler</Button>
            <Button onClick={handleUpdateInvoice} isLoading={editInvoiceFormLoading} className="px-12">
              Enregistrer les modifications
            </Button>
          </div>
        </div>
      </Modal>

      {/* Send Confirmation Modal — recap detaille avant action irreversible */}
      <Modal isOpen={!!sendConfirmInvoice} onClose={() => setSendConfirmInvoice(null)} title="Confirmer l'envoi de la facture" size="lg">
        {sendConfirmInvoice && (
          <div className="space-y-4">
            <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg">
              <div className="flex items-start gap-3">
                <Send size={20} className="text-indigo-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-indigo-900 dark:text-indigo-200">
                  <p className="font-medium mb-1">Cette action est définitive</p>
                  <p className="text-indigo-700 dark:text-indigo-300">La facture passera de <strong>BROUILLON</strong> à <strong>ENVOYÉE</strong> et générera automatiquement une écriture comptable VENTES dans le journal.</p>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-gray-500">Numéro</span><span className="font-mono font-medium">{sendConfirmInvoice.numeroFacture || sendConfirmInvoice.numero || '--'}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Client</span><span className="font-medium">{sendConfirmInvoice.clientNom || '--'}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Date</span><span>{formatDate(sendConfirmInvoice.dateFacture)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Échéance</span><span>{formatDate(sendConfirmInvoice.dateEcheance)}</span></div>
            </div>

            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h5 className="text-xs font-semibold text-gray-500 uppercase mb-3">Écriture comptable qui sera générée</h5>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-gray-500"><th className="text-left pb-1">Compte</th><th className="text-right pb-1">Débit</th><th className="text-right pb-1">Crédit</th></tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  <tr><td className="py-1.5">1100 — Comptes clients</td><td className="text-right font-mono">{formatCurrency(sendConfirmInvoice.montantTtc || sendConfirmInvoice.montantTotal || 0)}</td><td></td></tr>
                  <tr><td className="py-1.5">4100 — Revenus</td><td></td><td className="text-right font-mono">{formatCurrency(sendConfirmInvoice.montantHt || 0)}</td></tr>
                  <tr><td className="py-1.5">2200 — TPS à payer (5%)</td><td></td><td className="text-right font-mono">{formatCurrency(sendConfirmInvoice.montantTps || 0)}</td></tr>
                  <tr><td className="py-1.5">2210 — TVQ à payer (9.975%)</td><td></td><td className="text-right font-mono">{formatCurrency(sendConfirmInvoice.montantTvq || 0)}</td></tr>
                </tbody>
                <tfoot><tr className="border-t-2 border-gray-300 dark:border-gray-600 font-semibold"><td className="pt-2">Total TTC</td><td className="text-right font-mono pt-2">{formatCurrency(sendConfirmInvoice.montantTtc || sendConfirmInvoice.montantTotal || 0)}</td><td className="text-right font-mono pt-2">{formatCurrency(sendConfirmInvoice.montantTtc || sendConfirmInvoice.montantTotal || 0)}</td></tr></tfoot>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setSendConfirmInvoice(null)} disabled={sendConfirmLoading}>Annuler</Button>
              <Button leftIcon={<Send size={16} />} onClick={handleSendInvoice} isLoading={sendConfirmLoading}>Confirmer l'envoi</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Payment Modal */}
      <Modal isOpen={showPayment} onClose={() => setShowPayment(false)} title="Enregistrer un paiement" size="lg">
        <div className="space-y-4">
          {paymentError && <Alert type="error" onClose={() => setPaymentError(null)}>{paymentError}</Alert>}
          {paymentInvoice && (
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-500">Facture</span><span className="font-mono">{paymentInvoice.numeroFacture || paymentInvoice.numero}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Client</span><span>{paymentInvoice.clientNom || '--'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Total TTC</span><span className="font-medium">{formatCurrency(paymentInvoice.montantTtc || paymentInvoice.montantTotal || 0)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Déjà payé</span><span className="text-green-600">{formatCurrency(paymentInvoice.montantPaye || 0)}</span></div>
              <div className="flex justify-between border-t pt-1"><span className="text-gray-500 font-medium">Solde du</span><span className="text-red-600 font-bold">{formatCurrency(paymentInvoice.soldeDu || 0)}</span></div>
            </div>
          )}
          <Input
            label="Montant du paiement *"
            type="number"
            min="0"
            step="0.01"
            value={paymentForm.montant}
            onChange={(e) => setPaymentForm({ ...paymentForm, montant: e.target.value })}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Date du paiement"
              type="date"
              value={paymentForm.datePaiement}
              onChange={(e) => setPaymentForm({ ...paymentForm, datePaiement: e.target.value })}
            />
            <Select
              label="Mode de paiement"
              options={[
                { value: 'Virement', label: 'Virement' },
                { value: 'Cheque', label: 'Cheque' },
                { value: 'Carte', label: 'Carte de credit' },
                { value: 'Comptant', label: 'Comptant' },
                { value: 'Autre', label: 'Autre' },
              ]}
              value={paymentForm.modePaiement}
              onChange={(e) => setPaymentForm({ ...paymentForm, modePaiement: e.target.value })}
            />
          </div>
          <Input
            label="Référence (cheque #, confirmation, etc.)"
            value={paymentForm.reference}
            onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowPayment(false)} disabled={paymentLoading}>Annuler</Button>
            <Button onClick={handlePayment} isLoading={paymentLoading} disabled={paymentLoading || !paymentForm.montant || parseAmount(paymentForm.montant) <= 0}>
              Enregistrer le paiement
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create Journal Entry Modal */}
      <Modal isOpen={showCreateJournal} onClose={() => setShowCreateJournal(false)} title="Nouvelle écriture de journal" size="lg">
        <div className="space-y-4">
          {journalFormError && <Alert type="error" onClose={() => setJournalFormError(null)}>{journalFormError}</Alert>}
          <Input label="Description *" value={journalForm.description} onChange={(e) => setJournalForm({ ...journalForm, description: e.target.value })} required />
          <Select
            label="Type"
            options={JOURNAL_TYPE_OPTIONS}
            value={journalForm.type}
            onChange={(e) => setJournalForm({ ...journalForm, type: e.target.value })}
          />

          {/* Lignes debit/credit */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Lignes (debit/credit)</h4>
              <button
                type="button"
                onClick={addJournalLineRow}
                className="text-xs text-seaop-primary-600 hover:underline"
              >
                + Ajouter une ligne
              </button>
            </div>
            <div className="space-y-2">
              {journalLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-3">
                    <Input
                      placeholder="Code compte"
                      value={line.compteCode}
                      onChange={(e) => updateJournalLine(idx, 'compteCode', e.target.value)}
                    />
                  </div>
                  <div className="col-span-4">
                    <Input
                      placeholder="Libelle"
                      value={line.libelle}
                      onChange={(e) => updateJournalLine(idx, 'libelle', e.target.value)}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="number"
                      min="0"
                      placeholder="Debit"
                      value={line.debit}
                      onChange={(e) => updateJournalLine(idx, 'debit', e.target.value)}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="number"
                      min="0"
                      placeholder="Credit"
                      value={line.credit}
                      onChange={(e) => updateJournalLine(idx, 'credit', e.target.value)}
                    />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    {journalLines.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeJournalLineRow(idx)}
                        className="p-1 text-gray-400 hover:text-red-600"
                        title="Supprimer la ligne"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Indicateur d'equilibre debit/credit */}
            <div className="mt-3 flex items-center justify-end">
              {journalIsBalanced ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300">
                  <CheckCircle size={14} /> Equilibre
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
                  <AlertCircle size={14} /> Ecart: {formatCurrency(Math.abs(journalLinesBalance))}
                </span>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreateJournal(false)}>Annuler</Button>
            <Button onClick={handleCreateJournal} isLoading={journalFormLoading} disabled={!journalCanCreate}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Create Period Modal */}
      <Modal isOpen={showCreatePeriod} onClose={() => setShowCreatePeriod(false)} title="Nouvelle période comptable">
        <div className="space-y-4">
          {periodFormError && <Alert type="error" onClose={() => setPeriodFormError(null)}>{periodFormError}</Alert>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Année fiscale *" type="number" value={periodForm.anneeFiscale} onChange={(e) => setPeriodForm({ ...periodForm, anneeFiscale: e.target.value })} placeholder="Ex: 2026" required />
            <Input label="Période *" type="number" value={periodForm.periode} onChange={(e) => setPeriodForm({ ...periodForm, periode: e.target.value })} placeholder="Ex: 1" required />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Date début *" type="date" value={periodForm.dateDebut} onChange={(e) => setPeriodForm({ ...periodForm, dateDebut: e.target.value })} required />
            <Input label="Date fin *" type="date" value={periodForm.dateFin} onChange={(e) => setPeriodForm({ ...periodForm, dateFin: e.target.value })} required />
          </div>
          <Input label="Nom (optionnel)" value={periodForm.nom} onChange={(e) => setPeriodForm({ ...periodForm, nom: e.target.value })} placeholder="Ex: Exercice 2026 - Q1" />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreatePeriod(false)}>Annuler</Button>
            <Button onClick={handleCreatePeriod} isLoading={periodFormLoading} disabled={!periodForm.anneeFiscale || !periodForm.periode || !periodForm.dateDebut || !periodForm.dateFin}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Create Cost Center Modal */}
      <Modal isOpen={showCreateCostCenter} onClose={() => setShowCreateCostCenter(false)} title="Nouveau centre de couts">
        <div className="space-y-4">
          {costCenterFormError && <Alert type="error" onClose={() => setCostCenterFormError(null)}>{costCenterFormError}</Alert>}
          <Input label="Code *" value={costCenterForm.code} onChange={(e) => setCostCenterForm({ ...costCenterForm, code: e.target.value })} required />
          <Input label="Nom *" value={costCenterForm.nom} onChange={(e) => setCostCenterForm({ ...costCenterForm, nom: e.target.value })} required />
          <Select
            label="Type de centre"
            options={[
              { value: '', label: 'Sélectionner un type' },
              { value: 'PROJET', label: 'Projet' },
              { value: 'DEPARTEMENT', label: 'Département' },
              { value: 'ACTIVITE', label: 'Activite' },
              { value: 'AUTRE', label: 'Autre' },
            ]}
            value={costCenterForm.type}
            onChange={(e) => setCostCenterForm({ ...costCenterForm, type: e.target.value })}
          />
          <Input label="Budget annuel" type="number" min="0" value={costCenterForm.budgetAnnuel} onChange={(e) => setCostCenterForm({ ...costCenterForm, budgetAnnuel: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreateCostCenter(false)}>Annuler</Button>
            <Button onClick={handleCreateCostCenter} isLoading={costCenterFormLoading} disabled={!costCenterForm.code.trim() || !costCenterForm.nom.trim()}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Invoice HTML Preview Modal */}
      <Modal
        isOpen={showInvoiceHtmlPreview}
        onClose={() => { setShowInvoiceHtmlPreview(false); setInvoiceHtmlContent(''); }}
        title="Aperçu de la facture"
        size="xl"
      >
        <div className="space-y-4">
          {invoiceHtmlContent ? (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden" style={{ height: '70vh' }}>
              <iframe
                srcDoc={invoiceHtmlContent}
                title="Aperçu facture"
                className="w-full h-full bg-white"
                sandbox="allow-same-origin"
              />
            </div>
          ) : (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                const win = window.open('', '_blank');
                if (win) {
                  win.document.write(invoiceHtmlContent);
                  win.document.close();
                }
              }}
              disabled={!invoiceHtmlContent}
            >
              Ouvrir dans un nouvel onglet
            </Button>
            <Button variant="ghost" onClick={() => { setShowInvoiceHtmlPreview(false); setInvoiceHtmlContent(''); }}>
              Fermer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Send Invoice by Email Modal (PDF en piece jointe) */}
      <Modal
        isOpen={showSendInvoice}
        onClose={() => { setShowSendInvoice(false); setSendInvoiceTarget(null); }}
        title={sendInvoiceTarget ? `Envoyer ${sendInvoiceTarget.numeroFacture || sendInvoiceTarget.numero || `facture #${sendInvoiceTarget.id}`} par courriel` : 'Envoyer par courriel'}
        size="lg"
      >
        <div className="space-y-4">
          {sendInvoiceError && <Alert type="error" onClose={() => setSendInvoiceError(null)}>{sendInvoiceError}</Alert>}

          {sendInvoiceTarget && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 p-3 rounded text-xs text-blue-900 dark:text-blue-200">
              <p><strong>Destinataire:</strong> {sendInvoiceTarget.clientNom || '--'}</p>
              <p><strong>Montant total:</strong> {formatCurrency(sendInvoiceTarget.montantTtc || sendInvoiceTarget.montantTotal || 0)}</p>
              <p><strong>Echeance:</strong> {formatDate(sendInvoiceTarget.dateEcheance) || 'Non specifiee'}</p>
              {sendInvoiceTarget.statut === 'BROUILLON' && (
                <p className="mt-2 text-amber-700 dark:text-amber-300">
                  <strong>Note:</strong> Cette facture est BROUILLON. L'envoi la basculera en ENVOYEE et generera l'ecriture comptable automatiquement.
                </p>
              )}
            </div>
          )}

          <Input
            label="Adresse courriel destinataire *"
            type="email"
            placeholder="client@exemple.com"
            value={sendInvoiceForm.toEmail}
            onChange={(e) => setSendInvoiceForm({ ...sendInvoiceForm, toEmail: e.target.value })}
            required
          />
          <Input
            label="CC (optionnel, separer par virgule)"
            type="text"
            placeholder="copie@exemple.com, autre@exemple.com"
            value={sendInvoiceForm.cc}
            onChange={(e) => setSendInvoiceForm({ ...sendInvoiceForm, cc: e.target.value })}
          />
          <Input
            label="Sujet du courriel (optionnel)"
            value={sendInvoiceForm.subjectOverride}
            onChange={(e) => setSendInvoiceForm({ ...sendInvoiceForm, subjectOverride: e.target.value })}
            placeholder="Sera genere automatiquement si laisse vide"
          />
          <Textarea
            label="Message personnalise (optionnel)"
            value={sendInvoiceForm.messageOverride}
            onChange={(e) => setSendInvoiceForm({ ...sendInvoiceForm, messageOverride: e.target.value })}
            rows={4}
            placeholder="Sera genere depuis le template standard si laisse vide"
          />

          <div className="text-xs text-gray-500 dark:text-gray-400 italic">
            Le PDF de la facture sera attache automatiquement au courriel. Le snapshot emetteur (RBQ, TPS, TVQ) sera fige sur la facture pour preserver la conformite Revenu Quebec.
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => { setShowSendInvoice(false); setSendInvoiceTarget(null); }} disabled={sendInvoiceLoading}>
              Annuler
            </Button>
            <Button
              onClick={handleSendInvoiceEmail}
              isLoading={sendInvoiceLoading}
              disabled={!EMAIL_REGEX.test(sendInvoiceForm.toEmail.trim())}
              leftIcon={<Mail size={16} />}
            >
              Envoyer le courriel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Recurring Invoice Modal — Convertir facture en template recurrent */}
      <Modal
        isOpen={showRecurringModal}
        onClose={() => { setShowRecurringModal(false); setRecurringSourceInvoice(null); }}
        title={recurringSourceInvoice ? `Convertir ${recurringSourceInvoice.numeroFacture || `#${recurringSourceInvoice.id}`} en facture recurrente` : 'Facture recurrente'}
        size="lg"
      >
        <div className="space-y-4">
          {recurringError && <Alert type="error" onClose={() => setRecurringError(null)}>{recurringError}</Alert>}

          {recurringSourceInvoice && (
            <div className="bg-teal-50 dark:bg-teal-900/20 border-l-4 border-teal-400 p-3 rounded text-xs text-teal-900 dark:text-teal-200">
              <p><strong>Facture source:</strong> {recurringSourceInvoice.numeroFacture || `#${recurringSourceInvoice.id}`}</p>
              <p><strong>Client:</strong> {recurringSourceInvoice.clientNom || '--'}</p>
              <p><strong>Montant TTC:</strong> {formatCurrency(recurringSourceInvoice.montantTtc || recurringSourceInvoice.montantTotal || 0)}</p>
              <p className="mt-2">
                Les lignes de la facture seront copiees comme template. Les prochaines factures
                seront generees automatiquement par le cron quotidien selon la frequence choisie.
              </p>
            </div>
          )}

          <Input
            label="Nom du template *"
            value={recurringForm.nom}
            onChange={(e) => setRecurringForm({ ...recurringForm, nom: e.target.value })}
            placeholder="Ex: Maintenance mensuelle Tremblay"
            required
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Frequence *"
              options={[
                { value: 'hebdomadaire', label: 'Hebdomadaire' },
                { value: 'bimensuel', label: 'Bi-mensuel (2 semaines)' },
                { value: 'mensuel', label: 'Mensuel' },
                { value: 'bimestriel', label: 'Bi-mensuel (2 mois)' },
                { value: 'trimestriel', label: 'Trimestriel' },
                { value: 'semestriel', label: 'Semestriel' },
                { value: 'annuel', label: 'Annuel' },
              ]}
              value={recurringForm.frequence}
              onChange={(e) => setRecurringForm({ ...recurringForm, frequence: e.target.value as accountingApi.RecurringFrequence })}
            />
            <Input
              label="Multiplicateur"
              type="number"
              min="1"
              max="12"
              value={String(recurringForm.intervalCount)}
              onChange={(e) => setRecurringForm({ ...recurringForm, intervalCount: parseInt(e.target.value) || 1 })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Date de premiere generation *"
              type="date"
              value={recurringForm.dateDebut}
              onChange={(e) => setRecurringForm({ ...recurringForm, dateDebut: e.target.value })}
              min={new Date().toISOString().split('T')[0]}
            />
            <Input
              label="Date de fin (optionnel)"
              type="date"
              value={recurringForm.dateFin}
              onChange={(e) => setRecurringForm({ ...recurringForm, dateFin: e.target.value })}
              min={recurringForm.dateDebut}
            />
          </div>

          <Input
            label="Nombre maximal d'occurrences (optionnel)"
            type="number"
            min="1"
            value={recurringForm.nbOccurrencesMax}
            onChange={(e) => setRecurringForm({ ...recurringForm, nbOccurrencesMax: e.target.value })}
            placeholder="Vide = illimite"
          />

          <Select
            label="Statut initial des factures generees"
            options={[
              { value: 'BROUILLON', label: 'BROUILLON (revision manuelle)' },
              { value: 'ENVOYEE', label: 'ENVOYEE (automatique, ecriture comptable creee)' },
            ]}
            value={recurringForm.statutFactureGenere}
            onChange={(e) => setRecurringForm({ ...recurringForm, statutFactureGenere: e.target.value as 'BROUILLON' | 'ENVOYEE' })}
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={recurringForm.autoEnvoiEmail}
              onChange={(e) => setRecurringForm({ ...recurringForm, autoEnvoiEmail: e.target.checked })}
              className="rounded"
            />
            <span>Envoyer automatiquement par courriel a la generation</span>
          </label>

          {recurringForm.autoEnvoiEmail && (
            <Input
              label="Adresse courriel destinataire *"
              type="email"
              value={recurringForm.emailDestinataire}
              onChange={(e) => setRecurringForm({ ...recurringForm, emailDestinataire: e.target.value })}
              required
            />
          )}

          <Textarea
            label="Notes (optionnel, visibles sur les factures generees)"
            value={recurringForm.notes}
            onChange={(e) => setRecurringForm({ ...recurringForm, notes: e.target.value })}
            rows={2}
          />

          <div className="text-xs text-gray-500 dark:text-gray-400 italic">
            Le cron quotidien (00h-01h) generera les factures dont la prochaine date est arrivee.
            Vous pouvez aussi forcer une generation immediate apres creation du template.
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => { setShowRecurringModal(false); setRecurringSourceInvoice(null); }} disabled={recurringLoading}>
              Annuler
            </Button>
            <Button
              onClick={handleCreateRecurring}
              isLoading={recurringLoading}
              disabled={recurringForm.nom.trim().length < 3 || !recurringForm.dateDebut}
              leftIcon={<Repeat size={16} />}
            >
              Creer le template
            </Button>
          </div>
        </div>
      </Modal>

      {/* Send Reminder Modal */}
      <Modal
        isOpen={showReminderModal}
        onClose={() => { setShowReminderModal(false); setReminderTarget(null); }}
        title={reminderTarget ? `Rappel de paiement - ${reminderTarget.numeroFacture || `#${reminderTarget.id}`}` : 'Rappel'}
        size="lg"
      >
        <div className="space-y-4">
          {reminderError && <Alert type="error" onClose={() => setReminderError(null)}>{reminderError}</Alert>}

          {reminderTarget && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-400 p-3 rounded text-xs text-amber-900 dark:text-amber-200">
              <p><strong>Client:</strong> {reminderTarget.clientNom || '--'}</p>
              <p><strong>Solde du:</strong> {formatCurrency(reminderTarget.soldeDu || reminderTarget.montantTtc || 0)}</p>
              <p><strong>Echeance:</strong> {formatDate(reminderTarget.dateEcheance) || '--'}</p>
              <p><strong>Rappels deja envoyes:</strong> {reminderTarget.nbRappelsEnvoyes || 0}</p>
            </div>
          )}

          <Select
            label="Niveau de rappel"
            options={[
              { value: '1', label: 'Niveau 1 — Courtois (J+3 apres echeance)' },
              { value: '2', label: 'Niveau 2 — Ferme (J+15)' },
              { value: '3', label: 'Niveau 3 — Insistant (J+30, mention recouvrement)' },
              { value: '4', label: 'Niveau 4 — Mise en demeure formelle (J+60)' },
            ]}
            value={String(reminderForm.niveau)}
            onChange={(e) => setReminderForm({ ...reminderForm, niveau: parseInt(e.target.value) as 1 | 2 | 3 | 4 })}
          />

          <Input
            label="Adresse courriel (vide = celle du client)"
            type="email"
            value={reminderForm.toEmailOverride}
            onChange={(e) => setReminderForm({ ...reminderForm, toEmailOverride: e.target.value })}
            placeholder="comptabilite@client.com"
          />

          <Textarea
            label="Message personnalise (optionnel)"
            value={reminderForm.messageOverride}
            onChange={(e) => setReminderForm({ ...reminderForm, messageOverride: e.target.value })}
            rows={4}
            placeholder="Sera genere automatiquement selon le niveau si laisse vide"
          />

          <div className="flex flex-col md:flex-row justify-between gap-3 pt-2">
            {reminderTarget && (
              <Button
                variant="ghost"
                onClick={() => handleToggleReminders(reminderTarget)}
                leftIcon={reminderTarget.rappelsActifs === false ? <Play size={16} /> : <Pause size={16} />}
              >
                {reminderTarget.rappelsActifs === false
                  ? 'Reactiver rappels auto'
                  : 'Desactiver rappels auto'}
              </Button>
            )}
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => { setShowReminderModal(false); setReminderTarget(null); }} disabled={reminderLoading}>
                Annuler
              </Button>
              <Button
                onClick={handleSendReminder}
                isLoading={reminderLoading}
                leftIcon={<Bell size={16} />}
              >
                Envoyer rappel
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Reminders History Modal */}
      <Modal
        isOpen={showRemindersHistory}
        onClose={() => { setShowRemindersHistory(false); setRemindersHistoryInvoice(null); }}
        title={remindersHistoryInvoice ? `Historique rappels - ${remindersHistoryInvoice.numeroFacture || `#${remindersHistoryInvoice.id}`}` : 'Historique'}
        size="lg"
      >
        <div className="space-y-3">
          {remindersHistoryLoading ? (
            <div className="flex justify-center py-8"><Spinner size="lg" /></div>
          ) : remindersHistoryItems.length === 0 ? (
            <p className="text-center py-8 text-sm text-gray-400">Aucun rappel envoye pour cette facture</p>
          ) : (
            <div className="space-y-2">
              {remindersHistoryItems.map((r) => (
                <div key={r.id} className="border border-gray-200 dark:border-gray-700 rounded p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">
                      Niveau {r.niveau} — {r.auto ? 'Auto (cron)' : 'Manuel'}
                    </span>
                    <Badge
                      color={r.statut === 'ENVOYE' ? 'green' : r.statut === 'ECHEC' ? 'red' : 'gray'}
                      size="sm"
                    >
                      {r.statut}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-500">
                    {formatDate(r.dateEnvoi) || r.dateEnvoi} — vers <strong>{r.destinataire}</strong>
                  </p>
                  {r.sujet && <p className="text-xs text-gray-400 mt-1">Sujet: {r.sujet}</p>}
                  {r.erreur && <p className="text-xs text-red-600 mt-1">Erreur: {r.erreur}</p>}
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end pt-2">
            <Button variant="ghost" onClick={() => { setShowRemindersHistory(false); setRemindersHistoryInvoice(null); }}>
              Fermer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create Credit Note (Avoir) Modal */}
      <Modal
        isOpen={showCreditNote}
        onClose={() => { setShowCreditNote(false); setCreditNoteTarget(null); }}
        title={creditNoteTarget ? `Note de credit pour ${creditNoteTarget.numeroFacture || creditNoteTarget.numero || `facture #${creditNoteTarget.id}`}` : 'Note de credit'}
        size="lg"
      >
        <div className="space-y-4">
          {creditNoteError && <Alert type="error" onClose={() => setCreditNoteError(null)}>{creditNoteError}</Alert>}

          {creditNoteTarget && (
            <div className="bg-orange-50 dark:bg-orange-900/20 border-l-4 border-orange-400 p-3 rounded text-xs text-orange-900 dark:text-orange-200">
              <p><strong>Facture origine:</strong> {creditNoteTarget.numeroFacture || creditNoteTarget.numero || `#${creditNoteTarget.id}`}</p>
              <p><strong>Client:</strong> {creditNoteTarget.clientNom || '--'}</p>
              <p><strong>Montant total facture:</strong> {formatCurrency(creditNoteTarget.montantTtc || creditNoteTarget.montantTotal || 0)}</p>
              <p className="mt-2">
                Conformite Revenu Quebec art. 350 LTVQ: la note de credit referencera explicitement la facture origine. Elle sera creee en BROUILLON — vous devrez l'envoyer pour generer l'ecriture comptable de contre-passation.
              </p>
            </div>
          )}

          <Textarea
            label="Raison de la note de credit *"
            value={creditNoteForm.raison}
            onChange={(e) => setCreditNoteForm({ ...creditNoteForm, raison: e.target.value })}
            rows={3}
            placeholder="Ex: Marchandise retournee, remise commerciale, erreur de facturation, etc."
            required
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Montant total de l'avoir (TTC) *"
              type="number"
              min="0.01"
              step="0.01"
              value={creditNoteForm.montantTotal}
              onChange={(e) => setCreditNoteForm({ ...creditNoteForm, montantTotal: e.target.value })}
              required
            />
            <Input
              label="Date de l'avoir"
              type="date"
              value={creditNoteForm.dateAvoir}
              onChange={(e) => setCreditNoteForm({ ...creditNoteForm, dateAvoir: e.target.value })}
            />
          </div>
          <Textarea
            label="Notes internes (optionnel, non visibles sur le PDF)"
            value={creditNoteForm.notesInternes}
            onChange={(e) => setCreditNoteForm({ ...creditNoteForm, notesInternes: e.target.value })}
            rows={2}
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => { setShowCreditNote(false); setCreditNoteTarget(null); }} disabled={creditNoteLoading}>
              Annuler
            </Button>
            <Button
              onClick={handleCreateCreditNote}
              isLoading={creditNoteLoading}
              disabled={creditNoteForm.raison.trim().length < 3 || parseAmount(creditNoteForm.montantTotal) <= 0}
              leftIcon={<FileMinus2 size={16} />}
            >
              Creer la note de credit
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
