/**
 * Types et helpers pour les erreurs API.
 * Centralise l'extraction du message d'erreur pour eviter `catch (err: any)`.
 */

import type { AxiosError } from 'axios';

export interface ApiErrorPayload {
  detail?: string;
  code?: string;
  errors?: Record<string, string[]>;
}

export type ApiError = AxiosError<ApiErrorPayload>;

export function isApiError(err: unknown): err is ApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { isAxiosError?: boolean }).isAxiosError === true
  );
}

/**
 * Extrait un message d'erreur lisible depuis n'importe quelle exception.
 * Ordre de priorite : Axios response.data.detail > error.message > fallback.
 */
export function extractApiError(err: unknown, fallback = 'Une erreur est survenue'): string {
  if (isApiError(err)) {
    return err.response?.data?.detail || err.message || fallback;
  }
  if (err instanceof Error) {
    return err.message || fallback;
  }
  if (typeof err === 'string') {
    return err;
  }
  return fallback;
}
