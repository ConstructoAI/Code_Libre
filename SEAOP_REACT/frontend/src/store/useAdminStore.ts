/**
 * SEAOP React Frontend - Admin Zustand Store
 * Manages admin dashboard state: stats, entrepreneurs, soumissions.
 */

import { create } from 'zustand';
import * as adminApi from '@/api/admin';

// ============ Helpers ============

function extractError(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    'response' in err &&
    typeof (err as Record<string, unknown>).response === 'object'
  ) {
    const resp = (err as { response: { data?: { detail?: string } } }).response;
    if (resp.data?.detail) return resp.data.detail;
  }
  if (err instanceof Error) return err.message;
  return 'Une erreur est survenue';
}

// ============ State Interface ============

interface AdminState {
  stats: Record<string, unknown> | null;
  entrepreneurs: Record<string, unknown>[];
  soumissions: Record<string, unknown>[];
  isLoading: boolean;
  error: string | null;

  fetchStats: () => Promise<void>;
  fetchEntrepreneurs: (statut?: string) => Promise<void>;
  fetchSoumissions: () => Promise<void>;
  updateEntrepreneur: (id: number, updates: Record<string, unknown>) => Promise<void>;
  verifyRbq: (id: number) => Promise<void>;
  clearError: () => void;
}

// ============ Store ============

export const useAdminStore = create<AdminState>((set) => ({
  stats: null,
  entrepreneurs: [],
  soumissions: [],
  isLoading: false,
  error: null,

  fetchStats: async () => {
    set({ isLoading: true, error: null });
    try {
      const stats = await adminApi.getStats();
      set({ stats, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  fetchEntrepreneurs: async (statut?: string) => {
    set({ isLoading: true, error: null });
    try {
      const entrepreneurs = await adminApi.getEntrepreneurs(statut);
      set({ entrepreneurs, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  fetchSoumissions: async () => {
    set({ isLoading: true, error: null });
    try {
      const soumissions = await adminApi.getSoumissions();
      set({ soumissions, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  updateEntrepreneur: async (id: number, updates: Record<string, unknown>) => {
    set({ isLoading: true, error: null });
    try {
      await adminApi.updateEntrepreneur(id, updates);
      // Re-fetch entrepreneurs after update
      const entrepreneurs = await adminApi.getEntrepreneurs();
      set({ entrepreneurs, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  verifyRbq: async (id: number) => {
    set({ isLoading: true, error: null });
    try {
      await adminApi.verifyEntrepreneurRbq(id);
      // Re-fetch entrepreneurs after verification
      const entrepreneurs = await adminApi.getEntrepreneurs();
      set({ entrepreneurs, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  clearError: () => set({ error: null }),
}));
