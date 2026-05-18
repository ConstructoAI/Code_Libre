/**
 * ERP React Frontend - B2B / C2B Portal Zustand Store
 * Complete state management for B2B module.
 */

import { create } from 'zustand';
import * as b2bApi from '@/api/b2b';
import type {
  B2bClient, B2bClientCreate, B2bClientUpdate,
  B2bDemande, B2bDemandeCreate, B2bDemandeUpdate,
  B2bSoumission, B2bSoumissionCreate, B2bSoumissionUpdate,
  B2bContrat, B2bContratUpdate,
  B2bCommande,
  B2bProduit, B2bPanier,
  B2bMessage, B2bMessageCreate,
  B2bNotification,
  B2bStats,
} from '@/api/b2b';

function extractError(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: { detail?: string } } }).response;
    if (resp?.data?.detail) return resp.data.detail;
  }
  if (err instanceof Error) return err.message;
  return 'Erreur inattendue';
}

interface B2bState {
  // Data
  stats: B2bStats | null;
  clients: B2bClient[];
  clientsTotal: number;
  demandes: B2bDemande[];
  demandesTotal: number;
  currentDemande: B2bDemande | null;
  soumissions: B2bSoumission[];
  soumissionsTotal: number;
  contrats: B2bContrat[];
  contratsTotal: number;
  currentContrat: B2bContrat | null;
  commandes: B2bCommande[];
  commandesTotal: number;
  currentCommande: B2bCommande | null;
  catalogue: B2bProduit[];
  catalogueTotal: number;
  catalogueCategories: string[];
  panier: B2bPanier | null;
  messages: B2bMessage[];
  messagesTotal: number;
  notifications: B2bNotification[];

  // UI
  isLoading: boolean;
  error: string | null;

  // Stats
  fetchStats: () => Promise<void>;

  // Clients
  fetchClients: (params?: { page?: number; search?: string; active?: boolean }) => Promise<void>;
  createClient: (data: B2bClientCreate) => Promise<void>;
  updateClient: (id: number, data: B2bClientUpdate) => Promise<void>;
  deactivateClient: (id: number) => Promise<void>;

  // Demandes
  fetchDemandes: (params?: { clientId?: number; statut?: string; priorite?: string; search?: string }) => Promise<void>;
  fetchDemande: (id: number) => Promise<void>;
  createDemande: (data: B2bDemandeCreate) => Promise<void>;
  updateDemande: (id: number, data: B2bDemandeUpdate) => Promise<void>;

  // Soumissions
  fetchSoumissions: (params?: { demandeId?: number; statut?: string }) => Promise<void>;
  createSoumission: (data: B2bSoumissionCreate) => Promise<void>;
  updateSoumission: (id: number, data: B2bSoumissionUpdate) => Promise<void>;
  acceptSoumission: (id: number) => Promise<void>;
  refuseSoumission: (id: number) => Promise<void>;

  // Contrats
  fetchContrats: (params?: { statut?: string }) => Promise<void>;
  fetchContrat: (id: number) => Promise<void>;
  updateContrat: (id: number, data: B2bContratUpdate) => Promise<void>;

  // Commandes
  fetchCommandes: (params?: { statut?: string }) => Promise<void>;
  fetchCommande: (id: number) => Promise<void>;
  updateCommandeStatut: (id: number, statut: string) => Promise<void>;

  // Catalogue
  fetchCatalogue: (params?: { categorie?: string; search?: string; page?: number }) => Promise<void>;

  // Panier
  fetchPanier: () => Promise<void>;
  addToPanier: (produitId: number, quantite?: number) => Promise<void>;
  removeFromPanier: (itemId: number) => Promise<void>;
  commanderPanier: (data: { adresseLivraison?: string; villeLivraison?: string; notesClient?: string }) => Promise<{ numero: string }>;

  // Messages
  fetchMessages: (params: { demandeId?: number; contratId?: number }) => Promise<void>;
  sendMessage: (data: B2bMessageCreate) => Promise<void>;

  // Notifications
  fetchNotifications: (nonLues?: boolean) => Promise<void>;
  markNotificationRead: (id: number) => Promise<void>;

  // UI
  clearError: () => void;
  clearCurrentDemande: () => void;
  clearCurrentContrat: () => void;
}

export const useB2bStore = create<B2bState>((set, get) => ({
  stats: null,
  clients: [],
  clientsTotal: 0,
  demandes: [],
  demandesTotal: 0,
  currentDemande: null,
  soumissions: [],
  soumissionsTotal: 0,
  contrats: [],
  contratsTotal: 0,
  currentContrat: null,
  commandes: [],
  commandesTotal: 0,
  currentCommande: null,
  catalogue: [],
  catalogueTotal: 0,
  catalogueCategories: [],
  panier: null,
  messages: [],
  messagesTotal: 0,
  notifications: [],
  isLoading: false,
  error: null,

  // ---- Stats ----
  fetchStats: async () => {
    set({ isLoading: true, error: null });
    try {
      const stats = await b2bApi.getStats();
      set({ stats, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  // ---- Clients ----
  fetchClients: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await b2bApi.listClients(params);
      set({ clients: res.items, clientsTotal: res.total, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  createClient: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await b2bApi.createClient(data);
      await get().fetchClients();
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  updateClient: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      await b2bApi.updateClient(id, data);
      await get().fetchClients();
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  deactivateClient: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await b2bApi.deactivateClient(id);
      await get().fetchClients();
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  // ---- Demandes ----
  fetchDemandes: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await b2bApi.listDemandes(params);
      set({ demandes: res.items, demandesTotal: res.total, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  fetchDemande: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const demande = await b2bApi.getDemande(id);
      set({ currentDemande: demande, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  createDemande: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await b2bApi.createDemande(data);
      await get().fetchDemandes();
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  updateDemande: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      await b2bApi.updateDemande(id, data);
      await get().fetchDemandes();
      if (get().currentDemande?.id === id) {
        await get().fetchDemande(id);
      }
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  // ---- Soumissions ----
  fetchSoumissions: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await b2bApi.listSoumissions(params);
      set({ soumissions: res.items, soumissionsTotal: res.total, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  createSoumission: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await b2bApi.createSoumission(data);
      await get().fetchSoumissions();
      if (get().currentDemande?.id === data.demandeId) {
        await get().fetchDemande(data.demandeId);
      }
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  updateSoumission: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      await b2bApi.updateSoumission(id, data);
      await get().fetchSoumissions();
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  acceptSoumission: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await b2bApi.acceptSoumission(id);
      await get().fetchSoumissions();
      await get().fetchContrats();
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  refuseSoumission: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await b2bApi.refuseSoumission(id);
      await get().fetchSoumissions();
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  // ---- Contrats ----
  fetchContrats: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await b2bApi.listContrats(params);
      set({ contrats: res.items, contratsTotal: res.total, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  fetchContrat: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const contrat = await b2bApi.getContrat(id);
      set({ currentContrat: contrat, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  updateContrat: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      await b2bApi.updateContrat(id, data);
      await get().fetchContrats();
      if (get().currentContrat?.id === id) {
        await get().fetchContrat(id);
      }
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  // ---- Commandes ----
  fetchCommandes: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await b2bApi.listCommandes(params);
      set({ commandes: res.items, commandesTotal: res.total, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  fetchCommande: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const commande = await b2bApi.getCommande(id);
      set({ currentCommande: commande, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  updateCommandeStatut: async (id, statut) => {
    set({ isLoading: true, error: null });
    try {
      await b2bApi.updateCommandeStatut(id, statut);
      await get().fetchCommandes();
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  // ---- Catalogue ----
  fetchCatalogue: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await b2bApi.listCatalogue(params);
      set({
        catalogue: res.items,
        catalogueTotal: res.total,
        catalogueCategories: res.categories || [],
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  // ---- Panier ----
  fetchPanier: async () => {
    try {
      const panier = await b2bApi.getPanier();
      set({ panier });
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  addToPanier: async (produitId, quantite = 1) => {
    try {
      await b2bApi.addToPanier(produitId, quantite);
      await get().fetchPanier();
    } catch (err) {
      set({ error: extractError(err) });
      throw err;
    }
  },

  removeFromPanier: async (itemId) => {
    try {
      await b2bApi.removeFromPanier(itemId);
      await get().fetchPanier();
    } catch (err) {
      set({ error: extractError(err) });
      throw err;
    }
  },

  commanderPanier: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await b2bApi.commanderPanier(data);
      set({ panier: null, isLoading: false });
      await get().fetchCommandes();
      return { numero: res.numero };
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  // ---- Messages ----
  fetchMessages: async (params) => {
    try {
      const res = await b2bApi.listMessages(params);
      set({ messages: res.items, messagesTotal: res.total });
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  sendMessage: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await b2bApi.sendMessage(data);
      await get().fetchMessages({ demandeId: data.demandeId, contratId: data.contratId });
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  // ---- Notifications ----
  fetchNotifications: async (nonLues) => {
    try {
      const res = await b2bApi.listNotifications(nonLues);
      set({ notifications: res.items });
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  markNotificationRead: async (id) => {
    try {
      await b2bApi.markNotificationRead(id);
      await get().fetchNotifications();
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  // ---- UI ----
  clearError: () => set({ error: null }),
  clearCurrentDemande: () => set({ currentDemande: null }),
  clearCurrentContrat: () => set({ currentContrat: null }),
}));
