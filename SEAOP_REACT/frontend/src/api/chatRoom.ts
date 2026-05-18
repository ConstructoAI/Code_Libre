/**
 * SEAOP React Frontend - Chat Room API
 * Public chat room messaging, likes, pins, and online presence.
 */

import api from './client';
import type { ChatMessage, OnlineUser } from '@/types';

export async function getMessages(
  params: { pinned?: boolean; limit?: number; offset?: number } = {},
): Promise<ChatMessage[]> {
  const { data } = await api.get('/chat-room/messages', { params });
  return data;
}

export async function postMessage(message: string, parentId?: number): Promise<ChatMessage> {
  const { data } = await api.post('/chat-room/messages', { message, parentId });
  return data;
}

export async function editMessage(id: number, message: string): Promise<ChatMessage> {
  const { data } = await api.put(`/chat-room/messages/${id}`, { message });
  return data;
}

export async function deleteMessage(id: number): Promise<void> {
  await api.delete(`/chat-room/messages/${id}`);
}

export async function toggleLike(id: number): Promise<{ liked: boolean }> {
  const { data } = await api.post(`/chat-room/messages/${id}/like`);
  return data;
}

export async function togglePin(id: number): Promise<{ pinned: boolean }> {
  const { data } = await api.put(`/chat-room/messages/${id}/pin`);
  return data;
}

export async function getOnlineUsers(): Promise<OnlineUser[]> {
  const { data } = await api.get('/chat-room/online');
  return data;
}

export async function sendHeartbeat(isTyping = false): Promise<void> {
  await api.post('/chat-room/heartbeat', { isTyping });
}

export async function getStats(): Promise<{ totalMessages: number; totalParticipants: number }> {
  const { data } = await api.get('/chat-room/stats');
  return data;
}
