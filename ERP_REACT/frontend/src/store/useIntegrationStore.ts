/**
 * ERP React Frontend - Integration Store
 * Zustand store for QuickBooks & Sage 50 integration state.
 */

import { create } from 'zustand';
import * as integrationApi from '@/api/integration';
import type {
  IntegrationConnection,
  SyncLog,
  SyncStats,
  WebhookConfig,
  WebhookDelivery,
} from '@/api/integration';

// Lecon H6 S33: extraire les erreurs FastAPI/Pydantic (`detail` peut etre
// soit string, soit array d'objets {loc, msg, type} pour les 422 validation).
// Lecon QA1-R6 S33: ne JAMAIS stringify les objets non-{msg} ni le detail
// complet - risque de leaker stack traces, SQL queries, secrets internes
// si le backend renvoie un 500 avec details verbeux.
// Lecon QA2-R13 S33: messages en francais Quebec (app FR).
// Lecon QA2-R15 S33: extraire les cles connues msg/message/error/detail
// avant de tomber dans le generique.
function extractError(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: { detail?: unknown } } }).response;
    const detail = resp?.data?.detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail)) {
      const msgs = detail
        .map((d) => {
          if (d && typeof d === 'object' && 'msg' in d) {
            return String((d as { msg: unknown }).msg);
          }
          if (d && typeof d === 'object') return '[erreur de validation]';
          return String(d ?? '');
        })
        .filter(Boolean);
      if (msgs.length > 0) return msgs.join(' ; ');
    }
    if (detail && typeof detail === 'object') {
      // Lecon QA2-R15: tenter d'extraire des cles connues sans stringifier
      const obj = detail as Record<string, unknown>;
      for (const key of ['message', 'error', 'msg']) {
        const v = obj[key];
        if (typeof v === 'string' && v) return v;
      }
      return 'Erreur serveur (voir les logs).';
    }
  }
  if (err instanceof Error) return err.message;
  return 'Erreur inconnue';
}

interface IntegrationState {
  connections: IntegrationConnection[];
  syncLogs: SyncLog[];
  syncStats: SyncStats | null;
  webhooks: WebhookConfig[];
  // Lecon QA2-R14 S33: scope par webhook id (au lieu d'un array global)
  // pour eviter qu'un fetch concurrent sur webhook B ecrase les deliveries
  // de webhook A encore affichees a l'ecran.
  webhookDeliveriesByWebhookId: Record<number, WebhookDelivery[]>;
  isLoading: boolean;
  error: string | null;
  totalLogs: number;
  filters: { provider: string; status: string; entityType: string; page: number; perPage: number };

  fetchConnections: () => Promise<void>;
  createConnection: (data: { provider: string; name: string; config: Record<string, unknown> }) => Promise<void>;
  updateConnection: (id: number, data: { name?: string; status?: string; syncFrequency?: string; config?: Record<string, unknown> }) => Promise<void>;
  deleteConnection: (id: number) => Promise<void>;
  testConnection: (id: number) => Promise<{ success: boolean; message: string }>;
  triggerSync: (connectionId: number, options?: { direction?: 'export' | 'import'; entityType?: string }) => Promise<void>;
  fetchSyncHistory: () => Promise<void>;
  fetchSyncStats: () => Promise<void>;
  fetchWebhooks: () => Promise<void>;
  createWebhook: (data: { url: string; events?: string[]; secret?: string; description?: string }) => Promise<{ id: number; secret?: string; message: string } | null>;
  updateWebhook: (id: number, data: { url?: string; events?: string[]; secret?: string; description?: string; active?: boolean }) => Promise<void>;
  deleteWebhook: (id: number) => Promise<void>;
  testWebhook: (id: number) => Promise<{ success: boolean; statusCode?: number }>;
  fetchWebhookDeliveries: (webhookId: number) => Promise<void>;
  setFilter: (key: string, value: string | number) => void;
  clearError: () => void;
}

export const useIntegrationStore = create<IntegrationState>((set, get) => ({
  connections: [],
  syncLogs: [],
  syncStats: null,
  webhooks: [],
  webhookDeliveriesByWebhookId: {},
  isLoading: false,
  error: null,
  totalLogs: 0,
  filters: { provider: '', status: '', entityType: '', page: 1, perPage: 25 },

  fetchConnections: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await integrationApi.listConnections();
      set({ connections: res.items, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  createConnection: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await integrationApi.createConnection(data);
      await get().fetchConnections();
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  updateConnection: async (id, data) => {
    set({ error: null });
    try {
      await integrationApi.updateConnection(id, data);
      await get().fetchConnections();
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  deleteConnection: async (id) => {
    set({ error: null });
    try {
      await integrationApi.deleteConnection(id);
      set((s) => ({ connections: s.connections.filter((c) => c.id !== id) }));
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  testConnection: async (id) => {
    try {
      return await integrationApi.testConnection(id);
    } catch (err) {
      return { success: false, message: extractError(err) };
    }
  },

  triggerSync: async (connectionId, options) => {
    set({ isLoading: true, error: null });
    try {
      await integrationApi.triggerSync(connectionId, options);
      await get().fetchSyncHistory();
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  fetchSyncHistory: async () => {
    set({ isLoading: true, error: null });
    try {
      const { filters } = get();
      const res = await integrationApi.getSyncHistory(filters);
      set({ syncLogs: res.items, totalLogs: res.total, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  fetchSyncStats: async () => {
    try {
      const stats = await integrationApi.getSyncStats();
      set({ syncStats: stats });
    } catch {
      // silent — stats are non-critical
    }
  },

  fetchWebhooks: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await integrationApi.listWebhooks();
      set({ webhooks: res.items, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  createWebhook: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const wh = await integrationApi.createWebhook(data);
      await get().fetchWebhooks();
      set({ isLoading: false });
      return wh;
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      return null;
    }
  },

  updateWebhook: async (id, data) => {
    set({ error: null });
    try {
      await integrationApi.updateWebhook(id, data);
      await get().fetchWebhooks();
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  deleteWebhook: async (id) => {
    set({ error: null });
    try {
      await integrationApi.deleteWebhook(id);
      set((s) => ({ webhooks: s.webhooks.filter((w) => w.id !== id) }));
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  testWebhook: async (id) => {
    try {
      return await integrationApi.testWebhook(id);
    } catch {
      return { success: false, statusCode: 0 };
    }
  },

  fetchWebhookDeliveries: async (webhookId) => {
    // Lecon QA2-R14 S33: scope par webhook id. Pas de clear global - on
    // overwrite uniquement la cle webhookId pour ne pas affecter les autres.
    try {
      const deliveries = await integrationApi.getWebhookDeliveries(webhookId);
      set((s) => ({
        webhookDeliveriesByWebhookId: { ...s.webhookDeliveriesByWebhookId, [webhookId]: deliveries },
      }));
    } catch {
      set((s) => ({
        webhookDeliveriesByWebhookId: { ...s.webhookDeliveriesByWebhookId, [webhookId]: [] },
      }));
    }
  },

  setFilter: (key, value) => {
    set((s) => ({
      filters: {
        ...s.filters,
        [key]: value,
        page: key !== 'page' ? 1 : (typeof value === 'number' ? value : s.filters.page),
      },
    }));
  },

  clearError: () => set({ error: null }),
}));
