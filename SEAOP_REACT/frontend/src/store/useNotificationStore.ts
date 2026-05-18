/**
 * SEAOP React Frontend - Notification Zustand Store
 * Manages notification list and unread count.
 */

import { create } from 'zustand';
import type { Notification } from '@/types';
import * as notifApi from '@/api/notifications';

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;

  fetchNotifications: () => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  error: null,

  fetchNotifications: async () => {
    set({ isLoading: true, error: null });
    try {
      const notifications = await notifApi.getNotifications();
      set({ notifications, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des notifications';
      set({ error: message, isLoading: false });
    }
  },

  fetchUnreadCount: async () => {
    try {
      const unreadCount = await notifApi.getUnreadCount();
      set({ unreadCount });
    } catch {
      // Silently fail for background polling
    }
  },

  markRead: async (id: number) => {
    try {
      await notifApi.markRead(id);
      const { notifications, unreadCount } = get();
      set({
        notifications: notifications.map((n) =>
          n.id === id ? { ...n, lu: true } : n,
        ),
        unreadCount: Math.max(0, unreadCount - 1),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du marquage';
      set({ error: message });
    }
  },

  markAllRead: async () => {
    try {
      await notifApi.markAllRead();
      const { notifications } = get();
      set({
        notifications: notifications.map((n) => ({ ...n, lu: true })),
        unreadCount: 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du marquage';
      set({ error: message });
    }
  },
}));

// Reset per-user notifications on logout (event from useAuthStore).
if (typeof window !== 'undefined') {
  window.addEventListener('seaop:logout', () => {
    useNotificationStore.setState({
      notifications: [],
      unreadCount: 0,
      error: null,
    });
  });
}
