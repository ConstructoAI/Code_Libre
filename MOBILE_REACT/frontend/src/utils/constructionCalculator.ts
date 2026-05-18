/**
 * Construction Calculator – Pure calculation logic
 * Port of calculator_ui.py (Construction Master® Pro style)
 * No React dependency – functions only.
 */

/* ── Unit conversion tables ──────────────────────────────── */

const LENGTH_TO_M: Record<string, number> = {
  m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254, yds: 0.9144,
};

const WEIGHT_TO_KG: Record<string, number> = {
  kg: 1, lbs: 0.453592, tons: 907.185, met_tons: 1000,
};

const AREA_TO_M2: Record<string, number> = {
  m2: 1, ft2: 0.092903, acre: 4046.86, hectare: 10000,
};

const VOLUME_TO_M3: Record<string, number> = {
  m3: 1, ft3: 0.0283168, yds3: 0.764555, litre: 0.001, gallon: 0.00378541,
};

function convert(value: number, from: string, to: string, table: Record<string, number>): number {
  const fBase = table[from];
  const tBase = table[to];
  if (fBase == null || tBase == null) return NaN;
  return (value * fBase) / tBase;
}

export const convertLength  = (v: number, from: string, to: string) => convert(v, from, to, LENGTH_TO_M);
export const convertWeight  = (v: number, from: string, to: string) => convert(v, from, to, WEIGHT_TO_KG);
export const convertArea    = (v: number, from: string, to: string) => convert(v, from, to, AREA_TO_M2);
export const convertVolume  = (v: number, from: string, to: string) => convert(v, from, to, VOLUME_TO_M3);

/* ── Feet-Inches-Fractions ───────────────────────────────────
   Construction Master Pro style dimension input/output. Internal
   representation is total INCHES (decimal). Parsing accepts a
   wide range of formats; formatting rounds to nearest 1/16 (or
   1/32 if requested) and simplifies the fraction.

   Supported parse inputs:
     "3'10 1/4\""    → 3*12 + 10 + 1/4 = 46.25
     "3' 10\""       → 46
     "3'"            → 36
     "10\""          → 10
     "10 1/4"        → 10.25
     "1/2\""         → 0.5
     "3'10-1/4\""    → 46.25 (dash variant)
     "3.5'"          → 42 (decimal feet)
     "-3'10\""       → -46
*/

const FT_IN_REGEX = {
  feet: /^(-?)\s*(\d+(?:\.\d+)?)\s*'/,
  wholeFrac: /^\s*(\d+(?:\.\d+)?)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)\s*"?/,
  fracOnly: /^\s*(\d+)\s*\/\s*(\d+)\s*"?/,
  decimal: /^\s*(-?\d+(?:\.\d+)?)\s*"?/,
};

export function parseFeetInches(input: string): number | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;

  let total = 0;
  let consumed = 0;
  let signApplied = 1;

  // Feet portion: "N'" or "-N'"
  const feetMatch = s.match(FT_IN_REGEX.feet);
  if (feetMatch) {
    if (feetMatch[1] === '-') signApplied = -1;
    total += parseFloat(feetMatch[2]) * 12;
    consumed = feetMatch[0].length;
  }

  const rest = s.substring(consumed).trim();
  if (!rest) return signApplied * total;

  // Whole inches + fraction: "10 1/4"" or "10-1/4""
  const wf = rest.match(FT_IN_REGEX.wholeFrac);
  if (wf) {
    const denom = parseFloat(wf[3]);
    if (denom === 0) return null;
    total += parseFloat(wf[1]) + parseFloat(wf[2]) / denom;
    return signApplied * total;
  }

  // Fraction only: "1/2""
  const fo = rest.match(FT_IN_REGEX.fracOnly);
  if (fo) {
    const denom = parseFloat(fo[2]);
    if (denom === 0) return null;
    total += parseFloat(fo[1]) / denom;
    return signApplied * total;
  }

  // Decimal inches: "10.25"" or "10""
  const dec = rest.match(FT_IN_REGEX.decimal);
  if (dec) {
    const v = parseFloat(dec[1]);
    // If feet was already consumed, decimal is inches WITHOUT its own sign
    if (consumed > 0) total += Math.abs(v);
    else {
      total += Math.abs(v);
      if (v < 0) signApplied = -1;
    }
    return signApplied * total;
  }

  return null;
}

export function formatFeetInches(totalInches: number, precision: 16 | 32 = 16): string {
  if (!isFinite(totalInches)) return 'Error';
  if (totalInches === 0) return '0"';

  const sign = totalInches < 0 ? '-' : '';
  const abs = Math.abs(totalInches);

  // Round inches portion to nearest 1/precision (e.g. 1/16) using scaled int math
  const totalScaled = Math.round(abs * precision);

  // Decompose: scaled / precision = inches; further /12 = feet
  let feet = Math.floor(totalScaled / (12 * precision));
  const remainderScaled = totalScaled - feet * 12 * precision;
  let wholeInches = Math.floor(remainderScaled / precision);
  let fracN = remainderScaled - wholeInches * precision;
  let fracD = precision;

  // Carry: if fracN === precision (shouldn't happen post-round but defensively)
  if (fracN >= precision) {
    fracN -= precision;
    wholeInches += 1;
  }
  if (wholeInches >= 12) {
    feet += Math.floor(wholeInches / 12);
    wholeInches = wholeInches % 12;
  }

  // Simplify fraction (divide by 2 until odd)
  while (fracN > 0 && fracN % 2 === 0) {
    fracN /= 2;
    fracD /= 2;
  }

  const parts: string[] = [];

  if (feet > 0) {
    parts.push(`${feet}'`);
    // When feet > 0, always show the inches digit (even 0) for clarity:
    // "9' 0 3/4\"" not "9' 3/4\"" — matches Construction Master Pro convention.
    if (wholeInches > 0 || fracN > 0) {
      if (fracN > 0) {
        parts.push(`${wholeInches} ${fracN}/${fracD}"`);
      } else {
        parts.push(`${wholeInches}"`);
      }
    }
  } else {
    if (wholeInches > 0 && fracN > 0) {
      parts.push(`${wholeInches} ${fracN}/${fracD}"`);
    } else if (wholeInches > 0) {
      parts.push(`${wholeInches}"`);
    } else if (fracN > 0) {
      parts.push(`${fracN}/${fracD}"`);
    } else {
      parts.push('0"');
    }
  }

  return sign + parts.join(' ');
}

/* ── DMS ↔ Degrees ───────────────────────────────────────── */

export function dmsToDeg(dms: number): number {
  // Float-safe: 45.3 - 45 = 0.29999...716 in IEEE 754, which would make
  // Math.floor(rest * 100) = 29 instead of 30. Round once at high precision.
  const sign = dms < 0 ? -1 : 1;
  const totalScaled = Math.round(Math.abs(dms) * 1e8);
  const d = Math.floor(totalScaled / 1e8);
  const rest = totalScaled - d * 1e8;
  const m = Math.floor(rest / 1e6);
  const s = (rest - m * 1e6) / 1e4;
  return sign * (d + m / 60 + s / 3600);
}

export function degToDms(deg: number): number {
  // Float-safe + sign-aware (Math.floor(-45.5) = -46, not -45 — wrong for DMS).
  // Work in absolute then re-apply sign. Scale to micro-seconds to absorb drift
  // (e.g. (45 + 1/60) - 45 = 0.0166... where * 60 may give 0.99999..., not 1).
  const sign = deg < 0 ? -1 : 1;
  const abs = Math.abs(deg);
  const totalMicroSec = Math.round(abs * 3600 * 1e6);
  const d = Math.floor(totalMicroSec / (3600 * 1e6));
  const restAfterDeg = totalMicroSec - d * 3600 * 1e6;
  const m = Math.floor(restAfterDeg / (60 * 1e6));
  const s = (restAfterDeg - m * 60 * 1e6) / 1e6;
  return sign * (d + m / 100 + s / 10000);
}

/* ── Roofing ─────────────────────────────────────────────── */

export function calcDiagonal(rise: number, run: number): number {
  return Math.sqrt(rise * rise + run * run);
}

export function calcHipValley(rise: number, run: number): number {
  return Math.sqrt(rise * rise + 2 * run * run);
}

export function calcSlopePercent(rise: number, run: number): number {
  if (run === 0) return Infinity;
  return (rise / run) * 100;
}

export function calcRoofArea(diag: number, length: number): number {
  return diag * length;
}

export function pitchToAngle(pitch: number): number {
  return Math.atan(pitch / 12) * (180 / Math.PI);
}

/* ── Slope conversions (x:12 ↔ degrees ↔ percent) ────────── */

export function pitchToPercent(pitch: number): number {
  return (pitch / 12) * 100;
}

export function percentToPitch(pct: number): number {
  return (pct / 100) * 12;
}

export function degreesToPitch(deg: number): number {
  return Math.tan(deg * Math.PI / 180) * 12;
}

export function degreesToPercent(deg: number): number {
  return Math.tan(deg * Math.PI / 180) * 100;
}

export function percentToDegrees(pct: number): number {
  return Math.atan(pct / 100) * (180 / Math.PI);
}

/** Standard pitch table for quick reference */
export const PITCH_TABLE = [
  { pitch: 1,  deg: 4.76,  pct: 8.33,  label: 'Très plat' },
  { pitch: 2,  deg: 9.46,  pct: 16.67, label: 'Plat' },
  { pitch: 3,  deg: 14.04, pct: 25.0,  label: 'Faible' },
  { pitch: 4,  deg: 18.43, pct: 33.33, label: 'Faible' },
  { pitch: 5,  deg: 22.62, pct: 41.67, label: 'Modere' },
  { pitch: 6,  deg: 26.57, pct: 50.0,  label: 'Standard' },
  { pitch: 7,  deg: 30.26, pct: 58.33, label: 'Standard' },
  { pitch: 8,  deg: 33.69, pct: 66.67, label: 'Raide' },
  { pitch: 9,  deg: 36.87, pct: 75.0,  label: 'Raide' },
  { pitch: 10, deg: 39.81, pct: 83.33, label: 'Très raide' },
  { pitch: 11, deg: 42.51, pct: 91.67, label: 'Très raide' },
  { pitch: 12, deg: 45.0,  pct: 100.0, label: '45 degres' },
];

/* ── Stairs (Blondel: 2h + g ≈ 63 cm) ───────────────────── */

export interface StairResult {
  risers: number;
  treads: number;
  riserHeight: number;
  treadDepth: number;
  totalRun: number;
  stringerLength: number;
  blondel: number;
}

export function calcStairs(totalHeight: number, maxRiser?: number): StairResult {
  const idealRiser = maxRiser ?? 18; // cm
  let risers = Math.round(totalHeight / idealRiser);
  if (risers < 1) risers = 1;
  const riserHeight = totalHeight / risers;
  const treadDepth = 63 - 2 * riserHeight; // Blondel formula
  const treads = risers - 1;
  const totalRun = treads * treadDepth;
  const stringerLength = Math.sqrt(totalHeight * totalHeight + totalRun * totalRun);
  return {
    risers,
    treads,
    riserHeight: Math.round(riserHeight * 100) / 100,
    treadDepth: Math.round(treadDepth * 100) / 100,
    totalRun: Math.round(totalRun * 100) / 100,
    stringerLength: Math.round(stringerLength * 100) / 100,
    blondel: Math.round((2 * riserHeight + treadDepth) * 100) / 100,
  };
}

/* ── Circle ──────────────────────────────────────────────── */

export interface CircleResult {
  radius: number;
  diameter: number;
  circumference: number;
  area: number;
}

export function calcCircle(radius: number): CircleResult {
  return {
    radius,
    diameter: 2 * radius,
    circumference: 2 * Math.PI * radius,
    area: Math.PI * radius * radius,
  };
}

/* ── Arc ─────────────────────────────────────────────────── */

export interface ArcResult {
  rise: number;
  arcLength: number;
  angleDeg: number;
  angleRad: number;
}

export function calcArc(radius: number, chord: number): ArcResult {
  const halfChord = chord / 2;
  const rise = radius - Math.sqrt(radius * radius - halfChord * halfChord);
  const angleRad = 2 * Math.asin(halfChord / radius);
  const arcLength = radius * angleRad;
  return {
    rise: Math.round(rise * 10000) / 10000,
    arcLength: Math.round(arcLength * 10000) / 10000,
    angleDeg: Math.round(angleRad * (180 / Math.PI) * 100) / 100,
    angleRad: Math.round(angleRad * 10000) / 10000,
  };
}

/* ── Polygon ─────────────────────────────────────────────── */

export interface PolygonResult {
  interiorAngle: number;
  apothem: number;
  circumradius: number;
  perimeter: number;
  area: number;
}

export function calcPolygon(sides: number, sideLength: number): PolygonResult {
  const interiorAngle = ((sides - 2) * 180) / sides;
  const apothem = sideLength / (2 * Math.tan(Math.PI / sides));
  const circumradius = sideLength / (2 * Math.sin(Math.PI / sides));
  const perimeter = sides * sideLength;
  const area = (perimeter * apothem) / 2;
  return {
    interiorAngle: Math.round(interiorAngle * 100) / 100,
    apothem: Math.round(apothem * 10000) / 10000,
    circumradius: Math.round(circumradius * 10000) / 10000,
    perimeter: Math.round(perimeter * 10000) / 10000,
    area: Math.round(area * 10000) / 10000,
  };
}

/* ── Compound Miter ──────────────────────────────────────── */

export interface CompoundMiterResult {
  miterAngle: number;
  bevelAngle: number;
}

export function calcCompoundMiter(cornerAngle: number, slopeAngle: number): CompoundMiterResult {
  const cornerRad = (cornerAngle * Math.PI) / 180;
  const slopeRad = (slopeAngle * Math.PI) / 180;
  const miter = Math.atan(Math.sin(slopeRad) / Math.tan(cornerRad / 2)) * (180 / Math.PI);
  const bevel = Math.atan(Math.cos(cornerRad / 2) * Math.tan(slopeRad)) * (180 / Math.PI);
  return {
    miterAngle: Math.round(miter * 100) / 100,
    bevelAngle: Math.round(bevel * 100) / 100,
  };
}

export function calcSpringAngle(springAngle: number, cornerAngle: number): CompoundMiterResult {
  const springRad = (springAngle * Math.PI) / 180;
  const cornerRad = (cornerAngle * Math.PI) / 180;
  const miter = Math.atan(Math.sin(springRad) / Math.tan(cornerRad / 2)) * (180 / Math.PI);
  const bevel = Math.atan(Math.cos(cornerRad / 2) * Math.tan(springRad)) * (180 / Math.PI);
  return {
    miterAngle: Math.round(miter * 100) / 100,
    bevelAngle: Math.round(bevel * 100) / 100,
  };
}

/* ── Jack Rafter ─────────────────────────────────────────── */

export interface JackRafterResult {
  jackDifference: number;
  lengthFactor: number;
  pitch: number;
  spacing: number;
}

export function calcJackRafter(pitch: number, spacing = 40): JackRafterResult {
  const pitchRad = Math.atan(pitch / 12);
  const lengthFactor = 1 / Math.cos(pitchRad);
  const jackDifference = spacing * lengthFactor;
  return {
    jackDifference: Math.round(jackDifference * 100) / 100,
    lengthFactor: Math.round(lengthFactor * 10000) / 10000,
    pitch,
    spacing,
  };
}

/* ── Column / Cone ───────────────────────────────────────── */

export interface ColumnConeResult {
  cylinderVolume: number;
  coneVolume: number;
}

export function calcColumnCone(radius: number, height: number): ColumnConeResult {
  const cyl = Math.PI * radius * radius * height;
  return {
    cylinderVolume: Math.round(cyl * 10000) / 10000,
    coneVolume: Math.round((cyl / 3) * 10000) / 10000,
  };
}

/* ── Materials ───────────────────────────────────────────── */

export function calcBlocks(length: number, height: number): number {
  const area = length * height;
  return Math.ceil((area / 0.08) * 1.05); // 0.08 m² per block, 5% waste
}

export function calcDrywall(length: number, height: number): number {
  const area = length * height;
  return Math.ceil((area / 3.0) * 1.10); // 3 m² per sheet, 10% waste
}

export function calcStuds(length: number): { studs40cm: number; studs60cm: number } {
  return {
    studs40cm: Math.ceil(length / 0.4) + 1,
    studs60cm: Math.ceil(length / 0.6) + 1,
  };
}

export function calcBoardFeet(thicknessIn: number, widthIn: number, lengthIn: number): number {
  return (thicknessIn * widthIn * lengthIn) / 144;
}

export function calcFooting(length: number, width: number, height: number): number {
  return Math.round(length * width * height * 10000) / 10000;
}

export function calcCost(unitCost: number, quantity: number): number {
  return Math.round(unitCost * quantity * 100) / 100;
}

/* ── Calculator State Machine ────────────────────────────── */

export interface CalcState {
  display: string;
  currentValue: number;
  pendingValue: number | null;
  pendingOp: string | null;
  newNumber: boolean;
  memory: number;
  rise: number | null;
  run: number | null;
  pitch: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  shiftMode: boolean;
  history: { op: string; result: number }[];
  /** For multi-step functions (Arc input #1, Polygon input #1, etc.) */
  pendingFn: string | null;
  pendingFnValue: number | null;
  lastResult: any;
  /** When true, currentValue is interpreted as INCHES and the display
   * is formatted as feet-inches-fraction (e.g. "9' 0 3/4\""). Set
   * automatically by the enterDimension action; cleared on clearAll. */
  displayAsFeetInches: boolean;
  /** Direct keypress dimension entry (3 [F] 6 [I] 1 [/] 2 [I]).
   * dimMode = true while accumulating; dimAccum holds total inches
   * already committed; dimFracNum holds the captured numerator after
   * pressing /, awaiting denominator. The next operation/equals/Feet/
   * Inch press finalizes any pending fraction and commits dimAccum
   * as currentValue. */
  dimMode: boolean;
  dimAccum: number;
  dimFracNum: number | null;
}

export function createInitialCalcState(): CalcState {
  return {
    display: '0',
    currentValue: 0,
    pendingValue: null,
    pendingOp: null,
    newNumber: true,
    memory: 0,
    rise: null,
    run: null,
    pitch: null,
    length: null,
    width: null,
    height: null,
    shiftMode: false,
    history: [],
    pendingFn: null,
    pendingFnValue: null,
    lastResult: null,
    displayAsFeetInches: false,
    dimMode: false,
    dimAccum: 0,
    dimFracNum: null,
  };
}

function addHistory(state: CalcState, op: string, result: number): CalcState {
  const history = [{ op, result }, ...state.history].slice(0, 50);
  return { ...state, history };
}

function displayNum(n: number): string {
  if (!isFinite(n)) return 'Error';
  // Show up to 8 significant digits, strip trailing zeros
  const s = Number(n.toPrecision(10)).toString();
  if (s.length > 14) return n.toExponential(6);
  return s;
}

/** Format currentValue for display, respecting displayAsFeetInches. */
export function formatCurrentValue(state: CalcState): string {
  if (state.displayAsFeetInches) return formatFeetInches(state.currentValue);
  return displayNum(state.currentValue);
}

function executePending(state: CalcState): CalcState {
  if (state.pendingOp == null || state.pendingValue == null) return state;
  const a = state.pendingValue;
  const b = state.currentValue;
  let result: number;
  switch (state.pendingOp) {
    case '+': result = a + b; break;
    case '-': result = a - b; break;
    case '*': result = a * b; break;
    case '/': result = b !== 0 ? a / b : NaN; break;
    default: return state;
  }
  return {
    ...state,
    currentValue: result,
    // Preserve feet-inches formatting through arithmetic so that
    // 3'10 1/4" + 5'2 1/2" displays as 9' 0 3/4" (not 108.75)
    display: state.displayAsFeetInches ? formatFeetInches(result) : displayNum(result),
    pendingOp: null,
    pendingValue: null,
    newNumber: true,
  };
}

/* ── Public reducer ──────────────────────────────────────── */

export type CalcAction =
  | { type: 'digit'; digit: string }
  | { type: 'decimal' }
  | { type: 'operation'; op: string }
  | { type: 'equals' }
  | { type: 'clear' }
  | { type: 'clearAll' }
  | { type: 'toggleShift' }
  | { type: 'sqrt' }
  | { type: 'square' }
  | { type: 'inverse' }
  | { type: 'percent' }
  | { type: 'plusMinus' }
  | { type: 'pi' }
  | { type: 'memoryAdd' }
  | { type: 'memorySubtract' }
  | { type: 'memoryRecall' }
  | { type: 'memoryClear' }
  | { type: 'memoryStore' }
  | { type: 'dmsDeg' }
  | { type: 'setRise' }
  | { type: 'setRun' }
  | { type: 'setPitch' }
  | { type: 'setLength' }
  | { type: 'setWidth' }
  | { type: 'setHeight' }
  | { type: 'calcDiag' }
  | { type: 'calcHipV' }
  | { type: 'calcSlopePercent' }
  | { type: 'calcRoofArea' }
  | { type: 'calcStair' }
  | { type: 'calcRiserLimited' }
  | { type: 'calcArc' }
  | { type: 'calcCirc' }
  | { type: 'calcColumnCone' }
  | { type: 'calcPolygon' }
  | { type: 'calcCompMiter' }
  | { type: 'calcSpringAngle' }
  | { type: 'calcJack' }
  | { type: 'calcBlocks' }
  | { type: 'calcDrywall' }
  | { type: 'calcStuds' }
  | { type: 'calcBoardFeet' }
  | { type: 'calcFooting' }
  | { type: 'calcCost' }
  | { type: 'convertUnit'; unit: string }
  | { type: 'enterDimension'; inches: number }
  | { type: 'toggleFeetInchesDisplay' }
  | { type: 'applyFeet' }
  | { type: 'applyInch' }
  | { type: 'fractionSep' }
  ;

export function calcReducer(state: CalcState, action: CalcAction): CalcState {
  let s = state;

  switch (action.type) {
    /* ── Digits ────────────────────────────────────────────── */
    case 'digit': {
      if (s.newNumber) {
        return { ...s, display: action.digit, currentValue: parseFloat(action.digit), newNumber: false, shiftMode: false };
      }
      const d = s.display + action.digit;
      return { ...s, display: d, currentValue: parseFloat(d), shiftMode: false };
    }
    case 'decimal': {
      if (s.newNumber) {
        return { ...s, display: '0.', currentValue: 0, newNumber: false };
      }
      if (s.display.includes('.')) return s;
      const d = s.display + '.';
      return { ...s, display: d };
    }

    /* ── Operations ────────────────────────────────────────── */
    case 'operation': {
      // Finalize any pending direct dim entry (3 [F] 6 [I] 1 [/] 2)
      // before applying the operation.
      s = finalizeDimIfNeeded(s);
      if (s.pendingOp != null && !s.newNumber) {
        s = executePending(s);
      }
      return { ...s, pendingOp: action.op, pendingValue: s.currentValue, newNumber: true };
    }
    case 'equals': {
      // Finalize any pending dim entry first (Master Pro 3-touches:
      // typing 1 [/] 2 then [=] commits the fraction automatically).
      s = finalizeDimIfNeeded(s);
      // Handle multi-step function second input
      if (s.pendingFn != null) {
        return handlePendingFn(s);
      }
      s = executePending(s);
      return addHistory(s, '=', s.currentValue);
    }

    /* ── Clear ─────────────────────────────────────────────── */
    case 'clear':
      // Soft clear: keep memory/history/dims but abandon any in-progress
      // multi-step function (Arc/Polygon/CompMiter/SpringAngle/Cost) so the
      // next press does not interpret input as the second argument.
      return { ...s, display: '0', currentValue: 0, newNumber: true, pendingFn: null, pendingFnValue: null };
    case 'clearAll':
      return {
        ...createInitialCalcState(),
        memory: s.memory, // preserve memory
        history: s.history,
      };

    /* ── Shift ─────────────────────────────────────────────── */
    case 'toggleShift':
      return { ...s, shiftMode: !s.shiftMode };

    /* ── Math functions ────────────────────────────────────── */
    case 'sqrt': {
      const r = Math.sqrt(s.currentValue);
      return addHistory({ ...s, currentValue: r, display: displayNum(r), newNumber: true, shiftMode: false }, '√', r);
    }
    case 'square': {
      const r = s.currentValue * s.currentValue;
      return addHistory({ ...s, currentValue: r, display: displayNum(r), newNumber: true, shiftMode: false }, 'x²', r);
    }
    case 'inverse': {
      if (s.currentValue === 0) return { ...s, display: 'Error', newNumber: true, shiftMode: false };
      const r = 1 / s.currentValue;
      return addHistory({ ...s, currentValue: r, display: displayNum(r), newNumber: true, shiftMode: false }, '1/x', r);
    }
    case 'percent': {
      const r = s.pendingValue != null ? (s.pendingValue * s.currentValue) / 100 : s.currentValue / 100;
      return addHistory({ ...s, currentValue: r, display: displayNum(r), newNumber: true, shiftMode: false }, '%', r);
    }
    case 'plusMinus': {
      const r = -s.currentValue;
      return { ...s, currentValue: r, display: displayNum(r), shiftMode: false };
    }
    case 'pi': {
      return { ...s, currentValue: Math.PI, display: displayNum(Math.PI), newNumber: true, shiftMode: false };
    }

    /* ── DMS ↔ Deg ─────────────────────────────────────────── */
    case 'dmsDeg': {
      // Toggle: if looks like DMS (has decimal minutes), convert to deg; else convert to DMS
      const v = s.currentValue;
      const r = v === Math.floor(v) ? v : (Math.abs(v % 1) > 0.59 ? dmsToDeg(v) : degToDms(v));
      return addHistory({ ...s, currentValue: r, display: displayNum(r), newNumber: true, shiftMode: false }, 'dms↔deg', r);
    }

    /* ── Memory ────────────────────────────────────────────── */
    case 'memoryAdd':
      return { ...s, memory: s.memory + s.currentValue, newNumber: true, shiftMode: false };
    case 'memorySubtract':
      return { ...s, memory: s.memory - s.currentValue, newNumber: true, shiftMode: false };
    case 'memoryRecall': {
      return { ...s, currentValue: s.memory, display: displayNum(s.memory), newNumber: true, shiftMode: false };
    }
    case 'memoryClear':
      return { ...s, memory: 0, shiftMode: false };
    case 'memoryStore':
      return { ...s, memory: s.currentValue, newNumber: true, shiftMode: false };

    /* ── Dimension variables ───────────────────────────────── */
    case 'setRise':
      return addHistory({ ...s, rise: s.currentValue, newNumber: true, shiftMode: false }, 'Rise=', s.currentValue);
    case 'setRun':
      return addHistory({ ...s, run: s.currentValue, newNumber: true, shiftMode: false }, 'Run=', s.currentValue);
    case 'setPitch':
      return addHistory({ ...s, pitch: s.currentValue, newNumber: true, shiftMode: false }, 'Pitch=', s.currentValue);
    case 'setLength':
      return addHistory({ ...s, length: s.currentValue, newNumber: true, shiftMode: false }, 'Length=', s.currentValue);
    case 'setWidth':
      return addHistory({ ...s, width: s.currentValue, newNumber: true, shiftMode: false }, 'Width=', s.currentValue);
    case 'setHeight':
      return addHistory({ ...s, height: s.currentValue, newNumber: true, shiftMode: false }, 'Height=', s.currentValue);

    /* ── Roofing ───────────────────────────────────────────── */
    case 'calcDiag': {
      if (s.rise == null || s.run == null) return { ...s, display: 'Set Rise/Run', newNumber: true, shiftMode: false };
      const r = calcDiagonal(s.rise, s.run);
      return addHistory({ ...s, currentValue: r, display: displayNum(r), newNumber: true, shiftMode: false, lastResult: { type: 'diag', value: r } }, 'Diag', r);
    }
    case 'calcHipV': {
      if (s.rise == null || s.run == null) return { ...s, display: 'Set Rise/Run', newNumber: true, shiftMode: false };
      const r = calcHipValley(s.rise, s.run);
      return addHistory({ ...s, currentValue: r, display: displayNum(r), newNumber: true, shiftMode: false, lastResult: { type: 'hipv', value: r } }, 'Hip/V', r);
    }
    case 'calcSlopePercent': {
      if (s.rise == null || s.run == null) return { ...s, display: 'Set Rise/Run', newNumber: true, shiftMode: false };
      const r = calcSlopePercent(s.rise, s.run);
      return addHistory({ ...s, currentValue: r, display: displayNum(r), newNumber: true, shiftMode: false }, 'Slope%', r);
    }
    case 'calcRoofArea': {
      if (s.rise == null || s.run == null || s.length == null) return { ...s, display: 'Set Rise/Run/Len', newNumber: true, shiftMode: false };
      const diag = calcDiagonal(s.rise, s.run);
      const r = calcRoofArea(diag, s.length);
      return addHistory({ ...s, currentValue: r, display: displayNum(r), newNumber: true, shiftMode: false, lastResult: { type: 'roofArea', value: r } }, 'Roof Area', r);
    }

    /* ── Stairs ────────────────────────────────────────────── */
    case 'calcStair': {
      const h = s.height ?? s.currentValue;
      if (!h) return { ...s, display: 'Set Height', newNumber: true, shiftMode: false };
      const result = calcStairs(h);
      return addHistory({ ...s, currentValue: result.risers, display: `${result.risers} risers`, newNumber: true, shiftMode: false, lastResult: { type: 'stair', ...result } }, 'Stair', result.risers);
    }
    case 'calcRiserLimited': {
      const h = s.height ?? s.currentValue;
      if (!h) return { ...s, display: 'Set Height', newNumber: true, shiftMode: false };
      const maxRiser = s.currentValue || 17;
      const result = calcStairs(h, maxRiser);
      return addHistory({ ...s, currentValue: result.risers, display: `${result.risers} risers`, newNumber: true, shiftMode: false, lastResult: { type: 'stair', ...result } }, 'Riser Ltd', result.risers);
    }

    /* ── Arc (2-step: first input radius → second input chord) */
    case 'calcArc': {
      if (s.pendingFn === 'arc') return handlePendingFn(s);
      return { ...s, pendingFn: 'arc', pendingFnValue: s.currentValue, display: 'Chord?', newNumber: true, shiftMode: false };
    }

    /* ── Circle ────────────────────────────────────────────── */
    case 'calcCirc': {
      const r = calcCircle(s.currentValue);
      return addHistory({ ...s, currentValue: r.area, display: displayNum(r.area), newNumber: true, shiftMode: false, lastResult: { type: 'circle', ...r } }, 'Circle', r.area);
    }

    /* ── Column/Cone ───────────────────────────────────────── */
    case 'calcColumnCone': {
      const h = s.height ?? 0;
      const radius = s.currentValue;
      if (!h || !radius) return { ...s, display: 'Set Height+R', newNumber: true, shiftMode: false };
      const r = calcColumnCone(radius, h);
      return addHistory({ ...s, currentValue: r.cylinderVolume, display: displayNum(r.cylinderVolume), newNumber: true, shiftMode: false, lastResult: { type: 'columnCone', ...r } }, 'Col/Cone', r.cylinderVolume);
    }

    /* ── Polygon (2-step: sides → side length) ─────────────── */
    case 'calcPolygon': {
      if (s.pendingFn === 'polygon') return handlePendingFn(s);
      return { ...s, pendingFn: 'polygon', pendingFnValue: s.currentValue, display: 'Side len?', newNumber: true, shiftMode: false };
    }

    /* ── Compound Miter (2-step: corner → slope) ───────────── */
    case 'calcCompMiter': {
      if (s.pendingFn === 'compMiter') return handlePendingFn(s);
      return { ...s, pendingFn: 'compMiter', pendingFnValue: s.currentValue, display: 'Slope°?', newNumber: true, shiftMode: false };
    }

    /* ── Spring Angle (2-step: spring → corner) ────────────── */
    case 'calcSpringAngle': {
      if (s.pendingFn === 'springAngle') return handlePendingFn(s);
      return { ...s, pendingFn: 'springAngle', pendingFnValue: s.currentValue, display: 'Corner°?', newNumber: true, shiftMode: false };
    }

    /* ── Jack Rafter ───────────────────────────────────────── */
    case 'calcJack': {
      const p = s.pitch;
      if (p == null) return { ...s, display: 'Set Pitch', newNumber: true, shiftMode: false };
      const r = calcJackRafter(p, s.currentValue || 40);
      return addHistory({ ...s, currentValue: r.jackDifference, display: displayNum(r.jackDifference), newNumber: true, shiftMode: false, lastResult: { type: 'jack', ...r } }, 'Jack', r.jackDifference);
    }

    /* ── Material calculations ─────────────────────────────── */
    case 'calcBlocks': {
      const l = s.length, h = s.height;
      if (l == null || h == null) return { ...s, display: 'Set L/H', newNumber: true, shiftMode: false };
      const r = calcBlocks(l, h);
      return addHistory({ ...s, currentValue: r, display: `${r} blocs`, newNumber: true, shiftMode: false, lastResult: { type: 'blocks', value: r } }, 'Blocks', r);
    }
    case 'calcDrywall': {
      const l = s.length, h = s.height;
      if (l == null || h == null) return { ...s, display: 'Set L/H', newNumber: true, shiftMode: false };
      const r = calcDrywall(l, h);
      return addHistory({ ...s, currentValue: r, display: `${r} feuilles`, newNumber: true, shiftMode: false, lastResult: { type: 'drywall', value: r } }, 'Drywall', r);
    }
    case 'calcStuds': {
      const l = s.length ?? s.currentValue;
      if (!l) return { ...s, display: 'Set Length', newNumber: true, shiftMode: false };
      const r = calcStuds(l);
      return addHistory({ ...s, currentValue: r.studs40cm, display: `${r.studs40cm}@40 / ${r.studs60cm}@60`, newNumber: true, shiftMode: false, lastResult: { type: 'studs', ...r } }, 'Studs', r.studs40cm);
    }
    case 'calcBoardFeet': {
      const l = s.length ?? 0, w = s.width ?? 0, h = s.height ?? 0;
      if (!l || !w || !h) return { ...s, display: 'Set L/W/H', newNumber: true, shiftMode: false };
      const r = calcBoardFeet(h, w, l); // thickness=h, width=w, length=l in inches
      return addHistory({ ...s, currentValue: r, display: displayNum(r) + ' bd ft', newNumber: true, shiftMode: false }, 'Bd Ft', r);
    }
    case 'calcFooting': {
      const l = s.length ?? 0, w = s.width ?? 0, h = s.height ?? 0;
      if (!l || !w || !h) return { ...s, display: 'Set L/W/H', newNumber: true, shiftMode: false };
      const r = calcFooting(l, w, h);
      return addHistory({ ...s, currentValue: r, display: displayNum(r) + ' m³', newNumber: true, shiftMode: false }, 'Footing', r);
    }
    case 'calcCost': {
      if (s.pendingFn === 'cost') return handlePendingFn(s);
      return { ...s, pendingFn: 'cost', pendingFnValue: s.currentValue, display: 'Qty?', newNumber: true, shiftMode: false };
    }

    /* ── Unit conversion ───────────────────────────────────── */
    case 'convertUnit': {
      const unit = action.unit;
      let r = s.currentValue;
      let label = unit;
      // User input is IN the selected unit → convert TO base unit (m, kg, m²)
      if (LENGTH_TO_M[unit] != null) {
        r = s.currentValue * LENGTH_TO_M[unit];
        label = `${unit} → m`;
      } else if (WEIGHT_TO_KG[unit] != null) {
        r = s.currentValue * WEIGHT_TO_KG[unit];
        label = `${unit} → kg`;
      } else if (AREA_TO_M2[unit] != null) {
        r = s.currentValue * AREA_TO_M2[unit];
        label = `${unit} → m²`;
      }
      return addHistory({ ...s, currentValue: r, display: displayNum(r), newNumber: true, shiftMode: false }, label, r);
    }

    /* ── Feet-Inches dimension ─────────────────────────────── */
    case 'enterDimension': {
      const inches = action.inches;
      const display = formatFeetInches(inches);
      return addHistory(
        {
          ...s,
          currentValue: inches,
          display,
          newNumber: true,
          shiftMode: false,
          displayAsFeetInches: true,
        },
        `Dim ${display}`,
        inches,
      );
    }
    case 'toggleFeetInchesDisplay': {
      const next = !s.displayAsFeetInches;
      return {
        ...s,
        displayAsFeetInches: next,
        display: next ? formatFeetInches(s.currentValue) : displayNum(s.currentValue),
      };
    }

    /* ── Direct dimension entry (Master Pro 3-touches) ────────
       3 [Feet] 6 [Inch] 1 [/] 2 [Inch] -- accumule dans dimAccum
       et auto-commit a la prochaine operation/equals. */
    case 'applyFeet': {
      // Take current digit buffer as feet, append 12*N inches to accum.
      const buf = s.newNumber ? 0 : s.currentValue;
      const accum = s.dimAccum + buf * 12;
      return {
        ...s,
        dimMode: true,
        dimAccum: accum,
        dimFracNum: null,
        currentValue: accum,
        display: formatFeetInches(accum),
        newNumber: true,
        shiftMode: false,
        displayAsFeetInches: true,
      };
    }
    case 'applyInch': {
      // If a fraction was started (dimFracNum != null) and we have a denominator
      // in the digit buffer, finalize the fraction. Otherwise, add buffer as
      // whole inches.
      let accum = s.dimAccum;
      if (s.dimFracNum != null && !s.newNumber && s.currentValue !== 0) {
        // 1/D inches
        accum += s.dimFracNum / s.currentValue;
      } else if (!s.newNumber) {
        accum += s.currentValue;
      }
      return {
        ...s,
        dimMode: true,
        dimAccum: accum,
        dimFracNum: null,
        currentValue: accum,
        display: formatFeetInches(accum),
        newNumber: true,
        shiftMode: false,
        displayAsFeetInches: true,
      };
    }
    case 'fractionSep': {
      // Capture current digit buffer as numerator, await denominator.
      // Only valid in dim mode after Inch.
      if (!s.dimMode || s.newNumber) return s;
      return {
        ...s,
        dimFracNum: s.currentValue,
        newNumber: true,
      };
    }

    default:
      return s;
  }
}

/* Helper: finalize any pending dim entry (commit dimAccum as currentValue,
   add pending fraction if any). Used by operation/equals to "exit" dim mode
   so subsequent arithmetic uses the accumulated total. Returns updated state. */
function finalizeDimIfNeeded(s: CalcState): CalcState {
  if (!s.dimMode) return s;
  let accum = s.dimAccum;
  // If a fraction was started but not completed (1 / -- waiting for denom)
  // or partially completed, try to apply it.
  if (s.dimFracNum != null && !s.newNumber && s.currentValue !== 0) {
    accum += s.dimFracNum / s.currentValue;
  } else if (s.dimFracNum == null && !s.newNumber && s.currentValue > 0) {
    // Plain digits typed after Inch -- treat as additional inches.
    accum += s.currentValue;
  }
  return {
    ...s,
    dimMode: false,
    dimAccum: 0,
    dimFracNum: null,
    currentValue: accum,
    display: formatFeetInches(accum),
    newNumber: true,
  };
}

/* ── UI helper: pick the right CalcAction for a button press ──
   Multi-step functions accessed via shift mode (Polygon, SpringAngle,
   Cost) need special handling: shiftMode auto-resets after the first
   press and on every digit, so the second press would dispatch the
   PRIMARY action instead of the multi-step resolver. This helper
   detects an in-flight matching pendingFn and forces the shift action
   regardless of shiftMode -- mimics the real Construction Master Pro
   "Conv-sticky" behavior. Returns the action to dispatch. */
const PENDING_TO_RESOLVER: Record<string, CalcAction['type']> = {
  polygon: 'calcPolygon',
  springAngle: 'calcSpringAngle',
  cost: 'calcCost',
};

export function resolveAction(
  state: CalcState,
  primary: CalcAction,
  shift?: CalcAction,
): CalcAction {
  if (shift && state.pendingFn) {
    const expected = PENDING_TO_RESOLVER[state.pendingFn];
    if (expected && expected === shift.type) return shift;
  }
  return state.shiftMode && shift ? shift : primary;
}

/* ── Handle multi-step functions ─────────────────────────── */

function handlePendingFn(state: CalcState): CalcState {
  const fn = state.pendingFn;
  const v1 = state.pendingFnValue!;
  const v2 = state.currentValue;
  let s = { ...state, pendingFn: null, pendingFnValue: null };

  switch (fn) {
    case 'arc': {
      const r = calcArc(v1, v2);
      return addHistory({ ...s, currentValue: r.arcLength, display: displayNum(r.arcLength), newNumber: true, lastResult: { type: 'arc', ...r } }, 'Arc', r.arcLength);
    }
    case 'polygon': {
      const r = calcPolygon(v1, v2);
      return addHistory({ ...s, currentValue: r.area, display: displayNum(r.area), newNumber: true, lastResult: { type: 'polygon', ...r } }, 'Polygon', r.area);
    }
    case 'compMiter': {
      const r = calcCompoundMiter(v1, v2);
      return addHistory({ ...s, currentValue: r.miterAngle, display: `M${displayNum(r.miterAngle)}° B${displayNum(r.bevelAngle)}°`, newNumber: true, lastResult: { type: 'compMiter', ...r } }, 'Comp Miter', r.miterAngle);
    }
    case 'springAngle': {
      const r = calcSpringAngle(v1, v2);
      return addHistory({ ...s, currentValue: r.miterAngle, display: `M${displayNum(r.miterAngle)}° B${displayNum(r.bevelAngle)}°`, newNumber: true, lastResult: { type: 'springAngle', ...r } }, 'Spring', r.miterAngle);
    }
    case 'cost': {
      const r = calcCost(v1, v2);
      return addHistory({ ...s, currentValue: r, display: displayNum(r), newNumber: true }, 'Cost', r);
    }
    default:
      return s;
  }
}
