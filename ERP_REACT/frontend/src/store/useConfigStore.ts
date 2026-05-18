/**
 * ERP React Frontend - Configuration Zustand Store
 */

import { create } from 'zustand';
import * as configApi from '@/api/config';
import type { ConfigEntry, TenantUser, UserProfile } from '@/api/config';

interface ConfigState {
  // Entreprise config
  configEntries: ConfigEntry[];

  // Users
  users: TenantUser[];
  usersTotal: number;

  // Profile
  profile: UserProfile | null;

  // UI state
  isLoading: boolean;
  error: string | null;
  successMessage: string | null;

  // Actions — Entreprise Config
  fetchConfig: () => Promise<void>;
  updateConfig: (cle: string, valeur: string) => Promise<void>;

  // Actions — Users
  fetchUsers: () => Promise<void>;
  createUser: (data: {
    username: string;
    password: string;
    email?: string;
    fullName?: string;
    role?: string;
    isAdmin?: boolean;
  }) => Promise<void>;
  updateUser: (id: number, data: {
    email?: string;
    fullName?: string;
    role?: string;
    isAdmin?: boolean;
  }) => Promise<void>;
  changeUserPassword: (id: number, newPassword: string) => Promise<void>;
  deactivateUser: (id: number) => Promise<void>;

  // Actions — Profile
  fetchProfile: () => Promise<void>;
  updateProfile: (data: { fullName?: string; email?: string }) => Promise<void>;
  changeOwnPassword: (newPassword: string) => Promise<void>;

  // Utility
  clearError: () => void;
  clearSuccess: () => void;
}

function extractError(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    'response' in err &&
    typeof (err as Record<string, unknown>).response === 'object'
  ) {
    const resp = (err as { response: { data?: { detail?: string } } }).response;
    if (resp?.data?.detail) return resp.data.detail;
  }
  if (err instanceof Error) return err.message;
  return 'Une erreur est survenue';
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  configEntries: [],
  users: [],
  usersTotal: 0,
  profile: null,
  isLoading: false,
  error: null,
  successMessage: null,

  // ---- Entreprise Config ----
  fetchConfig: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await configApi.getEntrepriseConfig();
      set({ configEntries: res.items, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  updateConfig: async (cle, valeur) => {
    set({ error: null, successMessage: null });
    try {
      await configApi.updateEntrepriseConfig(cle, valeur);
      // Update local state (add entry if new, update if existing)
      set((s) => {
        const exists = s.configEntries.some((e) => e.cle === cle);
        return {
          configEntries: exists
            ? s.configEntries.map((e) => (e.cle === cle ? { ...e, valeur } : e))
            : [...s.configEntries, { cle, valeur }],
          successMessage: 'Configuration mise à jour',
        };
      });
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  // ---- Users ----
  fetchUsers: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await configApi.listUsers();
      set({ users: res.items, usersTotal: res.total, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  createUser: async (data) => {
    set({ isLoading: true, error: null, successMessage: null });
    try {
      await configApi.createUser(data);
      set({ successMessage: 'Utilisateur créé avec succès', isLoading: false });
      get().fetchUsers();
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  updateUser: async (id, data) => {
    set({ isLoading: true, error: null, successMessage: null });
    try {
      await configApi.updateUser(id, data);
      set({ successMessage: 'Utilisateur mis à jour', isLoading: false });
      get().fetchUsers();
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
      throw err;
    }
  },

  changeUserPassword: async (id, newPassword) => {
    set({ error: null, successMessage: null });
    try {
      await configApi.changeUserPassword(id, newPassword);
      set({ successMessage: 'Mot de passe mis à jour' });
    } catch (err) {
      set({ error: extractError(err) });
      throw err;
    }
  },

  deactivateUser: async (id) => {
    set({ error: null, successMessage: null });
    try {
      await configApi.deactivateUser(id);
      set({ successMessage: 'Utilisateur désactivé' });
      get().fetchUsers();
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  // ---- Profile ----
  fetchProfile: async () => {
    set({ isLoading: true, error: null });
    try {
      const profile = await configApi.getProfile();
      set({ profile, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  updateProfile: async (data) => {
    set({ error: null, successMessage: null });
    try {
      await configApi.updateProfile(data);
      set({ successMessage: 'Profil mis à jour' });
      get().fetchProfile();
    } catch (err) {
      set({ error: extractError(err) });
      throw err;
    }
  },

  changeOwnPassword: async (newPassword) => {
    const { profile } = get();
    if (!profile) return;
    set({ error: null, successMessage: null });
    try {
      await configApi.changeUserPassword(profile.id, newPassword);
      set({ successMessage: 'Mot de passe mis à jour' });
    } catch (err) {
      set({ error: extractError(err) });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
  clearSuccess: () => set({ successMessage: null }),
}));
