/**
 * RevetementPanel - Calculateur Revetement Exterieur Quebec
 *
 * Inspiration: Wall Builder Pro mobile app (tab "Revetement" dans modal Rapports)
 *
 * Fonctionnalites:
 * - Saisie dimensions n elevations (max 8) longueur + hauteur
 * - Soustraction ouvertures (portes/fenetres) par elevation
 * - Choix type revetement (planche 1x4/1x6, vinyle 4"/5", Hardie, brique, pierre)
 * - Soffite et fascia separes
 * - Membrane Tyvek HouseWrap (rouleau 9' x 100')
 * - Liste de coupe optimisee (longueurs 8', 10', 12', 14', 16')
 * - Calculs briques modulaires + mortier
 * - Validations CCQ (solins bois, linteau brique > 8')
 *
 * Calcul 100% frontend, format imperial (pieds + pouces).
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle, AlertTriangle, Box, ChevronDown, ChevronUp, Copy, Hammer, Home,
  Info, Layers, Minus, Plus, Trash2,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';

// ============================================
// TYPES
// ============================================

export type RevetementType =
  | 'planche-1x4'
  | 'planche-1x6'
  | 'vinyle-4'
  | 'vinyle-5'
  | 'hardie'
  | 'brique'
  | 'pierre';

export type RevetementDirection = 'horizontale' | 'verticale';
export type MembraneType = 'tyvek' | 'aucune';
export type SoffiteType = 'vinyle' | 'aluminium' | 'bois';
export type FasciaType = '1x6' | '1x8' | 'aluminium';

export interface ElevationOpening {
  id: number;
  type: 'porte' | 'fenetre';
  widthIn: number;
  heightIn: number;
  count: number;
}

export interface ElevationMur {
  id: number;
  label: string;
  lengthFt: number;
  lengthIn: number;
  heightFt: number;
  heightIn: number;
  openings: ElevationOpening[];
}

export interface RevetementConfig {
  type: RevetementType;
  couleur?: string;
  direction: RevetementDirection;
  membraneType: MembraneType;
  soffiteType: SoffiteType;
  fasciaType: FasciaType;
  soffiteAvanceeIn: number;
  fasciaLongueurLF: number;
}

export interface RevetementCutListItem {
  lengthFt: number;
  count: number;
}

export interface RevetementMaterials {
  revetement: {
    type: RevetementType;
    surfaceFt2: number;
    qty: number;
    units: string;
    cutList: RevetementCutListItem[];
  };
  soffite: {
    surfaceFt2: number;
    panels: number;
  };
  fascia: {
    lengthLF: number;
    pieces: number;
  };
  membrane: {
    surfaceFt2: number;
    rolls: number;
  };
  solins: {
    count: number;
    types: string[];
  };
  brique?: {
    briques: number;
    sacsMortier: number;
  };
}

export interface RevetementValidation {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface RevetementSnapshot {
  elevations: ElevationMur[];
  config: RevetementConfig;
  materials: RevetementMaterials;
  totalSurfaceFt2: number;
  totalCost: number;
  projectName: string;
}

// ============================================
// CONSTANTS
// ============================================

// Exposition reelle en pouces par type
export const COVERAGE: Record<RevetementType, number> = {
  'planche-1x4': 3.5,
  'planche-1x6': 5.5,
  'vinyle-4': 4,
  'vinyle-5': 5,
  'hardie': 5.5,
  'brique': 0,
  'pierre': 0,
};

// Pertes / waste par type
export const WASTE_PCT: Record<RevetementType, number> = {
  'planche-1x4': 0.10,
  'planche-1x6': 0.10,
  'vinyle-4': 0.05,
  'vinyle-5': 0.05,
  'hardie': 0.07,
  'brique': 0.08,
  'pierre': 0.08,
};

export const STD_LENGTHS_FT: number[] = [8, 10, 12, 14, 16];

export const TYVEK_ROLL = {
  widthFt: 9,
  lengthFt: 100,
  surfaceFt2: 900,
};

// Brique modulaire : 350 briques par metre carre, mortier 8% volume
export const BRIQUE_PAR_M2 = 350;
const M2_PAR_FT2 = 0.092903;
const BRIQUES_PAR_SAC_MORTIER = 40;

// Prix estimatifs CAD (pour totalCost - approximations marche Quebec)
const PRIX_UNITAIRE: Record<RevetementType, number> = {
  'planche-1x4': 1.85,
  'planche-1x6': 2.45,
  'vinyle-4': 1.95,
  'vinyle-5': 2.10,
  'hardie': 3.85,
  'brique': 0.85,
  'pierre': 12.50,
};

const PRIX_MEMBRANE_ROULEAU = 165.00;
const PRIX_SOFFITE_PANEL = 22.50;
const PRIX_FASCIA_LF = 4.25;
const PRIX_SOLIN = 18.50;
const PRIX_SAC_MORTIER = 14.50;

// ============================================
// DEFAULTS
// ============================================

const DEFAULT_ELEVATION = (id: number, label: string): ElevationMur => ({
  id,
  label,
  lengthFt: 20,
  lengthIn: 0,
  heightFt: 8,
  heightIn: 0,
  openings: [],
});

const DEFAULT_CONFIG: RevetementConfig = {
  type: 'planche-1x6',
  couleur: 'Naturel',
  direction: 'horizontale',
  membraneType: 'tyvek',
  soffiteType: 'vinyle',
  fasciaType: '1x6',
  soffiteAvanceeIn: 16,
  fasciaLongueurLF: 0,
};

// ============================================
// HELPERS PURS (EXPORTES)
// ============================================

/**
 * Format fraction 16e d'un nombre decimal en pouces.
 * Ex: 5.5 -> 5 1/2", 3.5 -> 3 1/2", 0.25 -> 1/4"
 */
export function formatFraction(decimal: number): string {
  if (decimal == null || isNaN(decimal)) return '0"';
  const sign = decimal < 0 ? '-' : '';
  const abs = Math.abs(decimal);
  const whole = Math.floor(abs);
  const frac = abs - whole;
  const sixteenths = Math.round(frac * 16);
  if (sixteenths === 0) return `${sign}${whole}"`;
  if (sixteenths === 16) return `${sign}${whole + 1}"`;
  let num = sixteenths;
  let den = 16;
  while (num % 2 === 0 && den % 2 === 0) { num /= 2; den /= 2; }
  return whole === 0 ? `${sign}${num}/${den}"` : `${sign}${whole} ${num}/${den}"`;
}

/**
 * Convertit pieds + pouces en pouces totaux.
 */
function toInches(ft: number, inch: number): number {
  return (ft || 0) * 12 + (inch || 0);
}

/**
 * Convertit pieds + pouces en pieds decimaux.
 */
function toFeet(ft: number, inch: number): number {
  return (ft || 0) + (inch || 0) / 12;
}

/**
 * Calcule la surface nette ft2 d'une elevation (deduction ouvertures).
 * Retourne {surfaceFt2, openingsExceedWall} pour detecter saisie incoherente.
 */
export function computeElevationSurfaceDetail(el: ElevationMur): {
  surfaceFt2: number;
  grossFt2: number;
  openingsFt2: number;
  openingsExceedWall: boolean;
} {
  const Lft = toFeet(el.lengthFt, el.lengthIn);
  const Hft = toFeet(el.heightFt, el.heightIn);
  const gross = Math.max(0, Lft * Hft);
  const openings = (el.openings || []).reduce((sum, op) => {
    const wFt = (op.widthIn || 0) / 12;
    const hFt = (op.heightIn || 0) / 12;
    return sum + wFt * hFt * Math.max(0, op.count || 0);
  }, 0);
  return {
    surfaceFt2: Math.max(0, gross - openings),
    grossFt2: gross,
    openingsFt2: openings,
    openingsExceedWall: openings > gross && gross > 0,
  };
}

export function computeElevationSurface(el: ElevationMur): number {
  return computeElevationSurfaceDetail(el).surfaceFt2;
}

/**
 * Calcule briques + sacs de mortier pour surface en ft2.
 * 350 briques/m2, mortier 8% volume -> ~40 briques par sac de mortier.
 */
export function computeBrickCount(surfaceFt2: number): {
  briques: number;
  sacsMortier: number;
} {
  const surfaceM2 = Math.max(0, surfaceFt2) * M2_PAR_FT2;
  const briquesPosees = Math.ceil(surfaceM2 * BRIQUE_PAR_M2);
  const briques = Math.ceil(briquesPosees * (1 + WASTE_PCT['brique']));
  // Mortier base sur briques posees (sans waste), pas sur briques achetees
  const sacsMortier = Math.ceil(briquesPosees / BRIQUES_PAR_SAC_MORTIER);
  return { briques, sacsMortier };
}

/**
 * Optimisation liste de coupe par longueur standard.
 * Algorithme: priorise les longueurs les plus longues qui generent moins de joints.
 * Retourne le nombre de planches par longueur standard.
 *
 * surfaceNeeded: surface ft2 a couvrir
 * expoIn: exposition reelle en pouces
 * lengthsFt: longueurs standards disponibles
 */
export function optimizeCutList(
  surfaceNeeded: number,
  expoIn: number,
  lengthsFt: number[] = STD_LENGTHS_FT,
): { length: number; count: number }[] {
  if (surfaceNeeded <= 0 || expoIn <= 0) return [];
  const expoFt = expoIn / 12;
  // Pieds lineaires totaux requis = surface / exposition en pieds
  const totalLF = surfaceNeeded / expoFt;
  // Distribution: priorise les longueurs les plus longues (moins de joints)
  const sortedLengths = [...lengthsFt].sort((a, b) => b - a);
  const result: { length: number; count: number }[] = [];
  let remainingLF = totalLF;
  // Repartition: poids appliques sur remainingLF (auto-balancing pour eviter excedent)
  // Defaut 40/25/15/10/10 sur 5 longueurs, ajuste pour autres tailles
  const baseWeights = sortedLengths.length === 5
    ? [0.40, 0.30, 0.20, 0.10, 0.10]
    : sortedLengths.map(() => 1 / sortedLengths.length);
  for (let i = 0; i < sortedLengths.length; i++) {
    const len = sortedLengths[i];
    if (remainingLF <= 0) {
      result.push({ length: len, count: 0 });
      continue;
    }
    const isLast = i === sortedLengths.length - 1;
    // Poids applique sur remainingLF (pas totalLF) pour eviter excedent compose
    const lfThis = isLast ? remainingLF : remainingLF * (baseWeights[i] || 0.5);
    const count = Math.ceil(lfThis / len);
    result.push({ length: len, count });
    remainingLF -= count * len;
  }
  return result.sort((a, b) => a.length - b.length);
}

/**
 * Calcule le perimetre total de toit (somme des longueurs murs externes).
 */
function computePerimeterFt(elevations: ElevationMur[]): number {
  return elevations.reduce((sum, el) => sum + toFeet(el.lengthFt, el.lengthIn), 0);
}

/**
 * Calcul principal: tous les materiaux pour les elevations + config.
 */
export function computeRevetement(
  elevations: ElevationMur[],
  config: RevetementConfig,
): RevetementMaterials {
  // Surface nette totale revetement
  const surfaceNetFt2 = elevations.reduce((s, el) => s + computeElevationSurface(el), 0);
  const wastePct = WASTE_PCT[config.type] ?? 0.10;
  const surfaceAvecPertes = surfaceNetFt2 * (1 + wastePct);

  // Calcul qty selon type
  let qty = 0;
  let units = '';
  let cutList: RevetementCutListItem[] = [];

  if (config.type === 'planche-1x4' || config.type === 'planche-1x6' || config.type === 'hardie') {
    const expoIn = COVERAGE[config.type];
    // Pieds lineaires = surface (ft2) * 12 / expoIn
    const linearFt = surfaceAvecPertes * 12 / expoIn;
    qty = Math.ceil(linearFt);
    units = 'pi lineaires';
    const cuts = optimizeCutList(surfaceAvecPertes, expoIn, STD_LENGTHS_FT);
    cutList = cuts.map((c) => ({ lengthFt: c.length, count: c.count }));
  } else if (config.type === 'vinyle-4' || config.type === 'vinyle-5') {
    // Vinyle vendu au carre (200 ft2 par carre standard CCMC)
    const carres = surfaceAvecPertes / 200;
    qty = Math.ceil(carres * 10) / 10; // arrondi 0.1
    units = 'carres (200 ft2)';
  } else if (config.type === 'brique') {
    const bc = computeBrickCount(surfaceNetFt2);
    qty = bc.briques;
    units = 'briques';
  } else if (config.type === 'pierre') {
    qty = Math.ceil(surfaceAvecPertes);
    units = 'ft2';
  }

  // Soffite
  const perimeter = computePerimeterFt(elevations);
  const avanceeFt = (config.soffiteAvanceeIn || 0) / 12;
  const soffiteSurfaceFt2 = perimeter * avanceeFt;
  const PANEL_COVERAGE = 16; // ft2 par panneau soffite typique (12" x 16')
  const soffitePanels = Math.ceil(soffiteSurfaceFt2 / PANEL_COVERAGE);

  // Fascia
  const fasciaLF = config.fasciaLongueurLF > 0 ? config.fasciaLongueurLF : perimeter;
  const fasciaUnitFt = config.fasciaType === 'aluminium' ? 12 : 16;
  const fasciaPieces = Math.ceil(fasciaLF / fasciaUnitFt);

  // Membrane Tyvek
  let membraneRolls = 0;
  let membraneSurfaceFt2 = 0;
  if (config.membraneType === 'tyvek') {
    membraneSurfaceFt2 = surfaceNetFt2 * 1.10;
    membraneRolls = Math.ceil(membraneSurfaceFt2 / TYVEK_ROLL.surfaceFt2);
  }

  // Solins (flashing): portes = tete + base (x2), fenetres = tete + base + 2 cotes (x4) selon CCQ
  const solinsCount = elevations.reduce((s, el) => {
    return s + (el.openings || []).reduce((ss, op) => {
      const multiplier = op.type === 'fenetre' ? 4 : 2;
      return ss + op.count * multiplier;
    }, 0);
  }, 0);
  const solinsTypes: string[] = [];
  const hasPortes = elevations.some((el) => el.openings.some((op) => op.type === 'porte' && op.count > 0));
  const hasFenetres = elevations.some((el) => el.openings.some((op) => op.type === 'fenetre' && op.count > 0));
  if (hasPortes) solinsTypes.push('Solin de tete porte (alu)');
  if (hasFenetres) solinsTypes.push('Solin tete + appui fenetre (alu)');

  const materials: RevetementMaterials = {
    revetement: {
      type: config.type,
      surfaceFt2: Math.round(surfaceNetFt2 * 10) / 10,
      qty,
      units,
      cutList,
    },
    soffite: {
      surfaceFt2: Math.round(soffiteSurfaceFt2 * 10) / 10,
      panels: soffitePanels,
    },
    fascia: {
      lengthLF: Math.round(fasciaLF * 10) / 10,
      pieces: fasciaPieces,
    },
    membrane: {
      surfaceFt2: Math.round(membraneSurfaceFt2 * 10) / 10,
      rolls: membraneRolls,
    },
    solins: {
      count: solinsCount,
      types: solinsTypes,
    },
  };

  if (config.type === 'brique') {
    materials.brique = computeBrickCount(surfaceNetFt2);
  }

  return materials;
}

/**
 * Calcule cout total estimatif CAD a partir des materiaux.
 */
export function computeTotalCost(materials: RevetementMaterials, config: RevetementConfig): number {
  let total = 0;
  // Revetement principal
  const prixUnit = PRIX_UNITAIRE[config.type];
  total += materials.revetement.qty * prixUnit;
  // Soffite
  total += materials.soffite.panels * PRIX_SOFFITE_PANEL;
  // Fascia
  total += materials.fascia.lengthLF * PRIX_FASCIA_LF;
  // Membrane
  total += materials.membrane.rolls * PRIX_MEMBRANE_ROULEAU;
  // Solins
  total += materials.solins.count * PRIX_SOLIN;
  // Mortier brique
  if (materials.brique) {
    total += materials.brique.sacsMortier * PRIX_SAC_MORTIER;
  }
  return Math.round(total * 100) / 100;
}

/**
 * Validations metier (avertissements CCQ).
 */
export function validateRevetement(
  elevations: ElevationMur[],
  config: RevetementConfig,
  materials: RevetementMaterials,
): RevetementValidation[] {
  const out: RevetementValidation[] = [];
  // Linteau structurel brique > 8'
  if (config.type === 'brique') {
    const tooTall = elevations.some((el) => toFeet(el.heightFt, el.heightIn) > 8);
    if (tooTall) {
      out.push({
        level: 'warning',
        code: 'BRIQUE_HAUTEUR',
        message: 'Hauteur > 8 pi avec brique : prevoir linteau structurel (acier ou beton arme).',
      });
    }
  }
  // Surface < 100 ft2 et membrane Tyvek
  if (materials.revetement.surfaceFt2 < 100 && config.membraneType === 'tyvek') {
    out.push({
      level: 'info',
      code: 'MEMBRANE_PETITE_SURFACE',
      message: 'Surface < 100 ft2 : un rouleau Tyvek 900 ft2 est surdimensionne, envisager un demi-rouleau.',
    });
  }
  // Solins obligatoires si planche bois (CCQ)
  if ((config.type === 'planche-1x4' || config.type === 'planche-1x6') && materials.solins.count === 0) {
    const aDesOuvertures = elevations.some((el) => el.openings.some((op) => op.count > 0));
    if (aDesOuvertures) {
      out.push({
        level: 'error',
        code: 'SOLINS_BOIS_CCQ',
        message: 'Planche bois : solins obligatoires aux ouvertures (CCQ - drainage humidite).',
      });
    } else {
      out.push({
        level: 'info',
        code: 'SOLINS_BOIS_CCQ',
        message: 'Planche bois : verifier solins aux jonctions toiture / fondation (CCQ).',
      });
    }
  }
  // Surface revetement nulle
  if (materials.revetement.surfaceFt2 <= 0) {
    out.push({
      level: 'error',
      code: 'SURFACE_NULLE',
      message: 'Surface nette nulle : verifier dimensions des elevations.',
    });
  }
  return out;
}

// ============================================
// LIBELLES UI
// ============================================

const TYPE_LABELS: Record<RevetementType, string> = {
  'planche-1x4': 'Planche 1x4',
  'planche-1x6': 'Planche 1x6',
  'vinyle-4': 'Declin vinyle 4"',
  'vinyle-5': 'Declin vinyle 5"',
  'hardie': 'Fibrociment Hardie',
  'brique': 'Brique modulaire',
  'pierre': 'Pierre',
};

const TYPE_DESCRIPTIONS: Record<RevetementType, string> = {
  'planche-1x4': 'Epinette ou pin, exposition 3 1/2"',
  'planche-1x6': 'Epinette ou pin, exposition 5 1/2"',
  'vinyle-4': 'Profil declin standard, expo 4"',
  'vinyle-5': 'Profil declin large, expo 5"',
  'hardie': 'Fibrociment HardiePlank, expo 5 1/2"',
  'brique': '350 briques/m2 + mortier 8%',
  'pierre': 'Pierre naturelle ou manufacturee',
};

const SOFFITE_LABELS: Record<SoffiteType, string> = {
  'vinyle': 'Vinyle ventile',
  'aluminium': 'Aluminium ventile',
  'bois': 'Bois (cedre / pin)',
};

const FASCIA_LABELS: Record<FasciaType, string> = {
  '1x6': '1x6 bois (16\')',
  '1x8': '1x8 bois (16\')',
  'aluminium': 'Aluminium pre-fini (12\')',
};

// ============================================
// HELPERS UI INTERNES
// ============================================

interface CollapsibleSectionProps {
  title: string;
  icon?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function CollapsibleSection({ title, icon, expanded, onToggle, children }: CollapsibleSectionProps) {
  return (
    <Card padding="sm" className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {expanded && <div className="space-y-2">{children}</div>}
    </Card>
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
  className?: string;
}

function NumberField({ label, value, onChange, min = 0, max = 999, step = 1, suffix, className = '' }: NumberFieldProps) {
  return (
    <div className={`flex-1 ${className}`}>
      <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange(Number.isFinite(v) ? v : 0);
          }}
          min={min}
          max={max}
          step={step}
          className="w-full px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:border-teal-500"
        />
        {suffix && (
          <span className="text-xs text-gray-500 dark:text-gray-400">{suffix}</span>
        )}
      </div>
    </div>
  );
}

interface TypeCardProps {
  type: RevetementType;
  selected: boolean;
  onSelect: () => void;
}

function TypeCard({ type, selected, onSelect }: TypeCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`p-2.5 rounded-lg border-2 text-left transition ${
        selected
          ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20 shadow-sm'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-teal-300'
      }`}
    >
      <div className="text-xs font-bold text-gray-900 dark:text-white">{TYPE_LABELS[type]}</div>
      <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{TYPE_DESCRIPTIONS[type]}</div>
    </button>
  );
}

// ============================================
// COMPOSANT PRINCIPAL
// ============================================

export default function RevetementPanel() {
  const [projectName, setProjectName] = useState<string>('Revetement exterieur');
  const [elevations, setElevations] = useState<ElevationMur[]>([
    DEFAULT_ELEVATION(1, 'Mur Nord'),
    DEFAULT_ELEVATION(2, 'Mur Est'),
    DEFAULT_ELEVATION(3, 'Mur Sud'),
    DEFAULT_ELEVATION(4, 'Mur Ouest'),
  ]);
  const [config, setConfig] = useState<RevetementConfig>(DEFAULT_CONFIG);
  const [currentElIdx, setCurrentElIdx] = useState<number>(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['cutlist']));

  // ===== Calculs derives =====
  const materials = useMemo(() => computeRevetement(elevations, config), [elevations, config]);
  const totalCost = useMemo(() => computeTotalCost(materials, config), [materials, config]);
  const validations = useMemo(() => validateRevetement(elevations, config, materials), [elevations, config, materials]);
  const totalSurfaceFt2 = materials.revetement.surfaceFt2;

  const currentEl = elevations[currentElIdx];

  // ===== Helpers UI =====
  const toggleSection = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateElevation = (idx: number, patch: Partial<ElevationMur>) => {
    setElevations((prev) => prev.map((el, i) => (i === idx ? { ...el, ...patch } : el)));
  };

  const addElevation = () => {
    if (elevations.length >= 8) return;
    const nextId = Math.max(0, ...elevations.map((e) => e.id)) + 1;
    const next = DEFAULT_ELEVATION(nextId, `Mur ${nextId}`);
    setElevations((prev) => [...prev, next]);
    setCurrentElIdx(elevations.length);
  };

  const removeElevation = (idx: number) => {
    if (elevations.length <= 1) return;
    setElevations((prev) => prev.filter((_, i) => i !== idx));
    setCurrentElIdx((cur) => Math.max(0, Math.min(cur, elevations.length - 2)));
  };

  const duplicateElevation = (idx: number) => {
    if (elevations.length >= 8) return;
    const src = elevations[idx];
    const nextId = Math.max(0, ...elevations.map((e) => e.id)) + 1;
    const copy: ElevationMur = {
      ...src,
      id: nextId,
      label: `${src.label} (copie)`,
      openings: src.openings.map((op, i) => ({ ...op, id: i + 1 })),
    };
    setElevations((prev) => [...prev, copy]);
  };

  const addOpening = (elIdx: number, type: 'porte' | 'fenetre') => {
    const el = elevations[elIdx];
    const nextId = Math.max(0, ...el.openings.map((o) => o.id)) + 1;
    const defaults: ElevationOpening = type === 'porte'
      ? { id: nextId, type, widthIn: 36, heightIn: 80, count: 1 }
      : { id: nextId, type, widthIn: 36, heightIn: 48, count: 1 };
    updateElevation(elIdx, { openings: [...el.openings, defaults] });
  };

  const updateOpening = (elIdx: number, opIdx: number, patch: Partial<ElevationOpening>) => {
    const el = elevations[elIdx];
    const newOpenings = el.openings.map((op, i) => (i === opIdx ? { ...op, ...patch } : op));
    updateElevation(elIdx, { openings: newOpenings });
  };

  const removeOpening = (elIdx: number, opIdx: number) => {
    const el = elevations[elIdx];
    updateElevation(elIdx, { openings: el.openings.filter((_, i) => i !== opIdx) });
  };

  // ===== Surface brute par elevation (pour affichage) =====
  const elevationSurfaceFt2 = computeElevationSurface(currentEl);

  return (
    <div className="max-w-md mx-auto space-y-3">
      {/* Header gradient teal/cyan */}
      <div className="rounded-xl bg-gradient-to-r from-teal-600 via-cyan-600 to-teal-700 p-4 shadow-md">
        <div className="flex items-center gap-2 mb-1">
          <Home className="w-5 h-5 text-white" />
          <h2 className="font-bold text-white text-base">Revetement exterieur</h2>
        </div>
        <p className="text-xs text-teal-50">Calcul materiaux Quebec : planche, vinyle, Hardie, brique, pierre</p>
      </div>

      {/* Projet */}
      <Card padding="sm" className="space-y-2">
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="Nom du projet"
          aria-label="Nom du projet"
          className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:outline-none focus:border-teal-500"
        />
      </Card>

      {/* Elevations tabs */}
      <Card padding="sm" className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
            Elevations ({elevations.length}/8)
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => duplicateElevation(currentElIdx)}
              disabled={elevations.length >= 8}
              className="px-2 py-1 text-[10px] font-semibold rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              aria-label="Dupliquer elevation"
            >
              <Copy className="w-3 h-3" /> Copier
            </button>
            <button
              type="button"
              onClick={addElevation}
              disabled={elevations.length >= 8}
              className="px-2 py-1 text-[10px] font-semibold rounded bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 hover:bg-teal-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              aria-label="Ajouter elevation"
            >
              <Plus className="w-3 h-3" /> Ajouter
            </button>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
          {elevations.map((el, idx) => (
            <button
              key={el.id}
              type="button"
              onClick={() => setCurrentElIdx(idx)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition flex items-center gap-1.5 shrink-0 ${
                idx === currentElIdx
                  ? 'bg-teal-600 text-white shadow'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              <span>{el.label}</span>
              {idx === currentElIdx && elevations.length > 1 && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Supprimer cette elevation"
                  onClick={(e) => { e.stopPropagation(); removeElevation(idx); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      removeElevation(idx);
                    }
                  }}
                  className="hover:bg-white/20 rounded p-0.5 cursor-pointer"
                >
                  <Minus className="w-3 h-3" />
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Renommer */}
        <input
          type="text"
          value={currentEl.label}
          onChange={(e) => updateElevation(currentElIdx, { label: e.target.value })}
          placeholder="Nom de l'elevation"
          aria-label="Nom de l'elevation courante"
          className="w-full px-2 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-xs font-mono text-gray-700 dark:text-gray-300 focus:outline-none focus:border-teal-500"
        />
      </Card>

      {/* Dimensions elevation courante */}
      <Card padding="sm" className="space-y-2.5">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-teal-600" />
          <span className="text-sm font-semibold text-gray-900 dark:text-white">Dimensions</span>
          <span className="ml-auto text-[10px] text-gray-500 dark:text-gray-400">
            Surface : {elevationSurfaceFt2.toFixed(1)} ft2
          </span>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">Longueur</div>
          <div className="flex gap-2">
            <NumberField
              label="Pi"
              value={currentEl.lengthFt}
              onChange={(v) => updateElevation(currentElIdx, { lengthFt: v })}
              min={0}
              max={200}
              step={1}
            />
            <NumberField
              label="Po"
              value={currentEl.lengthIn}
              onChange={(v) => updateElevation(currentElIdx, { lengthIn: v })}
              min={0}
              max={11}
              step={0.5}
            />
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">Hauteur</div>
          <div className="flex gap-2">
            <NumberField
              label="Pi"
              value={currentEl.heightFt}
              onChange={(v) => updateElevation(currentElIdx, { heightFt: v })}
              min={0}
              max={40}
              step={1}
            />
            <NumberField
              label="Po"
              value={currentEl.heightIn}
              onChange={(v) => updateElevation(currentElIdx, { heightIn: v })}
              min={0}
              max={11}
              step={0.5}
            />
          </div>
        </div>
      </Card>

      {/* Ouvertures */}
      <CollapsibleSection
        title={`Ouvertures (${currentEl.openings.length})`}
        icon={<Box className="w-4 h-4 text-teal-600" />}
        expanded={!collapsed.has('openings')}
        onToggle={() => toggleSection('openings')}
      >
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => addOpening(currentElIdx, 'porte')}
            className="flex-1 py-1.5 text-[11px] font-semibold rounded bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 hover:bg-teal-100 flex items-center justify-center gap-1 transition"
          >
            <Plus className="w-3 h-3" /> Porte
          </button>
          <button
            type="button"
            onClick={() => addOpening(currentElIdx, 'fenetre')}
            className="flex-1 py-1.5 text-[11px] font-semibold rounded bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 flex items-center justify-center gap-1 transition"
          >
            <Plus className="w-3 h-3" /> Fenetre
          </button>
        </div>

        {currentEl.openings.length === 0 && (
          <div className="text-center py-2 text-[11px] text-gray-500 dark:text-gray-400 italic">
            Aucune ouverture
          </div>
        )}

        {currentEl.openings.map((op, opIdx) => (
          <div key={op.id} className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 capitalize">
                {op.type === 'porte' ? 'Porte' : 'Fenetre'} #{op.id}
              </span>
              <button
                type="button"
                onClick={() => removeOpening(currentElIdx, opIdx)}
                className="p-0.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                aria-label="Supprimer ouverture"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <NumberField
                label="Larg (po)"
                value={op.widthIn}
                onChange={(v) => updateOpening(currentElIdx, opIdx, { widthIn: v })}
                min={0}
                max={120}
                step={1}
              />
              <NumberField
                label="Haut (po)"
                value={op.heightIn}
                onChange={(v) => updateOpening(currentElIdx, opIdx, { heightIn: v })}
                min={0}
                max={120}
                step={1}
              />
              <NumberField
                label="Qte"
                value={op.count}
                onChange={(v) => updateOpening(currentElIdx, opIdx, { count: v })}
                min={1}
                max={20}
                step={1}
              />
            </div>
          </div>
        ))}
      </CollapsibleSection>

      {/* Type revetement */}
      <CollapsibleSection
        title="Type de revetement"
        icon={<Hammer className="w-4 h-4 text-teal-600" />}
        expanded={!collapsed.has('type')}
        onToggle={() => toggleSection('type')}
      >
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(TYPE_LABELS) as RevetementType[]).map((t) => (
            <TypeCard
              key={t}
              type={t}
              selected={config.type === t}
              onSelect={() => setConfig((c) => ({ ...c, type: t }))}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">Direction</label>
            <select
              value={config.direction}
              onChange={(e) => setConfig((c) => ({ ...c, direction: e.target.value as RevetementDirection }))}
              className="w-full px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:border-teal-500"
            >
              <option value="horizontale">Horizontale</option>
              <option value="verticale">Verticale</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">Couleur</label>
            <input
              type="text"
              value={config.couleur || ''}
              onChange={(e) => setConfig((c) => ({ ...c, couleur: e.target.value }))}
              placeholder="Ex: Naturel, Blanc"
              className="w-full px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:border-teal-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">Membrane</label>
          <select
            value={config.membraneType}
            onChange={(e) => setConfig((c) => ({ ...c, membraneType: e.target.value as MembraneType }))}
            className="w-full px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:border-teal-500"
          >
            <option value="tyvek">Tyvek HouseWrap (9'x100')</option>
            <option value="aucune">Aucune</option>
          </select>
        </div>
      </CollapsibleSection>

      {/* Soffite + Fascia */}
      <CollapsibleSection
        title="Soffite + Fascia"
        icon={<Layers className="w-4 h-4 text-teal-600" />}
        expanded={!collapsed.has('soffite')}
        onToggle={() => toggleSection('soffite')}
      >
        <div>
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">Type soffite</label>
          <select
            value={config.soffiteType}
            onChange={(e) => setConfig((c) => ({ ...c, soffiteType: e.target.value as SoffiteType }))}
            className="w-full px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:border-teal-500"
          >
            {(Object.keys(SOFFITE_LABELS) as SoffiteType[]).map((t) => (
              <option key={t} value={t}>{SOFFITE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        <NumberField
          label="Avancee toit (po)"
          value={config.soffiteAvanceeIn}
          onChange={(v) => setConfig((c) => ({ ...c, soffiteAvanceeIn: v }))}
          min={0}
          max={48}
          step={1}
          suffix="po"
        />

        <div>
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">Type fascia</label>
          <select
            value={config.fasciaType}
            onChange={(e) => setConfig((c) => ({ ...c, fasciaType: e.target.value as FasciaType }))}
            className="w-full px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:border-teal-500"
          >
            {(Object.keys(FASCIA_LABELS) as FasciaType[]).map((t) => (
              <option key={t} value={t}>{FASCIA_LABELS[t]}</option>
            ))}
          </select>
        </div>

        <NumberField
          label="Fascia LF (0 = perimetre auto)"
          value={config.fasciaLongueurLF}
          onChange={(v) => setConfig((c) => ({ ...c, fasciaLongueurLF: v }))}
          min={0}
          max={2000}
          step={1}
          suffix="pi"
        />
      </CollapsibleSection>

      {/* Validations */}
      {validations.length > 0 && (
        <Card padding="sm" className="space-y-2">
          {validations.map((v, i) => {
            const isError = v.level === 'error';
            const isWarn = v.level === 'warning';
            const Icon = isError ? AlertCircle : isWarn ? AlertTriangle : Info;
            const colorClass = isError
              ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800'
              : isWarn
                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800'
                : 'bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800';
            return (
              <div key={`${v.code}-${i}`} className={`p-2 rounded-md border text-[11px] flex items-start gap-1.5 ${colorClass}`}>
                <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{v.message}</span>
              </div>
            );
          })}
        </Card>
      )}

      {/* Resultats - Tableau materiaux */}
      <Card padding="sm" className="space-y-3 bg-gradient-to-br from-teal-50 to-cyan-50 dark:from-teal-900/10 dark:to-cyan-900/10 border-teal-200 dark:border-teal-800">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-gray-900 dark:text-white">Materiaux</span>
          <span className="text-xs font-semibold text-teal-700 dark:text-teal-300">
            {totalSurfaceFt2.toFixed(1)} ft2 nets
          </span>
        </div>

        {/* Revetement */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-2.5 space-y-1.5">
          <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-1.5">
            <span className="text-xs font-bold text-gray-900 dark:text-white">Revetement</span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">{TYPE_LABELS[config.type]}</span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[11px]">
            <span className="text-gray-600 dark:text-gray-400">Surface nette</span>
            <span className="text-right font-mono text-gray-900 dark:text-white">{materials.revetement.surfaceFt2.toFixed(1)} ft2</span>
            <span className="text-gray-600 dark:text-gray-400">Quantite</span>
            <span className="text-right font-mono font-bold text-teal-700 dark:text-teal-300">
              {materials.revetement.qty} {materials.revetement.units}
            </span>
          </div>
        </div>

        {/* Liste de coupe */}
        {materials.revetement.cutList.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-2.5">
            <button
              type="button"
              onClick={() => toggleSection('cutlist')}
              className="w-full flex items-center justify-between"
            >
              <span className="text-xs font-bold text-gray-900 dark:text-white">Liste de coupe</span>
              {collapsed.has('cutlist') ? (
                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
              )}
            </button>
            {!collapsed.has('cutlist') && (
              <div className="mt-2 grid grid-cols-5 gap-1 text-[10px]">
                {materials.revetement.cutList.map((item) => (
                  <div key={item.lengthFt} className="text-center bg-gray-50 dark:bg-gray-900 rounded p-1">
                    <div className="font-bold text-teal-700 dark:text-teal-300">{item.lengthFt}'</div>
                    <div className="text-gray-700 dark:text-gray-300">{item.count}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Brique (si applicable) */}
        {materials.brique && (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-2.5 space-y-1">
            <div className="text-xs font-bold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-1.5">Brique modulaire</div>
            <div className="grid grid-cols-2 gap-1 text-[11px]">
              <span className="text-gray-600 dark:text-gray-400">Briques (+8%)</span>
              <span className="text-right font-mono text-gray-900 dark:text-white">{materials.brique.briques}</span>
              <span className="text-gray-600 dark:text-gray-400">Sacs mortier</span>
              <span className="text-right font-mono text-gray-900 dark:text-white">{materials.brique.sacsMortier}</span>
            </div>
          </div>
        )}

        {/* Soffite */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-2.5 space-y-1">
          <div className="text-xs font-bold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-1.5">Soffite</div>
          <div className="grid grid-cols-2 gap-1 text-[11px]">
            <span className="text-gray-600 dark:text-gray-400">Surface</span>
            <span className="text-right font-mono text-gray-900 dark:text-white">{materials.soffite.surfaceFt2.toFixed(1)} ft2</span>
            <span className="text-gray-600 dark:text-gray-400">Panneaux</span>
            <span className="text-right font-mono text-gray-900 dark:text-white">{materials.soffite.panels}</span>
          </div>
        </div>

        {/* Fascia */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-2.5 space-y-1">
          <div className="text-xs font-bold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-1.5">Fascia</div>
          <div className="grid grid-cols-2 gap-1 text-[11px]">
            <span className="text-gray-600 dark:text-gray-400">Longueur LF</span>
            <span className="text-right font-mono text-gray-900 dark:text-white">{materials.fascia.lengthLF.toFixed(1)} pi</span>
            <span className="text-gray-600 dark:text-gray-400">Pieces</span>
            <span className="text-right font-mono text-gray-900 dark:text-white">{materials.fascia.pieces}</span>
          </div>
        </div>

        {/* Membrane */}
        {config.membraneType === 'tyvek' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-2.5 space-y-1">
            <div className="text-xs font-bold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-1.5">Membrane Tyvek</div>
            <div className="grid grid-cols-2 gap-1 text-[11px]">
              <span className="text-gray-600 dark:text-gray-400">Surface (+10%)</span>
              <span className="text-right font-mono text-gray-900 dark:text-white">{materials.membrane.surfaceFt2.toFixed(1)} ft2</span>
              <span className="text-gray-600 dark:text-gray-400">Rouleaux 9'x100'</span>
              <span className="text-right font-mono text-gray-900 dark:text-white">{materials.membrane.rolls}</span>
            </div>
          </div>
        )}

        {/* Solins */}
        {materials.solins.count > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-2.5 space-y-1">
            <div className="text-xs font-bold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-1.5">Solins (flashing)</div>
            <div className="grid grid-cols-2 gap-1 text-[11px]">
              <span className="text-gray-600 dark:text-gray-400">Quantite totale</span>
              <span className="text-right font-mono text-gray-900 dark:text-white">{materials.solins.count}</span>
            </div>
            {materials.solins.types.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {materials.solins.types.map((t, i) => (
                  <li key={i} className="text-[10px] text-gray-600 dark:text-gray-400">- {t}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Total */}
        <div className="bg-teal-600 dark:bg-teal-700 rounded-lg p-3 flex items-center justify-between">
          <span className="text-xs font-bold text-white">Cout estimatif</span>
          <span className="text-lg font-bold text-white font-mono">
            {totalCost.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $
          </span>
        </div>
      </Card>
    </div>
  );
}
