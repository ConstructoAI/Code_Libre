/**
 * ERP React Frontend - Emails Zustand Store (Multi-Account IMAP/SMTP/OAuth)
 *
 * Port de la version Streamlit modules/email_manager. Multi-comptes par
 * tenant, sync IMAP, OAuth Gmail/M365, templates HTML, signatures.
 * Pas d'IA (decision utilisateur).
 */

import { create } from 'zustand';
import * as emailsApi from '@/api/emails';
import type {
  EmailAccount, EmailMessage, EmailTemplate, FolderStats,
  EmailProvider, AccountTestResult, AccountCreatePayload,
  AccountUpdatePayload, SyncMode, SyncLogEntry,
} from '@/api/emails';

export type EmailFolder = 'inbox' | 'sent' | 'drafts' | 'trash';

interface EmailsState {
  // Accounts (multi-comptes)
  accounts: EmailAccount[];
  selectedAccountId: number | null;

  // Providers (Gmail, Outlook, etc.)
  providers: EmailProvider[];

  // Messages
  messages: EmailMessage[];
  selectedMessage: EmailMessage | null;
  totalMessages: number;
  currentPage: number;

  // Folder
  currentFolder: EmailFolder;
  folderStats: Record<string, FolderStats>;

  // Search
  searchQuery: string;

  // Templates
  templates: EmailTemplate[];

  // Sync
  syncHistory: SyncLogEntry[];
  isSyncing: boolean;

  // UI
  isLoading: boolean;
  error: string | null;
  successMessage: string | null;

  // Actions — Accounts
  fetchAccounts: () => Promise<void>;
  createAccount: (body: AccountCreatePayload) => Promise<{ id: number }>;
  updateAccount: (id: number, body: AccountUpdatePayload) => Promise<void>;
  deleteAccount: (id: number) => Promise<void>;
  testAccount: (id: number) => Promise<AccountTestResult>;
  restoreLegacyAccounts: () => Promise<{ restored: number }>;
  setSelectedAccount: (id: number | null) => void;

  // Actions — Providers + OAuth
  fetchProviders: () => Promise<void>;
  startOauth: (provider: 'google' | 'microsoft') => Promise<string>;

  // Actions — Messages
  fetchMessages: (page?: number) => Promise<void>;
  selectMessage: (id: number) => Promise<void>;
  clearSelectedMessage: () => void;
  markAsRead: (id: number) => Promise<void>;
  toggleStar: (id: number) => Promise<void>;
  sendEmail: (
    data: Parameters<typeof emailsApi.sendEmail>[0],
  ) => Promise<{ smtpSent: boolean; message: string }>;
  deleteMessage: (id: number) => Promise<void>;
  moveMessage: (id: number, folder: string) => Promise<void>;

  // Actions — Templates
  fetchTemplates: () => Promise<void>;

  // Actions — Folder & Search
  setFolder: (folder: EmailFolder) => void;
  setSearch: (query: string) => void;

  // Actions — Stats
  fetchStats: () => Promise<void>;

  // Actions — Sync
  syncAccount: (id: number, mode?: SyncMode) => Promise<void>;
  syncAllAccounts: (mode?: SyncMode) => Promise<void>;
  fetchSyncHistory: () => Promise<void>;

  clearError: () => void;
  clearSuccess: () => void;
}

function extractError(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: { detail?: string } } })
      .response;
    if (resp?.data?.detail) return resp.data.detail;
  }
  if (err instanceof Error) return err.message;
  return 'Erreur inconnue';
}

export const useEmailsStore = create<EmailsState>((set, get) => ({
  accounts: [],
  selectedAccountId: null,
  providers: [],
  messages: [],
  selectedMessage: null,
  totalMessages: 0,
  currentPage: 1,
  currentFolder: 'inbox',
  folderStats: {},
  searchQuery: '',
  templates: [],
  syncHistory: [],
  isSyncing: false,
  isLoading: false,
  error: null,
  successMessage: null,

  // ---- Accounts ----
  fetchAccounts: async () => {
    try {
      const res = await emailsApi.listAccounts();
      set({ accounts: res.items });
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  createAccount: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const res = await emailsApi.createAccount(body);
      set({ isLoading: false, successMessage: res.message });
      await get().fetchAccounts();
      return { id: res.id };
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  updateAccount: async (id, body) => {
    set({ isLoading: true, error: null });
    try {
      await emailsApi.updateAccount(id, body);
      set({ isLoading: false, successMessage: 'Compte mis a jour' });
      await get().fetchAccounts();
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  deleteAccount: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await emailsApi.deleteAccount(id);
      set({ isLoading: false, successMessage: 'Compte desactive' });
      await get().fetchAccounts();
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  testAccount: async (id) => {
    try {
      return await emailsApi.testAccount(id);
    } catch (err) {
      set({ error: extractError(err) });
      throw err;
    }
  },

  restoreLegacyAccounts: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await emailsApi.restoreLegacyAccounts();
      set({
        isLoading: false,
        successMessage: `${res.restored} compte(s) reactive(s)`,
      });
      await get().fetchAccounts();
      return { restored: res.restored };
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  setSelectedAccount: (id) => set({ selectedAccountId: id }),

  // ---- Providers + OAuth ----
  fetchProviders: async () => {
    try {
      const res = await emailsApi.listProviders();
      set({ providers: res.items });
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  startOauth: async (provider) => {
    try {
      const res = await emailsApi.getOauthAuthUrl(provider);
      return res.authUrl;
    } catch (err) {
      set({ error: extractError(err) });
      throw err;
    }
  },

  // ---- Messages ----
  fetchMessages: async (page) => {
    const { currentFolder, searchQuery } = get();
    const p = page ?? get().currentPage;
    set({ isLoading: true, error: null });
    try {
      const res = await emailsApi.listMessages({
        folder: currentFolder,
        search: searchQuery || undefined,
        page: p,
        perPage: 50,
      });
      set({
        messages: res.items,
        totalMessages: res.total,
        currentPage: res.page,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  selectMessage: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const email = await emailsApi.getMessage(id);
      set({ selectedMessage: email, isLoading: false });
      if (!email.isRead) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === id ? { ...m, isRead: true } : m,
          ),
        }));
        get().fetchStats();
      }
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  clearSelectedMessage: () => set({ selectedMessage: null }),

  markAsRead: async (id) => {
    try {
      await emailsApi.markAsRead(id);
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === id ? { ...m, isRead: true } : m,
        ),
        selectedMessage:
          s.selectedMessage?.id === id
            ? { ...s.selectedMessage, isRead: true }
            : s.selectedMessage,
      }));
      get().fetchStats();
    } catch {
      // Silent
    }
  },

  toggleStar: async (id) => {
    try {
      const res = await emailsApi.toggleStar(id);
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === id ? { ...m, isStarred: res.isStarred } : m,
        ),
        selectedMessage:
          s.selectedMessage?.id === id
            ? { ...s.selectedMessage, isStarred: res.isStarred }
            : s.selectedMessage,
      }));
    } catch {
      // Silent
    }
  },

  sendEmail: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const result = await emailsApi.sendEmail(data);
      if (result.smtpSent) {
        set({ isLoading: false, successMessage: result.message });
      } else {
        set({ isLoading: false, error: result.message });
      }
      if (
        get().currentFolder === 'sent'
        || get().currentFolder === 'drafts'
      ) {
        get().fetchMessages(1);
      }
      get().fetchStats();
      return { smtpSent: result.smtpSent, message: result.message };
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  deleteMessage: async (id) => {
    try {
      await emailsApi.deleteMessage(id);
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== id),
        selectedMessage:
          s.selectedMessage?.id === id ? null : s.selectedMessage,
        totalMessages: Math.max(0, s.totalMessages - 1),
      }));
      get().fetchStats();
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  moveMessage: async (id, folder) => {
    try {
      await emailsApi.moveMessage(id, folder);
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== id),
        selectedMessage:
          s.selectedMessage?.id === id ? null : s.selectedMessage,
        totalMessages: Math.max(0, s.totalMessages - 1),
      }));
      get().fetchStats();
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  // ---- Templates ----
  fetchTemplates: async () => {
    try {
      const res = await emailsApi.listTemplates();
      set({ templates: res.items });
    } catch {
      // Silent — templates are optional
    }
  },

  // ---- Folder & Search ----
  setFolder: (folder) => {
    set({ currentFolder: folder, currentPage: 1, selectedMessage: null });
    get().fetchMessages(1);
  },

  setSearch: (query) => {
    set({ searchQuery: query, currentPage: 1 });
    get().fetchMessages(1);
  },

  // ---- Stats ----
  fetchStats: async () => {
    try {
      const res = await emailsApi.getStats();
      set({ folderStats: res.folders });
    } catch {
      // Silent
    }
  },

  // ---- Sync ----
  syncAccount: async (id, mode = 'new') => {
    set({ isSyncing: true, error: null });
    try {
      const res = await emailsApi.syncAccount(id, mode);
      if (res.success) {
        set({
          isSyncing: false,
          successMessage:
            res.newEmails > 0
              ? `${res.newEmails} nouveau(x) email(s)`
              : 'Aucun nouvel email',
        });
      } else {
        set({
          isSyncing: false,
          error:
            res.errorMessage || 'Echec de la synchronisation',
        });
      }
      get().fetchMessages(1);
      get().fetchStats();
      get().fetchAccounts();
    } catch (err) {
      set({ isSyncing: false, error: extractError(err) });
      throw err;
    }
  },

  syncAllAccounts: async (mode = 'new') => {
    set({ isSyncing: true, error: null });
    try {
      const res = await emailsApi.syncAllAccounts(mode);
      const successMsg
        = `${res.successCount}/${res.totalAccounts} compte(s) synchronise(s)`
        + ` -- ${res.totalNewEmails} nouvel(s) email(s)`;
      set({ isSyncing: false, successMessage: successMsg });
      if (res.errors.length > 0) {
        set({
          error: res.errors
            .map((e) => `${e.account}: ${e.error}`)
            .join(' | '),
        });
      }
      get().fetchMessages(1);
      get().fetchStats();
      get().fetchAccounts();
    } catch (err) {
      set({ isSyncing: false, error: extractError(err) });
      throw err;
    }
  },

  fetchSyncHistory: async () => {
    try {
      const res = await emailsApi.listSyncHistory(50);
      set({ syncHistory: res.items });
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  clearError: () => set({ error: null }),
  clearSuccess: () => set({ successMessage: null }),
}));
