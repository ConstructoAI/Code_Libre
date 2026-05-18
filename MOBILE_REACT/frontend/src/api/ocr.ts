/**
 * Mobile React Frontend - OCR scan recus API (Phase 4A)
 *
 * Envoie une photo de recu/facture au backend qui appelle Claude Vision
 * pour extraire fournisseur, items, taxes, total. L'UI propose ensuite
 * de creer un Bon de Commande pre-rempli a partir du resultat.
 */

import api from './client';
import type { OcrReceiptResponse } from '@/types';

/**
 * Upload une image de recu (JPEG/PNG/WebP/HEIC, max 10 MB).
 * Le backend valide le MIME via magic bytes et appelle Claude Sonnet 4.6.
 *
 * Note : le client transforme automatiquement snake_case -> camelCase via
 * l'interceptor axios global, donc OcrReceiptResponse utilise camelCase.
 */
export async function scanReceipt(file: File): Promise<OcrReceiptResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<OcrReceiptResponse>('/ocr/receipt', formData);
  return data;
}
