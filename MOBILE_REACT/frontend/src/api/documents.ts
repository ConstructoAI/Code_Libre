/**
 * Mobile React Frontend - Documents API
 * CRUD for devis, factures, bons de travail, bons de commande.
 */

import api from './client';
import type {
  DocType,
  AllDocumentsStats,
  DocumentStats,
  DocumentListItem,
  DocumentDetail,
  DocumentLine,
  CompanyLookup,
  ProjectLookup,
} from '@/types';

// --- Stats ---

export async function getAllStats(): Promise<AllDocumentsStats> {
  const { data } = await api.get<AllDocumentsStats>('/documents/stats');
  return data;
}

export async function getTypeStats(docType: DocType): Promise<DocumentStats> {
  const { data } = await api.get<DocumentStats>(`/documents/${docType}/stats`);
  return data;
}

// --- List ---

export async function listDocuments(
  docType: DocType,
  params?: { limit?: number; offset?: number; statut?: string },
): Promise<DocumentListItem[]> {
  const { data } = await api.get<DocumentListItem[]>(`/documents/${docType}`, { params });
  return data;
}

// --- Detail ---

export async function getDocumentDetail(docType: DocType, docId: number): Promise<DocumentDetail> {
  const { data } = await api.get<DocumentDetail>(`/documents/${docType}/${docId}`);
  return data;
}

// --- Create ---

export async function createDocument(docType: DocType, payload: Record<string, unknown>): Promise<{ id: number; numero: string }> {
  const { data } = await api.post<{ id: number; numero: string }>(`/documents/${docType}`, payload);
  return data;
}

// --- Update ---

export async function updateDocument(docType: DocType, docId: number, payload: Record<string, unknown>): Promise<void> {
  await api.put(`/documents/${docType}/${docId}`, payload);
}

// --- Delete ---

export async function deleteDocument(docType: DocType, docId: number): Promise<void> {
  await api.delete(`/documents/${docType}/${docId}`);
}

// --- Duplicate (Phase 5A) ---

/**
 * Duplique un document existant (devis/facture/BT/BC) :
 *  - Cree un nouveau document statut=BROUILLON
 *  - Genere un nouveau numero sequentiel pro
 *  - Clone client, projet, description, notes, lignes
 *  - N'inclut PAS signature, payment link ni pieces jointes
 *  - Date emission = aujourd'hui, echeance = +30j (factures uniquement)
 *
 * Retourne { id, numero } du nouveau document pour navigation immediate.
 */
export async function duplicateDocument(
  docType: DocType,
  docId: number,
): Promise<{ id: number; numero: string }> {
  const { data } = await api.post<{ id: number; numero: string }>(
    `/documents/${docType}/${docId}/duplicate`,
  );
  return data;
}

// --- Lines ---

export async function addLine(docType: DocType, docId: number, payload: Record<string, unknown>): Promise<DocumentLine> {
  const { data } = await api.post<DocumentLine>(`/documents/${docType}/${docId}/lines`, payload);
  return data;
}

export async function updateLine(docType: DocType, docId: number, lineId: number, payload: Record<string, unknown>): Promise<void> {
  await api.put(`/documents/${docType}/${docId}/lines/${lineId}`, payload);
}

export async function deleteLine(docType: DocType, docId: number, lineId: number): Promise<void> {
  await api.delete(`/documents/${docType}/${docId}/lines/${lineId}`);
}

// --- Lookups ---

export async function getCompanies(): Promise<CompanyLookup[]> {
  const { data } = await api.get<CompanyLookup[]>('/documents/lookup/companies');
  return data;
}

export async function getProjects(): Promise<ProjectLookup[]> {
  const { data } = await api.get<ProjectLookup[]>('/documents/lookup/projects');
  return data;
}

// --- PDF Export (Phase 3A) ---

/**
 * Genere et telecharge le PDF d'un document commercial (devis/facture/BT/BC).
 * Retourne un Blob application/pdf et le filename suggere (extrait du header
 * Content-Disposition cote serveur).
 *
 * Le caller est responsable de declencher le download (createObjectURL + <a>).
 */
export async function downloadDocumentPdf(
  docType: DocType,
  docId: number,
): Promise<{ blob: Blob; filename: string }> {
  const response = await api.post(`/documents/${docType}/${docId}/pdf`, null, {
    responseType: 'blob',
  });
  const blob = new Blob([response.data as BlobPart], { type: 'application/pdf' });

  // Extract filename from Content-Disposition (RFC 5987 filename*= preferred)
  let filename = `${docType}_${docId}.pdf`;
  const headers = response.headers as Record<string, string> | undefined;
  const disp = headers?.['content-disposition'];
  if (disp) {
    const star = /filename\*=UTF-8''([^;]+)/i.exec(disp);
    if (star && star[1]) {
      try {
        filename = decodeURIComponent(star[1]);
      } catch {
        /* keep default */
      }
    } else {
      const plain = /filename="?([^";]+)"?/i.exec(disp);
      if (plain && plain[1]) filename = plain[1];
    }
  }
  return { blob, filename };
}

// --- Export CSV (Phase 5B) ---

/**
 * Exporte la liste complete des documents d'un type en CSV (Excel FR).
 *
 * Le backend retourne UTF-8 BOM + separateur ';' (compatible Excel FR
 * Windows). Le caller est responsable de declencher le download via
 * URL.createObjectURL + <a download>.
 *
 * Filtre optionnel : statut.
 */
export async function exportDocumentsCsv(
  docType: DocType,
  params?: { statut?: string },
): Promise<{ blob: Blob; filename: string }> {
  const response = await api.get(`/documents/${docType}/export.csv`, {
    params,
    responseType: 'blob',
  });
  const blob = new Blob([response.data as BlobPart], {
    type: 'text/csv;charset=utf-8',
  });

  // Extract filename from Content-Disposition (RFC 5987 filename*= preferred)
  let filename = `${docType}.csv`;
  const headers = response.headers as Record<string, string> | undefined;
  const disp = headers?.['content-disposition'];
  if (disp) {
    const star = /filename\*=UTF-8''([^;]+)/i.exec(disp);
    if (star && star[1]) {
      try {
        filename = decodeURIComponent(star[1]);
      } catch {
        /* keep default */
      }
    } else {
      const plain = /filename="?([^";]+)"?/i.exec(disp);
      if (plain && plain[1]) filename = plain[1];
    }
  }
  return { blob, filename };
}

// --- Signature electronique (devis / factures uniquement) ---

export interface DocumentSignatureState {
  signed: boolean;
  signataire_nom: string | null;
  signed_at: string | null;
  signature_data_url: string | null;
}

export interface DocumentSignatureResult {
  signed: boolean;
  signed_at: string;
}

export async function getDocumentSignature(
  docType: DocType,
  docId: number,
): Promise<DocumentSignatureState> {
  const { data } = await api.get<DocumentSignatureState>(
    `/documents/${docType}/${docId}/signature`,
  );
  return data;
}

export async function signDocument(
  docType: DocType,
  docId: number,
  signataireNom: string,
  signatureBase64: string,
): Promise<DocumentSignatureResult> {
  const { data } = await api.post<DocumentSignatureResult>(
    `/documents/${docType}/${docId}/signature`,
    { signataire_nom: signataireNom, signature_base64: signatureBase64 },
  );
  return data;
}

// --- Stripe Payment Links (Phase 3C) ---

export interface PaymentLinkResult {
  url: string;
  expiresAt: string | null;
  montantTtc: number;
  cached: boolean;
}

/**
 * Genere (ou recupere) un lien de paiement Stripe pour une facture.
 * Le backend cree Product + Price + PaymentLink en CAD, mode one-time,
 * et stocke l'URL en DB (factures.stripe_payment_link_url). Si un lien
 * existe deja, retourne le lien cache (cached=true, pas d'appel Stripe).
 */
export async function generatePaymentLink(factureId: number): Promise<PaymentLinkResult> {
  const { data } = await api.post<PaymentLinkResult>(
    `/documents/factures/${factureId}/payment-link`,
  );
  return data;
}

// --- Envoi par courriel avec PDF (Phase 3B) ---

export interface SendDocumentEmailPayload {
  toEmail: string;
  cc?: string[];
  subject?: string;
  message?: string;
}

export interface SendDocumentEmailResponse {
  sent: boolean;
  messageId: string | null;
  toEmail: string;
  cc: string[];
  sentAt: string | null;
  pdfSizeBytes: number | null;
}

/**
 * Envoie un document (devis/facture/BT/BC) par courriel avec le PDF en
 * piece jointe. Le PDF est genere serveur-side via le meme service que
 * /pdf. Si subject ou message est vide, le serveur genere un texte par
 * defaut professionnel base sur le type de document et le numero.
 *
 * Erreurs serveur:
 *  - 404 document introuvable
 *  - 502 SMTP indisponible ou serveur courriel non configure
 *  - 503 generation PDF indisponible (libs manquantes)
 */
export async function sendDocumentByEmail(
  docType: DocType,
  docId: number,
  payload: SendDocumentEmailPayload,
): Promise<SendDocumentEmailResponse> {
  const { data } = await api.post<SendDocumentEmailResponse>(
    `/documents/${docType}/${docId}/email`,
    {
      toEmail: payload.toEmail,
      cc: payload.cc ?? [],
      subject: payload.subject ?? '',
      message: payload.message ?? '',
    },
  );
  return data;
}

// --- Factures recurrentes (Phase 5C) ---

export type RecurrentFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurrentInvoicePayload {
  frequency: RecurrentFrequency;
  description?: string;
  /** ISO date YYYY-MM-DD; sinon le serveur calcule today + 1 tick */
  startDate?: string;
}

export interface RecurrentInvoiceConfig {
  id: number;
  source_facture_id: number;
  source_numero: string | null;
  source_client_nom: string | null;
  source_montant_total: number | null;
  client_company_id: number | null;
  frequency: RecurrentFrequency;
  next_run_at: string;
  last_run_at: string | null;
  runs_count: number;
  active: boolean;
  description: string | null;
  created_by: number | null;
  created_at: string | null;
}

export interface RecurrentRunItem {
  config_id: number;
  source_facture_id: number;
  status: 'created' | 'skipped' | 'failed' | 'dry_run';
  new_facture_id: number | null;
  new_numero: string | null;
  next_run_at: string | null;
  error: string | null;
}

export interface RecurrentRunResult {
  processed: number;
  created_facture_ids: number[];
  dry_run: boolean;
  items: RecurrentRunItem[];
}

/**
 * Marque une facture comme template recurrent. Le backend stocke une config
 * dans public.mobile_recurrent_invoices_config. Le endpoint /recurrent/run
 * (cron ou manuel) dupliquera la facture source a chaque next_run_at.
 *
 * Necessite role ADMIN ou MANAGER.
 */
export async function createRecurrentInvoice(
  factureId: number,
  payload: RecurrentInvoicePayload,
): Promise<RecurrentInvoiceConfig> {
  const body: Record<string, unknown> = { frequency: payload.frequency };
  if (payload.description !== undefined) body.description = payload.description;
  if (payload.startDate !== undefined && payload.startDate !== '') {
    body.start_date = payload.startDate;
  }
  const { data } = await api.post<RecurrentInvoiceConfig>(
    `/factures/${factureId}/recurrent`,
    body,
  );
  return data;
}

/** Liste les configs recurrentes du tenant courant (Bearer requis). */
export async function listRecurrentInvoices(): Promise<RecurrentInvoiceConfig[]> {
  const { data } = await api.get<RecurrentInvoiceConfig[]>('/factures/recurrent');
  return data;
}

/** Toggle active=NOT active (pause / reactive). ADMIN/MANAGER requis. */
export async function toggleRecurrentInvoice(
  configId: number,
): Promise<RecurrentInvoiceConfig> {
  const { data } = await api.post<RecurrentInvoiceConfig>(
    `/factures/recurrent/${configId}/toggle`,
  );
  return data;
}

/** Hard delete d'une config recurrente. ADMIN/MANAGER requis. */
export async function deleteRecurrentInvoice(configId: number): Promise<void> {
  await api.delete(`/factures/recurrent/${configId}`);
}

/**
 * Genere les factures dues (next_run_at <= NOW()) en dupliquant les sources.
 * Si dryRun=true, simule sans rien creer ni avancer next_run_at. ADMIN requis.
 */
export async function runRecurrentInvoices(dryRun = false): Promise<RecurrentRunResult> {
  const { data } = await api.post<RecurrentRunResult>(
    '/factures/recurrent/run',
    { dry_run: dryRun },
  );
  return data;
}
