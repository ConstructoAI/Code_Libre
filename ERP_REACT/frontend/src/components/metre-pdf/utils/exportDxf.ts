import type { Measurement, Calibration, SymbolBlockDef } from '../types';
import { computeDimensionGeometry } from './geometry';

/* ── Coordinate helpers ──────────────────────────── */

/**
 * Flip Y axis (screen coords → CAD coords) and apply real-world scale.
 */
function coordTransform(
  x: number,
  y: number,
  maxY: number,
  scale: number,
): [number, number] {
  return [x * scale, (maxY - y) * scale];
}

/**
 * Map measurement unit string to DXF $INSUNITS code.
 *   1 = inches, 2 = feet, 4 = mm, 5 = cm, 6 = m
 */
function insUnitsCode(unit: string): number {
  switch (unit) {
    case 'in': return 1;
    case 'ft': return 2;
    case 'mm': return 4;
    case 'cm': return 5;
    case 'm':
    default:
      return 6;
  }
}

/* ── DXF section builders ────────────────────────── */

function dxfHeader(units: string): string {
  const code = insUnitsCode(units);
  return [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$INSUNITS',
    '70', String(code),
    '0', 'ENDSEC',
  ].join('\n');
}

function dxfTables(layerNames: string[]): string {
  const lines: string[] = [
    '0', 'SECTION',
    '2', 'TABLES',
    '0', 'TABLE',
    '2', 'LAYER',
    '70', String(layerNames.length),
  ];
  for (const name of layerNames) {
    lines.push(
      '0', 'LAYER',
      '2', name,
      '70', '0',
      '62', '7',   // color 7 (white/black)
      '6', 'CONTINUOUS',
    );
  }
  lines.push('0', 'ENDTAB', '0', 'ENDSEC');
  return lines.join('\n');
}

/* ── DXF entity primitives ───────────────────────── */

function dxfLine(
  x1: number, y1: number,
  x2: number, y2: number,
  layer: string, color: number,
): string {
  return [
    '0', 'LINE',
    '8', layer,
    '62', String(color),
    '10', String(x1),
    '20', String(y1),
    '11', String(x2),
    '21', String(y2),
  ].join('\n');
}

function dxfLwPolyline(
  points: [number, number][],
  closed: boolean,
  layer: string,
  color: number,
): string {
  const lines: string[] = [
    '0', 'LWPOLYLINE',
    '8', layer,
    '62', String(color),
    '90', String(points.length),
    '70', closed ? '1' : '0',
  ];
  for (const [px, py] of points) {
    lines.push('10', String(px), '20', String(py));
  }
  return lines.join('\n');
}

function dxfCircle(
  cx: number, cy: number, r: number,
  layer: string, color: number,
): string {
  return [
    '0', 'CIRCLE',
    '8', layer,
    '62', String(color),
    '10', String(cx),
    '20', String(cy),
    '40', String(r),
  ].join('\n');
}

function dxfPoint(
  x: number, y: number,
  layer: string, color: number,
): string {
  return [
    '0', 'POINT',
    '8', layer,
    '62', String(color),
    '10', String(x),
    '20', String(y),
  ].join('\n');
}

function dxfText(
  x: number, y: number,
  text: string, height: number,
  layer: string, color: number,
): string {
  return [
    '0', 'TEXT',
    '8', layer,
    '62', String(color),
    '10', String(x),
    '20', String(y),
    '40', String(height),
    '1', text,
  ].join('\n');
}

/** Module-level cache populated by generateDxf before iterating measurements. */
let _symbolBlocksCache: SymbolBlockDef[] = [];

/* ── Measurement → entities ──────────────────────── */

function measurementEntities(
  m: Measurement,
  maxY: number,
  scale: number,
): string[] {
  const entities: string[] = [];
  const layer = m.type.toUpperCase();
  const color = 7; // white / default

  // Transformed points
  const pts: [number, number][] = m.points.map((p) =>
    coordTransform(p.x, p.y, maxY, scale),
  );

  // Label text
  const labelText = m.label
    ? `${m.label}: ${(m.value ?? 0).toFixed(2)} ${m.unit}`
    : `${m.type} ${(m.value ?? 0).toFixed(2)} ${m.unit}`;

  // Text height proportional to scale; clamp to a reasonable default
  const textHeight = Math.max(0.5, scale * 8);

  switch (m.type) {
    case 'distance': {
      if (pts.length >= 2) {
        entities.push(dxfLine(pts[0][0], pts[0][1], pts[1][0], pts[1][1], layer, color));
        const mx = (pts[0][0] + pts[1][0]) / 2;
        const my = (pts[0][1] + pts[1][1]) / 2;
        entities.push(dxfText(mx, my, labelText, textHeight, layer, color));
      }
      break;
    }

    case 'area':
    case 'perimeter': {
      if (pts.length >= 3) {
        entities.push(dxfLwPolyline(pts, true, layer, color));
        // Label at centroid
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        entities.push(dxfText(cx, cy, labelText, textHeight, layer, color));
      }
      break;
    }

    case 'polyline': {
      if (pts.length >= 2) {
        entities.push(dxfLwPolyline(pts, false, layer, color));
        const mx = (pts[0][0] + pts[pts.length - 1][0]) / 2;
        const my = (pts[0][1] + pts[pts.length - 1][1]) / 2;
        entities.push(dxfText(mx, my, labelText, textHeight, layer, color));
      }
      break;
    }

    case 'circle': {
      if (pts.length >= 2) {
        const cx = (pts[0][0] + pts[1][0]) / 2;
        const cy = (pts[0][1] + pts[1][1]) / 2;
        const dx = pts[1][0] - pts[0][0];
        const dy = pts[1][1] - pts[0][1];
        const r = Math.sqrt(dx * dx + dy * dy) / 2;
        entities.push(dxfCircle(cx, cy, r, layer, color));
        entities.push(dxfText(cx, cy, labelText, textHeight, layer, color));
      }
      break;
    }

    case 'angle': {
      if (pts.length >= 3) {
        entities.push(dxfLine(pts[0][0], pts[0][1], pts[1][0], pts[1][1], layer, color));
        entities.push(dxfLine(pts[1][0], pts[1][1], pts[2][0], pts[2][1], layer, color));
        entities.push(dxfText(pts[1][0], pts[1][1], labelText, textHeight, layer, color));
      }
      break;
    }

    case 'dimension': {
      if (m.points.length >= 3) {
        const geom = computeDimensionGeometry(m.points[0], m.points[1], m.points[2]);
        // Transform all geometry points to DXF coordinates
        const ct = (p: { x: number; y: number }) => coordTransform(p.x, p.y, maxY, scale);
        const [ds0, ds1] = ct(geom.dimLineStart);
        const [de0, de1] = ct(geom.dimLineEnd);
        const [e1s0, e1s1] = ct(geom.ext1Start);
        const [e1e0, e1e1] = ct(geom.ext1End);
        const [e2s0, e2s1] = ct(geom.ext2Start);
        const [e2e0, e2e1] = ct(geom.ext2End);
        const [tp0, tp1] = ct(geom.textPosition);
        // Extension lines
        entities.push(dxfLine(e1s0, e1s1, e1e0, e1e1, layer, color));
        entities.push(dxfLine(e2s0, e2s1, e2e0, e2e1, layer, color));
        // Dimension line
        entities.push(dxfLine(ds0, ds1, de0, de1, layer, color));
        // Tick marks
        const [t1s0, t1s1] = ct(geom.tick1Start);
        const [t1e0, t1e1] = ct(geom.tick1End);
        const [t2s0, t2s1] = ct(geom.tick2Start);
        const [t2e0, t2e1] = ct(geom.tick2End);
        entities.push(dxfLine(t1s0, t1s1, t1e0, t1e1, layer, color));
        entities.push(dxfLine(t2s0, t2s1, t2e0, t2e1, layer, color));
        // Label
        entities.push(dxfText(tp0, tp1, labelText, textHeight, layer, color));
      }
      break;
    }

    case 'count': {
      for (const pt of pts) {
        entities.push(dxfPoint(pt[0], pt[1], layer, color));
      }
      if (pts.length > 0) {
        entities.push(dxfText(pts[0][0], pts[0][1], labelText, textHeight, layer, color));
      }
      break;
    }

    case 'symbol': {
      if (pts.length >= 1 && m.symbolBlockId) {
        // Look up block from the _symbolBlocksCache (set by generateDxf)
        const block = _symbolBlocksCache.find((b) => b.id === m.symbolBlockId);
        if (block) {
          const userScale = m.symbolScale ?? 1;
          // Symbol dimensions in DXF units (real-world * scale)
          const wDxf = block.widthReal * userScale * scale;
          const hDxf = block.heightReal * userScale * scale;
          const cx = pts[0][0];
          const cy = pts[0][1];
          const rotation = (m.symbolRotation ?? 0) * Math.PI / 180;
          const cos = Math.cos(rotation);
          const sin = Math.sin(rotation);

          const transformPt = (nx: number, ny: number): [number, number] => {
            let lx = (nx - 0.5) * wDxf;
            let ly = (ny - 0.5) * hDxf;
            if (rotation !== 0) {
              const rx = lx * cos - ly * sin;
              const ry = lx * sin + ly * cos;
              lx = rx;
              ly = ry;
            }
            return [cx + lx, cy + ly];
          };

          for (const path of block.paths) {
            if (path.type === 'line') {
              const [x1, y1, x2, y2] = path.data;
              const [px1, py1] = transformPt(x1, y1);
              const [px2, py2] = transformPt(x2, y2);
              entities.push(dxfLine(px1, py1, px2, py2, layer, color));
            } else if (path.type === 'rect') {
              const [x, y, w, h] = path.data;
              const corners: [number, number][] = [
                transformPt(x, y), transformPt(x + w, y),
                transformPt(x + w, y + h), transformPt(x, y + h),
              ];
              for (let i = 0; i < 4; i++) {
                const a = corners[i];
                const b = corners[(i + 1) % 4];
                entities.push(dxfLine(a[0], a[1], b[0], b[1], layer, color));
              }
            }
            // Arcs: export as polyline approximation
            else if (path.type === 'arc') {
              const [acx, acy, r, startDeg, endDeg] = path.data;
              const steps = Math.max(8, Math.round(Math.abs(endDeg - startDeg) / 10));
              const sRad = startDeg * Math.PI / 180;
              const eRad = endDeg * Math.PI / 180;
              for (let i = 0; i < steps; i++) {
                const t1 = sRad + (eRad - sRad) * (i / steps);
                const t2 = sRad + (eRad - sRad) * ((i + 1) / steps);
                const [px1, py1] = transformPt(acx + r * Math.cos(t1), acy + r * Math.sin(t1));
                const [px2, py2] = transformPt(acx + r * Math.cos(t2), acy + r * Math.sin(t2));
                entities.push(dxfLine(px1, py1, px2, py2, layer, color));
              }
            }
          }
          entities.push(dxfText(cx, cy, m.label, textHeight, layer, color));
        }
      }
      break;
    }
  }

  return entities;
}

/* ── Public API ───────────────────────────────────── */

/**
 * Generate a complete DXF R12 string from measurements.
 *
 * If a calibration is supplied the pixel coordinates are scaled to
 * real-world units (scaleFactor = realDistance / pixelDistance).
 * The Y axis is flipped so the output matches standard CAD orientation.
 */
export function generateDxf(
  measurements: Measurement[],
  calibration: Calibration | null,
  symbolBlocks?: SymbolBlockDef[],
): string {
  _symbolBlocksCache = symbolBlocks ?? [];
  // Determine unit (from calibration, or fall back to first measurement)
  const unit = calibration?.unit ?? measurements[0]?.unit ?? 'm';

  // Scale factor: calibration.scaleFactor is already "real-world units per pixel"
  const scale = calibration ? calibration.scaleFactor : 1;

  // Find max Y across all measurement points (for Y-flip)
  let maxY = 0;
  for (const m of measurements) {
    for (const p of m.points) {
      if (p.y > maxY) maxY = p.y;
    }
  }

  // Collect unique layer names
  const layerNames = [...new Set(measurements.map((m) => m.type.toUpperCase()))];
  if (layerNames.length === 0) {
    layerNames.push('0'); // default layer
  }

  // Build entities
  const entityStrings: string[] = [];
  for (const m of measurements) {
    entityStrings.push(...measurementEntities(m, maxY, scale));
  }

  // Assemble full DXF
  const parts: string[] = [];

  // HEADER
  parts.push(dxfHeader(unit));

  // TABLES (layer definitions)
  parts.push(dxfTables(layerNames));

  // ENTITIES section
  parts.push('0\nSECTION');
  parts.push('2\nENTITIES');
  for (const e of entityStrings) {
    parts.push(e);
  }
  parts.push('0\nENDSEC');

  // EOF
  parts.push('0\nEOF');

  return parts.join('\n');
}

/**
 * Generate DXF and trigger a browser download.
 */
export function downloadDxf(
  measurements: Measurement[],
  calibration: Calibration | null,
  filename?: string,
  symbolBlocks?: SymbolBlockDef[],
): void {
  const dxf = generateDxf(measurements, calibration, symbolBlocks);
  const blob = new Blob([dxf], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `mesures-${new Date().toISOString().slice(0, 10)}.dxf`;
  a.click();
  URL.revokeObjectURL(url);
}
