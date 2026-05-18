/**
 * SEAOP React Frontend - Message Zustand Store
 * Manages conversations and messages state.
 */

import { create } from 'zustand';
import type { Message, ConversationSummary } from '@/types';
import * as messagesApi from '@/api/messages';

// ============ Helpers ============

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

// ============ State Interface ============

interface MessageState {
  conversations: ConversationSummary[];
  currentMessages: Message[];
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  error: string | null;

  fetchConversations: () => Promise<void>;
  fetchConversation: (leadId: number, entrepreneurId: number) => Promise<void>;
  sendMessage: (leadId: number, entrepreneurId: number, message: string) => Promise<void>;
  clearError: () => void;
}

// ============ Store ============

export const useMessageStore = create<MessageState>((set) => ({
  conversations: [],
  currentMessages: [],
  isLoadingConversations: false,
  isLoadingMessages: false,
  error: null,

  // ------- Fetch all conversations -------
  fetchConversations: async () => {
    set({ isLoadingConversations: true, error: null });
    try {
      const data = await messagesApi.getConversations();
      set({ conversations: data, isLoadingConversations: false });
    } catch (err) {
      set({ isLoadingConversations: false, error: extractError(err) });
    }
  },

  // ------- Fetch a specific conversation thread -------
  fetchConversation: async (leadId: number, entrepreneurId: number) => {
    set({ isLoadingMessages: true, error: null });
    try {
      const data = await messagesApi.getConversation(leadId, entrepreneurId);
      // Mark as read after fetching
      await messagesApi.markRead(leadId, entrepreneurId).catch(() => {
        /* silently ignore mark-read failures */
      });
      set({ currentMessages: data, isLoadingMessages: false });
    } catch (err) {
      set({ isLoadingMessages: false, error: extractError(err) });
    }
  },

  // ------- Send a new message -------
  sendMessage: async (leadId: number, entrepreneurId: number, message: string) => {
    set({ error: null });
    try {
      const newMsg = await messagesApi.sendMessage({ leadId, entrepreneurId, message });
      set((state) => ({
        currentMessages: [...state.currentMessages, newMsg],
        // Update last message in conversation list
        conversations: state.conversations.map((c) =>
          c.leadId === leadId && c.entrepreneurId === entrepreneurId
            ? { ...c, lastMessage: message, lastMessageDate: newMsg.dateEnvoi }
            : c,
        ),
      }));
    } catch (err) {
      set({ error: extractError(err) });
      throw err;
    }
  },

  // ------- Clear Error -------
  clearError: () => set({ error: null }),
}));

// Reset per-user data on logout (event from useAuthStore).
if (typeof window !== 'undefined') {
  window.addEventListener('seaop:logout', () => {
    useMessageStore.setState({
      conversations: [],
      currentMessages: [],
      error: null,
    });
  });
}
