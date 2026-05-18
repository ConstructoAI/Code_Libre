/** 2D point on the PDF page coordinate system */
export interface Point {
  x: number;
  y: number;
}

/** Calibration data linking pixel measurements to real-world units */
export interface Calibration {
  id: string;
  documentId: string;
  pageNumber: number;
  /** Real-world units per pixel */
  scaleFactor: number;
  /** Unit of measurement (m, cm, mm, ft, in) */
  unit: MeasurementUnit;
  /** Known reference length in real-world units */
  referenceLength: number;
  /** Measured length in pixels on the PDF */
  pixelLength: number;
}

/** A single measurement taken on a PDF page */
export interface Measurement {
  id: string;
  documentId: string;
  pageNumber: number;
  type: MeasurementType;
  label: string;
  /** Computed value in current unit */
  value: number;
  unit: MeasurementUnit;
  /** Points defining the measurement geometry */
  points: Point[];
  color: string;
  /** Layer this measurement belongs to */
  layer: string;
  createdAt: string;
  /** Associated product ID from the catalog */
  productId?: string;
  /** Quantity override (defaults to measurement value) */
  quantity?: number;
  /** If true, this measurement is a deduction (subtracted from parent) */
  isDeduction?: boolean;
  /** ID of the parent measurement this deduction applies to */
  parentMeasurementId?: string;
  /** Slope factor for roofing (e.g., 1.118 for 6/12 pitch). Multiplies the area. */
  slopeFactor?: number;
  /** Named group this measurement belongs to (e.g., "Cuisine", "Salon") */
  group?: string;
  /** Font size for text, arrow, and cloud annotations (default 14) */
  fontSize?: number;
  /** Stroke width / line thickness for drawing tools (default 2) */
  strokeWidth?: number;
  /** Multi-line text content for note, callout, and text annotations */
  textContent?: string;
  /** Opacity from 0 (transparent) to 1 (opaque), default 1 */
  opacity?: number;
  /** Draw order within the layer (higher = rendered on top). Default 0. */
  zOrder?: number;
  /** Associated labor trade ID from the labor catalog */
  laborTradeId?: string;
  /** Estimated labor hours for this measurement */
  laborHours?: number;
  /** Number of workers (overrides trade default) */
  laborPersons?: number;
  /** Symbol block definition ID (for type 'symbol') */
  symbolBlockId?: string;
  /** Symbol rotation in degrees (for type 'symbol') */
  symbolRotation?: number;
  /** Symbol scale factor, 1 = default real-world size (for type 'symbol') */
  symbolScale?: number;
}

/** Clipboard for copying measurement properties (without geometry) */
export interface MeasurementPropertyClipboard {
  productId?: string;
  color: string;
  strokeWidth?: number;
  fontSize?: number;
  opacity?: number;
  slopeFactor?: number;
  group?: string;
  layer: string;
}

/** A named layer grouping measurements */
export interface MeasurementLayer {
  id: string;
  documentId: string;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  /**
   * Id du composite BOM (metre_products.id) auquel ce calque est lie.
   * Quand non null, le calque genere une instance dediee du composite dans le
   * BomEstimationPanel : les variables geometriques (longueur_*, perimetre_*,
   * nombre_coins, etc.) sont calculees uniquement a partir des mesures de
   * CE calque, et les variables non-geometriques sont reprises de
   * `compositeInputs` ci-dessous.
   */
  compositeId?: string | null;
  /**
   * Overrides par calque des variables non-geometriques du composite lie
   * (ex: { type_bois: 6, espacement_cc: 16, hauteur_mur_porteur: 9 }).
   * Permet d'avoir un mur 2x4 et un mur 2x6 dans le meme bordereau.
   * Stocke en JSONB cote backend.
   */
  compositeInputs?: Record<string, number> | null;
}

/** Uploaded PDF document metadata */
export interface PDFDocument {
  id: string;
  projectId: string;
  filename: string;
  pageCount: number;
  uploadedAt: string;
}

/** Project grouping documents — used as the "Métré" entity in the ERP. */
export interface Project {
  id: string;
  name: string;
  description: string;
  companyId: string;
  /** Optional link to a soumission (formulaires.id) — set when the métré
   *  was used to populate or create a devis. */
  devisId?: number | null;
  createdAt: string;
  updatedAt?: string;
}

/** Available tools in the measurement toolbar */
export type Tool =
  | 'select'
  | 'distance'
  | 'area'
  | 'rectangle'
  | 'perimeter'
  | 'polyline'
  | 'mur'
  | 'angle'
  | 'count'
  | 'circle'
  | 'calibrate'
  | 'pan'
  | 'text'
  | 'arrow'
  | 'cloud'
  | 'freehand'
  | 'highlight'
  | 'note'
  | 'dimension'
  | 'callout'
  | 'stamp';

/** Measurement types that produce values */
export type MeasurementType =
  | 'distance'
  | 'area'
  | 'perimeter'
  | 'polyline'
  | 'angle'
  | 'count'
  | 'circle'
  | 'dimension'
  | 'text'
  | 'arrow'
  | 'cloud'
  | 'freehand'
  | 'highlight'
  | 'note'
  | 'callout'
  | 'symbol';

/** Supported units of measurement */
export type MeasurementUnit = 'm' | 'cm' | 'mm' | 'ft' | 'in';

/** Snap point detected on the canvas */
export interface SnapPoint {
  x: number;
  y: number;
  type: SnapType;
}

export type SnapType =
  | 'endpoint'
  | 'midpoint'
  | 'intersection'
  | 'perpendicular';

/** Current viewport state for the PDF viewer */
export interface ViewState {
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
}

/** Undo/redo history entry */
export interface HistoryEntry {
  measurements: Measurement[];
  layers: MeasurementLayer[];
}

/**
 * Schema d'un input parametrique d'un BOM. Stocke en JSONB sur metre_products.bom_inputs.
 * Les noms doivent etre snake_case ASCII (validation regex cote backend).
 */
export interface BomInputDef {
  /** Identifiant snake_case (ex: "perimetre_ss", "surface_rc") */
  name: string;
  /** Unite affichee (ex: "pi", "pi2", "bool", "u") */
  unit: string;
  /** Description humaine */
  description: string;
  /** Valeur par defaut quand aucune mesure ne correspond */
  default?: number | null;
}

/** A product in the catalog */
export interface Product {
  id: string;
  name: string;
  category: string;
  dimensions: string;
  price: number;
  priceUnit: string;
  color: string;
  /** Waste factor percentage (e.g., 10 means 10% waste) */
  wastePct: number;
  /** If true, this product is a composite/assembly containing child products (BOM) */
  isComposite?: boolean;
  /** 'detailed' = N lines in soumission (one per child), 'summary' = 1 aggregated line */
  displayMode?: 'detailed' | 'summary';
  /** Override price for composites (null = sum of children auto-computed) */
  priceOverride?: number | null;
  /** Optional long description shown in composite panels */
  description?: string;
  /**
   * Schema des inputs parametriques quand le BOM utilise des formules.
   * Alimente par les mesures du module Metre (label de mesure = name d'input).
   */
  bomInputs?: BomInputDef[] | null;
  /**
   * Labour-time defaults for the estimation TSV (composite BOMs only).
   * total_hrs = nbHommes * nbHrsParJour * nbJours
   * cost     = total_hrs * laborTrade(laborTradeId).hourlyRate
   */
  nbHommes?: number | null;
  nbHrsParJour?: number | null;
  nbJours?: number | null;
  /** Sequential section number used in the estimation report (1-31 for the standard residential template). */
  numeroSection?: string | null;
  /**
   * Reference to a CCQ trade in the local LaborCatalog (e.g. 'ccq-charpentier-menuisier').
   * The hourlyRate associated to this trade drives the cost column of the estimation TSV.
   */
  laborTradeId?: string | null;
  /** Child products of this composite (only populated when isComposite=true) */
  components?: ProductComponent[];
}

/** A sub-product entry inside a composite product (Bill of Materials line) */
export interface ProductComponent {
  id: string;
  parentProductId: string;
  childProductId: string;
  /** Quantity of child product consumed per 1 unit of parent (e.g. 0.5 montant / m²) */
  quantityPerUnit: number;
  /**
   * Optional parametric formula evaluated against the parent's bomInputs.
   * When set, takes precedence over quantityPerUnit at runtime.
   * Example: "perimetre_ss * 0.25 + 3" or "IF(surface_ss > 800, 3, 2)".
   * Validated server-side via _FORMULA_SAFE_PATTERN before storage.
   */
  formula?: string | null;
  notes?: string;
  sortOrder?: number;
  /** Denormalised child metadata returned by the backend for convenience */
  childName?: string;
  childCategory?: string;
  childPrice?: number;
  childPriceUnit?: string;
  childWastePct?: number;
  childColor?: string;
}

/** CCQ labor trade sector */
export type LaborSector = 'ICI' | 'Residentiel' | 'Genie civil' | 'Industriel';

/** A construction trade (corps de métier) in the labor catalog */
export interface LaborTrade {
  id: string;
  /** Trade name (ex: "Charpentier-menuisier") */
  trade: string;
  /** Optional specialty (ex: "Coffrage", "Finition") */
  specialty?: string;
  /** CCQ sector */
  sector: LaborSector;
  /** Compagnon hourly rate ($) */
  hourlyRate: number;
  /** Default number of workers */
  nbPersons: number;
  /** Optional productivity rate (e.g., 0.12 h/pi2) */
  productivityRate?: number;
  /** Productivity unit label (e.g., "h/pi2", "h/ml") */
  productivityUnit?: string;
  /** Visual color */
  color: string;
}

/** Price unit options for construction products */
export const PRICE_UNITS = [
  { value: 'pi2', label: 'pi\u00b2' },
  { value: 'pi', label: 'pi lin.' },
  { value: 'un', label: 'unit\u00e9' },
  { value: 'm2', label: 'm\u00b2' },
  { value: 'm', label: 'm lin.' },
  { value: 'm3', label: 'm\u00b3' },
  { value: 'h', label: 'heure' },
  { value: 'vg2', label: 'vg\u00b2' },
  { value: 'feuille', label: 'feuille' },
  { value: 'sac', label: 'sac' },
  { value: 'bte', label: 'bo\u00eete' },
] as const;

/** A path element in a symbol block (normalised 0-1 coords relative to bounding box) */
export interface SymbolPath {
  type: 'line' | 'arc' | 'rect';
  /** line: [x1,y1,x2,y2], arc: [cx,cy,r,startAngle,endAngle], rect: [x,y,w,h] */
  data: number[];
}

/** View type for architectural symbols */
export type SymbolView = 'plan' | 'elevation' | 'droite';

/** An architectural symbol block definition */
export interface SymbolBlockDef {
  id: string;
  name: string;
  category: string;
  /** Drawing view: plan (top), elevation (front), droite (right side) */
  view: SymbolView;
  /** Default real-world width in meters */
  widthReal: number;
  /** Default real-world height in meters */
  heightReal: number;
  color: string;
  paths: SymbolPath[];
}

// =============================================================================
// AI Detection (takeoff IA via Claude Vision) - PHASE 1 + 2
// =============================================================================

export type AIDetectionStatus = 'pending' | 'accepted' | 'rejected' | 'corrected';

export type AIDetectionType = 'surface' | 'distance' | 'count';

export type AICategory =
  | 'door' | 'window' | 'outlet_110v' | 'outlet_220v' | 'light' | 'switch'
  | 'thermostat' | 'smoke_detector' | 'wall' | 'floor' | 'ceiling' | 'roof'
  | 'molding' | 'pipe' | 'other';

export interface AIBoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AIDetection {
  id: number;
  documentId: number;
  pageNumber: number;
  detectionType: AIDetectionType;
  category?: AICategory | null;
  label?: string | null;
  points: { x: number; y: number }[];
  boundingBox?: AIBoundingBox | null;
  detectedValue: number;
  unit: string;
  confidence: number;
  color: string;
  status: AIDetectionStatus;
  userCorrectionValue?: number | null;
  measurementId?: number | null;
  claudeModel?: string | null;
  claudeTokensIn?: number | null;
  claudeTokensOut?: number | null;
  claudeCostUsd?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AIDetectRunResult {
  detections: AIDetection[];
  pageNumber: number;
  total: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
}

export interface AIDetectRunRequest {
  pageNumber: number;
  detectionTypes?: AIDetectionType[];
  additionalContext?: string;
  // PHASE 2: BOM-aware
  sectionNumero?: string;
  useBomCatalog?: boolean;
}

// PHASE 2: BOM-aware multi-section
export interface AIDetectMultiSectionRequest {
  pageNumber: number;
  sections: string[];
  autoCreateLayerPerSection?: boolean;
  additionalContext?: string;
}

export interface AIDetectMultiSectionResult {
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
}

export interface AvailableSections {
  sections: string[];
  sectionCount: number;
}

export const AI_CATEGORY_COLORS: Record<AICategory, string> = {
  door: '#10B981',
  window: '#F59E0B',
  outlet_110v: '#EC4899',
  outlet_220v: '#DB2777',
  light: '#FBBF24',
  switch: '#A78BFA',
  thermostat: '#F97316',
  smoke_detector: '#EF4444',
  wall: '#6B7280',
  floor: '#3B82F6',
  ceiling: '#8B5CF6',
  roof: '#7C3AED',
  molding: '#06B6D4',
  pipe: '#0EA5E9',
  other: '#9CA3AF',
};

export const AI_CATEGORY_LABELS_FR: Record<AICategory, string> = {
  door: 'Porte',
  window: 'Fenetre',
  outlet_110v: 'Prise 110V',
  outlet_220v: 'Prise 220V',
  light: 'Luminaire',
  switch: 'Interrupteur',
  thermostat: 'Thermostat',
  smoke_detector: 'Detecteur fumee',
  wall: 'Mur',
  floor: 'Plancher',
  ceiling: 'Plafond',
  roof: 'Toiture',
  molding: 'Moulure',
  pipe: 'Conduit',
  other: 'Autre',
};

// =============================================================================
// PHASE 3: Mode INVENTAIRE RAPIDE (alternative au mode markup overlay).
// Claude lit le plan et retourne une liste TEXTE structuree (item, dimensions,
// quantity, notes) sans coordonnees ni bounding box. Plus precis pour les plans
// manuscrits car Claude n'a pas a pointer des coordonnees exactes.
// =============================================================================

export interface AIQuickInventoryItem {
  item: string;
  dimensions?: string | null;
  quantity: number;
  unit: string;
  notes?: string | null;
  category?: string | null;
  productId?: number | null;
}

export interface AIQuickInventoryResult {
  pageNumber: number;
  inventory: AIQuickInventoryItem[];
  summary: string;
  totalItems: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  claudeModel: string;
  precisionModeUsed?: boolean;
  thinkingTokens?: number;
}

export interface AIQuickInventoryRequest {
  pageNumber: number;
  query: string;
  additionalContext?: string;
  sectionNumero?: string;
  useBomCatalog?: boolean;
  precisionMode?: boolean;
}
