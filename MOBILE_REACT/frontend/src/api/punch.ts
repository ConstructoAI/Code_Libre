/**
 * Mobile React Frontend - Time Tracking API
 * Punch in/out, history, weekly summary.
 */

import api from './client';
import type { PunchStatus, TimeEntry, WeeklySummary, WorkOrder } from '@/types';

export async function getWorkOrders(): Promise<WorkOrder[]> {
  const { data } = await api.get<WorkOrder[]>('/work-orders');
  return data;
}

export async function getPunchStatus(): Promise<PunchStatus> {
  const { data } = await api.get<PunchStatus>('/punch/status');
  return data;
}

export async function punchIn(body: {
  formulaireBtId: number;
  operationId?: number;
  notes?: string;
  latitude?: number;
  longitude?: number;
}): Promise<TimeEntry> {
  const { data } = await api.post<TimeEntry>('/punch/in', body);
  return data;
}

export async function punchOut(body?: {
  notes?: string;
  latitude?: number;
  longitude?: number;
}): Promise<TimeEntry> {
  const { data } = await api.post<TimeEntry>('/punch/out', body || {});
  return data;
}

export async function getHistory(limit = 50): Promise<TimeEntry[]> {
  const { data } = await api.get<TimeEntry[]>('/history', {
    params: { limit },
  });
  return data;
}

export async function getWeeklySummary(weekOffset = 0): Promise<WeeklySummary> {
  const { data } = await api.get<WeeklySummary>('/weekly-summary', {
    params: { weekOffset },
  });
  return data;
}

export async function approveTimeEntry(timeEntryId: number): Promise<void> {
  await api.post(`/punch/${timeEntryId}/approve`);
}

export async function submitSignatureExterne(
  timeEntryId: number,
  body: { signature_base64: string; signataire_nom: string },
): Promise<{ success: boolean; message: string; time_entry_id: number }> {
  const { data } = await api.post(`/punch/${timeEntryId}/signature-externe`, body);
  return data;
}

export async function updateTimeEntry(entryId: number, body: { notes?: string }): Promise<{ message: string; id: number }> {
  const { data } = await api.put(`/time-entries/${entryId}`, body);
  return data;
}

export async function deleteTimeEntry(entryId: number): Promise<{ message: string }> {
  const { data } = await api.delete(`/time-entries/${entryId}`);
  return data;
}
