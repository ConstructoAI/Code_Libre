/**
 * ERP React Frontend - Calculators Zustand Store
 *
 * Complete state management for 13 calculators + sub-calcs,
 * 6 AI endpoints (Claude Opus 4.6), and multi-tenant history.
 */

import { create } from 'zustand';
import * as calculatorsApi from '@/api/calculators';
import type {
  AiAnalyzeResult,
  AiChatResponse,
  AiDiagnoseResult,
  AiExplainNormResult,
  AiOptimizeResult,
  AiRecommendResult,
  BendingMinRadiusResult,
  BendingResult,
  BendingSpringbackResult,
  Calculator,
  CalculatorConstants,
  CalculatorHistoryItem,
  CalculatorResources,
  ChargeTributaireCompleteResult,
  ChargeTributaireResult,
  ConcreteCureResult,
  ConcreteDosageResult,
  ConcreteExcavationResult,
  ConcreteFormworkResult,
  ConcreteRebarResult,
  ConcreteResult,
  ConcreteStairsResult,
  ConcreteTalusResult,
  ConversionTables,
  ElectricalGroundingResult,
  ElectricalLightingResult,
  ElectricalResidentialResult,
  ElectricalResult,
  HistoryStats,
  HvacCfmResult,
  HvacCoolingResult,
  HvacDuctResult,
  HvacHrvResult,
  HvacResult,
  MetalWeightResult,
  PaintingDFTResult,
  PaintingDewPointResult,
  PaintingResult,
  PlumbingDrainSlopeResult,
  PlumbingHazenWilliamsResult,
  PlumbingResult,
  PlumbingWaterHeaterResult,
  RoofingGuttersResult,
  RoofingResult,
  RoofingSnowLoadResult,
  RoofingVentilationResult,
  SnowLoads,
  StairGardeCorpsResult,
  StairResult,
  StructuralMaterials,
  TaxesResult,
  WeldingConsumableResult,
  WeldingHeatInputResult,
  WeldingPreheatResult,
  WeldingResult,
} from '@/api/calculators';

// Chat message type for history
export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  calculatorId?: string;
  timestamp: string;
}

interface CalculatorsState {
  // ---- Metadata ----
  calculators: Calculator[];
  constants: CalculatorConstants | null;
  resources: CalculatorResources | null;
  conversions: ConversionTables | null;

  // ---- Current selection ----
  currentCalcId: string | null;
  currentSubcalcId: string | null;

  // ---- Results (per calculator) ----
  concreteResult: ConcreteResult | null;
  concreteDosageResult: ConcreteDosageResult | null;
  concreteRebarResult: ConcreteRebarResult | null;
  concreteCureResult: ConcreteCureResult | null;
  concreteFormworkResult: ConcreteFormworkResult | null;
  concreteExcavationResult: ConcreteExcavationResult | null;
  concreteTalusResult: ConcreteTalusResult | null;
  concreteStairsResult: ConcreteStairsResult | null;

  stairsResult: StairResult | null;
  stairsMaterialsResult: Record<string, unknown> | null;
  stairsGardeCorpsResult: StairGardeCorpsResult | null;

  electricalResult: ElectricalResult | null;
  electricalResidentialResult: ElectricalResidentialResult | null;
  electricalLightingResult: ElectricalLightingResult | null;
  electricalGroundingResult: ElectricalGroundingResult | null;

  roofingResult: RoofingResult | null;
  roofingVentilationResult: RoofingVentilationResult | null;
  roofingGuttersResult: RoofingGuttersResult | null;
  roofingSnowLoadResult: RoofingSnowLoadResult | null;

  paintingResult: PaintingResult | null;
  paintingDftResult: PaintingDFTResult | null;
  paintingDewPointResult: PaintingDewPointResult | null;

  plumbingResult: PlumbingResult | null;
  plumbingHazenResult: PlumbingHazenWilliamsResult | null;
  plumbingWaterHeaterResult: PlumbingWaterHeaterResult | null;
  plumbingDrainSlopeResult: PlumbingDrainSlopeResult | null;

  hvacResult: HvacResult | null;
  hvacDuctResult: HvacDuctResult | null;
  hvacCfmResult: HvacCfmResult | null;
  hvacHrvResult: HvacHrvResult | null;
  hvacCoolingResult: HvacCoolingResult | null;

  weldingResult: WeldingResult | null;
  weldingHeatInputResult: WeldingHeatInputResult | null;
  weldingPreheatResult: WeldingPreheatResult | null;
  weldingConsumableResult: WeldingConsumableResult | null;

  bendingResult: BendingResult | null;
  bendingSpringbackResult: BendingSpringbackResult | null;
  bendingMinRadiusResult: BendingMinRadiusResult | null;

  metalWeightResult: MetalWeightResult | null;
  taxesResult: TaxesResult | null;
  chargeTributaireResult: ChargeTributaireResult | null;
  structuralResult: ChargeTributaireCompleteResult | null;
  structuralMaterials: StructuralMaterials | null;
  snowLoads: SnowLoads | null;

  // ---- History ----
  history: CalculatorHistoryItem[];
  historyStats: HistoryStats | null;

  // ---- AI ----
  aiChatHistory: AiChatMessage[];
  aiAnalyzeResult: AiAnalyzeResult | null;
  aiRecommendResult: AiRecommendResult | null;
  aiExplainNormResult: AiExplainNormResult | null;
  aiDiagnoseResult: AiDiagnoseResult | null;
  aiOptimizeResult: AiOptimizeResult | null;
  isAiRunning: boolean;

  // ---- UI state ----
  isLoading: boolean;
  error: string | null;
  successMessage: string | null;

  // ---- Actions: metadata ----
  fetchCalculators: () => Promise<void>;
  fetchConstants: () => Promise<void>;
  fetchResources: () => Promise<void>;
  fetchConversions: () => Promise<void>;
  selectCalculator: (id: string | null, subcalcId?: string | null) => void;

  // ---- Actions: concrete ----
  calcConcrete: (body: calculatorsApi.ConcreteInput) => Promise<void>;
  calcConcreteDosage: (body: calculatorsApi.ConcreteDosageInput) => Promise<void>;
  calcConcreteRebar: (body: calculatorsApi.ConcreteRebarInput) => Promise<void>;
  calcConcreteCure: (body: calculatorsApi.ConcreteCureInput) => Promise<void>;
  calcConcreteFormwork: (body: calculatorsApi.ConcreteFormworkInput) => Promise<void>;
  calcConcreteExcavation: (body: calculatorsApi.ConcreteExcavationInput) => Promise<void>;
  calcConcreteTalus: (body: calculatorsApi.ConcreteTalusInput) => Promise<void>;
  calcConcreteStairs: (body: calculatorsApi.ConcreteStairsInput) => Promise<void>;

  // ---- Actions: stairs ----
  calcStairs: (body: calculatorsApi.StairInput) => Promise<void>;
  calcStairsMaterials: (body: calculatorsApi.StairMaterialsInput) => Promise<void>;
  calcStairsGardeCorps: (body: calculatorsApi.StairGardeCorpsInput) => Promise<void>;

  // ---- Actions: electrical ----
  calcElectrical: (body: calculatorsApi.ElectricalInput) => Promise<void>;
  calcElectricalResidential: (body: calculatorsApi.ElectricalResidentialInput) => Promise<void>;
  calcElectricalLighting: (body: calculatorsApi.ElectricalLightingInput) => Promise<void>;
  calcElectricalGrounding: (body: calculatorsApi.ElectricalGroundingInput) => Promise<void>;

  // ---- Actions: roofing ----
  calcRoofing: (body: calculatorsApi.RoofingInput) => Promise<void>;
  calcRoofingVentilation: (body: calculatorsApi.RoofingVentilationInput) => Promise<void>;
  calcRoofingGutters: (body: calculatorsApi.RoofingGuttersInput) => Promise<void>;
  calcRoofingSnowLoad: (body: calculatorsApi.RoofingSnowLoadInput) => Promise<void>;

  // ---- Actions: painting ----
  calcPainting: (body: calculatorsApi.PaintingInput) => Promise<void>;
  calcPaintingDft: (body: calculatorsApi.PaintingDFTInput) => Promise<void>;
  calcPaintingDewPoint: (body: calculatorsApi.PaintingDewPointInput) => Promise<void>;

  // ---- Actions: plumbing ----
  calcPlumbing: (body: calculatorsApi.PlumbingInput) => Promise<void>;
  calcPlumbingHazenWilliams: (body: calculatorsApi.PlumbingHazenWilliamsInput) => Promise<void>;
  calcPlumbingWaterHeater: (body: calculatorsApi.PlumbingWaterHeaterInput) => Promise<void>;
  calcPlumbingDrainSlope: (body: calculatorsApi.PlumbingDrainSlopeInput) => Promise<void>;

  // ---- Actions: hvac ----
  calcHvac: (body: calculatorsApi.HvacInput) => Promise<void>;
  calcHvacDuct: (body: calculatorsApi.HvacDuctInput) => Promise<void>;
  calcHvacCfm: (body: calculatorsApi.HvacCfmInput) => Promise<void>;
  calcHvacHrv: (body: calculatorsApi.HvacHrvInput) => Promise<void>;
  calcHvacCooling: (body: calculatorsApi.HvacCoolingInput) => Promise<void>;

  // ---- Actions: welding ----
  calcWelding: (body: calculatorsApi.WeldingInput) => Promise<void>;
  calcWeldingHeatInput: (body: calculatorsApi.WeldingHeatInputInput) => Promise<void>;
  calcWeldingPreheat: (body: calculatorsApi.WeldingPreheatInput) => Promise<void>;
  calcWeldingConsumable: (body: calculatorsApi.WeldingConsumableInput) => Promise<void>;

  // ---- Actions: bending ----
  calcBending: (body: calculatorsApi.BendingInput) => Promise<void>;
  calcBendingSpringback: (body: calculatorsApi.BendingSpringbackInput) => Promise<void>;
  calcBendingMinRadius: (body: calculatorsApi.BendingMinRadiusInput) => Promise<void>;

  // ---- Actions: metal + taxes + payroll + structural ----
  calcMetalWeight: (body: calculatorsApi.MetalWeightInput) => Promise<void>;
  calcTaxes: (body: calculatorsApi.TaxesInput) => Promise<void>;
  calcChargeTributaire: (body: calculatorsApi.ChargeTributaireInput) => Promise<void>;
  calcStructural: (body: calculatorsApi.ChargeTributaireCompleteInput) => Promise<void>;
  fetchStructuralMaterials: () => Promise<void>;
  fetchSnowLoads: () => Promise<void>;

  // ---- Actions: history ----
  fetchHistory: (calculatorId?: string, limit?: number) => Promise<void>;
  saveHistory: (body: calculatorsApi.HistoryCreateInput) => Promise<void>;
  deleteHistoryItem: (id: number) => Promise<void>;
  clearHistoryAll: (calculatorId?: string) => Promise<void>;
  fetchHistoryStats: () => Promise<void>;

  // ---- Actions: AI ----
  aiChat: (body: calculatorsApi.AiChatRequest) => Promise<void>;
  aiAnalyze: (body: calculatorsApi.AiAnalyzeRequest) => Promise<void>;
  aiRecommend: (body: calculatorsApi.AiRecommendRequest) => Promise<void>;
  aiExplainNorm: (body: calculatorsApi.AiExplainNormRequest) => Promise<void>;
  aiDiagnose: (body: calculatorsApi.AiDiagnoseRequest) => Promise<void>;
  aiOptimize: (body: calculatorsApi.AiOptimizeRequest) => Promise<void>;
  clearAiChat: () => void;

  // ---- UI helpers ----
  clearError: () => void;
  clearSuccess: () => void;
  clearAllResults: () => void;
  reset: () => void;
}

function extractError(err: unknown, fallback = 'Erreur'): string {
  if (err instanceof Error) {
    type ApiErr = { response?: { data?: { detail?: string; message?: string } } };
    const axiosErr = err as ApiErr;
    const detail = axiosErr?.response?.data?.detail;
    if (typeof detail === 'string' && detail.length > 0) return detail;
    const msg = axiosErr?.response?.data?.message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
    return err.message || fallback;
  }
  return fallback;
}

const initialResults = {
  concreteResult: null,
  concreteDosageResult: null,
  concreteRebarResult: null,
  concreteCureResult: null,
  concreteFormworkResult: null,
  concreteExcavationResult: null,
  concreteTalusResult: null,
  concreteStairsResult: null,
  stairsResult: null,
  stairsMaterialsResult: null,
  stairsGardeCorpsResult: null,
  electricalResult: null,
  electricalResidentialResult: null,
  electricalLightingResult: null,
  electricalGroundingResult: null,
  roofingResult: null,
  roofingVentilationResult: null,
  roofingGuttersResult: null,
  roofingSnowLoadResult: null,
  paintingResult: null,
  paintingDftResult: null,
  paintingDewPointResult: null,
  plumbingResult: null,
  plumbingHazenResult: null,
  plumbingWaterHeaterResult: null,
  plumbingDrainSlopeResult: null,
  hvacResult: null,
  hvacDuctResult: null,
  hvacCfmResult: null,
  hvacHrvResult: null,
  hvacCoolingResult: null,
  weldingResult: null,
  weldingHeatInputResult: null,
  weldingPreheatResult: null,
  weldingConsumableResult: null,
  bendingResult: null,
  bendingSpringbackResult: null,
  bendingMinRadiusResult: null,
  metalWeightResult: null,
  taxesResult: null,
  chargeTributaireResult: null,
  structuralResult: null,
  aiAnalyzeResult: null,
  aiRecommendResult: null,
  aiExplainNormResult: null,
  aiDiagnoseResult: null,
  aiOptimizeResult: null,
};

export const useCalculatorsStore = create<CalculatorsState>((set, get) => ({
  // ---- Initial state ----
  calculators: [],
  constants: null,
  resources: null,
  conversions: null,
  currentCalcId: null,
  currentSubcalcId: null,

  ...initialResults,

  structuralMaterials: null,
  snowLoads: null,

  history: [],
  historyStats: null,

  aiChatHistory: [],
  isAiRunning: false,

  isLoading: false,
  error: null,
  successMessage: null,

  // ============================================
  // METADATA
  // ============================================
  fetchCalculators: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await calculatorsApi.listCalculators();
      set({ calculators: res.calculators, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur lors du chargement des calculateurs') });
    }
  },

  fetchConstants: async () => {
    if (get().constants) return;
    set({ error: null });
    try {
      const constants = await calculatorsApi.getCalculatorConstants();
      set({ constants });
    } catch (err) {
      set({ error: extractError(err, 'Erreur lors du chargement des constantes') });
    }
  },

  fetchResources: async () => {
    if (get().resources) return;
    set({ error: null });
    try {
      const resources = await calculatorsApi.getCalculatorResources();
      set({ resources });
    } catch (err) {
      set({ error: extractError(err, 'Erreur lors du chargement des ressources') });
    }
  },

  fetchConversions: async () => {
    if (get().conversions) return;
    set({ isLoading: true, error: null });
    try {
      const conversions = await calculatorsApi.getConversions();
      set({ conversions, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur lors du chargement des conversions') });
    }
  },

  selectCalculator: (id, subcalcId = null) => {
    set({ currentCalcId: id, currentSubcalcId: subcalcId });
  },

  // ============================================
  // CONCRETE
  // ============================================
  calcConcrete: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcConcrete(body);
      set({ concreteResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur de calcul beton') });
    }
  },
  calcConcreteDosage: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcConcreteDosage(body);
      set({ concreteDosageResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur de calcul dosage') });
    }
  },
  calcConcreteRebar: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcConcreteRebar(body);
      set({ concreteRebarResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur de calcul armature') });
    }
  },
  calcConcreteCure: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcConcreteCure(body);
      set({ concreteCureResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur de calcul cure') });
    }
  },
  calcConcreteFormwork: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcConcreteFormwork(body);
      set({ concreteFormworkResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur de calcul coffrage') });
    }
  },
  calcConcreteExcavation: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcConcreteExcavation(body);
      set({ concreteExcavationResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur de calcul excavation') });
    }
  },
  calcConcreteTalus: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcConcreteTalus(body);
      set({ concreteTalusResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur de calcul talus') });
    }
  },
  calcConcreteStairs: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcConcreteStairs(body);
      set({ concreteStairsResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur de calcul escalier beton') });
    }
  },

  // ============================================
  // STAIRS
  // ============================================
  calcStairs: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcStairs(body);
      set({ stairsResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur de calcul escaliers') });
    }
  },
  calcStairsMaterials: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcStairsMaterials(body);
      set({ stairsMaterialsResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur materiaux escaliers') });
    }
  },
  calcStairsGardeCorps: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcStairsGardeCorps(body);
      set({ stairsGardeCorpsResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur garde-corps') });
    }
  },

  // ============================================
  // ELECTRICAL
  // ============================================
  calcElectrical: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcElectrical(body);
      set({ electricalResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul electrique') });
    }
  },
  calcElectricalResidential: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcElectricalResidential(body);
      set({ electricalResidentialResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur charge residentielle') });
    }
  },
  calcElectricalLighting: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcElectricalLighting(body);
      set({ electricalLightingResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul eclairage') });
    }
  },
  calcElectricalGrounding: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcElectricalGrounding(body);
      set({ electricalGroundingResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul mise a la terre') });
    }
  },

  // ============================================
  // ROOFING
  // ============================================
  calcRoofing: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcRoofing(body);
      set({ roofingResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul toiture') });
    }
  },
  calcRoofingVentilation: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcRoofingVentilation(body);
      set({ roofingVentilationResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul ventilation') });
    }
  },
  calcRoofingGutters: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcRoofingGutters(body);
      set({ roofingGuttersResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul gouttieres') });
    }
  },
  calcRoofingSnowLoad: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcRoofingSnowLoad(body);
      set({ roofingSnowLoadResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul charge de neige') });
    }
  },

  // ============================================
  // PAINTING
  // ============================================
  calcPainting: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcPainting(body);
      set({ paintingResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul peinture') });
    }
  },
  calcPaintingDft: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcPaintingDft(body);
      set({ paintingDftResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul DFT') });
    }
  },
  calcPaintingDewPoint: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcPaintingDewPoint(body);
      set({ paintingDewPointResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur point de rosee') });
    }
  },

  // ============================================
  // PLUMBING
  // ============================================
  calcPlumbing: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcPlumbing(body);
      set({ plumbingResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul plomberie') });
    }
  },
  calcPlumbingHazenWilliams: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcPlumbingHazenWilliams(body);
      set({ plumbingHazenResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur Hazen-Williams') });
    }
  },
  calcPlumbingWaterHeater: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcPlumbingWaterHeater(body);
      set({ plumbingWaterHeaterResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chauffe-eau') });
    }
  },
  calcPlumbingDrainSlope: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcPlumbingDrainSlope(body);
      set({ plumbingDrainSlopeResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur pente drain') });
    }
  },

  // ============================================
  // HVAC
  // ============================================
  calcHvac: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcHvac(body);
      set({ hvacResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul HVAC') });
    }
  },
  calcHvacDuct: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcHvacDuct(body);
      set({ hvacDuctResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul conduit') });
    }
  },
  calcHvacCfm: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcHvacCfm(body);
      set({ hvacCfmResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul CFM') });
    }
  },
  calcHvacHrv: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcHvacHrv(body);
      set({ hvacHrvResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul HRV') });
    }
  },
  calcHvacCooling: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcHvacCooling(body);
      set({ hvacCoolingResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul climatisation') });
    }
  },

  // ============================================
  // WELDING
  // ============================================
  calcWelding: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcWelding(body);
      set({ weldingResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul soudure') });
    }
  },
  calcWeldingHeatInput: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcWeldingHeatInput(body);
      set({ weldingHeatInputResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur Heat Input') });
    }
  },
  calcWeldingPreheat: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcWeldingPreheat(body);
      set({ weldingPreheatResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur prechauffage') });
    }
  },
  calcWeldingConsumable: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcWeldingConsumable(body);
      set({ weldingConsumableResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur consommables') });
    }
  },

  // ============================================
  // BENDING
  // ============================================
  calcBending: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcBending(body);
      set({ bendingResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul pliage') });
    }
  },
  calcBendingSpringback: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcBendingSpringback(body);
      set({ bendingSpringbackResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur springback') });
    }
  },
  calcBendingMinRadius: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcBendingMinRadius(body);
      set({ bendingMinRadiusResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur rayon min') });
    }
  },

  // ============================================
  // METAL WEIGHT + TAXES + PAYROLL + STRUCTURAL
  // ============================================
  calcMetalWeight: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcMetalWeight(body);
      set({ metalWeightResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur poids metal') });
    }
  },
  calcTaxes: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcTaxes(body);
      set({ taxesResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul taxes') });
    }
  },
  calcChargeTributaire: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcChargeTributaire(body);
      set({ chargeTributaireResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur calcul paie') });
    }
  },
  calcStructural: async (body) => {
    set({ isLoading: true, error: null });
    try {
      const result = await calculatorsApi.calcStructural(body);
      set({ structuralResult: result, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur analyse structurale') });
    }
  },
  fetchStructuralMaterials: async () => {
    if (get().structuralMaterials) return;
    set({ error: null });
    try {
      const materials = await calculatorsApi.getStructuralMaterials();
      set({ structuralMaterials: materials });
    } catch (err) {
      set({ error: extractError(err, 'Erreur materiaux structuraux') });
    }
  },
  fetchSnowLoads: async () => {
    if (get().snowLoads) return;
    set({ error: null });
    try {
      const loads = await calculatorsApi.getSnowLoads();
      set({ snowLoads: loads });
    } catch (err) {
      set({ error: extractError(err, 'Erreur charges de neige') });
    }
  },

  // ============================================
  // HISTORY
  // ============================================
  fetchHistory: async (calculatorId, limit = 100) => {
    set({ isLoading: true, error: null });
    try {
      const res = await calculatorsApi.listHistory(calculatorId, limit);
      set({ history: res.items, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement historique') });
    }
  },
  saveHistory: async (body) => {
    try {
      await calculatorsApi.createHistory(body);
      set({ successMessage: 'Calcul sauvegarde' });
      // Re-fetch history
      try {
        const res = await calculatorsApi.listHistory(body.calculator_id);
        set({ history: res.items });
      } catch {
        // Non-critical
      }
    } catch (err) {
      set({ error: extractError(err, 'Erreur sauvegarde historique') });
      throw err;
    }
  },
  deleteHistoryItem: async (id) => {
    try {
      await calculatorsApi.deleteHistoryItem(id);
      set((state) => ({
        history: state.history.filter((h) => h.id !== id),
        successMessage: 'Calcul supprime',
      }));
    } catch (err) {
      set({ error: extractError(err, 'Erreur suppression') });
    }
  },
  clearHistoryAll: async (calculatorId) => {
    try {
      await calculatorsApi.clearHistory(calculatorId);
      set({ history: [], successMessage: 'Historique efface' });
    } catch (err) {
      set({ error: extractError(err, 'Erreur effacement historique') });
    }
  },
  fetchHistoryStats: async () => {
    try {
      const stats = await calculatorsApi.getHistoryStats();
      set({ historyStats: stats });
    } catch (err) {
      set({ error: extractError(err, 'Erreur stats historique') });
    }
  },

  // ============================================
  // AI ENDPOINTS
  // ============================================
  aiChat: async (body) => {
    if (get().isAiRunning) return;
    set({ isAiRunning: true, error: null });
    const prevHistory = get().aiChatHistory;
    const userMsg: AiChatMessage = {
      role: 'user',
      content: body.question,
      calculatorId: body.calculator_id,
      timestamp: new Date().toISOString(),
    };
    set({ aiChatHistory: [...prevHistory, userMsg] });
    try {
      const result: AiChatResponse = await calculatorsApi.aiChat(body);
      const current = get().aiChatHistory;
      // Race protection: if history was cleared while we were waiting, ignore
      if (current.length < prevHistory.length + 1) {
        set({ isAiRunning: false });
        return;
      }
      set({
        aiChatHistory: [
          ...current,
          {
            role: 'assistant',
            content: result.response,
            calculatorId: result.calculatorId,
            timestamp: new Date().toISOString(),
          },
        ],
        isAiRunning: false,
      });
    } catch (err) {
      const current = get().aiChatHistory;
      set({
        aiChatHistory: current.length < prevHistory.length + 1 ? current : prevHistory,
        error: extractError(err, 'Erreur chat IA'),
        isAiRunning: false,
      });
    }
  },
  aiAnalyze: async (body) => {
    if (get().isAiRunning) return;
    set({ isAiRunning: true, error: null });
    try {
      const result = await calculatorsApi.aiAnalyze(body);
      set({ aiAnalyzeResult: result, isAiRunning: false });
    } catch (err) {
      set({ isAiRunning: false, error: extractError(err, 'Erreur analyse IA') });
    }
  },
  aiRecommend: async (body) => {
    if (get().isAiRunning) return;
    set({ isAiRunning: true, error: null });
    try {
      const result = await calculatorsApi.aiRecommend(body);
      set({ aiRecommendResult: result, isAiRunning: false });
    } catch (err) {
      set({ isAiRunning: false, error: extractError(err, 'Erreur recommandation IA') });
    }
  },
  aiExplainNorm: async (body) => {
    if (get().isAiRunning) return;
    set({ isAiRunning: true, error: null });
    try {
      const result = await calculatorsApi.aiExplainNorm(body);
      set({ aiExplainNormResult: result, isAiRunning: false });
    } catch (err) {
      set({ isAiRunning: false, error: extractError(err, 'Erreur explication norme') });
    }
  },
  aiDiagnose: async (body) => {
    if (get().isAiRunning) return;
    set({ isAiRunning: true, error: null });
    try {
      const result = await calculatorsApi.aiDiagnose(body);
      set({ aiDiagnoseResult: result, isAiRunning: false });
    } catch (err) {
      set({ isAiRunning: false, error: extractError(err, 'Erreur diagnostic IA') });
    }
  },
  aiOptimize: async (body) => {
    if (get().isAiRunning) return;
    set({ isAiRunning: true, error: null });
    try {
      const result = await calculatorsApi.aiOptimize(body);
      set({ aiOptimizeResult: result, isAiRunning: false });
    } catch (err) {
      set({ isAiRunning: false, error: extractError(err, 'Erreur optimisation IA') });
    }
  },
  clearAiChat: () => set({
    aiChatHistory: [],
    aiAnalyzeResult: null,
    aiRecommendResult: null,
    aiExplainNormResult: null,
    aiDiagnoseResult: null,
    aiOptimizeResult: null,
  }),

  // ============================================
  // UI HELPERS
  // ============================================
  clearError: () => set({ error: null }),
  clearSuccess: () => set({ successMessage: null }),
  clearAllResults: () => set({ ...initialResults }),
  reset: () => set({
    calculators: [],
    constants: null,
    resources: null,
    conversions: null,
    currentCalcId: null,
    currentSubcalcId: null,
    ...initialResults,
    structuralMaterials: null,
    snowLoads: null,
    history: [],
    historyStats: null,
    aiChatHistory: [],
    isAiRunning: false,
    isLoading: false,
    error: null,
    successMessage: null,
  }),
}));
