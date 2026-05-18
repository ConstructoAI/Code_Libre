/**
 * ERP React Frontend - AI API Module
 * Chat, usage tracking, quota management, and prepaid credits.
 */

import api from './client';

export interface AiProfile {
  id: string;
  name: string;
}

export interface AiChatResponse {
  response: string;
  profile: string;
  inputTokens?: number;
  outputTokens?: number;
  tokensUsed: number;
  costUsd: number;
  elapsedSeconds: number;
  creditBalance?: number;
  conversationId?: number;
}

export interface AiConversation {
  id: number;
  name: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiConversationDetail {
  id: number;
  name: string;
  messages: { role: string; content: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface AiUsageStats {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byFeature: { feature: string; requests: number; tokens: number; cost: number }[];
}

export interface AiCredits {
  balanceUsd: number;
  monthlyLimitUsd: number;
  monthlyUsedUsd?: number;
  autoRecharge: boolean;
  rechargeAmountUsd: number;
  isExempt: boolean;
}

export interface AiQuota {
  allowed: boolean;
  balance: number;
  monthlyUsed: number;
  monthlyLimit: number;
  isExempt: boolean;
}

export interface AiDailyUsage {
  date: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

export interface AiMonthlyUsage {
  annee: number;
  mois: number;
  feature: string;
  totalRequests: number;
  totalCostUsd: number;
}

// ============ Core API Calls ============

export async function listProfiles(): Promise<{ profiles: AiProfile[] }> {
  const { data } = await api.get('/ai/profiles');
  return data;
}

export async function chat(
  message: string, profile = 'general', context?: string, conversationId?: number,
): Promise<AiChatResponse> {
  const { data } = await api.post('/ai/chat', { message, profile, context, conversationId });
  return data;
}

export async function getUsageStats(periodDays = 30): Promise<AiUsageStats> {
  const { data } = await api.get('/ai/usage', { params: { periodDays } });
  return data;
}

export async function getCredits(): Promise<AiCredits> {
  const { data } = await api.get('/ai/credits');
  return data;
}

export async function getQuota(): Promise<AiQuota> {
  const { data } = await api.get('/ai/quota');
  return data;
}

export async function getDailyUsage(days = 30): Promise<{ items: AiDailyUsage[] }> {
  const { data } = await api.get('/ai/usage/daily', { params: { days } });
  return data;
}

export async function getMonthlyUsage(months = 6): Promise<{ items: AiMonthlyUsage[] }> {
  const { data } = await api.get('/ai/usage/monthly', { params: { months } });
  return data;
}

// ============ Document Analysis ============

export interface DocumentAnalysis {
  analysis: string;
  documentType: string;
  pages: number;
  tokensUsed: number;
  costUsd: number;
  elapsedSeconds: number;
}

export interface PlanAnalysis {
  planType: string;
  analysis: string;
  dimensions: Record<string, unknown>;
  materials: string[];
  filesAnalyzed: number;
  tokensUsed: number;
  costUsd: number;
  elapsedSeconds: number;
}

export async function analyzeDocument(file: File, prompt?: string): Promise<DocumentAnalysis> {
  const form = new FormData();
  form.append('file', file);
  if (prompt) form.append('prompt', prompt);
  const { data } = await api.post('/ai/analyze-document', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function analyzePlan(files: File[]): Promise<PlanAnalysis> {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  const { data } = await api.post('/ai/analyze-plan', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

// ============ Conversations (Assistant IA) ============

export async function listConversations(): Promise<{ items: AiConversation[] }> {
  const { data } = await api.get('/ai/conversations');
  return data;
}

export async function getConversation(convId: number): Promise<AiConversationDetail> {
  const { data } = await api.get(`/ai/conversations/${convId}`);
  return data;
}

export async function deleteConversation(convId: number): Promise<void> {
  await api.delete(`/ai/conversations/${convId}`);
}
