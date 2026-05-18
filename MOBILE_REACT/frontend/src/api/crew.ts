/**
 * Mobile React Frontend - Crew API
 * Team status on construction sites.
 */

import api from './client';
import type { CrewProject } from '@/types';

export async function getCrew(): Promise<CrewProject[]> {
  const { data } = await api.get<CrewProject | CrewProject[]>('/crew');
  // Backend may return a single object or an array
  return Array.isArray(data) ? data : [data];
}
