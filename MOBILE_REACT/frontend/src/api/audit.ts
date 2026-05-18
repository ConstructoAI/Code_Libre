/**
 * Mobile React Frontend - Audit log API (Phase 5D)
 *
 * Endpoint :
 *  - GET /audit/events  -> journal d'audit polymorphique
 *
 * Reserve ADMIN cote serveur (require_role).
 * Conformite Loi 25 Quebec + GDPR.
 */

import api from './client';
import type { AuditEventsResponse, AuditListParams } from '@/types';

/**
 * Recupere les evenements d'audit du tenant courant.
 *
 * Tous les filtres sont optionnels. Si aucun, retourne les `limit` derniers
 * events (defaut 100, max 500). Ordre : created_at DESC.
 *
 * @example
 *   // Tous les events sur la facture 142
 *   listAuditEvents({ entityType: 'facture', entityId: 142 });
 *
 *   // Tous les logins de la semaine
 *   listAuditEvents({ action: 'login', since: '2026-05-10T00:00:00Z' });
 */
export async function listAuditEvents(
  params: AuditListParams = {},
): Promise<AuditEventsResponse> {
  const { data } = await api.get<AuditEventsResponse>('/audit/events', {
    params,
  });
  return data;
}
