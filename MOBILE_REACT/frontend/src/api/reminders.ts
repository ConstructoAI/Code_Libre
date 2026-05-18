/**
 * Mobile React Frontend - Reminders API (Phase 4B)
 *
 * Endpoints associes a la relance des factures impayees :
 *  - GET  /factures/overdue          -> aging buckets J30/J60/J90/J90+
 *  - POST /factures/send-reminders   -> envoi en lot, dry_run ou reel
 *
 * Reserve aux roles ADMIN/MANAGER cote serveur (require_role).
 */

import api from './client';
import type {
  OverdueResponse,
  RemindersSendPayload,
  RemindersSendResponse,
  ReminderBucket,
} from '@/types';

/**
 * Recupere les factures en retard groupees par aging bucket.
 *
 * @param bucket Optionnel — filtre sur un bucket precis. Sans filtre, retourne
 *               les 4 buckets J30/J60/J90/J90+ avec leurs aggregats.
 */
export async function getOverdueFactures(
  bucket?: ReminderBucket,
): Promise<OverdueResponse> {
  const params = bucket ? { bucket } : undefined;
  const { data } = await api.get<OverdueResponse>('/factures/overdue', { params });
  return data;
}

/**
 * Envoie des emails de relance pour les factures en retard.
 *
 * Modes :
 *  - dryRun = true              -> simulation sans SMTP (preview UI)
 *  - testEmail = "x@y.ca"       -> redirige tous les envois vers cet email
 *  - buckets = ['J30', 'J60']   -> filtre les buckets a relancer
 *
 * Si le tenant a beaucoup de factures impayees, l'appel peut prendre
 * plusieurs minutes (1 SMTP par facture). Le timeout cote proxy Render
 * est de 5 minutes par defaut.
 */
export async function sendReminders(
  payload: RemindersSendPayload,
): Promise<RemindersSendResponse> {
  const { data } = await api.post<RemindersSendResponse>(
    '/factures/send-reminders',
    {
      buckets: payload.buckets ?? null,
      dryRun: payload.dryRun ?? false,
      testEmail: payload.testEmail ?? null,
    },
    {
      // Override 5 min : l'envoi peut etre long pour gros volumes
      timeout: 5 * 60 * 1000,
    },
  );
  return data;
}
