/**
 * Mobile React Frontend - Dossiers Zustand Store
 */

import { create } from 'zustand';
import type { DossierListItem, DossierDetail } from '@/types';
import * as dossiersApi from '@/api/dossiers';

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

interface DossiersState {
  dossiers: DossierListItem[];
  current: DossierDetail | null;
  isLoading: boolean;
  error: string | null;

  fetchDossiers: () => Promise<void>;
  fetchDetail: (dossierId: number) => Promise<void>;
  addNote: (dossierId: number, contenu: string, categorie?: string, photos?: File[]) => Promise<void>;
  updateEtape: (dossierId: number, etapeId: number, statut: string) => Promise<void>;
  clearError: () => void;
}

export const useDossiersStore = create<DossiersState>((set, get) => ({
  dossiers: [],
  current: null,
  isLoading: false,
  error: null,

  fetchDossiers: async () => {
    set({ isLoading: true, error: null });
    try {
      const dossiers = await dossiersApi.getDossiers();
      set({ dossiers, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  fetchDetail: async (dossierId) => {
    set({ isLoading: true, error: null });
    try {
      const current = await dossiersApi.getDossierDetail(dossierId);
      set({ current, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  addNote: async (dossierId, contenu, categorie, photos) => {
    set({ isLoading: true, error: null });
    try {
      await dossiersApi.addDossierNote(dossierId, contenu, categorie, photos);
      // Refresh detail
      const current = await dossiersApi.getDossierDetail(dossierId);
      set({ current, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  updateEtape: async (dossierId, etapeId, statut) => {
    try {
      await dossiersApi.updateEtapeStatus(dossierId, etapeId, statut);
      // Refresh
      const current = get().current;
      if (current && current.id === dossierId) {
        const updated = await dossiersApi.getDossierDetail(dossierId);
        set({ current: updated });
      }
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  clearError: () => set({ error: null }),
}));
