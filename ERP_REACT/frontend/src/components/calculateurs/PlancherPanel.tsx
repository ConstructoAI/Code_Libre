/**
 * PlancherPanel - Calculateur de plancher (solives + sous-plancher)
 *
 * Inspiration: Wall Builder Pro - module Planchers
 *
 * Fonctionnalites:
 * - Saisie dimensions en pieds + pouces (longueur, largeur, hauteur libre)
 * - Choix type solive (2x8, 2x10, 2x12, double 2x10, I-joist 9.5/11.875)
 * - Espacement 16" / 19.2" / 24" centre a centre
 * - Direction solives (horizontale = paralleles a longueur, verticale = paralleles a largeur)
 * - Gestion ouvertures (escalier, trappe)
 * - Calcul automatique : surface, perimetre, qte solives, qte panneaux sous-plancher
 * - Liste de coupe etiquetage J1...Jxx
 * - Visualisation SVG 2D (vue de dessus)
 * - Tableau materiaux (qte / taille / longueur / utiliser)
 * - Avertissements de portee (CNB) pour 2x10
 *
 * Calcul 100% frontend, format imperial (pouces + fractions 16e).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronUp, FileText, Layers, Plus, Ruler, Trash2,
} from 'lucide-react';
import clsx from 'clsx';

// ============================================
// TYPES
// ============================================

export type PlancherJoistType = '2x8' | '2x10' | '2x12' | '2-2x10' | 'I-joist-9.5' | 'I-joist-11.875';
export type PlancherSpacing = 16 | 19.2 | 24;
export type PlancherDirection = 'horizontal' | 'vertical';
export type PlancherOpeningType = 'escalier' | 'trappe';
export type PlancherPieceType = 'solive' | 'solive-bordure' | 'blocking' | 'subfloor';

export interface PlancherDims {
  lengthFt: number;
  lengthIn: number;
  widthFt: number;
  widthIn: number;
  ceilingFt: number;
  ceilingIn: number;
}

export interface PlancherOpening {
  id: number;
  type: PlancherOpeningType;
  x: number;        // position X depuis coin haut-gauche en pouces
  y: number;        // position Y depuis coin haut-gauche en pouces
  widthIn: number;  // largeur en pouces
  lengthIn: number; // longueur en pouces
}

export interface PlancherConfig {
  joistType: PlancherJoistType;
  spacing: PlancherSpacing;
  direction: PlancherDirection;
  openings: PlancherOpening[];
}

export interface PlancherPiece {
  id: number;
  label: string;        // J1, J2, ..., B1, SF1...
  type: PlancherPieceType;
  lengthIn: number;     // longueur reelle en pouces (decoupe)
  qty: number;          // quantite (regroupement)
}

export interface PlancherMaterialRow {
  qty: number;
  size: string;
  length: string;
  use: string;
}

export interface PlancherMaterials {
  joists: PlancherMaterialRow[];
  subfloorPanels: PlancherMaterialRow[];
  blocking: PlancherMaterialRow[];
  hangers: PlancherMaterialRow[];
}

export interface PlancherSnapshot {
  dims: PlancherDims;
  config: PlancherConfig;
  pieces: PlancherPiece[];
  materials: PlancherMaterials;
}

// ============================================
// CONSTANTS
// ============================================

// Profondeurs (depth) reelles des solives en pouces
export const PLANCHER_JOIST_DEPTHS: Record<PlancherJoistType, number> = {
  '2x8': 7.25,
  '2x10': 9.25,
  '2x12': 11.25,
  '2-2x10': 9.25,
  'I-joist-9.5': 9.5,
  'I-joist-11.875': 11.875,
};

// Epaisseur (b) des solives en pouces (face superieure)
const PLANCHER_JOIST_THICKNESS: Record<PlancherJoistType, number> = {
  '2x8': 1.5,
  '2x10': 1.5,
  '2x12': 1.5,
  '2-2x10': 3.0,
  'I-joist-9.5': 2.5,
  'I-joist-11.875': 2.5,
};

// Panneau sous-plancher standard (pouces)
export const SUBFLOOR_PANEL_SIZE = { width: 48, length: 96 };

// Pourcentages de pertes
export const WASTE_PCT_JOISTS = 0.10;
export const WASTE_PCT_SUBFLOOR = 0.15;

// Longueurs de planches standards disponibles (pieds)
const STANDARD_LENGTHS_FT = [8, 10, 12, 14, 16, 18, 20];

// Portees max recommandees (CNB approximatif, solives 16" cc, charges residentielles)
const MAX_SPAN_BY_TYPE: Record<PlancherJoistType, number> = {
  '2x8': 12 * 12,            // 12'
  '2x10': 14 * 12,           // 14'
  '2x12': 17 * 12,           // 17'
  '2-2x10': 16 * 12,         // 16'
  'I-joist-9.5': 18 * 12,    // 18'
  'I-joist-11.875': 22 * 12, // 22'
};

// Dimensions et config par defaut
export const DEFAULT_DIMS: PlancherDims = {
  lengthFt: 20,
  lengthIn: 0,
  widthFt: 16,
  widthIn: 0,
  ceilingFt: 8,
  ceilingIn: 0,
};

export const DEFAULT_CONFIG: PlancherConfig = {
  joistType: '2x10',
  spacing: 16,
  direction: 'horizontal',
  openings: [],
};

// Couleurs SVG
const PLANCHER_COLORS = {
  joist: '#b45309',           // ambre
  joistBorder: '#92400e',
  perimeter: '#111827',
  opening: '#dc2626',
  openingFill: 'rgba(220, 38, 38, 0.15)',
  dim: '#0f2942',
  paper: '#fffbeb',
  grid: '#fde68a',
  labelBg: '#7BAFD4',
  labelText: '#FFFFFF',
};

// ============================================
// HELPERS - format & conversions
// ============================================

// Conversion pieds + pouces vers pouces decimaux
function ftInToInches(ft: number, inc: number): number {
  return Math.max(0, ft) * 12 + Math.max(0, inc);
}

// Conversion pouces decimaux vers '"ft" ft "in" po"' format affichage
function inchesToFtInLabel(decimalIn: number): string {
  if (decimalIn == null || isNaN(decimalIn) || decimalIn <= 0) return "0'";
  const totalIn = Math.round(decimalIn * 16) / 16;
  const ft = Math.floor(totalIn / 12);
  const inc = totalIn - ft * 12;
  if (inc === 0) return `${ft}'`;
  return `${ft}'${formatFraction(inc)}`;
}

// Conversion decimal inches vers fraction 1/16e (exporte pour reutilisation phases 17,18)
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
  while (num % 2 === 0 && den % 2 === 0) { num /= 2; den /= 2; }
  return whole === 0 ? `${sign}${num}/${den}"` : `${sign}${whole} ${num}/${den}"`;
}

// Choisit la planche standard la plus proche superieure pour une longueur requise
function pickStandardLengthFt(requiredIn: number): number {
  const reqFt = requiredIn / 12;
  for (const stdFt of STANDARD_LENGTHS_FT) {
    if (stdFt >= reqFt) return stdFt;
  }
  return STANDARD_LENGTHS_FT[STANDARD_LENGTHS_FT.length - 1];
}

// ============================================
// COMPUTE PLANCHER - genere les pieces
// ============================================

// Genere les pieces J1...Jxx, blocking, etc. selon dims + config
export function computePlancher(dims: PlancherDims, config: PlancherConfig): PlancherPiece[] {
  const lengthIn = ftInToInches(dims.lengthFt, dims.lengthIn);
  const widthIn = ftInToInches(dims.widthFt, dims.widthIn);
  if (lengthIn <= 0 || widthIn <= 0) return [];

  const pieces: PlancherPiece[] = [];
  let nextId = 1;

  // Direction des solives : portee = dimension perpendiculaire
  // horizontal = solives paralleles a longueur (portee = largeur)
  // vertical = solives paralleles a largeur (portee = longueur)
  const spanIn = config.direction === 'horizontal' ? widthIn : lengthIn;
  const lineLengthIn = config.direction === 'horizontal' ? lengthIn : widthIn;

  const spacing = config.spacing;
  const thickness = PLANCHER_JOIST_THICKNESS[config.joistType];

  // Nombre de solives intermediaires entre les bordures
  // On commence a 0 avec la solive bordure 1, puis a chaque "spacing" cc
  // jusqu'a la fin. Plus 1 solive bordure 2.
  const numInteriorSpaces = Math.ceil(lineLengthIn / spacing);
  const totalJoists = numInteriorSpaces + 1;

  // Solive de bordure debut (rim joist / structure de bord)
  pieces.push({
    id: nextId++,
    label: 'J1',
    type: 'solive-bordure',
    lengthIn: spanIn,
    qty: 1,
  });

  // Solives interieures J2...J(n-1)
  for (let i = 1; i < totalJoists - 1; i++) {
    pieces.push({
      id: nextId++,
      label: `J${i + 1}`,
      type: 'solive',
      lengthIn: spanIn,
      qty: 1,
    });
  }

  // Solive de bordure fin
  pieces.push({
    id: nextId++,
    label: `J${totalJoists}`,
    type: 'solive-bordure',
    lengthIn: spanIn,
    qty: 1,
  });

  // Blocking entre solives a mi-portee si portee > 8'
  if (spanIn > 96) {
    const blockingLen = spacing - thickness;
    pieces.push({
      id: nextId++,
      label: 'B1',
      type: 'blocking',
      lengthIn: blockingLen,
      qty: totalJoists - 1, // n-1 blocages entre n solives
    });
  }

  // Panneaux sous-plancher (estimation surfacique)
  const surfaceIn2 = lengthIn * widthIn;
  const panelArea = SUBFLOOR_PANEL_SIZE.width * SUBFLOOR_PANEL_SIZE.length;
  const panelsBase = Math.ceil(surfaceIn2 / panelArea);
  const panelsWithWaste = Math.ceil(panelsBase * (1 + WASTE_PCT_SUBFLOOR));
  pieces.push({
    id: nextId++,
    label: `SF1`,
    type: 'subfloor',
    lengthIn: SUBFLOOR_PANEL_SIZE.length,
    qty: panelsWithWaste,
  });

  return pieces;
}

// ============================================
// GENERATE MATERIALS - groupe par taille + longueur
// ============================================

// Regroupe les pieces par taille/longueur en format tableau materiaux
export function generatePlancherMaterials(pieces: PlancherPiece[], config: PlancherConfig): PlancherMaterials {
  const joists: PlancherMaterialRow[] = [];
  const subfloorPanels: PlancherMaterialRow[] = [];
  const blocking: PlancherMaterialRow[] = [];
  const hangers: PlancherMaterialRow[] = [];

  // Regroupement solives + bordures par longueur standard
  const joistGroup = new Map<string, number>();
  for (const p of pieces) {
    if (p.type === 'solive' || p.type === 'solive-bordure') {
      const stdFt = pickStandardLengthFt(p.lengthIn);
      const key = `${stdFt}`;
      joistGroup.set(key, (joistGroup.get(key) || 0) + p.qty);
    }
  }
  // Application waste sur solives
  for (const [stdFt, qty] of joistGroup.entries()) {
    const withWaste = Math.ceil(qty * (1 + WASTE_PCT_JOISTS));
    joists.push({
      qty: withWaste,
      size: config.joistType,
      length: `${stdFt}'`,
      use: 'Solive de plancher',
    });
  }

  // Regroupement blocages
  for (const p of pieces) {
    if (p.type === 'blocking') {
      // Plusieurs blocages tires d'une planche standard (8' = 96")
      const blockingPerBoard = Math.floor(96 / Math.max(1, p.lengthIn));
      const boardsNeeded = Math.ceil(p.qty / Math.max(1, blockingPerBoard));
      blocking.push({
        qty: boardsNeeded,
        size: config.joistType,
        length: `8'`,
        use: `Blocage (${p.qty} pieces a ${formatFraction(p.lengthIn)})`,
      });
    }
  }

  // Regroupement panneaux sous-plancher
  for (const p of pieces) {
    if (p.type === 'subfloor') {
      subfloorPanels.push({
        qty: p.qty,
        size: `4x8`,
        length: `3/4" plywood T&G`,
        use: 'Sous-plancher',
      });
    }
  }

  // Estimation etriers (un par bout de solive interieure)
  const interiorJoists = pieces.filter(p => p.type === 'solive').length;
  if (interiorJoists > 0) {
    hangers.push({
      qty: interiorJoists * 2,
      size: config.joistType,
      length: '-',
      use: 'Etrier de solive (LUS210 ou equiv.)',
    });
  }

  return { joists, subfloorPanels, blocking, hangers };
}

// ============================================
// CUT LIST ASCII
// ============================================

// Genere une liste de coupe ASCII pour affichage / export texte
export function generatePlancherCutList(pieces: PlancherPiece[]): string {
  const lines: string[] = [];
  lines.push('LISTE DE COUPE - PLANCHER');
  lines.push('='.repeat(48));
  lines.push('ETIQ.  | TAILLE       | LONGUEUR    | QTE');
  lines.push('-'.repeat(48));
  for (const p of pieces) {
    const lbl = p.label.padEnd(6);
    const len = inchesToFtInLabel(p.lengthIn).padEnd(11);
    const useTxt = (p.type === 'solive-bordure' ? 'Bordure' :
                    p.type === 'blocking' ? 'Blocage' :
                    p.type === 'subfloor' ? 'Panneau' : 'Solive').padEnd(12);
    lines.push(`${lbl} | ${useTxt} | ${len} | ${p.qty}`);
  }
  return lines.join('\n');
}

// ============================================
// VALIDATION
// ============================================

interface PlancherValidation {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

// Verifie portees, longueurs max, conformite CNB
function validatePlancher(dims: PlancherDims, config: PlancherConfig): PlancherValidation[] {
  const out: PlancherValidation[] = [];
  const lengthIn = ftInToInches(dims.lengthFt, dims.lengthIn);
  const widthIn = ftInToInches(dims.widthFt, dims.widthIn);
  const spanIn = config.direction === 'horizontal' ? widthIn : lengthIn;

  if (lengthIn <= 0 || widthIn <= 0) {
    out.push({ level: 'error', code: 'DIMS_NULL', message: 'Dimensions invalides : longueur et largeur doivent etre > 0.' });
    return out;
  }

  const maxSpan = MAX_SPAN_BY_TYPE[config.joistType];
  if (spanIn > maxSpan) {
    out.push({
      level: 'error',
      code: 'SPAN_EXCEED',
      message: `Portee ${inchesToFtInLabel(spanIn)} depasse maximum recommande ${inchesToFtInLabel(maxSpan)} pour ${config.joistType}. Considerer LVL, I-joist plus profond ou poutre intermediaire.`,
    });
  } else if (config.joistType === '2x10' && spanIn > 14 * 12 - 6) {
    out.push({
      level: 'warning',
      code: 'SPAN_HIGH_2X10',
      message: `Portee ${inchesToFtInLabel(spanIn)} > 14' pour 2x10. Consulter ingenieur ou utiliser LVL / I-joist.`,
    });
  }

  if (spanIn > 16 * 12) {
    out.push({
      level: 'warning',
      code: 'SPAN_OVER_16',
      message: `Portee ${inchesToFtInLabel(spanIn)} > 16'. Longueur standard maximale depassee, doublage ou poutre necessaire.`,
    });
  }

  if (config.spacing === 24 && (config.joistType === '2x8' || config.joistType === '2x10')) {
    out.push({
      level: 'warning',
      code: 'SPACING_24',
      message: `Espacement 24" cc avec ${config.joistType} : verifier charges. CNB recommande 16" cc pour usage residentiel courant.`,
    });
  }

  return out;
}

// ============================================
// SVG VIEW - vue de dessus du plancher
// ============================================

interface PlancherSvgProps {
  dims: PlancherDims;
  config: PlancherConfig;
  pieces: PlancherPiece[];
}

// Composant SVG vue de dessus avec solives + perimetre + cotations
function PlancherSvg({ dims, config, pieces }: PlancherSvgProps): JSX.Element {
  const lengthIn = ftInToInches(dims.lengthFt, dims.lengthIn);
  const widthIn = ftInToInches(dims.widthFt, dims.widthIn);
  if (lengthIn <= 0 || widthIn <= 0) {
    return <div className="text-center text-xs text-gray-500 py-8">Saisir des dimensions valides pour la previsualisation.</div>;
  }

  // Coordonnees : x = longueur, y = largeur. Echelle calculee.
  const pad = 40;
  const maxW = 400;
  const maxH = 280;
  const scaleX = (maxW - 2 * pad) / lengthIn;
  const scaleY = (maxH - 2 * pad) / widthIn;
  const scale = Math.min(scaleX, scaleY);
  const drawW = lengthIn * scale;
  const drawH = widthIn * scale;
  const svgW = drawW + 2 * pad;
  const svgH = drawH + 2 * pad;
  const x0 = pad;
  const y0 = pad;

  // Solives : positions en pouces sur axe principal
  const spanInternal = config.direction === 'horizontal' ? lengthIn : widthIn;
  const numSpaces = Math.ceil(spanInternal / config.spacing);
  const joistPositions: number[] = [];
  for (let i = 0; i <= numSpaces; i++) {
    joistPositions.push(Math.min(i * config.spacing, spanInternal));
  }

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto" style={{ background: PLANCHER_COLORS.paper }}>
      {/* Fond avec grille legere */}
      <defs>
        <pattern id="planchergrid" width="12" height="12" patternUnits="userSpaceOnUse">
          <path d={`M 12 0 L 0 0 0 12`} fill="none" stroke={PLANCHER_COLORS.grid} strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect x={x0} y={y0} width={drawW} height={drawH} fill="url(#planchergrid)" />

      {/* Solives - lignes paralleles */}
      {joistPositions.map((pos, i) => {
        if (config.direction === 'horizontal') {
          // solives paralleles a longueur (axe X) : positions sur X
          const px = x0 + pos * scale;
          return (
            <line
              key={`j-${i}`}
              x1={px} y1={y0}
              x2={px} y2={y0 + drawH}
              stroke={PLANCHER_COLORS.joist}
              strokeWidth={i === 0 || i === joistPositions.length - 1 ? 2.5 : 1.5}
            />
          );
        }
        // solives paralleles a largeur (axe Y) : positions sur Y
        const py = y0 + pos * scale;
        return (
          <line
            key={`j-${i}`}
            x1={x0} y1={py}
            x2={x0 + drawW} y2={py}
            stroke={PLANCHER_COLORS.joist}
            strokeWidth={i === 0 || i === joistPositions.length - 1 ? 2.5 : 1.5}
          />
        );
      })}

      {/* Ouvertures (escalier, trappe) */}
      {config.openings.map((op) => {
        const ox = x0 + op.x * scale;
        const oy = y0 + op.y * scale;
        const ow = op.widthIn * scale;
        const oh = op.lengthIn * scale;
        return (
          <g key={`op-${op.id}`}>
            <rect x={ox} y={oy} width={ow} height={oh} fill={PLANCHER_COLORS.openingFill} stroke={PLANCHER_COLORS.opening} strokeWidth={1.5} strokeDasharray="4 2" />
            <text x={ox + ow / 2} y={oy + oh / 2} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill={PLANCHER_COLORS.opening} fontWeight="bold">
              {op.type === 'escalier' ? 'ESC' : 'TRAP'}
            </text>
          </g>
        );
      })}

      {/* Perimetre - ligne epaisse noire */}
      <rect x={x0} y={y0} width={drawW} height={drawH} fill="none" stroke={PLANCHER_COLORS.perimeter} strokeWidth={2.5} />

      {/* Etiquette J1 sur premiere solive */}
      {joistPositions.length > 0 && (() => {
        const px = config.direction === 'horizontal' ? x0 + 12 : x0 + 12;
        const py = config.direction === 'horizontal' ? y0 + 12 : y0 + 12;
        return (
          <g>
            <rect x={px - 10} y={py - 7} width={20} height={12} rx={2} fill={PLANCHER_COLORS.labelBg} />
            <text x={px} y={py} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill={PLANCHER_COLORS.labelText} fontWeight="bold">J1</text>
          </g>
        );
      })()}

      {/* Cotation longueur (haut) */}
      <g>
        <line x1={x0} y1={y0 - 14} x2={x0 + drawW} y2={y0 - 14} stroke={PLANCHER_COLORS.dim} strokeWidth={0.7} />
        <line x1={x0} y1={y0 - 18} x2={x0} y2={y0 - 10} stroke={PLANCHER_COLORS.dim} strokeWidth={0.7} />
        <line x1={x0 + drawW} y1={y0 - 18} x2={x0 + drawW} y2={y0 - 10} stroke={PLANCHER_COLORS.dim} strokeWidth={0.7} />
        <text x={x0 + drawW / 2} y={y0 - 20} textAnchor="middle" fontSize="10" fill={PLANCHER_COLORS.dim} fontWeight="600">
          {inchesToFtInLabel(lengthIn)}
        </text>
      </g>

      {/* Cotation largeur (gauche) */}
      <g>
        <line x1={x0 - 14} y1={y0} x2={x0 - 14} y2={y0 + drawH} stroke={PLANCHER_COLORS.dim} strokeWidth={0.7} />
        <line x1={x0 - 18} y1={y0} x2={x0 - 10} y2={y0} stroke={PLANCHER_COLORS.dim} strokeWidth={0.7} />
        <line x1={x0 - 18} y1={y0 + drawH} x2={x0 - 10} y2={y0 + drawH} stroke={PLANCHER_COLORS.dim} strokeWidth={0.7} />
        <text x={x0 - 22} y={y0 + drawH / 2} textAnchor="middle" fontSize="10" fill={PLANCHER_COLORS.dim} fontWeight="600" transform={`rotate(-90 ${x0 - 22} ${y0 + drawH / 2})`}>
          {inchesToFtInLabel(widthIn)}
        </text>
      </g>
    </svg>
  );
}

// ============================================
// SUB-COMPONENTS UI
// ============================================

// Champ numerique compact pour saisie pieds/pouces/general
function NumberField({ label, value, onChange, step = 1, min = 0, max, suffix }:
  { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }): JSX.Element {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange(isNaN(v) ? 0 : v);
          }}
          className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
        />
        {suffix && <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">{suffix}</span>}
      </div>
    </div>
  );
}

// Groupe de boutons toggle (radio visuel)
function ToggleGroup<T extends string | number>(
  { label, value, options, onChange }:
  { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }
): JSX.Element {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">
        {label}
      </label>
      <div className="bg-gray-100 dark:bg-gray-700 p-1 rounded-lg flex flex-wrap gap-1">
        {options.map(([val, lbl]) => (
          <button
            key={String(val)}
            type="button"
            onClick={() => onChange(val)}
            className={clsx(
              'flex-1 min-w-fit py-1.5 px-2 text-xs font-semibold rounded-md transition',
              value === val
                ? 'bg-white dark:bg-gray-800 shadow text-gray-900 dark:text-white'
                : 'text-gray-600 dark:text-gray-300',
            )}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );
}

// Section repliable avec titre + chevron
function CollapsibleSection({ title, expanded, onToggle, accent = '#f59e0b', children }:
  { title: string; expanded: boolean; onToggle: () => void; accent?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
      >
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-5 rounded-full" style={{ background: accent }} />
          <span className="text-xs uppercase tracking-wider font-bold text-gray-800 dark:text-gray-100">{title}</span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
      </button>
      {expanded && <div className="px-3 pb-3 pt-1 space-y-3">{children}</div>}
    </div>
  );
}

// Carte stat compacte (label + valeur)
function StatCard({ label, value, accent }: { label: string; value: ReactNode; accent: 'amber' | 'orange' | 'green' | 'blue' }): JSX.Element {
  const colors: Record<string, string> = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-200',
    orange: 'border-orange-200 bg-orange-50 text-orange-900 dark:bg-orange-900/20 dark:border-orange-700 dark:text-orange-200',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-200',
    blue: 'border-blue-200 bg-blue-50 text-blue-900 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-200',
  };
  return (
    <div className={clsx('rounded-lg border px-3 py-2', colors[accent])}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-70">{label}</div>
      <div className="text-base font-bold font-mono">{value}</div>
    </div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

interface PlancherPanelProps {
  initialDims?: PlancherDims;
  initialConfig?: PlancherConfig;
  onChange?: (snapshot: PlancherSnapshot) => void;
}

// Composant principal calculateur plancher
export default function PlancherPanel({ initialDims, initialConfig, onChange }: PlancherPanelProps = {}): JSX.Element {
  // Etat principal : dimensions + configuration
  const [dims, setDims] = useState<PlancherDims>(initialDims ?? DEFAULT_DIMS);
  const [config, setConfig] = useState<PlancherConfig>(initialConfig ?? DEFAULT_CONFIG);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['cutlist']));
  const [tab, setTab] = useState<'config' | 'materials' | 'cutlist'>('config');

  // Calcul reactif des pieces et materiaux
  const pieces = useMemo(() => computePlancher(dims, config), [dims, config]);
  const materials = useMemo(() => generatePlancherMaterials(pieces, config), [pieces, config]);
  const validations = useMemo(() => validatePlancher(dims, config), [dims, config]);

  // Stats derivees pour affichage
  const stats = useMemo(() => {
    const lengthIn = ftInToInches(dims.lengthFt, dims.lengthIn);
    const widthIn = ftInToInches(dims.widthFt, dims.widthIn);
    const surfaceFt2 = (lengthIn * widthIn) / 144;
    const perimeterIn = 2 * (lengthIn + widthIn);
    const joistsCount = pieces.filter(p => p.type === 'solive' || p.type === 'solive-bordure').reduce((a, p) => a + p.qty, 0);
    const subfloorQty = pieces.filter(p => p.type === 'subfloor').reduce((a, p) => a + p.qty, 0);
    return { surfaceFt2, perimeterIn, joistsCount, subfloorQty, lengthIn, widthIn };
  }, [dims, pieces]);

  // Notification au parent sur changements (optionnel) - useEffect car effet de bord
  useEffect(() => {
    if (onChange) onChange({ dims, config, pieces, materials });
  }, [dims, config, pieces, materials, onChange]);

  // Compteur monotone pour ids d'ouvertures (evite collisions Date.now())
  const openingIdCounter = useRef(1);

  // Toggle section repliable
  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Mise a jour partielle des dimensions
  const updateDims = (patch: Partial<PlancherDims>) => setDims((d) => ({ ...d, ...patch }));

  // Mise a jour partielle de la config
  const updateConfig = (patch: Partial<PlancherConfig>) => setConfig((c) => ({ ...c, ...patch }));

  // Ajout ouverture (escalier ou trappe)
  const addOpening = (type: PlancherOpeningType) => {
    const newId = Date.now() * 1000 + (openingIdCounter.current++);
    const newOp: PlancherOpening = {
      id: newId,
      type,
      x: 24,
      y: 24,
      widthIn: type === 'escalier' ? 36 : 24,
      lengthIn: type === 'escalier' ? 120 : 24,
    };
    updateConfig({ openings: [...config.openings, newOp] });
  };

  // Suppression ouverture par id
  const removeOpening = (id: number) => {
    updateConfig({ openings: config.openings.filter((o) => o.id !== id) });
  };

  // Mise a jour ouverture
  const updateOpening = (id: number, patch: Partial<PlancherOpening>) => {
    updateConfig({
      openings: config.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    });
  };

  return (
    <div className="max-w-md mx-auto space-y-3 pb-8">
      {/* Header gradient ambre / orange */}
      <div className="rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white p-4 shadow-lg">
        <div className="flex items-center gap-3">
          <Layers className="w-8 h-8 opacity-90" />
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wider font-semibold opacity-80">Calculateur</div>
            <div className="text-lg font-bold leading-tight">Plancher</div>
            <div className="text-xs opacity-80">Solives, blocage, sous-plancher</div>
          </div>
        </div>
      </div>

      {/* Stats principales 2x2 */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Surface" value={`${stats.surfaceFt2.toFixed(1)} pi²`} accent="amber" />
        <StatCard label="Perimetre" value={inchesToFtInLabel(stats.perimeterIn)} accent="orange" />
        <StatCard label="Solives" value={stats.joistsCount} accent="blue" />
        <StatCard label="Panneaux 4x8" value={stats.subfloorQty} accent="green" />
      </div>

      {/* Visualisation SVG vue de dessus */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
            <Ruler className="w-3.5 h-3.5" /> Plan du plancher
          </span>
          <span className="text-[10px] font-mono text-gray-500">
            {config.joistType} @ {config.spacing}" cc
          </span>
        </div>
        <div className="p-2 bg-amber-50/30 dark:bg-gray-900">
          <PlancherSvg dims={dims} config={config} pieces={pieces} />
        </div>
      </div>

      {/* Validations / avertissements */}
      {validations.length > 0 && (
        <div className="space-y-1.5">
          {validations.map((v) => (
            <div
              key={v.code}
              className={clsx(
                'flex items-start gap-2 rounded-lg px-3 py-2 text-xs border',
                v.level === 'error' && 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-700 dark:text-red-200',
                v.level === 'warning' && 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-200',
                v.level === 'info' && 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-200',
              )}
            >
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span className="leading-snug">{v.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Onglets principaux */}
      <div className="bg-gray-200/70 dark:bg-gray-700/70 rounded-lg p-1 flex">
        <TabButton active={tab === 'config'} onClick={() => setTab('config')}>Config</TabButton>
        <TabButton active={tab === 'materials'} onClick={() => setTab('materials')}>Materiaux</TabButton>
        <TabButton active={tab === 'cutlist'} onClick={() => setTab('cutlist')}>Coupe</TabButton>
      </div>

      {/* Onglet Configuration */}
      {tab === 'config' && (
        <div className="space-y-3">
          {/* Dimensions du plancher */}
          <CollapsibleSection title="Dimensions" expanded={!collapsed.has('dims')} onToggle={() => toggleCollapsed('dims')}>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Longueur (pi)" value={dims.lengthFt} onChange={(v) => updateDims({ lengthFt: v })} step={1} min={0} suffix="pi" />
              <NumberField label="Longueur (po)" value={dims.lengthIn} onChange={(v) => updateDims({ lengthIn: v })} step={0.5} min={0} max={11.9375} suffix="po" />
              <NumberField label="Largeur (pi)" value={dims.widthFt} onChange={(v) => updateDims({ widthFt: v })} step={1} min={0} suffix="pi" />
              <NumberField label="Largeur (po)" value={dims.widthIn} onChange={(v) => updateDims({ widthIn: v })} step={0.5} min={0} max={11.9375} suffix="po" />
              <NumberField label="Haut. libre (pi)" value={dims.ceilingFt} onChange={(v) => updateDims({ ceilingFt: v })} step={1} min={0} suffix="pi" />
              <NumberField label="Haut. libre (po)" value={dims.ceilingIn} onChange={(v) => updateDims({ ceilingIn: v })} step={0.5} min={0} max={11.9375} suffix="po" />
            </div>
          </CollapsibleSection>

          {/* Configuration des solives */}
          <CollapsibleSection title="Configuration solives" expanded={!collapsed.has('joists')} onToggle={() => toggleCollapsed('joists')}>
            <ToggleGroup<PlancherJoistType>
              label="Type de solive"
              value={config.joistType}
              options={[
                ['2x8', '2x8'],
                ['2x10', '2x10'],
                ['2x12', '2x12'],
                ['2-2x10', '2-2x10'],
                ['I-joist-9.5', 'I 9.5'],
                ['I-joist-11.875', 'I 11.875'],
              ]}
              onChange={(v) => updateConfig({ joistType: v })}
            />
            <ToggleGroup<PlancherSpacing>
              label="Espacement centre a centre"
              value={config.spacing}
              options={[[16, '16"'], [19.2, '19.2"'], [24, '24"']]}
              onChange={(v) => updateConfig({ spacing: v })}
            />
            <ToggleGroup<PlancherDirection>
              label="Direction des solives"
              value={config.direction}
              options={[['horizontal', 'Horizontale'], ['vertical', 'Verticale']]}
              onChange={(v) => updateConfig({ direction: v })}
            />
            <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug">
              Profondeur reelle : {PLANCHER_JOIST_DEPTHS[config.joistType]} po. Portee max recommandee : {inchesToFtInLabel(MAX_SPAN_BY_TYPE[config.joistType])}.
            </div>
          </CollapsibleSection>

          {/* Liste des ouvertures (escalier, trappe) */}
          <CollapsibleSection title={`Ouvertures (${config.openings.length})`} expanded={!collapsed.has('openings')} onToggle={() => toggleCollapsed('openings')}>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => addOpening('escalier')}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-semibold rounded-md bg-amber-600 hover:bg-amber-700 text-white"
              >
                <Plus className="w-3.5 h-3.5" /> Escalier
              </button>
              <button
                type="button"
                onClick={() => addOpening('trappe')}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-semibold rounded-md bg-orange-600 hover:bg-orange-700 text-white"
              >
                <Plus className="w-3.5 h-3.5" /> Trappe
              </button>
            </div>
            {config.openings.length === 0 && (
              <div className="text-xs text-gray-500 text-center py-2">Aucune ouverture.</div>
            )}
            {config.openings.map((op) => (
              <div key={op.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-gray-700 dark:text-gray-200">
                    {op.type === 'escalier' ? 'Escalier' : 'Trappe'} #{op.id.toString().slice(-3)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeOpening(op.id)}
                    className="text-red-600 hover:text-red-800 p-1"
                    aria-label="Supprimer ouverture"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="Pos X (po)" value={op.x} onChange={(v) => updateOpening(op.id, { x: v })} step={1} min={0} />
                  <NumberField label="Pos Y (po)" value={op.y} onChange={(v) => updateOpening(op.id, { y: v })} step={1} min={0} />
                  <NumberField label="Largeur (po)" value={op.widthIn} onChange={(v) => updateOpening(op.id, { widthIn: v })} step={1} min={1} />
                  <NumberField label="Longueur (po)" value={op.lengthIn} onChange={(v) => updateOpening(op.id, { lengthIn: v })} step={1} min={1} />
                </div>
              </div>
            ))}
          </CollapsibleSection>
        </div>
      )}

      {/* Onglet Materiaux - tableaux groupes */}
      {tab === 'materials' && (
        <div className="space-y-3">
          <CollapsibleSection title="Solives" expanded={true} onToggle={() => {}}>
            <MaterialTable rows={materials.joists} emptyMsg="Aucune solive calculee." />
          </CollapsibleSection>
          <CollapsibleSection title="Sous-plancher" expanded={true} onToggle={() => {}}>
            <MaterialTable rows={materials.subfloorPanels} emptyMsg="Aucun panneau requis." />
          </CollapsibleSection>
          {materials.blocking.length > 0 && (
            <CollapsibleSection title="Blocage" expanded={true} onToggle={() => {}}>
              <MaterialTable rows={materials.blocking} emptyMsg="Aucun blocage requis." />
            </CollapsibleSection>
          )}
          {materials.hangers.length > 0 && (
            <CollapsibleSection title="Quincaillerie" expanded={true} onToggle={() => {}}>
              <MaterialTable rows={materials.hangers} emptyMsg="" />
            </CollapsibleSection>
          )}
        </div>
      )}

      {/* Onglet Liste de coupe - etiquetage J1...Jxx */}
      {tab === 'cutlist' && (
        <div className="space-y-3">
          <CollapsibleSection title="Liste de coupe (etiquettes)" expanded={!collapsed.has('cutlist')} onToggle={() => toggleCollapsed('cutlist')}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1.5 px-2 text-left font-semibold">Etiq.</th>
                    <th className="py-1.5 px-2 text-left font-semibold">Type</th>
                    <th className="py-1.5 px-2 text-right font-semibold">Long.</th>
                    <th className="py-1.5 px-2 text-right font-semibold">Qte</th>
                  </tr>
                </thead>
                <tbody>
                  {pieces.length === 0 && (
                    <tr><td colSpan={4} className="py-3 text-center text-gray-500">Aucune piece calculee.</td></tr>
                  )}
                  {pieces.map((p) => (
                    <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 px-2 font-mono font-bold text-amber-700 dark:text-amber-400">{p.label}</td>
                      <td className="py-1 px-2 text-gray-700 dark:text-gray-300">
                        {p.type === 'solive-bordure' ? 'Bordure' : p.type === 'solive' ? 'Solive' : p.type === 'blocking' ? 'Blocage' : 'Panneau'}
                      </td>
                      <td className="py-1 px-2 text-right font-mono text-gray-700 dark:text-gray-300">
                        {p.type === 'subfloor' ? `${SUBFLOOR_PANEL_SIZE.width}x${SUBFLOOR_PANEL_SIZE.length}"` : inchesToFtInLabel(p.lengthIn)}
                      </td>
                      <td className="py-1 px-2 text-right font-mono font-bold">{p.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleSection>

          {/* Boutons actions (export liste / plan PDF - integration phase 19) */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled
              className="flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 cursor-not-allowed"
              title="Disponible en phase 19"
            >
              <FileText className="w-3.5 h-3.5" /> Liste de coupe
            </button>
            <button
              type="button"
              disabled
              className="flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 cursor-not-allowed"
              title="Disponible en phase 19"
            >
              <FileText className="w-3.5 h-3.5" /> Plan PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Bouton onglet (style segmente)
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex-1 py-1.5 px-2 text-xs font-semibold rounded-md transition',
        active ? 'bg-white dark:bg-gray-800 shadow text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300',
      )}
    >
      {children}
    </button>
  );
}

// Tableau materiaux (QTE / TAILLE / LONGUEUR / UTILISER)
function MaterialTable({ rows, emptyMsg }: { rows: PlancherMaterialRow[]; emptyMsg: string }): JSX.Element {
  if (rows.length === 0) {
    return <div className="text-xs text-gray-500 text-center py-2">{emptyMsg}</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
            <th className="py-1.5 px-2 text-right font-semibold">Qte</th>
            <th className="py-1.5 px-2 text-left font-semibold">Taille</th>
            <th className="py-1.5 px-2 text-left font-semibold">Longueur</th>
            <th className="py-1.5 px-2 text-left font-semibold">Utiliser</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
              <td className="py-1 px-2 text-right font-mono font-bold">{r.qty}</td>
              <td className="py-1 px-2 text-gray-700 dark:text-gray-300">{r.size}</td>
              <td className="py-1 px-2 font-mono text-gray-700 dark:text-gray-300">{r.length}</td>
              <td className="py-1 px-2 text-gray-700 dark:text-gray-300">{r.use}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
