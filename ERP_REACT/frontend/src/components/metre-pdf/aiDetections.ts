import api, { camelToSnakeKeys } from './api';
import type {
  AIDetection,
  AIDetectionStatus,
  AIDetectMultiSectionRequest,
  AIDetectMultiSectionResult,
  AIDetectRunRequest,
  AIDetectRunResult,
  AIQuickInventoryRequest,
  AIQuickInventoryResult,
  AvailableSections,
} from './types';

const AI_REQUEST_TIMEOUT_MS = 180_000; // 3 min pour mode précision étendue

/**
 * Retry avec backoff exponentiel pour les calls AI longs.
 *
 * SÉCURITÉ BILLING : retry UNIQUEMENT sur 429 (rate limit) et 503 (service
 * unavailable), erreurs où le backend n'a PAS encore commencé le call Claude.
 * Les timeouts (504, ECONNABORTED, ERR_NETWORK) sont VOLONTAIREMENT non-retryés
 * car le backend peut être en train de finir un workflow déjà facturé. Pour
 * retry sur timeout, implémenter Idempotency-Key + dédup backend (ticket séparé).
 */
async function _retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const status = (err as { response?: { status?: number } })?.response?.status;
      // Retry UNIQUEMENT sur erreurs où le backend n'a PAS commencé son traitement.
      // 504 (Gateway Timeout), ECONNABORTED (timeout client), ERR_NETWORK
      // sont EXCLUS car le backend peut être en train de finir un appel Claude
      // déjà facturé (sans Idempotency-Key, retry = double-billing).
      const isRetryable = status === 429 || status === 503;
      if (!isRetryable || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/**
 * Lance une detection IA (Claude Vision) sur une page d'un document.
 *
 * Le client axios applique automatiquement la conversion snake_case -> camelCase
 * sur la reponse via l'intercepteur, donc on recoit deja un AIDetectRunResult.
 *
 * PHASE 2: supporte la detection BOM-aware via section_numero + use_bom_catalog.
 */
export async function runAIDetect(
  documentId: number,
  request: AIDetectRunRequest,
): Promise<AIDetectRunResult> {
  const body = camelToSnakeKeys({
    pageNumber: request.pageNumber,
    detectionTypes: request.detectionTypes ?? ['surface', 'distance', 'count'],
    additionalContext: request.additionalContext,
    sectionNumero: request.sectionNumero,
    useBomCatalog: request.useBomCatalog,
  });
  const { data } = await _retryWithBackoff(() =>
    api.post<AIDetectRunResult>(
      `/documents/${documentId}/ai-detect`,
      body,
      { timeout: AI_REQUEST_TIMEOUT_MS },
    ),
  );
  return data;
}

/**
 * PHASE 2: Liste les sections disponibles dans le catalogue produits du tenant.
 * Reponse axios deja en camelCase grace a l'intercepteur.
 */
export async function listAvailableSections(): Promise<AvailableSections> {
  const { data } = await api.get<{ sections: string[]; sectionCount: number }>(
    '/products/sections',
  );
  return {
    sections: data?.sections ?? [],
    sectionCount: data?.sectionCount ?? 0,
  };
}

/**
 * PHASE 2: Lance une detection IA sur plusieurs sections du catalogue.
 * Pour chaque section, le backend genere un calque dedie avec ses detections.
 * Reponse axios deja en camelCase grace a l'intercepteur.
 */
export async function runAIDetectMultiSection(
  documentId: number,
  request: AIDetectMultiSectionRequest,
): Promise<AIDetectMultiSectionResult> {
  const body = {
    page_number: request.pageNumber,
    sections: request.sections,
    auto_create_layer_per_section: request.autoCreateLayerPerSection ?? true,
    additional_context: request.additionalContext,
  };
  const { data } = await _retryWithBackoff(() =>
    api.post<{
      pageNumber: number;
      sectionsProcessed: string[];
      sectionsFailed: string[];
      sectionsEmptyBom?: string[];
      totalDetections: number;
      totalCostUsd: number;
      totalTokensIn: number;
      totalTokensOut: number;
      detectionsBySection: Record<string, number>;
      bomTruncatedSections?: string[];
    }>(`/documents/${documentId}/ai-detect-multi-section`, body, {
      timeout: AI_REQUEST_TIMEOUT_MS,
    }),
  );
  return {
    pageNumber: data.pageNumber,
    sectionsProcessed: data.sectionsProcessed ?? [],
    sectionsFailed: data.sectionsFailed ?? [],
    sectionsEmptyBom: data.sectionsEmptyBom ?? [],
    totalDetections: data.totalDetections ?? 0,
    totalCostUsd: data.totalCostUsd ?? 0,
    totalTokensIn: data.totalTokensIn ?? 0,
    totalTokensOut: data.totalTokensOut ?? 0,
    detectionsBySection: data.detectionsBySection ?? {},
    bomTruncatedSections: data.bomTruncatedSections ?? [],
  };
}

/**
 * Liste les detections IA pour un document, optionnellement filtrees par
 * page et/ou statut.
 */
export async function listAIDetections(
  documentId: number,
  options?: { pageNumber?: number; status?: AIDetectionStatus },
): Promise<AIDetection[]> {
  const params: Record<string, string | number> = {};
  if (options?.pageNumber !== undefined) params.page_number = options.pageNumber;
  if (options?.status) params.status = options.status;
  const { data } = await api.get<AIDetection[]>(
    `/documents/${documentId}/ai-detections`,
    { params },
  );
  return data;
}

/**
 * PHASE 3: Mode INVENTAIRE RAPIDE.
 * Claude analyse la page et retourne une liste texte structuree
 * (item, dimensions, quantity, notes) sans markup overlay.
 * Plus precis pour plans manuscrits.
 */
export async function runAIQuickInventory(
  documentId: number,
  request: AIQuickInventoryRequest,
): Promise<AIQuickInventoryResult> {
  const body = {
    page_number: request.pageNumber,
    query: request.query,
    additional_context: request.additionalContext,
    section_numero: request.sectionNumero,
    use_bom_catalog: request.useBomCatalog ?? false,
    precision_mode: request.precisionMode ?? true,
  };
  const { data } = await _retryWithBackoff(() =>
    api.post<{
      pageNumber?: number;
      inventory?: Array<Record<string, unknown>>;
      summary?: string;
      totalItems?: number;
      costUsd?: number;
      tokensIn?: number;
      tokensOut?: number;
      claudeModel?: string;
      precisionModeUsed?: boolean;
      thinkingTokens?: number;
    }>(`/documents/${documentId}/ai-quick-inventory`, body, {
      timeout: AI_REQUEST_TIMEOUT_MS,
    }),
  );
  return {
    pageNumber: data.pageNumber ?? request.pageNumber,
    inventory: (data.inventory || []).map((it) => ({
      item: typeof it.item === 'string' ? it.item : '',
      dimensions: (it.dimensions as string | null | undefined) ?? null,
      quantity: Number(it.quantity) || 0,
      unit: typeof it.unit === 'string' ? it.unit : 'un',
      notes: (it.notes as string | null | undefined) ?? null,
      category: (it.category as string | null | undefined) ?? null,
      productId: (it.productId as number | null | undefined) ?? null,
    })),
    summary: data.summary || '',
    totalItems: data.totalItems ?? 0,
    costUsd: data.costUsd ?? 0,
    tokensIn: data.tokensIn ?? 0,
    tokensOut: data.tokensOut ?? 0,
    claudeModel: data.claudeModel || 'claude-opus-4-7',
    precisionModeUsed: data.precisionModeUsed ?? false,
    thinkingTokens: data.thinkingTokens ?? 0,
  };
}

/**
 * Met a jour le statut d'une detection IA (accept / reject / corriger).
 *
 * Si `createMeasurement = true` et `status = 'accepted'`, le backend cree
 * automatiquement la mesure correspondante.
 */
export async function updateAIDetectionStatus(
  detectionId: number,
  status: AIDetectionStatus,
  options?: { userCorrectionValue?: number; createMeasurement?: boolean },
): Promise<AIDetection> {
  const body = camelToSnakeKeys({
    status,
    userCorrectionValue: options?.userCorrectionValue,
    createMeasurement: options?.createMeasurement,
  });
  const { data } = await api.put<AIDetection>(
    `/ai-detections/${detectionId}`,
    body,
  );
  return data;
}
