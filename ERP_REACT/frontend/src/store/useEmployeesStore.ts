/**
 * ERP React Frontend - Employees Zustand Store
 */

import { create } from 'zustand';
import * as employeesApi from '@/api/employees';
import type { Employee, TimeEntry, PayrollItem } from '@/api/employees';

interface EmployeesState {
  items: Employee[];
  current: Employee | null;
  timeEntries: TimeEntry[];
  payroll: PayrollItem[];
  payrollSummary: { totalBrut: number; totalEmployes: number } | null;
  isLoading: boolean;
  error: string | null;
  filters: { search: string; departement: string; statut: string; page: number; perPage: number };
  total: number;

  // Actions
  fetchAll: () => Promise<void>;
  fetchOne: (id: number) => Promise<void>;
  create: (data: Partial<Employee>) => Promise<Employee>;
  update: (id: number, data: Partial<Employee>) => Promise<void>;
  setFilter: (key: string, value: unknown) => void;
  clearError: () => void;

  // Time entries
  fetchTimeEntries: (params?: { employeeId?: number; projectId?: string }) => Promise<void>;
  createTimeEntry: (data: {
    employeeId: number; projectId?: string; punchIn?: string;
    punchOut?: string; totalHours?: number; notes?: string;
    formulaireBtId?: number;
  }) => Promise<void>;

  // Payroll
  fetchPayroll: (periodDays?: number) => Promise<void>;
}

export const useEmployeesStore = create<EmployeesState>((set, get) => ({
  items: [],
  current: null,
  timeEntries: [],
  payroll: [],
  payrollSummary: null,
  isLoading: false,
  error: null,
  filters: { search: '', departement: '', statut: '', page: 1, perPage: 25 },
  total: 0,

  fetchAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const { filters } = get();
      const res = await employeesApi.listEmployees(filters);
      set({ items: res.items, total: res.total, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des employés';
      set({ isLoading: false, error: message });
    }
  },

  fetchOne: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const employee = await employeesApi.getEmployee(id);
      set({ current: employee, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement';
      set({ isLoading: false, error: message });
    }
  },

  create: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await employeesApi.createEmployee(data);
      const employee = await employeesApi.getEmployee(res.id);
      set((s) => ({ items: [employee, ...s.items], isLoading: false }));
      return employee;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  update: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      await employeesApi.updateEmployee(id, data);
      const updated = await employeesApi.getEmployee(id);
      set((s) => ({
        items: s.items.map((e) => (e.id === id ? updated : e)),
        current: s.current?.id === id ? updated : s.current,
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  setFilter: (key, value) => {
    set((s) => ({ filters: { ...s.filters, [key]: value, page: key === 'page' ? (value as number) : 1 } }));
  },

  clearError: () => set({ error: null }),

  // ---- Time Entries ----
  fetchTimeEntries: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await employeesApi.listTimeEntries(params);
      set({ timeEntries: res.items, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des entrées de temps';
      set({ isLoading: false, error: message });
    }
  },

  createTimeEntry: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await employeesApi.createTimeEntry(data);
      // Refresh time entries
      const res = await employeesApi.listTimeEntries({ employeeId: data.employeeId });
      set({ timeEntries: res.items, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création de l\'entrée de temps';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  // ---- Payroll ----
  fetchPayroll: async (periodDays) => {
    set({ isLoading: true, error: null });
    try {
      const res = await employeesApi.getPayrollSummary(periodDays);
      set({
        payroll: res.items,
        payrollSummary: { totalBrut: res.totalBrut, totalEmployes: res.totalEmployes },
        isLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement de la paie';
      set({ isLoading: false, error: message });
    }
  },
}));
