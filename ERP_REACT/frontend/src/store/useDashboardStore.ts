/**
 * ERP React Frontend - Dashboard Zustand Store
 */

import { create } from 'zustand';
import type { DashboardStats, DashboardAlert } from '@/types';
import * as dashboardApi from '@/api/dashboard';

interface DashboardState {
  stats: DashboardStats | null;
  alerts: DashboardAlert[];
  isLoading: boolean;
  error: string | null;
  fetchDashboard: () => Promise<void>;
  clearError: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  stats: null,
  alerts: [],
  isLoading: false,
  error: null,

  fetchDashboard: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await dashboardApi.getDashboard();
      set({
        stats: res.stats,
        alerts: res.alerts,
        isLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement';
      set({ isLoading: false, error: message });
    }
  },

  clearError: () => set({ error: null }),
}));
