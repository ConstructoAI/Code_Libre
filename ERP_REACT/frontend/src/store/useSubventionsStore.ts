/**
 * ERP React Frontend - Subventions Zustand Store
 * Full feature parity with Streamlit subventions_manager.py.
 */

import { create } from 'zustand';
import * as subventionsApi from '@/api/subventions';
import type {
  AiAnalyzeDemandeResult,
  AiAnalyzeEligibilityRequest,
  AiEligibilityResult,
  AiSuggestResult,
  DemandeCreateBody,
  DemandeUpdateBody,
  EligibilityProfile,
  EligibilityResult,
  ProgrammeFilters,
  SubventionCategorie,
  SubventionConstants,
  SubventionDemande,
  SubventionDocument,
  SubventionProgramme,
  SubventionResources,
  SubventionStats,
} from '@/api/subventions';

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SubventionsState {
  // Metadata
  constants: SubventionConstants | null;
  resources: SubventionResources | null;

  // Reference data
  categories: SubventionCategorie[];
  programmes: SubventionProgramme[];
  currentProgramme: SubventionProgramme | null;
  expiringProgrammes: SubventionProgramme[];

  // Applications
  demandes: SubventionDemande[];
  currentDemande: SubventionDemande | null;

  // Stats
  stats: SubventionStats | null;

  // Eligibility
  eligibilityResult: EligibilityResult | null;

  // AI
  aiSuggestResult: AiSuggestResult | null;
  aiChatHistory: AiChatMessage[];
  aiChecklistResult: { programme: SubventionProgramme; checklist: string } | null;
  aiAnalyzeDemandeResult: AiAnalyzeDemandeResult | null;
  aiEligibilityResult: AiEligibilityResult | null;

  // Filters (catalogue tab)
  filters: ProgrammeFilters;

  // Current statut filter in the Demandes tab (preserved across mutations)
  currentDemandeStatutFilter: string | undefined;

  // UI
  isLoading: boolean;
  isLoadingProgrammes: boolean;
  isLoadingDemandes: boolean;
  isLoadingStats: boolean;
  isEligibilityRunning: boolean;
  isAiRunning: boolean;
  error: string | null;
  successMessage: string | null;

  // Actions — Init
  init: () => Promise<void>;
  fetchConstants: () => Promise<void>;
  fetchResources: () => Promise<void>;

  // Actions — Categories & Programmes
  fetchCategories: () => Promise<void>;
  fetchProgrammes: (filters?: ProgrammeFilters) => Promise<void>;
  fetchProgramme: (id: number) => Promise<void>;
  fetchExpiringProgrammes: (days?: number) => Promise<void>;
  setFilters: (filters: ProgrammeFilters) => void;
  clearFilters: () => Promise<void>;

  // Actions — Demandes
  fetchDemandes: (statut?: string) => Promise<void>;
  fetchDemande: (id: number) => Promise<void>;
  clearCurrentDemande: () => void;
  createDemande: (body: DemandeCreateBody) => Promise<{ id: number; referenceInterne: string }>;
  updateDemande: (id: number, body: DemandeUpdateBody) => Promise<void>;
  soumettreDemande: (id: number) => Promise<void>;
  deleteDemande: (id: number) => Promise<void>;

  // Actions — Documents
  uploadDocument: (demandeId: number, file: File, typeDoc?: string) => Promise<SubventionDocument>;
  downloadDocument: (documentId: number, filename: string) => Promise<void>;
  deleteDocument: (documentId: number) => Promise<void>;
  updateDocumentStatus: (documentId: number, statut: string) => Promise<void>;

  // Actions — Stats
  fetchStatistics: () => Promise<void>;

  // Actions — Eligibility
  checkEligibility: (profile: EligibilityProfile) => Promise<void>;
  clearEligibilityResult: () => void;

  // Actions — AI
  aiSuggest: (description: string, budget?: number) => Promise<void>;
  aiChat: (question: string, context?: string) => Promise<void>;
  clearAiChat: () => void;
  aiChecklist: (programmeId: number) => Promise<void>;
  aiAnalyzeDemande: (demandeId: number) => Promise<void>;
  aiAnalyzeEligibility: (profile: AiAnalyzeEligibilityRequest) => Promise<void>;
  clearAiResults: () => void;

  // UI helpers
  clearError: () => void;
  clearSuccess: () => void;
}

function extractError(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: { detail?: string } } }).response;
    if (resp?.data?.detail) return resp.data.detail;
  }
  if (err instanceof Error) return err.message;
  return 'Une erreur est survenue';
}

export const useSubventionsStore = create<SubventionsState>((set, get) => ({
  constants: null,
  resources: null,
  categories: [],
  programmes: [],
  currentProgramme: null,
  expiringProgrammes: [],
  demandes: [],
  currentDemande: null,
  stats: null,
  eligibilityResult: null,
  aiSuggestResult: null,
  aiChatHistory: [],
  aiChecklistResult: null,
  aiAnalyzeDemandeResult: null,
  aiEligibilityResult: null,
  filters: {},
  currentDemandeStatutFilter: undefined,
  isLoading: false,
  isLoadingProgrammes: false,
  isLoadingDemandes: false,
  isLoadingStats: false,
  isEligibilityRunning: false,
  isAiRunning: false,
  error: null,
  successMessage: null,

  init: async () => {
    await Promise.all([
      get().fetchConstants(),
      get().fetchCategories(),
      get().fetchProgrammes(),
      get().fetchDemandes(),
      get().fetchStatistics(),
      get().fetchExpiringProgrammes(30),
      get().fetchResources(),
    ]);
  },

  fetchConstants: async () => {
    try {
      const constants = await subventionsApi.getConstants();
      set({ constants });
    } catch (err) {
      set({ error: extractError(err), successMessage: null });
    }
  },

  fetchResources: async () => {
    try {
      const resources = await subventionsApi.getResources();
      set({ resources });
    } catch (err) {
      set({ error: extractError(err), successMessage: null });
    }
  },

  fetchCategories: async () => {
    try {
      const categories = await subventionsApi.listCategories();
      set({ categories });
    } catch (err) {
      set({ error: extractError(err), successMessage: null });
    }
  },

  fetchProgrammes: async (filters?: ProgrammeFilters) => {
    set({ isLoadingProgrammes: true, error: null });
    try {
      const effectiveFilters = filters ?? get().filters;
      const programmes = await subventionsApi.listProgrammes(effectiveFilters);
      set({ programmes, isLoadingProgrammes: false });
    } catch (err) {
      set({ error: extractError(err), isLoadingProgrammes: false, successMessage: null });
    }
  },

  fetchProgramme: async (id: number) => {
    set({ error: null });
    try {
      const programme = await subventionsApi.getProgramme(id);
      set({ currentProgramme: programme });
    } catch (err) {
      set({ error: extractError(err), successMessage: null });
    }
  },

  fetchExpiringProgrammes: async (days = 30) => {
    try {
      const expiring = await subventionsApi.listExpiringProgrammes(days);
      set({ expiringProgrammes: expiring });
    } catch (err) {
      set({ error: extractError(err), successMessage: null });
    }
  },

  setFilters: (filters: ProgrammeFilters) => {
    set({ filters });
  },

  clearFilters: async () => {
    set({ filters: {} });
    await get().fetchProgrammes({});
  },

  fetchDemandes: async (statut?: string) => {
    set({ isLoadingDemandes: true, error: null, currentDemandeStatutFilter: statut });
    try {
      const demandes = await subventionsApi.listDemandes(statut);
      set({ demandes, isLoadingDemandes: false });
    } catch (err) {
      set({ error: extractError(err), isLoadingDemandes: false, successMessage: null });
    }
  },

  fetchDemande: async (id: number) => {
    set({ error: null });
    try {
      const demande = await subventionsApi.getDemande(id);
      set({ currentDemande: demande });
    } catch (err) {
      set({ error: extractError(err), successMessage: null });
    }
  },

  clearCurrentDemande: () => {
    set({ currentDemande: null });
  },

  createDemande: async (body: DemandeCreateBody) => {
    set({ error: null });
    // Preserve the user's current statut filter when refreshing after mutation
    const currentStatut = get().currentDemandeStatutFilter;
    try {
      const result = await subventionsApi.createDemande(body);
      set({ successMessage: `Demande creee: ${result.referenceInterne}` });
      await get().fetchDemandes(currentStatut);
      await get().fetchStatistics();
      return result;
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  updateDemande: async (id: number, body: DemandeUpdateBody) => {
    set({ error: null });
    const currentStatut = get().currentDemandeStatutFilter;
    try {
      await subventionsApi.updateDemande(id, body);
      set({ successMessage: 'Demande mise a jour' });
      await get().fetchDemandes(currentStatut);
      if (get().currentDemande?.id === id) {
        await get().fetchDemande(id);
      }
      await get().fetchStatistics();
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  soumettreDemande: async (id: number) => {
    set({ error: null });
    const currentStatut = get().currentDemandeStatutFilter;
    try {
      await subventionsApi.soumettreDemande(id);
      set({ successMessage: 'Demande soumise' });
      await get().fetchDemandes(currentStatut);
      if (get().currentDemande?.id === id) {
        await get().fetchDemande(id);
      }
      await get().fetchStatistics();
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  deleteDemande: async (id: number) => {
    set({ error: null });
    const currentStatut = get().currentDemandeStatutFilter;
    try {
      await subventionsApi.deleteDemande(id);
      set({ successMessage: 'Demande supprimee' });
      if (get().currentDemande?.id === id) {
        set({ currentDemande: null });
      }
      await get().fetchDemandes(currentStatut);
      await get().fetchStatistics();
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  uploadDocument: async (demandeId: number, file: File, typeDoc?: string) => {
    set({ error: null });
    try {
      const doc = await subventionsApi.uploadDemandeDocument(demandeId, file, typeDoc);
      set({ successMessage: 'Document televerse' });
      if (get().currentDemande?.id === demandeId) {
        await get().fetchDemande(demandeId);
      }
      return doc;
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  downloadDocument: async (documentId: number, filename: string) => {
    set({ error: null });
    try {
      const blob = await subventionsApi.downloadDocument(documentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Short timeout lets the browser initiate the download, then reclaim memory
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      set({ error: extractError(err), successMessage: null });
    }
  },

  deleteDocument: async (documentId: number) => {
    set({ error: null });
    try {
      await subventionsApi.deleteDocument(documentId);
      set({ successMessage: 'Document supprime' });
      const cur = get().currentDemande;
      if (cur) {
        await get().fetchDemande(cur.id);
      }
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  updateDocumentStatus: async (documentId: number, statut: string) => {
    set({ error: null });
    try {
      await subventionsApi.updateDocumentStatus(documentId, statut);
      const cur = get().currentDemande;
      if (cur) {
        await get().fetchDemande(cur.id);
      }
    } catch (err) {
      const msg = extractError(err);
      set({ error: msg, successMessage: null });
      throw new Error(msg);
    }
  },

  fetchStatistics: async () => {
    set({ isLoadingStats: true });
    try {
      const stats = await subventionsApi.getStatistics();
      set({ stats, isLoadingStats: false });
    } catch (err) {
      set({ error: extractError(err), isLoadingStats: false, successMessage: null });
    }
  },

  checkEligibility: async (profile: EligibilityProfile) => {
    set({ isEligibilityRunning: true, error: null });
    try {
      const result = await subventionsApi.checkEligibility(profile);
      set({ eligibilityResult: result, isEligibilityRunning: false });
    } catch (err) {
      set({ error: extractError(err), isEligibilityRunning: false, successMessage: null });
    }
  },

  clearEligibilityResult: () => {
    set({ eligibilityResult: null });
  },

  aiSuggest: async (description: string, budget?: number) => {
    set({ isAiRunning: true, error: null, aiSuggestResult: null });
    try {
      const result = await subventionsApi.aiSuggestProgrammes(description, budget);
      set({ aiSuggestResult: result, isAiRunning: false });
    } catch (err) {
      set({ error: extractError(err), isAiRunning: false, successMessage: null });
    }
  },

  aiChat: async (question: string, context?: string) => {
    // Prevent concurrent chat calls that would corrupt history
    if (get().isAiRunning) return;
    set({ isAiRunning: true, error: null });
    const prevHistory = get().aiChatHistory;
    // Optimistically add user question
    set({ aiChatHistory: [...prevHistory, { role: 'user', content: question }] });
    try {
      const result = await subventionsApi.aiChat(question, context);
      set({
        aiChatHistory: [
          ...get().aiChatHistory,
          { role: 'assistant', content: result.response },
        ],
        isAiRunning: false,
      });
    } catch (err) {
      // Restore history on error
      set({
        aiChatHistory: prevHistory,
        error: extractError(err),
        isAiRunning: false,
        successMessage: null,
      });
    }
  },

  clearAiChat: () => {
    set({ aiChatHistory: [] });
  },

  aiChecklist: async (programmeId: number) => {
    set({ isAiRunning: true, error: null, aiChecklistResult: null });
    try {
      const result = await subventionsApi.aiGenerateChecklist(programmeId);
      set({ aiChecklistResult: result, isAiRunning: false });
    } catch (err) {
      set({ error: extractError(err), isAiRunning: false, successMessage: null });
    }
  },

  aiAnalyzeDemande: async (demandeId: number) => {
    set({ isAiRunning: true, error: null, aiAnalyzeDemandeResult: null });
    try {
      const result = await subventionsApi.aiAnalyzeDemande(demandeId);
      set({ aiAnalyzeDemandeResult: result, isAiRunning: false });
    } catch (err) {
      set({ error: extractError(err), isAiRunning: false, successMessage: null });
    }
  },

  aiAnalyzeEligibility: async (profile: AiAnalyzeEligibilityRequest) => {
    set({ isAiRunning: true, error: null, aiEligibilityResult: null });
    try {
      const result = await subventionsApi.aiAnalyzeEligibility(profile);
      set({ aiEligibilityResult: result, isAiRunning: false });
    } catch (err) {
      set({ error: extractError(err), isAiRunning: false, successMessage: null });
    }
  },

  clearAiResults: () => {
    set({
      aiSuggestResult: null,
      aiChecklistResult: null,
      aiAnalyzeDemandeResult: null,
      aiEligibilityResult: null,
    });
  },

  clearError: () => set({ error: null }),
  clearSuccess: () => set({ successMessage: null }),
}));
