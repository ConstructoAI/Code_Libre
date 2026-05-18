/**
 * ERP React Frontend - Maintenance Zustand Store
 * Types, Planification, Requests, Interventions, Pieces,
 * Historique, Compteurs, Alertes, Statistics.
 */

import { create } from 'zustand';
import * as maintApi from '@/api/maintenance';
import type {
  MaintenanceType,
  MaintenancePlanification,
  MaintenanceRequest,
  MaintenanceIntervention,
  MaintenancePiece,
  MaintenanceHistoriqueEntry,
  MaintenanceCompteur,
  MaintenanceAlerte,
  MaintenanceStats,
} from '@/types';

interface SelectedRequestDetail {
  demande: MaintenanceRequest;
  pieces: MaintenancePiece[];
  interventions: MaintenanceIntervention[];
}

interface SelectedInterventionDetail {
  intervention: MaintenanceIntervention;
  pieces: MaintenancePiece[];
}

interface MaintenanceState {
  // Lists
  types: MaintenanceType[];
  planifications: MaintenancePlanification[];
  requests: MaintenanceRequest[];
  interventions: MaintenanceIntervention[];
  pieces: MaintenancePiece[];
  historique: MaintenanceHistoriqueEntry[];
  compteurs: MaintenanceCompteur[];
  alertes: MaintenanceAlerte[];

  // Details
  selectedRequest: SelectedRequestDetail | null;
  selectedIntervention: SelectedInterventionDetail | null;

  // Stats
  stats: MaintenanceStats | null;

  // State
  isLoading: boolean;
  error: string | null;

  // Filters
  requestFilters: { statut: string };
  interventionFilters: { statut: string };
  alerteFilters: { nonLuesOnly: boolean; priorite: string };

  // Types actions
  fetchTypes: (params?: Parameters<typeof maintApi.listTypes>[0]) => Promise<void>;
  createType: (data: Parameters<typeof maintApi.createType>[0]) => Promise<void>;
  updateType: (id: number, data: Parameters<typeof maintApi.updateType>[1]) => Promise<void>;
  deleteType: (id: number) => Promise<void>;

  // Planification actions
  fetchPlanifications: (params?: Parameters<typeof maintApi.listPlanification>[0]) => Promise<void>;
  createPlanification: (data: Parameters<typeof maintApi.createPlanification>[0]) => Promise<void>;
  updatePlanification: (id: number, data: Parameters<typeof maintApi.updatePlanification>[1]) => Promise<void>;
  deletePlanification: (id: number) => Promise<void>;

  // Requests actions
  fetchRequests: () => Promise<void>;
  fetchRequestDetail: (id: number) => Promise<void>;
  createRequest: (data: Parameters<typeof maintApi.createRequest>[0]) => Promise<void>;
  updateRequest: (id: number, data: Parameters<typeof maintApi.updateRequest>[1]) => Promise<void>;
  deleteRequest: (id: number) => Promise<void>;
  clearSelectedRequest: () => void;

  // Interventions actions
  fetchInterventions: (params?: Parameters<typeof maintApi.listInterventions>[0]) => Promise<void>;
  fetchInterventionDetail: (id: number) => Promise<void>;
  createIntervention: (data: Parameters<typeof maintApi.createIntervention>[0]) => Promise<void>;
  updateIntervention: (id: number, data: Parameters<typeof maintApi.updateIntervention>[1]) => Promise<void>;
  deleteIntervention: (id: number) => Promise<void>;
  clearSelectedIntervention: () => void;

  // Pieces actions
  fetchPieces: (params?: Parameters<typeof maintApi.listPieces>[0]) => Promise<void>;
  createPiece: (data: Parameters<typeof maintApi.createPiece>[0]) => Promise<void>;
  deletePiece: (id: number) => Promise<void>;

  // Historique actions
  fetchHistorique: (params?: Parameters<typeof maintApi.listHistorique>[0]) => Promise<void>;
  createHistoriqueEntry: (data: Parameters<typeof maintApi.createHistoriqueEntry>[0]) => Promise<void>;

  // Compteurs actions
  fetchCompteurs: (params?: Parameters<typeof maintApi.listCompteurs>[0]) => Promise<void>;
  createCompteur: (data: Parameters<typeof maintApi.createCompteur>[0]) => Promise<void>;

  // Alertes actions
  fetchAlertes: () => Promise<void>;
  updateAlerte: (id: number, data: Parameters<typeof maintApi.updateAlerte>[1]) => Promise<void>;
  generateAlertes: () => Promise<void>;

  // Stats
  fetchStats: () => Promise<void>;

  // Filters
  setRequestFilter: (key: string, value: unknown) => void;
  setInterventionFilter: (key: string, value: unknown) => void;
  setAlerteFilter: (key: string, value: unknown) => void;
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

export const useMaintenanceStore = create<MaintenanceState>((set, get) => ({
  types: [],
  planifications: [],
  requests: [],
  interventions: [],
  pieces: [],
  historique: [],
  compteurs: [],
  alertes: [],
  selectedRequest: null,
  selectedIntervention: null,
  stats: null,
  isLoading: false,
  error: null,
  requestFilters: { statut: '' },
  interventionFilters: { statut: '' },
  alerteFilters: { nonLuesOnly: false, priorite: '' },

  // ── Types ──────────────────────────────────────
  fetchTypes: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await maintApi.listTypes(params);
      set({ types: res.items ?? [], isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement types') });
    }
  },

  createType: async (data) => {
    set({ error: null });
    try {
      await maintApi.createType(data);
      await get().fetchTypes();
    } catch (err) {
      set({ error: extractError(err, 'Erreur creation type') });
      throw err;
    }
  },

  updateType: async (id, data) => {
    set({ error: null });
    try {
      await maintApi.updateType(id, data);
      await get().fetchTypes();
    } catch (err) {
      set({ error: extractError(err, 'Erreur mise à jour type') });
      throw err;
    }
  },

  deleteType: async (id) => {
    set({ error: null });
    try {
      await maintApi.deleteType(id);
      await get().fetchTypes();
    } catch (err) {
      set({ error: extractError(err, 'Erreur suppression type') });
      throw err;
    }
  },

  // ── Planification ──────────────────────────────
  fetchPlanifications: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await maintApi.listPlanification(params);
      set({ planifications: res.items ?? [], isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement planification') });
    }
  },

  createPlanification: async (data) => {
    set({ error: null });
    try {
      await maintApi.createPlanification(data);
      await get().fetchPlanifications();
      await get().fetchStats();
    } catch (err) {
      set({ error: extractError(err, 'Erreur creation planification') });
      throw err;
    }
  },

  updatePlanification: async (id, data) => {
    set({ error: null });
    try {
      await maintApi.updatePlanification(id, data);
      await get().fetchPlanifications();
      await get().fetchStats();
    } catch (err) {
      set({ error: extractError(err, 'Erreur mise à jour planification') });
      throw err;
    }
  },

  deletePlanification: async (id) => {
    set({ error: null });
    try {
      await maintApi.deletePlanification(id);
      await get().fetchPlanifications();
      await get().fetchStats();
    } catch (err) {
      set({ error: extractError(err, 'Erreur suppression planification') });
      throw err;
    }
  },

  // ── Requests ───────────────────────────────────
  fetchRequests: async () => {
    set({ isLoading: true, error: null });
    try {
      const { requestFilters: f } = get();
      const res = await maintApi.listRequests({
        statut: f.statut || undefined,
        limit: 200,
      });
      set({ requests: res.items ?? [], isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement demandes') });
    }
  },

  fetchRequestDetail: async (id) => {
    set({ isLoading: true, error: null, selectedRequest: null });
    try {
      const res = await maintApi.getRequest(id);
      set({ selectedRequest: res, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement detail demande') });
    }
  },

  createRequest: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await maintApi.createRequest(data);
      await get().fetchRequests();
      await get().fetchStats();
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur creation demande') });
      throw err;
    }
  },

  updateRequest: async (id, data) => {
    set({ error: null });
    try {
      await maintApi.updateRequest(id, data);
      await get().fetchRequests();
      await get().fetchStats();
      // Refresh detail si actuellement sélectionnée
      const { selectedRequest } = get();
      if (selectedRequest && selectedRequest.demande.id === id) {
        await get().fetchRequestDetail(id);
      }
    } catch (err) {
      set({ error: extractError(err, 'Erreur mise à jour demande') });
      throw err;
    }
  },

  deleteRequest: async (id) => {
    set({ error: null });
    try {
      await maintApi.deleteRequest(id);
      await get().fetchRequests();
      await get().fetchStats();
    } catch (err) {
      set({ error: extractError(err, 'Erreur suppression demande') });
      throw err;
    }
  },

  clearSelectedRequest: () => set({ selectedRequest: null }),

  // ── Interventions ──────────────────────────────
  fetchInterventions: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const { interventionFilters: f } = get();
      const merged = { statut: f.statut || undefined, ...(params || {}) };
      const res = await maintApi.listInterventions(merged);
      set({ interventions: res.items ?? [], isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement interventions') });
    }
  },

  fetchInterventionDetail: async (id) => {
    set({ isLoading: true, error: null, selectedIntervention: null });
    try {
      const res = await maintApi.getIntervention(id);
      set({ selectedIntervention: res, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement detail intervention') });
    }
  },

  createIntervention: async (data) => {
    set({ error: null });
    try {
      await maintApi.createIntervention(data);
      await get().fetchInterventions();
      await get().fetchRequests();
      await get().fetchStats();
    } catch (err) {
      set({ error: extractError(err, 'Erreur creation intervention') });
      throw err;
    }
  },

  updateIntervention: async (id, data) => {
    set({ error: null });
    try {
      await maintApi.updateIntervention(id, data);
      await get().fetchInterventions();
      await get().fetchRequests();
      await get().fetchStats();
      const { selectedIntervention } = get();
      if (selectedIntervention && selectedIntervention.intervention.id === id) {
        await get().fetchInterventionDetail(id);
      }
    } catch (err) {
      set({ error: extractError(err, 'Erreur mise à jour intervention') });
      throw err;
    }
  },

  deleteIntervention: async (id) => {
    set({ error: null });
    try {
      await maintApi.deleteIntervention(id);
      await get().fetchInterventions();
      await get().fetchStats();
    } catch (err) {
      set({ error: extractError(err, 'Erreur suppression intervention') });
      throw err;
    }
  },

  clearSelectedIntervention: () => set({ selectedIntervention: null }),

  // ── Pieces ─────────────────────────────────────
  fetchPieces: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await maintApi.listPieces(params);
      set({ pieces: res.items ?? [], isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement pieces') });
    }
  },

  createPiece: async (data) => {
    set({ error: null });
    try {
      await maintApi.createPiece(data);
      await get().fetchPieces(
        data.interventionId ? { interventionId: data.interventionId } :
        data.demandeId ? { demandeId: data.demandeId } :
        undefined
      );
      // Refresh detail views qui affichent cette pièce
      const { selectedRequest, selectedIntervention } = get();
      if (selectedRequest && data.demandeId === selectedRequest.demande.id) {
        await get().fetchRequestDetail(selectedRequest.demande.id);
      }
      if (selectedIntervention && data.interventionId === selectedIntervention.intervention.id) {
        await get().fetchInterventionDetail(selectedIntervention.intervention.id);
      }
    } catch (err) {
      set({ error: extractError(err, 'Erreur ajout piece') });
      throw err;
    }
  },

  deletePiece: async (id) => {
    set({ error: null });
    try {
      await maintApi.deletePiece(id);
      await get().fetchPieces();
      const { selectedRequest, selectedIntervention } = get();
      if (selectedRequest) {
        await get().fetchRequestDetail(selectedRequest.demande.id);
      }
      if (selectedIntervention) {
        await get().fetchInterventionDetail(selectedIntervention.intervention.id);
      }
    } catch (err) {
      set({ error: extractError(err, 'Erreur suppression piece') });
      throw err;
    }
  },

  // ── Historique ─────────────────────────────────
  fetchHistorique: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await maintApi.listHistorique(params);
      set({ historique: res.items ?? [], isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement historique') });
    }
  },

  createHistoriqueEntry: async (data) => {
    set({ error: null });
    try {
      await maintApi.createHistoriqueEntry(data);
      await get().fetchHistorique();
    } catch (err) {
      set({ error: extractError(err, 'Erreur creation entree historique') });
      throw err;
    }
  },

  // ── Compteurs ──────────────────────────────────
  fetchCompteurs: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const res = await maintApi.listCompteurs(params);
      set({ compteurs: res.items ?? [], isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement compteurs') });
    }
  },

  createCompteur: async (data) => {
    set({ error: null });
    try {
      await maintApi.createCompteur(data);
      await get().fetchCompteurs();
    } catch (err) {
      set({ error: extractError(err, 'Erreur creation releve') });
      throw err;
    }
  },

  // ── Alertes ────────────────────────────────────
  fetchAlertes: async () => {
    set({ isLoading: true, error: null });
    try {
      const { alerteFilters: f } = get();
      const res = await maintApi.listAlertes({
        nonLuesOnly: f.nonLuesOnly || undefined,
        priorite: f.priorite || undefined,
      });
      set({ alertes: res.items ?? [], isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement alertes') });
    }
  },

  updateAlerte: async (id, data) => {
    set({ error: null });
    try {
      await maintApi.updateAlerte(id, data);
      await get().fetchAlertes();
      await get().fetchStats();
    } catch (err) {
      set({ error: extractError(err, 'Erreur mise à jour alerte') });
      throw err;
    }
  },

  generateAlertes: async () => {
    set({ error: null });
    try {
      await maintApi.generateAlertes();
      await get().fetchAlertes();
      await get().fetchStats();
    } catch (err) {
      set({ error: extractError(err, 'Erreur generation alertes') });
      throw err;
    }
  },

  // ── Stats ──────────────────────────────────────
  fetchStats: async () => {
    set({ error: null });
    try {
      const res = await maintApi.getStats();
      set({ stats: res });
    } catch (err) {
      set({ error: extractError(err, 'Erreur chargement statistiques') });
    }
  },

  // ── Filters ────────────────────────────────────
  setRequestFilter: (key, value) => {
    set((s) => ({
      requestFilters: { ...s.requestFilters, [key]: value },
    }));
  },

  setInterventionFilter: (key, value) => {
    set((s) => ({
      interventionFilters: { ...s.interventionFilters, [key]: value },
    }));
  },

  setAlerteFilter: (key, value) => {
    set((s) => ({
      alerteFilters: { ...s.alerteFilters, [key]: value },
    }));
  },

  clearError: () => set({ error: null }),
}));
