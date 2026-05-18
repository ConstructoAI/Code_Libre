/**
 * ERP React Frontend - Messaging API Module
 * Channels (Teams-like) + Direct Messages + Notifications
 */

import api from './client';

// ============ Channels ============

export interface Channel {
  id: number;
  name: string;
  description?: string;
  channelType: string;
  isActive: boolean;
  isPrivate?: boolean;
  createdAt?: string;
  memberCount: number;
  messageCount: number;
}

export interface ChannelMessage {
  id: number;
  channelId: number;
  userId: number;
  messageText: string;
  parentMessageId?: number;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt?: string;
  editedAt?: string;
  username?: string;
  userName?: string;
  reactions?: { emoji: string; count: number; mine?: boolean }[];
}

export async function listChannels(): Promise<{ items: Channel[] }> {
  const { data } = await api.get('/channels');
  return data;
}

export async function createChannel(body: {
  name: string; description?: string; type?: string; isPrivate?: boolean;
}): Promise<{ id: number }> {
  const { data } = await api.post('/channels', body);
  return data;
}

export async function getChannelMessages(
  channelId: number, page = 1, perPage = 50
): Promise<{ items: ChannelMessage[]; channelId: number }> {
  const { data } = await api.get(`/channels/${channelId}/messages`, {
    params: { page, perPage },
  });
  return data;
}

export async function postChannelMessage(
  channelId: number, messageText: string, parentMessageId?: number
): Promise<{ id: number }> {
  const { data } = await api.post(`/channels/${channelId}/messages`, {
    messageText, parentMessageId,
  });
  return data;
}

export async function toggleReaction(
  channelId: number, messageId: number, emoji: string
): Promise<{ action: string }> {
  const { data } = await api.post(
    `/channels/${channelId}/messages/${messageId}/reactions`,
    { emoji },
  );
  return data;
}

// ============ Direct Messages ============

export interface DirectMessage {
  id: number;
  senderId: number;
  receiverId: number;
  subject?: string;
  message: string;
  isRead: boolean;
  parentId?: number;
  senderEntrepriseId?: string;
  receiverEntrepriseId?: string;
  createdAt?: string;
}

export async function listDirectMessages(page = 1, perPage = 20): Promise<{
  items: DirectMessage[]; unreadCount: number;
}> {
  const { data } = await api.get('/direct-messages', { params: { page, perPage } });
  return data;
}

export async function sendDirectMessage(body: {
  recipientUserId?: number; recipientEntrepriseId?: string;
  subject?: string; message: string; parentId?: number;
}): Promise<{ id: number }> {
  const { data } = await api.post('/direct-messages', body);
  return data;
}

export async function markMessageRead(id: number): Promise<void> {
  await api.put(`/direct-messages/${id}/read`);
}

// ============ Notifications ============

export interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  link?: string;
  createdAt?: string;
}

export async function listNotifications(unreadOnly = false, limit = 20): Promise<{
  items: Notification[]; unreadCount: number;
}> {
  const { data } = await api.get('/notifications', { params: { unreadOnly, limit } });
  return data;
}

export async function markNotificationRead(id: number): Promise<void> {
  await api.put(`/notifications/${id}/read`);
}

export async function getNotificationCount(): Promise<{ count: number }> {
  const { data } = await api.get('/notifications/count');
  return data;
}
