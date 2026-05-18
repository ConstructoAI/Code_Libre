/**
 * SEAOP React Frontend - Lead Zustand Store
 * Manages leads (appels d'offres) list, detail, filters, and client "my projects".
 */

import { create } from 'zustand';
import type { Lead, LeadCreate } from '@/types';
import * as leadsApi from '@/api/leads';

// ============ Helpers ============

/** Extract an error message from an unknown caught value */
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

interface LeadFilters {
  typeProjet: string;
  recherche: string;
  trierPar: string;
  region: string;
}

interface LeadState {
  // List view
  leads: Lead[];
  total: number;
  page: number;
  perPage: number;
  isLoading: boolean;
  error: string | null;

  // Filters
  filters: LeadFilters;

  // Detail
  currentLead: Lead | null;
  isLoadingDetail: boolean;

  // My projects (client)
  myLeads: Lead[];
  isLoadingMyLeads: boolean;

  // Actions
  fetchLeads: (page?: number) => Promise<void>;
  fetchMyLeads: () => Promise<void>;
  fetchLead: (id: number) => Promise<void>;
  createLead: (data: LeadCreate) => Promise<Lead>;
  setFilter: (key: keyof LeadFilters, value: string) => void;
  clearFilters: () => void;
  clearError: () => void;
}

// ============ Default Filters ============

const DEFAULT_FILTERS: LeadFilters = {
  typeProjet: '',
  recherche: '',
  trierPar: '',
  region: '',
};

// ============ Store ============

export const useLeadStore = create<LeadState>((set, get) => ({
  // Initial state
  leads: [],
  total: 0,
  page: 1,
  perPage: 20,
  isLoading: false,
  error: null,

  filters: { ...DEFAULT_FILTERS },

  currentLead: null,
  isLoadingDetail: false,

  myLeads: [],
  isLoadingMyLeads: false,

  // ------- Fetch Paginated Leads (entrepreneurs / admin) -------
  fetchLeads: async (page?: number) => {
    const state = get();
    const targetPage = page ?? state.page;

    set({ isLoading: true, error: null });
    try {
      const params: leadsApi.LeadListParams = {
        page: targetPage,
        perPage: state.perPage,
      };
      // Only include non-empty filter values
      if (state.filters.typeProjet) params.typeProjet = state.filters.typeProjet;
      if (state.filters.recherche) params.recherche = state.filters.recherche;
      if (state.filters.trierPar) params.trierPar = state.filters.trierPar;
      // '__mine__' is a special client-side sentinel for "entrepreneur zones" filter;
      // we skip it at the API level and the page component will filter after fetch.
      if (state.filters.region && state.filters.region !== '__mine__') {
        params.region = state.filters.region;
      }

      const res = await leadsApi.listLeads(params);
      set({
        leads: res.items,
        total: res.total,
        page: res.page,
        perPage: res.perPage,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  // ------- Fetch Client's Own Leads -------
  fetchMyLeads: async () => {
    set({ isLoadingMyLeads: true, error: null });
    try {
      const leads = await leadsApi.getMyLeads();
      set({ myLeads: leads, isLoadingMyLeads: false });
    } catch (err) {
      set({ isLoadingMyLeads: false, error: extractError(err) });
    }
  },

  // ------- Fetch Single Lead Detail -------
  fetchLead: async (id) => {
    set({ isLoadingDetail: true, error: null, currentLead: null });
    try {
      const lead = await leadsApi.getLead(id);
      set({ currentLead: lead, isLoadingDetail: false });
    } catch (err) {
      set({ isLoadingDetail: false, error: extractError(err) });
    }
  },

  // ------- Create New Lead -------
  createLead: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const lead = await leadsApi.createLead(data);
      set({ isLoading: false });
      return lead;
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  // ------- Set a Single Filter + Auto-Refetch -------
  setFilter: (key, value) => {
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    }));
    // Reset to page 1 and refetch with updated filters
    get().fetchLeads(1);
  },

  // ------- Clear All Filters + Refetch -------
  clearFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
    get().fetchLeads(1);
  },

  // ------- Clear Error -------
  clearError: () => set({ error: null }),
}));

// Reset per-user data when the user logs out (event dispatched by useAuthStore).
if (typeof window !== 'undefined') {
  window.addEventListener('seaop:logout', () => {
    useLeadStore.setState({
      leads: [],
      total: 0,
      page: 1,
      currentLead: null,
      myLeads: [],
      error: null,
      filters: { ...DEFAULT_FILTERS },
    });
  });
}
