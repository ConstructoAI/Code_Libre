/**
 * ERP React Frontend - Admin Zustand Store
 */

import { create } from 'zustand';
import * as adminApi from '@/api/admin';
import type { EntrepriseAdmin } from '@/api/admin';

interface AdminStats {
  totalEntreprises: number;
  activeEntreprises: number;
  inactiveEntreprises: number;
}

interface AdminState {
  entreprises: EntrepriseAdmin[];
  stats: AdminStats | null;
  isLoading: boolean;
  error: string | null;
  total: number;

  // Actions
  fetchEntreprises: () => Promise<void>;
  toggleEntreprise: (id: number, active: boolean) => Promise<void>;
  fetchStats: () => Promise<void>;
  clearError: () => void;
}

export const useAdminStore = create<AdminState>((set) => ({
  entreprises: [],
  stats: null,
  isLoading: false,
  error: null,
  total: 0,

  fetchEntreprises: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await adminApi.listEntreprises();
      set({ entreprises: res.items, total: res.total, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des entreprises';
      set({ isLoading: false, error: message });
    }
  },

  toggleEntreprise: async (id, active) => {
    set({ isLoading: true, error: null });
    try {
      await adminApi.toggleEntreprise(id, active);
      set((s) => ({
        entreprises: s.entreprises.map((e) =>
          e.id === id ? { ...e, active } : e,
        ),
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la modification';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  fetchStats: async () => {
    set({ isLoading: true, error: null });
    try {
      const stats = await adminApi.getAdminStats();
      set({ stats, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des statistiques';
      set({ isLoading: false, error: message });
    }
  },

  clearError: () => set({ error: null }),
}));
