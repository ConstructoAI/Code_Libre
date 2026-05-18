import { create } from 'zustand';
import type {
  Tool,
  Measurement,
  MeasurementLayer,
  MeasurementPropertyClipboard,
  LaborTrade,
  Calibration,
  PDFDocument,
  ViewState,
  Point,
  HistoryEntry,
  Product,
  ProductComponent,
  SnapPoint,
  SymbolBlockDef,
  Project,
  MeasurementUnit,
  AIDetection,
  AIDetectMultiSectionResult,
  AIDetectRunResult,
  AIDetectionStatus,
} from './types';
import { DEFAULT_CATALOG, CATALOG_VERSION } from './data/defaultCatalog';
import { DEFAULT_LABOR_CATALOG, LABOR_CATALOG_VERSION } from './data/defaultLaborCatalog';
import { DEFAULT_SYMBOL_BLOCKS } from './data/defaultSymbolBlocks';
import { getERPContext } from './api';
import * as metreApi from './api';

/* ══════════════════════════════════════════════════════════════════
   useMetreStore  (from METRE_PDF/frontend/src/store/useMetreStore.ts)
   ══════════════════════════════════════════════════════════════════ */

/* ── Constants ────────────────────────────────────────────── */

const MAX_UNDO = 50;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 1.25;
const SAVE_DEBOUNCE_MS = 1000;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

// Monotonic tokens used to discard stale async responses. Module-scoped so they
// persist across setCurrentPage / loadDocumentData calls within the same session.
let _calibrationFetchToken = 0;
let _loadDocumentDataToken = 0;

// ─── Backend sync helpers (shared by all measurement/layer ops) ───────────────
//
// These helpers are invoked in optimistic-update paths to push the state change
// to the backend. They silently no-op in standalone mode. They guard against
// non-persisted documents (id not numeric — BUG 1.1 coming from PDFViewer's
// fake doc-${Date.now()} id), which happens when the PDF is loaded locally
// without going through metreApi.uploadDocument.

/** Returns true iff the current document is backed by a real backend row. */
function _hasPersistedDocument(): boolean {
  const doc = useMetreStore.getState().document;
  return !!(doc && /^\d+$/.test(String(doc.id)));
}

/** POST a newly-created measurement to the backend and swap the temp id with
 *  the real backend id in the store. */
function _pushCreateMeasurement(m: Measurement) {
  if (!isERPMode() || !_hasPersistedDocument()) return;
  const doc = useMetreStore.getState().document;
  if (!doc) return;
  metreApi.createMeasurement(
    doc.id,
    measurementToServerBody(m) as unknown as Omit<Measurement, 'id' | 'createdAt' | 'documentId'>,
  )
    .then((created) => {
      const realId = String((created as unknown as Record<string, unknown>).id);
      useMetreStore.setState((s) => ({
        measurements: s.measurements.map((mm) => (mm.id === m.id ? { ...mm, id: realId, documentId: String(doc.id) } : mm)),
        selectedMeasurementIds: s.selectedMeasurementIds.map((x: string) => (x === m.id ? realId : x)),
        selectedMeasurementId: s.selectedMeasurementId === m.id ? realId : s.selectedMeasurementId,
      }));
      _markSynced();
    })
    .catch((err: unknown) => console.error('[MetreStore] _pushCreateMeasurement failed:', err));
}

/** PUT an updated measurement (if already persisted — id numeric). */
function _pushUpdateMeasurement(m: Measurement) {
  if (!isERPMode() || !_hasPersistedDocument()) return;
  if (!/^\d+$/.test(m.id)) return;
  metreApi.updateMeasurement(m.id, measurementToServerBody(m))
    .then(() => _markSynced())
    .catch((err: unknown) => console.error('[MetreStore] _pushUpdateMeasurement failed:', err));
}

/** DELETE a measurement from the backend (if already persisted — id numeric). */
function _pushDeleteMeasurement(id: string) {
  if (!isERPMode() || !_hasPersistedDocument()) return;
  if (!/^\d+$/.test(id)) return;
  metreApi.deleteMeasurement(id)
    .then(() => _markSynced())
    .catch((err: unknown) => console.error('[MetreStore] _pushDeleteMeasurement failed:', err));
}

/** Bump `lastSyncAt` so the SavedBar can show a fresh "Sauvegardé il y a..."
 *  timestamp. Called after every successful backend mutation.
 *  Uses zustand's typed `setState` directly — no cast needed. */
function _markSynced() {
  useMetreStore.setState({ lastSyncAt: new Date().toISOString() });
}

/** Compute a diff between two measurement arrays and push CREATE/UPDATE/DELETE
 *  ops to the backend. Used by undo/redo, paste, bulk ops that replace the
 *  measurements array wholesale. */
function _diffAndPushMeasurements(prev: Measurement[], next: Measurement[]) {
  if (!isERPMode() || !_hasPersistedDocument()) return;
  const prevById = new Map(prev.map((m) => [m.id, m]));
  const nextById = new Map(next.map((m) => [m.id, m]));
  // DELETES: in prev, not in next
  for (const [id] of prevById) {
    if (!nextById.has(id)) {
      _pushDeleteMeasurement(id);
    }
  }
  // CREATES: in next, not in prev (temp IDs only — numeric IDs with no prev
  // mean a restored measurement, best-effort re-create)
  for (const [id, m] of nextById) {
    if (!prevById.has(id)) {
      _pushCreateMeasurement(m);
    }
  }
  // UPDATES: in both, content differs
  for (const [id, nextM] of nextById) {
    const prevM = prevById.get(id);
    if (prevM && JSON.stringify(prevM) !== JSON.stringify(nextM) && /^\d+$/.test(id)) {
      _pushUpdateMeasurement(nextM);
    }
  }
}

/* ── Measurement validation ──────────────────────────────── */

function isValidMeasurementValue(value: number): boolean {
  return typeof value === 'number' && isFinite(value) && !isNaN(value) && value >= 0;
}

/* ── Interface ────────────────────────────────────────────── */

interface MetreState {
  // --- Tool state ---
  activeTool: Tool;
  setActiveTool: (tool: Tool) => void;
  /** Alias used by useToolStore consumers */
  setTool: (tool: Tool) => void;
  isDrawing: boolean;
  setIsDrawing: (drawing: boolean) => void;

  // --- Document ---
  document: PDFDocument | null;
  setDocument: (doc: PDFDocument | null) => void;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  /** Hydrate measurements/layers/calibration for a document from the backend (ERP mode only) */
  loadDocumentData: (documentId: string, pageNumber?: number) => Promise<void>;

  // --- Image mode (non-PDF plans) ---
  imageObjectUrl: string | null;
  setImageObjectUrl: (url: string | null) => void;
  imageNativeSize: { width: number; height: number } | null;
  setImageNativeSize: (size: { width: number; height: number } | null) => void;

  // --- Source binary cache (in-memory, session-scoped) ---
  // Kept so PDFViewer can re-open the same plan after the component is
  // unmounted/remounted (e.g. switching ERP modules and coming back) without
  // forcing the user to re-pick the file. Lost on page refresh — for true
  // persistence the document must be uploaded to the backend.
  pdfBuffer: ArrayBuffer | null;
  setPdfBuffer: (buffer: ArrayBuffer | null) => void;
  imageBlob: Blob | null;
  setImageBlob: (blob: Blob | null) => void;

  // --- Viewport ---
  viewState: ViewState;
  setViewState: (vs: Partial<ViewState>) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToPage: () => void;
  setOffset: (offset: { x: number; y: number }) => void;
  setRotation: (rotation: number) => void;

  // --- Base scale (fit-to-container ratio) ---
  /** The scale factor that fits the PDF page into the container (container / pageNative). */
  baseScale: number;
  /** Update baseScale; rescales all measurement coords proportionally so they stay anchored. */
  setBaseScale: (bs: number) => void;
  /** True once `setBaseScale` has been called by the active PDFViewer in the current
   *  session. Distinguishes "real viewport-measured value" from "boot value loaded
   *  from localStorage" or "stale value carried over from a previous métré". Read by
   *  `loadDocumentData` to decide whether `currentBaseScale` is trustworthy enough
   *  to drive an immediate rescale (Case A) — otherwise we defer to Case B. */
  _baseScaleFromViewer: boolean;

  // --- Viewport dimensions ---
  viewportWidth: number;
  viewportHeight: number;
  pageWidth: number;
  pageHeight: number;
  setViewportSize: (width: number, height: number) => void;
  setPageSize: (width: number, height: number) => void;

  // --- Coordinate transforms ---
  screenToPage: (screenX: number, screenY: number) => Point;
  pageToWorld: (pageX: number, pageY: number) => Point;

  // --- Calibration ---
  calibration: Calibration | null;
  setCalibration: (cal: Calibration | null) => void;
  clearCalibration: () => void;

  // --- Measurements ---
  measurements: Measurement[];
  addMeasurement: (m: Measurement) => void;
  updateMeasurement: (id: string, updates: Partial<Measurement>) => void;
  removeMeasurement: (id: string) => void;
  /** Alias used by useMeasurementStore consumers */
  deleteMeasurement: (id: string) => void;
  /** Multi-selection: array of selected measurement IDs */
  selectedMeasurementIds: string[];
  /** Convenience getter: first selected ID (for single-selection code paths) */
  selectedMeasurementId: string | null;
  /** Replace selection with a single measurement (or clear with null) */
  setSelectedMeasurementId: (id: string | null) => void;
  /** Replace selection with multiple IDs */
  setSelectedMeasurementIds: (ids: string[]) => void;
  /** Toggle a measurement in/out of selection (Ctrl+click) */
  toggleMeasurementSelection: (id: string) => void;
  /** Select a range from last selected to target (Shift+click) */
  extendMeasurementSelection: (id: string, orderedIds: string[]) => void;
  /** Bulk update all selected measurements */
  updateSelectedMeasurements: (updates: Partial<Measurement>) => void;
  /** Bulk delete all selected measurements */
  removeSelectedMeasurements: () => void;
  /** Alias used by useMeasurementStore consumers */
  selectMeasurement: (id: string | null) => void;
  setMeasurements: (measurements: Measurement[]) => void;
  /** Update points and value without pushing undo or saving to localStorage (used during drag) */
  updateMeasurementPoints: (id: string, points: Point[], value: number) => void;
  /** Persist current measurements to localStorage (call after drag ends) */
  saveMeasurementsToStorage: () => void;

  // --- Layers ---
  layers: MeasurementLayer[];
  addLayer: (layer: MeasurementLayer) => void;
  updateLayer: (id: string, updates: Partial<MeasurementLayer>) => void;
  removeLayer: (id: string) => void;
  /** Alias used by useMeasurementStore consumers */
  deleteLayer: (id: string) => void;
  activeLayerId: string | null;
  setActiveLayerId: (id: string | null) => void;
  /** Alias used by useMeasurementStore consumers */
  setActiveLayer: (id: string | null) => void;
  setLayers: (layers: MeasurementLayer[]) => void;
  moveLayerUp: (id: string) => void;
  moveLayerDown: (id: string) => void;

  // --- Drawing state ---
  drawingPoints: Point[];
  setDrawingPoints: (pts: Point[]) => void;
  addDrawingPoint: (pt: Point) => void;
  clearDrawing: () => void;
  /** currentPoints alias (same as drawingPoints) */
  currentPoints: Point[];
  addPoint: (point: Point) => void;
  removeLastPoint: () => void;
  clearPoints: () => void;

  // --- Snap data ---
  snapPoints: SnapPoint[];
  setSnapPoints: (points: SnapPoint[]) => void;
  activeSnapPoint: SnapPoint | null;
  setActiveSnapPoint: (point: SnapPoint | null) => void;

  // --- Toggles ---
  snapEnabled: boolean;
  toggleSnap: () => void;
  orthoEnabled: boolean;
  toggleOrtho: () => void;
  gridEnabled: boolean;
  toggleGrid: () => void;

  // --- Mouse state ---
  mousePosition: Point;
  setMousePosition: (p: Point) => void;
  /** Real-world mouse position (after calibration transform) */
  mouseWorldPosition: Point | null;
  setMouseWorldPosition: (p: Point | null) => void;
  /** Live measurement value while drawing */
  liveMeasurementValue: string;
  setLiveMeasurementValue: (v: string) => void;
  /** Snap indicator */
  activeSnapType: string | null;
  setActiveSnapType: (s: string | null) => void;

  // --- Undo / Redo ---
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;

  // --- Calibration dialog ---
  pendingCalibrationPxLen: number | null;
  setPendingCalibrationPxLen: (v: number | null) => void;

  // --- Product Catalog ---
  products: Product[];
  productsLoaded: boolean;
  fetchProducts: () => Promise<void>;
  addProduct: (p: Product) => void;
  updateProduct: (id: string, updates: Partial<Product>) => void;
  removeProduct: (id: string) => void;
  /** Refresh a single product from the backend (used after editing composite components) */
  refreshProduct: (id: string) => Promise<void>;
  showCatalog: boolean;
  toggleCatalog: () => void;
  importCatalog: (products: Product[]) => void;

  // --- Labor Catalog (Corps de metier CCQ) ---
  laborTrades: LaborTrade[];
  showLaborCatalog: boolean;
  toggleLaborCatalog: () => void;
  addLaborTrade: (trade: LaborTrade) => void;
  updateLaborTrade: (id: string, updates: Partial<LaborTrade>) => void;
  removeLaborTrade: (id: string) => void;
  importLaborCatalog: (trades: LaborTrade[]) => void;

  // --- Summary panel ---
  showSummary: boolean;
  toggleSummary: () => void;

  // --- Calculator panel ---
  showCalculator: boolean;
  toggleCalculator: () => void;

  // --- Slope converter panel ---
  showSlopeConverter: boolean;
  toggleSlopeConverter: () => void;

  // --- Symbol Blocks ---
  symbolBlocks: SymbolBlockDef[];
  showSymbolCatalog: boolean;
  toggleSymbolCatalog: () => void;
  activeSymbolBlockId: string | null;
  setActiveSymbolBlock: (id: string | null) => void;
  addSymbolBlock: (block: SymbolBlockDef) => void;
  updateSymbolBlock: (id: string, updates: Partial<SymbolBlockDef>) => void;
  removeSymbolBlock: (id: string) => void;
  importSymbolBlocks: (blocks: SymbolBlockDef[]) => void;

  // --- Measurement groups ---
  measurementGroups: string[];
  addMeasurementGroup: (name: string) => void;
  removeMeasurementGroup: (name: string) => void;

  // --- Incremental count ---
  /** ID of the count measurement currently being accumulated (null = no active count session) */
  activeCountId: string | null;
  /** Add a count point: creates a new count measurement on first click, increments on subsequent clicks */
  incrementCount: (pt: Point) => void;
  /** Finalize the active count session (called on Escape or tool change) */
  finalizeCount: () => void;

  // --- Duplicate ---
  duplicateMeasurement: (id: string) => void;
  /** Bulk duplicate all selected measurements */
  duplicateSelectedMeasurements: () => void;

  // --- Clipboard (cross-page copy/paste) ---
  clipboard: Measurement[];
  copySelectedToClipboard: () => void;
  pasteFromClipboard: () => void;

  // --- Property clipboard (copy/paste properties without geometry) ---
  propertyClipboard: MeasurementPropertyClipboard | null;
  copyMeasurementProperties: (id: string) => void;
  pasteMeasurementProperties: () => void;

  // --- Draw order ---
  /** Move measurement to the top of its layer */
  bringMeasurementToFront: (id: string) => void;
  /** Move measurement to the bottom of its layer */
  sendMeasurementToBack: (id: string) => void;
  /** Move measurement one step up within its layer */
  moveMeasurementUp: (id: string) => void;
  /** Move measurement one step down within its layer */
  moveMeasurementDown: (id: string) => void;

  // --- Transform ---
  /** Rotate measurement 45 deg clockwise around its centroid */
  rotateMeasurement45: (id: string) => void;
  /** Create a mirrored copy of the measurement (horizontal or vertical) */
  mirrorCopyMeasurement: (id: string, axis: 'horizontal' | 'vertical') => void;

  // --- Unit system ---
  displayUnit: 'imperial' | 'metric';
  toggleDisplayUnit: () => void;

  // --- Saved métré (server-persisted project) ---
  /** Currently opened métré (null = unsaved/new). When set, the PDF is
   *  uploaded to the backend and all measurements auto-sync. */
  currentMetreProject: Project | null;
  /** Last successful backend sync time (used by MetreSavedBar to show
   *  "Sauvegardé il y a Xmin"). Updated by `_markSynced()` inside push helpers. */
  lastSyncAt: string | null;
  /** Last upload/sync error message (set on failure of uploadCachedPdfForProject
   *  or push helpers). MetreSavedBar reads this to surface a red banner — without
   *  it, network failures are silent and the user thinks the PDF is saved when
   *  it's only rendered locally. Cleared on successful upload or by user retry. */
  uploadError: string | null;
  setUploadError: (err: string | null) => void;
  setCurrentMetreProject: (p: Project | null) => void;
  /** Close the current métré: clears document/measurements/layers/calibration
   *  and unsets currentMetreProject. */
  closeMetreProject: () => void;

  // --- UI ---
  showLeftPanel: boolean;
  toggleLeftPanel: () => void;
  showRightPanel: boolean;
  toggleRightPanel: () => void;
  leftPanelWidth: number;
  rightPanelWidth: number;

  // --- AI Detections (Phase 1 + 2) ---
  aiDetections: AIDetection[];
  aiDetectionLoading: boolean;
  aiDetectionError: string | null;
  aiDetectionLastRun: AIDetectRunResult | null;
  aiMultiSectionResult: AIDetectMultiSectionResult | null;
  aiAvailableSections: string[];
  setAIDetections: (detections: AIDetection[]) => void;
  appendAIDetections: (detections: AIDetection[]) => void;
  removeAIDetection: (detectionId: number) => void;
  setAIDetectionLoading: (loading: boolean) => void;
  setAIDetectionError: (error: string | null) => void;
  setAIDetectionLastRun: (result: AIDetectRunResult | null) => void;
  updateAIDetectionStatus: (detectionId: number, status: AIDetectionStatus, userCorrectionValue?: number) => void;
  clearAIDetections: () => void;
  setAIMultiSectionResult: (result: AIDetectMultiSectionResult | null) => void;
  setAIAvailableSections: (sections: string[]) => void;

  // --- Reset ---
  reset: () => void;
}

const DEFAULT_LAYER: MeasurementLayer = {
  id: 'default',
  documentId: '',
  name: 'Mesures',
  color: '#3b82f6',
  visible: true,
  locked: false,
};

export const useMetreStore = create<MetreState>((set, get) => ({
  // Tool
  activeTool: 'select',
  setActiveTool: (tool) => {
    set({
      activeTool: tool,
      drawingPoints: [],
      currentPoints: [],
      isDrawing: false,
      liveMeasurementValue: '',
      activeSnapPoint: null,
      // activeSnapType must be cleared alongside activeSnapPoint, otherwise
      // the BottomBar keeps showing the stale "SNAP: endpoint" badge while
      // the green diamond marker has already disappeared on the canvas.
      activeSnapType: null,
      activeCountId: null,
    });
  },
  setTool: (tool) => {
    // Alias for setActiveTool
    get().setActiveTool(tool);
  },
  isDrawing: false,
  setIsDrawing: (drawing) => set({ isDrawing: drawing }),

  // Document
  document: null,
  setDocument: (doc) => {
    const prevDocId = get().document?.id;
    set({ document: doc });
    // If the document changes (or is cleared), wipe transient AND persisted
    // in-memory state so we don't leak measurements/layers/undo across documents.
    // This prevents the "stale flash" visible when switching docs before the
    // backend hydrate finishes, and fixes undo/redo cross-document contamination
    // in standalone mode (where loadDocumentData is not called).
    if (doc?.id !== prevDocId) {
      // Cancel any pending debounced writes from the previous document before
      // the wipe — otherwise a queued `debouncedSaveMeasurements([old])` can
      // fire AFTER the wipe, clobbering localStorage with the old measurements
      // or (worse) an empty array for the new document.
      if (_measurementsSaveTimer) {
        clearTimeout(_measurementsSaveTimer);
        _measurementsSaveTimer = null;
      }
      if (_layersSaveTimer) {
        clearTimeout(_layersSaveTimer);
        _layersSaveTimer = null;
      }
      // Seed a default layer immediately so drawing tools have a visible target.
      // Without this, `layers = []` but `activeLayerId = 'default'` → measurements
      // are created with `layer: 'default'` but the rendering filter
      // `visibleLayerIds.has(m.layer)` returns false (Set is empty) → invisible.
      // For real backend docs, loadDocumentData() runs async right after and
      // overwrites this with the persisted layers.
      // Also drop the cached source binary (pdfBuffer/imageBlob) since it
      // belonged to the previous document. PDFViewer.loadPDF/loadImage will
      // re-populate it for the new doc immediately after.
      set({
        drawingPoints: [],
        currentPoints: [],
        isDrawing: false,
        activeCountId: null,
        activeSnapPoint: null,
        activeSnapType: null,
        liveMeasurementValue: '',
        pendingCalibrationPxLen: null,
        selectedMeasurementIds: [],
        selectedMeasurementId: null,
        measurements: [],
        layers: [{ ...DEFAULT_LAYER }],
        activeLayerId: 'default',
        calibration: null,
        undoStack: [],
        redoStack: [],
        pdfBuffer: null,
        imageBlob: null,
        // Reset to first page — otherwise, if the previous document was on
        // page 4/7 and the new one has fewer pages (e.g. blank template = 1
        // page), the render effect calls pdf.getPage(4) which throws a
        // silent PDF.js error and the stale bitmap stays on the canvas.
        currentPage: 1,
        // Reset baseScale tracking too — the new document will be measured
        // by its own PDFViewer render. Without this, `loadDocumentData` can
        // mistakenly trust the previous document's baseScale (Case A fires
        // with a wrong currentBaseScale) and rescale measurements off-anchor.
        baseScale: 0,
        _baseScaleFromViewer: false,
        // Round 12 fix: wipe AI detections on document switch so overlays
        // from the previous metre don't bleed onto the new canvas.
        aiDetections: [],
        aiDetectionError: null,
        aiDetectionLastRun: null,
        aiMultiSectionResult: null,
      });
    }
    if (doc === null) {
      // Nothing more to do — state already cleared above.
      return;
    }
    // In ERP mode, hydrate measurements/layers/calibration from the backend —
    // but only if the document has a real backend id (not the fake `doc-${Date.now()}`
    // produced by PDFViewer when the PDF is loaded locally without uploadDocument).
    if (isERPMode() && /^\d+$/.test(String(doc.id))) {
      // loadDocumentData now throws on failure — callers that explicitly await
      // it (handleOpenMetre) propagate to the user; the implicit fire-and-forget
      // path here just logs to avoid an unhandled rejection.
      get().loadDocumentData(doc.id, get().currentPage).catch((err) => {
        console.error('[MetreStore] setDocument auto-hydrate failed:', err);
      });
    }
  },
  currentPage: 1,
  setCurrentPage: (page) => {
    set({ currentPage: page });
    // Reload calibration for the new page (calibration is per-page).
    // Invalidate any in-flight loadDocumentData — its calibration fetch for the
    // old page would otherwise race with this one and possibly win.
    _loadDocumentDataToken++;
    const { document } = get();
    if (document && isERPMode() && _hasPersistedDocument()) {
      const myToken = ++_calibrationFetchToken;
      metreApi.getCalibration(document.id, page)
        .then((cal) => {
          if (myToken !== _calibrationFetchToken) return; // stale response — ignore
          if (cal) {
            set({ calibration: mapServerCalibration(cal as unknown as Record<string, unknown>) });
          } else {
            set({ calibration: null });
          }
        })
        .catch(() => { /* ignore — keep current calibration */ });
    }
  },

  // Load all measurements, layers, and current-page calibration for a document
  // from the backend, and hydrate the store. Clears undo/redo history since the
  // in-memory state is being replaced by authoritative backend data.
  // Throws on failure so callers (handleOpenMetre) can surface a message
  // instead of leaving a silently-empty métré that looks identical to a
  // genuinely empty one (root cause of the "Maison Laporte" data-loss bug).
  loadDocumentData: async (documentId, pageNumber) => {
    if (!isERPMode()) {
      throw new Error('Connexion en cours d\'initialisation. Patientez 1 ou 2 secondes puis réessayez.');
    }
    if (!/^\d+$/.test(String(documentId))) return; // skip non-persisted doc
    const myToken = ++_loadDocumentDataToken;
    try {
      const [mRaw, lRaw, cRaw] = await Promise.all([
        metreApi.listMeasurements(documentId),
        metreApi.listLayers(documentId),
        metreApi.getCalibration(documentId, pageNumber ?? 0),
      ]);
      if (myToken !== _loadDocumentDataToken) return; // stale — another load started
      const rawMeasurements = (mRaw as unknown as Record<string, unknown>[]).map(mapServerMeasurement);
      const layers = (lRaw as unknown as Record<string, unknown>[]).map(mapServerLayer);
      // If no layer exists yet, seed a default so drawing tools have a target.
      if (layers.length === 0) {
        layers.push({ ...DEFAULT_LAYER });
      }

      // Anchor measurement coordinates to the viewport baseScale.
      // Points are stored as `pdfNative × baseScale_at_save_time` (display-pixel
      // space). On reload — possibly with a different window size, fullscreen
      // state, or device — `baseScale` may differ. Without re-anchoring, points
      // render at the wrong plan coordinates.
      // We pick the first `pdfBaseScale` found in measurement metadata (saved
      // by `measurementToServerBody`). All measurements of one document share
      // the same baseScale within a save burst, so the first one is canonical.
      // Legacy measurements without `pdfBaseScale` skip the rescale (ratio=1)
      // — preserves existing behaviour for old data, no migration needed.
      const storedBaseScale = (() => {
        for (const m of mRaw as unknown as Record<string, unknown>[]) {
          const md = m.metadataJson as Record<string, unknown> | null | undefined;
          const bs = md && typeof md.pdfBaseScale === 'number' ? (md.pdfBaseScale as number) : null;
          // Defensive: filter NaN/Infinity (would yield ratio=0/Infinity and
          // collapse all measurements to (0,0) or push them off-canvas), and
          // anything outside a sane band — typical baseScale ∈ [0.1, 5].
          if (bs && Number.isFinite(bs) && bs > 0 && bs < 1000) return bs;
        }
        return null;
      })();
      const currentBaseScale = get().baseScale;
      // `_baseScaleFromViewer` is true once the active PDFViewer has called
      // `setBaseScale`. Until then `currentBaseScale` is either the boot value
      // from localStorage (non tenant-prefixed → could belong to another
      // métré/tenant on the same browser) or a stale value from a previous
      // métré whose PDFViewer is gone — neither is trustworthy enough to drive
      // an immediate rescale. In that situation we always defer to Case B.
      const baseScaleTrustworthy = get()._baseScaleFromViewer === true;

      // Two cases handle the PDFViewer / loadDocumentData race:
      //   A) `setBaseScale` already fired with a real viewport value:
      //      points/calibration are still in stored-space, rescale them now.
      //   B) `setBaseScale` hasn't fired (or current is stale): write
      //      baseScale=stored so the next `setBaseScale(B_new)` triggers
      //      the existing rescale machinery via the `ratio = B_new / stored`
      //      path inside `setBaseScale`.
      const shouldRescaleNow = !!(
        baseScaleTrustworthy
        && storedBaseScale && currentBaseScale && currentBaseScale > 0
        && Math.abs(currentBaseScale - storedBaseScale) > 1e-6
      );

      // Per-measurement rescale: although measurements saved within a single
      // session usually share the same `pdfBaseScale`, edge case SE7 can mix
      // values when a user resizes the window between save bursts without
      // re-pushing older measurements. We respect each measurement's own
      // `pdfBaseScale` if present; otherwise we fall back to the document-level
      // `storedBaseScale`. Anchoring is therefore correct even with mixed data.
      const measurements = shouldRescaleNow
        ? rawMeasurements.map((rm, idx) => {
            const raw = (mRaw as unknown as Record<string, unknown>[])[idx];
            const md = raw?.metadataJson as Record<string, unknown> | null | undefined;
            const ownBs = md && typeof md.pdfBaseScale === 'number' ? (md.pdfBaseScale as number) : null;
            const validOwnBs = ownBs && Number.isFinite(ownBs) && ownBs > 0 && ownBs < 1000
              ? ownBs
              : storedBaseScale!;
            const r = currentBaseScale / validOwnBs;
            if (Math.abs(r - 1) < 1e-6) return rm;
            return {
              ...rm,
              points: rm.points.map((p) => ({ x: p.x * r, y: p.y * r })),
            };
          })
        : rawMeasurements;
      // Document-level ratio is used to rescale the calibration (which has
      // no per-record pdfBaseScale). When measurements have mixed pdfBaseScale
      // (SE-X12 scenario: user resized between save bursts), prefer the MOST
      // RECENT saved measurement's baseScale as the calibration anchor —
      // calibration is typically (re)set together with the latest measurement
      // burst, not the first. Falls back to `storedBaseScale` (first found)
      // for legacy / single-baseScale documents.
      const calibrationAnchorBs = (() => {
        const arr = mRaw as unknown as Record<string, unknown>[];
        for (let i = arr.length - 1; i >= 0; i--) {
          const md = arr[i].metadataJson as Record<string, unknown> | null | undefined;
          const bs = md && typeof md.pdfBaseScale === 'number' ? (md.pdfBaseScale as number) : null;
          if (bs && Number.isFinite(bs) && bs > 0 && bs < 1000) return bs;
        }
        return storedBaseScale;
      })();
      const ratio = (shouldRescaleNow && calibrationAnchorBs && calibrationAnchorBs > 0)
        ? (currentBaseScale / calibrationAnchorBs)
        : 1;

      const calibrationRaw = cRaw ? mapServerCalibration(cRaw as unknown as Record<string, unknown>) : null;
      const calibration = (calibrationRaw && ratio !== 1)
        ? {
            ...calibrationRaw,
            pixelLength: calibrationRaw.pixelLength * ratio,
            // scaleFactor = referenceLength / pixelLength → recompute to keep
            // the displayed measurement values consistent post-rescale.
            scaleFactor: calibrationRaw.referenceLength / (calibrationRaw.pixelLength * ratio),
          }
        : calibrationRaw;

      // Case B: align baseScale to stored so the upcoming setBaseScale rescales
      // automatically. Skip when we already rescaled (case A) or when there's
      // nothing to anchor to (legacy data).
      const baseScaleOverride = (!shouldRescaleNow && storedBaseScale && storedBaseScale > 0)
        ? { baseScale: storedBaseScale }
        : {};

      set({
        ...baseScaleOverride,
        measurements,
        layers,
        calibration,
        activeLayerId: layers[0]?.id ?? null,
        undoStack: [],
        redoStack: [],
        selectedMeasurementIds: [],
        selectedMeasurementId: null,
        drawingPoints: [],
        currentPoints: [],
        isDrawing: false,
        activeCountId: null,
        activeSnapPoint: null,
        activeSnapType: null,
        liveMeasurementValue: '',
        pendingCalibrationPxLen: null,
      });
    } catch (err) {
      console.error('[MetreStore] Failed to load document data from backend:', err);
      throw err;
    }
  },

  // Image mode
  imageObjectUrl: null,
  setImageObjectUrl: (url) => set({ imageObjectUrl: url }),
  imageNativeSize: null,
  setImageNativeSize: (size) => set({ imageNativeSize: size }),

  // Source binary cache (in-memory only — survives unmount, lost on refresh)
  pdfBuffer: null,
  setPdfBuffer: (buffer) => set({ pdfBuffer: buffer }),
  imageBlob: null,
  setImageBlob: (blob) => set({ imageBlob: blob }),

  // Viewport
  viewState: { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 },
  setViewState: (vs) => set((s) => ({ viewState: { ...s.viewState, ...vs } })),

  setZoom: (zoom) =>
    set((s) => ({
      viewState: { ...s.viewState, zoom: clampZoom(zoom) },
    })),

  zoomIn: () =>
    set((s) => ({
      viewState: { ...s.viewState, zoom: clampZoom(s.viewState.zoom * ZOOM_STEP) },
    })),

  zoomOut: () =>
    set((s) => ({
      viewState: { ...s.viewState, zoom: clampZoom(s.viewState.zoom / ZOOM_STEP) },
    })),

  fitToPage: () => {
    const { viewportWidth, viewportHeight, pageWidth, pageHeight } = get();
    if (pageWidth === 0 || pageHeight === 0) return;
    const margin = 40;
    const scaleX = (viewportWidth - margin * 2) / pageWidth;
    const scaleY = (viewportHeight - margin * 2) / pageHeight;
    const zoom = clampZoom(Math.min(scaleX, scaleY));
    const offsetX = (viewportWidth - pageWidth * zoom) / 2;
    const offsetY = (viewportHeight - pageHeight * zoom) / 2;
    set((s) => ({
      viewState: { ...s.viewState, zoom, offsetX, offsetY },
    }));
  },

  setOffset: (offset) =>
    set((s) => ({
      viewState: { ...s.viewState, offsetX: offset.x, offsetY: offset.y },
    })),

  setRotation: (rotation) =>
    set((s) => ({
      viewState: { ...s.viewState, rotation: ((rotation % 360) + 360) % 360 },
    })),

  // Base scale -- tracks the container-to-page fit ratio.
  // When it changes (e.g. fullscreen toggle), all stored coordinates are rescaled
  // so measurements stay anchored to the same positions on the PDF.
  baseScale: loadBaseScale(),
  _baseScaleFromViewer: false,
  setBaseScale: (newBaseScale) => {
    const { baseScale: oldBaseScale, measurements, drawingPoints, calibration, undoStack, redoStack } = get();
    // Reject non-positive values
    if (!newBaseScale || newBaseScale <= 0) return;
    if (!oldBaseScale || oldBaseScale <= 0) {
      // First real viewport measurement → mark as authoritative.
      set({ baseScale: newBaseScale, _baseScaleFromViewer: true });
      saveBaseScale(newBaseScale);
      return;
    }
    // Skip if unchanged
    if (Math.abs(newBaseScale - oldBaseScale) < 1e-6) return;
    const ratio = newBaseScale / oldBaseScale;

    // Helper: rescale an array of points
    const scalePoints = (pts: Point[]): Point[] =>
      pts.map((p) => ({ x: p.x * ratio, y: p.y * ratio }));

    // Rescale all measurement coordinates
    const rescaledMeasurements = measurements.map((m) => ({
      ...m,
      points: scalePoints(m.points),
    }));

    // Rescale in-progress drawing points
    const rescaledDrawingPoints = scalePoints(drawingPoints);

    // Rescale calibration pixelLength (scaleFactor = referenceLength / pixelLength)
    const rescaledCalibration = calibration
      ? {
          ...calibration,
          pixelLength: calibration.pixelLength * ratio,
          scaleFactor: calibration.referenceLength / (calibration.pixelLength * ratio),
        }
      : null;

    // Rescale undo/redo stacks so undo restores correctly after resize
    const scaleHistoryEntry = (entry: HistoryEntry): HistoryEntry => ({
      measurements: entry.measurements.map((m) => ({
        ...m,
        points: scalePoints(m.points),
      })),
      layers: entry.layers,
    });
    const rescaledUndoStack = undoStack.map(scaleHistoryEntry);
    const rescaledRedoStack = redoStack.map(scaleHistoryEntry);

    set({
      baseScale: newBaseScale,
      _baseScaleFromViewer: true,
      measurements: rescaledMeasurements,
      drawingPoints: rescaledDrawingPoints,
      currentPoints: rescaledDrawingPoints,
      undoStack: rescaledUndoStack,
      redoStack: rescaledRedoStack,
      ...(calibration ? { calibration: rescaledCalibration } : {}),
    });

    // Persist rescaled data
    saveBaseScale(newBaseScale);
    debouncedSaveMeasurements(rescaledMeasurements);
    if (rescaledCalibration) saveCalibration(rescaledCalibration);
  },

  // Viewport dimensions
  viewportWidth: 0,
  viewportHeight: 0,
  pageWidth: 0,
  pageHeight: 0,
  setViewportSize: (width, height) => set({ viewportWidth: width, viewportHeight: height }),
  setPageSize: (width, height) => set({ pageWidth: width, pageHeight: height }),

  // Coordinate transforms
  screenToPage: (screenX, screenY) => {
    const { viewState } = get();
    return {
      x: (screenX - viewState.offsetX) / viewState.zoom,
      y: (screenY - viewState.offsetY) / viewState.zoom,
    };
  },

  pageToWorld: (pageX, pageY) => {
    const { calibration } = get();
    if (!calibration) {
      return { x: pageX, y: pageY };
    }
    return {
      x: pageX * calibration.scaleFactor,
      y: pageY * calibration.scaleFactor,
    };
  },

  // Calibration
  calibration: loadCalibration(),
  setCalibration: (cal) => {
    saveCalibration(cal);  // localStorage cache (standalone — no-op in ERP)
    set({ calibration: cal });
    // Sync to backend iff ERP mode + persisted document
    if (cal && isERPMode() && _hasPersistedDocument()) {
      const { document } = get();
      if (document) {
        metreApi.setCalibration(document.id, {
          pageNumber: cal.pageNumber,
          scaleFactor: cal.scaleFactor,
          unit: cal.unit,
          referenceLength: cal.referenceLength,
          pixelLength: cal.pixelLength,
        }).then((saved) => {
          const mapped = mapServerCalibration(saved as unknown as Record<string, unknown>);
          set({ calibration: mapped });
        }).catch((err: unknown) => console.error('[MetreStore] setCalibration backend sync failed:', err));
      }
    }
  },
  clearCalibration: () => {
    const { calibration, document } = get();
    saveCalibration(null);
    set({ calibration: null });
    if (calibration && document && isERPMode() && _hasPersistedDocument()) {
      metreApi.deleteCalibration(document.id, calibration.pageNumber)
        .catch((err: unknown) => console.error('[MetreStore] clearCalibration backend sync failed:', err));
    }
  },

  // Measurements
  measurements: loadMeasurements(),
  addMeasurement: (m) => {
    // Validate measurement value
    if (!isValidMeasurementValue(m.value)) {
      console.warn('[MetreStore] Measurement rejected: invalid value', m.value);
      return;
    }
    const state = get();
    state.pushUndo();
    set((s) => {
      const next = [...s.measurements, m];
      debouncedSaveMeasurements(next);
      return { measurements: next };
    });
    // Sync to backend (ERP mode + persisted doc): POST then swap temp id → real id.
    // After the swap, replay the current local state to the backend so any edits
    // made by the user during the in-flight POST are not lost (fixes Race #1 and #2).
    if (!isERPMode() || !_hasPersistedDocument()) return;
    const { document } = get();
    if (!document) return;
    metreApi.createMeasurement(
      document.id,
      measurementToServerBody(m) as unknown as Omit<Measurement, 'id' | 'createdAt' | 'documentId'>,
    )
      .then((created) => {
        const realId = String((created as unknown as Record<string, unknown>).id);
        set((s) => ({
          measurements: s.measurements.map((mm) =>
            mm.id === m.id ? { ...mm, id: realId, documentId: String(document.id) } : mm
          ),
          selectedMeasurementIds: s.selectedMeasurementIds.map((x) => (x === m.id ? realId : x)),
          selectedMeasurementId: s.selectedMeasurementId === m.id ? realId : s.selectedMeasurementId,
        }));
        _markSynced();
        // Replay the final local state to the backend in case the user modified
        // the measurement while the POST was in flight (color, layer, points,
        // productId…). Skip if the local state matches the payload we initially sent.
        const finalLocal = get().measurements.find((mm) => mm.id === realId);
        if (finalLocal) {
          const sentBody = measurementToServerBody(m);
          const currentBody = measurementToServerBody(finalLocal);
          if (JSON.stringify(sentBody) !== JSON.stringify(currentBody)) {
            metreApi.updateMeasurement(realId, currentBody)
              .catch((err: unknown) => console.error('[MetreStore] replay update after swap failed:', err));
          }
        }
      })
      .catch((err: unknown) => {
        console.error('[MetreStore] createMeasurement backend sync failed:', err);
        // Rollback: remove the optimistic temp measurement since it couldn't be persisted
        set((s) => ({
          measurements: s.measurements.filter((mm) => mm.id !== m.id),
          selectedMeasurementIds: s.selectedMeasurementIds.filter((x) => x !== m.id),
          selectedMeasurementId: s.selectedMeasurementId === m.id ? null : s.selectedMeasurementId,
        }));
      });
  },
  updateMeasurement: (id, updates) => {
    // Validate value if being updated
    if (updates.value !== undefined && !isValidMeasurementValue(updates.value)) {
      console.warn('[MetreStore] Measurement update rejected: invalid value', updates.value);
      return;
    }
    const state = get();
    state.pushUndo();
    set((s) => {
      const next = s.measurements.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      );
      debouncedSaveMeasurements(next);
      return { measurements: next };
    });
    // Rebuild and sync. _pushUpdateMeasurement guards on id-numeric + persisted-doc.
    const updated = get().measurements.find((m) => m.id === id);
    if (updated) _pushUpdateMeasurement(updated);
  },
  removeMeasurement: (id) => {
    const state = get();
    state.pushUndo();
    set((s) => {
      const next = s.measurements.filter((m) => m.id !== id);
      debouncedSaveMeasurements(next);
      return {
        measurements: next,
        selectedMeasurementIds: s.selectedMeasurementIds.filter((x) => x !== id),
        selectedMeasurementId: s.selectedMeasurementIds[0] === id
          ? (s.selectedMeasurementIds[1] ?? null)
          : s.selectedMeasurementIds[0] ?? null,
      };
    });
    _pushDeleteMeasurement(id);
  },
  deleteMeasurement: (id) => {
    // Alias for removeMeasurement
    get().removeMeasurement(id);
  },
  selectedMeasurementIds: [],
  selectedMeasurementId: null,  // kept in sync -- always equals selectedMeasurementIds[0] ?? null
  setSelectedMeasurementId: (id) => set({ selectedMeasurementIds: id ? [id] : [], selectedMeasurementId: id }),
  setSelectedMeasurementIds: (ids) => set({ selectedMeasurementIds: ids, selectedMeasurementId: ids[0] ?? null }),
  toggleMeasurementSelection: (id) => set((s) => {
    const idx = s.selectedMeasurementIds.indexOf(id);
    if (idx >= 0) {
      const next = s.selectedMeasurementIds.filter((x) => x !== id);
      return { selectedMeasurementIds: next, selectedMeasurementId: next[0] ?? null };
    }
    const next = [...s.selectedMeasurementIds, id];
    return { selectedMeasurementIds: next, selectedMeasurementId: next[0] ?? null };
  }),
  extendMeasurementSelection: (id, orderedIds) => set((s) => {
    const lastSelected = s.selectedMeasurementIds[s.selectedMeasurementIds.length - 1];
    if (!lastSelected) return { selectedMeasurementIds: [id], selectedMeasurementId: id };
    const startIdx = orderedIds.indexOf(lastSelected);
    const endIdx = orderedIds.indexOf(id);
    if (startIdx < 0 || endIdx < 0) return { selectedMeasurementIds: [id], selectedMeasurementId: id };
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const rangeIds = orderedIds.slice(lo, hi + 1);
    const merged = new Set([...s.selectedMeasurementIds, ...rangeIds]);
    const next = [...merged];
    return { selectedMeasurementIds: next, selectedMeasurementId: next[0] ?? null };
  }),
  updateSelectedMeasurements: (updates) => {
    const state = get();
    const ids = state.selectedMeasurementIds;
    if (ids.length === 0) return;
    if (updates.value !== undefined && !isValidMeasurementValue(updates.value)) return;
    state.pushUndo();
    set((s) => {
      const idSet = new Set(ids);
      const next = s.measurements.map((m) =>
        idSet.has(m.id) ? { ...m, ...updates } : m
      );
      debouncedSaveMeasurements(next);
      return { measurements: next };
    });
    // Push each updated measurement to the backend
    const updated = get().measurements;
    for (const id of ids) {
      const m = updated.find((mm) => mm.id === id);
      if (m) _pushUpdateMeasurement(m);
    }
  },
  removeSelectedMeasurements: () => {
    const state = get();
    const ids = state.selectedMeasurementIds;
    if (ids.length === 0) return;
    state.pushUndo();
    set((s) => {
      const idSet = new Set(ids);
      const next = s.measurements.filter((m) => !idSet.has(m.id));
      debouncedSaveMeasurements(next);
      return { measurements: next, selectedMeasurementIds: [], selectedMeasurementId: null };
    });
    // Push each delete to the backend
    for (const id of ids) {
      _pushDeleteMeasurement(id);
    }
  },
  selectMeasurement: (id) => set({ selectedMeasurementIds: id ? [id] : [], selectedMeasurementId: id }),
  setMeasurements: (measurements) => set({ measurements }),
  updateMeasurementPoints: (id, points, value) => {
    set((s) => ({
      measurements: s.measurements.map((m) =>
        m.id === id ? { ...m, points, value } : m
      ),
    }));
  },
  saveMeasurementsToStorage: () => {
    const { measurements, selectedMeasurementIds } = get();
    debouncedSaveMeasurements(measurements);
    // After a drag ends, push the moved measurements to backend.
    if (selectedMeasurementIds.length > 0) {
      for (const id of selectedMeasurementIds) {
        const m = measurements.find((mm) => mm.id === id);
        if (m) _pushUpdateMeasurement(m);
      }
    }
  },

  // Layers
  layers: (() => { const saved = loadLayers(); return saved.length > 0 ? saved : [DEFAULT_LAYER]; })(),
  addLayer: (layer) => {
    const state = get();
    state.pushUndo();
    set((s) => {
      const next = [...s.layers, layer];
      debouncedSaveLayers(next);
      return { layers: next, activeLayerId: layer.id };
    });
    if (isERPMode() && _hasPersistedDocument()) {
      const { document } = get();
      if (document) {
        metreApi.createLayer(document.id, {
          name: layer.name,
          color: layer.color,
          visible: layer.visible,
          locked: layer.locked,
          // P3.4 : propager la liaison BOM si presente (cas import/AI auto-create
          // layer per section, ou future feature "creer calque pre-lie")
          compositeId: layer.compositeId ?? null,
          compositeInputs: layer.compositeInputs ?? null,
        }).then((created) => {
          const realId = String((created as unknown as Record<string, unknown>).id);
          // Snapshot the measurements that were created with this temp layer id
          // *before* we rewrite state; we'll push a layer_id update to each of them
          // that are already persisted (numeric backend ids).
          const impactedBackendIds = get().measurements
            .filter((m) => m.layer === layer.id && /^\d+$/.test(m.id))
            .map((m) => m.id);
          set((s) => ({
            layers: s.layers.map((l) => (l.id === layer.id ? { ...l, id: realId } : l)),
            // Re-point measurements that referenced the old temp layer id (local state)
            measurements: s.measurements.map((m) => m.layer === layer.id ? { ...m, layer: realId } : m),
            activeLayerId: s.activeLayerId === layer.id ? realId : s.activeLayerId,
          }));
          // Backend measurements were persisted with layer_id=null earlier;
          // re-sync their layer_id to the now-known real id.
          const realIdNum = parseInt(realId, 10);
          for (const mId of impactedBackendIds) {
            metreApi.updateMeasurement(mId, { layerId: realIdNum } as unknown as Partial<Measurement>)
              .catch((err: unknown) => console.error('[MetreStore] layer->measurement re-sync failed:', err));
          }
        }).catch((err: unknown) => console.error('[MetreStore] createLayer backend sync failed:', err));
      }
    }
  },
  updateLayer: (id, updates) => {
    set((s) => {
      const next = s.layers.map((l) => (l.id === id ? { ...l, ...updates } : l));
      debouncedSaveLayers(next);
      return { layers: next };
    });
    if (isERPMode() && _hasPersistedDocument() && /^\d+$/.test(id)) {
      metreApi.updateLayerApi(id, updates)
        .then(() => _markSynced())
        .catch((err: unknown) => console.error('[MetreStore] updateLayer backend sync failed:', err));
    }
  },
  removeLayer: (id) => {
    const state = get();
    state.pushUndo();
    set((s) => {
      const nextLayers = s.layers.filter((l) => l.id !== id);
      const nextMeasurements = s.measurements.filter((m) => m.layer !== id);
      debouncedSaveLayers(nextLayers);
      debouncedSaveMeasurements(nextMeasurements);
      return {
        layers: nextLayers,
        measurements: nextMeasurements,
        activeLayerId: s.activeLayerId === id ? null : s.activeLayerId,
      };
    });
    if (isERPMode() && _hasPersistedDocument() && /^\d+$/.test(id)) {
      // Delete the layer and each of its measurements on the backend too
      // (backend's ON DELETE SET NULL wouldn't have removed them, only detached).
      const prevMeasurements = state.measurements.filter((m) => m.layer === id);
      metreApi.deleteLayerApi(id)
        .catch((err: unknown) => console.error('[MetreStore] deleteLayer backend sync failed:', err));
      for (const m of prevMeasurements) {
        _pushDeleteMeasurement(m.id);
      }
    }
  },
  deleteLayer: (id) => {
    // Alias for removeLayer
    get().removeLayer(id);
  },
  activeLayerId: 'default',
  setActiveLayerId: (id) => set({ activeLayerId: id }),
  setActiveLayer: (id) => set({ activeLayerId: id }),
  setLayers: (layers) => set({ layers }),
  moveLayerUp: (id) =>
    set((s) => {
      const idx = s.layers.findIndex((l) => l.id === id);
      if (idx <= 0) return s;
      const next = [...s.layers];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      debouncedSaveLayers(next);
      return { layers: next };
    }),
  moveLayerDown: (id) =>
    set((s) => {
      const idx = s.layers.findIndex((l) => l.id === id);
      if (idx < 0 || idx >= s.layers.length - 1) return s;
      const next = [...s.layers];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      debouncedSaveLayers(next);
      return { layers: next };
    }),

  // Drawing
  drawingPoints: [],
  setDrawingPoints: (pts) => set({ drawingPoints: pts, currentPoints: pts }),
  addDrawingPoint: (pt) =>
    set((s) => ({
      drawingPoints: [...s.drawingPoints, pt],
      currentPoints: [...s.currentPoints, pt],
      isDrawing: true,
    })),
  clearDrawing: () =>
    // Also reset the active-snap flags so a snap visual engaged during
    // the drawing session does not survive into a subsequent select /
    // drag (would otherwise leave the green diamond marker stuck on
    // canvas and a stale "SNAP: endpoint" badge in the BottomBar).
    set({
      drawingPoints: [],
      currentPoints: [],
      isDrawing: false,
      liveMeasurementValue: '',
      activeCountId: null,
      activeSnapPoint: null,
      activeSnapType: null,
    }),

  // currentPoints (alias for drawingPoints, kept in sync)
  currentPoints: [],
  addPoint: (point) =>
    set((s) => ({
      drawingPoints: [...s.drawingPoints, point],
      currentPoints: [...s.currentPoints, point],
      isDrawing: true,
    })),
  removeLastPoint: () =>
    set((s) => {
      const next = s.drawingPoints.slice(0, -1);
      return {
        drawingPoints: next,
        currentPoints: next,
        isDrawing: next.length > 0,
      };
    }),
  clearPoints: () =>
    // Mirrors clearDrawing but kept as a separate action because some
    // call-sites (Escape, right-click) call this one. Same rationale:
    // wipe the snap visuals so they don't leak across mode switches.
    set({
      drawingPoints: [],
      currentPoints: [],
      isDrawing: false,
      activeCountId: null,
      activeSnapPoint: null,
      activeSnapType: null,
    }),

  // Snap data
  snapPoints: [],
  setSnapPoints: (points) => set({ snapPoints: points }),
  activeSnapPoint: null,
  setActiveSnapPoint: (point) => set({ activeSnapPoint: point }),

  // Toggles
  snapEnabled: true,
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  orthoEnabled: true,
  toggleOrtho: () => set((s) => ({ orthoEnabled: !s.orthoEnabled })),
  gridEnabled: false,
  toggleGrid: () => set((s) => ({ gridEnabled: !s.gridEnabled })),

  // Mouse
  mousePosition: { x: 0, y: 0 },
  setMousePosition: (p) => {
    const world = get().pageToWorld(p.x, p.y);
    set({ mousePosition: p, mouseWorldPosition: world });
  },
  mouseWorldPosition: null,
  setMouseWorldPosition: (p) => set({ mouseWorldPosition: p }),
  liveMeasurementValue: '',
  setLiveMeasurementValue: (v) => set({ liveMeasurementValue: v }),
  activeSnapType: null,
  setActiveSnapType: (s) => set({ activeSnapType: s }),

  // Undo / Redo (bounded to MAX_UNDO entries)
  undoStack: [],
  redoStack: [],
  pushUndo: () => {
    const { measurements, layers, undoStack } = get();
    const entry: HistoryEntry = {
      measurements: structuredClone(measurements),
      layers: structuredClone(layers),
    };
    set({ undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), entry], redoStack: [] });
  },
  undo: () => {
    const { undoStack, measurements, layers } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    const redoEntry: HistoryEntry = {
      measurements: structuredClone(measurements),
      layers: structuredClone(layers),
    };
    debouncedSaveMeasurements(prev.measurements);
    debouncedSaveLayers(prev.layers);
    set({
      measurements: prev.measurements,
      layers: prev.layers,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, redoEntry],
    });
    // Propagate the restored state to the backend
    _diffAndPushMeasurements(measurements, prev.measurements);
  },
  redo: () => {
    const { redoStack, measurements, layers } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const undoEntry: HistoryEntry = {
      measurements: structuredClone(measurements),
      layers: structuredClone(layers),
    };
    debouncedSaveMeasurements(next.measurements);
    debouncedSaveLayers(next.layers);
    set({
      measurements: next.measurements,
      layers: next.layers,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...get().undoStack, undoEntry],
    });
    // Propagate the redo-forward state to the backend
    _diffAndPushMeasurements(measurements, next.measurements);
  },
  clearHistory: () => set({ undoStack: [], redoStack: [] }),

  // Calibration dialog
  pendingCalibrationPxLen: null,
  setPendingCalibrationPxLen: (v) => set({ pendingCalibrationPxLen: v }),

  // Product Catalog (hybrid: API in ERP mode, localStorage in standalone)
  products: loadProducts(),
  productsLoaded: false,
  fetchProducts: async () => {
    if (!isERPMode()) {
      // Standalone: already loaded from localStorage
      set({ productsLoaded: true });
      return;
    }
    try {
      const serverProducts = await metreApi.listProducts();
      if (serverProducts.length > 0) {
        const mapped = (serverProducts as unknown as Record<string, unknown>[]).map(mapServerProduct);
        set({ products: mapped, productsLoaded: true });
      } else {
        // First time for this tenant: seed with default catalog
        const toImport = DEFAULT_CATALOG.map(({ id: _id, ...rest }) => rest);
        const imported = await metreApi.bulkImportProducts(toImport);
        const mapped = (imported as unknown as Record<string, unknown>[]).map(mapServerProduct);
        set({ products: mapped.length > 0 ? mapped : DEFAULT_CATALOG, productsLoaded: true });
      }
    } catch (err) {
      console.error('[MetreStore] Failed to fetch products from server, using defaults:', err);
      set({ productsLoaded: true });
    }
  },
  addProduct: (p) => {
    // Optimistic update
    set((s) => {
      const next = [...s.products, p];
      saveProducts(next);
      return { products: next };
    });
    // Persist to server in ERP mode
    if (isERPMode()) {
      const { id: _id, ...rest } = p;
      metreApi.createProduct(rest).then((created) => {
        const serverId = String((created as unknown as Record<string, unknown>).id);
        set((s) => ({
          products: s.products.map((prod) =>
            prod.id === p.id ? { ...prod, id: serverId } : prod
          ),
        }));
      }).catch((err: unknown) => console.error('[MetreStore] Failed to create product:', err));
    }
  },
  updateProduct: (id, updates) => {
    set((s) => {
      const next = s.products.map((p) => (p.id === id ? { ...p, ...updates } : p));
      saveProducts(next);
      return { products: next };
    });
    if (isERPMode()) {
      metreApi.updateProductApi(id, updates).catch((err: unknown) =>
        console.error('[MetreStore] Failed to update product:', err)
      );
    }
  },
  removeProduct: (id) => {
    // Snapshot the removed product so we can rollback if the backend refuses
    // the delete (409 FK violation — product is used by a composite).
    const removed = get().products.find((p) => p.id === id);
    set((s) => {
      const next = s.products.filter((p) => p.id !== id);
      saveProducts(next);
      return { products: next };
    });
    if (isERPMode() && removed) {
      metreApi.deleteProductApi(id).catch((err: unknown) => {
        // Detect the 409 "utilise comme composant" response and restore the product.
        const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } };
        const status = axiosErr?.response?.status;
        const detail = axiosErr?.response?.data?.detail;
        if (status === 409) {
          // Rollback: put the product back in the store
          set((s) => ({
            products: [...s.products, removed],
          }));
          // Surface the error to the user
          if (typeof window !== 'undefined' && window.alert) {
            window.alert(detail ?? 'Ce produit est utilise comme composant d\'un assemblage et ne peut pas etre supprime. Retirez-le d\'abord des produits composites qui le referencent.');
          }
        } else {
          console.error('[MetreStore] Failed to delete product:', err);
        }
      });
    }
  },
  refreshProduct: async (id) => {
    if (!isERPMode()) return;
    try {
      const fresh = await metreApi.getProductById(id);
      const mapped = mapServerProduct(fresh as unknown as Record<string, unknown>);
      set((s) => ({
        products: s.products.map((p) => (p.id === id ? mapped : p)),
      }));
    } catch (err: unknown) {
      console.error('[MetreStore] refreshProduct failed:', err);
    }
  },
  showCatalog: false,
  toggleCatalog: () => set((s) => ({ showCatalog: !s.showCatalog })),
  importCatalog: (products) => {
    saveProducts(products);
    set({ products });
    if (!isERPMode()) return;

    // Two-pass import so composite products preserve their BOM (components):
    // Pass 1 — bulk POST all products (simple + composite shells, no components).
    // Pass 2 — for each composite, re-attach its components by matching each
    //          `childName` to a newly-created backend product by name+category.
    void (async () => {
      try {
        const toImport = products.map(({ id: _id, components: _c, ...rest }) => rest);
        const imported = await metreApi.bulkImportProducts(toImport);
        const mappedImported = (imported as unknown as Record<string, unknown>[]).map(mapServerProduct);

        // Build a lookup: "category|name" → backend id (only newly imported products)
        const byKey = new Map<string, string>();
        for (const p of mappedImported) {
          byKey.set(`${p.category}|${p.name}`, p.id);
        }

        // Pass 2: re-create components for each composite in the original input
        let hasComposites = false;
        for (const orig of products) {
          if (!orig.isComposite || !orig.components || orig.components.length === 0) continue;
          hasComposites = true;
          const parentId = byKey.get(`${orig.category}|${orig.name}`);
          if (!parentId || !/^\d+$/.test(parentId)) continue;
          for (const c of orig.components) {
            // Match the child by denormalised childName/childCategory stored in the export
            if (!c.childName) continue;
            const childKey = c.childCategory ? `${c.childCategory}|${c.childName}` : null;
            const childId = childKey ? byKey.get(childKey) : undefined;
            if (!childId || !/^\d+$/.test(childId)) continue;
            try {
              await metreApi.addProductComponent(parentId, {
                childProductId: parseInt(childId, 10),
                quantityPerUnit: c.quantityPerUnit ?? 1,
                notes: c.notes,
                sortOrder: c.sortOrder ?? 0,
              });
            } catch (componentErr: unknown) {
              console.error('[MetreStore] Failed to restore composite component:', componentErr);
            }
          }
        }

        // Refresh the store with the canonical backend state (composites now
        // include populated components).
        if (hasComposites) {
          const refreshed = await metreApi.listProducts();
          const refreshedMapped = (refreshed as unknown as Record<string, unknown>[]).map(mapServerProduct);
          if (refreshedMapped.length > 0) set({ products: refreshedMapped });
        } else if (mappedImported.length > 0) {
          set({ products: mappedImported });
        }
      } catch (err: unknown) {
        console.error('[MetreStore] Failed to bulk import:', err);
      }
    })();
  },

  // --- Labor Catalog (Corps de metier CCQ) ---
  laborTrades: loadLaborTrades(),
  showLaborCatalog: false,
  toggleLaborCatalog: () => set((s) => ({ showLaborCatalog: !s.showLaborCatalog })),
  addLaborTrade: (trade) => {
    set((s) => {
      const next = [...s.laborTrades, trade];
      saveLaborTrades(next);
      return { laborTrades: next };
    });
  },
  updateLaborTrade: (id, updates) => {
    set((s) => {
      const next = s.laborTrades.map((t) => (t.id === id ? { ...t, ...updates } : t));
      saveLaborTrades(next);
      return { laborTrades: next };
    });
  },
  removeLaborTrade: (id) => {
    set((s) => {
      const next = s.laborTrades.filter((t) => t.id !== id);
      saveLaborTrades(next);
      return { laborTrades: next };
    });
  },
  importLaborCatalog: (trades) => {
    saveLaborTrades(trades);
    set({ laborTrades: trades });
  },

  // Summary panel
  showSummary: false,
  toggleSummary: () => set((s) => ({ showSummary: !s.showSummary })),

  // Calculator panel
  showCalculator: false,
  toggleCalculator: () => set((s) => ({ showCalculator: !s.showCalculator })),

  // Slope converter panel
  showSlopeConverter: false,
  toggleSlopeConverter: () => set((s) => ({ showSlopeConverter: !s.showSlopeConverter })),

  // --- Symbol Blocks ---
  symbolBlocks: loadSymbolBlocks(),
  showSymbolCatalog: false,
  toggleSymbolCatalog: () => set((s) => ({ showSymbolCatalog: !s.showSymbolCatalog })),
  activeSymbolBlockId: null,
  setActiveSymbolBlock: (id) => set({ activeSymbolBlockId: id }),
  addSymbolBlock: (block) => {
    set((s) => {
      const next = [...s.symbolBlocks, block];
      saveSymbolBlocks(next);
      return { symbolBlocks: next };
    });
  },
  updateSymbolBlock: (id, updates) => {
    set((s) => {
      const next = s.symbolBlocks.map((b) => (b.id === id ? { ...b, ...updates } : b));
      saveSymbolBlocks(next);
      return { symbolBlocks: next };
    });
  },
  removeSymbolBlock: (id) => {
    set((s) => {
      const next = s.symbolBlocks.filter((b) => b.id !== id);
      saveSymbolBlocks(next);
      return { symbolBlocks: next };
    });
  },
  importSymbolBlocks: (blocks) => {
    saveSymbolBlocks(blocks);
    set({ symbolBlocks: blocks });
  },

  // Measurement groups
  measurementGroups: loadGroups(),
  addMeasurementGroup: (name) => {
    set((s) => {
      const next = [...new Set([...s.measurementGroups, name])];
      saveGroups(next);
      return { measurementGroups: next };
    });
  },
  removeMeasurementGroup: (name) => {
    set((s) => {
      const next = s.measurementGroups.filter((g) => g !== name);
      saveGroups(next);
      return { measurementGroups: next };
    });
  },

  // Incremental count
  activeCountId: null,
  incrementCount: (pt) => {
    const state = get();
    const activeId = state.activeCountId;

    // If there's an active count session, add a point to the existing measurement
    if (activeId) {
      const existing = state.measurements.find((m) => m.id === activeId);
      if (existing) {
        state.pushUndo();
        const newValue = existing.value + 1;
        set((s) => {
          const next = s.measurements.map((m) =>
            m.id === activeId
              ? { ...m, points: [...m.points, pt], value: newValue }
              : m
          );
          debouncedSaveMeasurements(next);
          return {
            measurements: next,
            liveMeasurementValue: `Comptage: ${newValue}`,
            selectedMeasurementIds: [activeId],
            selectedMeasurementId: activeId,
          };
        });
        // Sync the updated count to the backend (if persisted)
        const updated = get().measurements.find((mm) => mm.id === activeId);
        if (updated) _pushUpdateMeasurement(updated);
        return;
      }
      // Measurement was removed (e.g. undo past creation) -- fall through to create new
    }

    // Create a new count measurement
    const layerId = state.activeLayerId ?? 'default';
    const layer = state.layers.find((l) => l.id === layerId);
    const color = layer?.color ?? '#3b82f6';
    const unit = state.calibration?.unit ?? 'm';

    const m: Measurement = {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      documentId: state.document?.id ?? '',
      pageNumber: state.currentPage,
      type: 'count',
      label: '',
      value: 1,
      unit,
      points: [pt],
      color,
      layer: layerId,
      createdAt: new Date().toISOString(),
    };

    state.pushUndo();
    set((s) => {
      const next = [...s.measurements, m];
      debouncedSaveMeasurements(next);
      return {
        measurements: next,
        activeCountId: m.id,
        liveMeasurementValue: 'Comptage: 1',
        selectedMeasurementIds: [m.id],
        selectedMeasurementId: m.id,
      };
    });
    _pushCreateMeasurement(m);
  },
  finalizeCount: () => set({ activeCountId: null, liveMeasurementValue: '' }),

  // Duplicate measurement
  duplicateMeasurement: (id) => {
    const state = get();
    const original = state.measurements.find((m) => m.id === id);
    if (!original) return;
    state.pushUndo();
    const clone: Measurement = {
      ...structuredClone(original),
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: original.label ? `${original.label} (copie)` : '',
      createdAt: new Date().toISOString(),
      // Offset points slightly so the copy is visible
      points: original.points.map((p) => ({ x: p.x + 15, y: p.y + 15 })),
    };
    set((s) => {
      const next = [...s.measurements, clone];
      debouncedSaveMeasurements(next);
      return { measurements: next, selectedMeasurementIds: [clone.id], selectedMeasurementId: clone.id };
    });
    _pushCreateMeasurement(clone);
  },

  // Bulk duplicate all selected measurements
  duplicateSelectedMeasurements: () => {
    const state = get();
    const ids = state.selectedMeasurementIds;
    if (ids.length === 0) return;
    state.pushUndo();
    const clones: Measurement[] = [];
    for (const id of ids) {
      const original = state.measurements.find((m) => m.id === id);
      if (!original) continue;
      clones.push({
        ...structuredClone(original),
        id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: original.label ? `${original.label} (copie)` : '',
        createdAt: new Date().toISOString(),
        points: original.points.map((p) => ({ x: p.x + 15, y: p.y + 15 })),
      });
    }
    set((s) => {
      const next = [...s.measurements, ...clones];
      debouncedSaveMeasurements(next);
      const cloneIds = clones.map((c) => c.id);
      return { measurements: next, selectedMeasurementIds: cloneIds, selectedMeasurementId: cloneIds[0] ?? null };
    });
    for (const c of clones) _pushCreateMeasurement(c);
  },

  // --- Clipboard (cross-page copy/paste) ---
  clipboard: [],
  copySelectedToClipboard: () => {
    const { selectedMeasurementIds, measurements } = get();
    if (selectedMeasurementIds.length === 0) return;
    const copied = measurements
      .filter((m) => selectedMeasurementIds.includes(m.id))
      .map((m) => structuredClone(m));
    set({ clipboard: copied });
  },
  pasteFromClipboard: () => {
    const { clipboard, currentPage, measurements, layers, activeLayerId } = get();
    if (clipboard.length === 0) return;
    get().pushUndo();
    const layerIds = new Set(layers.map((l) => l.id));
    const samePage = clipboard.some((m) => m.pageNumber === currentPage);
    const newMeasurements = clipboard.map((m) => ({
      ...structuredClone(m),
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      pageNumber: currentPage,
      createdAt: new Date().toISOString(),
      // Validate layer still exists, fallback to active layer or default
      layer: layerIds.has(m.layer) ? m.layer : (activeLayerId || 'default'),
      // Offset points when pasting on the same page to avoid exact overlap
      ...(samePage ? { points: m.points.map((p: Point) => ({ x: p.x + 15, y: p.y + 15 })) } : {}),
    }));
    const next = [...measurements, ...newMeasurements];
    debouncedSaveMeasurements(next);
    set({
      measurements: next,
      selectedMeasurementIds: newMeasurements.map((m) => m.id),
      selectedMeasurementId: newMeasurements[0]?.id ?? null,
    });
    // Persist each pasted measurement
    for (const m of newMeasurements) _pushCreateMeasurement(m);
  },

  // --- Property clipboard (copy/paste properties without geometry) ---
  propertyClipboard: null,
  copyMeasurementProperties: (id: string) => {
    const m = get().measurements.find((mm) => mm.id === id);
    if (!m) return;
    set({
      propertyClipboard: {
        productId: m.productId,
        color: m.color,
        strokeWidth: m.strokeWidth,
        fontSize: m.fontSize,
        opacity: m.opacity,
        slopeFactor: m.slopeFactor,
        group: m.group,
        layer: m.layer,
      },
    });
  },
  pasteMeasurementProperties: () => {
    const { propertyClipboard, selectedMeasurementIds, measurements } = get();
    if (!propertyClipboard || selectedMeasurementIds.length === 0) return;
    get().pushUndo();
    const ids = new Set(selectedMeasurementIds);
    const next = measurements.map((m) => {
      if (!ids.has(m.id)) return m;
      return {
        ...m,
        productId: propertyClipboard.productId,
        color: propertyClipboard.color,
        strokeWidth: propertyClipboard.strokeWidth,
        fontSize: propertyClipboard.fontSize,
        opacity: propertyClipboard.opacity,
        slopeFactor: propertyClipboard.slopeFactor,
        group: propertyClipboard.group,
        layer: propertyClipboard.layer,
      };
    });
    debouncedSaveMeasurements(next);
    set({ measurements: next });
    // Sync each updated measurement
    for (const id of selectedMeasurementIds) {
      const m = next.find((mm) => mm.id === id);
      if (m) _pushUpdateMeasurement(m);
    }
  },

  // --- Draw order ---
  bringMeasurementToFront: (id) => {
    const state = get();
    const m = state.measurements.find((mm) => mm.id === id);
    if (!m) return;
    state.pushUndo();
    const sameLayer = state.measurements.filter((mm) => mm.layer === m.layer);
    const maxZ = sameLayer.reduce((max, mm) => Math.max(max, mm.zOrder ?? 0), 0);
    const next = state.measurements.map((mm) =>
      mm.id === id ? { ...mm, zOrder: maxZ + 1 } : mm
    );
    debouncedSaveMeasurements(next);
    set({ measurements: next });
    const updated = next.find((mm) => mm.id === id);
    if (updated) _pushUpdateMeasurement(updated);
  },
  sendMeasurementToBack: (id) => {
    const state = get();
    const m = state.measurements.find((mm) => mm.id === id);
    if (!m) return;
    state.pushUndo();
    const sameLayer = state.measurements.filter((mm) => mm.layer === m.layer);
    const minZ = sameLayer.reduce((min, mm) => Math.min(min, mm.zOrder ?? 0), 0);
    const next = state.measurements.map((mm) =>
      mm.id === id ? { ...mm, zOrder: minZ - 1 } : mm
    );
    debouncedSaveMeasurements(next);
    set({ measurements: next });
    const updated = next.find((mm) => mm.id === id);
    if (updated) _pushUpdateMeasurement(updated);
  },
  moveMeasurementUp: (id) => {
    const state = get();
    const m = state.measurements.find((mm) => mm.id === id);
    if (!m) return;
    const myZ = m.zOrder ?? 0;
    const sameLayer = state.measurements.filter((mm) => mm.layer === m.layer && mm.id !== id);
    // Find the closest measurement above
    const above = sameLayer
      .filter((mm) => (mm.zOrder ?? 0) >= myZ)
      .sort((a, b) => (a.zOrder ?? 0) - (b.zOrder ?? 0));
    if (above.length === 0) return;
    state.pushUndo();
    const target = above[0];
    const targetZ = target.zOrder ?? 0;
    const next = state.measurements.map((mm) => {
      if (mm.id === id) return { ...mm, zOrder: targetZ + 1 };
      return mm;
    });
    debouncedSaveMeasurements(next);
    set({ measurements: next });
    const updated = next.find((mm) => mm.id === id);
    if (updated) _pushUpdateMeasurement(updated);
  },
  moveMeasurementDown: (id) => {
    const state = get();
    const m = state.measurements.find((mm) => mm.id === id);
    if (!m) return;
    const myZ = m.zOrder ?? 0;
    const sameLayer = state.measurements.filter((mm) => mm.layer === m.layer && mm.id !== id);
    // Find the closest measurement below
    const below = sameLayer
      .filter((mm) => (mm.zOrder ?? 0) <= myZ)
      .sort((a, b) => (b.zOrder ?? 0) - (a.zOrder ?? 0));
    if (below.length === 0) return;
    state.pushUndo();
    const target = below[0];
    const targetZ = target.zOrder ?? 0;
    const next = state.measurements.map((mm) => {
      if (mm.id === id) return { ...mm, zOrder: targetZ - 1 };
      return mm;
    });
    debouncedSaveMeasurements(next);
    set({ measurements: next });
    const updated = next.find((mm) => mm.id === id);
    if (updated) _pushUpdateMeasurement(updated);
  },

  // --- Transform: rotate 45 deg clockwise around centroid ---
  rotateMeasurement45: (id) => {
    const state = get();
    const m = state.measurements.find((mm) => mm.id === id);
    if (!m || m.points.length === 0) return;
    state.pushUndo();
    // Compute centroid
    const cx = m.points.reduce((s, p) => s + p.x, 0) / m.points.length;
    const cy = m.points.reduce((s, p) => s + p.y, 0) / m.points.length;
    // Rotate each point 45 deg clockwise around centroid
    const angle = Math.PI / 4; // 45 deg
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const rotatedPoints = m.points.map((p) => ({
      x: cx + (p.x - cx) * cosA - (p.y - cy) * sinA,
      y: cy + (p.x - cx) * sinA + (p.y - cy) * cosA,
    }));
    set((s) => {
      const next = s.measurements.map((mm) =>
        mm.id === id ? { ...mm, points: rotatedPoints } : mm
      );
      debouncedSaveMeasurements(next);
      return { measurements: next };
    });
    const updated = get().measurements.find((mm) => mm.id === id);
    if (updated) _pushUpdateMeasurement(updated);
  },

  // --- Transform: mirror copy (creates a new mirrored measurement) ---
  mirrorCopyMeasurement: (id, axis) => {
    const state = get();
    const original = state.measurements.find((m) => m.id === id);
    if (!original || original.points.length === 0) return;
    state.pushUndo();
    // Compute centroid
    const cx = original.points.reduce((s, p) => s + p.x, 0) / original.points.length;
    const cy = original.points.reduce((s, p) => s + p.y, 0) / original.points.length;
    // Mirror points around centroid axis, then offset so copy sits beside original
    const mirroredPoints = original.points.map((p) => {
      if (axis === 'horizontal') {
        // Flip X around centroid, then shift right by the full width + gap
        return { x: cx - (p.x - cx), y: p.y };
      } else {
        // Flip Y around centroid, then shift down by the full height + gap
        return { x: p.x, y: cy - (p.y - cy) };
      }
    });
    // Compute bounding box of original to offset the copy
    const minX = Math.min(...original.points.map((p) => p.x));
    const maxX = Math.max(...original.points.map((p) => p.x));
    const minY = Math.min(...original.points.map((p) => p.y));
    const maxY = Math.max(...original.points.map((p) => p.y));
    const gap = 20; // small gap between original and copy
    const offsetPoints = mirroredPoints.map((p) => {
      if (axis === 'horizontal') {
        return { x: p.x + (maxX - minX) + gap, y: p.y };
      } else {
        return { x: p.x, y: p.y + (maxY - minY) + gap };
      }
    });
    const clone: Measurement = {
      ...structuredClone(original),
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: original.label ? `${original.label} (miroir)` : '',
      createdAt: new Date().toISOString(),
      points: offsetPoints,
    };
    set((s) => {
      const next = [...s.measurements, clone];
      debouncedSaveMeasurements(next);
      return { measurements: next, selectedMeasurementIds: [clone.id], selectedMeasurementId: clone.id };
    });
    _pushCreateMeasurement(clone);
  },

  // Unit system (imperial / metric toggle)
  displayUnit: 'imperial' as 'imperial' | 'metric',
  toggleDisplayUnit: () => set((s) => ({
    displayUnit: s.displayUnit === 'imperial' ? 'metric' : 'imperial',
  })),

  // Saved métré (server-persisted project)
  currentMetreProject: null,
  lastSyncAt: null,
  uploadError: null,
  setUploadError: (err) => set({ uploadError: err }),
  setCurrentMetreProject: (p) =>
    // Always reset `lastSyncAt` when the active project changes — otherwise
    // the SavedBar would briefly show "Sauvegardé il y a Xh" carried over
    // from the previous métré until the first new sync confirmation.
    set((s) => ({
      currentMetreProject: p,
      lastSyncAt: p?.id !== s.currentMetreProject?.id ? null : s.lastSyncAt,
      uploadError: p?.id !== s.currentMetreProject?.id ? null : s.uploadError,
    })),
  closeMetreProject: () => {
    // Drop the document — setDocument(null) wipes measurements/layers/calibration
    // and the cached binary. Then unset the project itself.
    // Also reset `baseScale` and `_baseScaleFromViewer` so the next métré opened
    // doesn't inherit a stale viewport scale from this one — would corrupt the
    // rescale logic in `loadDocumentData` (Case A would fire with a wrong
    // currentBaseScale, dragging measurements off-anchor). The init branch in
    // `setBaseScale` (`if (!oldBaseScale || oldBaseScale <= 0)`) handles `0` cleanly.
    get().setDocument(null);
    set({
      currentMetreProject: null,
      lastSyncAt: null,
      uploadError: null,
      baseScale: 0,
      _baseScaleFromViewer: false,
    });
  },

  // UI
  showLeftPanel: true,
  toggleLeftPanel: () => set((s) => ({ showLeftPanel: !s.showLeftPanel })),
  showRightPanel: true,
  toggleRightPanel: () => set((s) => ({ showRightPanel: !s.showRightPanel })),
  leftPanelWidth: 260,
  rightPanelWidth: 280,

  // === AI DETECTIONS slice (Phase 1 + 2) ===
  aiDetections: [],
  aiDetectionLoading: false,
  aiDetectionError: null,
  aiDetectionLastRun: null,
  aiMultiSectionResult: null,
  aiAvailableSections: [],

  setAIDetections: (detections) => set({ aiDetections: detections }),

  appendAIDetections: (detections) => set((state) => ({
    aiDetections: [...state.aiDetections, ...detections],
  })),

  removeAIDetection: (detectionId) => set((state) => ({
    aiDetections: state.aiDetections.filter((d) => d.id !== detectionId),
  })),

  // Round 8 C1 fix: setAIDetectionLoading(true) clears stale error,
  // setAIDetectionLoading(false) is no-op on error.
  setAIDetectionLoading: (loading) => set((state) => ({
    aiDetectionLoading: loading,
    aiDetectionError: loading ? null : state.aiDetectionError,
  })),

  // Round 8 C1 fix: setError(null) MUST NOT force loading=false.
  setAIDetectionError: (error) => set({ aiDetectionError: error }),

  setAIDetectionLastRun: (result) => set({ aiDetectionLastRun: result }),

  updateAIDetectionStatus: (detectionId, status, userCorrectionValue) => set((state) => ({
    aiDetections: state.aiDetections.map((d) =>
      d.id === detectionId
        ? { ...d, status, userCorrectionValue: userCorrectionValue ?? d.userCorrectionValue ?? null }
        : d
    ),
  })),

  // Round 8 I1 fix: also clear multi-section result.
  clearAIDetections: () => set({
    aiDetections: [],
    aiDetectionLastRun: null,
    aiMultiSectionResult: null,
    aiDetectionError: null,
    aiDetectionLoading: false,
  }),

  setAIMultiSectionResult: (result) => set({ aiMultiSectionResult: result }),

  setAIAvailableSections: (sections) => set({ aiAvailableSections: sections }),

  // Reset (resets tool & drawing state)
  reset: () =>
    set({
      activeTool: 'select',
      isDrawing: false,
      drawingPoints: [],
      currentPoints: [],
      snapEnabled: true,
      orthoEnabled: true,
      gridEnabled: false,
      snapPoints: [],
      activeSnapPoint: null,
      liveMeasurementValue: '',
      activeSnapType: null,
      activeCountId: null,
      // Round 12 fix: clear AI slice on reset to avoid zombie overlays from a
      // previous run leaking into a freshly reset session.
      aiDetections: [],
      aiDetectionLoading: false,
      aiDetectionError: null,
      aiDetectionLastRun: null,
      aiMultiSectionResult: null,
      aiAvailableSections: [],
    }),
}));


/* ── Zustand selectors ──────────────────────────────────── */
// Granular selectors to prevent unnecessary re-renders.
// Components should use these instead of subscribing to the whole store.

export const useActiveTool = () => useMetreStore((s) => s.activeTool);
export const useViewState = () => useMetreStore((s) => s.viewState);
export const useMeasurements = () => useMetreStore((s) => s.measurements);
export const useLayers = () => useMetreStore((s) => s.layers);
export const useCurrentPage = () => useMetreStore((s) => s.currentPage);
export const useCalibration = () => useMetreStore((s) => s.calibration);
export const useIsDrawing = () => useMetreStore((s) => s.isDrawing);
export const useDrawingPoints = () => useMetreStore((s) => s.drawingPoints);
export const useSelectedMeasurementId = () => useMetreStore((s) => s.selectedMeasurementIds[0] ?? null);
export const useSelectedMeasurementIds = () => useMetreStore((s) => s.selectedMeasurementIds);
export const useSnapEnabled = () => useMetreStore((s) => s.snapEnabled);
export const useOrthoEnabled = () => useMetreStore((s) => s.orthoEnabled);
export const useGridEnabled = () => useMetreStore((s) => s.gridEnabled);
export const useMousePosition = () => useMetreStore((s) => s.mousePosition);
export const useProducts = () => useMetreStore((s) => s.products);
export const useShowCatalog = () => useMetreStore((s) => s.showCatalog);
export const useShowSummary = () => useMetreStore((s) => s.showSummary);
export const useShowCalculator = () => useMetreStore((s) => s.showCalculator);
export const useShowSlopeConverter = () => useMetreStore((s) => s.showSlopeConverter);
export const useDisplayUnit = () => useMetreStore((s) => s.displayUnit);
export const useShowLeftPanel = () => useMetreStore((s) => s.showLeftPanel);
export const useShowRightPanel = () => useMetreStore((s) => s.showRightPanel);
export const useLaborTrades = () => useMetreStore((s) => s.laborTrades);
export const useShowLaborCatalog = () => useMetreStore((s) => s.showLaborCatalog);


/* ── Product catalog persistence (hybrid: API in ERP mode, localStorage standalone) ── */

const PRODUCTS_KEY = 'metre-products';
const PRODUCTS_VERSION_KEY = 'metre-products-version';

/** Check if running inside the ERP (multi-tenant mode). */
function isERPMode(): boolean {
  const ctx = getERPContext();
  return !!(ctx && ctx.tenant_schema && ctx.user_id);
}

/** Map a server product (id: number, camelCase from interceptor) to the store Product (id: string). */
function mapServerProduct(p: Record<string, unknown>): Product {
  const rawComponents = Array.isArray(p.components) ? (p.components as Record<string, unknown>[]) : [];
  return {
    id: String(p.id),
    name: (p.name as string) ?? '',
    category: (p.category as string) ?? '',
    dimensions: (p.dimensions as string) ?? '',
    price: (p.price as number) ?? 0,
    priceUnit: (p.priceUnit as string) ?? 'un',
    color: (p.color as string) ?? '#3b82f6',
    wastePct: (p.wastePct as number) ?? 0,
    isComposite: !!p.isComposite,
    displayMode: (p.displayMode as 'detailed' | 'summary') ?? 'detailed',
    priceOverride: (p.priceOverride as number | null) ?? null,
    description: (p.description as string) ?? undefined,
    // BOM parametric inputs schema (NULL when the composite has no formula-driven children).
    // Defensive: if the backend returns a non-array (corrupt JSONB, scalar, string by error),
    // fallback to null instead of letting the panel crash on `for-of` over a non-iterable.
    bomInputs: Array.isArray(p.bomInputs) ? (p.bomInputs as Product['bomInputs']) : null,
    // Labour-time fields for the estimation TSV (composite BOMs).
    nbHommes: (p.nbHommes as number | null) ?? null,
    nbHrsParJour: (p.nbHrsParJour as number | null) ?? null,
    nbJours: (p.nbJours as number | null) ?? null,
    numeroSection: (p.numeroSection as string | null) ?? null,
    laborTradeId: (p.laborTradeId as string | null) ?? null,
    components: rawComponents.map(mapServerComponent),
  };
}

export function mapServerComponent(c: Record<string, unknown>): ProductComponent {
  // Defensive numeric coercion: backends sometimes return DECIMAL/NUMERIC as strings.
  // Without `Number(...)`, the type assertion would leave `"1.5"` as a string, which
  // would later poison `buildCumulFromSections` (Number.isFinite("1.5")===false → 0).
  const rawQty = c.quantityPerUnit;
  const qty = typeof rawQty === 'number'
    ? rawQty
    : (rawQty != null ? Number(rawQty) : 1);
  return {
    id: String(c.id),
    parentProductId: String(c.parentProductId),
    childProductId: String(c.childProductId),
    quantityPerUnit: Number.isFinite(qty) ? qty : 1,
    // Parametric formula evaluated against the parent's bomInputs at runtime.
    formula: (c.formula as string | null) ?? null,
    notes: (c.notes as string) ?? undefined,
    sortOrder: (c.sortOrder as number) ?? 0,
    childName: (c.childName as string) ?? undefined,
    childCategory: (c.childCategory as string) ?? undefined,
    childPrice: (c.childPrice as number) ?? undefined,
    childPriceUnit: (c.childPriceUnit as string) ?? undefined,
    childWastePct: (c.childWastePct as number) ?? undefined,
    childColor: (c.childColor as string) ?? undefined,
  };
}

/** Map a server measurement to the store Measurement shape.
 *  Extended client-side fields (slopeFactor, isDeduction, fontSize, strokeWidth, etc.)
 *  are persisted in the `metadata_json` JSONB column and restored here. */
function mapServerMeasurement(m: Record<string, unknown>): Measurement {
  const points = Array.isArray(m.points) ? (m.points as Point[]) : [];
  const metadata = (m.metadataJson as Record<string, unknown> | null | undefined) ?? {};
  return {
    id: String(m.id),
    documentId: String(m.documentId ?? ''),
    pageNumber: (m.pageNumber as number) ?? 0,
    type: (m.type as Measurement['type']) ?? 'distance',
    label: (m.label as string) ?? '',
    value: (m.value as number) ?? 0,
    unit: (m.unit as MeasurementUnit) ?? 'm',
    points,
    color: (m.color as string) ?? '#FF0000',
    layer: m.layerId != null ? String(m.layerId) : 'default',
    createdAt: (m.createdAt as string) ?? new Date().toISOString(),
    productId: m.productId != null ? String(m.productId) : undefined,
    quantity: (m.quantity as number) ?? undefined,
    // Extended fields restored from metadata_json
    slopeFactor: (metadata.slopeFactor as number) ?? undefined,
    isDeduction: (metadata.isDeduction as boolean) ?? undefined,
    parentMeasurementId: (metadata.parentMeasurementId as string) ?? undefined,
    group: (metadata.group as string) ?? undefined,
    fontSize: (metadata.fontSize as number) ?? undefined,
    strokeWidth: (metadata.strokeWidth as number) ?? undefined,
    textContent: (metadata.textContent as string) ?? undefined,
    opacity: (metadata.opacity as number) ?? undefined,
    zOrder: (metadata.zOrder as number) ?? undefined,
    laborTradeId: (metadata.laborTradeId as string) ?? undefined,
    laborHours: (metadata.laborHours as number) ?? undefined,
    laborPersons: (metadata.laborPersons as number) ?? undefined,
    symbolBlockId: (metadata.symbolBlockId as string) ?? undefined,
    symbolRotation: (metadata.symbolRotation as number) ?? undefined,
    symbolScale: (metadata.symbolScale as number) ?? undefined,
  };
}

/** Map a server layer to the store MeasurementLayer shape.
 *
 * Note importante sur compositeInputs (P3.4) :
 * Le serveur retourne le JSONB en dict natif (ex: {type_bois: 6}). L'interceptor
 * axios applique `transformKeys` recursivement, MAIS la cle `compositeInputs`
 * est marquee passthrough dans api.ts (PASSTHROUGH_DICT_KEYS_CAMEL), donc les
 * cles du dict (`type_bois`, `surface_2x4`, etc.) restent en snake_case intact.
 * Sans ce passthrough, des noms contenant des chiffres comme `surface_2x4`
 * deviendraient `surface2x4` -- irreversible car aucune majuscule pour
 * re-deriver l'underscore au retour.
 *
 * On valide ici uniquement que les valeurs sont numeriques finies (defense
 * contre un payload mal forme).
 */
function mapServerLayer(l: Record<string, unknown>): MeasurementLayer {
  const rawCompositeInputs = l.compositeInputs;
  let compositeInputs: Record<string, number> | null = null;
  if (rawCompositeInputs && typeof rawCompositeInputs === 'object') {
    compositeInputs = {};
    for (const [k, v] of Object.entries(
      rawCompositeInputs as Record<string, unknown>,
    )) {
      const num = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(num)) compositeInputs[k] = num;
    }
    if (Object.keys(compositeInputs).length === 0) compositeInputs = null;
  }
  return {
    id: String(l.id),
    documentId: String(l.documentId ?? ''),
    name: (l.name as string) ?? 'Calque',
    color: (l.color as string) ?? '#3b82f6',
    visible: (l.visible as boolean) ?? true,
    locked: (l.locked as boolean) ?? false,
    compositeId: l.compositeId != null ? String(l.compositeId) : null,
    compositeInputs,
  };
}

/** Map a server project to the store Project shape (normalises id to string). */
function mapServerProject(p: Record<string, unknown>): Project {
  return {
    id: String(p.id),
    name: (p.name as string) ?? '',
    description: (p.description as string) ?? '',
    companyId: p.companyId != null ? String(p.companyId) : '',
    devisId: (p.devisId as number | null | undefined) ?? null,
    createdAt: (p.createdAt as string) ?? new Date().toISOString(),
    updatedAt: (p.updatedAt as string) ?? undefined,
  };
}

/** Map a server document to the store PDFDocument shape (normalises id to string). */
function mapServerDocument(d: Record<string, unknown>): PDFDocument {
  return {
    id: String(d.id),
    projectId: d.projectId != null ? String(d.projectId) : '',
    filename: (d.filename as string) ?? (d.originalFilename as string) ?? '',
    pageCount: (d.pageCount as number) ?? 1,
    uploadedAt: (d.uploadedAt as string) ?? new Date().toISOString(),
  };
}

/** Map a server calibration to the store Calibration shape. */
function mapServerCalibration(c: Record<string, unknown>): Calibration {
  return {
    id: String(c.id),
    documentId: String(c.documentId ?? ''),
    pageNumber: (c.pageNumber as number) ?? 0,
    scaleFactor: (c.scaleFactor as number) ?? 1,
    unit: (c.unit as MeasurementUnit) ?? 'm',
    referenceLength: (c.referenceLength as number) ?? 1,
    pixelLength: (c.pixelLength as number) ?? 1,
  };
}

/** Serialise a store Measurement to the server POST body shape.
 *  Drops id/documentId/createdAt (server-assigned). `layer` → `layerId` (null if non-numeric).
 *  Extended client-side fields are packed into `metadata_json`. */
function measurementToServerBody(m: Measurement): Record<string, unknown> {
  const layerIdNum = /^\d+$/.test(m.layer) ? parseInt(m.layer, 10) : null;
  const productIdNum = m.productId && /^\d+$/.test(m.productId) ? parseInt(m.productId, 10) : null;
  // Pack extended client-side fields; omit undefined so we don't store noise.
  const metadata: Record<string, unknown> = {};
  if (m.slopeFactor !== undefined) metadata.slopeFactor = m.slopeFactor;
  if (m.isDeduction !== undefined) metadata.isDeduction = m.isDeduction;
  if (m.parentMeasurementId !== undefined) metadata.parentMeasurementId = m.parentMeasurementId;
  if (m.group !== undefined) metadata.group = m.group;
  if (m.fontSize !== undefined) metadata.fontSize = m.fontSize;
  if (m.strokeWidth !== undefined) metadata.strokeWidth = m.strokeWidth;
  if (m.textContent !== undefined) metadata.textContent = m.textContent;
  if (m.opacity !== undefined) metadata.opacity = m.opacity;
  if (m.zOrder !== undefined) metadata.zOrder = m.zOrder;
  if (m.laborTradeId !== undefined) metadata.laborTradeId = m.laborTradeId;
  if (m.laborHours !== undefined) metadata.laborHours = m.laborHours;
  if (m.laborPersons !== undefined) metadata.laborPersons = m.laborPersons;
  if (m.symbolBlockId !== undefined) metadata.symbolBlockId = m.symbolBlockId;
  if (m.symbolRotation !== undefined) metadata.symbolRotation = m.symbolRotation;
  if (m.symbolScale !== undefined) metadata.symbolScale = m.symbolScale;
  // Persist the baseScale active when these points were stored. Points are
  // captured in display-pixel space (pdfNative × baseScale × zoom), which means
  // a different baseScale at reload (e.g. window resized between sessions, or
  // the métré opened on another device) would render the points anchored to
  // the wrong location on the PDF. `loadDocumentData` reads this back and
  // rescales by `currentBaseScale / storedBaseScale` so the geometry stays
  // anchored to the same plan coordinates regardless of viewport size.
  const currentBs = useMetreStore.getState().baseScale;
  if (typeof currentBs === 'number' && currentBs > 0) {
    metadata.pdfBaseScale = currentBs;
  }
  return {
    pageNumber: m.pageNumber,
    type: m.type,
    label: m.label ?? null,
    value: m.value,
    unit: m.unit,
    points: m.points,
    color: m.color,
    layerId: layerIdNum,
    productId: productIdNum,
    quantity: m.quantity ?? null,
    metadataJson: metadata,
  };
}

function loadProducts(): Product[] {
  // In ERP mode, start with default catalog; fetchProducts() will load from server async
  if (isERPMode()) return DEFAULT_CATALOG;
  try {
    const savedVersion = localStorage.getItem(_tenantKey(PRODUCTS_VERSION_KEY));
    const raw = localStorage.getItem(_tenantKey(PRODUCTS_KEY));
    if (!raw || savedVersion !== CATALOG_VERSION) {
      return DEFAULT_CATALOG;
    }
    const parsed = JSON.parse(raw) as Product[];
    return parsed.length > 0 ? parsed : DEFAULT_CATALOG;
  } catch { /* ignore */ }
  return DEFAULT_CATALOG;
}

function saveProducts(products: Product[]) {
  // In ERP mode, products are persisted server-side -- skip localStorage
  if (isERPMode()) return;
  try {
    localStorage.setItem(_tenantKey(PRODUCTS_KEY), JSON.stringify(products));
    localStorage.setItem(_tenantKey(PRODUCTS_VERSION_KEY), CATALOG_VERSION);
  } catch { /* ignore */ }
}


/* ── Labor catalog persistence (localStorage) ── */

const LABOR_KEY = 'metre-labor-trades';
const LABOR_VERSION_KEY = 'metre-labor-trades-version';

function loadLaborTrades(): LaborTrade[] {
  try {
    const savedVersion = localStorage.getItem(_tenantKey(LABOR_VERSION_KEY));
    const raw = localStorage.getItem(_tenantKey(LABOR_KEY));
    if (!raw || savedVersion !== LABOR_CATALOG_VERSION) {
      return DEFAULT_LABOR_CATALOG;
    }
    const parsed = JSON.parse(raw) as LaborTrade[];
    return parsed.length > 0 ? parsed : DEFAULT_LABOR_CATALOG;
  } catch { /* ignore */ }
  return DEFAULT_LABOR_CATALOG;
}

function saveLaborTrades(trades: LaborTrade[]) {
  try {
    localStorage.setItem(_tenantKey(LABOR_KEY), JSON.stringify(trades));
    localStorage.setItem(_tenantKey(LABOR_VERSION_KEY), LABOR_CATALOG_VERSION);
  } catch { /* ignore */ }
}


/* ── Symbol blocks persistence (localStorage) ── */

const SYMBOL_BLOCKS_KEY = 'metre-symbol-blocks';
const SYMBOL_BLOCKS_VERSION_KEY = 'metre-symbol-blocks-version';
const SYMBOL_BLOCKS_VERSION = '2';

function loadSymbolBlocks(): SymbolBlockDef[] {
  try {
    const savedVersion = localStorage.getItem(_tenantKey(SYMBOL_BLOCKS_VERSION_KEY));
    const raw = localStorage.getItem(_tenantKey(SYMBOL_BLOCKS_KEY));
    if (!raw || savedVersion !== SYMBOL_BLOCKS_VERSION) {
      return DEFAULT_SYMBOL_BLOCKS;
    }
    const parsed = JSON.parse(raw) as SymbolBlockDef[];
    return parsed.length > 0 ? parsed : DEFAULT_SYMBOL_BLOCKS;
  } catch { /* ignore */ }
  return DEFAULT_SYMBOL_BLOCKS;
}

function saveSymbolBlocks(blocks: SymbolBlockDef[]) {
  try {
    localStorage.setItem(_tenantKey(SYMBOL_BLOCKS_KEY), JSON.stringify(blocks));
    localStorage.setItem(_tenantKey(SYMBOL_BLOCKS_VERSION_KEY), SYMBOL_BLOCKS_VERSION);
  } catch { /* ignore */ }
}


/* ── Debounced localStorage persistence ── */

let _measurementsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let _layersSaveTimer: ReturnType<typeof setTimeout> | null = null;

const MEASUREMENTS_KEY = 'metre-measurements';
const LAYERS_KEY = 'metre-layers';
const CALIBRATION_KEY = 'metre-calibration';
const BASE_SCALE_KEY = 'metre-base-scale';

// Persistence strategy:
// - Standalone mode (no ERP context): localStorage is the only source of truth,
//   using the bare keys `metre-measurements`, `metre-layers`, `metre-calibration`.
// - ERP mode with a backend-persisted document (doc.id numeric): backend is
//   authoritative. `loadDocumentData` hydrates the store from the backend on
//   doc change, and all mutations sync via `_pushCreate/Update/Delete`.
//   localStorage is still written as a tenant-prefixed cache for fast reloads
//   but is not the source of truth — backend overrides it.
// - ERP mode with a local-only document (doc.id NOT numeric — PDFViewer loaded
//   a PDF without uploading it to /metre/documents): backend sync is skipped
//   entirely (`_hasPersistedDocument` returns false), and localStorage is the
//   only persistence. We use a TENANT-PREFIXED key to prevent cross-tenant leaks.
//
// The helpers below compute the effective storage key based on the current ERP
// context. Tenant prefix format: `{tenant_schema}:{base_key}`.

function _tenantKey(baseKey: string): string {
  const ctx = getERPContext();
  if (ctx && ctx.tenant_schema) {
    return `${ctx.tenant_schema}:${baseKey}`;
  }
  return baseKey;
}

function loadMeasurements(): Measurement[] {
  try {
    const raw = localStorage.getItem(_tenantKey(MEASUREMENTS_KEY));
    if (raw) return JSON.parse(raw) as Measurement[];
  } catch { /* ignore */ }
  return [];
}

function debouncedSaveMeasurements(m: Measurement[]) {
  if (_measurementsSaveTimer) clearTimeout(_measurementsSaveTimer);
  _measurementsSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(_tenantKey(MEASUREMENTS_KEY), JSON.stringify(m));
    } catch { /* ignore */ }
    _measurementsSaveTimer = null;
  }, SAVE_DEBOUNCE_MS);
}

function loadLayers(): MeasurementLayer[] {
  try {
    const raw = localStorage.getItem(_tenantKey(LAYERS_KEY));
    if (raw) {
      const parsed = JSON.parse(raw) as MeasurementLayer[];
      if (parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return [];
}

function debouncedSaveLayers(l: MeasurementLayer[]) {
  if (_layersSaveTimer) clearTimeout(_layersSaveTimer);
  _layersSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(_tenantKey(LAYERS_KEY), JSON.stringify(l));
    } catch { /* ignore */ }
    _layersSaveTimer = null;
  }, SAVE_DEBOUNCE_MS);
}

/** Synchronously flush both pending debounce timers to localStorage. Called
 *  by the beforeunload handler so that mesures/calques tracé(es) dans la
 *  dernière seconde avant fermeture de l'onglet ne sont pas perdues
 *  (mode standalone OU mode ERP local-only avant upload). */
export function flushPendingSavesToStorage(): void {
  if (_measurementsSaveTimer) {
    clearTimeout(_measurementsSaveTimer);
    _measurementsSaveTimer = null;
    try {
      const ms = useMetreStore.getState().measurements;
      localStorage.setItem(_tenantKey(MEASUREMENTS_KEY), JSON.stringify(ms));
    } catch { /* ignore */ }
  }
  if (_layersSaveTimer) {
    clearTimeout(_layersSaveTimer);
    _layersSaveTimer = null;
    try {
      const ls = useMetreStore.getState().layers;
      localStorage.setItem(_tenantKey(LAYERS_KEY), JSON.stringify(ls));
    } catch { /* ignore */ }
  }
}

function loadCalibration(): Calibration | null {
  try {
    const raw = localStorage.getItem(_tenantKey(CALIBRATION_KEY));
    if (raw) return JSON.parse(raw) as Calibration;
  } catch { /* ignore */ }
  return null;
}

function saveCalibration(c: Calibration | null) {
  try {
    const key = _tenantKey(CALIBRATION_KEY);
    if (c === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(c));
    }
  } catch { /* ignore */ }
}

function loadBaseScale(): number {
  try {
    const raw = localStorage.getItem(_tenantKey(BASE_SCALE_KEY));
    if (raw) {
      const val = parseFloat(raw);
      if (isFinite(val) && val > 0) return val;
    }
  } catch { /* ignore */ }
  return 1;
}

function saveBaseScale(bs: number) {
  try {
    localStorage.setItem(_tenantKey(BASE_SCALE_KEY), String(bs));
  } catch { /* ignore */ }
}

/* ── localStorage persistence for measurement groups ── */

const GROUPS_KEY = 'metre-measurement-groups';

function loadGroups(): string[] {
  try {
    const raw = localStorage.getItem(_tenantKey(GROUPS_KEY));
    if (raw) return JSON.parse(raw) as string[];
  } catch { /* ignore */ }
  return [];
}

function saveGroups(groups: string[]) {
  try {
    localStorage.setItem(_tenantKey(GROUPS_KEY), JSON.stringify(groups));
  } catch { /* ignore */ }
}

/* ── localStorage persistence for soumission consolidation mode ── */

export type SoumissionConsolidationMode = 'detailed' | 'by-product-and-layer' | 'by-product';

const CONSOLIDATION_MODE_KEY = 'metre-soumission-consolidation-mode';
const DEFAULT_CONSOLIDATION_MODE: SoumissionConsolidationMode = 'by-product-and-layer';

export function loadConsolidationMode(): SoumissionConsolidationMode {
  try {
    const raw = localStorage.getItem(_tenantKey(CONSOLIDATION_MODE_KEY));
    if (raw === 'detailed' || raw === 'by-product-and-layer' || raw === 'by-product') {
      return raw;
    }
  } catch { /* ignore */ }
  return DEFAULT_CONSOLIDATION_MODE;
}

export function saveConsolidationMode(mode: SoumissionConsolidationMode) {
  try {
    localStorage.setItem(_tenantKey(CONSOLIDATION_MODE_KEY), mode);
  } catch { /* ignore */ }
}


/* ══════════════════════════════════════════════════════════════════
   useProjectStore  (from METRE_PDF/frontend/src/store/useProjectStore.ts)
   ══════════════════════════════════════════════════════════════════ */

interface ProjectState {
  /* ── data ─────────────────────────────────────── */
  projects: Project[];
  currentProject: Project | null;
  documents: PDFDocument[];
  currentDocument: PDFDocument | null;
  currentPage: number;

  /* ── loading flags ────────────────────────────── */
  loadingProjects: boolean;
  loadingDocuments: boolean;
  uploading: boolean;
  error: string | null;

  /* ── actions ──────────────────────────────────── */
  loadProjects: () => Promise<void>;
  createProject: (name: string, description?: string) => Promise<Project>;
  setCurrentProject: (project: Project | null) => void;

  loadDocuments: (projectId: string) => Promise<void>;
  uploadDocument: (projectId: string, file: File) => Promise<PDFDocument>;
  setCurrentDocument: (doc: PDFDocument | null) => void;

  setCurrentPage: (page: number) => void;
  clearError: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  documents: [],
  currentDocument: null,
  currentPage: 1,

  loadingProjects: false,
  loadingDocuments: false,
  uploading: false,
  error: null,

  /* ── projects ─────────────────────────────────── */

  loadProjects: async () => {
    set({ loadingProjects: true, error: null });
    try {
      const raw = await metreApi.listProjects();
      // Normalise id fields to string (backend returns int which TypeScript incorrectly
      // types as string via the Project interface).
      const projects = (raw as unknown as Record<string, unknown>[]).map(mapServerProject);
      set({ projects, loadingProjects: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load projects';
      set({ error: message, loadingProjects: false });
    }
  },

  createProject: async (name, description) => {
    set({ error: null });
    try {
      const raw = await metreApi.createProject({ name, description });
      const project = mapServerProject(raw as unknown as Record<string, unknown>);
      set((s) => ({ projects: [...s.projects, project], currentProject: project }));
      return project;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create project';
      set({ error: message });
      throw err;
    }
  },

  setCurrentProject: (project) => {
    set({ currentProject: project, documents: [], currentDocument: null, currentPage: 1 });
  },

  /* ── documents ────────────────────────────────── */

  loadDocuments: async (projectId) => {
    set({ loadingDocuments: true, error: null });
    try {
      const raw = await metreApi.listDocuments(projectId);
      const documents = (raw as unknown as Record<string, unknown>[]).map(mapServerDocument);
      set({ documents, loadingDocuments: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load documents';
      set({ error: message, loadingDocuments: false });
    }
  },

  uploadDocument: async (projectId, file) => {
    set({ uploading: true, error: null });
    try {
      const raw = await metreApi.uploadDocument(projectId, file);
      const doc = mapServerDocument(raw as unknown as Record<string, unknown>);
      set((s) => ({
        documents: [...s.documents, doc],
        currentDocument: doc,
        currentPage: 1,
        uploading: false,
      }));
      return doc;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to upload document';
      set({ error: message, uploading: false });
      throw err;
    }
  },

  setCurrentDocument: (doc) => {
    set({ currentDocument: doc, currentPage: 1 });
  },

  /* ── page ─────────────────────────────────────── */

  setCurrentPage: (page) => {
    const doc = get().currentDocument;
    if (!doc) return;
    const clamped = Math.max(1, Math.min(page, doc.pageCount));
    set({ currentPage: clamped });
  },

  clearError: () => set({ error: null }),
}));
