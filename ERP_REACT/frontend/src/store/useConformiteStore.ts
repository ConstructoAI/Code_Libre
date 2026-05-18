/**
 * ERP React Frontend - Conformite RBQ/CCQ Zustand Store
 * Full feature parity with Streamlit conformite_construction.py.
 */

import { create } from 'zustand';
import * as conformiteApi from '@/api/conformite';
import type {
  Alerte,
  AiAnalyzeResult,
  AiGenerateRapportResult,
  AiPredictRenewalsResult,
  AiRecommendFormationsResult,
  AiSearchRegulationsResult,
  AiVerifyProjectResult,
  Attestation,
  AttestationCreateBody,
  AttestationUpdateBody,
  CarteCreateBody,
  CarteUpdateBody,
  CcqCarte,
  ComplianceConstants,
  ComplianceResources,
  ComplianceStats,
  LicenceCreateBody,
  LicenceUpdateBody,
  RbqLicence,
} from '@/api/conformite';

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ConformiteState {
  // Metadata
  constants: ComplianceConstants | null;
  resources: ComplianceResources | null;

  // Entities
  licences: RbqLicence[];
  currentLicence: RbqLicence | null;
  cartes: CcqCarte[];
  currentCarte: CcqCarte | null;
  attestations: Attestation[];
  currentAttestation: Attestation | null;

  // Stats & Alertes
  stats: ComplianceStats | null;
  alertes: Alerte[];

  // AI results
  aiAnalyzeResult: AiAnalyzeResult | null;
  aiChatHistory: AiChatMessage[];
  aiVerifyProjectResult: AiVerifyProjectResult | null;
  aiSearchRegulationsResult: AiSearchRegulationsResult | null;
  aiPredictRenewalsResult: AiPredictRenewalsResult | null;
  aiGenerateRapportResult: AiGenerateRapportResult | null;
  aiRecommendFormationsResult: AiRecommendFormationsResult | null;

  // Filters (preserved across mutations)
  currentLicenceStatutFilter: string | undefined;
  currentLicenceCategorieFilter: string | undefined;
  currentLicenceSearchFilter: string | undefined;
  currentCarteStatutFilter: string | undefined;
  currentCarteMetierFilter: string | undefined;
  currentCarteSearchFilter: string | undefined;
  currentAttestationStatutFilter: string | undefined;
  currentAttestationTypeFilter: string | undefined;

  // UI state
  isLoading: boolean;
  isLoadingLicences: boolean;
  isLoadingCartes: boolean;
  isLoadingAttestations: boolean;
  isLoadingStats: boolean;
  isAiRunning: boolean;
  error: string | null;
  successMessage: string | null;

  // Actions - Init
  init: () => Promise<void>;
  fetchConstants: () => Promise<void>;
  fetchResources: () => Promise<void>;

  // Actions - Licences
  fetchLicences: (params?: { statut?: string; categorie?: string; search?: string }) => Promise<void>;
  fetchLicence: (id: number) => Promise<void>;
  clearCurrentLicence: () => void;
  createLicence: (body: LicenceCreateBody) => Promise<{ id: number }>;
  updateLicence: (id: number, body: LicenceUpdateBody) => Promise<void>;
  deleteLicence: (id: number) => Promise<void>;

  // Actions - Cartes CCQ
  fetchCartes: (params?: { statut?: string; metier?: string; search?: string }) => Promise<void>;
  fetchCarte: (id: number) => Promise<void>;
  clearCurrentCarte: () => void;
  createCarte: (body: CarteCreateBody) => Promise<{ id: number }>;
  updateCarte: (id: number, body: CarteUpdateBody) => Promise<void>;
  deleteCarte: (id: number) => Promise<void>;

  // Actions - Attestations
  fetchAttestations: (params?: { statut?: string; type?: string }) => Promise<void>;
  fetchAttestation: (id: number) => Promise<void>;
  clearCurrentAttestation: () => void;
  createAttestation: (body: AttestationCreateBody) => Promise<{ id: number }>;
  updateAttestation: (id: number, body: AttestationUpdateBody) => Promise<void>;
  deleteAttestation: (id: number) => Promise<void>;
  uploadAttestationFile: (id: number, file: File) => Promise<void>;
  downloadAttestationFile: (id: number, filename: string) => Promise<void>;

  // Actions - Stats & Alertes
  fetchStatistics: () => Promise<void>;
  fetchAlertes: () => Promise<void>;

  // Actions - AI
  aiAnalyze: () => Promise<void>;
  aiChat: (question: string, includeContext?: boolean) => Promise<void>;
  clearAiChat: () => void;
  aiVerifyProject: (payload: {
    typeProjet: string;
    valeur: number;
    region: string;
    travaux: string[];
  }) => Promise<void>;
  aiSearchRegulations: (query: string) => Promise<void>;
  aiPredictRenewals: () => Promise<void>;
  aiGenerateRapport: () => Promise<void>;
  aiRecommendFormations: (projetsPrevus?: string[]) => Promise<void>;
  clearAiResults: () => void;

  // UI helpers
  clearError: () => void;
  clearSuccess: () => void;
  reset: () => void;
}

function extractError(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: { detail?: string } } }).response;
    if (resp?.data?.detail) return resp.data.detail;
  }
  if (err instanceof Error) return err.message;
  return 'Une erreur est survenue';
}

export const useConformiteStore = create<ConformiteState>((set, get) => ({
  constants: null,
  resources: null,
  licences: [],
  currentLicence: null,
  cartes: [],
  currentCarte: null,
  attestations: [],
  currentAttestation: null,
  stats: null,
  alertes: [],
  aiAnalyzeResult: null,
  aiChatHistory: [],
  aiVerifyProjectResult: null,
  aiSearchRegulationsResult: null,
  aiPredictRenewalsResult: null,
  aiGenerateRapportResult: null,
  aiRecommendFormationsResult: null,
  currentLicenceStatutFilter: undefined,
  currentLicenceCategorieFilter: undefined,
  currentLicenceSearchFilter: undefined,
  currentCarteStatutFilter: undefined,
  currentCarteMetierFilter: undefined,
  currentCarteSearchFilter: undefined,
  currentAttestationStatutFilter: undefined,
  currentAttestationTypeFilter: undefined,
  isLoading: false,
  isLoadingLicences: false,
  isLoadingCartes: false,
  isLoadingAttestations: false,
  isLoadingStats: false,
  isAiRunning: false,
  error: null,
  successMessage: null,

  init: async () => {
    await Promise.all([
      get().fetchConstants(),
      get().fetchResources(),
      get().fetchLicences(),
      get().fetchCartes(),
      get().fetchAttestations(),
      get().fetchStatistics(),
      get().fetchAlertes(),
    ]);
  },

  fetchConstants: async () => {
    try {
      const constants = await conformiteApi.getConstants();
      set({ constants });
    } catch (err) {
      set({ error: extractError(err), successMessage: null });
    }
  },

  fetchResources: async () => {
    try {
      const resources = await conformiteApi.getResources();
      set({ resources });
    } catch (err) {
      set({ error: extractError(err), successMessage: null });
    }
  },

  // ============ LICENCES ============

  fetchLicences: async (params) => {
    set({
      isLoadingLicences: true,
      error: null,
      currentLicenceStatutFilter: params?.statut,
      currentLicenceCategorieFilter: params?.categorie,
      currentLicenceSearchFilter: params?.search,
    });
    try {
      const licences = await conformiteApi.listLicences(params);
      set({ licences, isLoadingLicences: false });
    } catch (err) {
      set({ error: extractError(err), isLoadingLicences: false, successMessage: null });
    }
  },

  fetchLicence: async (id) => {
    set({ error: null });
    try {
      const licence = await conformiteApi.getLicence(id);
      set({ currentLicence: licence });
    } catch (err) {
      set({ error: extractError(err), successMessage: null });
    }
  },

  clearCurrentLicence: () => {
    set({ currentLicence: null });
  },

  createLicence: async (body) => {
    set({ error: null });
    const s = get();
    const filters = {
      statut: s.currentLicenceStatutFilter,
      categorie: s.currentLicenceCategorieFilter,
      search: s.currentLicenceSearchFilter,
    };
    try {
      const result = await conformiteApi.createLicence(body);
      set({ successMessage: 'Licence RBQ creee' });
      await get().fetchLicences(filters);
      await get().fetchStatistics();
      return { id: result.id };
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  updateLicence: async (id, body) => {
    set({ error: null });
    const s = get();
    const filters = {
      statut: s.currentLicenceStatutFilter,
      categorie: s.currentLicenceCategorieFilter,
      search: s.currentLicenceSearchFilter,
    };
    try {
      await conformiteApi.updateLicence(id, body);
      set({ successMessage: 'Licence mise a jour' });
      await get().fetchLicences(filters);
      if (get().currentLicence?.id === id) {
        await get().fetchLicence(id);
      }
      await get().fetchStatistics();
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  deleteLicence: async (id) => {
    set({ error: null });
    const s = get();
    const filters = {
      statut: s.currentLicenceStatutFilter,
      categorie: s.currentLicenceCategorieFilter,
      search: s.currentLicenceSearchFilter,
    };
    try {
      await conformiteApi.deleteLicence(id);
      set({ successMessage: 'Licence supprimee' });
      if (get().currentLicence?.id === id) {
        set({ currentLicence: null });
      }
      await get().fetchLicences(filters);
      await get().fetchStatistics();
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  // ============ CARTES CCQ ============

  fetchCartes: async (params) => {
    set({
      isLoadingCartes: true,
      error: null,
      currentCarteStatutFilter: params?.statut,
      currentCarteMetierFilter: params?.metier,
      currentCarteSearchFilter: params?.search,
    });
    try {
      const cartes = await conformiteApi.listCartes(params);
      set({ cartes, isLoadingCartes: false });
    } catch (err) {
      set({ error: extractError(err), isLoadingCartes: false, successMessage: null });
    }
  },

  fetchCarte: async (id) => {
    set({ error: null });
    try {
      const carte = await conformiteApi.getCarte(id);
      set({ currentCarte: carte });
    } catch (err) {
      set({ error: extractError(err), successMessage: null });
    }
  },

  clearCurrentCarte: () => {
    set({ currentCarte: null });
  },

  createCarte: async (body) => {
    set({ error: null });
    const s = get();
    const filters = {
      statut: s.currentCarteStatutFilter,
      metier: s.currentCarteMetierFilter,
      search: s.currentCarteSearchFilter,
    };
    try {
      const result = await conformiteApi.createCarte(body);
      set({ successMessage: 'Carte CCQ creee' });
      await get().fetchCartes(filters);
      await get().fetchStatistics();
      return { id: result.id };
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  updateCarte: async (id, body) => {
    set({ error: null });
    const s = get();
    const filters = {
      statut: s.currentCarteStatutFilter,
      metier: s.currentCarteMetierFilter,
      search: s.currentCarteSearchFilter,
    };
    try {
      await conformiteApi.updateCarte(id, body);
      set({ successMessage: 'Carte mise a jour' });
      await get().fetchCartes(filters);
      if (get().currentCarte?.id === id) {
        await get().fetchCarte(id);
      }
      await get().fetchStatistics();
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  deleteCarte: async (id) => {
    set({ error: null });
    const s = get();
    const filters = {
      statut: s.currentCarteStatutFilter,
      metier: s.currentCarteMetierFilter,
      search: s.currentCarteSearchFilter,
    };
    try {
      await conformiteApi.deleteCarte(id);
      set({ successMessage: 'Carte supprimee' });
      if (get().currentCarte?.id === id) {
        set({ currentCarte: null });
      }
      await get().fetchCartes(filters);
      await get().fetchStatistics();
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  // ============ ATTESTATIONS ============

  fetchAttestations: async (params) => {
    set({
      isLoadingAttestations: true,
      error: null,
      currentAttestationStatutFilter: params?.statut,
      currentAttestationTypeFilter: params?.type,
    });
    try {
      const attestations = await conformiteApi.listAttestations(params);
      set({ attestations, isLoadingAttestations: false });
    } catch (err) {
      set({ error: extractError(err), isLoadingAttestations: false, successMessage: null });
    }
  },

  fetchAttestation: async (id) => {
    set({ error: null });
    try {
      const attestation = await conformiteApi.getAttestation(id);
      set({ currentAttestation: attestation });
    } catch (err) {
      set({ error: extractError(err), successMessage: null });
    }
  },

  clearCurrentAttestation: () => {
    set({ currentAttestation: null });
  },

  createAttestation: async (body) => {
    set({ error: null });
    const s = get();
    const filters = {
      statut: s.currentAttestationStatutFilter,
      type: s.currentAttestationTypeFilter,
    };
    try {
      const result = await conformiteApi.createAttestation(body);
      set({ successMessage: 'Attestation creee' });
      await get().fetchAttestations(filters);
      await get().fetchStatistics();
      return { id: result.id };
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  updateAttestation: async (id, body) => {
    set({ error: null });
    const s = get();
    const filters = {
      statut: s.currentAttestationStatutFilter,
      type: s.currentAttestationTypeFilter,
    };
    try {
      await conformiteApi.updateAttestation(id, body);
      set({ successMessage: 'Attestation mise a jour' });
      await get().fetchAttestations(filters);
      if (get().currentAttestation?.id === id) {
        await get().fetchAttestation(id);
      }
      await get().fetchStatistics();
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  deleteAttestation: async (id) => {
    set({ error: null });
    const s = get();
    const filters = {
      statut: s.currentAttestationStatutFilter,
      type: s.currentAttestationTypeFilter,
    };
    try {
      await conformiteApi.deleteAttestation(id);
      set({ successMessage: 'Attestation supprimee' });
      if (get().currentAttestation?.id === id) {
        set({ currentAttestation: null });
      }
      await get().fetchAttestations(filters);
      await get().fetchStatistics();
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  uploadAttestationFile: async (id, file) => {
    set({ error: null });
    try {
      await conformiteApi.uploadAttestationFile(id, file);
      set({ successMessage: 'Fichier televerse' });
      if (get().currentAttestation?.id === id) {
        await get().fetchAttestation(id);
      }
      const s = get();
      await get().fetchAttestations({
        statut: s.currentAttestationStatutFilter,
        type: s.currentAttestationTypeFilter,
      });
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  downloadAttestationFile: async (id, filename) => {
    set({ error: null });
    try {
      const blob = await conformiteApi.downloadAttestationFile(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      set({ error: extractError(err), successMessage: null });
    }
  },

  // ============ STATS & ALERTES ============

  fetchStatistics: async () => {
    set({ isLoadingStats: true });
    try {
      const stats = await conformiteApi.getStatistics();
      set({ stats, isLoadingStats: false });
    } catch (err) {
      set({ error: extractError(err), isLoadingStats: false, successMessage: null });
    }
  },

  fetchAlertes: async () => {
    try {
      const alertes = await conformiteApi.listAlertes();
      set({ alertes });
    } catch (err) {
      set({ error: extractError(err), successMessage: null });
    }
  },

  // ============ AI ASSISTANT ============

  aiAnalyze: async () => {
    set({ isAiRunning: true, error: null, aiAnalyzeResult: null });
    try {
      const result = await conformiteApi.aiAnalyzeConformite();
      set({ aiAnalyzeResult: result, isAiRunning: false });
    } catch (err) {
      set({ error: extractError(err), isAiRunning: false, successMessage: null });
    }
  },

  aiChat: async (question, includeContext = true) => {
    // Prevent concurrent chat calls that would corrupt history
    if (get().isAiRunning) return;
    set({ isAiRunning: true, error: null });
    const prevHistory = get().aiChatHistory;
    const userMsg: AiChatMessage = { role: 'user', content: question };
    // Optimistically add user question
    set({ aiChatHistory: [...prevHistory, userMsg] });
    try {
      const result = await conformiteApi.aiChat(question, includeContext);
      // If the user called clearAiChat() while we were awaiting the response,
      // the current history will be shorter than prevHistory + 1 — respect the
      // user's intent and don't resurrect the conversation.
      const current = get().aiChatHistory;
      if (current.length < prevHistory.length + 1) {
        set({ isAiRunning: false });
        return;
      }
      set({
        aiChatHistory: [
          ...current,
          { role: 'assistant', content: result.response },
        ],
        isAiRunning: false,
      });
    } catch (err) {
      // Restore history on error, unless user already cleared it
      const current = get().aiChatHistory;
      set({
        aiChatHistory: current.length < prevHistory.length + 1 ? current : prevHistory,
        error: extractError(err),
        isAiRunning: false,
        successMessage: null,
      });
    }
  },

  clearAiChat: () => {
    set({ aiChatHistory: [] });
  },

  aiVerifyProject: async (payload) => {
    set({ isAiRunning: true, error: null, aiVerifyProjectResult: null });
    try {
      const result = await conformiteApi.aiVerifyProject(payload);
      set({ aiVerifyProjectResult: result, isAiRunning: false });
    } catch (err) {
      set({ error: extractError(err), isAiRunning: false, successMessage: null });
    }
  },

  aiSearchRegulations: async (query) => {
    set({ isAiRunning: true, error: null, aiSearchRegulationsResult: null });
    try {
      const result = await conformiteApi.aiSearchRegulations(query);
      set({ aiSearchRegulationsResult: result, isAiRunning: false });
    } catch (err) {
      set({ error: extractError(err), isAiRunning: false, successMessage: null });
    }
  },

  aiPredictRenewals: async () => {
    set({ isAiRunning: true, error: null, aiPredictRenewalsResult: null });
    try {
      const result = await conformiteApi.aiPredictRenewals();
      set({ aiPredictRenewalsResult: result, isAiRunning: false });
    } catch (err) {
      set({ error: extractError(err), isAiRunning: false, successMessage: null });
    }
  },

  aiGenerateRapport: async () => {
    set({ isAiRunning: true, error: null, aiGenerateRapportResult: null });
    try {
      const result = await conformiteApi.aiGenerateRapport();
      set({ aiGenerateRapportResult: result, isAiRunning: false });
    } catch (err) {
      set({ error: extractError(err), isAiRunning: false, successMessage: null });
    }
  },

  aiRecommendFormations: async (projetsPrevus = []) => {
    set({ isAiRunning: true, error: null, aiRecommendFormationsResult: null });
    try {
      const result = await conformiteApi.aiRecommendFormations(projetsPrevus);
      set({ aiRecommendFormationsResult: result, isAiRunning: false });
    } catch (err) {
      set({ error: extractError(err), isAiRunning: false, successMessage: null });
    }
  },

  clearAiResults: () => {
    set({
      aiAnalyzeResult: null,
      aiVerifyProjectResult: null,
      aiSearchRegulationsResult: null,
      aiPredictRenewalsResult: null,
      aiGenerateRapportResult: null,
      aiRecommendFormationsResult: null,
    });
  },

  clearError: () => set({ error: null }),
  clearSuccess: () => set({ successMessage: null }),
  // Reset store to initial state — call on logout to prevent data leaks
  // across user sessions in the same browser tab. Only resets state,
  // not the action identities (Zustand preserves those).
  reset: () =>
    set({
      constants: null,
      resources: null,
      licences: [],
      currentLicence: null,
      cartes: [],
      currentCarte: null,
      attestations: [],
      currentAttestation: null,
      stats: null,
      alertes: [],
      aiAnalyzeResult: null,
      aiChatHistory: [],
      aiVerifyProjectResult: null,
      aiSearchRegulationsResult: null,
      aiPredictRenewalsResult: null,
      aiGenerateRapportResult: null,
      aiRecommendFormationsResult: null,
      currentLicenceStatutFilter: undefined,
      currentLicenceCategorieFilter: undefined,
      currentLicenceSearchFilter: undefined,
      currentCarteStatutFilter: undefined,
      currentCarteMetierFilter: undefined,
      currentCarteSearchFilter: undefined,
      currentAttestationStatutFilter: undefined,
      currentAttestationTypeFilter: undefined,
      isLoading: false,
      isLoadingLicences: false,
      isLoadingCartes: false,
      isLoadingAttestations: false,
      isLoadingStats: false,
      isAiRunning: false,
      error: null,
      successMessage: null,
    }),
}));
