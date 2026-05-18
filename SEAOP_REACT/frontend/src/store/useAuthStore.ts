/**
 * SEAOP React Frontend - Auth Zustand Store
 * Manages authentication state for all 3 user types:
 *   - Entrepreneur (JWT)
 *   - Client (session)
 *   - Admin (session, sessionStorage)
 */

import { create } from 'zustand';
import type { SeaopUser, Entrepreneur, UserResponse, UserResponseWithProfile } from '@/types';
import * as authApi from '@/api/auth';

// ============ Helpers ============

/** Map the backend UserResponse to our slim SeaopUser shape.
 *  Handles both the old flat shape (id, nomEntreprise, etc.) and
 *  the new nested shape (userId, displayName) used by super-admin
 *  and upcoming client/admin responses.
 */
function toSeaopUser(u: UserResponse & { userId?: number; displayName?: string }): SeaopUser {
  return {
    userType: u.userType as SeaopUser['userType'],
    userId: u.userId ?? u.id,
    email: u.email,
    displayName: u.displayName ?? u.nomEntreprise ?? u.nomContact ?? u.nom ?? u.email,
  };
}

/** Map the backend UserResponse to the Entrepreneur profile (only for entrepreneurs) */
function toEntrepreneur(u: UserResponse): Entrepreneur | null {
  if (u.userType !== 'entrepreneur') return null;
  return {
    id: u.id,
    nomEntreprise: u.nomEntreprise ?? '',
    nomContact: u.nomContact ?? '',
    email: u.email,
    telephone: u.telephone ?? '',
    numeroRbq: u.numeroRbq ?? null,
    zonesDesservies: u.zonesDesservies ?? null,
    typesProjets: u.typesProjets ?? null,
    abonnement: u.abonnement ?? null,
    creditsRestants: u.creditsRestants ?? null,
    dateInscription: u.dateInscription ?? null,
    statut: u.statut ?? null,
    certifications: u.certifications ?? null,
    evaluationsMoyenne: u.evaluationsMoyenne ?? null,
    nombreEvaluations: u.nombreEvaluations ?? null,
  };
}

/** Extract an error message from an unknown caught value */
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

// ============ State Interface ============

interface AuthState {
  user: SeaopUser | null;
  entrepreneur: Entrepreneur | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  loginEntrepreneur: (email: string, password: string) => Promise<void>;
  registerEntrepreneur: (data: {
    nomEntreprise: string;
    nomContact: string;
    email: string;
    telephone: string;
    motDePasse: string;
    numeroRbq?: string;
    zonesDesservies?: string;
    typesProjets?: string;
    certifications?: string;
  }) => Promise<void>;
  loginClient: (email: string, numeroReference: string) => Promise<void>;
  loginAdmin: (username: string, password: string) => Promise<void>;
  loginSuperAdmin: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

// ============ Store ============

export const useAuthStore = create<AuthState>((set) => ({
  // Initial state
  user: null,
  entrepreneur: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  // ------- Entrepreneur Login (JWT) -------
  loginEntrepreneur: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await authApi.loginEntrepreneur(email, password);
      set({
        user: toSeaopUser(res.user),
        entrepreneur: toEntrepreneur(res.user),
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({
        user: null,
        entrepreneur: null,
        isAuthenticated: false,
        isLoading: false,
        error: extractError(err),
      });
    }
  },

  // ------- Entrepreneur Registration -------
  registerEntrepreneur: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await authApi.registerEntrepreneur(data);
      set({
        user: toSeaopUser(res.user),
        entrepreneur: toEntrepreneur(res.user),
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({
        user: null,
        entrepreneur: null,
        isAuthenticated: false,
        isLoading: false,
        error: extractError(err),
      });
    }
  },

  // ------- Client Login (session) -------
  loginClient: async (email, numeroReference) => {
    set({ isLoading: true, error: null });
    try {
      const res = await authApi.loginClient({ email, numeroReference });
      set({
        user: toSeaopUser(res.user),
        entrepreneur: null,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({
        user: null,
        entrepreneur: null,
        isAuthenticated: false,
        isLoading: false,
        error: extractError(err),
      });
    }
  },

  // ------- Admin Login (session, sessionStorage) -------
  loginAdmin: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await authApi.loginAdmin({ username, password });
      set({
        user: toSeaopUser(res.user),
        entrepreneur: null,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({
        user: null,
        entrepreneur: null,
        isAuthenticated: false,
        isLoading: false,
        error: extractError(err),
      });
    }
  },

  // ------- Super-Admin Login (session) -------
  loginSuperAdmin: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await authApi.loginSuperAdmin(username, password);
      set({
        user: {
          userType: res.user.userType as 'super_admin',
          userId: res.user.userId,
          email: res.user.email,
          displayName: res.user.displayName,
        },
        entrepreneur: null,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({
        user: null,
        entrepreneur: null,
        isAuthenticated: false,
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
      entrepreneur: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
    // Notify other stores so they can purge per-user data (leads, soumissions,
    // messages, notifications, chat). Each store listens for this event in its
    // module init code.
    try {
      window.dispatchEvent(new Event('seaop:logout'));
    } catch {
      // No-op (e.g. SSR/test environment without window)
    }
  },

  // ------- Check Auth on App Mount -------
  checkAuth: async () => {
    if (!authApi.hasStoredAuth()) {
      set({ user: null, entrepreneur: null, isAuthenticated: false });
      return;
    }
    set({ isLoading: true });
    try {
      const userResp = await authApi.getMe() as UserResponseWithProfile;
      const user = toSeaopUser(userResp);
      // If entrepreneur, extract nested profile for the full entrepreneur data
      const entrepreneur = userResp.profile
        ? toEntrepreneur(userResp.profile as unknown as UserResponse)
        : toEntrepreneur(userResp);
      set({
        user,
        entrepreneur,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      // Token invalid or expired - clear everything
      authApi.clearStoredAuth();
      set({
        user: null,
        entrepreneur: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  // ------- Clear Error -------
  clearError: () => set({ error: null }),
}));
