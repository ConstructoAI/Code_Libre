/**
 * B2B Client Portal - Portal Store (Zustand)
 * Manages catalogue, panier, commandes, demandes, messages, favoris state.
 */

import { create } from 'zustand';
import * as api from '@/api/b2b-portal';

function extractError(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Erreur inconnue';
}

interface B2bPortalState {
  // Data
  dashboard: api.B2bDashboard | null;
  catalogue: api.B2bProduct[];
  catalogueTotal: number;
  catalogueCategories: string[];
  panier: api.B2bPanier | null;
  commandes: api.B2bCommande[];
  currentCommande: api.B2bCommande | null;
  demandes: api.B2bDemande[];
  currentDemande: api.B2bDemande | null;
  contrats: api.B2bContrat[];
  messages: api.B2bMessage[];
  favoris: api.B2bFavori[];

  // UI
  isLoading: boolean;
  error: string | null;
  successMessage: string | null;

  // Actions
  fetchDashboard: () => Promise<void>;
  fetchCatalogue: (params?: { search?: string; categorie?: string; page?: number }) => Promise<void>;
  fetchPanier: () => Promise<void>;
  addToCart: (produitId: number, quantite?: number) => Promise<void>;
  updateCartItem: (itemId: number, quantite: number) => Promise<void>;
  removeCartItem: (itemId: number) => Promise<void>;
  checkout: (data: Parameters<typeof api.commander>[0]) => Promise<{ numero: string; totalTtc: number } | null>;
  fetchCommandes: () => Promise<void>;
  fetchCommande: (id: number) => Promise<void>;
  fetchDemandes: () => Promise<void>;
  createDemande: (data: Parameters<typeof api.createDemande>[0]) => Promise<void>;
  fetchDemande: (id: number) => Promise<void>;
  fetchContrats: () => Promise<void>;
  fetchMessages: (params?: { demandeId?: number; contratId?: number }) => Promise<void>;
  sendMessage: (data: Parameters<typeof api.sendMessage>[0]) => Promise<void>;
  fetchFavoris: () => Promise<void>;
  toggleFavori: (produitId: number, isFav: boolean) => Promise<void>;
  clearError: () => void;
  clearSuccess: () => void;
}

export const useB2bPortalStore = create<B2bPortalState>((set, get) => ({
  dashboard: null,
  catalogue: [],
  catalogueTotal: 0,
  catalogueCategories: [],
  panier: null,
  commandes: [],
  currentCommande: null,
  demandes: [],
  currentDemande: null,
  contrats: [],
  messages: [],
  favoris: [],
  isLoading: false,
  error: null,
  successMessage: null,

  fetchDashboard: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.fetchDashboard();
      set({ dashboard: data, isLoading: false });
    } catch (err) { set({ isLoading: false, error: extractError(err) }); }
  },

  fetchCatalogue: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.fetchCatalogue(params);
      set({ catalogue: res.items, catalogueTotal: res.total, catalogueCategories: res.categories, isLoading: false });
    } catch (err) { set({ isLoading: false, error: extractError(err) }); }
  },

  fetchPanier: async () => {
    try {
      const data = await api.fetchPanier();
      set({ panier: data });
    } catch (err) { set({ error: extractError(err) }); }
  },

  addToCart: async (produitId, quantite = 1) => {
    try {
      await api.addToPanier(produitId, quantite);
      await get().fetchPanier();
    } catch (err) { set({ error: extractError(err) }); }
  },

  updateCartItem: async (itemId, quantite) => {
    try {
      await api.updatePanierItem(itemId, quantite);
      await get().fetchPanier();
    } catch (err) { set({ error: extractError(err) }); }
  },

  removeCartItem: async (itemId) => {
    try {
      await api.removeFromPanier(itemId);
      await get().fetchPanier();
    } catch (err) { set({ error: extractError(err) }); }
  },

  checkout: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.commander(data);
      set({ panier: null, isLoading: false, successMessage: `Commande ${res.numero} creee` });
      return { numero: res.numero, totalTtc: res.totalTtc };
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      return null;
    }
  },

  fetchCommandes: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.fetchCommandes();
      set({ commandes: res.items, isLoading: false });
    } catch (err) { set({ isLoading: false, error: extractError(err) }); }
  },

  fetchCommande: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.fetchCommande(id);
      set({ currentCommande: data, isLoading: false });
    } catch (err) { set({ isLoading: false, error: extractError(err) }); }
  },

  fetchDemandes: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.fetchDemandes();
      set({ demandes: res.items, isLoading: false });
    } catch (err) { set({ isLoading: false, error: extractError(err) }); }
  },

  createDemande: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await api.createDemande(data);
      set({ isLoading: false, successMessage: 'Demande soumise avec succes' });
      await get().fetchDemandes();
    } catch (err) { set({ isLoading: false, error: extractError(err) }); }
  },

  fetchDemande: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.fetchDemande(id);
      set({ currentDemande: data, isLoading: false });
    } catch (err) { set({ isLoading: false, error: extractError(err) }); }
  },

  fetchContrats: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.fetchContrats();
      set({ contrats: res.items, isLoading: false });
    } catch (err) { set({ isLoading: false, error: extractError(err) }); }
  },

  fetchMessages: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.fetchMessages(params);
      set({ messages: res.items, isLoading: false });
    } catch (err) { set({ isLoading: false, error: extractError(err) }); }
  },

  sendMessage: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await api.sendMessage(data);
      set({ isLoading: false, successMessage: 'Message envoye' });
      await get().fetchMessages(data.demandeId ? { demandeId: data.demandeId } : data.contratId ? { contratId: data.contratId } : undefined);
    } catch (err) { set({ isLoading: false, error: extractError(err) }); }
  },

  fetchFavoris: async () => {
    try {
      const res = await api.fetchFavoris();
      set({ favoris: res.items });
    } catch (err) { set({ error: extractError(err) }); }
  },

  toggleFavori: async (produitId, isFav) => {
    try {
      if (isFav) await api.removeFavori(produitId);
      else await api.addFavori(produitId);
      await get().fetchFavoris();
    } catch (err) { set({ error: extractError(err) }); }
  },

  clearError: () => set({ error: null }),
  clearSuccess: () => set({ successMessage: null }),
}));
