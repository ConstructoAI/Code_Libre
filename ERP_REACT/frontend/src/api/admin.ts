/**
 * ERP React Frontend - Admin API Module
 */

import api from './client';
import type { EntrepriseAdmin } from '@/types';

export type { EntrepriseAdmin };

export async function listEntreprises(): Promise<{ items: EntrepriseAdmin[]; total: number }> {
  const { data } = await api.get('/admin/entreprises');
  return data;
}

export async function toggleEntreprise(id: number, active: boolean): Promise<void> {
  await api.put(`/admin/entreprises/${id}/toggle`, { active });
}

export async function getAdminStats(): Promise<{
  totalEntreprises: number;
  activeEntreprises: number;
  inactiveEntreprises: number;
}> {
  const { data } = await api.get('/admin/stats');
  return data;
}

// ============ Broadcast / Updates ============

export async function listUpdates(): Promise<{
  items: Array<{
    id: number;
    message: string;
    type: string;
    createdAt: string | null;
    isActive: boolean;
  }>;
}> {
  const { data } = await api.get('/admin/updates');
  return data;
}

export async function createUpdate(data: {
  titre?: string;
  message: string;
  type?: string;
}): Promise<{ id: number }> {
  const result = await api.post('/admin/updates', {
    message: data.message,
    updateType: data.type || 'feature',
  });
  return result.data;
}

// ============ Representants ============

export interface Representant {
  id: number;
  nom: string;
  email?: string;
  telephone?: string;
  actif: boolean;
  createdAt?: string;
}

export async function listRepresentants(): Promise<{ items: Representant[] }> {
  const { data } = await api.get('/admin/representants');
  return data;
}

export async function createRepresentant(body: { nom: string; email?: string; telephone?: string }): Promise<{ id: number }> {
  const { data } = await api.post('/admin/representants', body);
  return data;
}

export async function updateRepresentant(id: number, body: Partial<Representant>): Promise<void> {
  await api.put(`/admin/representants/${id}`, body);
}

export async function deleteRepresentant(id: number): Promise<void> {
  await api.delete(`/admin/representants/${id}`);
}

export async function assignRepresentant(entrepriseId: number, representant: string | null): Promise<void> {
  await api.put(`/admin/entreprises/${entrepriseId}/representant`, { representant });
}

// ============ Finances ============

export interface FinancesData {
  month: number;
  year: number;
  erpMonthlyPrice: number;
  totalEntreprises: number;
  subscriptionRevenue: number;
  subscriptionCount: number;
  aiRevenue: number;
  totalRevenue: number;
  commissionsTotal: number;
  renderCost: number;
  anthropicCost: number;
  totalExpenses: number;
  profitBeforeTax: number;
  taxRate: number;
  estimatedTax: number;
  profitAfterTax: number;
  subscriptionsDetail: {
    nom: string;
    email?: string;
    planType: string;
    priceMonthly: number;
    representant: string;
    commission: number;
    net: number;
    createdAt?: string;
  }[];
  commissionsByRep: {
    representant: string;
    clients: number;
    revenue: number;
    commission: number;
    rate: number;
  }[];
}

export async function getFinances(month?: number, year?: number): Promise<FinancesData> {
  const { data } = await api.get('/admin/finances', { params: { month, year } });
  return data;
}
