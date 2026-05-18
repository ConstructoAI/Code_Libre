/**
 * B2B Client Portal - Auth Store (Zustand)
 * Manages B2B client authentication state.
 */

import { create } from 'zustand';
import {
  B2bClientUser, B2bTenantInfo, B2B_TOKEN_KEY, B2B_TENANT_KEY,
  b2bTenantLookup, b2bClientLogin, b2bGetMe, hasStoredB2bAuth, clearStoredB2bAuth,
} from '@/api/b2b-portal-auth';

function extractError(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Erreur inconnue';
}

interface B2bAuthState {
  clientUser: B2bClientUser | null;
  tenant: B2bTenantInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  loginStep: 'tenant' | 'credentials';

  lookupTenant: (email: string) => Promise<void>;
  loginClient: (email: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  resetLoginStep: () => void;
}

export const useB2bAuthStore = create<B2bAuthState>((set, get) => ({
  clientUser: null,
  tenant: null,
  isAuthenticated: false,
  isLoading: hasStoredB2bAuth(),
  error: null,
  loginStep: 'tenant',

  lookupTenant: async (email: string) => {
    set({ isLoading: true, error: null });
    try {
      const info = await b2bTenantLookup(email);
      localStorage.setItem(B2B_TENANT_KEY, JSON.stringify(info));
      set({ tenant: info, loginStep: 'credentials', isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  loginClient: async (email: string, password: string) => {
    const { tenant } = get();
    if (!tenant) {
      set({ error: 'Identifiez l\'entreprise d\'abord' });
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const res = await b2bClientLogin(email, password, tenant.schemaName);
      localStorage.setItem(B2B_TOKEN_KEY, res.accessToken);
      set({ clientUser: res.user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  logout: () => {
    clearStoredB2bAuth();
    set({
      clientUser: null, tenant: null, isAuthenticated: false,
      loginStep: 'tenant', error: null,
    });
  },

  checkAuth: async () => {
    if (!hasStoredB2bAuth()) return;
    set({ isLoading: true });
    try {
      const tenantRaw = localStorage.getItem(B2B_TENANT_KEY);
      const tenant = tenantRaw ? JSON.parse(tenantRaw) : null;
      const user = await b2bGetMe();
      set({ clientUser: user, tenant, isAuthenticated: true, isLoading: false });
    } catch {
      clearStoredB2bAuth();
      set({ clientUser: null, isAuthenticated: false, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
  resetLoginStep: () => set({ loginStep: 'tenant', tenant: null, error: null }),
}));
