/**
 * SEAOP React Frontend - Soumission Zustand Store
 * Manages soumissions state for both client and entrepreneur views.
 */

import { create } from 'zustand';
import type { Soumission, SoumissionCreate } from '@/types';
import * as soumissionsApi from '@/api/soumissions';

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

interface SoumissionState {
  // For a lead (client view)
  soumissionsForLead: Soumission[];
  isLoadingSoumissions: boolean;

  // My soumissions (entrepreneur view)
  mySoumissions: Soumission[];
  isLoadingMySoumissions: boolean;

  error: string | null;

  fetchSoumissionsForLead: (leadId: number) => Promise<void>;
  fetchMySoumissions: () => Promise<void>;
  submitSoumission: (data: SoumissionCreate) => Promise<Soumission>;
  updateStatus: (id: number, statut: string) => Promise<void>;
  awardSoumission: (id: number, leadId: number) => Promise<void>;
  clearError: () => void;
}

// ============ Store ============

export const useSoumissionStore = create<SoumissionState>((set, get) => ({
  soumissionsForLead: [],
  isLoadingSoumissions: false,

  mySoumissions: [],
  isLoadingMySoumissions: false,

  error: null,

  // ------- Fetch soumissions for a specific lead (client view) -------
  fetchSoumissionsForLead: async (leadId: number) => {
    set({ isLoadingSoumissions: true, error: null });
    try {
      const data = await soumissionsApi.getSoumissionsForLead(leadId);
      set({ soumissionsForLead: data, isLoadingSoumissions: false });
    } catch (err) {
      set({ isLoadingSoumissions: false, error: extractError(err) });
    }
  },

  // ------- Fetch entrepreneur's own soumissions -------
  fetchMySoumissions: async () => {
    set({ isLoadingMySoumissions: true, error: null });
    try {
      const data = await soumissionsApi.getMySoumissions();
      set({ mySoumissions: data, isLoadingMySoumissions: false });
    } catch (err) {
      set({ isLoadingMySoumissions: false, error: extractError(err) });
    }
  },

  // ------- Submit a new soumission -------
  submitSoumission: async (data: SoumissionCreate) => {
    set({ error: null });
    try {
      const soumission = await soumissionsApi.createSoumission(data);
      // Add to mySoumissions list
      set((state) => ({
        mySoumissions: [soumission, ...state.mySoumissions],
      }));
      return soumission;
    } catch (err) {
      set({ error: extractError(err) });
      throw err;
    }
  },

  // ------- Update soumission status (accept / reject) -------
  updateStatus: async (id: number, statut: string) => {
    set({ error: null });
    try {
      const updated = await soumissionsApi.updateSoumissionStatus(id, statut);
      // Update in both lists if present
      const updateList = (list: Soumission[]) =>
        list.map((s) => (s.id === id ? { ...s, statut: updated.statut } : s));
      set((state) => ({
        soumissionsForLead: updateList(state.soumissionsForLead),
        mySoumissions: updateList(state.mySoumissions),
      }));
    } catch (err) {
      set({ error: extractError(err) });
      throw err;
    }
  },

  // ------- Formally award a soumission (attribuer) -------
  awardSoumission: async (id: number, leadId: number) => {
    set({ error: null });
    try {
      await soumissionsApi.awardSoumission(id);
      // Refresh all soumissions for the lead so statuses are up to date
      const refreshed = await soumissionsApi.getSoumissionsForLead(leadId);
      set({ soumissionsForLead: refreshed });
    } catch (err) {
      set({ error: extractError(err) });
      throw err;
    }
  },

  // ------- Clear Error -------
  clearError: () => set({ error: null }),
}));

// Reset per-user data on logout (event from useAuthStore).
if (typeof window !== 'undefined') {
  window.addEventListener('seaop:logout', () => {
    useSoumissionStore.setState({
      soumissionsForLead: [],
      mySoumissions: [],
      error: null,
    });
  });
}
