/**
 * ERP React Frontend - Auth API Module
 * Multi-tenant authentication: tenant login → user login → /me
 */

import api, { TOKEN_KEY, SESSION_KEY, TENANT_KEY } from './client';

// ============ Types ============

interface TenantLoginResponse {
  entrepriseId: number;
  entrepriseNom: string;
  schemaName: string;
}

interface AuthUser {
  userType: string;
  userId: number;
  email: string;
  displayName: string;
  schemaName?: string;
  role?: string;
}

interface UserLoginResponse {
  accessToken: string;
  tokenType: string;
  user: AuthUser;
}

interface SessionLoginResponse {
  sessionToken: string;
  user: AuthUser;
}

interface MeResponse extends AuthUser {
  entrepriseNom?: string;
}

// ============ API Calls ============

export async function tenantLogin(email: string, password: string): Promise<TenantLoginResponse> {
  const { data } = await api.post<TenantLoginResponse>('/auth/tenant-login', { email, password });
  // Store tenant info for step 2
  localStorage.setItem(TENANT_KEY, JSON.stringify({
    entrepriseId: data.entrepriseId,
    entrepriseNom: data.entrepriseNom,
    schemaName: data.schemaName,
  }));
  return data;
}

export async function userLogin(
  username: string,
  password: string,
  entrepriseId: number,
): Promise<UserLoginResponse> {
  const { data } = await api.post<UserLoginResponse>('/auth/user-login', {
    username,
    password,
    entrepriseId,
  });
  // Store JWT token
  localStorage.setItem(TOKEN_KEY, data.accessToken);
  return data;
}

export async function superAdminLogin(
  username: string,
  password: string,
): Promise<SessionLoginResponse> {
  const { data } = await api.post<SessionLoginResponse>('/auth/super-admin-login', {
    username,
    password,
  });
  // Store session token
  localStorage.setItem(SESSION_KEY, data.sessionToken);
  return data;
}

export async function getMe(): Promise<MeResponse> {
  const { data } = await api.get<MeResponse>('/auth/me');
  return data;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } catch {
    // Ignore errors on logout
  }
  clearStoredAuth();
}

export function clearStoredAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(TENANT_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

export function hasStoredAuth(): boolean {
  return !!(
    localStorage.getItem(TOKEN_KEY) ||
    localStorage.getItem(SESSION_KEY) ||
    sessionStorage.getItem(SESSION_KEY)
  );
}

export function getStoredTenant(): { entrepriseId: number; entrepriseNom: string; schemaName: string } | null {
  const raw = localStorage.getItem(TENANT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}


// ============ Public Representants ============

export async function fetchPublicRepresentants(): Promise<{ items: { id: number; nom: string }[] }> {
  const { data } = await api.get('/auth/representants');
  return data;
}

// ============ Registration ============

interface RegisterResponse {
  checkoutUrl: string;
  message: string;
}

export async function register(
  companyName: string,
  email: string,
  password: string,
  planType: string = 'pro',
  representant?: string,
): Promise<RegisterResponse> {
  const origin = window.location.origin;
  const { data } = await api.post<RegisterResponse>('/auth/register', {
    companyName,
    email,
    password,
    planType,
    representant: representant || undefined,
    successUrl: `${origin}/login?checkout=success`,
    cancelUrl: `${origin}/register?checkout=cancel`,
  });
  return data;
}
