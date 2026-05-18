/**
 * SEAOP React Frontend - Axios API Client
 * JWT interceptor + snake_case/camelCase transforms.
 * Based on METRE_PDF pattern, adapted for SEAOP dual-auth (JWT + session).
 */

import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '';
const API_PREFIX = '/api/seaop/v1';

export const TOKEN_KEY = 'seaop_token';
export const SESSION_KEY = 'seaop_session';

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

/** Convert a camelCase object to snake_case (exported for manual use) */
export function toSnakeCase(data: unknown): unknown {
  return transformKeys(data, camelToSnake);
}

/** Convert a snake_case object to camelCase (exported for manual use) */
export function toCamelCase(data: unknown): unknown {
  return transformKeys(data, snakeToCamel);
}

// ============ Axios instance ============

const api = axios.create({
  baseURL: `${API_BASE}${API_PREFIX}`,
  headers: { 'Content-Type': 'application/json' },
});

// ============ Request interceptor ============
// Attaches auth headers + transforms request body to snake_case

api.interceptors.request.use((config) => {
  // JWT token (entrepreneur auth)
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Session token (client / admin auth)
  const session =
    localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
  if (session) {
    config.headers['X-Session-Token'] = session;
  }

  // FormData: remove Content-Type so the browser sets multipart/form-data
  // with its own boundary string. The axios instance default is
  // "application/json", which would otherwise override the browser's
  // auto-generated multipart header and make the server fail to parse the
  // body (or axios refuse to send at all on some builds).
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
// Transforms response data to camelCase + handles 401

api.interceptors.response.use(
  (response) => {
    if (response.data) {
      response.data = transformKeys(response.data, snakeToCamel);
    }
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      // Don't redirect here - let the auth store handle navigation
    }
    return Promise.reject(error);
  },
);

export default api;
