/**
 * Mobile React Frontend - Auth API Module
 * Mobile authentication: tenant login -> employee select -> PIN -> JWT
 */

import api, { TOKEN_KEY, TENANT_KEY, EMPLOYEE_KEY } from './client';
import type { TenantLoginResponse, PinLoginResponse, EmployeeInfo } from '@/types';

// ============ API Calls ============

export async function tenantLogin(
  email: string,
  password: string,
): Promise<TenantLoginResponse> {
  const { data } = await api.post<TenantLoginResponse>('/auth/tenant', {
    email,
    password,
  });
  localStorage.setItem(
    TENANT_KEY,
    JSON.stringify({
      tenantId: data.tenantId,
      tenantNom: data.tenantNom,
      schemaName: data.schemaName,
    }),
  );
  return data;
}

export async function pinLogin(
  tenantId: number,
  employeeId: number,
  pinCode: string,
): Promise<PinLoginResponse> {
  const { data } = await api.post<PinLoginResponse>('/auth/pin', {
    tenantId,
    employeeId,
    pinCode,
  });
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(EMPLOYEE_KEY, JSON.stringify(data.employee));
  return data;
}

// ============ Storage Helpers ============

export function clearStoredAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TENANT_KEY);
  localStorage.removeItem(EMPLOYEE_KEY);
}

export function hasStoredToken(): boolean {
  return !!localStorage.getItem(TOKEN_KEY);
}

export function getStoredTenant(): {
  tenantId: number;
  tenantNom: string;
  schemaName: string;
} | null {
  const raw = localStorage.getItem(TENANT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getStoredEmployee(): EmployeeInfo | null {
  const raw = localStorage.getItem(EMPLOYEE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
