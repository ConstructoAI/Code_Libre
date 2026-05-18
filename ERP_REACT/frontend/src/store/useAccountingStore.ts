/**
 * ERP React Frontend - Accounting Zustand Store
 */

import { create } from 'zustand';
import * as accountingApi from '@/api/accounting';
import type {
  ChartAccount, JournalEntry, Invoice, FinancialSummary,
} from '@/api/accounting';

interface AccountingState {
  // Chart of accounts
  accounts: ChartAccount[];
  // Journal
  journalEntries: JournalEntry[];
  currentEntry: JournalEntry | null;
  // Invoices
  invoices: Invoice[];
  currentInvoice: Invoice | null;
  // Summary
  summary: FinancialSummary | null;

  isLoading: boolean;
  error: string | null;
  filters: { search: string; statut: string; typeEntry: string; page: number; perPage: number };
  totalEntries: number;
  totalInvoices: number;

  // Actions — Chart of Accounts
  fetchAccounts: () => Promise<void>;

  // Actions — Journal
  fetchJournalEntries: () => Promise<void>;
  fetchJournalEntry: (id: number) => Promise<void>;
  createJournalEntry: (data: {
    libelle: string; typeJournal?: string; referenceExterne?: string; projetId?: string; notes?: string;
  }) => Promise<JournalEntry>;
  addJournalLine: (entryId: number, data: {
    compteId: number; compteCode?: string; libelle?: string;
    debit?: number; credit?: number;
  }) => Promise<void>;

  // Actions — Invoices
  fetchInvoices: () => Promise<void>;
  fetchInvoice: (id: number) => Promise<void>;
  createInvoice: (data: {
    clientCompanyId: number; projectId?: number; devisId?: number;
    dateFacture?: string; dateEcheance?: string;
    conditionsPaiement?: string; notes?: string;
  }) => Promise<Invoice>;
  updateInvoice: (id: number, data: {
    clientCompanyId?: number; projectId?: number;
    dateFacture?: string; dateEcheance?: string;
    conditionsPaiement?: string; notes?: string;
    notesInternes?: string; statut?: string;
  }) => Promise<void>;
  recordPayment: (invoiceId: number, body: { montant: number; datePaiement?: string; modePaiement?: string; reference?: string }) => Promise<void>;

  // Actions — Summary
  fetchSummary: () => Promise<void>;

  setFilter: (key: string, value: unknown) => void;
  clearError: () => void;
}

export const useAccountingStore = create<AccountingState>((set, get) => ({
  accounts: [],
  journalEntries: [],
  currentEntry: null,
  invoices: [],
  currentInvoice: null,
  summary: null,
  isLoading: false,
  error: null,
  filters: { search: '', statut: '', typeEntry: '', page: 1, perPage: 25 },
  totalEntries: 0,
  totalInvoices: 0,

  // ---- Chart of Accounts ----
  fetchAccounts: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await accountingApi.getChartOfAccounts();
      set({ accounts: res.items, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement du plan comptable';
      set({ isLoading: false, error: message });
    }
  },

  // ---- Journal Entries ----
  fetchJournalEntries: async () => {
    set({ isLoading: true, error: null });
    try {
      const { filters } = get();
      const res = await accountingApi.listJournalEntries({
        page: filters.page,
        perPage: filters.perPage,
        statut: filters.statut || undefined,
        typeEntry: filters.typeEntry || undefined,
      });
      set({ journalEntries: res.items, totalEntries: res.total, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des écritures';
      set({ isLoading: false, error: message });
    }
  },

  fetchJournalEntry: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const entry = await accountingApi.getJournalEntry(id);
      set({ currentEntry: entry, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement';
      set({ isLoading: false, error: message });
    }
  },

  createJournalEntry: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await accountingApi.createJournalEntry(data);
      const entry = await accountingApi.getJournalEntry(res.id);
      set((s) => ({ journalEntries: [entry, ...s.journalEntries], isLoading: false }));
      return entry;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  addJournalLine: async (entryId, data) => {
    set({ isLoading: true, error: null });
    try {
      await accountingApi.addJournalLine(entryId, data);
      // Refresh the entry to get updated totals
      const updated = await accountingApi.getJournalEntry(entryId);
      set((s) => ({
        currentEntry: s.currentEntry?.id === entryId ? updated : s.currentEntry,
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'ajout de la ligne';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  // ---- Invoices ----
  fetchInvoices: async () => {
    set({ isLoading: true, error: null });
    try {
      const { filters } = get();
      const res = await accountingApi.listInvoices({
        page: filters.page,
        perPage: filters.perPage,
        statut: filters.statut || undefined,
        search: filters.search || undefined,
      });
      set({ invoices: res.items, totalInvoices: res.total, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des factures';
      set({ isLoading: false, error: message });
    }
  },

  fetchInvoice: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const invoice = await accountingApi.getInvoice(id);
      set({ currentInvoice: invoice, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement';
      set({ isLoading: false, error: message });
    }
  },

  createInvoice: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await accountingApi.createInvoice(data);
      const invoice = await accountingApi.getInvoice(res.id);
      set((s) => ({ invoices: [invoice, ...s.invoices], isLoading: false }));
      return invoice;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création de la facture';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  updateInvoice: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      await accountingApi.updateInvoice(id, data);
      await get().fetchInvoices();
      set({ isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la modification de la facture';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  recordPayment: async (invoiceId: number, body: { montant: number; datePaiement?: string; modePaiement?: string; reference?: string }) => {
    set({ isLoading: true, error: null });
    try {
      await accountingApi.recordInvoicePayment(invoiceId, body);
      await get().fetchInvoices();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'enregistrement du paiement';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  // ---- Summary ----
  fetchSummary: async () => {
    set({ isLoading: true, error: null });
    try {
      const summary = await accountingApi.getFinancialSummary();
      set({ summary, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement du sommaire';
      set({ isLoading: false, error: message });
    }
  },

  setFilter: (key, value) => {
    set((s) => ({ filters: { ...s.filters, [key]: value, page: key === 'page' ? (value as number) : 1 } }));
  },

  clearError: () => set({ error: null }),
}));
