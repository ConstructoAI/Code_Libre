/**
 * Mobile React Frontend - AI Assistant API
 * Chat with AI, photo analysis, note enrichment.
 */

import api from './client';
import type {
  AiExpertProfile,
  AiQuota,
  AiConversation,
  AiConversationDetail,
  AiChatResponse,
  AiPendingActionConfirmResponse,
} from '@/types';

export async function getExperts(): Promise<AiExpertProfile[]> {
  const { data } = await api.get<{ profiles: AiExpertProfile[] }>('/ai/experts');
  return data.profiles;
}

export async function getQuota(): Promise<AiQuota> {
  const { data } = await api.get<AiQuota>('/ai/quota');
  return data;
}

export async function getConversations(): Promise<AiConversation[]> {
  const { data } = await api.get<AiConversation[]>('/ai/conversations');
  return data;
}

export async function getConversationDetail(
  conversationId: number,
): Promise<AiConversationDetail> {
  const { data } = await api.get<AiConversationDetail>(
    `/ai/conversations/${conversationId}`,
  );
  return data;
}

export async function deleteConversation(conversationId: number): Promise<void> {
  await api.delete(`/ai/conversations/${conversationId}`);
}

export async function sendChat(body: {
  message: string;
  conversationId?: number;
  images?: { data: string; mediaType: string }[];
}): Promise<AiChatResponse> {
  const { data } = await api.post<AiChatResponse>('/ai/chat', body);
  return data;
}

export async function confirmPendingAction(
  actionId: number,
): Promise<AiPendingActionConfirmResponse> {
  const { data } = await api.post<AiPendingActionConfirmResponse>(
    `/ai/pending-actions/${actionId}/confirm`,
  );
  return data;
}

export async function cancelPendingAction(
  actionId: number,
): Promise<AiPendingActionConfirmResponse> {
  const { data } = await api.post<AiPendingActionConfirmResponse>(
    `/ai/pending-actions/${actionId}/cancel`,
  );
  return data;
}

export async function enrichNote(body: {
  contenu: string;
  dossierTitre?: string;
}): Promise<{
  contenuEnrichi: string;
  categorie: string;
  actions: string[];
  tokensInput: number;
  tokensOutput: number;
}> {
  const { data } = await api.post('/notes/ai/enrich', body);
  return data;
}

export async function analyzePhoto(body: {
  imageData: string;
  mediaType: string;
  contexte?: string;
  dossierTitre?: string;
}): Promise<{
  contenuEnrichi: string;
  categorie: string;
  actions: string[];
  tokensInput: number;
  tokensOutput: number;
}> {
  const { data } = await api.post('/notes/ai/analyze-photo', body);
  return data;
}

export async function getDossierSummary(
  dossierId: number,
): Promise<{
  resume: string;
  problemesOuverts: string[];
  actionsEnAttente: string[];
  nbNotesAnalysees: number;
  tokensInput: number;
  tokensOutput: number;
}> {
  const { data } = await api.post(`/dossiers/${dossierId}/notes/ai/summary`);
  return data;
}
