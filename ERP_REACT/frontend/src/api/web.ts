/**
 * ERP React Frontend - Web API Module
 * Recherche web, analyse URL, recherche+analyse combinee, historique.
 */

import api from './client';

// ============ Types ============

export interface WebCitation {
  title: string;
  url: string;
}

export interface WebResult {
  text: string;
  citations: WebCitation[];
  searchCount: number;
  fetchCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  elapsedSeconds: number;
  creditBalance: number;
}

export interface SearchHistoryItem {
  id: number;
  userId: number;
  searchType: string;
  query: string;
  resultPreview: string;
  citationsCount: number;
  createdAt: string;
}

// ============ API Functions ============

/** Recherche web en temps reel */
export async function webSearch(data: {
  query: string;
  maxUses?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
}): Promise<WebResult> {
  const res = await api.post('/web/search', data);
  return res.data;
}

/** Analyse du contenu d'une URL */
export async function webFetch(data: {
  url: string;
  maxUses?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  enableCitations?: boolean;
  maxContentTokens?: number;
}): Promise<WebResult> {
  const res = await api.post('/web/fetch', data);
  return res.data;
}

/** Recherche web + analyse approfondie des meilleures sources */
export async function webSearchFetch(data: {
  query: string;
  maxSearchUses?: number;
  maxFetchUses?: number;
  allowedDomains?: string[];
}): Promise<WebResult> {
  const res = await api.post('/web/search-fetch', data);
  return res.data;
}

/** Historique des recherches */
export async function getSearchHistory(limit?: number): Promise<{ items: SearchHistoryItem[] }> {
  const res = await api.get('/web/history', { params: { limit } });
  return res.data;
}
