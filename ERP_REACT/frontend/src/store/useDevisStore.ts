/**
 * ERP React Frontend - Devis Zustand Store
 */

import { create } from 'zustand';
import * as devisApi from '@/api/devis';
import type { Devis, DevisLigne } from '@/api/devis';

interface DevisState {
  items: Devis[];
  current: Devis | null;
  isLoading: boolean;
  error: string | null;
  filters: { search: string; statut: string; page: number; perPage: number };
  total: number;
  statistics: any;
  viewMode: 'list' | 'table' | 'cards';

  // Actions
  fetchAll: () => Promise<void>;
  fetchOne: (id: number) => Promise<void>;
  create: (data: {
    nomProjet: string; clientCompanyId?: number; clientContactId?: number;
    projectId?: string; description?: string; datePrevu?: string;
    notes?: string;
  }) => Promise<Devis>;
  update: (id: number, data: Partial<Devis>) => Promise<void>;
  setFilter: (key: string, value: unknown) => void;
  clearError: () => void;
  fetchStatistics: () => Promise<void>;
  setViewMode: (mode: 'list' | 'table' | 'cards') => void;
  convertToProject: (devisId: number) => Promise<any>;
  deleteItem: (id: number) => Promise<void>;

  // Lignes
  addLigne: (devisId: number, data: {
    description: string; quantite?: number; unite?: string;
    prixUnitaire?: number; categorie?: string; notesLigne?: string; sequenceLigne?: number;
  }) => Promise<DevisLigne>;
  removeLigne: (devisId: number, ligneId: number) => Promise<void>;
}

export const useDevisStore = create<DevisState>((set, get) => ({
  items: [],
  current: null,
  isLoading: false,
  error: null,
  filters: { search: '', statut: '', page: 1, perPage: 25 },
  total: 0,
  statistics: null,
  viewMode: 'list',

  fetchAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const { filters } = get();
      const res = await devisApi.listDevis(filters);
      set({ items: res.items, total: res.total, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des devis';
      set({ isLoading: false, error: message });
    }
  },

  fetchOne: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const devis = await devisApi.getDevis(id);
      set({ current: devis, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement';
      set({ isLoading: false, error: message });
    }
  },

  create: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await devisApi.createDevis(data);
      const devis = await devisApi.getDevis(res.id);
      set((s) => ({ items: [devis, ...s.items], isLoading: false }));
      return devis;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  update: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      await devisApi.updateDevis(id, data);
      const updated = await devisApi.getDevis(id);
      set((s) => ({
        items: s.items.map((d) => (d.id === id ? updated : d)),
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

  fetchStatistics: async () => {
    try {
      const stats = await devisApi.getDevisStatistics();
      set({ statistics: stats });
    } catch { /* ignore */ }
  },
  setViewMode: (mode: 'list' | 'table' | 'cards') => set({ viewMode: mode }),
  convertToProject: async (devisId: number) => {
    const result = await devisApi.convertDevisToProject(devisId);
    return result;
  },

  // ---- Lignes ----
  addLigne: async (devisId, data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await devisApi.addDevisLigne(devisId, data);
      const ligne: DevisLigne = {
        id: res.id,
        description: data.description,
        quantite: data.quantite ?? 1,
        unite: data.unite ?? 'unité',
        prixUnitaire: data.prixUnitaire ?? 0,
        montantLigne: res.montantLigne,
        sequenceLigne: data.sequenceLigne ?? 0,
        categorie: data.categorie,
        notesLigne: data.notesLigne,
      };
      // Refresh the devis to get updated totals
      const updated = await devisApi.getDevis(devisId);
      set((s) => ({
        current: s.current?.id === devisId ? updated : s.current,
        isLoading: false,
      }));
      return ligne;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'ajout de la ligne';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  deleteItem: async (id) => {
    try {
      await devisApi.deleteDevis(id);
      set((s) => ({
        items: s.items.filter((d) => d.id !== id),
        current: s.current?.id === id ? null : s.current,
        total: s.total - 1,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Erreur lors de la suppression' });
      throw err;
    }
  },
  removeLigne: async (devisId, ligneId) => {
    set({ isLoading: true, error: null });
    try {
      await devisApi.deleteDevisLigne(devisId, ligneId);
      // Refresh the devis to get updated totals
      const updated = await devisApi.getDevis(devisId);
      set((s) => ({
        current: s.current?.id === devisId ? updated : s.current,
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la suppression de la ligne';
      set({ isLoading: false, error: message });
      throw err;
    }
  },
}));
