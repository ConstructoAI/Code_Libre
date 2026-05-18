/**
 * B2B Client Portal - Auth API module
 * Separate Axios instance with B2B token management.
 * 401 redirects to /b2b-portal/login (not /login).
 */

import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '';
const API_PREFIX = '/api/erp/v1';
export const B2B_TOKEN_KEY = 'b2b_token';
export const B2B_TENANT_KEY = 'b2b_tenant';

// snake_case <-> camelCase helpers (duplicated to avoid circular dep with client.ts)
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}
function transformKeys(data: unknown, fn: (s: string) => string): unknown {
  if (Array.isArray(data)) return data.map((d) => transformKeys(d, fn));
  if (data !== null && typeof data === 'object' && !(data instanceof Date) && !(data instanceof File) && !(data instanceof Blob)) {
    return Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([k, v]) => [fn(k), transformKeys(v, fn)]));
  }
  return data;
}

// Separate Axios instance for B2B portal
const b2bApi = axios.create({
  baseURL: `${API_BASE}${API_PREFIX}`,
  headers: { 'Content-Type': 'application/json' },
});

b2bApi.interceptors.request.use((config) => {
  const token = localStorage.getItem(B2B_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.data && !(config.data instanceof FormData)) {
    config.data = transformKeys(config.data, camelToSnake);
  }
  if (config.params && typeof config.params === 'object') {
    config.params = transformKeys(config.params, camelToSnake);
  }
  return config;
});

b2bApi.interceptors.response.use(
  (response) => {
    // Skip the snake→camel transform for binary responses (Blob, ArrayBuffer)
    // to prevent silent corruption if a future B2B route uses responseType.
    // Same pattern as api/client.ts.
    if (
      response.data &&
      !(response.data instanceof Blob) &&
      !(response.data instanceof ArrayBuffer)
    ) {
      response.data = transformKeys(response.data, snakeToCamel);
    }
    return response;
  },
  async (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(B2B_TOKEN_KEY);
      localStorage.removeItem(B2B_TENANT_KEY);
      window.location.href = '/b2b-portal/login';
    }

    // Unwrap Blob errors — cf. api/client.ts pour l'explication complète.
    if (error.response?.data instanceof Blob) {
      try {
        const txt = await error.response.data.text();
        const trimmed = txt.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            error.response.data = JSON.parse(txt);
          } catch {
            error.response.data = { detail: trimmed.slice(0, 500) };
          }
        } else {
          error.response.data = { detail: trimmed.slice(0, 500) || 'Erreur serveur' };
        }
      } catch {
        error.response.data = { detail: 'Erreur serveur (réponse binaire non lisible)' };
      }
    }

    const detail = error.response?.data?.detail;
    if (detail && typeof detail !== 'string') {
      error.response.data.detail = Array.isArray(detail)
        ? detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join(', ')
        : JSON.stringify(detail);
    }
    return Promise.reject(error);
  },
);

// ============ Types ============

export interface B2bTenantInfo {
  entrepriseId: number;
  entrepriseNom: string;
  schemaName: string;
}

export interface B2bClientUser {
  userType: 'b2b_client';
  userId: number;
  clientId: number;
  email: string;
  displayName: string;
  companyNom: string;
  schemaName: string;
  role: 'b2b_client';
}

// ============ API Functions ============

export async function b2bTenantLookup(email: string): Promise<B2bTenantInfo> {
  const { data } = await b2bApi.post('/auth/b2b-tenant-lookup', { email });
  return data;
}

export async function b2bClientLogin(
  email: string, password: string, schemaName: string,
): Promise<{ accessToken: string; user: B2bClientUser }> {
  const { data } = await b2bApi.post('/auth/b2b-client-login', { email, password, schemaName });
  return data;
}

export interface B2bClientRegisterPayload {
  schemaName: string;
  email: string;
  password: string;
  nom: string;
  companyNom: string;
  telephone?: string;
  adresse?: string;
  ville?: string;
  province?: string;
  codePostal?: string;
}

export interface B2bClientRegisterResponse {
  success: boolean;
  message: string;
  userId: number;
  clientId: number;
  pendingApproval: boolean;
}

export async function b2bClientRegister(
  payload: B2bClientRegisterPayload,
): Promise<B2bClientRegisterResponse> {
  const { data } = await b2bApi.post('/auth/b2b-client-register', payload);
  return data;
}

export async function b2bGetMe(): Promise<B2bClientUser> {
  const { data } = await b2bApi.get('/auth/b2b-me');
  return data;
}

export function hasStoredB2bAuth(): boolean {
  return !!localStorage.getItem(B2B_TOKEN_KEY);
}

export function clearStoredB2bAuth(): void {
  localStorage.removeItem(B2B_TOKEN_KEY);
  localStorage.removeItem(B2B_TENANT_KEY);
}

export { b2bApi };
