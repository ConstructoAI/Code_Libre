/**
 * ERP React Frontend - Axios API Client
 * JWT interceptor + snake_case/camelCase transforms.
 * Adapted from SEAOP_REACT pattern for ERP multi-tenant auth.
 */

import axios from 'axios';
import { useAuthStore } from '@/store/useAuthStore';

const API_BASE = import.meta.env.VITE_API_URL || '';
const API_PREFIX = '/api/erp/v1';

export const TOKEN_KEY = 'erp_token';
export const SESSION_KEY = 'erp_session';
export const TENANT_KEY = 'erp_tenant';

// ============ snake_case <-> camelCase helpers ============

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

function transformKeys(data: unknown, fn: (s: string) => string): unknown {
  if (Array.isArray(data)) {
    return data.map((d) => transformKeys(d, fn));
  }
  if (
    data !== null &&
    typeof data === 'object' &&
    !(data instanceof Date) &&
    !(data instanceof File) &&
    !(data instanceof Blob)
  ) {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([k, v]) => [
        fn(k),
        transformKeys(v, fn),
      ]),
    );
  }
  return data;
}

export function toSnakeCase(data: unknown): unknown {
  return transformKeys(data, camelToSnake);
}

export function toCamelCase(data: unknown): unknown {
  return transformKeys(data, snakeToCamel);
}

// ============ Axios instance ============

const api = axios.create({
  baseURL: `${API_BASE}${API_PREFIX}`,
  headers: { 'Content-Type': 'application/json' },
});

// ============ Request interceptor ============

api.interceptors.request.use((config) => {
  // JWT token (user auth)
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Session token (super-admin auth)
  const session =
    localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
  if (session) {
    config.headers['X-Session-Token'] = session;
  }

  // FormData: remove Content-Type so browser sets multipart/form-data with boundary
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  } else if (config.data) {
    // Transform request body to snake_case (skip FormData)
    config.data = transformKeys(config.data, camelToSnake);
  }

  // Transform query params to snake_case
  if (config.params && typeof config.params === 'object') {
    config.params = transformKeys(config.params, camelToSnake);
  }

  return config;
});

// ============ Response interceptor ============

api.interceptors.response.use(
  (response) => {
    // Skip the snake→camel transform for binary responses (Blob, ArrayBuffer).
    // Endpoints that return files — /preview, /download, /export — set
    // `responseType: 'blob'` in the request; running `transformKeys` on a
    // Blob corrupts the payload (it walks the object and tries to rewrite
    // keys on a non-plain object), which is what made the DocumentViewer
    // PDF preview fail with "Impossible de charger le document".
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
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }

    // Unwrap Blob errors: when a request uses `responseType: 'blob'` (file
    // exports, PDF previews, etc.) and the backend returns a JSON error,
    // axios delivers that error body as a Blob in error.response.data — so
    // `err.response.data.detail` would read undefined on a Blob. Read the
    // Blob once here and replace with the parsed JSON (or a `{ detail }`
    // wrapper for plain-text/HTML errors), so all catch handlers can use
    // the normal `err.response.data.detail` pattern regardless of whether
    // the original request was a JSON or a Blob one.
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
          // Plain text ou HTML (proxy, nginx, 502, etc.) — wrapper détail
          error.response.data = { detail: trimmed.slice(0, 500) || 'Erreur serveur' };
        }
      } catch {
        error.response.data = { detail: 'Erreur serveur (réponse binaire non lisible)' };
      }
    }

    // Normalize 422 Pydantic validation errors: detail array → string
    const detail = error.response?.data?.detail;
    if (detail && typeof detail !== 'string') {
      error.response.data.detail = Array.isArray(detail)
        ? detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ')
        : JSON.stringify(detail);
    }
    return Promise.reject(error);
  },
);

export default api;
