/**
 * ERP React Frontend - Messaging Zustand Store
 * Channels + Direct Messages + Notifications
 */

import { create } from 'zustand';
import * as messagingApi from '@/api/messaging';
import type {
  Channel, ChannelMessage, DirectMessage, Notification,
} from '@/api/messaging';

interface MessagingState {
  // Channels
  channels: Channel[];
  currentChannelId: number | null;
  channelMessages: ChannelMessage[];

  // Direct messages
  directMessages: DirectMessage[];
  unreadDmCount: number;

  // Notifications
  notifications: Notification[];
  unreadNotifCount: number;

  isLoading: boolean;
  error: string | null;

  // Channel actions
  fetchChannels: () => Promise<void>;
  createChannel: (data: {
    name: string; description?: string; type?: string; isPrivate?: boolean;
  }) => Promise<void>;
  selectChannel: (channelId: number) => Promise<void>;
  sendChannelMessage: (content: string, parentId?: number) => Promise<void>;
  toggleReaction: (messageId: number, emoji: string) => Promise<void>;

  // DM actions
  fetchDirectMessages: (page?: number) => Promise<void>;
  sendDirectMessage: (data: {
    recipientUserId?: number; recipientEntrepriseId?: string;
    subject?: string; message: string; parentId?: number;
  }) => Promise<void>;
  markDmRead: (id: number) => Promise<void>;

  // Notification actions
  fetchNotifications: (unreadOnly?: boolean) => Promise<void>;
  markNotifRead: (id: number) => Promise<void>;
  fetchNotifCount: () => Promise<void>;

  clearError: () => void;
}

export const useMessagingStore = create<MessagingState>((set, get) => ({
  channels: [],
  currentChannelId: null,
  channelMessages: [],
  directMessages: [],
  unreadDmCount: 0,
  notifications: [],
  unreadNotifCount: 0,
  isLoading: false,
  error: null,

  // ---- Channels ----
  fetchChannels: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await messagingApi.listChannels();
      set({ channels: res.items, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des canaux';
      set({ isLoading: false, error: message });
    }
  },

  createChannel: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await messagingApi.createChannel(data);
      const res = await messagingApi.listChannels();
      set({ channels: res.items, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création du canal';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  selectChannel: async (channelId) => {
    set({ currentChannelId: channelId, isLoading: true, error: null });
    try {
      const res = await messagingApi.getChannelMessages(channelId);
      set({ channelMessages: res.items, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des messages';
      set({ isLoading: false, error: message });
    }
  },

  sendChannelMessage: async (content, parentId) => {
    const { currentChannelId } = get();
    if (!currentChannelId) return;
    set({ isLoading: true, error: null });
    try {
      await messagingApi.postChannelMessage(currentChannelId, content, parentId);
      const res = await messagingApi.getChannelMessages(currentChannelId);
      set({ channelMessages: res.items, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'envoi du message';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  toggleReaction: async (messageId, emoji) => {
    const { currentChannelId } = get();
    if (!currentChannelId) return;
    try {
      await messagingApi.toggleReaction(currentChannelId, messageId, emoji);
      const res = await messagingApi.getChannelMessages(currentChannelId);
      set({ channelMessages: res.items });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la réaction';
      set({ error: message });
    }
  },

  // ---- Direct Messages ----
  fetchDirectMessages: async (page) => {
    set({ isLoading: true, error: null });
    try {
      const res = await messagingApi.listDirectMessages(page);
      set({ directMessages: res.items, unreadDmCount: res.unreadCount, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des messages directs';
      set({ isLoading: false, error: message });
    }
  },

  sendDirectMessage: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await messagingApi.sendDirectMessage(data);
      const res = await messagingApi.listDirectMessages();
      set({ directMessages: res.items, unreadDmCount: res.unreadCount, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'envoi du message';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  markDmRead: async (id) => {
    try {
      await messagingApi.markMessageRead(id);
      set((s) => ({
        directMessages: s.directMessages.map((dm) => (dm.id === id ? { ...dm, isRead: true } : dm)),
        unreadDmCount: Math.max(0, s.unreadDmCount - 1),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur';
      set({ error: message });
    }
  },

  // ---- Notifications ----
  fetchNotifications: async (unreadOnly) => {
    set({ isLoading: true, error: null });
    try {
      const res = await messagingApi.listNotifications(unreadOnly);
      set({ notifications: res.items, unreadNotifCount: res.unreadCount, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des notifications';
      set({ isLoading: false, error: message });
    }
  },

  markNotifRead: async (id) => {
    try {
      await messagingApi.markNotificationRead(id);
      set((s) => ({
        notifications: s.notifications.map((n) => (n.id === id ? { ...n, lue: true } : n)),
        unreadNotifCount: Math.max(0, s.unreadNotifCount - 1),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur';
      set({ error: message });
    }
  },

  fetchNotifCount: async () => {
    try {
      const res = await messagingApi.getNotificationCount();
      set({ unreadNotifCount: res.count });
    } catch {
      // Silent — notification badge is supplementary
    }
  },

  clearError: () => set({ error: null }),
}));
