/**
 * SEAOP React Frontend - Evaluations API
 * Rating and reviewing entrepreneurs after soumission completion.
 */

import api from './client';
import type { Evaluation } from '@/types';

export async function createEvaluation(data: {
  soumissionId: number;
  note: number;
  commentaire?: string;
}): Promise<Evaluation> {
  const { data: result } = await api.post('/evaluations', data);
  return result;
}

export async function getEntrepreneurEvaluations(entrepreneurId: number): Promise<{
  moyenne: number;
  count: number;
  comments: Evaluation[];
}> {
  const { data } = await api.get(`/evaluations/entrepreneur/${entrepreneurId}`);
  return {
    moyenne: data.moyenne ?? 0,
    count: data.count ?? 0,
    comments: data.evaluations ?? data.comments ?? [],
  };
}
