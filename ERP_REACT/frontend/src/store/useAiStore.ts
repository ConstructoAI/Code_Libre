/**
 * ERP React Frontend - AI Zustand Store
 * Manages chat messages, profiles, usage stats, quota, and credits.
 */

import { create } from 'zustand';
import * as aiApi from '@/api/ai';
import type {
  AiProfile, AiChatResponse, AiUsageStats, AiCredits,
  AiQuota, AiDailyUsage, AiMonthlyUsage,
} from '@/api/ai';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  tokensUsed?: number;
  costUsd?: number;
  elapsedSeconds?: number;
  creditBalance?: number;
  timestamp: number;
}

interface AiState {
  profiles: AiProfile[];
  selectedProfile: string;
  messages: ChatMessage[];
  usage: AiUsageStats | null;
  credits: AiCredits | null;
  quota: AiQuota | null;
  dailyUsage: AiDailyUsage[];
  monthlyUsage: AiMonthlyUsage[];
  isLoading: boolean;
  error: string | null;
  creditsExhausted: boolean;

  // Actions
  fetchProfiles: () => Promise<void>;
  setProfile: (profileId: string) => void;
  sendMessage: (message: string, context?: string) => Promise<AiChatResponse>;
  fetchUsage: (periodDays?: number) => Promise<void>;
  fetchCredits: () => Promise<void>;
  fetchQuota: () => Promise<void>;
  fetchDailyUsage: (days?: number) => Promise<void>;
  fetchMonthlyUsage: (months?: number) => Promise<void>;
  clearMessages: () => void;
  clearError: () => void;
}

export const useAiStore = create<AiState>((set, get) => ({
  profiles: [],
  selectedProfile: 'general',
  messages: [],
  usage: null,
  credits: null,
  quota: null,
  dailyUsage: [],
  monthlyUsage: [],
  isLoading: false,
  error: null,
  creditsExhausted: false,

  fetchProfiles: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await aiApi.listProfiles();
      set({ profiles: res.profiles, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des profils IA';
      set({ isLoading: false, error: message });
    }
  },

  setProfile: (profileId) => {
    set({ selectedProfile: profileId });
  },

  sendMessage: async (message, context) => {
    const { selectedProfile } = get();

    // Add user message immediately
    const userMsg: ChatMessage = { role: 'user', content: message, timestamp: Date.now() };
    set((s) => ({ messages: [...s.messages, userMsg], isLoading: true, error: null }));

    try {
      const res = await aiApi.chat(message, selectedProfile, context);
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: res.response,
        tokensUsed: res.tokensUsed,
        costUsd: res.costUsd,
        elapsedSeconds: res.elapsedSeconds,
        creditBalance: res.creditBalance,
        timestamp: Date.now(),
      };
      set((s) => ({
        messages: [...s.messages, assistantMsg],
        isLoading: false,
        creditsExhausted: false,
      }));
      return res;
    } catch (err: unknown) {
      // Check for 402 Payment Required (credits exhausted)
      const axiosErr = err as { response?: { status?: number } };
      if (axiosErr?.response?.status === 402) {
        set({ isLoading: false, creditsExhausted: true, error: 'Credits IA epuises. Veuillez recharger.' });
      } else {
        const errMessage = err instanceof Error ? err.message : 'Erreur lors de la communication avec l\'IA';
        set({ isLoading: false, error: errMessage });
      }
      throw err;
    }
  },

  fetchUsage: async (periodDays) => {
    set({ isLoading: true, error: null });
    try {
      const usage = await aiApi.getUsageStats(periodDays);
      set({ usage, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des statistiques';
      set({ isLoading: false, error: message });
    }
  },

  fetchCredits: async () => {
    try {
      const credits = await aiApi.getCredits();
      set({ credits, creditsExhausted: credits.balanceUsd <= 0 && !credits.isExempt });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des crédits';
      set({ error: message });
    }
  },

  fetchQuota: async () => {
    try {
      const quota = await aiApi.getQuota();
      set({ quota, creditsExhausted: !quota.allowed && !quota.isExempt });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement du quota';
      set({ error: message });
    }
  },

  fetchDailyUsage: async (days = 30) => {
    try {
      const res = await aiApi.getDailyUsage(days);
      set({ dailyUsage: res.items });
    } catch {
      // Silently fail
    }
  },

  fetchMonthlyUsage: async (months = 6) => {
    try {
      const res = await aiApi.getMonthlyUsage(months);
      set({ monthlyUsage: res.items });
    } catch {
      // Silently fail
    }
  },

  clearMessages: () => set({ messages: [] }),
  clearError: () => set({ error: null }),
}));
