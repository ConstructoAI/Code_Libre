/**
 * ERP React Frontend - Stripe API Module
 * Checkout, subscription management, customer portal, AI prepaid credits.
 */

import api from './client';

// ============ Types ============

export interface SubscriptionDetails {
  subscriptionId?: string;
  status?: string;
  planName?: string;
  planType?: string;
  planAmount?: number;
  planInterval?: string;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: number;
  canceledAt?: number;
  trialStart?: number;
  trialEnd?: number;
  created?: number;
}

export interface CreditsInfo {
  balance: number;
  usageThisMonth: number;
  isExempt: boolean;
  planType?: string;
}

export interface RechargeResult {
  success: boolean;
  message: string;
  newBalance: number;
  invoiceId?: string;
}

// ============ Checkout ============

export async function createCheckoutSession(
  planType: string = 'pro',
  successUrl?: string,
  cancelUrl?: string,
): Promise<{ url: string }> {
  const { data } = await api.post('/stripe/checkout', {
    planType,
    successUrl,
    cancelUrl,
  });
  return data;
}

// ============ Subscription ============

export async function getSubscription(): Promise<SubscriptionDetails> {
  const { data } = await api.get('/stripe/subscription');
  return data;
}

// ============ Customer Portal ============

export async function createPortalSession(
  returnUrl?: string,
): Promise<{ url: string }> {
  const { data } = await api.post('/stripe/portal', { returnUrl });
  return data;
}

// ============ Cancel ============

export async function cancelSubscription(): Promise<{
  success: boolean;
  message: string;
}> {
  const { data } = await api.post('/stripe/cancel');
  return data;
}

// ============ AI Credits ============

export async function getCredits(): Promise<CreditsInfo> {
  const { data } = await api.get('/stripe/credits');
  return data;
}

export async function rechargeCredits(
  amount: number = 10.0,
): Promise<RechargeResult> {
  const { data } = await api.post('/stripe/credits/recharge', { amount });
  return data;
}
