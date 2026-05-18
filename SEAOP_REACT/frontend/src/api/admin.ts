/**
 * SEAOP React Frontend - Admin API
 * Handles admin dashboard, entrepreneur management, soumissions overview,
 * and service request administration.
 */

import api from './client';
import { unwrap } from '@/utils/apiUnwrap';

/**
 * Fetch dashboard statistics (counts, revenue, top entrepreneurs).
 */
export async function getStats(): Promise<Record<string, unknown>> {
  const { data } = await api.get('/admin/stats');
  return unwrap<Record<string, unknown>>(data, {});
}

/**
 * Fetch all entrepreneurs, optionally filtered by status.
 */
export async function getEntrepreneurs(
  statut?: string,
): Promise<Record<string, unknown>[]> {
  const { data } = await api.get('/admin/entrepreneurs', {
    params: statut ? { statut } : {},
  });
  return unwrap<Record<string, unknown>[]>(data, []);
}

/**
 * Update an entrepreneur's record (status, credits, etc.).
 */
export async function updateEntrepreneur(
  id: number,
  updates: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data } = await api.put(`/admin/entrepreneurs/${id}`, updates);
  return data;
}

/**
 * Fetch all soumissions for the admin overview.
 */
export async function getSoumissions(): Promise<Record<string, unknown>[]> {
  const { data } = await api.get('/admin/soumissions');
  return unwrap<Record<string, unknown>[]>(data, []);
}

/**
 * Admin/Super-Admin verifies an entrepreneur's RBQ license.
 */
export async function verifyEntrepreneurRbq(entrepreneurId: number): Promise<void> {
  await api.put(`/admin/entrepreneurs/${entrepreneurId}/verify-rbq`);
}
