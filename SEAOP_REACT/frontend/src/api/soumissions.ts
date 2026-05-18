/**
 * SEAOP React Frontend - Soumissions API
 * CRUD operations for soumissions (bids) on leads.
 */

import api from './client';
import type { Soumission, SoumissionCreate } from '@/types';

export async function createSoumission(data: SoumissionCreate): Promise<Soumission> {
  const { data: result } = await api.post('/soumissions', data);
  return result;
}

export async function getSoumissionsForLead(leadId: number): Promise<Soumission[]> {
  const { data } = await api.get(`/soumissions/lead/${leadId}`);
  return data;
}

export async function getMySoumissions(): Promise<Soumission[]> {
  const { data } = await api.get('/soumissions/mes-soumissions');
  return data;
}

export async function getSoumission(id: number): Promise<Soumission> {
  const { data } = await api.get(`/soumissions/${id}`);
  return data;
}

export async function updateSoumissionStatus(id: number, statut: string): Promise<Soumission> {
  const { data } = await api.put(`/soumissions/${id}/statut`, { statut });
  return data;
}

export async function awardSoumission(id: number): Promise<Soumission> {
  const { data } = await api.post<Soumission>(`/soumissions/${id}/attribuer`);
  return data;
}
