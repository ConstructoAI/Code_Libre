/**
 * ERP React Frontend - CRM / Ventes Zustand Store
 */

import { create } from 'zustand';
import * as crmApi from '@/api/crm';
import type {
  Opportunity,
  OpportunityCreate,
  Interaction,
  InteractionCreate,
  PipelineStage,
  CrmStats,
} from '@/api/crm';

interface CrmState {
  // Opportunities
  opportunities: Opportunity[];
  currentOpportunity: Opportunity | null;
  opportunitiesTotal: number;
  opportunityFilters: { search: string; statut: string; companyId: number | null; page: number; perPage: number };

  // Interactions
  interactions: Interaction[];
  interactionsTotal: number;
  interactionFilters: { companyId: number | null; opportunityId: number | null; typeInteraction: string; page: number; perPage: number };

  // Pipeline & Stats
  pipeline: PipelineStage[];
  stats: CrmStats | null;

  // UI state
  isLoading: boolean;
  error: string | null;

  // Opportunity actions
  fetchOpportunities: () => Promise<void>;
  fetchOpportunity: (id: number) => Promise<void>;
  createOpportunity: (data: OpportunityCreate) => Promise<Opportunity>;
  updateOpportunity: (id: number, data: Partial<OpportunityCreate>) => Promise<void>;
  removeOpportunity: (id: number) => Promise<void>;
  setOpportunityFilter: (key: string, value: unknown) => void;

  // Interaction actions
  fetchInteractions: () => Promise<void>;
  createInteraction: (data: InteractionCreate) => Promise<void>;
  setInteractionFilter: (key: string, value: unknown) => void;

  // Pipeline & Stats actions
  fetchPipeline: () => Promise<void>;
  fetchStats: () => Promise<void>;

  clearError: () => void;
}

export const useCrmStore = create<CrmState>((set, get) => ({
  opportunities: [],
  currentOpportunity: null,
  opportunitiesTotal: 0,
  opportunityFilters: { search: '', statut: '', companyId: null, page: 1, perPage: 25 },

  interactions: [],
  interactionsTotal: 0,
  interactionFilters: { companyId: null, opportunityId: null, typeInteraction: '', page: 1, perPage: 25 },

  pipeline: [],
  stats: null,

  isLoading: false,
  error: null,

  // ---- Opportunities ----
  fetchOpportunities: async () => {
    set({ isLoading: true, error: null });
    try {
      const { opportunityFilters: f } = get();
      const res = await crmApi.listOpportunities({
        page: f.page,
        perPage: f.perPage,
        search: f.search || undefined,
        statut: f.statut || undefined,
        companyId: f.companyId ?? undefined,
      });
      set({ opportunities: res.items, opportunitiesTotal: res.total, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des opportunités';
      set({ isLoading: false, error: message });
    }
  },

  fetchOpportunity: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const opp = await crmApi.getOpportunity(id);
      set({ currentOpportunity: opp, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement';
      set({ isLoading: false, error: message });
    }
  },

  createOpportunity: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await crmApi.createOpportunity(data);
      const opp = await crmApi.getOpportunity(res.id);
      set((s) => ({ opportunities: [opp, ...s.opportunities], isLoading: false }));
      return opp;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  updateOpportunity: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      await crmApi.updateOpportunity(id, data);
      const updated = await crmApi.getOpportunity(id);
      set((s) => ({
        opportunities: s.opportunities.map((o) => (o.id === id ? updated : o)),
        currentOpportunity: s.currentOpportunity?.id === id ? updated : s.currentOpportunity,
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  removeOpportunity: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await crmApi.deleteOpportunity(id);
      set((s) => ({
        opportunities: s.opportunities.filter((o) => o.id !== id),
        currentOpportunity: s.currentOpportunity?.id === id ? null : s.currentOpportunity,
        opportunitiesTotal: s.opportunitiesTotal - 1,
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la suppression';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  setOpportunityFilter: (key, value) => {
    set((s) => ({
      opportunityFilters: {
        ...s.opportunityFilters,
        [key]: value,
        page: key === 'page' ? (value as number) : 1,
      },
    }));
  },

  // ---- Interactions ----
  fetchInteractions: async () => {
    set({ isLoading: true, error: null });
    try {
      const { interactionFilters: f } = get();
      const res = await crmApi.listInteractions({
        page: f.page,
        perPage: f.perPage,
        companyId: f.companyId ?? undefined,
        opportunityId: f.opportunityId ?? undefined,
        typeInteraction: f.typeInteraction || undefined,
      });
      set({ interactions: res.items, interactionsTotal: res.total, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des interactions';
      set({ isLoading: false, error: message });
    }
  },

  createInteraction: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await crmApi.createInteraction(data);
      // Refresh interactions list
      await get().fetchInteractions();
      set({ isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  setInteractionFilter: (key, value) => {
    set((s) => ({
      interactionFilters: {
        ...s.interactionFilters,
        [key]: value,
        page: key === 'page' ? (value as number) : 1,
      },
    }));
  },

  // ---- Pipeline & Stats ----
  fetchPipeline: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await crmApi.getPipeline();
      set({ pipeline: res.stages, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement du pipeline';
      set({ isLoading: false, error: message });
    }
  },

  fetchStats: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await crmApi.getStats();
      set({ stats: res, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des statistiques';
      set({ isLoading: false, error: message });
    }
  },

  clearError: () => set({ error: null }),
}));
