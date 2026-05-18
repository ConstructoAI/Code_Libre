/**
 * Imperial dimension input parser — Mitek/AutoCAD style (adapted for 2D PDF takeoff).
 *
 * Format A (avec separateurs) PP-II-SS:
 *   PP = feet (pieds)
 *   II = inches (pouces, 0-11)
 *   SS = sixteenths of an inch (seizièmes de pouce, 0-15)
 *   Exemples:
 *     "20-06-08" → 20 feet, 6 inches, 8/16" (½")  → 6.2484 m
 *     "18-04-12" → 18 feet, 4 inches, 12/16" (¾") → 5.5943 m
 *     "8-0-0"    → 8 feet even                      → 2.4384 m
 *     "0-6-0"    → 6 inches                         → 0.1524 m
 *
 * Format B (compact, exactement 6 digits) PPIISS:
 *   FFIISS = FF pieds + II pouces + SS/16 pouces
 *   Exemples:
 *     "160608"   → 16'6"½    (16 ft, 6 in, 8/16 in)  → 5.0419 m
 *     "180412"   → 18'4 3/4" (18 ft, 4 in, 12/16 in) → 5.5943 m
 *     "100000"   → 10'       (10 ft, 0 in, 0)        → 3.0480 m
 *     "000600"   → 6"        (0 ft, 6 in, 0)         → 0.1524 m
 *
 * Inspired by CAO_AI/frontend/src/utils/imperialInput.ts, adapted for 2D coordinate system.
 */

import type { Point } from '../types';

/* ── Conversion constants ────────────────────────────────────── */

const FEET_TO_METERS = 0.3048;
const INCHES_TO_METERS = 0.0254;
const SIXTEENTH_TO_METERS = INCHES_TO_METERS / 16;

/* ── Parsed result ───────────────────────────────────────────── */

export interface ParsedDimension {
  feet: number;
  inches: number;
  sixteenths: number;
  totalMeters: number;
  displayString: string;
}

/* ── Parsing ─────────────────────────────────────────────────── */

/**
 * Parse a PP-II-SS string OR PPIISS compact string into meters.
 * Accepts:
 *   - Format avec separateurs: "18", "18-4", "18-04-12"
 *   - Format compact 6 digits: "160608" (= 16'6"8/16)
 * Rejects malformed input (leading/trailing/consecutive dashes,
 * out-of-range values, mixed separators).
 */
export function parseImperialInput(input: string): ParsedDimension | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Format B (compact): exactement 6 digits, aucun separateur, aucun decimal point.
  // Ex: "160608" → FF=16, II=06, SS=08
  if (/^\d{6}$/.test(trimmed)) {
    const feet = parseInt(trimmed.substring(0, 2), 10);
    const inches = parseInt(trimmed.substring(2, 4), 10);
    const sixteenths = parseInt(trimmed.substring(4, 6), 10);
    return _buildDimension(feet, inches, sixteenths);
  }

  // Format A (avec separateurs PP-II-SS): existant.
  // Reject structurally invalid patterns: leading dash, trailing dash, consecutive dashes
  if (/^-|-$|--/.test(trimmed)) return null;

  const parts = trimmed.split('-');
  if (parts.length > 3) return null;

  // Reject empty parts (e.g. from "5-" after the regex check — belt-and-suspenders)
  if (parts.some((p) => p === '')) return null;

  const feet = parseInt(parts[0], 10);
  const inches = parts.length >= 2 ? parseInt(parts[1], 10) : 0;
  const sixteenths = parts.length >= 3 ? parseInt(parts[2], 10) : 0;

  if (isNaN(feet) || isNaN(inches) || isNaN(sixteenths)) return null;
  return _buildDimension(feet, inches, sixteenths);
}

/**
 * Helper interne: valide les bornes (inches 0-11, sixteenths 0-15, feet >= 0,
 * total > 0) et construit l'objet ParsedDimension.
 */
function _buildDimension(feet: number, inches: number, sixteenths: number): ParsedDimension | null {
  if (isNaN(feet) || isNaN(inches) || isNaN(sixteenths)) return null;
  if (feet < 0 || inches < 0 || inches > 11 || sixteenths < 0 || sixteenths > 15) return null;

  const totalMeters =
    feet * FEET_TO_METERS +
    inches * INCHES_TO_METERS +
    sixteenths * SIXTEENTH_TO_METERS;

  if (totalMeters <= 0) return null;

  return {
    feet,
    inches,
    sixteenths,
    totalMeters,
    displayString: formatImperialDisplay(feet, inches, sixteenths),
  };
}

/* ── Display formatting ──────────────────────────────────────── */

export function formatImperialDisplay(feet: number, inches: number, sixteenths: number): string {
  const fractionStr = sixteenthsToFraction(sixteenths);
  let result = '';

  if (feet > 0) {
    result += `${feet}'`;
  }

  if (inches > 0 || sixteenths > 0 || feet === 0) {
    if (result) result += '-';
    if (fractionStr) {
      result += `${inches} ${fractionStr}"`;
    } else {
      result += `${inches}"`;
    }
  }

  return result || '0"';
}

/**
 * Convert decimal feet to a feet-inches-fraction display string at 1/16"
 * precision. Standard construction format used on architectural plans
 * across QC/North America.
 *
 * Examples:
 *   formatFeetImperial(27.05)  -> "27'-0 5/8""    (0.05 ft = 9.6/16" -> 10/16 = 5/8)
 *   formatFeetImperial(22.21)  -> "22'-2 1/2""    (0.21 ft = 40.32/16" -> 40/16 = 2 8/16)
 *   formatFeetImperial(0)      -> "0""
 *   formatFeetImperial(8)      -> "8'"            (no inches/fraction)
 *   formatFeetImperial(8.5)    -> "8'-6""         (0.5 ft = 96/16" = 6 in)
 *
 * Returns '0"' for non-finite or negative input.
 */
export function formatFeetImperial(decimalFeet: number): string {
  if (!isFinite(decimalFeet) || decimalFeet < 0) return '0"';
  // 1 foot = 12 inches = 192 sixteenths
  const totalSixteenths = Math.round(decimalFeet * 192);
  const feet = Math.floor(totalSixteenths / 192);
  const remaining = totalSixteenths - feet * 192;
  const inches = Math.floor(remaining / 16);
  const sixteenths = remaining - inches * 16;
  return formatImperialDisplay(feet, inches, sixteenths);
}

/**
 * Convert decimal inches to inches-fraction display at 1/16" precision.
 * Used when the calibration unit is 'in' (rather than 'ft').
 *
 * Examples:
 *   formatInchesImperial(7.625) -> "7 5/8""
 *   formatInchesImperial(15.0)  -> "15""
 *   formatInchesImperial(13)    -> "1'-1""        (auto-rolls to feet when >= 12 in)
 */
export function formatInchesImperial(decimalInches: number): string {
  if (!isFinite(decimalInches) || decimalInches < 0) return '0"';
  const totalSixteenths = Math.round(decimalInches * 16);
  const feet = Math.floor(totalSixteenths / 192);
  const remaining = totalSixteenths - feet * 192;
  const inches = Math.floor(remaining / 16);
  const sixteenths = remaining - inches * 16;
  return formatImperialDisplay(feet, inches, sixteenths);
}

function sixteenthsToFraction(sixteenths: number): string {
  if (sixteenths === 0) return '';
  const gcd = greatestCommonDivisor(sixteenths, 16);
  const num = sixteenths / gcd;
  const den = 16 / gcd;
  return `${num}/${den}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * Format raw input string as the user types, showing the imperial equivalent.
 * e.g. "18" → "18'" | "18-04" → "18'-4"" | "18-04-12" → "18'-4 3/4""
 */
export function formatPartialInput(input: string): string {
  const parsed = parseImperialInput(input);
  if (!parsed) return input;
  return parsed.displayString;
}

/**
 * Parse a string input as decimal feet for BOM composite_inputs (P3.4).
 *
 * Supports multiple formats:
 *   - Compact PPIISS (6 digits): "100608" → 10'-6 1/2" → 10.5417 ft
 *   - Compact IISS (4 digits): "0608" → 0'-6 1/2" → 0.5417 ft (no feet)
 *   - PP-II-SS with dashes: "10-06-08" → same as above
 *   - Decimal with point: "1.333" → 1.333 ft
 *   - Decimal with comma (FR locale): "1,333" → 1.333 ft
 *   - Plain integer: "8" → 8 ft (decimal interpretation)
 *   - Empty string: null (use composite default)
 *
 * Bounds: inches 0-11, sixteenths 0-15. Out of range returns null.
 *
 * Designed for the LIAISON BOM panel (LeftPanel.tsx CompositeLinkPanel)
 * where Sylvain saisit les variables géométriques (hauteur, largeur,
 * longueur, perimetre) en format pieds-pouces-seizièmes au lieu de
 * décimal forcé. Évite les confusions d'unité observées en production
 * (ex: "6.8" interprété comme 6.8 pi au lieu de 6 1/2"; "010400"
 * interprété comme 10400 pi au lieu de 1'-4").
 */
export function parseFeetInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Reject internal whitespace (e.g. "100 608", "1 . 5")
  // Avoids silent parseInt truncation that would store wrong value.
  if (/\s/.test(trimmed)) return null;

  // Decimal with . or , (FR locale supported)
  if (/[.,]/.test(trimmed)) {
    const normalized = trimmed.replace(',', '.');
    // Strict validation: reject "1.2.3", ".5" (asymmetric), "5." trailing,
    // scientific "1e3", leading "+", multi-separators, etc.
    if (!/^\d+\.?\d*$/.test(normalized)) return null;
    const n = parseFloat(normalized);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  // Compact PPIISS (exactly 6 digits, no separators)
  // "000000" → null (would otherwise override composite default with 0)
  if (/^\d{6}$/.test(trimmed)) {
    const feet = parseInt(trimmed.substring(0, 2), 10);
    const inches = parseInt(trimmed.substring(2, 4), 10);
    const sixteenths = parseInt(trimmed.substring(4, 6), 10);
    if (inches > 11 || sixteenths > 15) return null;
    if (feet === 0 && inches === 0 && sixteenths === 0) return null;
    return feet + inches / 12 + sixteenths / 192;
  }

  // Compact IISS (exactly 4 digits, no separators)
  // Useful for sub-foot values: "0608" = 6 1/2" = 0.5417 ft
  // "0000" → null (same rationale as 6-digit all-zero)
  if (/^\d{4}$/.test(trimmed)) {
    const inches = parseInt(trimmed.substring(0, 2), 10);
    const sixteenths = parseInt(trimmed.substring(2, 4), 10);
    if (inches > 11 || sixteenths > 15) return null;
    if (inches === 0 && sixteenths === 0) return null;
    return inches / 12 + sixteenths / 192;
  }

  // PP-II-SS with dashes (re-use existing parser, convert meters back to feet)
  if (trimmed.includes('-')) {
    const parsed = parseImperialInput(trimmed);
    if (parsed) {
      return parsed.totalMeters / FEET_TO_METERS;
    }
    return null;
  }

  // Plain integer fallback (decimal feet interpretation).
  // Strict validation: reject "+5", "5abc", "1e3", scientific notation.
  // Only pure digits allowed.
  if (!/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Convert meters back to PP-II-SS format string.
 * Returns "0-00-00" for zero or negative values.
 */
export function metersToImperialInput(meters: number): string {
  if (!isFinite(meters) || meters <= 0) return '0-00-00';

  const totalSixteenths = Math.round(meters / SIXTEENTH_TO_METERS);
  const feet = Math.floor(totalSixteenths / (12 * 16));
  const remaining = totalSixteenths - feet * 12 * 16;
  const inches = Math.floor(remaining / 16);
  const sixteenths = remaining - inches * 16;
  return `${feet}-${String(inches).padStart(2, '0')}-${String(sixteenths).padStart(2, '0')}`;
}

/**
 * Convert meters to a readable imperial display string.
 * Returns '0"' for zero or negative values.
 */
export function metersToImperialDisplay(meters: number): string {
  if (!isFinite(meters) || meters <= 0) return '0"';

  const totalSixteenths = Math.round(meters / SIXTEENTH_TO_METERS);
  const feet = Math.floor(totalSixteenths / (12 * 16));
  const remaining = totalSixteenths - feet * 12 * 16;
  const inches = Math.floor(remaining / 16);
  const sixteenths = remaining - inches * 16;
  return formatImperialDisplay(feet, inches, sixteenths);
}

/* ── Direction system (2D adaptation) ────────────────────────── */

export type DrawDirection = 'up' | 'down' | 'left' | 'right';

export const DIRECTION_LABELS: Record<DrawDirection, string> = {
  up: '↑ Haut',
  down: '↓ Bas',
  right: '→ Droite',
  left: '← Gauche',
};

export const DIRECTION_ARROWS: Record<DrawDirection, string> = {
  up: '↑',
  down: '↓',
  right: '→',
  left: '←',
};

/**
 * Map arrow key name to draw direction.
 */
export const ARROW_KEY_MAP: Record<string, DrawDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/**
 * Convert a direction + distance (in pixels) to a 2D delta vector.
 * In PDF coordinate space: up = -Y, down = +Y, right = +X, left = -X.
 */
export function directionToDelta(
  direction: DrawDirection,
  pixelDistance: number,
): Point {
  switch (direction) {
    case 'up':
      return { x: 0, y: -pixelDistance };
    case 'down':
      return { x: 0, y: pixelDistance };
    case 'right':
      return { x: pixelDistance, y: 0 };
    case 'left':
      return { x: -pixelDistance, y: 0 };
  }
}

/**
 * Convert an angle (degrees) + distance (pixels) to a 2D delta vector.
 */
export function angleToDelta(
  angleDeg: number,
  pixelDistance: number,
): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: pixelDistance * Math.cos(rad),
    y: pixelDistance * Math.sin(rad),
  };
}

/**
 * Snap an angle (degrees) to the nearest 15-degree increment.
 * Result is normalized to [0, 360) range.
 */
export function snapAngle15(angleDeg: number): number {
  const snapped = Math.round(angleDeg / 15) * 15;
  return ((snapped % 360) + 360) % 360;
}

/**
 * Get the angle (in degrees) from a start point to an end point.
 * Returns value in [0, 360) range (0 = right, 90 = down in screen coords).
 * Returns 0 for coincident points.
 */
export function angleFromPoints(start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 1e-10 && Math.abs(dy) < 1e-10) return 0;
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  return angle;
}
