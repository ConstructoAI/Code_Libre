/**
 * ERP React Frontend - Documents (Dossiers) Zustand Store
 * Uses the api/documents module for all API calls.
 */

import { create } from 'zustand';
import {
  getDocuments,
  getDocument,
  createDocument,
  deleteDocument,
  type Document,
} from '@/api/documents';

export type { Document };

interface DocumentsState {
  items: Document[];
  current: Document | null;
  isLoading: boolean;
  error: string | null;
  filters: { search: string; categorie: string; referenceType: string; page: number; perPage: number };
  total: number;

  // Actions
  fetchAll: () => Promise<void>;
  fetchOne: (id: number) => Promise<void>;
  create: (body: { titre: string; typeDossier?: string; priorite?: string; projectId?: string; notes?: string }) => Promise<Document>;
  remove: (id: number) => Promise<void>;
  setFilter: (key: string, value: unknown) => void;
  clearError: () => void;
}

export const useDocumentsStore = create<DocumentsState>((set, get) => ({
  items: [],
  current: null,
  isLoading: false,
  error: null,
  filters: { search: '', categorie: '', referenceType: '', page: 1, perPage: 25 },
  total: 0,

  fetchAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const { filters } = get();
      const data = await getDocuments({ page: filters.page, perPage: filters.perPage, statut: filters.categorie || undefined });
      set({ items: data.items ?? [], total: data.total ?? 0, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des documents';
      set({ isLoading: false, error: message });
    }
  },

  fetchOne: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const doc = await getDocument(id);
      set({ current: doc, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement';
      set({ isLoading: false, error: message });
    }
  },

  create: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await createDocument(body);
      // Re-fetch to get the full document with server-generated fields
      const doc = await getDocument(result.id);
      set((s) => ({ items: [doc, ...s.items], total: s.total + 1, isLoading: false }));
      return doc;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  remove: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await deleteDocument(id);
      set((s) => ({
        items: s.items.filter((d) => d.id !== id),
        current: s.current?.id === id ? null : s.current,
        total: s.total - 1,
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la suppression';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  setFilter: (key, value) => {
    set((s) => ({ filters: { ...s.filters, [key]: value, page: key === 'page' ? (value as number) : 1 } }));
  },

  clearError: () => set({ error: null }),
}));
