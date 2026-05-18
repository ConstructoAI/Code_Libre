/**
 * ERP React Frontend - Emails API Module (Multi-Account IMAP/SMTP/OAuth + IA)
 *
 * Port de la version Streamlit modules/email_manager. Multi-comptes par
 * tenant: Gmail / Outlook / Yahoo / iCloud / GoDaddy / Microsoft 365 /
 * Autre. Auth: mot de passe applicatif (Fernet) ou OAuth2 XOAUTH2.
 *
 * Inclus Assistant IA Claude pour suggerer / rediger / repondre auto avec
 * contexte BD construction Quebec (devis, projets, factures, BT, opportunites).
 */

import api from './client';

// ============ Types ============

export interface EmailAccount {
  id: number;
  accountName?: string;
  emailAddress: string;
  provider?: string;
  name?: string;
  imapServer?: string | null;
  imapPort?: number | null;
  imapUseSsl?: boolean;
  imapUsername?: string | null;
  smtpServer?: string | null;
  smtpPort?: number | null;
  smtpUseTls?: boolean;
  smtpUsername?: string | null;
  syncEnabled?: boolean;
  syncIntervalMinutes?: number;
  syncFolders?: string;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
  signatureHtml?: string | null;
  signatureText?: string | null;
  isDefault: boolean;
  active?: boolean;
  totalSent?: number;
  totalReceived?: number;
  createdAt?: string;
  updatedAt?: string;
  oauthProvider?: string | null;
  oauthExpiresAt?: string | null;
  hasPassword?: boolean;
  hasOauth?: boolean;
}

export interface EmailMessage {
  id: number;
  accountId: number;
  threadId?: string;
  messageId?: string;
  emailFrom: string;
  emailFromName?: string;
  emailTo: string;
  emailCc?: string;
  emailBcc?: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  dateSent?: string;
  dateReceived?: string;
  dateRead?: string;
  isRead: boolean;
  isStarred: boolean;
  folder: string;
  labelsJson?: string;
  companyId?: number;
  contactId?: number;
  projectId?: number;
  createdAt?: string;
  hasAttachments?: boolean;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  id: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  isInline?: boolean;
  cid?: string;
  createdAt?: string;
}

export interface EmailThread {
  threadId: string;
  subject: string;
  messageCount: number;
  messages?: EmailMessage[];
}

export interface FolderStats {
  unreadCount: number;
  totalCount: number;
}

export interface EmailTemplate {
  id: number;
  code: string;
  name: string;
  description?: string;
  category: string;
  subjectTemplate: string;
  bodyHtmlTemplate: string;
  bodyTextTemplate?: string;
  variables: string[];
  usageCount: number;
  lastUsedAt?: string;
  isSystem: boolean;
}

export interface EmailProvider {
  name: string;
  imapServer: string;
  imapPort: number;
  imapUseSsl: boolean;
  smtpServer: string;
  smtpPort: number;
  smtpUseTls: boolean;
  helpUrl: string;
  instructions: string;
  oauthSupported: boolean;
  oauthAvailable: boolean;
}

export interface ProviderDetect {
  provider: string;
  imapServer: string;
  imapPort: number;
  imapUseSsl: boolean;
  smtpServer: string;
  smtpPort: number;
  smtpUseTls: boolean;
  instructions: string;
  helpUrl: string;
}

export interface AccountTestResult {
  imap: { ok: boolean; error?: string | null };
  smtp: { ok: boolean; error?: string | null };
}

export interface AccountCreatePayload {
  accountName: string;
  emailAddress: string;
  provider?: string;
  imapServer: string;
  imapPort?: number;
  imapUseSsl?: boolean;
  imapUsername?: string;
  smtpServer: string;
  smtpPort?: number;
  smtpUseTls?: boolean;
  smtpUsername?: string;
  password?: string;
  syncEnabled?: boolean;
  syncFolders?: string;
  signatureHtml?: string;
  signatureText?: string;
  isDefault?: boolean;
}

export interface AccountUpdatePayload {
  accountName?: string;
  provider?: string;
  imapServer?: string;
  imapPort?: number;
  imapUseSsl?: boolean;
  imapUsername?: string;
  smtpServer?: string;
  smtpPort?: number;
  smtpUseTls?: boolean;
  smtpUsername?: string;
  password?: string;
  syncEnabled?: boolean;
  syncFolders?: string;
  signatureHtml?: string;
  signatureText?: string;
  isDefault?: boolean;
  active?: boolean;
}

export type SyncMode = 'new' | 'recent' | 'all';

export interface SyncResult {
  success: boolean;
  newEmails: number;
  errors: number;
  errorMessage?: string | null;
}

export interface SyncAllResult {
  totalAccounts: number;
  successCount: number;
  totalNewEmails: number;
  errors: { account?: string; error?: string }[];
}

export interface SyncLogEntry {
  id: number;
  accountId: number;
  accountName?: string;
  emailAddress?: string;
  syncStartedAt?: string;
  syncCompletedAt?: string;
  syncStatus?: string;
  newEmailsCount?: number;
  errorsCount?: number;
  errorMessage?: string;
  folders?: string[];
}

// ============ Accounts (multi-comptes) ============

export async function listAccounts(): Promise<{ items: EmailAccount[] }> {
  const { data } = await api.get('/emails/accounts');
  return data;
}

export async function createAccount(
  body: AccountCreatePayload,
): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/emails/accounts', body);
  return data;
}

export async function updateAccount(
  id: number,
  body: AccountUpdatePayload,
): Promise<{ message: string }> {
  const { data } = await api.put(`/emails/accounts/${id}`, body);
  return data;
}

export async function deleteAccount(id: number): Promise<{ message: string }> {
  const { data } = await api.delete(`/emails/accounts/${id}`);
  return data;
}

export async function testAccount(id: number): Promise<AccountTestResult> {
  const { data } = await api.post(`/emails/accounts/${id}/test`);
  return data;
}

export async function restoreLegacyAccounts(): Promise<{
  restored: number;
  message: string;
}> {
  const { data } = await api.post('/emails/accounts/restore-legacy');
  return data;
}

// ============ Providers + OAuth ============

export async function listProviders(): Promise<{ items: EmailProvider[] }> {
  const { data } = await api.get('/emails/providers');
  return data;
}

export async function detectProvider(email: string): Promise<ProviderDetect> {
  const { data } = await api.get('/emails/providers/detect', {
    params: { email },
  });
  return data;
}

export async function getOauthAuthUrl(
  provider: 'google' | 'microsoft',
): Promise<{ authUrl: string }> {
  const { data } = await api.get(`/emails/oauth/${provider}/auth-url`);
  return data;
}

// ============ Messages ============

export async function listMessages(params: {
  folder?: string;
  search?: string;
  isRead?: boolean;
  isStarred?: boolean;
  page?: number;
  perPage?: number;
} = {}): Promise<{
  items: EmailMessage[];
  total: number;
  page: number;
  perPage: number;
}> {
  const { data } = await api.get('/emails/messages', { params });
  return data;
}

export async function getMessage(id: number): Promise<EmailMessage> {
  const { data } = await api.get(`/emails/messages/${id}`);
  return data;
}

export async function markAsRead(id: number): Promise<void> {
  await api.put(`/emails/messages/${id}/read`);
}

export async function toggleStar(
  id: number,
): Promise<{ isStarred: boolean }> {
  const { data } = await api.put(`/emails/messages/${id}/star`);
  return data;
}

export async function moveMessage(id: number, folder: string): Promise<void> {
  await api.put(`/emails/messages/${id}/move`, { folder });
}

export async function deleteMessage(id: number): Promise<void> {
  await api.delete(`/emails/messages/${id}`);
}

export async function sendEmail(body: {
  emailTo: string;
  emailCc?: string;
  emailBcc?: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  threadId?: string;
  templateCode?: string;
  templateVariables?: Record<string, string>;
  accountId?: number;
}): Promise<{
  id: number;
  smtpSent: boolean;
  message: string;
  smtpError?: string;
}> {
  const { data } = await api.post('/emails/messages/send', body);
  return data;
}

// ============ Templates ============

export async function listTemplates(): Promise<{ items: EmailTemplate[] }> {
  const { data } = await api.get('/emails/templates');
  return data;
}

// ============ Attachments ============

export function getAttachmentDownloadUrl(attachmentId: number): string {
  return `/emails/attachments/${attachmentId}/download`;
}

export async function downloadAttachment(
  attachmentId: number,
): Promise<Blob> {
  const { data } = await api.get(
    `/emails/attachments/${attachmentId}/download`,
    { responseType: 'blob' },
  );
  return data;
}

// ============ Threads ============

export async function getThread(threadId: string): Promise<EmailThread> {
  const { data } = await api.get(`/emails/threads/${threadId}`);
  return data;
}

// ============ Stats ============

export async function getStats(): Promise<{
  folders: Record<string, FolderStats>;
  lastSyncAt?: string | null;
}> {
  const { data } = await api.get('/emails/stats');
  return data;
}

// ============ Sync ============

export async function syncAccount(
  id: number,
  mode: SyncMode = 'new',
  folders?: string[],
): Promise<SyncResult> {
  const { data } = await api.post(`/emails/accounts/${id}/sync`, {
    mode,
    folders,
  });
  return data;
}

export async function syncAllAccounts(
  mode: SyncMode = 'new',
  folders?: string[],
): Promise<SyncAllResult> {
  const { data } = await api.post('/emails/sync/all', { mode, folders });
  return data;
}

export async function listSyncHistory(
  limit = 50,
): Promise<{ items: SyncLogEntry[] }> {
  const { data } = await api.get('/emails/sync-history', {
    params: { limit },
  });
  return data;
}


// ============ Assistant IA (suggest reply / auto-reply / analyze / draft) ============
//
// IMPORTANT: l'intercepteur axios `client.ts:97-113` convertit toutes les
// reponses de snake_case -> camelCase. Le backend retourne `donnees_utilisees`,
// `contexte_client`, `actions_requises`, etc., mais le frontend recoit
// `donneesUtilisees`, `contexteClient`, `actionsRequises`. Les types ci-dessous
// sont DONC en camelCase pour matcher la valeur reellement disponible cote
// frontend.

export type AITone = 'professionnel' | 'cordial' | 'formel';

export interface AISuggestion {
  titre: string;
  sujet: string;
  corps: string;
  longueur: 'courte' | 'moyenne' | 'detaillee';
  donneesUtilisees?: string[];
}

export interface AISuggestReplyResponse {
  analyse?: {
    intentionExpediteur?: string;
    urgence?: 'haute' | 'moyenne' | 'basse';
    type?: string;
  };
  contexteClient?: {
    clientConnu?: boolean;
    resume?: string;
  };
  suggestions?: AISuggestion[];
  aInclure?: string[];
  aEviter?: string[];
  dbContextUsed?: boolean;
  raw?: string;
  error?: string;
}

export interface AIAnalyzeResponse {
  urgence?: 'haute' | 'moyenne' | 'basse';
  type?: string;
  sentiment?: string;
  resume?: string;
  actionsRequises?: { action: string; echeance: string }[];
  alertes?: string[];
  liensErpSuggeres?: { devis?: string | null; projet?: string | null };
  raw?: string;
}

export interface AIDraftResponse {
  sujet?: string;
  corps?: string;
  versionCourte?: string;
  meilleurMomentEnvoi?: string;
  raw?: string;
}

export interface AIAutoReplyResponse {
  sent: boolean;
  emailId?: number;
  subject?: string;
  body?: string;
  confiance?: 'haute' | 'moyenne' | 'basse';
  raisonConfiance?: string;
  smtpError?: string | null;
}

export async function aiSuggestReply(
  emailId: number,
  tone: AITone = 'professionnel',
  additionalContext?: string,
  signal?: AbortSignal,
): Promise<AISuggestReplyResponse> {
  const { data } = await api.post('/emails/ai/suggest-reply', {
    emailId, tone, additionalContext,
  }, { signal });
  return data;
}

export async function aiAnalyzeEmail(
  emailId: number,
  signal?: AbortSignal,
): Promise<AIAnalyzeResponse> {
  const { data } = await api.post('/emails/ai/analyze', { emailId }, { signal });
  return data;
}

export async function aiDraftEmail(
  instructions: string,
  recipientEmail?: string,
  tone: AITone = 'professionnel',
  signal?: AbortSignal,
): Promise<AIDraftResponse> {
  const { data } = await api.post('/emails/ai/draft', {
    instructions, recipientEmail, tone,
  }, { signal });
  return data;
}

export async function aiAutoReply(
  emailId: number,
  tone: AITone = 'professionnel',
  accountId?: number,
  additionalContext?: string,
  signal?: AbortSignal,
): Promise<AIAutoReplyResponse> {
  const { data } = await api.post('/emails/ai/auto-reply', {
    emailId, tone, accountId, additionalContext,
  }, { signal });
  return data;
}
