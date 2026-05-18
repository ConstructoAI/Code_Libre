/**
 * Mobile React Frontend - Messages Zustand Store
 * Channels + Direct Messages
 */

import { create } from 'zustand';
import type {
  Channel,
  ChannelMessage,
  ConversationSummary,
  DirectMessage,
  UnreadCount,
  EmployeeInfo,
} from '@/types';
import * as msgApi from '@/api/messages';

function extractError(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    'response' in err &&
    typeof (err as Record<string, unknown>).response === 'object'
  ) {
    const resp = (err as { response: { data?: { detail?: string } } }).response;
    if (resp.data?.detail) return resp.data.detail;
  }
  if (err instanceof Error) return err.message;
  return 'Une erreur est survenue';
}

interface MessagesState {
  // Channels
  channels: Channel[];
  channelMessages: ChannelMessage[];
  // DM
  conversations: ConversationSummary[];
  dmMessages: DirectMessage[];
  dmEmployees: EmployeeInfo[];
  // Unread
  unread: UnreadCount;
  // UI
  isLoading: boolean;
  error: string | null;

  // Channel actions
  fetchChannels: () => Promise<void>;
  fetchChannelMessages: (channelId: number) => Promise<void>;
  sendChannelMessage: (channelId: number, text: string, parentId?: number) => Promise<void>;
  toggleReaction: (messageId: number, emoji: string) => Promise<void>;

  // DM actions
  fetchConversations: () => Promise<void>;
  fetchDmConversation: (conversationId: string) => Promise<void>;
  sendDm: (recipientEmployeeId: number, message: string, conversationId?: string) => Promise<void>;
  fetchDmEmployees: () => Promise<void>;
  markDmRead: (messageId: number) => Promise<void>;

  // Unread
  fetchUnread: () => Promise<void>;

  clearError: () => void;
}

export const useMessagesStore = create<MessagesState>((set) => ({
  channels: [],
  channelMessages: [],
  conversations: [],
  dmMessages: [],
  dmEmployees: [],
  unread: { conferenceUnread: 0, directUnread: 0, totalUnread: 0 },
  isLoading: false,
  error: null,

  fetchChannels: async () => {
    set({ isLoading: true, error: null });
    try {
      const channels = await msgApi.getChannels();
      set({ channels, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  fetchChannelMessages: async (channelId) => {
    set({ isLoading: true });
    try {
      const channelMessages = await msgApi.getChannelMessages(channelId);
      set({ channelMessages, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  sendChannelMessage: async (channelId, text, parentId) => {
    try {
      const msg = await msgApi.sendChannelMessage(channelId, text, parentId);
      set((s) => ({ channelMessages: [...s.channelMessages, msg] }));
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  toggleReaction: async (messageId, emoji) => {
    try {
      await msgApi.toggleReaction(messageId, emoji);
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  fetchConversations: async () => {
    set({ isLoading: true, error: null });
    try {
      const conversations = await msgApi.getDmConversations();
      set({ conversations, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  fetchDmConversation: async (conversationId) => {
    set({ isLoading: true });
    try {
      const dmMessages = await msgApi.getDmConversation(conversationId);
      set({ dmMessages, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  sendDm: async (recipientEmployeeId, message, conversationId) => {
    try {
      const msg = await msgApi.sendDirectMessage({
        recipientEmployeeId,
        recipientType: 'user',
        message,
        messageType: 'normal',
        conversationId,
      });
      set((s) => ({ dmMessages: [...s.dmMessages, msg] }));
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  fetchDmEmployees: async () => {
    try {
      const dmEmployees = await msgApi.getDmEmployees();
      set({ dmEmployees });
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  markDmRead: async (messageId) => {
    try {
      await msgApi.markDmRead(messageId);
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  fetchUnread: async () => {
    try {
      const unread = await msgApi.getUnreadCounts();
      set({ unread });
    } catch {
      // Silent fail for unread counts
    }
  },

  clearError: () => set({ error: null }),
}));
