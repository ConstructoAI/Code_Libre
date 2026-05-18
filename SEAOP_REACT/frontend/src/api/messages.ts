/**
 * SEAOP React Frontend - Messages API
 * Messaging between clients and entrepreneurs on leads.
 */

import api from './client';
import type { Message, ConversationSummary } from '@/types';

export async function sendMessage(data: {
  leadId: number;
  entrepreneurId: number;
  message: string;
}): Promise<Message> {
  const { data: result } = await api.post('/messages', data);
  return result;
}

export async function getConversations(): Promise<ConversationSummary[]> {
  const { data } = await api.get('/messages/conversations');
  return data;
}

export async function getConversation(
  leadId: number,
  entrepreneurId: number,
): Promise<Message[]> {
  const { data } = await api.get(`/messages/conversation/${leadId}/${entrepreneurId}`);
  return data;
}

export async function markRead(
  leadId: number,
  entrepreneurId: number,
): Promise<void> {
  await api.put(`/messages/mark-read/${leadId}/${entrepreneurId}`);
}
