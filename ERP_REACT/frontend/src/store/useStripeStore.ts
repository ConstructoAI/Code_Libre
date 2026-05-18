/**
 * ERP React Frontend - Stripe Zustand Store
 * Manages subscription state, AI credits, and Stripe portal/checkout flows.
 */

import { create } from 'zustand';
import * as stripeApi from '@/api/stripe';
import type { SubscriptionDetails, CreditsInfo } from '@/api/stripe';

function extractError(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    'response' in err &&
    typeof (err as Record<string, unknown>).response === 'object'
  ) {
    const resp = (err as { response: { data?: { detail?: string } } }).response;
    if (resp?.data?.detail) return resp.data.detail;
  }
  if (err instanceof Error) return err.message;
  return 'Une erreur est survenue';
}

interface StripeState {
  // Subscription
  subscription: SubscriptionDetails | null;

  // Credits
  credits: CreditsInfo | null;

  // UI
  isLoading: boolean;
  isProcessing: boolean;
  error: string | null;
  successMessage: string | null;

  // Actions — Subscription
  fetchSubscription: () => Promise<void>;
  openCheckout: (planType?: string) => Promise<void>;
  openPortal: () => Promise<void>;
  cancelSubscription: () => Promise<void>;

  // Actions — Credits
  fetchCredits: () => Promise<void>;
  rechargeCredits: (amount?: number) => Promise<void>;

  // Utility
  clearError: () => void;
  clearSuccess: () => void;
}

export const useStripeStore = create<StripeState>((set, get) => ({
  subscription: null,
  credits: null,
  isLoading: false,
  isProcessing: false,
  error: null,
  successMessage: null,

  // ---- Fetch Subscription ----
  fetchSubscription: async () => {
    set({ isLoading: true, error: null });
    try {
      const sub = await stripeApi.getSubscription();
      set({ subscription: sub, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  // ---- Checkout (opens new tab) ----
  openCheckout: async (planType = 'pro') => {
    set({ isProcessing: true, error: null });
    try {
      const res = await stripeApi.createCheckoutSession(planType);
      if (res.url) {
        window.location.href = res.url;
      }
    } catch (err) {
      set({ isProcessing: false, error: extractError(err) });
    }
  },

  // ---- Customer Portal (opens new tab) ----
  openPortal: async () => {
    set({ isProcessing: true, error: null });
    try {
      const res = await stripeApi.createPortalSession();
      if (res.url) {
        window.location.href = res.url;
      }
    } catch (err) {
      set({ isProcessing: false, error: extractError(err) });
    }
  },

  // ---- Cancel Subscription ----
  cancelSubscription: async () => {
    set({ isProcessing: true, error: null, successMessage: null });
    try {
      const res = await stripeApi.cancelSubscription();
      set({
        isProcessing: false,
        successMessage: res.message,
      });
      // Refresh subscription data
      get().fetchSubscription();
    } catch (err) {
      set({ isProcessing: false, error: extractError(err) });
    }
  },

  // ---- Fetch Credits ----
  fetchCredits: async () => {
    set({ isLoading: true, error: null });
    try {
      const credits = await stripeApi.getCredits();
      set({ credits, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err) });
    }
  },

  // ---- Recharge Credits ----
  rechargeCredits: async (amount = 10.0) => {
    set({ isProcessing: true, error: null, successMessage: null });
    try {
      const res = await stripeApi.rechargeCredits(amount);
      set({
        isProcessing: false,
        successMessage: res.message,
        credits: get().credits
          ? { ...get().credits!, balance: res.newBalance }
          : null,
      });
      // Refresh full credits data
      get().fetchCredits();
    } catch (err) {
      set({ isProcessing: false, error: extractError(err) });
    }
  },

  clearError: () => set({ error: null }),
  clearSuccess: () => set({ successMessage: null }),
}));
