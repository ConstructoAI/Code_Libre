/**
 * MursParametriquePanel - Charpente murale legere
 *
 * Inspiration: Wall Builder / Rake Wall Builder / Tall Wall Builder (BuildCalc)
 *
 * Fonctionnalites:
 * - Modes: Standard / Pignon (rake) / Mur haut (tall)
 * - Proprietes etendues: doubler montants, blocage, lisse haute supp, revetement
 * - Ouvertures fenetres + portes (rect/arc)
 * - Etiquetage pieces (UTP, PLT, A, AA, J, H, S, N, BLK)
 * - Cotations positions montants
 * - Liste de coupe (cut list) avec quantites
 * - Vues Avant / Arriere / 3D isometrique
 * - Undo / Redo (stack 50)
 *
 * Calcul 100% frontend, format imperial (pouces + fractions 16e).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, FileDown, FileText,
  FolderOpen, Frame, Info, Layers, Minus, Plus, Save, Send, Trash2, X, ZoomIn, ZoomOut, Undo2, Redo2,
  Box, Eye, EyeOff, Download, Settings2,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Card } from '@/components/ui/Card';
import {
  createHistory, listHistory, deleteHistoryItem,
  type CalculatorHistoryItem,
} from '@/api/calculators';
import { useDevisStore } from '@/store/useDevisStore';
import {
  createProduct as createMetreProduct,
  addProductComponent as addMetreComponent,
  listProducts as listMetreProducts,
} from '@/components/metre-pdf/api';
import MurWall3D from './MurWall3D';
import MurConformiteEntrepreneur from './MurConformiteEntrepreneur';
import { DEFAULT_EG_CONFIG, type MurEgConfig, type MurCompositionPreset } from './wallValidations';

// ============================================
// TYPES
// ============================================

export type MurStudSize = '2x4' | '2x6' | '2x8';
export type MurLayoutDirection = 'start' | 'end';
export type MurWallMode = 'standard' | 'rake' | 'tall';
export type MurViewMode = 'front' | 'back' | '3d';
export type MurOpeningShape = 'rect' | 'arch';
export type MurSheathingSize = '4x8' | '4x9' | '4x10' | '4x12';
export type MurSheathingThickness = '7/16' | '1/2' | '5/8' | '3/4';
export type MurHauteurMode = 'stud' | 'total';
export type MurRakeShortSide = 'left' | 'right';
export type MurRakeStudLengthMode = 'short' | 'long';

export interface MurWall {
  // Mode
  wallMode: MurWallMode;

  // Geometry
  length: number;
  studHeight: number;
  hauteurMode: MurHauteurMode;

  // Studs
  studSpacing: number;
  firstStud: number;
  studType: MurStudSize;
  layoutDirection: MurLayoutDirection;
  doubleStuds: boolean;

  // Blocking
  hasBlocking: boolean;
  blockingSpacing: number;

  // Extra top plate
  hasExtraTopPlate: boolean;
  extraTopPlateThickness: number;
  extraTopPlateStart: number;
  extraTopPlateEnd: number;

  // Sheathing
  hasSheathing: boolean;
  sheathingSize: MurSheathingSize;
  sheathingThickness: MurSheathingThickness;
  verticalSheathing: boolean;
  sheathingStartOverhang: number;
  sheathingEndOverhang: number;

  // Rake wall (mode=rake)
  rakePitch: number;
  rakeShortSide: MurRakeShortSide;
  rakeStudLengthMode: MurRakeStudLengthMode;

  // Tall wall (mode=tall)
  hasFloorBand: boolean;
  floorBandHeight: number;
  floorBandY: number;
}

export interface MurOpening {
  id: number;
  type: 'window' | 'door';
  shape: MurOpeningShape;
  x: number;
  width: number;
  height: number;
  sillHeight: number;
}

export interface MurPiece {
  kind: 'plate' | 'stud' | 'king' | 'jack' | 'header' | 'cripple' | 'sill' | 'blocking' | 'extraplate';
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  size?: string;
  // For rake top plates: render as polygon with explicit points
  polygon?: { x: number; y: number }[];
}

export interface MurCounts {
  studs: number;
  kings: number;
  jacks: number;
  cripples: number;
  headers: number;
  sills: number;
  plates: number;
  blockings: number;
}

export interface MurCutListItem {
  label: string;
  qty: number;
  size: string;
  length: number;
  use: string;
}

export interface MurWallEntry {
  id: number;
  name: string;
  wall: MurWall;
  openings: MurOpening[];
}

export interface MurValidation {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

interface MurProjectSnapshot {
  walls: MurWallEntry[];
  currentWallIdx: number;
  projectName: string;
}

interface MurToast {
  msg: string;
  type: 'success' | 'error';
}

// ============================================
// CONSTANTS
// ============================================

const MUR_STUD = 1.5;
const MUR_PLATE = 1.5;
const MUR_HEADER_H = 9.25;
const MAX_HISTORY = 50;

const MUR_STUD_DIMS: Record<MurStudSize, { b: number; d: number }> = {
  '2x4': { b: 1.5, d: 3.5 },
  '2x6': { b: 1.5, d: 5.5 },
  '2x8': { b: 1.5, d: 7.25 },
};

const MUR_COLORS = {
  stud: '#E8C77F',
  plate: '#C9A357',
  king: '#E8C77F',
  jack: '#D9583E',
  header: '#F2D27B',
  cripple: '#E8C77F',
  sill: '#C9A357',
  blocking: '#D9A85F',
  extraplate: '#B8923F',
  outline: '#1f2937',
  paper: '#FFFFFF',
  grid: '#E5EAF2',
  dim: '#0f2942',
  dimAccent: '#2563eb',
  labelBg: '#7BAFD4',
  labelText: '#FFFFFF',
};

const DEFAULT_WALL: MurWall = {
  wallMode: 'standard',
  length: 100,
  studHeight: 104.625,
  hauteurMode: 'stud',
  studSpacing: 16,
  firstStud: 16,
  studType: '2x6',
  layoutDirection: 'start',
  doubleStuds: false,
  hasBlocking: false,
  blockingSpacing: 48,
  hasExtraTopPlate: false,
  extraTopPlateThickness: 1.5,
  extraTopPlateStart: 0,
  extraTopPlateEnd: 0,
  hasSheathing: false,
  sheathingSize: '4x9',
  sheathingThickness: '7/16',
  verticalSheathing: false,
  sheathingStartOverhang: 0,
  sheathingEndOverhang: 0,
  rakePitch: 6,
  rakeShortSide: 'left',
  rakeStudLengthMode: 'long',
  hasFloorBand: false,
  floorBandHeight: 1.5,
  floorBandY: 60,
};

const DEFAULT_OPENINGS: MurOpening[] = [
  { id: 1, type: 'window', shape: 'rect', x: 24, width: 36, height: 50, sillHeight: 36 },
  { id: 2, type: 'door', shape: 'rect', x: 64, width: 36, height: 80, sillHeight: 0 },
];

// ============================================
// HELPERS
// ============================================

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

function pieceUse(kind: MurPiece['kind']): string {
  const map: Record<MurPiece['kind'], string> = {
    stud: 'Montant',
    king: 'King stud',
    jack: 'Jambage',
    cripple: 'Montant nain',
    header: 'Linteau',
    sill: 'Lisse appui',
    plate: 'Lisse',
    blocking: 'Blocage',
    extraplate: 'Lisse haute supp.',
  };
  return map[kind];
}

// Stud height at x for rake wall
function studHeightAt(wall: MurWall, xCenter: number): number {
  if (wall.wallMode !== 'rake') return wall.studHeight;
  const slope = wall.rakePitch / 12;
  if (wall.rakeShortSide === 'left') {
    return wall.studHeight + xCenter * slope;
  }
  return wall.studHeight + (wall.length - xCenter) * slope;
}

// ============================================
// COMPUTE WALL
// ============================================

export function computeWall(wall: MurWall, openings: MurOpening[]): {
  pieces: MurPiece[];
  totalH: number;
  studPositions: number[];
  rakeMaxH: number;
  rakeMinH: number;
} {
  const pieces: MurPiece[] = [];
  const studPositions: number[] = [];

  const isRake = wall.wallMode === 'rake';
  const slope = isRake ? wall.rakePitch / 12 : 0;
  const rakeMinH = isRake ? wall.studHeight : wall.studHeight;
  const rakeMaxH = isRake ? wall.studHeight + wall.length * slope : wall.studHeight;
  const maxStudH = rakeMaxH;
  const totalH = maxStudH + MUR_PLATE * 3 + (wall.hasExtraTopPlate ? wall.extraTopPlateThickness : 0);

  // === Plates ===
  // Bottom plate (always rectangular)
  pieces.push({ kind: 'plate', x: 0, y: 0, w: wall.length, h: MUR_PLATE, label: 'PLT1', size: wall.studType });

  if (isRake) {
    // Sloped top plates - 2 plates that follow the rake
    const yLeftBottom = wall.rakeShortSide === 'left' ? wall.studHeight + MUR_PLATE : wall.studHeight + wall.length * slope + MUR_PLATE;
    const yRightBottom = wall.rakeShortSide === 'left' ? wall.studHeight + wall.length * slope + MUR_PLATE : wall.studHeight + MUR_PLATE;
    pieces.push({
      kind: 'plate', x: 0, y: 0, w: wall.length, h: MUR_PLATE, label: 'UTP1', size: wall.studType,
      polygon: [
        { x: 0, y: yLeftBottom },
        { x: wall.length, y: yRightBottom },
        { x: wall.length, y: yRightBottom + MUR_PLATE },
        { x: 0, y: yLeftBottom + MUR_PLATE },
      ],
    });
    pieces.push({
      kind: 'plate', x: 0, y: 0, w: wall.length, h: MUR_PLATE, label: 'UTP2', size: wall.studType,
      polygon: [
        { x: 0, y: yLeftBottom + MUR_PLATE },
        { x: wall.length, y: yRightBottom + MUR_PLATE },
        { x: wall.length, y: yRightBottom + MUR_PLATE * 2 },
        { x: 0, y: yLeftBottom + MUR_PLATE * 2 },
      ],
    });
  } else {
    pieces.push({ kind: 'plate', x: 0, y: wall.studHeight + MUR_PLATE, w: wall.length, h: MUR_PLATE, label: 'UTP1', size: wall.studType });
    pieces.push({ kind: 'plate', x: 0, y: wall.studHeight + MUR_PLATE * 2, w: wall.length, h: MUR_PLATE, label: 'UTP2', size: wall.studType });
  }

  // Extra top plate
  if (wall.hasExtraTopPlate) {
    const start = wall.extraTopPlateStart;
    const end = wall.extraTopPlateEnd;
    const w = wall.length - start - end;
    if (w > 0) {
      const yExtra = isRake
        ? Math.max(
            wall.rakeShortSide === 'left' ? wall.studHeight : wall.studHeight + wall.length * slope,
            wall.rakeShortSide === 'left' ? wall.studHeight + wall.length * slope : wall.studHeight,
          ) + MUR_PLATE * 3
        : wall.studHeight + MUR_PLATE * 3;
      pieces.push({
        kind: 'extraplate', x: start, y: yExtra, w, h: wall.extraTopPlateThickness,
        label: 'EXT1', size: wall.studType,
      });
    }
  }

  // === Corner studs ===
  let studN = 1;
  const studBot = MUR_PLATE;
  const leftStudH = studHeightAt(wall, MUR_STUD / 2);
  const rightStudH = studHeightAt(wall, wall.length - MUR_STUD / 2);
  pieces.push({ kind: 'stud', x: 0, y: studBot, w: MUR_STUD, h: leftStudH, label: `A${studN++}`, size: wall.studType });
  if (wall.doubleStuds) {
    pieces.push({ kind: 'stud', x: MUR_STUD, y: studBot, w: MUR_STUD, h: leftStudH, label: `A${studN++}`, size: wall.studType });
  }
  pieces.push({ kind: 'stud', x: wall.length - MUR_STUD, y: studBot, w: MUR_STUD, h: rightStudH, label: `A${studN++}`, size: wall.studType });
  if (wall.doubleStuds) {
    pieces.push({ kind: 'stud', x: wall.length - MUR_STUD * 2, y: studBot, w: MUR_STUD, h: rightStudH, label: `A${studN++}`, size: wall.studType });
  }
  studPositions.push(0, wall.length - MUR_STUD);

  // === Openings: king/jack/header/sill ===
  let kingN = 1;
  let jackN = 1;
  let headerN = 1;
  let sillN = 1;

  openings.forEach((op) => {
    const opStudH = studHeightAt(wall, op.x);
    const openBot = op.type === 'window' ? studBot + op.sillHeight : studBot;
    const headerBot = openBot + op.height;

    const leftKingX = op.x - MUR_STUD;
    const rightKingX = op.x + op.width;
    const leftKingH = studHeightAt(wall, leftKingX + MUR_STUD / 2);
    const rightKingH = studHeightAt(wall, rightKingX + MUR_STUD / 2);
    pieces.push({ kind: 'king', x: leftKingX, y: studBot, w: MUR_STUD, h: leftKingH, label: `AA${kingN++}`, size: wall.studType });
    pieces.push({ kind: 'king', x: rightKingX, y: studBot, w: MUR_STUD, h: rightKingH, label: `AA${kingN++}`, size: wall.studType });
    studPositions.push(leftKingX, rightKingX);

    pieces.push({ kind: 'jack', x: op.x, y: studBot, w: MUR_STUD, h: headerBot - studBot, label: `J${jackN++}`, size: wall.studType });
    pieces.push({ kind: 'jack', x: op.x + op.width - MUR_STUD, y: studBot, w: MUR_STUD, h: headerBot - studBot, label: `J${jackN++}`, size: wall.studType });

    pieces.push({ kind: 'header', x: op.x, y: headerBot, w: op.width, h: MUR_HEADER_H, label: `H${headerN++}`, size: '2-2x10' });

    if (op.type === 'window' && op.sillHeight > 0) {
      pieces.push({
        kind: 'sill', x: op.x + MUR_STUD, y: openBot - MUR_PLATE,
        w: op.width - 2 * MUR_STUD, h: MUR_PLATE,
        label: `S${sillN++}`, size: wall.studType,
      });
    }
  });

  // === Intermediate studs and cripples ===
  let cripN = 1;
  const startCenter = wall.layoutDirection === 'end' ? wall.length - wall.firstStud : wall.firstStud;
  const step = wall.layoutDirection === 'end' ? -wall.studSpacing : wall.studSpacing;
  let center = startCenter;
  const safety = 200;
  let iter = 0;

  while (iter++ < safety) {
    if (step > 0 && center >= wall.length - MUR_STUD / 2) break;
    if (step < 0 && center <= MUR_STUD / 2) break;

    const sx = center - MUR_STUD / 2;
    let inside: MurOpening | null = null;
    for (const op of openings) {
      const oL = op.x - MUR_STUD;
      const oR = op.x + op.width + MUR_STUD;
      if (sx + MUR_STUD > oL + 0.01 && sx < oR - 0.01) { inside = op; break; }
    }

    if (!inside) {
      if (sx > MUR_STUD - 0.01 && sx < wall.length - 2 * MUR_STUD + 0.01) {
        const sH = studHeightAt(wall, center);
        pieces.push({ kind: 'stud', x: sx, y: studBot, w: MUR_STUD, h: sH, label: `A${studN++}`, size: wall.studType });
        if (wall.doubleStuds) {
          pieces.push({ kind: 'stud', x: sx + MUR_STUD, y: studBot, w: MUR_STUD, h: sH, label: `A${studN++}`, size: wall.studType });
        }
        studPositions.push(center);
      }
    } else {
      const op = inside;
      const opTopStudH = studHeightAt(wall, center);
      const studTopY = studBot + opTopStudH;
      const openBot = op.type === 'window' ? studBot + op.sillHeight : studBot;
      const headerBot = openBot + op.height;
      const headerTop = headerBot + MUR_HEADER_H;
      if (headerTop < studTopY - 0.01) {
        pieces.push({
          kind: 'cripple', x: sx, y: headerTop, w: MUR_STUD, h: studTopY - headerTop,
          label: `N${cripN++}`, size: wall.studType,
        });
      }
      if (op.type === 'window' && op.sillHeight > MUR_PLATE) {
        const top = openBot - MUR_PLATE;
        if (top > studBot + 0.01) {
          pieces.push({
            kind: 'cripple', x: sx, y: studBot, w: MUR_STUD, h: top - studBot,
            label: `N${cripN++}`, size: wall.studType,
          });
        }
      }
    }
    center += step;
  }

  // === Blocking ===
  if (wall.hasBlocking && wall.blockingSpacing > 0) {
    let blkN = 1;
    let yPos = MUR_PLATE + wall.blockingSpacing;
    // In rake mode, use minimum stud height to avoid blocking extending past low side
    const blockingMaxY = isRake ? rakeMinH - MUR_PLATE : wall.studHeight - MUR_PLATE;
    while (yPos < blockingMaxY) {
      pieces.push({
        kind: 'blocking', x: MUR_STUD, y: yPos, w: wall.length - 2 * MUR_STUD, h: MUR_PLATE,
        label: `BLK${blkN++}`, size: wall.studType,
      });
      yPos += wall.blockingSpacing;
    }
  }

  // === Tall wall floor band ===
  if (wall.wallMode === 'tall' && wall.hasFloorBand) {
    pieces.push({
      kind: 'extraplate', x: 0, y: wall.floorBandY, w: wall.length, h: wall.floorBandHeight,
      label: 'BAND', size: wall.studType,
    });
  }

  studPositions.sort((a, b) => a - b);
  const dedupedStuds: number[] = [];
  for (const p of studPositions) {
    if (dedupedStuds.length === 0 || Math.abs(dedupedStuds[dedupedStuds.length - 1] - p) > 0.1) {
      dedupedStuds.push(p);
    }
  }

  return { pieces, totalH, studPositions: dedupedStuds, rakeMaxH, rakeMinH };
}

// ============================================
// CUT LIST
// ============================================

export function generateCutList(pieces: MurPiece[]): MurCutListItem[] {
  const groups = new Map<string, MurCutListItem>();
  for (const p of pieces) {
    const len = Math.max(p.w, p.h);
    const size = p.size || '2x4';
    const use = pieceUse(p.kind);
    const key = `${size}-${len.toFixed(3)}-${use}`;
    const existing = groups.get(key);
    if (existing) {
      existing.qty++;
    } else {
      groups.set(key, {
        label: p.label?.replace(/\d+$/, '') || 'X',
        qty: 1,
        size,
        length: len,
        use,
      });
    }
  }
  const sorted = Array.from(groups.values()).sort((a, b) => {
    if (a.use !== b.use) return a.use.localeCompare(b.use);
    return b.length - a.length;
  });
  return sorted;
}

export function tallyPieces(pieces: MurPiece[]): MurCounts {
  const out: MurCounts = {
    studs: 0, kings: 0, jacks: 0, cripples: 0,
    headers: 0, sills: 0, plates: 0, blockings: 0,
  };
  for (const p of pieces) {
    if (p.kind === 'stud') out.studs++;
    else if (p.kind === 'king') out.kings++;
    else if (p.kind === 'jack') out.jacks++;
    else if (p.kind === 'cripple') out.cripples++;
    else if (p.kind === 'header') out.headers++;
    else if (p.kind === 'sill') out.sills++;
    else if (p.kind === 'plate' || p.kind === 'extraplate') out.plates++;
    else if (p.kind === 'blocking') out.blockings++;
  }
  return out;
}

// ============================================
// VALIDATIONS CCQ / CNB (Quebec)
// ============================================

export function validateWallCCQ(wall: MurWall, openings: MurOpening[]): MurValidation[] {
  const warnings: MurValidation[] = [];

  // 1. Espacement montants (CCQ 9.23.10.2 - max 16 po pour murs porteurs)
  if (wall.studSpacing > 16) {
    warnings.push({
      level: 'warning',
      code: 'CCQ 9.23.10.2',
      message: `Espacement des montants ${formatFraction(wall.studSpacing)} > 16 po. Espacement max 16 po pour murs porteurs.`,
    });
  }

  // 2. Hauteur linteau (min 9 1/4 po)
  if (MUR_HEADER_H < 9.25) {
    warnings.push({
      level: 'warning',
      code: 'CCQ 9.23.12',
      message: 'Hauteur linteau insuffisante (min 9 1/4 po).',
    });
  }

  // 3-5. Validations par ouverture
  for (const op of openings) {
    if (op.type === 'door') {
      // 3. Largeur porte (min 30")
      if (op.width < 30) {
        warnings.push({
          level: 'info',
          code: 'CNB 9.5.5',
          message: `Porte etroite (${formatFraction(op.width)} < 30 po), verifier accessibilite.`,
        });
      }
      // 4. Hauteur porte (min 80" = 6'8")
      if (op.height < 80) {
        warnings.push({
          level: 'warning',
          code: 'CNB 9.6.5',
          message: `Hauteur porte ${formatFraction(op.height)} inferieure au standard (6'8").`,
        });
      }
    } else if (op.type === 'window') {
      // 5. Largeur fenetre (> 84")
      if (op.width > 84) {
        warnings.push({
          level: 'warning',
          code: 'CCQ 9.23.12.4',
          message: `Fenetre large (${formatFraction(op.width)} > 84 po), verifier dimensionnement linteau.`,
        });
      }
    }
  }

  // 6-7. Hauteur du mur
  const wallHeightTotal = wall.studHeight + MUR_PLATE * 3;
  if (wallHeightTotal > 144) {
    warnings.push({
      level: 'warning',
      code: 'CCQ 9.23.13',
      message: `Mur haut (${formatFraction(wallHeightTotal)} > 12'), considerer entretoise ou structure renforcee.`,
    });
  } else if (wallHeightTotal < 84) {
    warnings.push({
      level: 'info',
      code: 'CNB 9.5.3',
      message: `Hauteur sous-standard (${formatFraction(wallHeightTotal)} < 7').`,
    });
  }

  // 8. Distance entre ouvertures (min 16 po entre 2 ouvertures)
  const sorted = [...openings].sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const gap = curr.x - (prev.x + prev.width);
    if (gap < 16 && gap >= 0) {
      warnings.push({
        level: 'warning',
        code: 'CCQ 9.23.10.5',
        message: `Espace insuffisant entre ouvertures (${formatFraction(gap)} < 16 po).`,
      });
    }
  }

  // 9. Distance ouverture/coin (min 6 po du debut ou fin du mur)
  for (const op of openings) {
    const distStart = op.x;
    const distEnd = wall.length - (op.x + op.width);
    if (distStart < 6) {
      warnings.push({
        level: 'warning',
        code: 'CCQ 9.23.10.6',
        message: `Ouverture trop proche du coin debut (${formatFraction(distStart)} < 6 po).`,
      });
    }
    if (distEnd < 6) {
      warnings.push({
        level: 'warning',
        code: 'CCQ 9.23.10.6',
        message: `Ouverture trop proche du coin fin (${formatFraction(distEnd)} < 6 po).`,
      });
    }
  }

  // 10. Mode rake: pente forte (>12/12)
  if (wall.wallMode === 'rake' && wall.rakePitch > 12) {
    warnings.push({
      level: 'info',
      code: 'CNB 9.26',
      message: `Pente forte (${wall.rakePitch}/12 > 12/12), verifier conception.`,
    });
  }

  return warnings;
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function MursParametriquePanel() {
  // ===== Project state =====
  const [projectName, setProjectName] = useState('Nouveau Projet');
  const [projectDbId, setProjectDbId] = useState<number | null>(null);
  const [walls, setWallsRaw] = useState<MurWallEntry[]>([
    { id: 1, name: 'Mur 1', wall: DEFAULT_WALL, openings: DEFAULT_OPENINGS },
  ]);
  const [currentWallIdx, setCurrentWallIdx] = useState(0);

  // ===== UI state =====
  const [murTab, setMurTab] = useState<'wall' | 'openings' | 'coupe' | 'details'>('wall');
  const [viewMode, setViewMode] = useState<MurViewMode>('front');
  const [zoom, setZoom] = useState(5);
  const [expandedId, setExpandedId] = useState<number | null>(1);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['blocking', 'topplate', 'sheathing', 'rake', 'tall', 'eg-conformite']));
  const [egConfig, setEgConfig] = useState<MurEgConfig>(DEFAULT_EG_CONFIG);

  // ===== Save/Load state =====
  const [savedProjects, setSavedProjects] = useState<CalculatorHistoryItem[]>([]);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<MurToast | null>(null);

  // ===== Phase 7a: Export Devis state =====
  const devisStore = useDevisStore();
  const [showDevisModal, setShowDevisModal] = useState(false);
  const [exportingDevis, setExportingDevis] = useState(false);
  const [createNewDevis, setCreateNewDevis] = useState(false);
  const [newDevisName, setNewDevisName] = useState('');
  const [selectedDevisId, setSelectedDevisId] = useState<number | null>(null);

  // ===== Phase 7b: Create BOM Composite state =====
  const [creatingComposite, setCreatingComposite] = useState(false);

  // ===== History (undo/redo) - snapshots full project =====
  const [history, setHistory] = useState<MurProjectSnapshot[]>([{
    walls: [{ id: 1, name: 'Mur 1', wall: DEFAULT_WALL, openings: DEFAULT_OPENINGS }],
    currentWallIdx: 0,
    projectName: 'Nouveau Projet',
  }]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const skipNextHistory = useRef(false);

  // ===== Derived current wall (safety: guarantee non-undefined) =====
  const FALLBACK_ENTRY: MurWallEntry = useMemo(() => ({
    id: 0, name: 'Mur 1', wall: DEFAULT_WALL, openings: DEFAULT_OPENINGS,
  }), []);
  const currentEntry = walls[currentWallIdx] ?? walls[0] ?? FALLBACK_ENTRY;
  const wall = currentEntry.wall;
  const openings = currentEntry.openings;

  // ===== Toast helper =====
  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ===== Push to history =====
  const pushHistory = useCallback((newWalls: MurWallEntry[], newIdx: number, newName: string) => {
    setHistory((h) => {
      const trimmed = h.slice(0, historyIdx + 1);
      trimmed.push({ walls: newWalls, currentWallIdx: newIdx, projectName: newName });
      return trimmed.slice(-MAX_HISTORY);
    });
    setHistoryIdx((idx) => Math.min(idx + 1, MAX_HISTORY - 1));
  }, [historyIdx]);

  // ===== Setter wrapper that snapshots =====
  const setWalls = useCallback((updater: MurWallEntry[] | ((w: MurWallEntry[]) => MurWallEntry[])) => {
    setWallsRaw((prev) => {
      const next = typeof updater === 'function' ? (updater as (w: MurWallEntry[]) => MurWallEntry[])(prev) : updater;
      if (!skipNextHistory.current) pushHistory(next, currentWallIdx, projectName);
      return next;
    });
  }, [currentWallIdx, projectName, pushHistory]);

  // ===== Undo / Redo =====
  const undo = useCallback(() => {
    if (historyIdx <= 0) return;
    const target = history[historyIdx - 1];
    skipNextHistory.current = true;
    setWallsRaw(target.walls);
    setCurrentWallIdx(target.currentWallIdx);
    setProjectName(target.projectName);
    setHistoryIdx((idx) => idx - 1);
    setTimeout(() => { skipNextHistory.current = false; }, 0);
  }, [history, historyIdx]);

  const redo = useCallback(() => {
    if (historyIdx >= history.length - 1) return;
    const target = history[historyIdx + 1];
    skipNextHistory.current = true;
    setWallsRaw(target.walls);
    setCurrentWallIdx(target.currentWallIdx);
    setProjectName(target.projectName);
    setHistoryIdx((idx) => idx + 1);
    setTimeout(() => { skipNextHistory.current = false; }, 0);
  }, [history, historyIdx]);

  const canUndo = historyIdx > 0;
  const canRedo = historyIdx < history.length - 1;

  // ===== SVG ref (for PDF export) =====
  const svgRef = useRef<SVGSVGElement>(null);

  // ===== Computed =====
  const { pieces, totalH, studPositions, rakeMaxH, rakeMinH } = useMemo(
    () => computeWall(wall, openings),
    [wall, openings],
  );
  const counts = useMemo(() => tallyPieces(pieces), [pieces]);
  const cutList = useMemo(() => generateCutList(pieces), [pieces]);
  const validations = useMemo(() => validateWallCCQ(wall, openings), [wall, openings]);
  const diagonal = Math.sqrt(wall.length ** 2 + (wall.studHeight + MUR_PLATE * 2) ** 2);

  // ===== Wall config update helpers =====
  const updateWall = <K extends keyof MurWall>(k: K, v: MurWall[K]) =>
    setWalls((prev) => prev.map((entry, i) =>
      i === currentWallIdx ? { ...entry, wall: { ...entry.wall, [k]: v } } : entry,
    ));

  const updateOp = <K extends keyof MurOpening>(id: number, k: K, v: MurOpening[K]) =>
    setWalls((prev) => prev.map((entry, i) =>
      i === currentWallIdx
        ? { ...entry, openings: entry.openings.map((o) => (o.id === id ? { ...o, [k]: v } : o)) }
        : entry,
    ));

  const removeOp = (id: number) => {
    setWalls((prev) => prev.map((entry, i) =>
      i === currentWallIdx
        ? { ...entry, openings: entry.openings.filter((o) => o.id !== id) }
        : entry,
    ));
    setExpandedId(null);
  };

  const addOp = (type: 'window' | 'door') => {
    const id = Math.max(0, ...openings.map((o) => o.id)) + 1;
    const base: Omit<MurOpening, 'id'> = type === 'window'
      ? { type, shape: 'rect', x: 24, width: 36, height: 48, sillHeight: 36 }
      : { type, shape: 'rect', x: 24, width: 32, height: 80, sillHeight: 0 };
    setWalls((prev) => prev.map((entry, i) =>
      i === currentWallIdx
        ? { ...entry, openings: [...entry.openings, { id, ...base }] }
        : entry,
    ));
    setExpandedId(id);
    setMurTab('openings');
  };

  const toggleCollapsed = (key: string) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const resetWall = () => {
    setWalls((prev) => prev.map((entry, i) =>
      i === currentWallIdx
        ? { ...entry, wall: { ...DEFAULT_WALL }, openings: [...DEFAULT_OPENINGS] }
        : entry,
    ));
  };

  // ===== Wall management (multi-walls) =====
  const switchWall = (idx: number) => {
    if (idx >= 0 && idx < walls.length) setCurrentWallIdx(idx);
  };

  const addWall = () => {
    const id = Math.max(0, ...walls.map((w) => w.id)) + 1;
    const newEntry: MurWallEntry = {
      id,
      name: `Mur ${walls.length + 1}`,
      wall: { ...DEFAULT_WALL },
      openings: [...DEFAULT_OPENINGS],
    };
    const newWalls = [...walls, newEntry];
    setWalls(newWalls);
    setCurrentWallIdx(newWalls.length - 1);
  };

  const removeWall = (idx: number) => {
    if (walls.length === 1) {
      // Last wall: reset
      setWalls([{ id: 1, name: 'Mur 1', wall: { ...DEFAULT_WALL }, openings: [...DEFAULT_OPENINGS] }]);
      setCurrentWallIdx(0);
      return;
    }
    const newWalls = walls.filter((_, i) => i !== idx);
    setWalls(newWalls);
    if (currentWallIdx >= newWalls.length) setCurrentWallIdx(newWalls.length - 1);
    else if (currentWallIdx > idx) setCurrentWallIdx(currentWallIdx - 1);
  };

  const renameWall = (idx: number, name: string) => {
    // Direct update WITHOUT history push (rename keystrokes would pollute undo stack)
    setWallsRaw((prev) => prev.map((entry, i) => (i === idx ? { ...entry, name } : entry)));
  };

  const duplicateWall = (idx: number) => {
    const src = walls[idx];
    if (!src) return;
    const id = Math.max(0, ...walls.map((w) => w.id)) + 1;
    const newEntry: MurWallEntry = {
      id,
      name: `${src.name} (copie)`,
      wall: { ...src.wall },
      openings: src.openings.map((o) => ({ ...o })),
    };
    const newWalls = [...walls.slice(0, idx + 1), newEntry, ...walls.slice(idx + 1)];
    setWalls(newWalls);
    setCurrentWallIdx(idx + 1);
  };

  // ===== Project management (save/load/new) =====
  const saveProject = async () => {
    if (!projectName.trim()) {
      showToast('Nom du projet requis', 'error');
      return;
    }
    setSaving(true);
    try {
      const aggregate = walls.reduce((acc, entry) => {
        const c = tallyPieces(computeWall(entry.wall, entry.openings).pieces);
        return {
          studs: acc.studs + c.studs,
          kings: acc.kings + c.kings,
          jacks: acc.jacks + c.jacks,
          cripples: acc.cripples + c.cripples,
          headers: acc.headers + c.headers,
          sills: acc.sills + c.sills,
          plates: acc.plates + c.plates,
          blockings: acc.blockings + c.blockings,
        };
      }, { studs: 0, kings: 0, jacks: 0, cripples: 0, headers: 0, sills: 0, plates: 0, blockings: 0 });
      const res = await createHistory({
        calculator_id: 'murs-parametrique',
        label: projectName,
        inputs: { walls, projectName, version: 1 },
        results: { totalCounts: aggregate, wallCount: walls.length },
      });
      setProjectDbId(res.id);
      showToast(`Projet sauvegarde (#${res.id})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      showToast(`Echec sauvegarde: ${msg}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const openLoadModal = async () => {
    setShowLoadModal(true);
    setLoadingProjects(true);
    try {
      const res = await listHistory('murs-parametrique', 50);
      setSavedProjects(res.items);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      showToast(`Echec chargement liste: ${msg}`, 'error');
    } finally {
      setLoadingProjects(false);
    }
  };

  const loadProject = (item: CalculatorHistoryItem) => {
    const inputs = item.inputs as { walls?: MurWallEntry[]; projectName?: string };
    if (!inputs.walls || !Array.isArray(inputs.walls) || inputs.walls.length === 0) {
      showToast('Format de projet invalide', 'error');
      return;
    }
    skipNextHistory.current = true;
    const restoredName = inputs.projectName ?? item.label;
    setWallsRaw(inputs.walls);
    setCurrentWallIdx(0);
    setProjectName(restoredName);
    setProjectDbId(item.id);
    setHistory([{ walls: inputs.walls, currentWallIdx: 0, projectName: restoredName }]);
    setHistoryIdx(0);
    setTimeout(() => { skipNextHistory.current = false; }, 0);
    setShowLoadModal(false);
    showToast(`Projet "${item.label}" charge`);
  };

  const removeSavedProject = async (id: number) => {
    try {
      await deleteHistoryItem(id);
      setSavedProjects((prev) => prev.filter((p) => p.id !== id));
      if (projectDbId === id) setProjectDbId(null);
      showToast('Projet supprime');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      showToast(`Echec suppression: ${msg}`, 'error');
    }
  };

  const newProject = () => {
    skipNextHistory.current = true;
    const initial: MurWallEntry[] = [{ id: 1, name: 'Mur 1', wall: { ...DEFAULT_WALL }, openings: [...DEFAULT_OPENINGS] }];
    setWallsRaw(initial);
    setCurrentWallIdx(0);
    setProjectName('Nouveau Projet');
    setProjectDbId(null);
    setHistory([{ walls: initial, currentWallIdx: 0, projectName: 'Nouveau Projet' }]);
    setHistoryIdx(0);
    setTimeout(() => { skipNextHistory.current = false; }, 0);
    showToast('Nouveau projet cree');
  };

  // ===== Phase 7a: Export to devis =====
  // Effect: fetch devis list when modal opens (uses the global store).
  useEffect(() => {
    if (showDevisModal) {
      devisStore.fetchAll().catch(() => {
        // Silently handled — store sets `error` and we'll surface it via UI.
      });
    }
  }, [showDevisModal, devisStore]);

  const openDevisModal = () => {
    setSelectedDevisId(null);
    setNewDevisName(projectName);
    setCreateNewDevis(false);
    setShowDevisModal(true);
  };

  const handleExportToDevis = async () => {
    setExportingDevis(true);
    try {
      let targetDevisId: number | null = selectedDevisId;
      if (createNewDevis) {
        const name = newDevisName.trim() || projectName || 'Nouveau devis';
        const created = await devisStore.create({
          nomProjet: name,
          description: 'Genere depuis calculateur Murs parametriques',
        });
        targetDevisId = created.id;
      }
      if (!targetDevisId) {
        showToast('Veuillez selectionner un devis ou en creer un', 'error');
        setExportingDevis(false);
        return;
      }

      // Add a line per wall in the project.
      let successCount = 0;
      for (let i = 0; i < walls.length; i++) {
        const entry = walls[i];
        const wallComputed = computeWall(entry.wall, entry.openings);
        const wallCounts = tallyPieces(wallComputed.pieces);
        const description = `${entry.name} - ${formatFraction(entry.wall.length)} x ${formatFraction(entry.wall.studHeight)} - ${wallCounts.studs} montants ${entry.wall.studType}`;
        const blockingLabel = entry.wall.hasBlocking
          ? `blocage ${formatFraction(entry.wall.blockingSpacing)}`
          : 'sans blocage';
        const doubleLabel = entry.wall.doubleStuds ? 'montants doubles' : 'montants simples';
        const notes = `Espacement ${formatFraction(entry.wall.studSpacing)} | ${blockingLabel} | ${doubleLabel} | ${wallCounts.headers} linteaux | ${wallCounts.jacks} jambages | ${wallCounts.sills} lisses d'appui`;
        try {
          await devisStore.addLigne(targetDevisId, {
            description,
            quantite: 1,
            unite: 'unite',
            prixUnitaire: 0,
            categorie: 'Charpente murale',
            notesLigne: notes,
            sequenceLigne: i,
          });
          successCount++;
        } catch (err) {
          console.error(`[Murs Phase7a] Echec ajout ligne mur ${entry.name}:`, err);
        }
      }

      if (successCount === walls.length) {
        showToast(`${successCount} mur(s) exporte(s) au devis #${targetDevisId}`);
      } else if (successCount > 0) {
        showToast(`${successCount}/${walls.length} mur(s) exporte(s) au devis #${targetDevisId}`, 'error');
      } else {
        showToast('Echec export: aucune ligne ajoutee', 'error');
      }
      setShowDevisModal(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      showToast(`Echec export devis: ${msg}`, 'error');
    } finally {
      setExportingDevis(false);
    }
  };

  // ===== Phase 7b: Create BOM Composite (Metre) =====
  const handleCreateBomComposite = async () => {
    setCreatingComposite(true);
    try {
      const compositeName = `Mur composite - ${wall.studType} ${formatFraction(wall.length)} x ${formatFraction(wall.studHeight)}`;
      // Build the parametric inputs that the user can override per layer in Metre.
      const bomInputs = [
        { name: 'longueur_mur', unit: 'po', description: 'Longueur mur (pouces)', default: wall.length },
        { name: 'hauteur_montant', unit: 'po', description: 'Hauteur des montants (pouces)', default: wall.studHeight },
        { name: 'espacement_cc', unit: 'po', description: 'Espacement centre-a-centre montants', default: wall.studSpacing },
        { name: 'montants_doublage', unit: 'bool', description: 'Doubler les montants (0=non, 1=oui)', default: wall.doubleStuds ? 1 : 0 },
        { name: 'blocage_active', unit: 'bool', description: 'Activer blocage (0=non, 1=oui)', default: wall.hasBlocking ? 1 : 0 },
        { name: 'espacement_blocage', unit: 'po', description: 'Espacement vertical blocage', default: wall.blockingSpacing },
      ];

      // Create the parent composite product. Casts to `unknown` to feed the
      // Product type which requires more fields than the backend strictly needs.
      const createPayload = {
        name: compositeName,
        category: 'Murs - Composites Parametriques',
        dimensions: `${formatFraction(wall.length)} x ${formatFraction(wall.studHeight)}`,
        price: 0,
        priceUnit: 'un',
        color: '#7c3aed',
        wastePct: 0,
        isComposite: true,
        displayMode: 'detailed' as const,
        description: 'Generateur de BOM pour mur charpente legere (Constructo AI)',
        bomInputs,
        numeroSection: '04',
      };

      const created = await createMetreProduct(createPayload as Parameters<typeof createMetreProduct>[0]);
      const productId = (created as { id: string | number }).id;

      // Try to resolve child products from the tenant catalog by name/category.
      // If none match, log a skip note and continue (the user will link manually).
      type CatalogItem = { id: string | number; name: string; category?: string };
      let catalog: CatalogItem[] = [];
      try {
        const list = await listMetreProducts();
        catalog = (list as unknown as CatalogItem[]) ?? [];
      } catch {
        catalog = [];
      }

      const findProductId = (predicate: (p: CatalogItem) => boolean): number | null => {
        const found = catalog.find(predicate);
        if (!found) return null;
        const idNum = typeof found.id === 'number' ? found.id : parseInt(String(found.id), 10);
        return Number.isFinite(idNum) && idNum > 0 ? idNum : null;
      };

      const childCompCount = Math.ceil(wall.length / wall.studSpacing) + 1;
      const studsNeeded = childCompCount + (wall.doubleStuds ? childCompCount : 0);
      const platesNeeded = 3 * Math.ceil(wall.length / 96);
      const blockingNeeded = wall.hasBlocking
        ? (Math.max(0, Math.ceil(wall.studHeight / wall.blockingSpacing) - 1) * childCompCount)
        : 0;

      const studSize = wall.studType.toLowerCase();
      const componentsToAdd: Array<{
        kind: string;
        formula: string;
        notes: string;
        matcher: (p: CatalogItem) => boolean;
      }> = [
        {
          kind: `Montants ${wall.studType}`,
          formula: 'CEIL(longueur_mur / espacement_cc) + 1 + (montants_doublage * (CEIL(longueur_mur / espacement_cc) + 1))',
          notes: `Montants verticaux + doublage optionnel (${wall.studType}). Estime: ${studsNeeded} mt.`,
          matcher: (p) => /montant/i.test(p.name) && p.name.toLowerCase().includes(studSize),
        },
        {
          kind: `Lisses ${wall.studType}`,
          formula: '3 * CEIL(longueur_mur / 96)',
          notes: `Lisse basse + 2 lisses hautes (planches 8' = 96"). Estime: ${platesNeeded} pieces.`,
          matcher: (p) => /lisse|sabliere|plate/i.test(p.name) && p.name.toLowerCase().includes(studSize),
        },
        {
          kind: `Blocage ${wall.studType}`,
          formula: 'blocage_active * (CEIL(hauteur_montant / espacement_blocage) - 1) * CEIL(longueur_mur / espacement_cc)',
          notes: `Blocage horizontal entre montants. Estime: ${blockingNeeded} pieces.`,
          matcher: (p) => /blocage|blocking/i.test(p.name) && p.name.toLowerCase().includes(studSize),
        },
      ];

      let addedCount = 0;
      const skipped: string[] = [];
      for (let i = 0; i < componentsToAdd.length; i++) {
        const comp = componentsToAdd[i];
        const childId = findProductId(comp.matcher);
        if (childId == null) {
          skipped.push(comp.kind);
          continue;
        }
        try {
          await addMetreComponent(productId, {
            childProductId: childId,
            quantityPerUnit: 1,
            formula: comp.formula,
            notes: `${comp.kind} - ${comp.notes}`,
            sortOrder: i,
          });
          addedCount++;
        } catch (err) {
          console.error(`[Murs Phase7b] Echec ajout composant ${comp.kind}:`, err);
          skipped.push(comp.kind);
        }
      }

      if (skipped.length === 0) {
        showToast(`Composite BOM cree (#${productId}) avec ${addedCount} composant(s)`);
      } else if (addedCount > 0) {
        showToast(`Composite BOM cree (#${productId}) - ${addedCount} composant(s), ${skipped.length} a lier manuellement`);
      } else {
        showToast(`Composite BOM cree (#${productId}) - composants a lier manuellement dans Metre`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      showToast(`Echec creation composite: ${msg}`, 'error');
    } finally {
      setCreatingComposite(false);
    }
  };

  // ===== SVG dims =====
  const pad = 60;
  const svgW = wall.length * zoom + pad * 2;
  const svgH = totalH * zoom + pad * 2 + 50;
  const tx = (x: number) => x * zoom + pad;
  const ty = (y: number) => svgH - pad - 40 - y * zoom;

  // ===== Export cut list as CSV (with proper escaping) =====
  const exportCutListCsv = () => {
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const safe = (v: string) => v.replace(/[^\w-]/g, '_');
    const rows = ['Etiquette,Quantite,Taille,Longueur (po),Usage'];
    for (const item of cutList) {
      rows.push([
        escape(item.label),
        item.qty.toString(),
        escape(item.size),
        escape(formatFraction(item.length).replace(/"/g, 'po')),
        escape(item.use),
      ].join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safe(projectName)}-${safe(currentEntry.name)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ===== Helper: convert SVG element to PNG data URL =====
  const svgToPngDataUrl = (
    svgEl: SVGSVGElement,
    targetW: number,
    targetH: number,
  ): Promise<string> => {
    return new Promise((resolve, reject) => {
      try {
        const cloned = svgEl.cloneNode(true) as SVGSVGElement;
        // Ensure xmlns attributes are present for standalone serialization
        if (!cloned.getAttribute('xmlns')) cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        if (!cloned.getAttribute('xmlns:xlink')) cloned.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        const serializer = new XMLSerializer();
        const svgStr = serializer.serializeToString(cloned);
        const svg64 = typeof window !== 'undefined' && window.btoa
          ? window.btoa(unescape(encodeURIComponent(svgStr)))
          : '';
        const dataUri = `data:image/svg+xml;base64,${svg64}`;
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(targetW));
          canvas.height = Math.max(1, Math.round(targetH));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas 2D context indisponible'));
            return;
          }
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('Echec chargement SVG'));
        img.src = dataUri;
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Erreur conversion SVG'));
      }
    });
  };

  // ===== Export PDF (plan + cut list) =====
  const exportPdf = async () => {
    const safe = (v: string) => v.replace(/[^\w-]/g, '_');
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 12;

      // ===== Page 1: Header =====
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(15, 41, 66);
      doc.text(projectName || 'Projet', margin, margin + 6);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(80, 80, 80);
      doc.text(`Mur : ${currentEntry.name}`, margin, margin + 13);

      const dateStr = new Date().toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
      doc.setFontSize(9);
      doc.text(dateStr, pageW - margin, margin + 6, { align: 'right' });

      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      const dimText = `Longueur : ${formatFraction(wall.length)}   |   Hauteur totale : ${formatFraction(totalH)}   |   Mode : ${
        wall.wallMode === 'standard' ? 'Standard' : wall.wallMode === 'rake' ? `Pignon ${wall.rakePitch}/12` : 'Mur haut'
      }`;
      doc.text(dimText, margin, margin + 20);

      // Divider
      doc.setDrawColor(123, 175, 212);
      doc.setLineWidth(0.5);
      doc.line(margin, margin + 24, pageW - margin, margin + 24);

      // ===== Page 1: Plan (SVG -> PNG) =====
      let planEndY = margin + 28;
      const svgEl = svgRef.current;
      if (svgEl) {
        const availW = pageW - margin * 2;
        const planMaxH = 130;
        const ratio = svgW > 0 ? svgH / svgW : 1;
        let planW = availW;
        let planH = planW * ratio;
        if (planH > planMaxH) {
          planH = planMaxH;
          planW = planH / ratio;
        }
        // Render at higher resolution for crispness
        const scale = 2;
        const pngDataUrl = await svgToPngDataUrl(svgEl, svgW * scale, svgH * scale);
        const planX = margin + (availW - planW) / 2;
        doc.addImage(pngDataUrl, 'PNG', planX, planEndY, planW, planH);
        planEndY = planEndY + planH + 6;
      }

      // ===== Page 1: Stats summary table =====
      const statsRows: [string, string][] = [
        ['Montants (incl. king)', String(counts.studs + counts.kings)],
        ['Jambages (jacks)', String(counts.jacks)],
        ['Montants nains', String(counts.cripples)],
        ['Linteaux', String(counts.headers)],
        ['Lisses d\'appui', String(counts.sills)],
        ['Lisses (sole + sablieres)', String(counts.plates)],
      ];
      if (counts.blockings > 0) statsRows.push(['Blocages', String(counts.blockings)]);
      statsRows.push(['Diagonale (equerre)', formatFraction(diagonal)]);

      autoTable(doc, {
        startY: planEndY,
        head: [['Decompte', 'Valeur']],
        body: statsRows,
        margin: { left: margin, right: margin },
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { halign: 'right', cellWidth: 40, fontStyle: 'bold' },
        },
        theme: 'grid',
      });

      // Footer page 1
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Constructo AI - ${projectName}`, margin, pageH - 6);
      doc.text(`Page 1 / 2`, pageW - margin, pageH - 6, { align: 'right' });

      // ===== Page 2: Cut list =====
      doc.addPage();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(15, 41, 66);
      doc.text(`Liste de coupe - ${currentEntry.name}`, margin, margin + 6);
      doc.setDrawColor(123, 175, 212);
      doc.setLineWidth(0.5);
      doc.line(margin, margin + 9, pageW - margin, margin + 9);

      const cutBody = cutList.map((item) => [
        item.label,
        String(item.qty),
        item.size,
        formatFraction(item.length).replace(/"/g, ' po'),
        item.use,
      ]);

      autoTable(doc, {
        startY: margin + 14,
        head: [['Etiquette', 'Qte', 'Taille', 'Longueur', 'Usage']],
        body: cutBody,
        margin: { left: margin, right: margin },
        styles: { fontSize: 9, cellPadding: 1.8 },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        columnStyles: {
          0: { cellWidth: 28, fontStyle: 'bold' },
          1: { halign: 'right', cellWidth: 18 },
          2: { cellWidth: 22 },
          3: { halign: 'right', cellWidth: 32 },
          4: { cellWidth: 'auto' },
        },
        theme: 'grid',
        foot: [['Total', String(cutList.reduce((s, i) => s + i.qty, 0)), '', '', '']],
        footStyles: { fillColor: [220, 230, 245], textColor: 15, fontStyle: 'bold' },
      });

      // Footer page 2
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Constructo AI - ${projectName}`, margin, pageH - 6);
      doc.text(`Page 2 / 2`, pageW - margin, pageH - 6, { align: 'right' });

      doc.save(`${safe(projectName)}-${safe(currentEntry.name)}-plan.pdf`);
      showToast('PDF exporte');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      showToast(`Echec export PDF: ${msg}`, 'error');
    }
  };

  // ===== 3D transform =====
  const svgTransform = viewMode === '3d' ? 'perspective(800px) rotateY(-25deg) rotateX(8deg)' : viewMode === 'back' ? 'scaleX(-1)' : 'none';

  return (
    <div className="w-full mx-auto space-y-3">
      {/* Toast notification */}
      {toast && (
        <div className={`p-2.5 rounded-lg text-sm font-medium text-center shadow-md ${
          toast.type === 'success'
            ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 border border-green-300 dark:border-green-700'
            : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 border border-red-300 dark:border-red-700'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Project bar */}
      <Card className="p-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Nom du projet"
            aria-label="Nom du projet"
            className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:outline-none focus:border-[#7BAFD4]"
          />
          {projectDbId && (
            <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400 shrink-0">#{projectDbId}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={newProject}
            className="flex-1 py-2 text-xs font-semibold rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center gap-1.5 transition">
            <FileText className="w-3.5 h-3.5" /> Nouveau
          </button>
          <button type="button" onClick={openLoadModal}
            className="flex-1 py-2 text-xs font-semibold rounded-md bg-[#7BAFD4]/10 text-[#4a7fa8] dark:text-[#9BC8E4] hover:bg-[#7BAFD4]/20 flex items-center justify-center gap-1.5 transition">
            <FolderOpen className="w-3.5 h-3.5" /> Charger
          </button>
          <button type="button" onClick={saveProject} disabled={saving}
            className="flex-1 py-2 text-xs font-semibold rounded-md bg-[#2563eb] text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition">
            <Save className="w-3.5 h-3.5" /> {saving ? 'Sauve...' : 'Sauver'}
          </button>
        </div>

        {/* Phase 7: Devis + BOM Metre integration */}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={openDevisModal}
            className="py-2 text-xs font-semibold rounded-md bg-[#16a34a] text-white hover:bg-green-700 flex items-center justify-center gap-1.5 transition">
            <Send className="w-3.5 h-3.5" /> Envoyer au devis
          </button>
          <button type="button" onClick={handleCreateBomComposite} disabled={creatingComposite}
            className="py-2 text-xs font-semibold rounded-md bg-[#7c3aed] text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition">
            <Layers className="w-3.5 h-3.5" /> {creatingComposite ? 'Creation...' : 'Creer BOM Metre'}
          </button>
        </div>

        {/* Walls tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
          {walls.map((entry, idx) => (
            <button key={entry.id} type="button"
              onClick={() => switchWall(idx)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition flex items-center gap-1.5 shrink-0 ${
                idx === currentWallIdx
                  ? 'bg-[#2563eb] text-white shadow'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}>
              <span>{entry.name}</span>
              {idx === currentWallIdx && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Supprimer ce mur"
                  onClick={(e) => { e.stopPropagation(); removeWall(idx); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); removeWall(idx); } }}
                  className="hover:bg-white/20 rounded p-0.5 cursor-pointer">
                  <X className="w-3 h-3" />
                </span>
              )}
            </button>
          ))}
          <button type="button" onClick={addWall}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-[#7BAFD4]/10 text-[#4a7fa8] dark:text-[#9BC8E4] hover:bg-[#7BAFD4]/20 whitespace-nowrap flex items-center gap-1 shrink-0 transition"
            aria-label="Ajouter un mur">
            <Plus className="w-3 h-3" /> Mur
          </button>
          {walls.length > 0 && (
            <button type="button" onClick={() => duplicateWall(currentWallIdx)}
              className="px-2 py-1.5 text-xs font-semibold rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 whitespace-nowrap shrink-0 transition"
              aria-label="Dupliquer le mur courant">
              Copier
            </button>
          )}
        </div>

        {/* Current wall rename */}
        <input
          type="text"
          value={currentEntry.name}
          onChange={(e) => renameWall(currentWallIdx, e.target.value)}
          placeholder="Nom du mur"
          aria-label="Nom du mur courant"
          className="w-full px-2 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-xs font-mono text-gray-700 dark:text-gray-300 focus:outline-none focus:border-[#7BAFD4]"
        />
      </Card>

      {/* Load modal */}
      {showLoadModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowLoadModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-white">Projets sauvegardes</h3>
              <button type="button" onClick={() => setShowLoadModal(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition"
                aria-label="Fermer">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loadingProjects && (
                <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">Chargement...</div>
              )}
              {!loadingProjects && savedProjects.length === 0 && (
                <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
                  Aucun projet sauvegarde
                </div>
              )}
              {!loadingProjects && savedProjects.map((p) => {
                const inputs = p.inputs as { walls?: MurWallEntry[] };
                const wallCount = Array.isArray(inputs.walls) ? inputs.walls.length : 0;
                return (
                  <div key={p.id} className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-gray-900 dark:text-white truncate">{p.label}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(p.createdAt).toLocaleString('fr-CA')} - {wallCount} mur(s) - #{p.id}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button type="button" onClick={() => loadProject(p)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-md bg-[#2563eb] text-white hover:bg-blue-700 transition">
                        Charger
                      </button>
                      <button type="button" onClick={() => removeSavedProject(p.id)}
                        className="p-1.5 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-md transition"
                        aria-label="Supprimer">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Phase 7a: Export Devis modal */}
      {showDevisModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setShowDevisModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-white">Envoyer au devis</h3>
              <button type="button" onClick={() => setShowDevisModal(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition"
                aria-label="Fermer">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            {/* Tabs: Existing devis / New devis */}
            <div className="px-4 pt-3">
              <div className="bg-gray-100 dark:bg-gray-700 p-1 rounded-lg flex">
                <button type="button" onClick={() => setCreateNewDevis(false)}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${
                    !createNewDevis ? 'bg-white dark:bg-gray-800 shadow text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'
                  }`}>
                  Devis existant
                </button>
                <button type="button" onClick={() => setCreateNewDevis(true)}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${
                    createNewDevis ? 'bg-white dark:bg-gray-800 shadow text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'
                  }`}>
                  Nouveau devis
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {createNewDevis ? (
                <div className="space-y-2">
                  <label className="block text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                    Nom du nouveau devis
                  </label>
                  <input
                    type="text"
                    value={newDevisName}
                    onChange={(e) => setNewDevisName(e.target.value)}
                    placeholder={projectName || 'Nom du devis'}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:outline-none focus:border-[#16a34a]"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {walls.length} mur(s) seront ajoutes comme lignes au devis.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {devisStore.isLoading && (
                    <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">Chargement...</div>
                  )}
                  {!devisStore.isLoading && devisStore.items.length === 0 && (
                    <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
                      Aucun devis disponible. Creez un nouveau devis ci-dessus.
                    </div>
                  )}
                  {!devisStore.isLoading && devisStore.items.map((d) => (
                    <label key={d.id}
                      className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition ${
                        selectedDevisId === d.id
                          ? 'bg-[#16a34a]/10 border-[#16a34a]'
                          : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}>
                      <input
                        type="radio"
                        name="devisExport"
                        checked={selectedDevisId === d.id}
                        onChange={() => setSelectedDevisId(d.id)}
                        className="accent-[#16a34a]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                          {d.nomProjet || `Devis #${d.id}`}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {d.numeroDevis} - {d.statut || 'brouillon'}
                          {d.clientNom ? ` - ${d.clientNom}` : ''}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
              <button type="button" onClick={() => setShowDevisModal(false)}
                disabled={exportingDevis}
                className="flex-1 py-2 text-xs font-semibold rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition">
                Annuler
              </button>
              <button type="button" onClick={handleExportToDevis}
                disabled={
                  exportingDevis ||
                  (!createNewDevis && selectedDevisId == null) ||
                  (createNewDevis && !newDevisName.trim() && !projectName.trim())
                }
                className="flex-1 py-2 text-xs font-semibold rounded-md bg-[#16a34a] text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition">
                <Send className="w-3.5 h-3.5" /> {exportingDevis ? 'Envoi...' : 'Envoyer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Wall mode selector */}
      <div className="bg-gray-200/70 dark:bg-gray-700/70 rounded-lg p-1 flex gap-1">
        <MurModeButton active={wall.wallMode === 'standard'} onClick={() => updateWall('wallMode', 'standard')}>
          <Frame className="w-4 h-4" /> Standard
        </MurModeButton>
        <MurModeButton active={wall.wallMode === 'rake'} onClick={() => updateWall('wallMode', 'rake')}>
          Pignon
        </MurModeButton>
        <MurModeButton active={wall.wallMode === 'tall'} onClick={() => updateWall('wallMode', 'tall')}>
          Mur haut
        </MurModeButton>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex gap-1">
          <button type="button" onClick={undo} disabled={!canUndo}
            className="p-2 rounded-md bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
            aria-label="Annuler">
            <Undo2 className="w-4 h-4 text-gray-700 dark:text-gray-300" />
          </button>
          <button type="button" onClick={redo} disabled={!canRedo}
            className="p-2 rounded-md bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
            aria-label="Refaire">
            <Redo2 className="w-4 h-4 text-gray-700 dark:text-gray-300" />
          </button>
        </div>
        <div className="bg-gray-200/70 dark:bg-gray-700/70 rounded-lg p-0.5 flex">
          <MurViewButton active={viewMode === 'front'} onClick={() => setViewMode('front')}>
            <Eye className="w-3.5 h-3.5" /> Avant
          </MurViewButton>
          <MurViewButton active={viewMode === 'back'} onClick={() => setViewMode('back')}>
            <EyeOff className="w-3.5 h-3.5" /> Arriere
          </MurViewButton>
          <MurViewButton active={viewMode === '3d'} onClick={() => setViewMode('3d')}>
            <Box className="w-3.5 h-3.5" /> 3D
          </MurViewButton>
        </div>
      </div>

      {/* SVG */}
      <Card className="overflow-hidden">
        <div className="px-3 py-2.5 flex items-center justify-between border-b border-gray-100 dark:border-gray-700">
          <span className="text-xs uppercase tracking-wider font-bold" style={{ color: '#0f2942' }}>
            Plan du mur
          </span>
          <div className="flex items-center gap-1">
            <button type="button"
              onClick={() => setZoom((z) => Math.max(3, z - 1))}
              className="w-9 h-9 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-400"
              aria-label="Zoom arriere">
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono text-gray-500 dark:text-gray-400 w-8 text-center">{zoom}x</span>
            <button type="button"
              onClick={() => setZoom((z) => Math.min(12, z + 1))}
              className="w-9 h-9 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-400"
              aria-label="Zoom avant">
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="overflow-auto bg-gray-50 dark:bg-gray-900" style={{ maxHeight: '75vh', minHeight: '50vh', WebkitOverflowScrolling: 'touch' }}>
          {viewMode === '3d' ? (
            <MurWall3D wall={wall} openings={openings} pieces={pieces} height={400} />
          ) : (
            <div style={{ transform: svgTransform, transformOrigin: 'center center', transition: 'transform 0.35s ease' }}>
              <MurWallSvg
                svgRef={svgRef}
                wall={wall}
                openings={openings}
                pieces={pieces}
                studPositions={studPositions}
                totalH={totalH}
                zoom={zoom}
                pad={pad}
                svgW={svgW}
                svgH={svgH}
                tx={tx}
                ty={ty}
                rakeMaxH={rakeMaxH}
                rakeMinH={rakeMinH}
                viewMode={viewMode}
              />
            </div>
          )}
        </div>
        <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-mono text-gray-600 dark:text-gray-400">
            {wall.length}" x {formatFraction(totalH)}
          </span>
          <span className="text-xs font-mono font-bold" style={{ color: '#2563eb' }}>
            Diag {formatFraction(diagonal)}
          </span>
        </div>
      </Card>

      {/* Stats 2x2 */}
      <div className="grid grid-cols-2 gap-2">
        <MurStatCard label="Montants" value={counts.studs + counts.kings} accent="blue" />
        <MurStatCard label="Jambages" value={counts.jacks} accent="red" />
        <MurStatCard label="Nains" value={counts.cripples} accent="green" />
        <MurStatCard label="Linteaux" value={counts.headers} accent="purple" />
      </div>

      {/* Main tabs */}
      <div className="bg-gray-200/70 dark:bg-gray-700/70 rounded-lg p-1 flex">
        <MurTabButton active={murTab === 'wall'} onClick={() => setMurTab('wall')}>Mur</MurTabButton>
        <MurTabButton active={murTab === 'openings'} onClick={() => setMurTab('openings')}>
          Ouvertures <span className="text-xs opacity-60">({openings.length})</span>
        </MurTabButton>
        <MurTabButton active={murTab === 'coupe'} onClick={() => setMurTab('coupe')}>Coupe</MurTabButton>
        <MurTabButton active={murTab === 'details'} onClick={() => setMurTab('details')}>Details</MurTabButton>
      </div>

      {/* Tab: Mur */}
      {murTab === 'wall' && (
        <div className="space-y-3">
          <Card className="p-4 space-y-4">
            <h3 className="text-xs uppercase tracking-wider font-bold" style={{ color: '#0f2942' }}>
              Proprietes du mur
            </h3>
            <MurNumberField label="Longueur du mur" value={wall.length}
              onChange={(v) => updateWall('length', v)} step={1} min={24} />
            <MurSelect<MurStudSize> label="Taille du materiau" value={wall.studType}
              options={[['2x4', '2x4'], ['2x6', '2x6'], ['2x8', '2x8']]}
              onChange={(v) => updateWall('studType', v)} />
            <div>
              <label className="block text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                Hauteur
              </label>
              <div className="grid grid-cols-2 gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg mb-2">
                <button type="button" onClick={() => updateWall('hauteurMode', 'stud')}
                  className={`py-2 text-xs font-semibold rounded-md transition ${wall.hauteurMode === 'stud' ? 'bg-white dark:bg-gray-800 shadow text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
                  Hauteur du montant
                </button>
                <button type="button" onClick={() => updateWall('hauteurMode', 'total')}
                  className={`py-2 text-xs font-semibold rounded-md transition ${wall.hauteurMode === 'total' ? 'bg-white dark:bg-gray-800 shadow text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
                  Hauteur totale du mur
                </button>
              </div>
              <MurNumberField label="" value={wall.hauteurMode === 'stud' ? wall.studHeight : wall.studHeight + MUR_PLATE * 3}
                onChange={(v) => updateWall('studHeight', wall.hauteurMode === 'stud' ? v : v - MUR_PLATE * 3)}
                step={0.125} min={24} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MurNumberField label="Espacement" value={wall.studSpacing}
                onChange={(v) => updateWall('studSpacing', v)} step={4} min={4} />
              <MurNumberField label="1er montant" value={wall.firstStud}
                onChange={(v) => updateWall('firstStud', v)} step={1} min={1} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  Direction
                </label>
                <div className="bg-gray-100 dark:bg-gray-700 p-1 rounded-lg flex">
                  <button type="button" onClick={() => updateWall('layoutDirection', 'start')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${wall.layoutDirection === 'start' ? 'bg-white dark:bg-gray-800 shadow text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
                    Debut
                  </button>
                  <button type="button" onClick={() => updateWall('layoutDirection', 'end')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${wall.layoutDirection === 'end' ? 'bg-white dark:bg-gray-800 shadow text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
                    Fin
                  </button>
                </div>
              </div>
              <MurToggle label="Doubler montants" value={wall.doubleStuds}
                onChange={(v) => updateWall('doubleStuds', v)} />
            </div>
          </Card>

          {/* Rake-specific section */}
          {wall.wallMode === 'rake' && (
            <MurCollapsibleSection title="Parametres Pignon" expanded={!collapsed.has('rake')}
              onToggle={() => toggleCollapsed('rake')} accent="#f59e0b">
              <MurNumberField label="Pente (rise per 12)" value={wall.rakePitch}
                onChange={(v) => updateWall('rakePitch', v)} step={1} min={0} />
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                    Cote court
                  </label>
                  <div className="bg-gray-100 dark:bg-gray-700 p-1 rounded-lg flex">
                    <button type="button" onClick={() => updateWall('rakeShortSide', 'left')}
                      className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${wall.rakeShortSide === 'left' ? 'bg-white dark:bg-gray-800 shadow' : 'text-gray-600 dark:text-gray-300'}`}>
                      Gauche
                    </button>
                    <button type="button" onClick={() => updateWall('rakeShortSide', 'right')}
                      className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${wall.rakeShortSide === 'right' ? 'bg-white dark:bg-gray-800 shadow' : 'text-gray-600 dark:text-gray-300'}`}>
                      Droite
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                    Montants
                  </label>
                  <div className="bg-gray-100 dark:bg-gray-700 p-1 rounded-lg flex">
                    <button type="button" onClick={() => updateWall('rakeStudLengthMode', 'short')}
                      className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${wall.rakeStudLengthMode === 'short' ? 'bg-white dark:bg-gray-800 shadow' : 'text-gray-600 dark:text-gray-300'}`}>
                      Court
                    </button>
                    <button type="button" onClick={() => updateWall('rakeStudLengthMode', 'long')}
                      className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${wall.rakeStudLengthMode === 'long' ? 'bg-white dark:bg-gray-800 shadow' : 'text-gray-600 dark:text-gray-300'}`}>
                      Long
                    </button>
                  </div>
                </div>
              </div>
            </MurCollapsibleSection>
          )}

          {/* Tall wall section */}
          {wall.wallMode === 'tall' && (
            <MurCollapsibleSection title="Parametres Mur Haut" expanded={!collapsed.has('tall')}
              onToggle={() => toggleCollapsed('tall')} accent="#f59e0b">
              <MurToggle label="Ajouter bande de plancher" value={wall.hasFloorBand}
                onChange={(v) => updateWall('hasFloorBand', v)} />
              {wall.hasFloorBand && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <MurNumberField label="Hauteur bande" value={wall.floorBandHeight}
                    onChange={(v) => updateWall('floorBandHeight', v)} step={0.5} min={0} />
                  <MurNumberField label="Position Y" value={wall.floorBandY}
                    onChange={(v) => updateWall('floorBandY', v)} step={1} min={0} />
                </div>
              )}
            </MurCollapsibleSection>
          )}

          {/* Blocking section */}
          <MurCollapsibleSection title="Blocage de mur" expanded={!collapsed.has('blocking')}
            onToggle={() => toggleCollapsed('blocking')} accent="#f59e0b">
            <MurToggle label="Blocage de mur" value={wall.hasBlocking}
              onChange={(v) => updateWall('hasBlocking', v)} />
            {wall.hasBlocking && (
              <MurNumberField label="Espacement des blocages" value={wall.blockingSpacing}
                onChange={(v) => updateWall('blockingSpacing', v)} step={1} min={1} />
            )}
          </MurCollapsibleSection>

          {/* Extra top plate */}
          <MurCollapsibleSection title="Lisse haute supplementaire" expanded={!collapsed.has('topplate')}
            onToggle={() => toggleCollapsed('topplate')} accent="#f59e0b">
            <MurToggle label="Ajouter lisse haute supp." value={wall.hasExtraTopPlate}
              onChange={(v) => updateWall('hasExtraTopPlate', v)} />
            {wall.hasExtraTopPlate && (
              <>
                <MurNumberField label="Epaisseur" value={wall.extraTopPlateThickness}
                  onChange={(v) => updateWall('extraTopPlateThickness', v)} step={0.125} min={0.5} />
                <div className="grid grid-cols-2 gap-3">
                  <MurNumberField label="Debut" value={wall.extraTopPlateStart}
                    onChange={(v) => updateWall('extraTopPlateStart', v)} step={1} min={0} />
                  <MurNumberField label="Fin" value={wall.extraTopPlateEnd}
                    onChange={(v) => updateWall('extraTopPlateEnd', v)} step={1} min={0} />
                </div>
              </>
            )}
          </MurCollapsibleSection>

          {/* Sheathing */}
          <MurCollapsibleSection title="Revetement exterieur" expanded={!collapsed.has('sheathing')}
            onToggle={() => toggleCollapsed('sheathing')} accent="#f59e0b">
            <MurToggle label="Ajouter revetement exterieur" value={wall.hasSheathing}
              onChange={(v) => updateWall('hasSheathing', v)} />
            {wall.hasSheathing && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <MurSelect<MurSheathingSize> label="Taille contreplaque" value={wall.sheathingSize}
                    options={[['4x8', '4x8'], ['4x9', '4x9'], ['4x10', '4x10'], ['4x12', '4x12']]}
                    onChange={(v) => updateWall('sheathingSize', v)} />
                  <MurSelect<MurSheathingThickness> label="Epaisseur" value={wall.sheathingThickness}
                    options={[['7/16', '7/16"'], ['1/2', '1/2"'], ['5/8', '5/8"'], ['3/4', '3/4"']]}
                    onChange={(v) => updateWall('sheathingThickness', v)} />
                </div>
                <MurToggle label="Bardage vertical" value={wall.verticalSheathing}
                  onChange={(v) => updateWall('verticalSheathing', v)} />
                <div className="grid grid-cols-2 gap-3">
                  <MurNumberField label="Depassement initial" value={wall.sheathingStartOverhang}
                    onChange={(v) => updateWall('sheathingStartOverhang', v)} step={0.5} min={0} />
                  <MurNumberField label="Depassement final" value={wall.sheathingEndOverhang}
                    onChange={(v) => updateWall('sheathingEndOverhang', v)} step={0.5} min={0} />
                </div>
              </>
            )}
          </MurCollapsibleSection>

          {/* Conformite Entrepreneur General Quebec - Phase 11 */}
          <MurConformiteEntrepreneur
            wall={wall}
            openings={openings}
            pieces={pieces}
            egConfig={egConfig}
            onChangeConfig={(partial: Partial<MurEgConfig>) => setEgConfig((c) => ({ ...c, ...partial }))}
            onApplyComposition={(preset: MurCompositionPreset) => {
              if (preset.wallChanges) {
                // Une seule mutation pour ne pousser qu'une entree dans l'historique
                setWalls((prev) => prev.map((entry, i) =>
                  i === currentWallIdx
                    ? { ...entry, wall: { ...entry.wall, ...preset.wallChanges } }
                    : entry,
                ));
              }
            }}
            isExpanded={!collapsed.has('eg-conformite')}
            onToggleExpanded={() => toggleCollapsed('eg-conformite')}
          />

          <button type="button" onClick={resetWall}
            className="w-full py-3 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition">
            Reinitialiser le mur
          </button>
        </div>
      )}

      {/* Tab: Openings */}
      {murTab === 'openings' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => addOp('window')}
              className="py-3 text-white font-semibold rounded-lg flex items-center justify-center gap-2 shadow-sm active:scale-95 transition"
              style={{ background: '#2563eb' }}>
              <Plus className="w-5 h-5" />Fenetre
            </button>
            <button type="button" onClick={() => addOp('door')}
              className="py-3 font-semibold rounded-lg flex items-center justify-center gap-2 border-2 active:scale-95 transition bg-white dark:bg-gray-800"
              style={{ color: '#7c3aed', borderColor: '#c4b5fd' }}>
              <Plus className="w-5 h-5" />Porte
            </button>
          </div>
          {openings.length === 0 && (
            <div className="bg-white dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">Aucune ouverture</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Ajoutez une fenetre ou une porte ci-dessus</p>
            </div>
          )}
          {openings.map((op, idx) => (
            <MurOpeningCard key={op.id} op={op} idx={idx}
              expanded={expandedId === op.id}
              onToggle={() => setExpandedId(expandedId === op.id ? null : op.id)}
              onUpdate={(k, v) => updateOp(op.id, k, v)}
              onRemove={() => removeOp(op.id)} />
          ))}
        </div>
      )}

      {/* Tab: Coupe */}
      {murTab === 'coupe' && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-xs uppercase tracking-wider font-bold" style={{ color: '#0f2942' }}>
              Liste de coupe
            </h3>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={exportCutListCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-[#7BAFD4]/10 text-[#4a7fa8] hover:bg-[#7BAFD4]/20 transition">
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
              <button type="button" onClick={exportPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-[#7BAFD4]/20 text-[#4a7fa8] dark:text-[#9BC8E4] hover:bg-[#7BAFD4]/30 transition">
                <FileDown className="w-3.5 h-3.5" /> Export PDF
              </button>
            </div>
          </div>
          <MurCutListTable items={cutList} />
        </Card>
      )}

      {/* Tab: Details */}
      {murTab === 'details' && (
        <>
          <Card className="p-4">
            <h3 className="text-xs uppercase tracking-wider font-bold mb-3" style={{ color: '#0f2942' }}>
              Dimensions
            </h3>
            <dl className="space-y-2.5">
              <MurRow k="Mode" v={wall.wallMode === 'standard' ? 'Standard' : wall.wallMode === 'rake' ? `Pignon (${wall.rakePitch}/12)` : 'Mur haut'} />
              <MurRow k="Longueur mur" v={formatFraction(wall.length)} />
              <MurRow k="Hauteur montant" v={formatFraction(wall.studHeight)} />
              <MurRow k="Hauteur totale" v={formatFraction(totalH)} />
              {wall.wallMode === 'rake' && (
                <>
                  <MurRow k="Hauteur min montants" v={formatFraction(rakeMinH)} />
                  <MurRow k="Hauteur max montants" v={formatFraction(rakeMaxH)} />
                </>
              )}
              <MurRow k="1er montant" v={formatFraction(wall.firstStud)} />
              <MurRow k="Espacement" v={formatFraction(wall.studSpacing)} />
              <MurRow k="Type" v={wall.studType} />
              <MurRow k="Direction" v={wall.layoutDirection === 'start' ? 'Debut -> Fin' : 'Fin -> Debut'} />
              <MurRow k="Doubler montants" v={wall.doubleStuds ? 'Oui' : 'Non'} />
              <MurRow k="Diagonale (equerre)" v={formatFraction(diagonal)} highlight />
            </dl>
          </Card>
          <Card className="p-4">
            <h3 className="text-xs uppercase tracking-wider font-bold mb-3" style={{ color: '#0f2942' }}>
              Decompte materiaux
            </h3>
            <div className="space-y-1.5">
              <MurCountRow k="Montants" v={counts.studs} color="#2563eb" />
              <MurCountRow k="King studs" v={counts.kings} color="#2563eb" />
              <MurCountRow k="Jambages (jacks)" v={counts.jacks} color="#dc2626" />
              <MurCountRow k="Montants nains" v={counts.cripples} color="#16a34a" />
              <MurCountRow k="Linteaux (2-2x10)" v={counts.headers} color="#7c3aed" />
              <MurCountRow k="Lisses appui" v={counts.sills} color="#0f2942" />
              <MurCountRow k="Lisses (sole + sablieres)" v={counts.plates} color="#0f2942" />
              {counts.blockings > 0 && <MurCountRow k="Blocages" v={counts.blockings} color="#f59e0b" />}
            </div>
          </Card>
          <Card className="p-4">
            <h3 className="text-xs uppercase tracking-wider font-bold mb-3" style={{ color: '#0f2942' }}>
              Validations CCQ / CNB
            </h3>
            <MurValidationsList validations={validations} />
          </Card>
        </>
      )}
    </div>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================

interface MurWallSvgProps {
  svgRef?: RefObject<SVGSVGElement>;
  wall: MurWall;
  openings: MurOpening[];
  pieces: MurPiece[];
  studPositions: number[];
  totalH: number;
  zoom: number;
  pad: number;
  svgW: number;
  svgH: number;
  tx: (x: number) => number;
  ty: (y: number) => number;
  rakeMaxH: number;
  rakeMinH: number;
  viewMode?: MurViewMode;
}

function MurWallSvg({
  svgRef, wall, openings, pieces, studPositions, totalH, zoom, pad, svgW, svgH, tx, ty,
}: MurWallSvgProps) {
  return (
    <svg ref={svgRef} viewBox={`0 0 ${svgW} ${svgH}`} width={svgW} height={svgH} style={{ background: MUR_COLORS.paper, display: 'block' }}>
      <defs>
        <pattern id="mur-grid" width={zoom * 6} height={zoom * 6} patternUnits="userSpaceOnUse">
          <path d={`M ${zoom * 6} 0 L 0 0 0 ${zoom * 6}`} fill="none" stroke={MUR_COLORS.grid} strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect x={pad} y={ty(totalH)} width={wall.length * zoom} height={totalH * zoom} fill="url(#mur-grid)" />

      {/* Pieces */}
      {pieces.map((p, i) => {
        if (p.polygon) {
          const points = p.polygon.map((pt) => `${tx(pt.x)},${ty(pt.y)}`).join(' ');
          return (
            <g key={i}>
              <polygon points={points} fill={MUR_COLORS[p.kind]} stroke={MUR_COLORS.outline} strokeWidth="1" />
              {p.label && (
                <text x={tx(p.polygon[0].x + (p.polygon[1].x - p.polygon[0].x) / 2)}
                  y={ty((p.polygon[0].y + p.polygon[3].y) / 2) + 4}
                  textAnchor="middle" fontSize="9" fontWeight="bold" fill={MUR_COLORS.outline}>
                  {p.label}
                </text>
              )}
            </g>
          );
        }
        const cx = tx(p.x + p.w / 2);
        const cy = ty(p.y + p.h / 2);
        // Always show labels for vertical pieces (studs/kings/jacks/cripples) - they are narrow
        const isVertical = p.kind === 'stud' || p.kind === 'king' || p.kind === 'jack' || p.kind === 'cripple';
        const showLabel = p.label && (isVertical ? p.h * zoom > 30 : (p.w * zoom > 30 && p.h * zoom > 10));
        return (
          <g key={i}>
            <rect x={tx(p.x)} y={ty(p.y + p.h)}
              width={p.w * zoom} height={p.h * zoom}
              fill={MUR_COLORS[p.kind]} stroke={MUR_COLORS.outline} strokeWidth="1" />
            {p.kind === 'header' && (
              <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="bold"
                fill={MUR_COLORS.outline} fontFamily="ui-monospace, monospace">
                2 - 2X10
              </text>
            )}
            {showLabel && p.kind !== 'header' && (
              <g>
                <rect x={cx - 14} y={cy - 6} width={28} height={12} fill={MUR_COLORS.labelBg} rx="2" />
                <text x={cx} y={cy + 3} textAnchor="middle" fontSize="8" fontWeight="bold"
                  fill={MUR_COLORS.labelText} fontFamily="ui-monospace, monospace">
                  {p.label}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Opening labels */}
      {openings.map((op, idx) => {
        const openBot = op.type === 'window' ? MUR_PLATE + op.sillHeight : MUR_PLATE;
        const cy = openBot + op.height / 2;
        const cx = op.x + op.width / 2;
        return (
          <text key={op.id} x={tx(cx)} y={ty(cy)} textAnchor="middle"
            fontSize="11" fontFamily="ui-monospace, monospace" fill={MUR_COLORS.outline}>
            <tspan x={tx(cx)} fontWeight="bold">
              {op.type === 'window' ? `Fenetre ${idx + 1}` : `Porte ${idx + 1}`}
            </tspan>
            <tspan x={tx(cx)} dy="13">{formatFraction(op.width)}</tspan>
            <tspan x={tx(cx)} dy="12" fontSize="9">x</tspan>
            <tspan x={tx(cx)} dy="13">{formatFraction(op.height)}</tspan>
          </text>
        );
      })}

      {/* Stud position cotations (top) */}
      {studPositions.map((sp, idx) => (
        <g key={`sp-${idx}`}>
          <line
            x1={tx(sp)} y1={ty(totalH) - 8}
            x2={tx(sp)} y2={ty(totalH) - 28}
            stroke={MUR_COLORS.dim} strokeWidth="0.7" strokeDasharray="2,2"
          />
          <text x={tx(sp)} y={ty(totalH) - 32} textAnchor="middle"
            fontSize="8" fill={MUR_COLORS.dim} fontFamily="ui-monospace, monospace"
            transform={`rotate(-90 ${tx(sp)} ${ty(totalH) - 32})`}>
            {formatFraction(sp)}
          </text>
        </g>
      ))}

      {/* Bottom width dimension */}
      <MurDimLine x1={tx(0)} x2={tx(wall.length)} y={ty(0) + 22}
        label={formatFraction(wall.length)} color={MUR_COLORS.dim} />
      <MurDimLine x1={tx(0)} x2={tx(wall.firstStud)} y={ty(0) + 40}
        label={formatFraction(wall.firstStud)} small color={MUR_COLORS.dimAccent} />
      {openings.map((op, idx) => (
        <MurDimLine key={op.id} x1={tx(0)} x2={tx(op.x + op.width / 2)}
          y={ty(0) + 56 + idx * 14}
          label={formatFraction(op.x + op.width / 2)} small color={MUR_COLORS.dim} />
      ))}
      <text x={tx(0)} y={ty(0) + 14} fontSize="10" fill={MUR_COLORS.outline} fontFamily="ui-monospace, monospace">
        Depart
      </text>
    </svg>
  );
}

function MurStatCard({ label, value, accent }: {
  label: string; value: number; accent: 'blue' | 'red' | 'green' | 'purple';
}) {
  const accents: Record<string, { bg: string; fg: string }> = {
    blue: { bg: '#dbeafe', fg: '#2563eb' },
    red: { bg: '#fee2e2', fg: '#dc2626' },
    green: { bg: '#dcfce7', fg: '#16a34a' },
    purple: { bg: '#ede9fe', fg: '#7c3aed' },
  };
  const a = accents[accent] ?? accents.blue;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-3 flex items-center justify-between">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider font-bold text-gray-500 dark:text-gray-400 truncate">{label}</div>
        <div className="text-2xl font-bold mt-0.5 text-gray-900 dark:text-white">{value}</div>
      </div>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: a.bg }}>
        <svg viewBox="0 0 24 24" fill="none" stroke={a.fg} strokeWidth="2.2" className="w-4 h-4">
          <rect x="4" y="3" width="16" height="18" rx="1" />
          <line x1="9" y1="8" x2="9" y2="8.5" />
          <line x1="15" y1="8" x2="15" y2="8.5" />
          <line x1="9" y1="13" x2="9" y2="13.5" />
          <line x1="15" y1="13" x2="15" y2="13.5" />
        </svg>
      </div>
    </div>
  );
}

function MurTabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 py-2 px-2 rounded-md text-sm font-semibold transition-all ${
        active ? 'bg-white dark:bg-gray-800 shadow text-gray-900 dark:text-white'
               : 'text-gray-600 dark:text-gray-300 hover:bg-gray-300/40 dark:hover:bg-gray-600/40'
      }`}>
      {children}
    </button>
  );
}

function MurModeButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 py-2.5 px-2 rounded-md text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
        active ? 'bg-[#2563eb] shadow text-white'
               : 'text-gray-700 dark:text-gray-300 hover:bg-gray-300/40 dark:hover:bg-gray-600/40'
      }`}>
      {children}
    </button>
  );
}

function MurViewButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`px-2 py-1 rounded-md text-xs font-semibold transition flex items-center gap-1 ${
        active ? 'bg-white dark:bg-gray-800 shadow text-gray-900 dark:text-white'
               : 'text-gray-600 dark:text-gray-300'
      }`}>
      {children}
    </button>
  );
}

function MurNumberField({ label, value, onChange, step = 1, min }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number;
}) {
  const update = (delta: number) => {
    let v = +(value + delta).toFixed(3);
    if (min != null) v = Math.max(min, v);
    onChange(v);
  };
  return (
    <div>
      {label && (
        <label className="block text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
          {label}
        </label>
      )}
      <div className="flex items-stretch bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
        <button type="button" onClick={() => update(-step)}
          className="px-3 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 border-r border-gray-300 dark:border-gray-600 flex items-center justify-center"
          style={{ minWidth: 44, minHeight: 44 }}
          aria-label="Diminuer">
          <Minus className="w-4 h-4" />
        </button>
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          className="flex-1 text-center font-mono text-base font-bold text-gray-900 dark:text-white bg-transparent focus:outline-none focus:bg-blue-50 dark:focus:bg-blue-900/20 px-1 w-0"
          aria-label={label}
        />
        <button type="button" onClick={() => update(step)}
          className="px-3 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 border-l border-gray-300 dark:border-gray-600 flex items-center justify-center"
          style={{ minWidth: 44, minHeight: 44 }}
          aria-label="Augmenter">
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 font-mono">{formatFraction(value)}</p>
    </div>
  );
}

function MurSelect<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full px-3 py-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono font-bold text-gray-900 dark:text-white focus:outline-none focus:border-[#7BAFD4]"
      >
        {options.map(([v, lbl]) => (
          <option key={v} value={v}>{lbl}</option>
        ))}
      </select>
    </div>
  );
}

function MurToggle({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
        {label}
      </label>
      <div className="bg-gray-100 dark:bg-gray-700 p-1 rounded-lg flex">
        <button type="button" onClick={() => onChange(true)}
          className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${value ? 'bg-[#f59e0b] shadow text-white' : 'text-gray-600 dark:text-gray-300'}`}>
          Oui
        </button>
        <button type="button" onClick={() => onChange(false)}
          className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${!value ? 'bg-[#f59e0b] shadow text-white' : 'text-gray-600 dark:text-gray-300'}`}>
          Non
        </button>
      </div>
    </div>
  );
}

function MurCollapsibleSection({ title, expanded, onToggle, children, accent = '#7BAFD4' }: {
  title: string; expanded: boolean; onToggle: () => void; children: ReactNode; accent?: string;
}) {
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700"
        style={{ background: `linear-gradient(to right, ${accent}20, ${accent}10)` }}>
        <span className="text-sm font-bold" style={{ color: accent }}>{title}</span>
        <span className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1">
          {expanded ? 'Masquer les details' : 'Afficher les details'}
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>
      {expanded && (
        <div className="p-4 space-y-3 border-t border-gray-100 dark:border-gray-700">
          {children}
        </div>
      )}
    </Card>
  );
}

function MurOpeningCard({ op, idx, expanded, onToggle, onUpdate, onRemove }: {
  op: MurOpening; idx: number; expanded: boolean;
  onToggle: () => void;
  onUpdate: <K extends keyof MurOpening>(k: K, v: MurOpening[K]) => void;
  onRemove: () => void;
}) {
  const isWindow = op.type === 'window';
  return (
    <div className={`bg-white dark:bg-gray-800 border rounded-xl overflow-hidden transition shadow-sm ${
      expanded ? 'border-blue-400 shadow-md' : 'border-gray-200 dark:border-gray-700'
    }`}>
      <button type="button" onClick={onToggle}
        className="w-full px-3 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-3 h-3 rounded-full shrink-0 ${isWindow ? 'bg-blue-500' : 'bg-purple-500'}`} />
          <div className="min-w-0">
            <div className="font-bold text-gray-900 dark:text-white text-sm">
              {isWindow ? `Fenetre ${idx + 1}` : `Porte ${idx + 1}`}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
              {formatFraction(op.width)} x {formatFraction(op.height)} @ {formatFraction(op.x)}
            </div>
          </div>
        </div>
        <div className="text-gray-400 dark:text-gray-500 shrink-0 ml-2">
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-gray-700 space-y-3 bg-gray-50/50 dark:bg-gray-900/50">
          {isWindow && (
            <div>
              <label className="block text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                Forme
              </label>
              <div className="bg-gray-100 dark:bg-gray-700 p-1 rounded-lg flex">
                <button type="button" onClick={() => onUpdate('shape', 'rect')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${op.shape === 'rect' ? 'bg-white dark:bg-gray-800 shadow' : 'text-gray-600 dark:text-gray-300'}`}>
                  Rectangulaire
                </button>
                <button type="button" onClick={() => onUpdate('shape', 'arch')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${op.shape === 'arch' ? 'bg-white dark:bg-gray-800 shadow' : 'text-gray-600 dark:text-gray-300'}`}>
                  Arc
                </button>
              </div>
            </div>
          )}
          <MurNumberField label="Position X (du debut)" value={op.x}
            onChange={(v) => onUpdate('x', v)} step={1} min={0} />
          <div className="grid grid-cols-2 gap-2">
            <MurNumberField label="Largeur" value={op.width}
              onChange={(v) => onUpdate('width', v)} step={1} min={6} />
            <MurNumberField label="Hauteur" value={op.height}
              onChange={(v) => onUpdate('height', v)} step={1} min={6} />
          </div>
          {isWindow && (
            <MurNumberField label="Hauteur d'appui" value={op.sillHeight}
              onChange={(v) => onUpdate('sillHeight', v)} step={1} min={0} />
          )}
          <button type="button" onClick={onRemove}
            className="w-full py-3 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg font-semibold flex items-center justify-center gap-2 transition">
            <Trash2 className="w-4 h-4" /> Supprimer
          </button>
        </div>
      )}
    </div>
  );
}

function MurRow({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div className={`flex justify-between items-baseline py-1 ${highlight ? 'pt-2 border-t border-gray-200 dark:border-gray-700' : ''}`}>
      <span className="text-sm text-gray-600 dark:text-gray-400">{k}</span>
      <span className={`font-mono text-sm ${highlight ? 'font-bold text-base' : 'font-semibold text-gray-900 dark:text-white'}`}
        style={highlight ? { color: '#2563eb' } : {}}>
        {v}
      </span>
    </div>
  );
}

function MurCountRow({ k, v, color }: { k: string; v: number; color: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }}></span>
        <span className="text-sm text-gray-700 dark:text-gray-300">{k}</span>
      </div>
      <span className="font-mono font-bold text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 px-2.5 py-0.5 rounded-md text-sm tabular-nums">
        {v}
      </span>
    </div>
  );
}

function MurDimLine({ x1, x2, y, label, small, color = '#0f2942' }: {
  x1: number; x2: number; y: number; label: string; small?: boolean; color?: string;
}) {
  const TICK = 5;
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth="1" />
      <line x1={x1} y1={y - TICK} x2={x1} y2={y + TICK} stroke={color} strokeWidth="1" />
      <line x1={x2} y1={y - TICK} x2={x2} y2={y + TICK} stroke={color} strokeWidth="1" />
      <text x={(x1 + x2) / 2} y={y - 4} textAnchor="middle"
        fontSize={small ? 10 : 12} fontWeight="bold"
        fontFamily="ui-monospace, monospace" fill={color}>
        {label}
      </text>
    </g>
  );
}

function MurCutListTable({ items }: { items: MurCutListItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">Aucune piece</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="text-left py-2 px-1 font-bold text-gray-600 dark:text-gray-400 uppercase">Etiq.</th>
            <th className="text-right py-2 px-1 font-bold text-gray-600 dark:text-gray-400 uppercase">Qte</th>
            <th className="text-left py-2 px-1 font-bold text-gray-600 dark:text-gray-400 uppercase">Taille</th>
            <th className="text-right py-2 px-1 font-bold text-gray-600 dark:text-gray-400 uppercase">Longueur</th>
            <th className="text-left py-2 px-1 font-bold text-gray-600 dark:text-gray-400 uppercase">Usage</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
              <td className="py-1.5 px-1 font-mono font-bold text-[#7BAFD4]">{item.label}</td>
              <td className="py-1.5 px-1 text-right font-mono text-gray-900 dark:text-white tabular-nums">{item.qty}</td>
              <td className="py-1.5 px-1 font-mono text-gray-700 dark:text-gray-300">{item.size}</td>
              <td className="py-1.5 px-1 text-right font-mono text-gray-700 dark:text-gray-300">{formatFraction(item.length)}</td>
              <td className="py-1.5 px-1 text-gray-600 dark:text-gray-400">{item.use}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-bold">
            <td className="py-2 px-1 text-gray-700 dark:text-gray-300">Total</td>
            <td className="py-2 px-1 text-right font-mono text-gray-900 dark:text-white tabular-nums">
              {items.reduce((s, i) => s + i.qty, 0)}
            </td>
            <td colSpan={3}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MurValidationsList({ validations }: { validations: MurValidation[] }) {
  if (validations.length === 0) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-3 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20">
        <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
        <span className="text-sm font-semibold text-green-800 dark:text-green-200">
          Conforme aux normes CCQ/CNB de base
        </span>
      </div>
    );
  }
  // Sort by level severity: error > warning > info
  const levelOrder: Record<MurValidation['level'], number> = { error: 0, warning: 1, info: 2 };
  const sorted = [...validations].sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);
  return (
    <div className="space-y-2">
      {sorted.map((v, i) => (
        <MurValidationCard key={i} validation={v} />
      ))}
    </div>
  );
}

function MurValidationCard({ validation }: { validation: MurValidation }) {
  const styles: Record<MurValidation['level'], { border: string; bg: string; text: string; badge: string; icon: ReactNode }> = {
    error: {
      border: 'border-red-300 dark:border-red-700',
      bg: 'bg-red-50 dark:bg-red-900/20',
      text: 'text-red-800 dark:text-red-200',
      badge: 'bg-red-200 dark:bg-red-800 text-red-900 dark:text-red-100',
      icon: <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />,
    },
    warning: {
      border: 'border-amber-300 dark:border-amber-700',
      bg: 'bg-amber-50 dark:bg-amber-900/20',
      text: 'text-amber-800 dark:text-amber-200',
      badge: 'bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100',
      icon: <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />,
    },
    info: {
      border: 'border-blue-300 dark:border-blue-700',
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      text: 'text-blue-800 dark:text-blue-200',
      badge: 'bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-blue-100',
      icon: <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />,
    },
  };
  const s = styles[validation.level];
  return (
    <div className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border ${s.border} ${s.bg}`}>
      <div className="pt-0.5">{s.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${s.badge}`}>
            {validation.code}
          </span>
        </div>
        <p className={`text-xs leading-snug ${s.text}`}>{validation.message}</p>
      </div>
    </div>
  );
}
