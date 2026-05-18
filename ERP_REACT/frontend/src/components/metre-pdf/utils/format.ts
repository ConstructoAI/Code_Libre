import type { Point, Calibration, MeasurementUnit } from '../types';
import { distance } from './geometry';
import { formatFeetImperial, formatInchesImperial } from './imperialInput';

/* ── unit conversion factors (everything relative to metres) ── */

const TO_METRES: Record<string, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  ft: 0.3048,
  in: 0.0254,
};

/**
 * Convert a value from one linear unit to another.
 * For area, pass the linear conversion — caller squares it.
 */
export function convertUnit(
  value: number,
  fromUnit: string,
  toUnit: string,
): number {
  if (fromUnit === toUnit) return value;
  const fromFactor = TO_METRES[fromUnit];
  const toFactor = TO_METRES[toUnit];
  if (fromFactor === undefined || toFactor === undefined) return value;
  return (value * fromFactor) / toFactor;
}

/** Human-readable label for a measurement unit. */
export function getUnitLabel(unit: string): string {
  const labels: Record<string, string> = {
    mm: 'mm',
    cm: 'cm',
    m: 'm',
    ft: 'ft',
    in: 'in',
  };
  return labels[unit] ?? unit;
}

/** Return the appropriate area unit string (e.g. "m" -> "m²"). */
function areaUnitLabel(unit: string): string {
  return `${getUnitLabel(unit)}\u00B2`;
}

/**
 * Format a measurement value for display.
 *
 * Linear measurements in `ft` / `in` (imperial calibration) are rendered in
 * the standard QC/NA construction format (feet-inches-fraction at 1/16"
 * precision, e.g. `27'-0 5/8"`). Metric units (mm/cm/m) keep decimal
 * formatting. Areas keep decimal regardless of unit (no meaningful
 * fraction format for `pi\u00B2`).
 *
 * @param value - The numeric measurement value
 * @param unit  - The unit of measurement (m, cm, mm, ft, in)
 * @param type  - The measurement type (distance, area, perimeter, angle, count)
 */
export function formatMeasurement(
  value: number,
  unit: string,
  type: string,
): string {
  const v = value ?? 0;
  switch (type) {
    case 'angle':
      return `${v.toFixed(1)}\u00B0`;
    case 'count':
      return `${Math.round(v)}`;
    case 'area':
      // Area in pi\u00B2 / m\u00B2 stays decimal (fractioning surfaces is not standard)
      return `${v.toFixed(2)} ${areaUnitLabel(unit)}`;
    case 'dimension':
    case 'distance':
    case 'perimeter':
    default:
      // Linear: imperial -> feet-inches-fraction, metric -> decimal
      if (unit === 'ft') return formatFeetImperial(v);
      if (unit === 'in') return formatInchesImperial(v);
      return `${v.toFixed(2)} ${getUnitLabel(unit)}`;
  }
}

/**
 * Format a page coordinate, optionally converting to world coordinates
 * when a calibration is available.
 */
export function formatCoordinate(
  point: Point,
  calibration: Calibration | null,
): string {
  if (calibration) {
    const wx = point.x * calibration.scaleFactor;
    const wy = point.y * calibration.scaleFactor;
    const u = getUnitLabel(calibration.unit);
    return `(${(wx ?? 0).toFixed(2)} ${u}, ${(wy ?? 0).toFixed(2)} ${u})`;
  }
  return `(${(point.x ?? 0).toFixed(1)} px, ${(point.y ?? 0).toFixed(1)} px)`;
}

/**
 * Generate a default label for a measurement.
 */
export function defaultMeasurementLabel(
  type: string,
  index: number,
): string {
  const labels: Record<string, string> = {
    distance: 'Distance',
    area: 'Aire',
    perimeter: 'Périmètre',
    polyline: 'Polyligne',
    angle: 'Angle',
    count: 'Comptage',
    dimension: 'Cotation',
    symbol: 'Symbole',
  };
  return `${labels[type] ?? type} ${index + 1}`;
}

/**
 * All supported measurement units.
 */
export const MEASUREMENT_UNITS: { value: MeasurementUnit; label: string }[] = [
  { value: 'mm', label: 'Millimètres (mm)' },
  { value: 'cm', label: 'Centimètres (cm)' },
  { value: 'm', label: 'Mètres (m)' },
  { value: 'ft', label: 'Pieds (ft)' },
  { value: 'in', label: 'Pouces (in)' },
];

/* ── Per-segment dimensions for multi-point measurements ── */

export interface SegmentInfo {
  /** 0-based index along the segment list */
  index: number;
  /** Page-coordinate start point */
  startPoint: Point;
  /** Page-coordinate end point */
  endPoint: Point;
  /** Page-coordinate midpoint (used to anchor canvas labels) */
  midPoint: Point;
  /** Raw pixel length on the PDF page */
  pixelLength: number;
  /** Length in the calibration unit, or null if no calibration is set */
  realLength: number | null;
  /** Length expressed in the display unit (real-world or pixel fallback) */
  displayLength: number;
  /** Pre-formatted string like "12.34 m" or "145 px" */
  formatted: string;
}

/**
 * Compute per-segment information for a multi-point measurement.
 *
 * For an open shape (polyline) we emit N-1 segments; for a closed shape
 * (area, perimeter) we also include the wrap-around edge `last → first`.
 *
 * Falls back to pixel lengths when the page is not calibrated, so the panel
 * stays useful even before the user has run the calibration tool.
 */
export function computeSegments(
  points: Point[],
  closed: boolean,
  calibration: Calibration | null,
  displayUnit: string,
): SegmentInfo[] {
  if (!points || points.length < 2) return [];

  const n = points.length;
  const limit = closed && n >= 3 ? n : n - 1;
  const segments: SegmentInfo[] = [];

  for (let i = 0; i < limit; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const pixelLength = distance(a, b);

    let realLength: number | null = null;
    let displayLength: number;
    let formatted: string;

    if (calibration && Number.isFinite(calibration.scaleFactor) && calibration.scaleFactor > 0) {
      realLength = pixelLength * calibration.scaleFactor;
      displayLength = convertUnit(realLength, calibration.unit, displayUnit);
      // Imperial linear units render in feet-inches-fraction (1/16" precision)
      // for QC/NA construction conventions; metric stays decimal.
      if (Number.isFinite(displayLength)) {
        if (displayUnit === 'ft') {
          formatted = formatFeetImperial(displayLength);
        } else if (displayUnit === 'in') {
          formatted = formatInchesImperial(displayLength);
        } else {
          formatted = `${displayLength.toFixed(2)} ${getUnitLabel(displayUnit)}`;
        }
      } else {
        formatted = `— ${getUnitLabel(displayUnit)}`;
      }
    } else {
      displayLength = Number.isFinite(pixelLength) ? pixelLength : 0;
      formatted = `${displayLength.toFixed(0)} px`;
    }

    segments.push({
      index: i,
      startPoint: a,
      endPoint: b,
      midPoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      pixelLength,
      realLength,
      displayLength,
      formatted,
    });
  }

  return segments;
}

/** Measurement types that have meaningful per-segment dimensions. */
export function hasSegmentDimensions(type: string): boolean {
  return type === 'polyline' || type === 'area' || type === 'perimeter';
}

/** Whether a measurement type forms a closed shape (last point connects back to first). */
export function isClosedShape(type: string): boolean {
  return type === 'area' || type === 'perimeter';
}

/**
 * Measurement types that expose a draggable midpoint on each edge
 * ("stretch" handle, à la AutoCAD): distance, polyline, area, perimeter.
 * Distance has a single edge (one midpoint); polyline yields N-1 midpoints;
 * area / perimeter add the closing edge so they yield N midpoints.
 */
export function hasEdgeMidpoints(type: string): boolean {
  return (
    type === 'distance' ||
    type === 'polyline' ||
    type === 'area' ||
    type === 'perimeter'
  );
}
