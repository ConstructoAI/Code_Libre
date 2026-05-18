/**
 * Mobile React Frontend - Attachments API
 * CRUD polymorphique pour pieces jointes (dossier, devis, facture, BT, BC, BA).
 */

import api from './client';
import { requestSignedUrl } from './dossiers';
import type {
  Attachment, AttachmentDetail, AttachmentParentType,
  AttachmentCategory, AttachmentUploadResult,
} from '@/types';

const PREFIX = '/attachments';

export interface UploadAttachmentOptions {
  category?: AttachmentCategory;
  description?: string;
  /** Callback de progress (0-100) appele pendant l'upload multipart. */
  onProgress?: (percentComplete: number) => void;
}

export async function uploadAttachment(
  parentType: AttachmentParentType,
  parentId: number,
  file: File,
  opts: UploadAttachmentOptions = {},
): Promise<AttachmentUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (opts.category) formData.append('category', opts.category);
  if (opts.description) formData.append('description', opts.description);

  const { data } = await api.post<AttachmentUploadResult>(
    `${PREFIX}/upload/${parentType}/${parentId}`,
    formData,
    {
      onUploadProgress: (e) => {
        if (e.total && opts.onProgress) {
          opts.onProgress(Math.round((e.loaded * 100) / e.total));
        }
      },
    },
  );
  return data;
}

export interface ListAttachmentsOptions {
  category?: AttachmentCategory;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export async function listAttachments(
  parentType: AttachmentParentType,
  parentId: number,
  opts: ListAttachmentsOptions = {},
): Promise<Attachment[]> {
  const { data } = await api.get<Attachment[]>(
    `${PREFIX}/list/${parentType}/${parentId}`,
    { params: opts },
  );
  return data;
}

export async function getAttachment(attachmentId: number): Promise<AttachmentDetail> {
  const { data } = await api.get<AttachmentDetail>(`${PREFIX}/by-id/${attachmentId}`);
  return data;
}

export async function deleteAttachment(attachmentId: number): Promise<void> {
  await api.delete(`${PREFIX}/by-id/${attachmentId}`);
}

export interface UpdateAttachmentPayload {
  filename?: string;
  category?: AttachmentCategory;
  description?: string;
}

export async function updateAttachment(
  attachmentId: number,
  payload: UpdateAttachmentPayload,
): Promise<AttachmentDetail> {
  const { data } = await api.patch<AttachmentDetail>(`${PREFIX}/by-id/${attachmentId}`, payload);
  return data;
}

/**
 * Genere une URL signee pour preview/download (utilisable dans <img src> ou <a href>).
 * Path absolu reconstruit puis signé cote serveur via POST /auth/signed-url.
 */
export async function getPreviewUrl(attachmentId: number): Promise<string> {
  return requestSignedUrl(`/api/mobile/v1/attachments/by-id/${attachmentId}/preview`);
}

export async function getDownloadUrl(attachmentId: number): Promise<string> {
  return requestSignedUrl(`/api/mobile/v1/attachments/by-id/${attachmentId}/download`);
}

/**
 * Telecharge le contenu brut comme Blob (utile pour navigator.share).
 */
export async function downloadAttachmentBlob(attachmentId: number): Promise<Blob> {
  const { data } = await api.get(`${PREFIX}/by-id/${attachmentId}/download`, {
    responseType: 'blob',
  });
  return data as Blob;
}
