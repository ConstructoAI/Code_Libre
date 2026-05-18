/**
 * Mobile React Frontend - Messaging API
 * Channels, direct messages, reactions.
 */

import api from './client';
import type {
  Channel,
  ChannelMessage,
  ChannelMember,
  DirectMessage,
  ConversationSummary,
  UnreadCount,
  EmployeeInfo,
} from '@/types';

// ============ Channels ============

export async function getChannels(): Promise<Channel[]> {
  const { data } = await api.get<Channel[]>('/channels');
  return data;
}

export async function createChannel(body: {
  name: string;
  description?: string;
  channelType?: string;
  icon?: string;
  isPrivate?: boolean;
  memberIds?: number[];
}): Promise<Channel> {
  const { data } = await api.post<Channel>('/channels', body);
  return data;
}

export async function getChannelMessages(
  channelId: number,
  limit = 50,
  offset = 0,
): Promise<ChannelMessage[]> {
  const { data } = await api.get<ChannelMessage[]>(
    `/channels/${channelId}/messages`,
    { params: { limit, offset } },
  );
  return data;
}

export async function sendChannelMessage(
  channelId: number,
  messageText: string,
  parentMessageId?: number,
): Promise<ChannelMessage> {
  const { data } = await api.post<ChannelMessage>(
    `/channels/${channelId}/messages`,
    { messageText, parentMessageId },
  );
  return data;
}

export async function getChannelMembers(
  channelId: number,
): Promise<ChannelMember[]> {
  const { data } = await api.get<ChannelMember[]>(
    `/channels/${channelId}/members`,
  );
  return data;
}

export async function getMessageThread(
  messageId: number,
): Promise<ChannelMessage[]> {
  const { data } = await api.get<ChannelMessage[]>(
    `/messages/${messageId}/thread`,
  );
  return data;
}

export async function toggleReaction(
  messageId: number,
  emoji: string,
): Promise<void> {
  await api.post(`/messages/${messageId}/reactions`, { emoji });
}

// ============ Direct Messages ============

export async function getDmConversations(): Promise<ConversationSummary[]> {
  const { data } = await api.get<ConversationSummary[]>('/dm/conversations');
  return data;
}

export async function getDmConversation(
  conversationId: string,
): Promise<DirectMessage[]> {
  const { data } = await api.get<DirectMessage[]>(
    `/dm/conversation/${conversationId}`,
  );
  return data;
}

export async function sendDirectMessage(body: {
  recipientEmployeeId?: number;
  recipientType?: string;
  subject?: string;
  message: string;
  messageType?: string;
  conversationId?: string;
  parentMessageId?: number;
}): Promise<DirectMessage> {
  const { data } = await api.post<DirectMessage>('/dm/send', body);
  return data;
}

export async function markDmRead(messageId: number): Promise<void> {
  await api.post(`/dm/${messageId}/read`);
}

export async function getDmEmployees(): Promise<EmployeeInfo[]> {
  const { data } = await api.get<EmployeeInfo[]>('/dm/employees');
  return data;
}

// ============ Unread Counts ============

export async function getUnreadCounts(): Promise<UnreadCount> {
  const { data } = await api.get<UnreadCount>('/messaging/unread');
  return data;
}
