/**
 * Mobile React Frontend - Punch/Time Tracking Zustand Store
 */

import { create } from 'zustand';
import type { PunchStatus, TimeEntry, WeeklySummary, WorkOrder } from '@/types';
import * as punchApi from '@/api/punch';

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

interface PunchState {
  status: PunchStatus | null;
  workOrders: WorkOrder[];
  history: TimeEntry[];
  weeklySummary: WeeklySummary | null;
  isLoading: boolean;
  error: string | null;

  fetchStatus: () => Promise<void>;
  fetchWorkOrders: () => Promise<void>;
  fetchHistory: (limit?: number) => Promise<void>;
  fetchWeeklySummary: (weekOffset?: number) => Promise<void>;
  punchIn: (formulaireBtId: number, notes?: string, operationId?: number) => Promise<void>;
  punchOut: (notes?: string) => Promise<TimeEntry | null>;
  approveEntry: (timeEntryId: number) => Promise<void>;
  submitSignatureExterne: (timeEntryId: number, signatureBase64: string, signataireNom: string) => Promise<boolean>;
  updateEntry: (entryId: number, notes: string) => Promise<void>;
  deleteEntry: (entryId: number) => Promise<void>;
  clearError: () => void;
}

export const usePunchStore = create<PunchState>((set) => ({
  status: null,
  workOrders: [],
  history: [],
  weeklySummary: null,
  isLoading: false,
  error: null,

  fetchStatus: async () => {
    set({ error: null });
    try {
      const status = await punchApi.getPunchStatus();
      set({ status });
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  fetchWorkOrders: async () => {
    set({ error: null });
    try {
      const workOrders = await punchApi.getWorkOrders();
      set({ workOrders });
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  fetchHistory: async (limit = 50) => {
    set({ isLoading: true });
    try {
      const history = await punchApi.getHistory(limit);
      set({ history, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  fetchWeeklySummary: async (weekOffset = 0) => {
    set({ isLoading: true });
    try {
      const weeklySummary = await punchApi.getWeeklySummary(weekOffset);
      set({ weeklySummary, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  punchIn: async (formulaireBtId, notes, operationId) => {
    set({ isLoading: true, error: null });
    try {
      let latitude: number | undefined;
      let longitude: number | undefined;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 }),
        );
        latitude = pos.coords.latitude;
        longitude = pos.coords.longitude;
      } catch {
        // Geolocation not available, proceed without
      }
      await punchApi.punchIn({ formulaireBtId, operationId, notes, latitude, longitude });
      const status = await punchApi.getPunchStatus();
      set({ status, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  punchOut: async (notes) => {
    set({ isLoading: true, error: null });
    try {
      let latitude: number | undefined;
      let longitude: number | undefined;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 }),
        );
        latitude = pos.coords.latitude;
        longitude = pos.coords.longitude;
      } catch {
        // Geolocation not available
      }
      const entry = await punchApi.punchOut({ notes, latitude, longitude });
      const status = await punchApi.getPunchStatus();
      set({ status, isLoading: false });
      return entry;
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      return null;
    }
  },

  approveEntry: async (timeEntryId) => {
    set({ error: null });
    try {
      await punchApi.approveTimeEntry(timeEntryId);
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  submitSignatureExterne: async (timeEntryId, signatureBase64, signataireNom) => {
    set({ error: null });
    try {
      await punchApi.submitSignatureExterne(timeEntryId, {
        signature_base64: signatureBase64,
        signataire_nom: signataireNom,
      });
      // Refresh status. Note : meme si ce refresh echoue, l'etat du store est
      // deja coherent (le punchOut precedent a deja set isPunchedIn=false et
      // activeEntry=null). Le refresh n'est qu'un confort UI pour synchroniser
      // avec d'autres devices eventuels.
      try {
        const status = await punchApi.getPunchStatus();
        set({ status });
      } catch (refreshErr) {
        // Defense en profondeur : si le refresh echoue, forcer l'etat "non
        // punche" car la signature implique necessairement un punch out reussi
        // (on ne peut pas signer un entry sans qu'il existe avec punch_out NOT NULL).
        // Evite tout risque d'UI bloquee en "En service" si refresh KO.
        // eslint-disable-next-line no-console
        console.warn('[submitSignatureExterne] refresh status failed, forcing local consistent state', refreshErr);
        set({ status: { isPunchedIn: false, activeEntry: null, elapsedMinutes: null } });
      }
      return true;
    } catch (err) {
      set({ error: extractError(err) });
      return false;
    }
  },

  updateEntry: async (entryId, notes) => {
    set({ error: null });
    try {
      await punchApi.updateTimeEntry(entryId, { notes });
      const history = await punchApi.getHistory();
      set({ history });
    } catch (err) {
      set({ error: extractError(err) });
      throw err;
    }
  },

  deleteEntry: async (entryId) => {
    set({ error: null });
    try {
      await punchApi.deleteTimeEntry(entryId);
      const history = await punchApi.getHistory();
      set({ history });
    } catch (err) {
      set({ error: extractError(err) });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
