/**
 * ERP React Frontend - Configuration API Module
 */

import api from './client';

// ============ Types ============

/** Raw config row from API (JSONB blob). */
export interface ConfigEntryRaw {
  id: number;
  configData: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

/** Flattened key/value entry for the UI. */
export interface ConfigEntry {
  cle: string;
  valeur: string;
  categorie?: string;
  description?: string;
}

export interface TenantUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: string;
  isAdmin: boolean;
  active: boolean;
  employeeId?: number;
  preferencesJson?: Record<string, unknown>;
  lastLogin?: string;
  createdAt?: string;
}

export interface UserProfile {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: string;
  isAdmin: boolean;
  lastLogin?: string;
}

// ============ Entreprise Config ============

/** Convert camelCase key back to snake_case (undo Axios interceptor). */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

/**
 * Normalize legacy/variant config keys to the canonical company_* format.
 * Same logic as backend html_utils.py _KEY_VARIANTS but in reverse:
 * given a legacy key like "nom" or "telephone_bureau", return "company_name" or "company_phone".
 */
const _LEGACY_TO_CANONICAL: Record<string, string> = {
  // Legacy BD keys → canonical frontend keys
  nom: 'company_name', nom_entreprise: 'company_name',
  adresse: 'company_address',
  ville: 'company_city',
  province: 'company_province',
  code_postal: 'company_postal_code',
  telephone: 'company_phone', telephone_bureau: 'company_phone',
  email: 'company_email', courriel: 'company_email',
  site_web: 'company_website',
  rbq: 'company_rbq_number', numero_rbq: 'company_rbq_number',
  neq: 'company_neq', numero_neq: 'company_neq',
  tps: 'company_tps_number', numero_tps: 'company_tps_number',
  tvq: 'company_tvq_number', numero_tvq: 'company_tvq_number',
};

/**
 * Fetch entreprise config and flatten JSONB into key/value entries.
 * Normalizes all key formats (legacy, old mapping) to canonical company_* keys.
 */
export async function getEntrepriseConfig(): Promise<{ items: ConfigEntry[] }> {
  const { data } = await api.get('/config/entreprise');
  const merged: Record<string, string> = {};
  const rawItems: ConfigEntryRaw[] = data?.items || [];
  if (rawItems.length > 0 && rawItems[0].configData) {
    // config_data is TEXT on most tenants → Axios returns a JSON string, not an object
    let cfg = rawItems[0].configData;
    if (typeof cfg === 'string') {
      try { cfg = JSON.parse(cfg) as Record<string, unknown>; } catch { cfg = {}; }
    }
    for (const [k, v] of Object.entries(cfg)) {
      const snakeKey = camelToSnake(k);
      // Normalize to canonical key, or keep as-is if already canonical
      const canonical = _LEGACY_TO_CANONICAL[snakeKey] || snakeKey;
      const strVal = v != null ? String(v) : '';
      // First match wins (don't overwrite if canonical already set with a value)
      if (strVal && !merged[canonical]) {
        merged[canonical] = strVal;
      } else if (!merged[canonical]) {
        merged[canonical] = strVal;
      }
    }
  }
  const items: ConfigEntry[] = Object.entries(merged).map(([cle, valeur]) => ({ cle, valeur }));
  return { items };
}

/**
 * Update a single config field by key.
 * PUT /config/entreprise/{cle} with body {valeur: "..."}
 */
export async function updateEntrepriseConfig(
  cle: string,
  valeur: string,
): Promise<{ message: string }> {
  const { data } = await api.put(`/config/entreprise/${cle}`, { valeur });
  return data;
}

// ============ Users ============

export async function listUsers(): Promise<{ items: TenantUser[]; total: number }> {
  const { data } = await api.get('/config/users');
  return data;
}

export async function createUser(body: {
  username: string;
  password: string;
  email?: string;
  fullName?: string;
  role?: string;
  isAdmin?: boolean;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/config/users', body);
  return data;
}

export async function updateUser(
  id: number,
  body: {
    email?: string;
    fullName?: string;
    role?: string;
    isAdmin?: boolean;
    preferencesJson?: Record<string, unknown>;
  },
): Promise<{ message: string }> {
  const { data } = await api.put(`/config/users/${id}`, body);
  return data;
}

export async function changeUserPassword(
  id: number,
  newPassword: string,
): Promise<{ message: string }> {
  const { data } = await api.put(`/config/users/${id}/password`, { newPassword });
  return data;
}

export async function deactivateUser(id: number): Promise<{ message: string }> {
  const { data } = await api.delete(`/config/users/${id}`);
  return data;
}

// ============ Profile ============

export async function getProfile(): Promise<UserProfile> {
  const { data } = await api.get('/config/profile');
  return data;
}

export async function updateProfile(body: {
  fullName?: string;
  email?: string;
}): Promise<{ message: string }> {
  const { data } = await api.put('/config/profile', body);
  return data;
}

// ============================================
// DOCUMENT COLOR THEME
// ============================================
//
// Tenant-wide color palette applied to every HTML document generated by
// the backend (soumission, facture, bon de commande, bon de travail,
// client email). Stored in entreprise_config under `document_theme`.

export interface DocumentTheme {
  primary: string;       // Entête, bandeau titre doc, headers tableau
  primaryDark: string;   // Variante foncée (hover)
  accent: string;        // Sous-titres, bordure gauche info-box
  accentLight: string;   // Numéro doc sur entête
  headerText: string;    // Texte sur fond primary
  tableRowAlt: string;   // Alternance lignes tableau
  infoBg: string;        // Fond sections info et totaux
  border: string;        // Bordures fines
}

export interface DocumentThemeResponse {
  theme: DocumentTheme;
  defaults: DocumentTheme;
}

/** Fetch the tenant's document theme (merged with defaults). */
export async function getDocumentTheme(): Promise<DocumentThemeResponse> {
  const { data } = await api.get('/config/document-theme');
  return data as DocumentThemeResponse;
}

/**
 * Update one or more colors of the document theme. Missing keys keep
 * their current value server-side, so partial updates are safe.
 */
export async function updateDocumentTheme(
  theme: Partial<DocumentTheme>,
): Promise<{ message: string; theme: DocumentTheme }> {
  const { data } = await api.put('/config/document-theme', theme);
  return data as { message: string; theme: DocumentTheme };
}

/** Reset the document theme to defaults (admin). */
export async function resetDocumentTheme(): Promise<{ message: string; theme: DocumentTheme }> {
  const { data } = await api.delete('/config/document-theme');
  return data as { message: string; theme: DocumentTheme };
}

// ============================================
// WEBHOOKS
// ============================================

export const getWebhooks = () =>
  api.get('/config/webhooks');

export const createWebhook = (body: {
  url: string;
  events?: string[];
  secret?: string;
  description?: string;
}) => api.post('/config/webhooks', body);

export const updateWebhook = (
  webhookId: number,
  body: { url?: string; events?: string[]; secret?: string; description?: string; active?: boolean }
) => api.put(`/config/webhooks/${webhookId}`, body);

export const deleteWebhook = (webhookId: number) =>
  api.delete(`/config/webhooks/${webhookId}`);

export const testWebhook = (webhookId: number) =>
  api.post(`/config/webhooks/${webhookId}/test`);

export const getWebhookDeliveries = (webhookId: number, limit?: number) =>
  api.get(`/config/webhooks/${webhookId}/deliveries`, { params: { limit } });
