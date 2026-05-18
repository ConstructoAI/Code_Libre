/**
 * SEAOP React Frontend - Service d'Estimation API
 * A single service type remains: "estimation". Clients submit a public
 * request via the wizard; admin lists/updates via the admin panel.
 */

import api from './client';
import { unwrap } from '@/utils/apiUnwrap';

// ============ Types ============

export interface EstimationMetadata {
  corpsMetiers: string[];
  secteurs: string[];
  urgences: string[];
  disponibilites: string[];
  maxPlanSizeMb?: number;
  maxPlans?: number;
}

export interface EstimationRequestInput {
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  entreprise?: string;

  corpsMetier: string;
  secteur: string;
  description: string;

  typeProjet?: string;
  superficie?: string;
  budgetEstime?: string;
  delai?: string;

  urgence?: 'normal' | 'urgent';
  disponibilite?: 'des_que_possible' | 'date_specifique';
  dateSouhaitee?: string; // ISO YYYY-MM-DD

  codePostal?: string;
  localisation?: string;

  documents?: string;
  photos?: string[];
  planIds?: string[];
  questionsSpecifiques?: Record<string, unknown>;
}

export interface EstimationRequestCreateResponse {
  id: number;
  numeroReference: string;
  adminEmailSent?: boolean;
  clientEmailSent?: boolean;
}

export interface EmailStatusResponse {
  smtpHost: string | null;
  smtpPort: number;
  smtpUser: string | null;
  smtpFromName: string;
  smtpUseSsl: boolean;
  smtpPasswordSet: boolean;
  adminNotificationEmail: string;
  configured: boolean;
}

export interface TestEmailResponse {
  success: boolean;
  detail: string;
  configured: boolean;
}

export interface ResendClientEmailResponse {
  sent: boolean;
  email: string;
}

export interface UploadedPlan {
  planId: string;
  filename: string;
  size: number;
}

// ============ Public ============

/**
 * Fetch metadata used by the wizard (available trades + sectors).
 * Public endpoint — no auth required.
 */
export async function getEstimationMetadata(): Promise<EstimationMetadata> {
  const { data } = await api.get('/services/estimation/meta');
  return data as EstimationMetadata;
}

/**
 * Submit a new estimation request. Public — no auth required.
 * Returns the saved record's id and reference number.
 */
export async function createEstimationRequest(
  payload: EstimationRequestInput,
): Promise<EstimationRequestCreateResponse> {
  const { data } = await api.post('/services/estimation', payload);
  return unwrap<EstimationRequestCreateResponse>(data, {
    id: 0,
    numeroReference: '',
    adminEmailSent: false,
    clientEmailSent: false,
  });
}

/**
 * Upload a single PDF plan (max 150 MB). Public — no auth required.
 * Returns a plan_id to include in EstimationRequestInput.planIds on submit.
 * Progress callback receives 0–100.
 */
export async function uploadEstimationPlan(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<UploadedPlan> {
  const formData = new FormData();
  formData.append('file', file);
  // The axios request interceptor (client.ts) deletes Content-Type when it
  // sees FormData, so the browser sets "multipart/form-data; boundary=..."
  // with a valid boundary. We only pass signal + onUploadProgress here.
  const { data } = await api.post(
    '/services/estimation/plans',
    formData,
    {
      signal,
      onUploadProgress: (event) => {
        if (onProgress && event.total) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      },
    },
  );
  // The response interceptor camelCases server keys (plan_id → planId). We
  // still read both forms defensively in case the interceptor is bypassed.
  const raw = data as unknown as Record<string, unknown>;
  const planId = String(raw.planId ?? raw.plan_id ?? '');
  if (!planId) {
    throw new Error('Le serveur n\'a pas retourné d\'identifiant pour le plan.');
  }
  return {
    planId,
    filename: String(raw.filename ?? ''),
    size: Number(raw.size ?? 0),
  };
}

/**
 * Diagnostic: read the SMTP configuration status (admin only, secrets redacted).
 */
export async function adminGetEmailStatus(): Promise<EmailStatusResponse> {
  const { data } = await api.get('/services/estimation/admin/email-status');
  return data as EmailStatusResponse;
}

/**
 * Diagnostic: send a test email to verify SMTP deliverability.
 */
export async function adminSendTestEmail(
  toEmail: string,
): Promise<TestEmailResponse> {
  const { data } = await api.post('/services/estimation/admin/test-email', {
    toEmail,
  });
  return data as TestEmailResponse;
}

/**
 * Download a previously uploaded PDF plan from the admin panel. The session
 * token is attached by the axios interceptor; we stream the response as a
 * Blob and trigger a download in the browser.
 */
export async function adminDownloadEstimationPlan(
  requestId: number,
  planId: string,
  filename: string,
): Promise<void> {
  try {
    const response = await api.get(
      `/services/estimation/admin/${requestId}/plans/${planId}`,
      { responseType: 'blob' },
    );
    const blob = response.data as Blob;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `plan-${planId}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err: unknown) {
    // Axios returns the error body as a Blob when responseType: 'blob'.
    // Try to extract the server's `detail` message so the caller can show
    // it instead of a generic error.
    const axiosLike = err as {
      response?: { data?: Blob | { detail?: string } };
    };
    const data = axiosLike.response?.data;
    if (data instanceof Blob) {
      try {
        const text = await data.text();
        const parsed = JSON.parse(text) as { detail?: string };
        if (parsed.detail) throw new Error(parsed.detail);
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message) throw parseErr;
      }
    } else if (data && typeof data === 'object' && 'detail' in data) {
      throw new Error(String((data as { detail?: string }).detail));
    }
    throw err;
  }
}

/**
 * Re-send the confirmation email to the client for a given estimation.
 * Returns { sent, email } so the caller can show a success/fail banner
 * and tell the admin which address the email was dispatched to.
 */
export async function adminResendClientEmail(
  requestId: number,
): Promise<ResendClientEmailResponse> {
  const { data } = await api.post(
    `/services/estimation/admin/${requestId}/resend-client-email`,
  );
  return data as ResendClientEmailResponse;
}

// ============ Admin ============

/**
 * List all estimation requests (admin only).
 */
export async function adminListEstimationRequests(
  statut?: string,
): Promise<Record<string, unknown>[]> {
  const { data } = await api.get('/services/estimation/admin', {
    params: statut ? { statut } : {},
  });
  return unwrap<Record<string, unknown>[]>(data, []);
}

/**
 * Get a single estimation request detail (admin only).
 */
export async function adminGetEstimationRequest(
  id: number,
): Promise<Record<string, unknown>> {
  const { data } = await api.get(`/services/estimation/admin/${id}`);
  return unwrap<Record<string, unknown>>(data, {});
}

/**
 * Update an estimation request (admin only).
 */
export async function adminUpdateEstimationRequest(
  id: number,
  updates: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data } = await api.put(`/services/estimation/admin/${id}`, updates);
  return unwrap<Record<string, unknown>>(data, {});
}
