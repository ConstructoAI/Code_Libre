/**
 * Public Chat API — Sylvain Leduc pre-login assistant.
 * No auth. Session UUID stored in localStorage on the client.
 */

import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '';
const API_PREFIX = '/api/erp/v1';

// Separate axios instance — no JWT header, no auth redirects.
const publicApi = axios.create({
  baseURL: `${API_BASE}${API_PREFIX}`,
  headers: { 'Content-Type': 'application/json' },
});

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  session_id: string;
  message: string;
  history?: ChatMessage[];
}

export interface ChatResponse {
  response: string;
  exchanges_used: number;
  exchanges_remaining: number;
  limit_reached: boolean;
}

export async function sendSylvainChat(
  sessionId: string,
  message: string,
  history: ChatMessage[] = [],
): Promise<ChatResponse> {
  const payload: ChatRequest = {
    session_id: sessionId,
    message,
    history: history.slice(-6),
  };
  const { data } = await publicApi.post<ChatResponse>('/public/sylvain-chat', payload);
  return data;
}
