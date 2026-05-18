/**
 * ERP React Frontend - Devis API Module
 */

import api from './client';

export interface Devis {
  id: number;
  numeroDevis: string;
  nomProjet: string;
  description?: string;
  statut: string;
  clientCompanyId?: number;
  clientContactId?: number;
  clientNomCache?: string;
  clientNomDirect?: string;
  clientNom?: string;
  projectId?: string;
  opportunityId?: number;
  numeroOpportunite?: string;
  totalTravaux?: number;
  tps?: number;
  tvq?: number;
  investissementTotal?: number;
  administration?: number;
  contingences?: number;
  profit?: number;
  totalAvantTaxes?: number;
  administrationPct?: number;
  contingencesPct?: number;
  profitPct?: number;
  showAdministration?: boolean;
  showContingences?: boolean;
  showProfit?: boolean;
  administrationLabel?: string;
  contingencesLabel?: string;
  profitLabel?: string;
  showUnite?: boolean;
  showQuantite?: boolean;
  showPrixUnitaire?: boolean;
  showMontantLigne?: boolean;
  showMoMat?: boolean;
  conditionsText?: string;
  exclusionsText?: string;
  showConditions?: boolean;
  showExclusions?: boolean;
  dateSoumis?: string;
  datePrevu?: string;
  dateFin?: string;
  poClient?: string;
  priorite?: string;
  tache?: string;
  prixEstime?: number;
  // 'Budgétaire' (estimation indicative) | 'Détaillée' (soumission ferme ventilée)
  typeSoumission?: string;
  createdAt?: string;
  updatedAt?: string;
  lignes?: DevisLigne[];
}

export type TypeSoumission = 'Budgétaire' | 'Détaillée';
export const TYPE_SOUMISSION_OPTIONS: ReadonlyArray<{ value: TypeSoumission; label: string }> = [
  { value: 'Détaillée', label: 'Détaillée' },
  { value: 'Budgétaire', label: 'Budgétaire' },
];

export interface DevisLigne {
  id: number;
  description: string;
  quantite: number;
  unite: string;
  prixUnitaire: number;
  montantLigne: number;
  sequenceLigne: number;
  categorie?: string;
  notesLigne?: string;
  codeArticle?: string;
  visible?: boolean;
  // Custom MO/MAT ratios (0-100). If both null/undefined, auto-detection via
  // keyword matching is used in the HTML export.
  moPct?: number | null;
  matPct?: number | null;
  // Per-line markup overrides (0-100). NULL/undefined = inherit the
  // devis-level administration_pct / contingences_pct / profit_pct. Set on
  // a specific line to apply a custom margin to it only — internal pricing
  // tool, never displayed to the client.
  adminPctLigne?: number | null;
  contingencePctLigne?: number | null;
  profitPctLigne?: number | null;
}

export async function listDevis(params: {
  page?: number; perPage?: number; search?: string; statut?: string;
  typeSoumission?: string;
} = {}): Promise<{ items: Devis[]; total: number; page: number; perPage: number }> {
  const { data } = await api.get('/devis', { params });
  return data;
}

export async function getDevis(id: number): Promise<Devis> {
  const { data } = await api.get(`/devis/${id}`);
  return data;
}

export async function createDevis(body: {
  nomProjet: string; clientCompanyId?: number; clientContactId?: number;
  clientNomDirect?: string; projectId?: string; description?: string;
  datePrevu?: string; dateSoumis?: string; dateFin?: string; poClient?: string;
  priorite?: string; tache?: string; prixEstime?: number;
  notes?: string;
  totalTravaux?: number; administration?: number; contingences?: number;
  profit?: number; totalAvantTaxes?: number; tps?: number; tvq?: number;
  investissementTotal?: number; statut?: string;
  typeSoumission?: string;
}): Promise<{ id: number; numeroDevis: string }> {
  const { data } = await api.post('/devis', body);
  return data;
}

export async function updateDevis(id: number, body: Partial<Devis>): Promise<void> {
  await api.put(`/devis/${id}`, body);
}

export interface DevisDefaults {
  conditions: string;
  exclusions: string;
  conditionsFallback: string;
  exclusionsFallback: string;
}

export async function getDevisDefaults(): Promise<DevisDefaults> {
  const { data } = await api.get('/devis/defaults');
  return data;
}

export async function updateDevisDefaults(body: {
  conditions?: string;
  exclusions?: string;
}): Promise<{ message: string; conditions: string; exclusions: string }> {
  const { data } = await api.put('/devis/defaults', body);
  return data;
}

export async function addDevisLigne(devisId: number, body: {
  description: string; quantite?: number; unite?: string;
  prixUnitaire?: number; categorie?: string; notesLigne?: string; sequenceLigne?: number;
  moPct?: number | null; matPct?: number | null;
  adminPctLigne?: number | null; contingencePctLigne?: number | null; profitPctLigne?: number | null;
}): Promise<{ id: number; montantLigne: number }> {
  const { data } = await api.post(`/devis/${devisId}/lignes`, body);
  return data;
}

export async function updateDevisLigne(devisId: number, ligneId: number, body: {
  description: string; quantite?: number; unite?: string;
  prixUnitaire?: number; categorie?: string; notesLigne?: string; sequenceLigne?: number;
  moPct?: number | null; matPct?: number | null;
  adminPctLigne?: number | null; contingencePctLigne?: number | null; profitPctLigne?: number | null;
}): Promise<{ id: number; montantLigne: number }> {
  const { data } = await api.put(`/devis/${devisId}/lignes/${ligneId}`, body);
  return data;
}

export async function toggleDevisLigneVisibility(
  devisId: number, ligneId: number, visible: boolean
): Promise<void> {
  await api.patch(`/devis/${devisId}/lignes/${ligneId}/visibility`, { visible });
}

export async function deleteDevisLigne(devisId: number, ligneId: number): Promise<void> {
  await api.delete(`/devis/${devisId}/lignes/${ligneId}`);
}

export async function addDevisLignesBatch(devisId: number, items: {
  description: string; quantite?: number; unite?: string;
  prixUnitaire?: number; categorie?: string; notesLigne?: string; sequenceLigne?: number;
}[]): Promise<{ ids: number[]; count: number; message: string }> {
  const { data } = await api.post(`/devis/${devisId}/lignes/batch`, items);
  return data;
}

// ============ HTML Generation & Send ============

export interface GenerateHtmlResponse {
  html: string;
  devisId: number;
  numero: string;
}

export interface SendDevisResponse {
  sent: boolean;
  email: string;
  publicUrl: string;
  token: string;
  emailSent: boolean;
  message: string;
}

export interface PublicDevisResponse {
  devis: Devis;
  lignes: DevisLigne[];
  html: string;
  enterpriseName: string;
}

export async function generateHtml(devisId: number): Promise<GenerateHtmlResponse> {
  const { data } = await api.post(`/devis/${devisId}/generate-html`);
  return data;
}

export interface PreviewHtmlItem {
  description: string;
  quantite?: number;
  unite?: string;
  prixUnitaire?: number;
  categorie?: string;
  notesLigne?: string;
  sequenceLigne?: number;
}

export interface PreviewHtmlResponse {
  html: string;
  devisId: number;
  numero: string;
  extraItemsCount: number;
}

export async function previewHtmlWithItems(
  devisId: number,
  extraItems: PreviewHtmlItem[],
): Promise<PreviewHtmlResponse> {
  const { data } = await api.post(`/devis/${devisId}/preview-html-with-items`, { extraItems });
  return data;
}

export async function sendDevis(devisId: number, email: string): Promise<SendDevisResponse> {
  const { data } = await api.post(`/devis/${devisId}/send`, { email });
  return data;
}

export async function exportDevisXlsx(devisId: number, numeroDevis: string): Promise<void> {
  const response = await api.get(`/devis/${devisId}/export-xlsx`, {
    responseType: 'blob',
  });
  const blob = new Blob([response.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${numeroDevis || `devis-${devisId}`}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function getPublicDevis(token: string): Promise<PublicDevisResponse> {
  const { data } = await api.get(`/devis/public/${token}`);
  return data;
}

export async function acceptDevis(
  token: string,
  clientNomSignature: string,
  signatureData?: string,
): Promise<{ accepted: boolean; message: string }> {
  const { data } = await api.post(`/devis/public/${token}/accept`, {
    clientNomSignature,
    signatureData: signatureData || undefined,
  });
  return data;
}

export async function refuseDevis(token: string, raison?: string): Promise<{ refused: boolean; message: string }> {
  const { data } = await api.post(`/devis/public/${token}/refuse`, { raison });
  return data;
}

// Statistics
export async function getDevisStatistics() {
  const { data } = await api.get('/devis/statistics');
  return data;
}

// Convert to project. Idempotent: returns `created: false` when the devis
// was already linked to a project (instead of raising 400 as before).
// The axios interceptor in `client.ts` converts snake_case → camelCase, so
// the backend's `project_id` arrives as `projectId` on this side.
export interface ConvertDevisToProjectResponse {
  projectId: number;
  devisId?: number;
  opportunityUpdated?: boolean;
  created?: boolean;
  message: string;
}

export async function convertDevisToProject(devisId: number): Promise<ConvertDevisToProjectResponse> {
  const { data } = await api.post(`/devis/${devisId}/convert-to-project`);
  return data;
}

// CCQ calculation
export async function calculateCCQ(body: { montantMainOeuvre: number; metiers?: string[] }) {
  const { data } = await api.post('/devis/calculate-ccq', body);
  return data;
}

// CNESST calculation
export async function calculateCNESST(body: { montantMainOeuvre: number; tauxUnite?: number }) {
  const { data } = await api.post('/devis/calculate-cnesst', body);
  return data;
}

// AI estimation
// Mode precision (Extended Thinking) optionnel : Claude utilise un budget de
// 4000 thinking tokens pour raisonner avant de produire la reponse finale.
// Plus precis (~60-90s vs 30s, ~3x plus cher).
export interface AiEstimateResult {
  estimation: string;
  devis_id: number;
  nom_projet?: string;
  precision_mode_used?: boolean;
  thinking_tokens?: number;
  usage: { input_tokens: number; output_tokens: number; cost_usd: number };
}

export async function aiEstimateDevis(
  devisId: number,
  opts?: { precisionMode?: boolean },
): Promise<AiEstimateResult> {
  // Defaut: precision_mode=true (Extended Thinking active par defaut, ~3x cost).
  // Si caller passe explicitement precisionMode=false, on respecte ce choix.
  const body: { precision_mode: boolean } = {
    precision_mode: opts?.precisionMode ?? true,
  };
  const { data } = await api.post(`/devis/${devisId}/ai-estimate`, body);
  return data;
}

// AI estimation avec analyse Vision d'un plan PDF/image.
// Mode precision (Extended Thinking) optionnel : Claude raisonne avec un budget
// de 4000 thinking tokens avant de produire la reponse finale (~3x plus cher).
// Retourne une analyse structuree en markdown avec :
//   - verification des lignes existantes vs plan
//   - items potentiellement oublies (CCQ checklist)
//   - recommandations + estimation globale
export interface AiEstimateWithPlanResult {
  estimation: string;
  devis_id: number;
  filename: string;
  precision_mode_used: boolean;
  thinking_tokens: number;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  claude_model: string;
}

export async function aiEstimateDevisWithPlan(
  devisId: number,
  file: File,
  opts?: {
    precisionMode?: boolean;
    additionalContext?: string;
    onUploadProgress?: (progressEvent: { loaded: number; total?: number }) => void;
  },
): Promise<AiEstimateWithPlanResult> {
  const formData = new FormData();
  formData.append('file', file);
  // Defaut: precision_mode=true (Extended Thinking active par defaut, ~3x cost).
  formData.append('precision_mode', String(opts?.precisionMode ?? true));
  if (opts?.additionalContext) {
    formData.append('additional_context', opts.additionalContext);
  }
  const { data } = await api.post(`/devis/${devisId}/ai-estimate-with-plan`, formData, {
    onUploadProgress: opts?.onUploadProgress,
  });
  return data;
}

// AI document analysis — diagnostic Entrepreneur general, detecte categorie
// + persiste le document dans conversation_documents (si conversationId fourni)
export async function aiAnalyzeDocument(
  file: File,
  onUploadProgress?: (progressEvent: { loaded: number; total?: number }) => void,
  conversationId?: number,
): Promise<{
  summary: string;
  filename: string;
  documentId?: number;
  category?: string;
  subcategory?: string;
  superficiePi2?: number;  // Superficie A ESTIMER (zones touchees)
  superficieRenovationPi2?: number;  // Zone B
  superficieAgrandissementPi2?: number;  // Zone C
  superficieExistantConservePi2?: number;  // Zone A (non estimee)
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    costUsd?: number;
  };
}> {
  const formData = new FormData();
  formData.append('file', file);
  if (conversationId) formData.append('conversation_id', String(conversationId));
  const { data } = await api.post('/devis/ai-analyze-document', formData, {
    onUploadProgress,
  });
  return data;
}

// ---- Conversation Documents (plans, devis PDF, Excel, etc. persistes en BD) ----

export interface ConversationDocument {
  id: number;
  filename: string;
  mediaType?: string;
  fileSize?: number;
  summary?: string;
  category?: string;
  subcategory?: string;
  superficiePi2?: number;
  superficieRenovationPi2?: number;
  superficieAgrandissementPi2?: number;
  superficieExistantConservePi2?: number;
  isActiveContext: boolean;
  createdAt: string;
}

export async function listConversationDocuments(conversationId: number): Promise<{ items: ConversationDocument[] }> {
  const { data } = await api.get(`/devis/conversations/${conversationId}/documents`);
  return data;
}

export async function toggleConversationDocument(conversationId: number, docId: number): Promise<{ id: number; isActiveContext: boolean }> {
  const { data } = await api.put(`/devis/conversations/${conversationId}/documents/${docId}/toggle`);
  return data;
}

export async function deleteConversationDocument(conversationId: number, docId: number): Promise<{ message: string }> {
  const { data } = await api.delete(`/devis/conversations/${conversationId}/documents/${docId}`);
  return data;
}

export async function downloadConversationDocument(conversationId: number, docId: number, filename: string): Promise<void> {
  // Fetch avec axios (gere l'auth Bearer via interceptor) puis triggere le
  // download via blob + URL.createObjectURL. Un simple <a href> ne peut pas
  // passer le header Authorization donc ne fonctionne pas avec JWT.
  const response = await api.get(`/devis/conversations/${conversationId}/documents/${docId}/download`, {
    responseType: 'blob',
  });
  const blob = response.data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke apres delai pour laisser le browser initier le DL
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ============ Devis Assignments ============

export interface DevisAssignment {
  id: number;
  devisId: number;
  employeeId: number;
  employeNom: string;
  role?: string;
}

export async function listDevisAssignments(devisId: number): Promise<{ items: DevisAssignment[] }> {
  const { data } = await api.get(`/devis/${devisId}/assignments`);
  return data;
}

export async function addDevisAssignment(devisId: number, body: { employeeId: number; role?: string }): Promise<{ id: number }> {
  const { data } = await api.post(`/devis/${devisId}/assignments`, body);
  return data;
}

export async function removeDevisAssignment(devisId: number, assignmentId: number): Promise<void> {
  await api.delete(`/devis/${devisId}/assignments/${assignmentId}`);
}

// ============ Estimation IA ============

export interface ExpertProfile {
  id: string;
  name: string;
  filename: string;
  source?: 'system' | 'custom';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SoumissionItem {
  description: string;
  quantite: number;
  unite: string;
  prixUnitaire: number;
  montantLigne: number;
  categorie: string;
}

export interface Conversation {
  id: number;
  name: string;
  devisId?: number;
  subject?: string;
  status: string;
  messages?: ChatMessage[];
  metadata?: string;
  createdAt?: string;
  updatedAt?: string;
}

export async function listExpertProfiles(): Promise<{ profiles: ExpertProfile[] }> {
  const { data } = await api.get('/devis/expert-profiles');
  return data;
}

export async function aiChat(body: {
  messages: ChatMessage[];
  profileId?: string;
  devisId?: number;
  conversationId?: number;
}): Promise<{
  response: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    costUsd?: number;
  };
}> {
  const { data } = await api.post('/devis/ai-chat', {
    messages: body.messages,
    profile_id: body.profileId,
    devis_id: body.devisId,
    conversation_id: body.conversationId,
  });
  return data;
}

export async function aiChatWithFiles(body: {
  messages: ChatMessage[];
  profileId?: string;
  devisId?: number;
  conversationId?: number;
  files: File[];
}): Promise<{
  response: string;
  persistedFiles?: Array<{ id: number; filename: string }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    costUsd?: number;
  };
}> {
  const formData = new FormData();
  formData.append('messages_json', JSON.stringify(body.messages));
  if (body.profileId) formData.append('profile_id', body.profileId);
  if (body.devisId) formData.append('devis_id', String(body.devisId));
  if (body.conversationId) formData.append('conversation_id', String(body.conversationId));
  body.files.forEach(f => formData.append('files', f));
  const { data } = await api.post('/devis/ai-chat-with-files', formData);
  return data;
}

export async function aiGenerateSoumission(body: {
  messages: ChatMessage[];
  projetType?: string;
  superficie?: number;
  profileId?: string;
}): Promise<{ items: SoumissionItem[]; rawResponse?: string; usage?: { inputTokens: number; outputTokens: number } }> {
  const { data } = await api.post('/devis/ai-generate-soumission', {
    messages: body.messages,
    projet_type: body.projetType,
    profile_id: body.profileId,
    superficie: body.superficie,
  });
  return data;
}

export async function listConversations(): Promise<{ items: Conversation[] }> {
  const { data } = await api.get('/devis/conversations');
  return data;
}

export async function saveConversation(body: {
  name: string;
  devisId?: number;
  subject?: string;
  messages: ChatMessage[];
  expertProfile?: string;
  metadata?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/devis/conversations', {
    name: body.name,
    devis_id: body.devisId,
    subject: body.subject,
    messages: body.messages,
    expert_profile: body.expertProfile,
    metadata: body.metadata,
  });
  return data;
}

export async function updateConversation(id: number, body: {
  name: string;
  devisId?: number;
  subject?: string;
  messages: ChatMessage[];
  expertProfile?: string;
  metadata?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/devis/conversations/${id}`, {
    name: body.name,
    devis_id: body.devisId,
    subject: body.subject,
    messages: body.messages,
    expert_profile: body.expertProfile,
    metadata: body.metadata,
  });
  return data;
}

export async function getConversation(id: number): Promise<Conversation> {
  const { data } = await api.get(`/devis/conversations/${id}`);
  return data;
}

export async function deleteDevis(id: number): Promise<void> {
  await api.delete(`/devis/${id}`);
}

export async function batchUpdateDevis(body: {
  devisIds: (string | number)[]; statut?: string;
}): Promise<{ updated: number; message: string }> {
  const { data } = await api.post('/devis/batch-update', {
    devis_ids: body.devisIds,
    statut: body.statut,
  });
  return data;
}

export async function deleteConversation(id: number): Promise<void> {
  await api.delete(`/devis/conversations/${id}`);
}

// Rename une conversation (sans toucher aux messages). Endpoint PATCH dedie.
export async function renameConversation(id: number, name: string): Promise<{ id: number; name: string; message: string }> {
  const { data } = await api.patch(`/devis/conversations/${id}`, { name });
  return data;
}

// ============ Custom AI Profiles ============

export interface CustomAiProfile {
  id: number;
  name: string;
  instructions: string;
  isActive: boolean;
  documentCount?: number;
  createdBy?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AiProfileDocument {
  id: number;
  originalName: string;
  contentType?: string;
  fileSize: number;
  extractedTextLength: number;
  createdAt?: string;
}

export async function listCustomProfiles(): Promise<{ items: CustomAiProfile[] }> {
  const { data } = await api.get('/devis/ai-profiles');
  return data;
}

export async function createCustomProfile(body: {
  name: string;
  instructions: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/devis/ai-profiles', body);
  return data;
}

export async function getCustomProfile(id: number): Promise<CustomAiProfile & { documents: AiProfileDocument[] }> {
  const { data } = await api.get(`/devis/ai-profiles/${id}`);
  return data;
}

export async function updateCustomProfile(id: number, body: {
  name?: string;
  instructions?: string;
  isActive?: boolean;
}): Promise<{ message: string }> {
  const { data } = await api.put(`/devis/ai-profiles/${id}`, body);
  return data;
}

export async function deleteCustomProfile(id: number): Promise<{ message: string }> {
  const { data } = await api.delete(`/devis/ai-profiles/${id}`);
  return data;
}

export async function uploadProfileDocument(profileId: number, file: File): Promise<{
  id: number;
  originalName: string;
  fileSize: number;
  extractedTextLength: number;
  message: string;
}> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post(`/devis/ai-profiles/${profileId}/documents`, formData);
  return data;
}

export async function deleteProfileDocument(profileId: number, docId: number): Promise<{ message: string }> {
  const { data } = await api.delete(`/devis/ai-profiles/${profileId}/documents/${docId}`);
  return data;
}
