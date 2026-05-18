/**
 * ERP React Frontend - Location (Equipment Rental) Zustand Store
 * Items catalog, rental contracts, contract lines, returns,
 * employee rental, statistics.
 */

import { create } from 'zustand';
import * as locApi from '@/api/location';
import type {
  RentalItem,
  RentalContract,
  RentalContratLigne,
  RentalRetour,
  RentalEmployee,
  RentalEmployeeContract,
  RentalEmployeeStats,
  RentalStats,
} from '@/types';

interface LocationState {
  // Lists
  items: RentalItem[];
  contracts: RentalContract[];
  returns: RentalRetour[];
  employees: RentalEmployee[];
  employeeContracts: RentalEmployeeContract[];

  // Detail
  selectedContract: (RentalContract & { lignes?: RentalContratLigne[] }) | null;

  // Stats
  stats: RentalStats | null;
  employeeStats: RentalEmployeeStats | null;

  // State
  isLoading: boolean;
  error: string | null;

  // Filters
  contractFilters: { statut: string };

  // Item actions
  fetchItems: (params?: Parameters<typeof locApi.listItems>[0]) => Promise<void>;
  createItem: (data: Parameters<typeof locApi.createItem>[0]) => Promise<void>;
  updateItem: (id: number, data: Parameters<typeof locApi.updateItem>[1]) => Promise<void>;
  deleteItem: (id: number) => Promise<void>;

  // Contract actions
  fetchContracts: () => Promise<void>;
  fetchContractDetail: (id: number) => Promise<void>;
  createContract: (data: Parameters<typeof locApi.createContract>[0]) => Promise<void>;
  updateContract: (id: number, data: Parameters<typeof locApi.updateContract>[1]) => Promise<void>;
  deleteContract: (id: number) => Promise<void>;
  clearSelectedContract: () => void;

  // Contract line actions
  addContractLine: (contractId: number, data: Parameters<typeof locApi.addContractLine>[1]) => Promise<void>;
  deleteContractLine: (contractId: number, ligneId: number) => Promise<void>;

  // Returns
  fetchReturns: (contratId?: number) => Promise<void>;
  createReturn: (data: Parameters<typeof locApi.createReturn>[0]) => Promise<void>;

  // Employees
  fetchEmployees: (params?: Parameters<typeof locApi.listRentalEmployees>[0]) => Promise<void>;
  updateEmployeeConfig: (id: number, data: Parameters<typeof locApi.updateEmployeeConfig>[1]) => Promise<void>;

  // Employee contracts
  fetchEmployeeContracts: (params?: Parameters<typeof locApi.listEmployeeContracts>[0]) => Promise<void>;
  createEmployeeContract: (data: Parameters<typeof locApi.createEmployeeContract>[0]) => Promise<void>;
  updateEmployeeContract: (id: number, data: Parameters<typeof locApi.updateEmployeeContract>[1]) => Promise<void>;
  recordEmployeeHours: (contractId: number, data: Parameters<typeof locApi.recordEmployeeHours>[1]) => Promise<void>;

  // Employee stats
  fetchEmployeeStats: () => Promise<void>;

  // Stats
  fetchStats: () => Promise<void>;

  // Utility
  setContractFilter: (key: string, value: unknown) => void;
  clearError: () => void;
}

function extractError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: { detail?: string } } }).response;
    if (resp?.data?.detail) return resp.data.detail;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  items: [],
  contracts: [],
  returns: [],
  employees: [],
  employeeContracts: [],
  selectedContract: null,
  stats: null,
  employeeStats: null,
  isLoading: false,
  error: null,
  contractFilters: { statut: '' },

  // ── Items ──────────────────────────────────────
  fetchItems: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await locApi.listItems(params);
      set({ items: res.items ?? [], isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement equipements') });
    }
  },

  createItem: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await locApi.createItem(data);
      await get().fetchItems();
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur creation equipement') });
      throw err;
    }
  },

  updateItem: async (id, data) => {
    set({ error: null });
    try {
      await locApi.updateItem(id, data);
      await get().fetchItems();
    } catch (err) {
      set({ error: extractError(err, 'Erreur mise à jour équipement') });
      throw err;
    }
  },

  deleteItem: async (id) => {
    set({ error: null });
    try {
      await locApi.deleteItem(id);
      await get().fetchItems();
    } catch (err) {
      set({ error: extractError(err, 'Erreur suppression equipement') });
      throw err;
    }
  },

  // ── Contracts ──────────────────────────────────
  fetchContracts: async () => {
    set({ isLoading: true, error: null });
    try {
      const { contractFilters: f } = get();
      const res = await locApi.listContracts(f.statut ? { statut: f.statut } : undefined);
      set({ contracts: res.items ?? [], isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement contrats') });
    }
  },

  fetchContractDetail: async (id) => {
    set({ isLoading: true, error: null, selectedContract: null });
    try {
      const res = await locApi.getContract(id);
      set({
        selectedContract: { ...res.contrat, lignes: res.lignes ?? [] },
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement detail contrat') });
    }
  },

  createContract: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await locApi.createContract(data);
      await get().fetchContracts();
      await get().fetchStats();
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur creation contrat') });
      throw err;
    }
  },

  updateContract: async (id, data) => {
    set({ error: null });
    try {
      await locApi.updateContract(id, data);
      await get().fetchContracts();
      await get().fetchStats();
    } catch (err) {
      set({ error: extractError(err, 'Erreur mise à jour contrat') });
      throw err;
    }
  },

  deleteContract: async (id) => {
    set({ error: null });
    try {
      await locApi.deleteContract(id);
      await get().fetchContracts();
      await get().fetchStats();
    } catch (err) {
      set({ error: extractError(err, 'Erreur suppression contrat') });
      throw err;
    }
  },

  clearSelectedContract: () => set({ selectedContract: null }),

  // ── Contract Lines ─────────────────────────────
  addContractLine: async (contractId, data) => {
    set({ error: null });
    try {
      await locApi.addContractLine(contractId, data);
      await get().fetchContractDetail(contractId);
      await get().fetchStats();
    } catch (err) {
      set({ error: extractError(err, 'Erreur ajout ligne contrat') });
      throw err;
    }
  },

  deleteContractLine: async (contractId, ligneId) => {
    set({ error: null });
    try {
      await locApi.deleteContractLine(contractId, ligneId);
      await get().fetchContractDetail(contractId);
      await get().fetchStats();
    } catch (err) {
      set({ error: extractError(err, 'Erreur suppression ligne contrat') });
      throw err;
    }
  },

  // ── Returns ────────────────────────────────────
  fetchReturns: async (contratId) => {
    set({ isLoading: true, error: null });
    try {
      const res = await locApi.listReturns(contratId);
      set({ returns: res ?? [], isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement retours') });
    }
  },

  createReturn: async (data) => {
    set({ error: null });
    try {
      await locApi.createReturn(data);
      await get().fetchReturns(data.contratId);
      await get().fetchStats();
      await get().fetchContracts();
    } catch (err) {
      set({ error: extractError(err, 'Erreur creation retour') });
      throw err;
    }
  },

  // ── Employees ──────────────────────────────────
  fetchEmployees: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await locApi.listRentalEmployees(params);
      set({ employees: res ?? [], isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement employes location') });
    }
  },

  updateEmployeeConfig: async (id, data) => {
    set({ error: null });
    try {
      await locApi.updateEmployeeConfig(id, data);
      await get().fetchEmployees();
    } catch (err) {
      set({ error: extractError(err, 'Erreur mise à jour config employé') });
      throw err;
    }
  },

  // ── Employee Contracts ─────────────────────────
  fetchEmployeeContracts: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await locApi.listEmployeeContracts(params);
      set({ employeeContracts: res ?? [], isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement contrats employes') });
    }
  },

  createEmployeeContract: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await locApi.createEmployeeContract(data);
      await get().fetchEmployeeContracts();
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur creation contrat employe') });
      throw err;
    }
  },

  updateEmployeeContract: async (id, data) => {
    set({ error: null });
    try {
      await locApi.updateEmployeeContract(id, data);
      await get().fetchEmployeeContracts();
      await get().fetchEmployees();
      await get().fetchEmployeeStats();
    } catch (err) {
      set({ error: extractError(err, 'Erreur mise à jour contrat employé') });
      throw err;
    }
  },

  recordEmployeeHours: async (contractId, data) => {
    set({ error: null });
    try {
      await locApi.recordEmployeeHours(contractId, data);
      await get().fetchEmployeeContracts();
      await get().fetchEmployeeStats();
    } catch (err) {
      set({ error: extractError(err, 'Erreur enregistrement heures') });
      throw err;
    }
  },

  // ── Employee Stats ─────────────────────────────
  fetchEmployeeStats: async () => {
    set({ error: null });
    try {
      const res = await locApi.getEmployeeStats();
      set({ employeeStats: res });
    } catch (err) {
      set({ error: extractError(err, 'Erreur chargement stats employes') });
    }
  },

  // ── Stats ──────────────────────────────────────
  fetchStats: async () => {
    set({ error: null });
    try {
      const s = await locApi.getStats();
      set({ stats: s });
    } catch (err) {
      set({ error: extractError(err, 'Erreur chargement statistiques') });
    }
  },

  // ── Filters / Utility ─────────────────────────
  setContractFilter: (key, value) => {
    set((s) => ({
      contractFilters: { ...s.contractFilters, [key]: value },
    }));
  },

  clearError: () => set({ error: null }),
}));
