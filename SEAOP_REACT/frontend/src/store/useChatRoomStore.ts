/**
 * SEAOP React Frontend - Chat Room Zustand Store
 * Manages chat messages, pinned messages, online users, and stats.
 */

import { create } from 'zustand';
import type { ChatMessage, OnlineUser } from '@/types';
import * as chatApi from '@/api/chatRoom';

interface ChatRoomState {
  messages: ChatMessage[];
  pinnedMessages: ChatMessage[];
  onlineUsers: OnlineUser[];
  stats: { totalMessages: number; totalParticipants: number };
  isLoading: boolean;
  error: string | null;

  fetchMessages: () => Promise<void>;
  fetchPinnedMessages: () => Promise<void>;
  fetchOnlineUsers: () => Promise<void>;
  fetchStats: () => Promise<void>;
  postMessage: (message: string, parentId?: number) => Promise<void>;
  toggleLike: (id: number) => Promise<void>;
  deleteMessage: (id: number) => Promise<void>;
}

export const useChatRoomStore = create<ChatRoomState>((set, get) => ({
  messages: [],
  pinnedMessages: [],
  onlineUsers: [],
  stats: { totalMessages: 0, totalParticipants: 0 },
  isLoading: false,
  error: null,

  fetchMessages: async () => {
    set({ isLoading: true, error: null });
    try {
      const messages = await chatApi.getMessages({ pinned: false, limit: 50 });
      set({ messages, isLoading: false });
    } catch {
      // Convert axios's "Request failed with status code 500" into a friendly message
      set({
        error: 'Impossible de charger la discussion pour le moment. Réessayez dans quelques instants.',
        isLoading: false,
      });
    }
  },

  fetchPinnedMessages: async () => {
    try {
      const pinnedMessages = await chatApi.getMessages({ pinned: true });
      set({ pinnedMessages });
    } catch {
      // Silently fail
    }
  },

  fetchOnlineUsers: async () => {
    try {
      const onlineUsers = await chatApi.getOnlineUsers();
      set({ onlineUsers });
    } catch {
      // Silently fail for background polling
    }
  },

  fetchStats: async () => {
    try {
      const stats = await chatApi.getStats();
      set({ stats });
    } catch {
      // Silently fail
    }
  },

  postMessage: async (message: string, parentId?: number) => {
    try {
      const newMsg = await chatApi.postMessage(message, parentId);
      const { messages } = get();
      set({ messages: [newMsg, ...messages] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de l\'envoi du message';
      set({ error: msg });
    }
  },

  toggleLike: async (id: number) => {
    try {
      const { liked } = await chatApi.toggleLike(id);
      const { messages, pinnedMessages } = get();
      const updateMsg = (m: ChatMessage): ChatMessage =>
        m.id === id
          ? { ...m, likedByMe: liked, likes: liked ? m.likes + 1 : Math.max(0, m.likes - 1) }
          : m;
      set({
        messages: messages.map(updateMsg),
        pinnedMessages: pinnedMessages.map(updateMsg),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors du like';
      set({ error: msg });
    }
  },

  deleteMessage: async (id: number) => {
    try {
      await chatApi.deleteMessage(id);
      const { messages, pinnedMessages } = get();
      set({
        messages: messages.filter((m) => m.id !== id),
        pinnedMessages: pinnedMessages.filter((m) => m.id !== id),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la suppression';
      set({ error: msg });
    }
  },
}));
