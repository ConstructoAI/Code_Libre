/**
 * SEAOP React Frontend - Leads API Module
 * CRUD operations for leads (appels d'offres).
 */

import api from './client';
import { unwrap } from '@/utils/apiUnwrap';
import type { Lead, LeadCreate, LeadUpdate, LeadListResponse, Addendum, AddendumCreate } from '@/types';

// ============ Query Parameters ============

export interface LeadListParams {
  page?: number;
  perPage?: number;
  typeProjet?: string;
  recherche?: string;
  trierPar?: string;
  statut?: string;
  niveauUrgence?: string;
  region?: string;
}

// ============ Public / Entrepreneur Endpoints ============

/**
 * List leads with optional filtering and pagination.
 * Used by entrepreneurs to browse available leads.
 */
export async function listLeads(
  params: LeadListParams = {},
): Promise<LeadListResponse> {
  const { data } = await api.get<LeadListResponse>('/leads', { params });
  return data;
}

/**
 * Get a single lead by ID.
 */
export async function getLead(id: number): Promise<Lead> {
  const { data } = await api.get<Lead>(`/leads/${id}`);
  return data;
}

/**
 * Create a new lead (public endpoint - clients submit projects).
 */
export async function createLead(payload: LeadCreate): Promise<Lead> {
  const { data } = await api.post<Lead>('/leads', payload);
  return data;
}

/**
 * Update an existing lead (client or admin).
 */
export async function updateLead(
  id: number,
  payload: LeadUpdate,
): Promise<Lead> {
  const { data } = await api.put<Lead>(`/leads/${id}`, payload);
  return data;
}

// ============ Client-Specific Endpoints ============

/**
 * Get leads owned by the currently authenticated client.
 * Client must be authenticated via session token.
 */
export async function getMyLeads(): Promise<Lead[]> {
  const { data } = await api.get('/leads/mes-projets');
  // Backend returns `{items, total, email}`. `unwrap` also handles a future
  // `{data: {items, ...}}` envelope — strip `data` first, then read `items`.
  const body = unwrap<Record<string, unknown>>(data, {});
  if (Array.isArray(body)) return body as Lead[];
  const items = (body as { items?: unknown }).items;
  return Array.isArray(items) ? (items as Lead[]) : [];
}

// ============ Addenda Endpoints ============

/**
 * Get all addenda for a lead.
 */
export async function getAddenda(leadId: number): Promise<Addendum[]> {
  const { data } = await api.get<Addendum[]>(`/leads/${leadId}/addenda`);
  return data;
}

/**
 * Create a new addendum for a lead (client/admin only).
 */
export async function createAddendum(
  leadId: number,
  payload: AddendumCreate,
): Promise<Addendum> {
  const { data } = await api.post<Addendum>(`/leads/${leadId}/addenda`, payload);
  return data;
}

// ============ Admin Endpoints ============

// No DELETE endpoint in backend yet
// export async function deleteLead(id: number): Promise<void> {
//   await api.delete(`/leads/${id}`);
// }
