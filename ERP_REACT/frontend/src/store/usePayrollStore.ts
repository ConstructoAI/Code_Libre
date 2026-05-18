/**
 * ERP React Frontend - Payroll Zustand Store (Paie CCQ)
 */

import { create } from 'zustand';
import * as payrollApi from '@/api/payroll';
import type {
  PayrollPeriod,
  PayrollEntry,
  PayrollEntryDetail,
  PayrollCalculation,
  PayrollGenerateResult,
} from '@/api/payroll';

interface PayrollState {
  // Data
  periods: PayrollPeriod[];
  selectedPeriodId: number | null;
  entries: PayrollEntry[];
  currentEntry: PayrollEntryDetail | null;
  currentCalculation: PayrollCalculation | null;
  generateResult: PayrollGenerateResult | null;

  // UI
  isLoading: boolean;
  error: string | null;
  totalPeriods: number;
  totalEntries: number;

  // Actions — Periods
  fetchPeriods: () => Promise<void>;
  createPeriod: (body: { dateDebut: string; dateFin: string; typePeriode: string }) => Promise<number>;
  closePeriod: (periodId: number) => Promise<void>;
  selectPeriod: (id: number | null) => void;

  // Actions — Calculation
  calculatePayroll: (employeeId: number, periodId: number) => Promise<PayrollCalculation>;

  // Actions — Generation
  generatePayroll: (periodId: number) => Promise<PayrollGenerateResult>;

  // Actions — Entries
  fetchEntries: (periodId?: number) => Promise<void>;
  fetchEntry: (entryId: number) => Promise<void>;

  // UI
  clearError: () => void;
  clearCalculation: () => void;
}

export const usePayrollStore = create<PayrollState>((set, get) => ({
  periods: [],
  selectedPeriodId: null,
  entries: [],
  currentEntry: null,
  currentCalculation: null,
  generateResult: null,
  isLoading: false,
  error: null,
  totalPeriods: 0,
  totalEntries: 0,

  // ---- Periods ----

  fetchPeriods: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await payrollApi.listPeriods({ perPage: 50 });
      set({ periods: res.items, totalPeriods: res.total, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur chargement periodes';
      set({ isLoading: false, error: message });
    }
  },

  createPeriod: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const res = await payrollApi.createPeriod(body);
      // Refresh periods list
      const periods = await payrollApi.listPeriods({ perPage: 50 });
      set({
        periods: periods.items,
        totalPeriods: periods.total,
        selectedPeriodId: res.id,
        isLoading: false,
      });
      return res.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur creation periode';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  closePeriod: async (periodId) => {
    set({ isLoading: true, error: null });
    try {
      await payrollApi.closePeriod(periodId);
      const periods = await payrollApi.listPeriods({ perPage: 50 });
      set({ periods: periods.items, totalPeriods: periods.total, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur fermeture periode';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  selectPeriod: (id) => {
    set({ selectedPeriodId: id, entries: [], generateResult: null });
  },

  // ---- Calculation ----

  calculatePayroll: async (employeeId, periodId) => {
    set({ isLoading: true, error: null });
    try {
      const calc = await payrollApi.calculatePayroll(employeeId, { periodId });
      set({ currentCalculation: calc, isLoading: false });
      return calc;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur calcul paie';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  // ---- Generation ----

  generatePayroll: async (periodId) => {
    set({ isLoading: true, error: null });
    try {
      const result = await payrollApi.generatePayroll(periodId);
      // Also refresh entries
      const entries = await payrollApi.listEntries({ periodId, perPage: 200 });
      set({
        generateResult: result,
        entries: entries.items,
        totalEntries: entries.total,
        isLoading: false,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur generation paie';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  // ---- Entries ----

  fetchEntries: async (periodId) => {
    set({ isLoading: true, error: null });
    try {
      const res = await payrollApi.listEntries({
        periodId: periodId || get().selectedPeriodId || undefined,
        perPage: 200,
      });
      set({ entries: res.items, totalEntries: res.total, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur chargement fiches de paie';
      set({ isLoading: false, error: message });
    }
  },

  fetchEntry: async (entryId) => {
    set({ isLoading: true, error: null });
    try {
      const entry = await payrollApi.getEntry(entryId);
      set({ currentEntry: entry, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur chargement fiche de paie';
      set({ isLoading: false, error: message });
    }
  },

  // ---- UI ----

  clearError: () => set({ error: null }),
  clearCalculation: () => set({ currentCalculation: null, currentEntry: null }),
}));
