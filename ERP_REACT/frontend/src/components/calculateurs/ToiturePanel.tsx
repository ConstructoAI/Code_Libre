/**
 * ToiturePanel - Calculateur de toiture residentielle (Quebec)
 *
 * Inspiration: Wall Builder Pro / Roof Builder mobile app
 *
 * Fonctionnalites:
 * - Saisie dimensions (ridge, span, overhang, pente)
 * - Types: a 2 versants (gable), a 4 versants (hip), mono-pente (shed)
 * - Calculs trigonometriques: rise, run, hypotenuse, rafter length
 * - Quantites materiaux: chevrons, faitage, planches de rive, voligeage, bardeaux
 * - Liste de coupe avec etiquettes (RG, F, R1-R3, PLY)
 * - Visualisation SVG 2D (vue coupe pignon)
 * - Validations charge neige Quebec
 *
 * Calcul 100% frontend, format imperial (pouces + fractions 16e).
 */

import { useMemo, useState } from 'react';
import {
  AlertCircle, AlertTriangle, Home, Info, Layers, Ruler, Snowflake, Triangle,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';

// ============================================
// TYPES
// ============================================

export type ToitureType = 'gable' | 'hip' | 'shed';
export type ToiturePitch = '4/12' | '6/12' | '8/12' | '10/12' | '12/12';
export type ToitureRafter = '2x6' | '2x8' | '2x10' | '2-2x10';
export type ToitureSpacing = 16 | 19.2 | 24;
export type ToitureSheathing = 'osb-3/8' | 'osb-7/16' | 'ply-1/2';
export type ToitureShingle = 'asphalte-25' | 'asphalte-30' | 'asphalte-50';
export type ToitureZone = 'montreal' | 'quebec' | 'nord';

export interface ToitureDims {
  ridgeLengthFt: number;
  ridgeLengthIn: number;
  spanFt: number;
  spanIn: number;
  overhangIn: number;
  overhangPignonIn: number;
}

export interface ToitureConfig {
  type: ToitureType;
  pitch: ToiturePitch;
  rafterType: ToitureRafter;
  spacing: ToitureSpacing;
  sheathingType: ToitureSheathing;
  shingleType: ToitureShingle;
  zone: ToitureZone;
}

export interface ToiturePiece {
  id: string;
  label: string;
  type: string; // ex: '2x6', '2x8', '4x8-3/8"'
  lengthIn: number;
  qty: number;
  category: 'ridge' | 'fascia' | 'rafter-common' | 'rafter-pignon' | 'sheathing';
}

export interface ToitureMaterials {
  rafters: { type: string; lengthIn: number; qty: number };
  ridge: { type: string; lengthIn: number; qty: number };
  fascia: { type: string; lengthIn: number; qty: number };
  sheathingPanels: { type: string; sizeIn: string; qty: number };
  shingleBundles: { type: string; bundles: number; squares: number };
  underlayment: { type: string; rolls: number };
  dripEdge: { type: string; pieces: number };
}

export interface ToitureCalculations {
  rise: number;
  run: number;
  hypotenuseIn: number;
  rafterLengthIn: number;
  surfaceFt2: number;
  perimeterEavesLF: number;
  perimeterRakeLF: number;
}

export interface ToitureSnapshot {
  dims: ToitureDims;
  config: ToitureConfig;
  pieces: ToiturePiece[];
  materials: ToitureMaterials;
  calculations: ToitureCalculations;
}

export interface ToitureValidation {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

// ============================================
// CONSTANTS
// ============================================

export const PITCH_RATIOS: Record<ToiturePitch, number> = {
  '4/12': 4 / 12,
  '6/12': 6 / 12,
  '8/12': 8 / 12,
  '10/12': 10 / 12,
  '12/12': 12 / 12,
};

export const RAFTER_DEPTHS: Record<ToitureRafter, number> = {
  '2x6': 5.5,
  '2x8': 7.25,
  '2x10': 9.25,
  '2-2x10': 9.25,
};

export const SHINGLE_COVERAGE: Record<ToitureShingle, number> = {
  'asphalte-25': 33.3,
  'asphalte-30': 32,
  'asphalte-50': 28,
};

export const WASTE_PCT_SHINGLES = 0.10;
export const WASTE_PCT_SHEATHING = 0.10;
export const DRIP_EDGE_PIECES_LENGTH = 120; // 10 pi en pouces

// Charges neige typiques (kPa) - reference CNB / CCQ
const SNOW_LOAD_KPA: Record<ToitureZone, number> = {
  montreal: 2.7,
  quebec: 3.5,
  nord: 4.5,
};

const ZONE_LABELS: Record<ToitureZone, string> = {
  montreal: 'Montreal (2.7 kPa)',
  quebec: 'Quebec / Saguenay (3.5 kPa)',
  nord: 'Nord du Quebec (>4 kPa)',
};

const SHEATHING_PANEL_FT2 = 32; // 4x8 = 32 ft2

// ============================================
// HELPERS
// ============================================

export function formatFraction(decimalIn: number): string {
  if (decimalIn == null || isNaN(decimalIn)) return '0"';
  const sign = decimalIn < 0 ? '-' : '';
  const abs = Math.abs(decimalIn);
  const whole = Math.floor(abs);
  const frac = abs - whole;
  const sixteenths = Math.round(frac * 16);
  if (sixteenths === 0) return `${sign}${whole}"`;
  if (sixteenths === 16) return `${sign}${whole + 1}"`;
  let num = sixteenths;
  let den = 16;
  while (num % 2 === 0 && den % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  return whole === 0 ? `${sign}${num}/${den}"` : `${sign}${whole} ${num}/${den}"`;
}

function inchesToFeet(inches: number): string {
  const ft = Math.floor(inches / 12);
  const remIn = inches - ft * 12;
  if (remIn < 0.0625) return `${ft}'`;
  return `${ft}' ${formatFraction(remIn)}`;
}

function dimsToInches(dims: ToitureDims): { ridge: number; span: number } {
  return {
    ridge: dims.ridgeLengthFt * 12 + dims.ridgeLengthIn,
    span: dims.spanFt * 12 + dims.spanIn,
  };
}

// ============================================
// COMPUTE - TRIGONOMETRIE
// ============================================

export function computeRafterLength(
  spanIn: number,
  pitch: ToiturePitch,
  overhangIn: number,
): { rise: number; run: number; hypotenuse: number; rafterTotal: number } {
  // Garde-fou: span/overhang negatifs ou invalides retournent zeros
  if (!isFinite(spanIn) || spanIn <= 0 || !isFinite(overhangIn) || overhangIn < 0) {
    return { rise: 0, run: 0, hypotenuse: 0, rafterTotal: Math.max(0, overhangIn) };
  }
  const ratio = PITCH_RATIOS[pitch];
  const run = spanIn / 2;
  const rise = run * ratio;
  const hypotenuse = Math.sqrt(run * run + rise * rise);
  const rafterTotal = hypotenuse + overhangIn;
  return { rise, run, hypotenuse, rafterTotal };
}

// ============================================
// COMPUTE - PIECES (cut list)
// ============================================

export function computeToiture(dims: ToitureDims, config: ToitureConfig): ToiturePiece[] {
  const { ridge, span } = dimsToInches(dims);
  const { rafterTotal, hypotenuse } = computeRafterLength(span, config.pitch, dims.overhangIn);

  const pieces: ToiturePiece[] = [];
  const spacing = config.spacing;

  // === Faitage (RG1) - planche faitage
  // Longueur faitage = ridge + 2 * overhang pignon
  const ridgeLength = ridge + 2 * dims.overhangPignonIn;
  pieces.push({
    id: 'RG1',
    label: 'RG1',
    type: config.rafterType,
    lengthIn: ridgeLength,
    qty: 1,
    category: 'ridge',
  });

  // === Planches de rive (F1, F2) - fascia eaves (debord)
  // Sur les 2 debords lateraux (cote pignon) -> hypotenuse + overhang horizontal
  // F1 et F2 sur les rives (gable end rakes) = hypotenuse * 2 (un de chaque cote)
  if (config.type === 'gable' || config.type === 'shed') {
    pieces.push({
      id: 'F1',
      label: 'F1',
      type: '2x6',
      lengthIn: hypotenuse + dims.overhangIn,
      qty: 2, // 2 cotes (gauche/droite)
      category: 'fascia',
    });
    // F2 = planches de rive sur avant-toit (eaves)
    pieces.push({
      id: 'F2',
      label: 'F2',
      type: '2x6',
      lengthIn: ridgeLength,
      qty: config.type === 'shed' ? 1 : 2,
      category: 'fascia',
    });
  } else {
    // hip = 4 cotes
    pieces.push({
      id: 'F1',
      label: 'F1',
      type: '2x6',
      lengthIn: ridgeLength,
      qty: 4,
      category: 'fascia',
    });
  }

  // === Chevrons communs (R2) - le long du faitage
  // Nombre = ceil(ridge / spacing) + 1 pour respecter espacement max c/c
  const ridgeInches = ridge;
  const nbRafters = Math.max(2, Math.ceil(ridgeInches / spacing) + 1);
  const rafterPairs = config.type === 'shed' ? 1 : 2; // 2 versants = 2 chevrons par position
  const rafterQty = nbRafters * rafterPairs;

  pieces.push({
    id: 'R2',
    label: 'R2',
    type: config.rafterType,
    lengthIn: rafterTotal,
    qty: rafterQty,
    category: 'rafter-common',
  });

  // === Chevron commun renforce R1 (extremites - 2x8 typiquement)
  // Aux extremites du faitage (gable): 2 chevrons doubles renforces
  if (config.type === 'gable') {
    pieces.push({
      id: 'R1',
      label: 'R1',
      type: '2x8',
      lengthIn: rafterTotal,
      qty: 4, // 2 cotes x 2 chevrons doubles
      category: 'rafter-pignon',
    });

    // R3 - chevrons de rive supplementaires (lookout/outlooker pour debord pignon)
    if (dims.overhangPignonIn > 0) {
      pieces.push({
        id: 'R3',
        label: 'R3',
        type: config.rafterType,
        lengthIn: rafterTotal,
        qty: 3,
        category: 'rafter-pignon',
      });
    }
  }

  // === Hip: chevrons d'aretier (4 coins)
  if (config.type === 'hip') {
    // Longueur aretier = sqrt(hyp^2 + (span/2)^2) approximation
    const hipLen = Math.sqrt(hypotenuse * hypotenuse + (span / 2) * (span / 2)) + dims.overhangIn;
    pieces.push({
      id: 'R1',
      label: 'R1',
      type: '2-2x10',
      lengthIn: hipLen,
      qty: 4,
      category: 'rafter-pignon',
    });
  }

  // === Voligeage (panneaux OSB / contreplaque)
  // Surface = 2 * (rafterTotal * ridge) pour gable
  const surfaceIn2 = computeSurface(dims, config);
  const surfaceFt2 = surfaceIn2 / 144;
  const panelsNeeded = Math.ceil((surfaceFt2 * (1 + WASTE_PCT_SHEATHING)) / SHEATHING_PANEL_FT2);

  const sheathingTypeLabel = config.sheathingType.startsWith('osb')
    ? `4x8-${config.sheathingType.replace('osb-', '')}`
    : `4x8-${config.sheathingType.replace('ply-', '')}`;

  // PLY1 - PLYn : un par panneau (cas typique: meme dimension)
  // Pour ne pas saturer la liste, on agrege en 1 ligne avec quantite
  pieces.push({
    id: 'PLY1',
    label: `PLY1-${panelsNeeded}`,
    type: sheathingTypeLabel,
    lengthIn: 96, // 8 pi
    qty: panelsNeeded,
    category: 'sheathing',
  });

  return pieces;
}

// ============================================
// COMPUTE - SURFACE
// ============================================

function computeSurface(dims: ToitureDims, config: ToitureConfig): number {
  const { ridge, span } = dimsToInches(dims);
  const { hypotenuse } = computeRafterLength(span, config.pitch, dims.overhangIn);

  // Inclure les debords pour le calcul de surface couverture
  const totalRidge = ridge + 2 * dims.overhangPignonIn;
  const totalSlant = hypotenuse + dims.overhangIn;

  if (config.type === 'gable') {
    return 2 * (totalSlant * totalRidge); // pouces carres
  }
  if (config.type === 'shed') {
    return totalSlant * totalRidge;
  }
  // hip: 2 trapezes (sides) + 2 triangles (ends)
  // ridge_short = ridge - span (longueur du faitage hipped, hypothese hip equal)
  // surface = 2 * trapezoid(ridge, ridge_short, slant) + 2 * triangle(span, slant)
  // Pour hip equal pitch : la portion hipped a longueur (ridge - span)
  const ridgeShort = Math.max(0, totalRidge - span);
  const surfaceTrapezes = 2 * ((totalRidge + ridgeShort) / 2) * totalSlant;
  const surfaceTriangles = 2 * (span / 2) * totalSlant;
  return surfaceTrapezes + surfaceTriangles;
}

// ============================================
// COMPUTE - BARDEAUX
// ============================================

export function computeShingles(
  surfaceFt2: number,
  shingleType: ToitureShingle,
): { bundles: number; squares: number } {
  const coverage = SHINGLE_COVERAGE[shingleType];
  const surfaceWithWaste = surfaceFt2 * (1 + WASTE_PCT_SHINGLES);
  const bundles = Math.ceil(surfaceWithWaste / coverage);
  // 1 carre = 100 ft2 = 3 paquets typiquement
  const squares = Math.ceil(surfaceWithWaste / 100);
  return { bundles, squares };
}

// ============================================
// MATERIAUX (synthese)
// ============================================

export function generateToitureMaterials(
  pieces: ToiturePiece[],
  dims: ToitureDims,
  config: ToitureConfig,
): ToitureMaterials {
  const { ridge, span } = dimsToInches(dims);
  const surfaceIn2 = computeSurface(dims, config);
  const surfaceFt2 = surfaceIn2 / 144;

  // Rafters - somme des qty pour categories rafter
  let raftersQty = 0;
  let rafterLen = 0;
  let rafterType = config.rafterType;
  for (const p of pieces) {
    if (p.category === 'rafter-common') {
      raftersQty += p.qty;
      rafterLen = Math.max(rafterLen, p.lengthIn);
      rafterType = p.type as ToitureRafter;
    }
  }

  // Ridge
  const ridgePiece = pieces.find((p) => p.category === 'ridge');
  // Fascia
  const fasciaPieces = pieces.filter((p) => p.category === 'fascia');
  const fasciaQty = fasciaPieces.reduce((s, p) => s + p.qty, 0);
  const fasciaLen = fasciaPieces.reduce((m, p) => Math.max(m, p.lengthIn), 0);

  // Sheathing
  const sheathPiece = pieces.find((p) => p.category === 'sheathing');
  const sheathingTypeLabel = config.sheathingType;

  // Bardeaux
  const { bundles, squares } = computeShingles(surfaceFt2, config.shingleType);

  // Sous-couche : 1 rouleau couvre ~200 ft2 (membrane) - 432 ft2 pour feutre #15
  const underlaymentCoverage = 400;
  const underlaymentRolls = Math.ceil((surfaceFt2 * 1.05) / underlaymentCoverage);

  // Bordure d'egout (drip edge) - perimetre eaves + rakes selon type toit
  // gable : 2 eaves (avant + arriere) avec depasse pignon
  // hip   : 4 cotes du perimetre toit (eaves complet)
  // shed  : 1 eaves
  let perimeterEavesIn: number;
  let perimeterRakeIn: number;
  if (config.type === 'gable') {
    perimeterEavesIn = 2 * (ridge + 2 * dims.overhangPignonIn);
    perimeterRakeIn = fasciaLen * 2; // 2 rakes pignon
  } else if (config.type === 'hip') {
    // hip : perimetre complet = 2 longueurs (eaves cotes) + 2 largeurs (eaves bouts)
    perimeterEavesIn = 2 * ridge + 2 * span;
    perimeterRakeIn = 0; // pas de rakes sur hip
  } else {
    // shed
    perimeterEavesIn = ridge;
    perimeterRakeIn = 0;
  }
  const perimeterTotalIn = perimeterEavesIn + perimeterRakeIn;
  const dripEdgePieces = Math.ceil((perimeterTotalIn * 1.05) / DRIP_EDGE_PIECES_LENGTH);

  return {
    rafters: { type: rafterType, lengthIn: rafterLen, qty: raftersQty },
    ridge: {
      type: ridgePiece?.type || config.rafterType,
      lengthIn: ridgePiece?.lengthIn || 0,
      qty: ridgePiece?.qty || 0,
    },
    fascia: { type: '2x6', lengthIn: fasciaLen, qty: fasciaQty },
    sheathingPanels: {
      type: sheathingTypeLabel,
      sizeIn: '48"x96"',
      qty: sheathPiece?.qty || 0,
    },
    shingleBundles: { type: config.shingleType, bundles, squares },
    underlayment: { type: 'Feutre 15#', rolls: underlaymentRolls },
    dripEdge: { type: 'Bordure egout 10pi', pieces: dripEdgePieces },
  };
}

// ============================================
// CALCULATIONS COMPLETES
// ============================================

function computeAllCalculations(
  dims: ToitureDims,
  config: ToitureConfig,
): ToitureCalculations {
  const { ridge, span } = dimsToInches(dims);
  const { rise, run, hypotenuse, rafterTotal } = computeRafterLength(span, config.pitch, dims.overhangIn);

  const surfaceIn2 = computeSurface(dims, config);
  const surfaceFt2 = surfaceIn2 / 144;

  // Perimetre eaves/rake aligne avec generateToitureMaterials (drip edge)
  let perimeterEavesInLocal: number;
  let perimeterRakeInLocal: number;
  if (config.type === 'gable') {
    perimeterEavesInLocal = 2 * (ridge + 2 * dims.overhangPignonIn);
    perimeterRakeInLocal = 2 * (hypotenuse + dims.overhangIn);
  } else if (config.type === 'hip') {
    perimeterEavesInLocal = 2 * ridge + 2 * span;
    perimeterRakeInLocal = 0;
  } else {
    // shed
    perimeterEavesInLocal = ridge;
    perimeterRakeInLocal = 0;
  }
  const perimeterEavesLF = perimeterEavesInLocal / 12;
  const perimeterRakeLF = perimeterRakeInLocal / 12;

  return {
    rise,
    run,
    hypotenuseIn: hypotenuse,
    rafterLengthIn: rafterTotal,
    surfaceFt2,
    perimeterEavesLF,
    perimeterRakeLF,
  };
}

// ============================================
// VALIDATIONS QUEBEC (CCQ / CNB)
// ============================================

export function validateToiture(
  dims: ToitureDims,
  config: ToitureConfig,
): ToitureValidation[] {
  const warnings: ToitureValidation[] = [];
  const { span, ridge } = dimsToInches(dims);
  const spanFt = span / 12;
  const { rafterTotal } = computeRafterLength(span, config.pitch, dims.overhangIn);
  const rafterFt = rafterTotal / 12;

  // 0a. Dimensions invalides
  if (span <= 0 || ridge <= 0) {
    warnings.push({
      level: 'error',
      code: 'INPUT',
      message: 'Dimensions invalides : largeur (span) et longueur faitage (ridge) doivent etre > 0.',
    });
    return warnings;
  }

  // 0b. Overhang excessif (> 24" = 2 pi est inhabituel sans support specifique)
  if (dims.overhangIn > 24) {
    warnings.push({
      level: 'warning',
      code: 'CCQ 9.27',
      message: `Avancee de toit ${dims.overhangIn}" > 24" : prevoir support cantilever (knee brace ou outrigger).`,
    });
  }

  // 0c. Overhang > rafter total (impossible physiquement)
  if (dims.overhangIn > rafterTotal * 0.5) {
    warnings.push({
      level: 'warning',
      code: 'INPUT',
      message: `Avancee ${dims.overhangIn}" depasse 50% du chevron total ${rafterTotal.toFixed(0)}" : verifier la geometrie.`,
    });
  }

  // 1. Pente forte + largeur importante = consulter ingenieur
  const pitchNum = parseInt(config.pitch.split('/')[0], 10);
  if (pitchNum >= 8 && spanFt > 30) {
    warnings.push({
      level: 'warning',
      code: 'CNB 9.23.13',
      message: `Pente forte (${config.pitch}) + largeur ${spanFt.toFixed(1)}' > 30' : consulter ingenieur (charges neige).`,
    });
  }

  // 2. Chevron > 16' avec 2x6
  if (config.rafterType === '2x6' && rafterFt > 16) {
    warnings.push({
      level: 'warning',
      code: 'CNB 9.23.13.7',
      message: `Chevron ${rafterFt.toFixed(1)}' > 16' avec 2x6 : utiliser 2x8 ou plus.`,
    });
  }

  // 3. Charge neige selon zone
  const snowLoad = SNOW_LOAD_KPA[config.zone];
  if (snowLoad >= 4) {
    warnings.push({
      level: 'info',
      code: 'CNB Annexe C',
      message: `Zone ${ZONE_LABELS[config.zone]} : valider dimensionnement chevrons (charge ${snowLoad} kPa).`,
    });
  }

  // 4. Pente faible et zone forte neige
  if (pitchNum < 4 && snowLoad >= 3) {
    warnings.push({
      level: 'warning',
      code: 'CCQ 9.26.2',
      message: `Pente faible (${config.pitch}) + zone neige forte : risque d'accumulation. Pente min 4/12 recommandee.`,
    });
  }

  // 5. Hip + grandes dimensions = piece d'aretier doublee
  if (config.type === 'hip' && spanFt > 24 && config.rafterType !== '2-2x10') {
    warnings.push({
      level: 'info',
      code: 'CNB 9.23.13.10',
      message: `Hip toit > 24' : aretiers doubles (2-2x10) recommandes.`,
    });
  }

  // 6. Span tres grand sans appui intermediaire
  if (spanFt > 32) {
    warnings.push({
      level: 'warning',
      code: 'CNB 9.23.13',
      message: `Portee ${spanFt.toFixed(1)}' > 32' : appui intermediaire (mur porteur ou poutre) requis.`,
    });
  }

  return warnings;
}

// ============================================
// DEFAULTS
// ============================================

const DEFAULT_DIMS: ToitureDims = {
  ridgeLengthFt: 20,
  ridgeLengthIn: 0,
  spanFt: 20,
  spanIn: 0,
  overhangIn: 12,
  overhangPignonIn: 12,
};

const DEFAULT_CONFIG: ToitureConfig = {
  type: 'gable',
  pitch: '6/12',
  rafterType: '2x8',
  spacing: 16,
  sheathingType: 'osb-7/16',
  shingleType: 'asphalte-30',
  zone: 'montreal',
};

// ============================================
// SUB-COMPONENTS
// ============================================

interface SectionHeaderProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}

function SectionHeader({ icon, title, subtitle }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="text-orange-600 dark:text-orange-400">{icon}</div>
      <div>
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h3>
        {subtitle && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}

function NumberField({ label, value, onChange, min, max, step = 1, suffix }: NumberFieldProps) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          min={min}
          max={max}
          step={step}
          className="w-full px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:border-orange-500"
        />
        {suffix && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}

function SelectField<T extends string>({ label, value, onChange, options }: SelectFieldProps<T>) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:border-orange-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ============================================
// SVG VIEW - VUE COUPE PIGNON
// ============================================

interface ToitureSVGProps {
  dims: ToitureDims;
  config: ToitureConfig;
  calc: ToitureCalculations;
}

function ToitureSVG({ dims, config, calc }: ToitureSVGProps) {
  const { span } = dimsToInches(dims);
  const { rise, hypotenuseIn } = calc;

  // SVG view box
  const padding = 60;
  const maxWidth = 360;
  const totalW = span + 2 * dims.overhangIn;
  const scale = (maxWidth - 2 * padding) / Math.max(totalW, 100);

  const w = totalW * scale;
  const h = (rise + 80) * scale + padding;
  const svgH = Math.max(220, h);

  const cx = w / 2 + padding;
  const baseY = svgH - padding;
  const peakY = baseY - rise * scale;

  const leftEaveX = padding;
  const rightEaveX = padding + w;

  // Coins du triangle (mur exterieur)
  const wallLeftX = leftEaveX + dims.overhangIn * scale;
  const wallRightX = rightEaveX - dims.overhangIn * scale;

  // Angle de pente
  const pitchAngleDeg = Math.atan(rise / (span / 2)) * (180 / Math.PI);

  return (
    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-2 overflow-x-auto">
      <svg
        width={maxWidth}
        height={svgH}
        viewBox={`0 0 ${maxWidth} ${svgH}`}
        className="mx-auto block"
        role="img"
        aria-label="Coupe pignon toiture"
      >
        {/* Mur exterieur (vertical sous le toit) */}
        <line
          x1={wallLeftX}
          y1={baseY}
          x2={wallLeftX}
          y2={baseY + 25}
          stroke="#9ca3af"
          strokeWidth={1.5}
          strokeDasharray="3,3"
        />
        <line
          x1={wallRightX}
          y1={baseY}
          x2={wallRightX}
          y2={baseY + 25}
          stroke="#9ca3af"
          strokeWidth={1.5}
          strokeDasharray="3,3"
        />

        {/* Triangle de toit (chevrons rouges) */}
        <polygon
          points={`${leftEaveX},${baseY} ${cx},${peakY} ${rightEaveX},${baseY}`}
          fill="#fef3c7"
          stroke="#dc2626"
          strokeWidth={2}
        />

        {/* Faitage (bleu - vue de bout) */}
        <circle cx={cx} cy={peakY} r={5} fill="#2563eb" stroke="#1e40af" strokeWidth={1} />

        {/* Cotation rise (verticale) */}
        <line
          x1={cx - 18}
          y1={peakY}
          x2={cx - 18}
          y2={baseY}
          stroke="#0f2942"
          strokeWidth={1}
          markerStart="url(#arr1)"
          markerEnd="url(#arr2)"
        />
        <text
          x={cx - 24}
          y={(peakY + baseY) / 2}
          fontSize={10}
          fill="#0f2942"
          textAnchor="end"
          dominantBaseline="middle"
          fontFamily="sans-serif"
        >
          Rise {formatFraction(rise)}
        </text>

        {/* Cotation span (horizontale base mur) */}
        <line
          x1={wallLeftX}
          y1={baseY + 18}
          x2={wallRightX}
          y2={baseY + 18}
          stroke="#0f2942"
          strokeWidth={1}
        />
        <text
          x={(wallLeftX + wallRightX) / 2}
          y={baseY + 32}
          fontSize={10}
          fill="#0f2942"
          textAnchor="middle"
          fontFamily="sans-serif"
        >
          Span {inchesToFeet(span)}
        </text>

        {/* Cotation rafter (incline gauche) */}
        <text
          x={(leftEaveX + cx) / 2 - 8}
          y={(baseY + peakY) / 2 - 5}
          fontSize={10}
          fill="#dc2626"
          textAnchor="middle"
          fontFamily="sans-serif"
          transform={`rotate(-${pitchAngleDeg} ${(leftEaveX + cx) / 2 - 8} ${(baseY + peakY) / 2 - 5})`}
        >
          Chevron {formatFraction(hypotenuseIn)}
        </text>

        {/* Pente etiquette */}
        <text
          x={cx + 14}
          y={peakY - 8}
          fontSize={11}
          fontWeight="bold"
          fill="#2563eb"
          fontFamily="sans-serif"
        >
          {config.pitch}
        </text>

        {/* Overhang (debord) - segment overhang gauche */}
        {dims.overhangIn > 0 && (
          <>
            <line
              x1={leftEaveX}
              y1={baseY + 5}
              x2={wallLeftX}
              y2={baseY + 5}
              stroke="#16a34a"
              strokeWidth={1.5}
            />
            <text
              x={(leftEaveX + wallLeftX) / 2}
              y={baseY + 14}
              fontSize={8}
              fill="#16a34a"
              textAnchor="middle"
              fontFamily="sans-serif"
            >
              {formatFraction(dims.overhangIn)}
            </text>
          </>
        )}

        {/* Echelle */}
        <text
          x={padding}
          y={svgH - 6}
          fontSize={8}
          fill="#6b7280"
          fontFamily="sans-serif"
        >
          Echelle 1:{(1 / scale).toFixed(0)} (po)
        </text>

        {/* Markers fleche */}
        <defs>
          <marker id="arr1" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#0f2942" />
          </marker>
          <marker id="arr2" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#0f2942" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function ToiturePanel() {
  const [dims, setDims] = useState<ToitureDims>(DEFAULT_DIMS);
  const [config, setConfig] = useState<ToitureConfig>(DEFAULT_CONFIG);
  const [projectName, setProjectName] = useState('Toit residentiel');

  const calc = useMemo(() => computeAllCalculations(dims, config), [dims, config]);
  const pieces = useMemo(() => computeToiture(dims, config), [dims, config]);
  const materials = useMemo(
    () => generateToitureMaterials(pieces, dims, config),
    [pieces, dims, config],
  );
  const validations = useMemo(() => validateToiture(dims, config), [dims, config]);

  const updateDims = <K extends keyof ToitureDims>(k: K, v: ToitureDims[K]) =>
    setDims((d) => ({ ...d, [k]: v }));
  const updateConfig = <K extends keyof ToitureConfig>(k: K, v: ToitureConfig[K]) =>
    setConfig((c) => ({ ...c, [k]: v }));

  const totalRafters = pieces
    .filter((p) => p.category === 'rafter-common' || p.category === 'rafter-pignon')
    .reduce((s, p) => s + p.qty, 0);

  return (
    <div className="max-w-md mx-auto space-y-3">
      {/* Header gradient orange/rouge */}
      <div className="bg-gradient-to-r from-orange-500 to-red-600 rounded-xl p-4 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
            <Home className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full bg-transparent border-none text-white text-lg font-bold placeholder-white/60 focus:outline-none focus:ring-0"
              placeholder="Nom du projet"
              aria-label="Nom du projet"
            />
            <p className="text-xs text-white/80">Calculateur de toiture Quebec</p>
          </div>
        </div>
      </div>

      {/* Indicateur charge neige */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-2.5 flex items-center gap-2">
        <Snowflake className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <div className="flex-1 text-xs text-blue-900 dark:text-blue-200">
          Charge neige : <span className="font-bold">{ZONE_LABELS[config.zone]}</span>
        </div>
      </div>

      {/* ============================== DIMENSIONS ============================== */}
      <Card padding="sm">
        <SectionHeader
          icon={<Ruler className="w-4 h-4" />}
          title="Dimensions"
          subtitle="Faitage, portee, debords"
        />
        <div className="space-y-2">
          {/* Faitage (ridge length) */}
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Faitage (pi)"
              value={dims.ridgeLengthFt}
              onChange={(v) => updateDims('ridgeLengthFt', v)}
              min={0}
              suffix="pi"
            />
            <NumberField
              label="Faitage (po)"
              value={dims.ridgeLengthIn}
              onChange={(v) => updateDims('ridgeLengthIn', v)}
              min={0}
              max={11.99}
              step={0.125}
              suffix="po"
            />
          </div>
          {/* Span (largeur batiment) */}
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Largeur batiment (pi)"
              value={dims.spanFt}
              onChange={(v) => updateDims('spanFt', v)}
              min={0}
              suffix="pi"
            />
            <NumberField
              label="Largeur (po)"
              value={dims.spanIn}
              onChange={(v) => updateDims('spanIn', v)}
              min={0}
              max={11.99}
              step={0.125}
              suffix="po"
            />
          </div>
          {/* Overhangs */}
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Debord avant-toit"
              value={dims.overhangIn}
              onChange={(v) => updateDims('overhangIn', v)}
              min={0}
              max={48}
              step={0.5}
              suffix="po"
            />
            <NumberField
              label="Debord pignon"
              value={dims.overhangPignonIn}
              onChange={(v) => updateDims('overhangPignonIn', v)}
              min={0}
              max={48}
              step={0.5}
              suffix="po"
            />
          </div>
        </div>
      </Card>

      {/* ============================== CONFIGURATION ============================== */}
      <Card padding="sm">
        <SectionHeader
          icon={<Triangle className="w-4 h-4" />}
          title="Configuration"
          subtitle="Type, pente, chevrons"
        />
        <div className="space-y-2">
          {/* Type de toit */}
          <SelectField<ToitureType>
            label="Type de toit"
            value={config.type}
            onChange={(v) => updateConfig('type', v)}
            options={[
              { value: 'gable', label: 'A 2 versants (gable)' },
              { value: 'hip', label: 'A 4 versants (hip)' },
              { value: 'shed', label: 'Mono-pente (shed)' },
            ]}
          />
          {/* Pente */}
          <SelectField<ToiturePitch>
            label="Pente"
            value={config.pitch}
            onChange={(v) => updateConfig('pitch', v)}
            options={[
              { value: '4/12', label: '4/12 (18.4 deg)' },
              { value: '6/12', label: '6/12 (26.6 deg)' },
              { value: '8/12', label: '8/12 (33.7 deg)' },
              { value: '10/12', label: '10/12 (39.8 deg)' },
              { value: '12/12', label: '12/12 (45 deg)' },
            ]}
          />
          {/* Chevrons + espacement */}
          <div className="grid grid-cols-2 gap-2">
            <SelectField<ToitureRafter>
              label="Chevrons"
              value={config.rafterType}
              onChange={(v) => updateConfig('rafterType', v)}
              options={[
                { value: '2x6', label: '2x6' },
                { value: '2x8', label: '2x8' },
                { value: '2x10', label: '2x10' },
                { value: '2-2x10', label: '2x2x10' },
              ]}
            />
            <SelectField<string>
              label="Espacement c/c"
              value={String(config.spacing)}
              onChange={(v) => updateConfig('spacing', parseFloat(v) as ToitureSpacing)}
              options={[
                { value: '16', label: '16 po' },
                { value: '19.2', label: '19.2 po' },
                { value: '24', label: '24 po' },
              ]}
            />
          </div>
          {/* Voligeage */}
          <SelectField<ToitureSheathing>
            label="Voligeage (revetement)"
            value={config.sheathingType}
            onChange={(v) => updateConfig('sheathingType', v)}
            options={[
              { value: 'osb-3/8', label: 'OSB 3/8" (4x8)' },
              { value: 'osb-7/16', label: 'OSB 7/16" (4x8)' },
              { value: 'ply-1/2', label: 'Contreplaque 1/2" (4x8)' },
            ]}
          />
          {/* Zone neige */}
          <SelectField<ToitureZone>
            label="Zone charge neige"
            value={config.zone}
            onChange={(v) => updateConfig('zone', v)}
            options={[
              { value: 'montreal', label: 'Montreal (2.7 kPa)' },
              { value: 'quebec', label: 'Quebec / Saguenay (3.5 kPa)' },
              { value: 'nord', label: 'Nord du Quebec (>4 kPa)' },
            ]}
          />
        </div>
      </Card>

      {/* ============================== TYPE BARDEAU ============================== */}
      <Card padding="sm">
        <SectionHeader
          icon={<Layers className="w-4 h-4" />}
          title="Bardeaux"
          subtitle="Type et couverture"
        />
        <SelectField<ToitureShingle>
          label="Type de bardeau"
          value={config.shingleType}
          onChange={(v) => updateConfig('shingleType', v)}
          options={[
            { value: 'asphalte-25', label: 'Asphalte 25 ans (33.3 ft2/paquet)' },
            { value: 'asphalte-30', label: 'Asphalte 30 ans (32 ft2/paquet)' },
            { value: 'asphalte-50', label: 'Asphalte 50 ans (28 ft2/paquet)' },
          ]}
        />
      </Card>

      {/* ============================== VISUALISATION SVG ============================== */}
      <Card padding="sm">
        <SectionHeader
          icon={<Triangle className="w-4 h-4" />}
          title="Vue coupe pignon"
          subtitle={`Pente ${config.pitch} - rafter ${formatFraction(calc.rafterLengthIn)}`}
        />
        <ToitureSVG dims={dims} config={config} calc={calc} />
      </Card>

      {/* ============================== RESULTATS CALCULS ============================== */}
      <Card padding="sm">
        <SectionHeader
          icon={<Info className="w-4 h-4" />}
          title="Resultats"
          subtitle="Calculs trigonometriques"
        />
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-gray-50 dark:bg-gray-900 rounded p-2">
            <div className="text-gray-500 dark:text-gray-400">Run (course)</div>
            <div className="font-bold text-gray-900 dark:text-white">{formatFraction(calc.run)}</div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-900 rounded p-2">
            <div className="text-gray-500 dark:text-gray-400">Rise (montee)</div>
            <div className="font-bold text-gray-900 dark:text-white">{formatFraction(calc.rise)}</div>
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/20 rounded p-2">
            <div className="text-gray-500 dark:text-gray-400">Hypotenuse</div>
            <div className="font-bold text-orange-700 dark:text-orange-300">
              {formatFraction(calc.hypotenuseIn)}
            </div>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 rounded p-2">
            <div className="text-gray-500 dark:text-gray-400">Chevron (avec debord)</div>
            <div className="font-bold text-red-700 dark:text-red-300">
              {formatFraction(calc.rafterLengthIn)}
            </div>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded p-2 col-span-2">
            <div className="text-gray-500 dark:text-gray-400">Surface toiture</div>
            <div className="font-bold text-blue-700 dark:text-blue-300">
              {calc.surfaceFt2.toFixed(1)} ft<sup>2</sup>
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-900 rounded p-2">
            <div className="text-gray-500 dark:text-gray-400">Perimetre avant-toit</div>
            <div className="font-bold text-gray-900 dark:text-white">
              {calc.perimeterEavesLF.toFixed(1)} pi
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-900 rounded p-2">
            <div className="text-gray-500 dark:text-gray-400">Perimetre pignon</div>
            <div className="font-bold text-gray-900 dark:text-white">
              {calc.perimeterRakeLF.toFixed(1)} pi
            </div>
          </div>
        </div>
      </Card>

      {/* ============================== MATERIAUX ============================== */}
      <Card padding="sm">
        <SectionHeader
          icon={<Layers className="w-4 h-4" />}
          title="Materiaux requis"
          subtitle={`${totalRafters} chevrons - ${materials.shingleBundles.bundles} paquets bardeau`}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-700">
              <tr>
                <th className="px-2 py-1.5 text-left font-bold text-gray-700 dark:text-gray-200">QTE</th>
                <th className="px-2 py-1.5 text-left font-bold text-gray-700 dark:text-gray-200">TAILLE</th>
                <th className="px-2 py-1.5 text-left font-bold text-gray-700 dark:text-gray-200">LONGUEUR</th>
                <th className="px-2 py-1.5 text-left font-bold text-gray-700 dark:text-gray-200">UTILISER</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              <tr className="bg-white dark:bg-gray-800">
                <td className="px-2 py-1.5 font-mono font-bold">{materials.rafters.qty}</td>
                <td className="px-2 py-1.5">{materials.rafters.type}</td>
                <td className="px-2 py-1.5">{formatFraction(materials.rafters.lengthIn)}</td>
                <td className="px-2 py-1.5 text-gray-500">Chevrons communs</td>
              </tr>
              <tr className="bg-gray-50 dark:bg-gray-900/30">
                <td className="px-2 py-1.5 font-mono font-bold">{materials.ridge.qty}</td>
                <td className="px-2 py-1.5">{materials.ridge.type}</td>
                <td className="px-2 py-1.5">{formatFraction(materials.ridge.lengthIn)}</td>
                <td className="px-2 py-1.5 text-gray-500">Faitage</td>
              </tr>
              <tr className="bg-white dark:bg-gray-800">
                <td className="px-2 py-1.5 font-mono font-bold">{materials.fascia.qty}</td>
                <td className="px-2 py-1.5">{materials.fascia.type}</td>
                <td className="px-2 py-1.5">{formatFraction(materials.fascia.lengthIn)}</td>
                <td className="px-2 py-1.5 text-gray-500">Planche de rive</td>
              </tr>
              <tr className="bg-gray-50 dark:bg-gray-900/30">
                <td className="px-2 py-1.5 font-mono font-bold">{materials.sheathingPanels.qty}</td>
                <td className="px-2 py-1.5">{materials.sheathingPanels.sizeIn}</td>
                <td className="px-2 py-1.5">{materials.sheathingPanels.type}</td>
                <td className="px-2 py-1.5 text-gray-500">Voligeage (panneaux)</td>
              </tr>
              <tr className="bg-white dark:bg-gray-800">
                <td className="px-2 py-1.5 font-mono font-bold">{materials.shingleBundles.bundles}</td>
                <td className="px-2 py-1.5">Paquets</td>
                <td className="px-2 py-1.5">{materials.shingleBundles.squares} carres</td>
                <td className="px-2 py-1.5 text-gray-500">Bardeaux {config.shingleType}</td>
              </tr>
              <tr className="bg-gray-50 dark:bg-gray-900/30">
                <td className="px-2 py-1.5 font-mono font-bold">{materials.underlayment.rolls}</td>
                <td className="px-2 py-1.5">Rouleaux</td>
                <td className="px-2 py-1.5">-</td>
                <td className="px-2 py-1.5 text-gray-500">{materials.underlayment.type}</td>
              </tr>
              <tr className="bg-white dark:bg-gray-800">
                <td className="px-2 py-1.5 font-mono font-bold">{materials.dripEdge.pieces}</td>
                <td className="px-2 py-1.5">Pieces</td>
                <td className="px-2 py-1.5">10 pi</td>
                <td className="px-2 py-1.5 text-gray-500">{materials.dripEdge.type}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* ============================== LISTE DE COUPE ============================== */}
      <Card padding="sm">
        <SectionHeader
          icon={<Ruler className="w-4 h-4" />}
          title="Liste de coupe"
          subtitle={`${pieces.length} sections - ${pieces.reduce((s, p) => s + p.qty, 0)} pieces`}
        />
        <div className="space-y-2">
          {/* Groupe : faitage */}
          {pieces.filter((p) => p.category === 'ridge').length > 0 && (
            <CutListGroup title="Chevron de faitage" pieces={pieces.filter((p) => p.category === 'ridge')} color="blue" />
          )}
          {/* Groupe : planches rive */}
          {pieces.filter((p) => p.category === 'fascia').length > 0 && (
            <CutListGroup title="Planche de rive" pieces={pieces.filter((p) => p.category === 'fascia')} color="green" />
          )}
          {/* Groupe : chevrons communs */}
          {pieces.filter((p) => p.category === 'rafter-common' || p.category === 'rafter-pignon').length > 0 && (
            <CutListGroup
              title="Chevron commun"
              pieces={pieces.filter((p) => p.category === 'rafter-common' || p.category === 'rafter-pignon')}
              color="red"
            />
          )}
          {/* Groupe : revetement */}
          {pieces.filter((p) => p.category === 'sheathing').length > 0 && (
            <CutListGroup
              title="Revetement (voligeage)"
              pieces={pieces.filter((p) => p.category === 'sheathing')}
              color="amber"
            />
          )}
        </div>
      </Card>

      {/* ============================== VALIDATIONS ============================== */}
      {validations.length > 0 && (
        <Card padding="sm">
          <SectionHeader
            icon={<AlertCircle className="w-4 h-4" />}
            title="Validations"
            subtitle={`${validations.length} avertissement(s)`}
          />
          <div className="space-y-1.5">
            {validations.map((v, idx) => (
              <div
                key={idx}
                className={`flex gap-2 p-2 rounded text-xs ${
                  v.level === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-700'
                    : v.level === 'error'
                      ? 'bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-200 border border-red-200 dark:border-red-700'
                      : 'bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-200 border border-blue-200 dark:border-blue-700'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">{v.code}</div>
                  <div>{v.message}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================
// CUT LIST GROUP SUB-COMPONENT
// ============================================

interface CutListGroupProps {
  title: string;
  pieces: ToiturePiece[];
  color: 'blue' | 'red' | 'green' | 'amber';
}

function CutListGroup({ title, pieces, color }: CutListGroupProps) {
  const colorClasses: Record<CutListGroupProps['color'], string> = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-200 border-blue-200 dark:border-blue-700',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-200 border-red-200 dark:border-red-700',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-900 dark:text-green-200 border-green-200 dark:border-green-700',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-700',
  };

  return (
    <div className={`rounded border ${colorClasses[color]}`}>
      <div className="px-2 py-1 font-bold text-xs border-b border-current/20">
        {title}
      </div>
      <table className="w-full text-xs">
        <tbody>
          {pieces.map((p) => (
            <tr key={p.id} className="border-t border-current/10">
              <td className="px-2 py-1 font-mono font-bold w-16">{p.label}</td>
              <td className="px-2 py-1 w-16">{p.type}</td>
              <td className="px-2 py-1">{formatFraction(p.lengthIn)}</td>
              <td className="px-2 py-1 text-right pr-2 font-bold">x{p.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
