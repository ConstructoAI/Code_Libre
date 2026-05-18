/**
 * ERP React Frontend - Dashboard API Module
 */

import api from './client';
import type { DashboardStats, DashboardAlert } from '@/types';

export type { DashboardStats, DashboardAlert };

export interface DashboardResponse {
  stats: DashboardStats;
  alerts: DashboardAlert[];
}

export async function getDashboard(): Promise<DashboardResponse> {
  const { data } = await api.get<DashboardResponse>('/dashboard');
  return data;
}

export async function getActivity(): Promise<{ items: unknown[] }> {
  const { data } = await api.get('/dashboard/activity');
  return data;
}

// ============ Dashboard V2 Endpoints ============

export async function getDashboardAlerts() { const { data } = await api.get('/dashboard/alerts'); return data; }
export async function getDashboardCharts() { const { data } = await api.get('/dashboard/charts'); return data; }
export async function getDashboardTopSuppliers() { const { data } = await api.get('/dashboard/top-suppliers'); return data; }
