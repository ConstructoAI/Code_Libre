/**
 * Mobile React Frontend - Crew Zustand Store
 */

import { create } from 'zustand';
import type { CrewProject } from '@/types';
import * as crewApi from '@/api/crew';

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

interface CrewState {
  projects: CrewProject[];
  isLoading: boolean;
  error: string | null;
  fetchCrew: () => Promise<void>;
  clearError: () => void;
}

export const useCrewStore = create<CrewState>((set) => ({
  projects: [],
  isLoading: false,
  error: null,

  fetchCrew: async () => {
    set({ isLoading: true, error: null });
    try {
      const projects = await crewApi.getCrew();
      set({ projects, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  clearError: () => set({ error: null }),
}));
