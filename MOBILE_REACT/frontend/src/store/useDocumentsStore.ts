/**
 * Mobile React Frontend - Documents Zustand Store
 * State management for devis, factures, BT, BC.
 */

import { create } from 'zustand';
import type {
  DocType,
  AllDocumentsStats,
  DocumentStats,
  DocumentListItem,
  DocumentDetail,
  CompanyLookup,
  ProjectLookup,
} from '@/types';
import * as docsApi from '@/api/documents';

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

interface DocumentsState {
  allStats: AllDocumentsStats | null;
  typeStats: DocumentStats | null;
  documents: DocumentListItem[];
  current: DocumentDetail | null;
  companies: CompanyLookup[];
  projects: ProjectLookup[];
  isLoading: boolean;
  error: string | null;

  fetchAllStats: () => Promise<void>;
  fetchTypeStats: (docType: DocType) => Promise<void>;
  fetchDocuments: (docType: DocType, statut?: string) => Promise<void>;
  fetchDetail: (docType: DocType, docId: number) => Promise<void>;
  createDocument: (docType: DocType, payload: Record<string, unknown>) => Promise<{ id: number; numero: string } | null>;
  updateDocument: (docType: DocType, docId: number, payload: Record<string, unknown>) => Promise<boolean>;
  deleteDocument: (docType: DocType, docId: number) => Promise<boolean>;
  addLine: (docType: DocType, docId: number, payload: Record<string, unknown>) => Promise<boolean>;
  updateLine: (docType: DocType, docId: number, lineId: number, payload: Record<string, unknown>) => Promise<boolean>;
  deleteLine: (docType: DocType, docId: number, lineId: number) => Promise<boolean>;
  fetchLookups: () => Promise<void>;
  clearError: () => void;
  clearCurrent: () => void;
}

export const useDocumentsStore = create<DocumentsState>((set) => ({
  allStats: null,
  typeStats: null,
  documents: [],
  current: null,
  companies: [],
  projects: [],
  isLoading: false,
  error: null,

  fetchAllStats: async () => {
    set({ isLoading: true, error: null });
    try {
      const allStats = await docsApi.getAllStats();
      set({ allStats, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  fetchTypeStats: async (docType) => {
    try {
      const typeStats = await docsApi.getTypeStats(docType);
      set({ typeStats });
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  fetchDocuments: async (docType, statut) => {
    set({ isLoading: true, error: null });
    try {
      const documents = await docsApi.listDocuments(docType, { statut });
      set({ documents, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  fetchDetail: async (docType, docId) => {
    set({ isLoading: true, error: null });
    try {
      const current = await docsApi.getDocumentDetail(docType, docId);
      set({ current, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  createDocument: async (docType, payload) => {
    set({ isLoading: true, error: null });
    try {
      const result = await docsApi.createDocument(docType, payload);
      set({ isLoading: false });
      return result;
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      return null;
    }
  },

  updateDocument: async (docType, docId, payload) => {
    set({ isLoading: true, error: null });
    try {
      await docsApi.updateDocument(docType, docId, payload);
      set({ isLoading: false });
      return true;
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      return false;
    }
  },

  deleteDocument: async (docType, docId) => {
    set({ isLoading: true, error: null });
    try {
      await docsApi.deleteDocument(docType, docId);
      set({ isLoading: false });
      return true;
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      return false;
    }
  },

  addLine: async (docType, docId, payload) => {
    try {
      await docsApi.addLine(docType, docId, payload);
      const current = await docsApi.getDocumentDetail(docType, docId);
      set({ current });
      return true;
    } catch (err) {
      set({ error: extractError(err) });
      return false;
    }
  },

  updateLine: async (docType, docId, lineId, payload) => {
    try {
      await docsApi.updateLine(docType, docId, lineId, payload);
      const current = await docsApi.getDocumentDetail(docType, docId);
      set({ current });
      return true;
    } catch (err) {
      set({ error: extractError(err) });
      return false;
    }
  },

  deleteLine: async (docType, docId, lineId) => {
    try {
      await docsApi.deleteLine(docType, docId, lineId);
      const current = await docsApi.getDocumentDetail(docType, docId);
      set({ current });
      return true;
    } catch (err) {
      set({ error: extractError(err) });
      return false;
    }
  },

  fetchLookups: async () => {
    try {
      const [companies, projects] = await Promise.all([
        docsApi.getCompanies(),
        docsApi.getProjects(),
      ]);
      set({ companies, projects });
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  clearError: () => set({ error: null }),
  clearCurrent: () => set({ current: null }),
}));
