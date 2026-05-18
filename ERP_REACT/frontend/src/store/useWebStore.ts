/**
 * ERP React Frontend - Web Zustand Store
 * Recherche web, analyse URL, historique.
 */

import { create } from 'zustand';
import * as webApi from '@/api/web';
import type { WebResult, SearchHistoryItem } from '@/api/web';

interface WebState {
  // Results
  searchResult: WebResult | null;
  fetchResult: WebResult | null;
  searchFetchResult: WebResult | null;

  // History
  searchHistory: SearchHistoryItem[];

  // UI
  isSearching: boolean;
  isFetching: boolean;
  isSearchFetching: boolean;
  error: string | null;

  // Actions
  webSearch: (data: Parameters<typeof webApi.webSearch>[0]) => Promise<void>;
  webFetch: (data: Parameters<typeof webApi.webFetch>[0]) => Promise<void>;
  webSearchFetch: (data: Parameters<typeof webApi.webSearchFetch>[0]) => Promise<void>;
  fetchHistory: (limit?: number) => Promise<void>;
  clearResult: (type: 'search' | 'fetch' | 'searchFetch') => void;
  clearError: () => void;
}

function extractError(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: { detail?: string } } }).response;
    if (resp?.data?.detail) return resp.data.detail;
  }
  if (err instanceof Error) return err.message;
  return 'Erreur inconnue';
}

export const useWebStore = create<WebState>((set) => ({
  searchResult: null,
  fetchResult: null,
  searchFetchResult: null,
  searchHistory: [],
  isSearching: false,
  isFetching: false,
  isSearchFetching: false,
  error: null,

  webSearch: async (data) => {
    set({ isSearching: true, error: null, searchResult: null });
    try {
      const result = await webApi.webSearch(data);
      set({ isSearching: false, searchResult: result });
    } catch (err) {
      set({ isSearching: false, error: extractError(err) });
    }
  },

  webFetch: async (data) => {
    set({ isFetching: true, error: null, fetchResult: null });
    try {
      const result = await webApi.webFetch(data);
      set({ isFetching: false, fetchResult: result });
    } catch (err) {
      set({ isFetching: false, error: extractError(err) });
    }
  },

  webSearchFetch: async (data) => {
    set({ isSearchFetching: true, error: null, searchFetchResult: null });
    try {
      const result = await webApi.webSearchFetch(data);
      set({ isSearchFetching: false, searchFetchResult: result });
    } catch (err) {
      set({ isSearchFetching: false, error: extractError(err) });
    }
  },

  fetchHistory: async (limit) => {
    try {
      const res = await webApi.getSearchHistory(limit);
      set({ searchHistory: res.items });
    } catch {
      // Silent — history is supplementary
    }
  },

  clearResult: (type) => {
    if (type === 'search') set({ searchResult: null });
    else if (type === 'fetch') set({ fetchResult: null });
    else set({ searchFetchResult: null });
  },

  clearError: () => set({ error: null }),
}));
