/**
 * ERP React Frontend - Auth Zustand Store
 * Multi-tenant authentication:
 *   Step 1: Tenant login (email + password → tenant context)
 *   Step 2: User login (username + password → JWT)
 *   Alternative: Super-admin login (session)
 */

import { create } from 'zustand';
import type { ErpUser, TenantInfo } from '@/types';
import * as authApi from '@/api/auth';
import { useCalculatorsStore } from '@/store/useCalculatorsStore';

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

interface AuthState {
  user: ErpUser | null;
  tenant: TenantInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  loginStep: 'tenant' | 'user' | 'done';

  // Actions
  loginTenant: (email: string, password: string) => Promise<void>;
  loginUser: (username: string, password: string) => Promise<void>;
  loginSuperAdmin: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  resetLoginStep: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  tenant: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  loginStep: 'tenant',

  // ------- Step 1: Tenant Login -------
  loginTenant: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await authApi.tenantLogin(email, password);
      set({
        tenant: {
          entrepriseId: res.entrepriseId,
          entrepriseNom: res.entrepriseNom,
          schemaName: res.schemaName,
        },
        loginStep: 'user',
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: extractError(err),
      });
    }
  },

  // ------- Step 2: User Login (JWT) -------
  loginUser: async (username, password) => {
    const { tenant } = get();
    if (!tenant) {
      set({ error: 'Veuillez d\'abord selectionner une entreprise' });
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const res = await authApi.userLogin(username, password, tenant.entrepriseId);
      set({
        user: {
          userType: res.user.userType as 'user',
          userId: res.user.userId,
          email: res.user.email,
          displayName: res.user.displayName,
          schemaName: res.user.schemaName,
          role: res.user.role,
        },
        isAuthenticated: true,
        loginStep: 'done',
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: extractError(err),
      });
    }
  },

  // ------- Super-Admin Login (session) -------
  loginSuperAdmin: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await authApi.superAdminLogin(username, password);
      set({
        user: {
          userType: 'super_admin',
          userId: res.user.userId,
          email: res.user.email,
          displayName: res.user.displayName,
          role: 'super_admin',
        },
        tenant: null,
        isAuthenticated: true,
        loginStep: 'done',
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: extractError(err),
      });
    }
  },

  // ------- Logout -------
  logout: async () => {
    await authApi.logout();
    set({
      user: null,
      tenant: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      loginStep: 'tenant',
    });
    // Reset module stores to prevent data leakage across tenants
    try {
      useCalculatorsStore.getState().reset();
    } catch (exc) {
      // Best-effort: do not block logout if a module store reset fails
      console.warn('calculators reset on logout failed:', exc);
    }
    // Reset the metre-pdf store so the next user doesn't inherit the previous
    // user's PDF buffer / measurements / layers / calibration / project name.
    // `closeMetreProject()` calls setDocument(null) (full wipe) AND resets
    // currentMetreProject/lastSyncAt/uploadError — without it the next tenant
    // would briefly see the previous tenant's métré name in MetreSavedBar.
    // Dynamic import keeps the metre-pdf async chunk out of the initial bundle.
    try {
      const mod = await import('../components/metre-pdf/store');
      mod.useMetreStore.getState().closeMetreProject();
    } catch (exc) {
      console.warn('metre-pdf reset on logout failed:', exc);
    }
  },

  // ------- Check Auth on Mount -------
  checkAuth: async () => {
    // Skip if already authenticated (just logged in)
    if (get().isAuthenticated && get().user) {
      return;
    }
    if (!authApi.hasStoredAuth()) {
      // Restore tenant info if present
      const storedTenant = authApi.getStoredTenant();
      set({
        user: null,
        tenant: storedTenant,
        isAuthenticated: false,
        isLoading: false,
        loginStep: storedTenant ? 'user' : 'tenant',
      });
      return;
    }
    set({ isLoading: true });
    try {
      const me = await authApi.getMe();
      const storedTenant = authApi.getStoredTenant();
      set({
        user: {
          userType: me.userType as ErpUser['userType'],
          userId: me.userId,
          email: me.email,
          displayName: me.displayName,
          schemaName: me.schemaName,
          role: me.role,
        },
        tenant: storedTenant,
        isAuthenticated: true,
        loginStep: 'done',
        isLoading: false,
      });
    } catch {
      authApi.clearStoredAuth();
      set({
        user: null,
        tenant: null,
        isAuthenticated: false,
        isLoading: false,
        loginStep: 'tenant',
      });
    }
  },

  clearError: () => set({ error: null }),
  resetLoginStep: () => set({ loginStep: 'tenant', tenant: null, error: null }),
}));
