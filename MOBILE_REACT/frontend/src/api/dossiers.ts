/**
 * Mobile React Frontend - Dossiers API
 * Project dossier management with notes, photos, etapes.
 */

import api from './client';
import type { DossierListItem, DossierDetail, DossierLien } from '@/types';

export async function getDossiers(): Promise<DossierListItem[]> {
  const { data } = await api.get<DossierListItem[]>('/dossiers');
  return data;
}

export async function getDossierDetail(dossierId: number): Promise<DossierDetail> {
  const { data } = await api.get<DossierDetail>(`/dossiers/${dossierId}`);
  return data;
}

export async function addDossierNote(
  dossierId: number,
  contenu: string,
  categorie?: string,
  photos?: File[],
): Promise<void> {
  const formData = new FormData();
  formData.append('contenu', contenu);
  if (categorie) formData.append('categorie', categorie);
  if (photos) {
    photos.forEach((photo) => formData.append('photos', photo));
  }
  await api.post(`/dossiers/${dossierId}/notes`, formData);
}

export async function updateEtapeStatus(
  dossierId: number,
  etapeId: number,
  statut: string,
): Promise<void> {
  await api.patch(`/dossiers/${dossierId}/etapes/${etapeId}`, null, {
    params: { statut },
  });
}

/**
 * Demande une URL signee HMAC au backend pour un download (TTL 5 min).
 * Le JWT reste dans le Bearer header — l'URL retournee ne contient que
 * la signature HMAC + exp + tenant + employee_id, jamais le JWT en clair.
 * A utiliser dans les <img src> et <a href> qui doivent etre accessibles
 * par le browser sans Bearer header.
 *
 * @param path Chemin API absolu a signer (doit commencer par /api/mobile/v1/dossiers/)
 * @param ttlSeconds Duree de validite, default 5 min, max 1 heure (clamp serveur)
 */
export async function requestSignedUrl(
  path: string,
  ttlSeconds: number = 300,
): Promise<string> {
  const { data } = await api.post<{ url: string; expiresInSeconds: number }>(
    '/auth/signed-url',
    { path, ttlSeconds },
  );
  return data.url;
}

/**
 * @deprecated Utilise requestSignedUrl() pour ne pas exposer le JWT dans
 * les logs/referrer/history. Le serveur accepte encore ce format pour
 * compat retrograde mais log un INFO `[LEGACY-TOKEN]` a chaque hit.
 */
export function getDocumentDownloadUrl(
  dossierId: number,
  documentId: number,
  source?: string,
): string {
  const token = localStorage.getItem('mobile_token');
  const src = source || 'dossier_documents';
  return `/api/mobile/v1/dossiers/${dossierId}/documents/${documentId}/download?token=${token}&source=${src}`;
}

/**
 * Variante asynchrone secure de getDocumentDownloadUrl utilisant requestSignedUrl.
 */
export async function getDocumentDownloadUrlSigned(
  dossierId: number,
  documentId: number,
  source?: string,
): Promise<string> {
  const src = source || 'dossier_documents';
  const path = `/api/mobile/v1/dossiers/${dossierId}/documents/${documentId}/download?source=${src}`;
  return requestSignedUrl(path);
}

/** @deprecated Utilise getNotePhotoUrlSigned (async). */
export function getNotePhotoUrl(photoId: number): string {
  const token = localStorage.getItem('mobile_token');
  return `/api/mobile/v1/dossiers/notes/photos/${photoId}?token=${token}`;
}

export async function getNotePhotoUrlSigned(photoId: number): Promise<string> {
  return requestSignedUrl(`/api/mobile/v1/dossiers/notes/photos/${photoId}`);
}

/** @deprecated Utilise getNoteAttachmentUrlSigned (async). */
export function getNoteAttachmentUrl(dossierId: number, noteId: number, attIndex: number): string {
  const token = localStorage.getItem('mobile_token');
  return `/api/mobile/v1/dossiers/${dossierId}/notes/${noteId}/attachment/${attIndex}?token=${token}`;
}

export async function getNoteAttachmentUrlSigned(
  dossierId: number,
  noteId: number,
  attIndex: number,
): Promise<string> {
  return requestSignedUrl(
    `/api/mobile/v1/dossiers/${dossierId}/notes/${noteId}/attachment/${attIndex}`,
  );
}

// ===== Liens cliquables =====

export async function getDossierLiens(dossierId: number): Promise<DossierLien[]> {
  const { data } = await api.get<DossierLien[]>(`/dossiers/${dossierId}/liens`);
  return data;
}

export async function createDossierLien(
  dossierId: number,
  body: { url: string; description?: string },
): Promise<DossierLien> {
  const { data } = await api.post<DossierLien>(`/dossiers/${dossierId}/liens`, body);
  return data;
}

export async function updateDossierLien(
  dossierId: number,
  lienId: number,
  body: { url?: string; description?: string },
): Promise<DossierLien> {
  const { data } = await api.put<DossierLien>(`/dossiers/${dossierId}/liens/${lienId}`, body);
  return data;
}

export async function deleteDossierLien(dossierId: number, lienId: number): Promise<void> {
  await api.delete(`/dossiers/${dossierId}/liens/${lienId}`);
}
