import axios from 'axios';
import type {
  PDFDocument,
  Project,
  Measurement,
  MeasurementLayer,
  Calibration,
  Product,
  ProductComponent,
} from './types';

/* ══════════════════════════════════════════════════════════════════
   Unified API client for Metre-PDF (ERP React edition).
   URLs aligned with ERP_REACT/backend/routers/metre_pdf.py.
   Supports: projects, documents, measurements, layers, calibrations,
             products + composite components (BOM).
   ══════════════════════════════════════════════════════════════════ */

const API_BASE = import.meta.env.VITE_API_URL || '';
const API_PREFIX = '/api/erp/v1/metre';

/* ── ERP context (kept for compatibility) ───────────────────────── */

interface ERPContext {
  tenant_schema?: string;
  user_id?: number;
  user_name?: string;
  company_id?: number;
  project_name?: string;
  client_company_id?: number;
  embedded?: boolean;
  client_name?: string;
  client_address?: string;
  client_city?: string;
  client_phone?: string;
  client_email?: string;
  project_type?: string;
}

declare global {
  interface Window {
    __ERP_CONTEXT__?: ERPContext;
  }
}

export function getERPContext(): ERPContext | null {
  return window.__ERP_CONTEXT__ || null;
}

export type { ERPContext };

/* ── key transformation helpers ─────────────────────────────────── */

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Cles dont la VALEUR est un dict JSONB avec des cles user-defined qui ne
 * doivent PAS etre transformees recursivement (sinon perte d'info pour les
 * noms snake_case contenant des chiffres : ex. `surface_2x4` -> `surface2x4`,
 * irreversible car aucune majuscule). On transforme la cle parente mais on
 * laisse la valeur intacte.
 *
 * Les noms ici sont la FORME CAMELCASE (apres snakeToCamel) pour la branche
 * transformKeys, et la FORME SNAKE_CASE (apres camelToSnake) pour
 * camelToSnakeKeys -- voir les sets dedies plus bas.
 */
const PASSTHROUGH_DICT_KEYS_CAMEL = new Set(['compositeInputs']);
const PASSTHROUGH_DICT_KEYS_SNAKE = new Set(['composite_inputs']);

function transformKeys(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(transformKeys);
  if (data !== null && typeof data === 'object' && !(data instanceof Date)) {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([k, v]) => {
        const newKey = snakeToCamel(k);
        const newValue = PASSTHROUGH_DICT_KEYS_CAMEL.has(newKey)
          ? v
          : transformKeys(v);
        return [newKey, newValue];
      }),
    );
  }
  return data;
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function camelToSnakeKeys(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(camelToSnakeKeys);
  if (data !== null && typeof data === 'object' && !(data instanceof Date)) {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([k, v]) => {
        const newKey = camelToSnake(k);
        const newValue = PASSTHROUGH_DICT_KEYS_SNAKE.has(newKey)
          ? v
          : camelToSnakeKeys(v);
        return [newKey, newValue];
      }),
    );
  }
  return data;
}

/* ── axios instance ────────────────────────────────────────────── */

const api = axios.create({
  baseURL: `${API_BASE}${API_PREFIX}`,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('erp_token');
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    // Skip the snake→camel transform for binary responses (Blob, ArrayBuffer).
    // `exportMeasurements` uses `responseType: 'blob'` — without this guard,
    // transformKeys walks the Blob as if it were a plain object and returns
    // an empty `{}`, silently corrupting the exported CSV/JSON file.
    // Same pattern as api/client.ts:97-113.
    if (
      response.data &&
      !(response.data instanceof Blob) &&
      !(response.data instanceof ArrayBuffer)
    ) {
      response.data = transformKeys(response.data);
    }
    return response;
  },
  async (error) => {
    // Unwrap Blob errors — cf. api/client.ts pour l'explication complète.
    // `exportMeasurements` utilise responseType:'blob' — sans ce unwrap,
    // err.response.data.detail serait undefined sur erreur backend.
    if (error.response?.data instanceof Blob) {
      try {
        const txt = await error.response.data.text();
        const trimmed = txt.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            error.response.data = JSON.parse(txt);
          } catch {
            error.response.data = { detail: trimmed.slice(0, 500) };
          }
        } else {
          error.response.data = { detail: trimmed.slice(0, 500) || 'Erreur serveur' };
        }
      } catch {
        error.response.data = { detail: 'Erreur serveur (réponse binaire non lisible)' };
      }
    }
    return Promise.reject(error);
  },
);

export default api;


/* ══════════════════════════════════════════════════════════════════
   Projects API
   ══════════════════════════════════════════════════════════════════ */

export async function listProjects(): Promise<Project[]> {
  const { data } = await api.get('/projects');
  return data;
}

export async function getProject(id: string | number): Promise<Project> {
  const { data } = await api.get(`/projects/${id}`);
  return data;
}

export async function createProject(project: {
  name: string;
  description?: string;
  companyId?: number;
  devisId?: number | null;
}): Promise<Project> {
  const { data } = await api.post('/projects', camelToSnakeKeys({
    name: project.name,
    description: project.description ?? '',
    companyId: project.companyId,
    devisId: project.devisId ?? null,
  }));
  return data;
}

export async function updateProject(
  id: string | number,
  updates: Partial<Pick<Project, 'name' | 'description'>>,
): Promise<Project> {
  const { data } = await api.put(`/projects/${id}`, camelToSnakeKeys(updates));
  return data;
}

export async function deleteProject(id: string | number): Promise<void> {
  await api.delete(`/projects/${id}`);
}


/* ══════════════════════════════════════════════════════════════════
   Métrés Library (saved métrés summary for the library modal)
   ══════════════════════════════════════════════════════════════════ */

/** A single entry in the métrés library list — aggregated server-side
 *  to avoid N+1 round-trips for measurement/layer counts. */
export interface MetreLibraryEntry {
  id: number;
  name: string;
  description?: string | null;
  devisId?: number | null;
  createdBy?: number | null;
  createdByName?: string | null;
  createdAt?: string;
  updatedAt?: string;
  measurementCount: number;
  layerCount: number;
  documentCount: number;
  primaryDocumentId?: number | null;
  primaryDocumentFilename?: string | null;
  primaryDocumentOriginalFilename?: string | null;
  primaryDocumentPageCount?: number | null;
}

export async function listMetresLibrary(): Promise<MetreLibraryEntry[]> {
  const { data } = await api.get('/metres-library');
  return data;
}

/** Fetch the raw PDF binary for a saved document so pdfjs can re-render it. */
export async function getDocumentFile(documentId: string | number): Promise<ArrayBuffer> {
  const { data } = await api.get(`/documents/${documentId}/file`, {
    responseType: 'arraybuffer',
  });
  return data;
}


/* ══════════════════════════════════════════════════════════════════
   Documents API
   ══════════════════════════════════════════════════════════════════ */

export async function listDocuments(projectId: string | number): Promise<PDFDocument[]> {
  const { data } = await api.get(`/projects/${projectId}/documents`);
  return data;
}

export async function getDocument(documentId: string | number): Promise<PDFDocument> {
  const { data } = await api.get(`/documents/${documentId}`);
  return data;
}

export async function uploadDocument(
  projectId: string | number,
  file: File,
): Promise<PDFDocument> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post(
    `/projects/${projectId}/documents/upload`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export async function deleteDocument(documentId: string | number): Promise<void> {
  await api.delete(`/documents/${documentId}`);
}

/**
 * Returns the URL for a rendered page image (PNG) produced by the backend's
 * LRU-cached PyMuPDF render endpoint. Can be used directly as <img src>.
 * The `zoom` parameter controls the render resolution (1.0 = native PDF DPI).
 */
export function getPageImageUrl(
  documentId: string | number,
  pageNumber: number,
  zoom = 1.5,
): string {
  const base = api.defaults.baseURL ?? '';
  return `${base}/documents/${documentId}/page/${pageNumber}?zoom=${zoom}`;
}


/* ══════════════════════════════════════════════════════════════════
   Measurements API
   ══════════════════════════════════════════════════════════════════ */

export async function listMeasurements(
  documentId: string | number,
  pageNumber?: number,
  layerId?: number,
): Promise<Measurement[]> {
  const params: Record<string, unknown> = {};
  if (pageNumber !== undefined) params.page = pageNumber;
  if (layerId !== undefined) params.layer_id = layerId;
  const { data } = await api.get(`/documents/${documentId}/measurements`, {
    params,
  });
  return data;
}

export async function getMeasurement(measurementId: string | number): Promise<Measurement> {
  const { data } = await api.get(`/measurements/${measurementId}`);
  return data;
}

export async function createMeasurement(
  documentId: string | number,
  measurement: Omit<Measurement, 'id' | 'createdAt' | 'documentId'>,
): Promise<Measurement> {
  const { data } = await api.post(
    `/documents/${documentId}/measurements`,
    camelToSnakeKeys(measurement),
  );
  return data;
}

export async function updateMeasurement(
  measurementId: string | number,
  updates: Partial<Measurement>,
): Promise<Measurement> {
  const { data } = await api.put(
    `/measurements/${measurementId}`,
    camelToSnakeKeys(updates),
  );
  return data;
}

export async function deleteMeasurement(measurementId: string | number): Promise<void> {
  await api.delete(`/measurements/${measurementId}`);
}

export async function exportMeasurements(
  documentId: string | number,
  format: 'csv' | 'json' = 'csv',
): Promise<Blob> {
  const { data } = await api.get(
    `/documents/${documentId}/measurements/export`,
    { params: { format }, responseType: 'blob' },
  );
  return data;
}


/* ══════════════════════════════════════════════════════════════════
   Layers API
   ══════════════════════════════════════════════════════════════════ */

export async function listLayers(
  documentId: string | number,
): Promise<MeasurementLayer[]> {
  const { data } = await api.get(`/documents/${documentId}/layers`);
  return data;
}

export async function getLayer(layerId: string | number): Promise<MeasurementLayer> {
  const { data } = await api.get(`/layers/${layerId}`);
  return data;
}

export async function createLayer(
  documentId: string | number,
  layer: Omit<MeasurementLayer, 'id' | 'documentId'>,
): Promise<MeasurementLayer> {
  const { data } = await api.post(
    `/documents/${documentId}/layers`,
    camelToSnakeKeys(layer),
  );
  return data;
}

export async function updateLayerApi(
  layerId: string | number,
  updates: Partial<MeasurementLayer>,
): Promise<MeasurementLayer> {
  const { data } = await api.put(
    `/layers/${layerId}`,
    camelToSnakeKeys(updates),
  );
  return data;
}

export async function deleteLayerApi(layerId: string | number): Promise<void> {
  await api.delete(`/layers/${layerId}`);
}


/* ══════════════════════════════════════════════════════════════════
   Calibrations API
   ══════════════════════════════════════════════════════════════════ */

export async function getCalibration(
  documentId: string | number,
  pageNumber: number,
): Promise<Calibration | null> {
  try {
    const { data } = await api.get(
      `/documents/${documentId}/calibration/${pageNumber}`,
    );
    return data;
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'response' in err &&
      (err as { response?: { status?: number } }).response?.status === 404
    ) {
      return null;
    }
    throw err;
  }
}

export async function setCalibration(
  documentId: string | number,
  calibration: Omit<Calibration, 'id' | 'documentId'>,
): Promise<Calibration> {
  const { data } = await api.post(
    `/documents/${documentId}/calibrate`,
    camelToSnakeKeys(calibration),
  );
  return data;
}

export async function deleteCalibration(
  documentId: string | number,
  pageNumber: number,
): Promise<void> {
  await api.delete(
    `/documents/${documentId}/calibration/${pageNumber}`,
  );
}


/* ══════════════════════════════════════════════════════════════════
   Products API
   ══════════════════════════════════════════════════════════════════ */

export async function listProducts(category?: string): Promise<Product[]> {
  const params: Record<string, unknown> = {};
  if (category) params.category = category;
  const { data } = await api.get('/products', { params });
  return data;
}

export async function getProductById(productId: string | number): Promise<Product> {
  const { data } = await api.get(`/products/${productId}`);
  return data;
}

export async function createProduct(
  product: Omit<Product, 'id' | 'components'>,
): Promise<Product> {
  const { data } = await api.post('/products', camelToSnakeKeys(product));
  return data;
}

export async function updateProductApi(
  productId: number | string,
  updates: Partial<Product>,
): Promise<Product> {
  // Drop `components` — they are managed via the dedicated components endpoints.
  const { components: _components, id: _id, ...rest } = updates as Record<string, unknown>;
  const { data } = await api.put(
    `/products/${productId}`,
    camelToSnakeKeys(rest),
  );
  return data;
}

export async function deleteProductApi(
  productId: number | string,
): Promise<void> {
  await api.delete(`/products/${productId}`);
}

export async function bulkImportProducts(
  products: Omit<Product, 'id' | 'components'>[],
): Promise<Product[]> {
  const { data } = await api.post(
    '/products/bulk-import',
    products.map((p) => camelToSnakeKeys(p)),
  );
  return data;
}


/* ══════════════════════════════════════════════════════════════════
   Product Components API (composite / BOM)
   ══════════════════════════════════════════════════════════════════ */

export async function listProductComponents(
  productId: number | string,
): Promise<ProductComponent[]> {
  const { data } = await api.get(`/products/${productId}/components`);
  return data;
}

export async function addProductComponent(
  productId: number | string,
  component: {
    childProductId: number;
    quantityPerUnit: number;
    formula?: string | null;
    notes?: string;
    sortOrder?: number;
  },
): Promise<ProductComponent> {
  const { data } = await api.post(
    `/products/${productId}/components`,
    camelToSnakeKeys(component),
  );
  return data;
}

export async function updateProductComponent(
  productId: number | string,
  componentId: number | string,
  updates: {
    quantityPerUnit?: number;
    formula?: string | null;
    notes?: string;
    sortOrder?: number;
  },
): Promise<ProductComponent> {
  const { data } = await api.put(
    `/products/${productId}/components/${componentId}`,
    camelToSnakeKeys(updates),
  );
  return data;
}

export async function deleteProductComponent(
  productId: number | string,
  componentId: number | string,
): Promise<void> {
  await api.delete(`/products/${productId}/components/${componentId}`);
}
