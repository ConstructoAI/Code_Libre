/**
 * SEAOP React Frontend - Auth API Module
 * Handles entrepreneur JWT login, client session login, admin session login,
 * registration, logout, and current-user fetch.
 */

import api, { TOKEN_KEY, SESSION_KEY } from './client';
import type {
  AuthResponse,
  EntrepreneurRegisterPayload,
  AdminLoginPayload,
  ClientLoginPayload,
  UserResponse,
  SuperAdminLoginResponse,
} from '@/types';

// ============ Entrepreneur Auth (JWT) ============

export async function loginEntrepreneur(
  email: string,
  motDePasse: string,
): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/entrepreneur/login', {
    email,
    motDePasse,
  });
  if (data.accessToken) {
    localStorage.setItem(TOKEN_KEY, data.accessToken);
  }
  return data;
}

export async function registerEntrepreneur(
  payload: EntrepreneurRegisterPayload,
): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>(
    '/auth/entrepreneur/register',
    payload,
  );
  if (data.accessToken) {
    localStorage.setItem(TOKEN_KEY, data.accessToken);
  }
  return data;
}

// ============ Client Auth (Session) ============

export async function loginClient(
  payload: ClientLoginPayload,
): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/client/login', payload);
  if (data.sessionToken) {
    localStorage.setItem(SESSION_KEY, data.sessionToken);
  }
  return data;
}

// ============ Admin Auth (Session) ============

export async function loginAdmin(
  payload: AdminLoginPayload,
): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/admin/login', payload);
  if (data.sessionToken) {
    // Admin sessions stored in sessionStorage (cleared on tab close)
    sessionStorage.setItem(SESSION_KEY, data.sessionToken);
  }
  return data;
}

// ============ Super-Admin Auth (Session) ============

export async function loginSuperAdmin(
  username: string,
  motDePasse: string,
): Promise<SuperAdminLoginResponse> {
  const { data } = await api.post<SuperAdminLoginResponse>('/auth/super-admin/login', {
    username,
    motDePasse,
  });
  if (data.sessionToken) {
    localStorage.setItem(SESSION_KEY, data.sessionToken);
  }
  return data;
}

// ============ Logout ============

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } catch {
    // Silently ignore server errors on logout
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

// ============ Current User ============

export async function getMe(): Promise<UserResponse> {
  const { data } = await api.get<UserResponse>('/auth/me');
  return data;
}

// ============ Token Helpers ============

/** Check if any auth token exists in storage */
export function hasStoredAuth(): boolean {
  return !!(
    localStorage.getItem(TOKEN_KEY) ||
    localStorage.getItem(SESSION_KEY) ||
    sessionStorage.getItem(SESSION_KEY)
  );
}

/** Clear all stored auth tokens */
export function clearStoredAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}
