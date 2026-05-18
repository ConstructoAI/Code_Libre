/**
 * SEAOP React Frontend - Notifications API
 * CRUD operations for user notifications.
 */

import api from './client';
import { unwrap } from '@/utils/apiUnwrap';
import type { Notification } from '@/types';

export async function getNotifications(limit = 20, offset = 0): Promise<Notification[]> {
  const { data } = await api.get('/notifications', { params: { limit, offset } });
  // Backend returns a bare list; `unwrap` survives a future `{data: [...]}` envelope.
  return unwrap<Notification[]>(data, []);
}

export async function getUnreadCount(): Promise<number> {
  const { data } = await api.get('/notifications/count');
  // Backend returns `{nonLues: N}`. `unwrap` strips a future `{data: {...}}` envelope.
  const body = unwrap<Record<string, unknown>>(data, {});
  return Number((body.nonLues as number | undefined) ?? (body.count as number | undefined) ?? 0);
}

export async function markRead(id: number): Promise<void> {
  await api.put(`/notifications/${id}/read`);
}

export async function markAllRead(): Promise<void> {
  await api.put('/notifications/read-all');
}
