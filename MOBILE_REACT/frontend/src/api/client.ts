/**
 * Mobile React Frontend - Axios API Client
 * JWT interceptor + snake_case/camelCase transforms.
 * Connects to Mobile backend at /api/mobile/v1.
 */

import axios from 'axios';
import { useAuthStore } from '@/store/useAuthStore';

const API_BASE = import.meta.env.VITE_API_URL || '';
const API_PREFIX = '/api/mobile/v1';

export const TOKEN_KEY = 'mobile_token';
export const TENANT_KEY = 'mobile_tenant';
export const EMPLOYEE_KEY = 'mobile_employee';

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
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Transform request body to snake_case (skip FormData)
  if (config.data && !(config.data instanceof FormData)) {
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
    if (response.data) {
      response.data = transformKeys(response.data, snakeToCamel);
    }
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default api;
