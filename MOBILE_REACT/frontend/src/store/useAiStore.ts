/**
 * Mobile React Frontend - AI Assistant Zustand Store
 */

import { create } from 'zustand';
import type {
  AiConversation,
  AiChatMessage,
  AiChatResponse,
  AiQuota,
  AiPendingAction,
} from '@/types';
import * as aiApi from '@/api/ai';

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

interface AiState {
  conversations: AiConversation[];
  currentConversationId: number | null;
  messages: AiChatMessage[];
  quota: AiQuota | null;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;

  fetchConversations: () => Promise<void>;
  fetchConversation: (conversationId: number) => Promise<void>;
  sendMessage: (
    message: string,
    images?: { data: string; mediaType: string }[],
  ) => Promise<AiChatResponse | null>;
  deleteConversation: (conversationId: number) => Promise<void>;
  newConversation: () => void;
  fetchQuota: () => Promise<void>;
  clearError: () => void;
  confirmPendingAction: (
    messageIndex: number,
    actionId: number,
  ) => Promise<void>;
  cancelPendingAction: (
    messageIndex: number,
    actionId: number,
  ) => Promise<void>;
}

function updatePendingAction(
  messages: AiChatMessage[],
  messageIndex: number,
  actionId: number,
  patch: Partial<AiPendingAction>,
): AiChatMessage[] {
  return messages.map((m, idx) => {
    if (idx !== messageIndex || !m.pendingActions) return m;
    return {
      ...m,
      pendingActions: m.pendingActions.map((pa) =>
        pa.id === actionId ? { ...pa, ...patch } : pa,
      ),
    };
  });
}

export const useAiStore = create<AiState>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
  quota: null,
  isLoading: false,
  isSending: false,
  error: null,

  fetchConversations: async () => {
    set({ isLoading: true, error: null });
    try {
      const conversations = await aiApi.getConversations();
      set({ conversations, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  fetchConversation: async (conversationId) => {
    set({ isLoading: true, messages: [], error: null });
    try {
      const detail = await aiApi.getConversationDetail(conversationId);
      set({
        currentConversationId: conversationId,
        messages: detail.messages,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  sendMessage: async (message, images) => {
    const { currentConversationId } = get();
    set((s) => ({
      isSending: true,
      error: null,
      messages: [...s.messages, { role: 'user', content: message }],
    }));
    try {
      const res = await aiApi.sendChat({
        message,
        conversationId: currentConversationId ?? undefined,
        images,
      });
      const pendingActions: AiPendingAction[] | undefined = res.pendingActions
        ?.length
        ? res.pendingActions.map((pa) => ({ ...pa, status: 'pending' as const }))
        : undefined;
      set((s) => ({
        currentConversationId: res.conversationId,
        messages: [
          ...s.messages,
          {
            role: 'assistant',
            content: res.content,
            pendingActions,
          },
        ],
        isSending: false,
      }));
      return res;
    } catch (err) {
      set({ isSending: false, error: extractError(err) });
      return null;
    }
  },

  deleteConversation: async (conversationId) => {
    try {
      await aiApi.deleteConversation(conversationId);
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== conversationId),
        currentConversationId:
          s.currentConversationId === conversationId
            ? null
            : s.currentConversationId,
        messages:
          s.currentConversationId === conversationId ? [] : s.messages,
      }));
    } catch (err) {
      set({ error: extractError(err) });
    }
  },

  newConversation: () => {
    set({ currentConversationId: null, messages: [] });
  },

  fetchQuota: async () => {
    try {
      const quota = await aiApi.getQuota();
      set({ quota });
    } catch {
      // Silent
    }
  },

  clearError: () => set({ error: null }),

  confirmPendingAction: async (messageIndex, actionId) => {
    // Garde anti double-tap : si l'action n'est plus 'pending' (deja en
    // cours, executee, annulee, etc.), on ne fait rien. Sans cette garde,
    // un 2eme click rapide entre le 1er optimistic update et le commit React
    // declencherait un second POST. Le backend gere l'atomicite mais la
    // 2eme reponse 409 ecraserait le status 'executed' en 'failed' (UX).
    const current = get()
      .messages[messageIndex]?.pendingActions
      ?.find((pa) => pa.id === actionId);
    if (current && current.status && current.status !== 'pending') return;
    set((s) => ({
      messages: updatePendingAction(s.messages, messageIndex, actionId, {
        status: 'executing',
      }),
    }));
    try {
      const res = await aiApi.confirmPendingAction(actionId);
      set((s) => ({
        messages: updatePendingAction(s.messages, messageIndex, actionId, {
          status: res.success ? 'executed' : 'failed',
          resultMsg: res.resultMsg,
        }),
      }));
    } catch (err) {
      set((s) => ({
        messages: updatePendingAction(s.messages, messageIndex, actionId, {
          status: 'failed',
          resultMsg: extractError(err),
        }),
      }));
    }
  },

  cancelPendingAction: async (messageIndex, actionId) => {
    const current = get()
      .messages[messageIndex]?.pendingActions
      ?.find((pa) => pa.id === actionId);
    if (current && current.status && current.status !== 'pending') return;
    set((s) => ({
      messages: updatePendingAction(s.messages, messageIndex, actionId, {
        status: 'cancelling',
      }),
    }));
    try {
      const res = await aiApi.cancelPendingAction(actionId);
      set((s) => ({
        messages: updatePendingAction(s.messages, messageIndex, actionId, {
          status: 'cancelled',
          resultMsg: res.resultMsg,
        }),
      }));
    } catch (err) {
      set((s) => ({
        messages: updatePendingAction(s.messages, messageIndex, actionId, {
          status: 'failed',
          resultMsg: extractError(err),
        }),
      }));
    }
  },
}));
