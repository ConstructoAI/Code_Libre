/**
 * Pure functions for rendering measurements as Fabric.js objects
 * and hit-testing measurements on the canvas.
 *
 * Extracted from MeasurementCanvas.tsx to reduce its size
 * and make these functions independently testable.
 */

import { Line, Polygon, Circle, FabricText } from 'fabric';
import {
  createArrowObjects,
  createCloudObjects,
  createCalloutObjects,
  createFreehandObjects,
  createHighlightObjects,
  createTextAnnotationObjects,
} from './annotationShapes';
import { computeDimensionGeometry } from './geometry';
import { computeSegments, hasSegmentDimensions, isClosedShape, formatMeasurement } from './format';
import type { Calibration, Measurement, Point, AIDetection } from '../types';
import { useMetreStore } from '../store';

/**
 * Scale a page-coordinate point to screen pixels for rendering on the Fabric canvas.
 */
function toScreen(p: Point, zoom: number): Point {
  return { x: p.x * zoom, y: p.y * zoom };
}

/**
 * Optional rendering hints. When `isSelected` is true and the measurement is
 * a polyline / area / perimeter, per-segment length labels are drawn at each
 * edge midpoint to give the user a quick visual readout while the measurement
 * is selected. `calibration` is consulted to render real-world units when
 * available; otherwise pixel lengths are shown.
 */
export interface RenderOptions {
  isSelected?: boolean;
  calibration?: Calibration | null;
}

/**
 * Create Fabric.js objects for a measurement.
 */
export function createMeasurementObjects(
  m: Measurement,
  color: string,
  strokeWidth: number,
  opacity: number,
  zoom: number,
  options?: RenderOptions
): any[] {
  const objects: any[] = [];
  const isDeduction = m.isDeduction === true;
  // Deductions: dashed stroke, lower opacity, prefix "- " on labels
  const dashArray = isDeduction ? [8, 4] : undefined;
  const effectiveOpacity = isDeduction ? Math.min(opacity, 0.6) : opacity;
  const labelPrefix = isDeduction ? '\u2212 ' : '';
  const labelColor = isDeduction ? '#ff6b6b' : '#ffffff';

  const isSelected = options?.isSelected === true;
  const calibration = options?.calibration ?? null;

  switch (m.type) {
    case 'distance': {
      if (m.points.length < 2) break;
      const a = toScreen(m.points[0], zoom);
      const b = toScreen(m.points[1], zoom);

      const line = new Line([a.x, a.y, b.x, b.y], {
        stroke: color,
        strokeWidth,
        opacity: effectiveOpacity,
        ...(dashArray ? { strokeDashArray: dashArray } : {}),
      });
      objects.push(line);

      [a, b].forEach((pt) => {
        const dot = new Circle({
          left: pt.x - 3,
          top: pt.y - 3,
          radius: 3,
          fill: color,
          opacity: effectiveOpacity,
        });
        objects.push(dot);
      });

      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const rawDistLabel = m.label || formatMeasurement(m.value ?? 0, m.unit, 'distance');
      const distLabel = isDeduction ? `${labelPrefix}${rawDistLabel}` : rawDistLabel;
      const text = new FabricText(distLabel, {
        left: midX,
        top: midY - 14,
        fontSize: 11,
        fill: labelColor,
        backgroundColor: 'rgba(0,0,0,0.6)',
        fontFamily: 'monospace',
        padding: 2,
        opacity: effectiveOpacity,
      });
      objects.push(text);
      break;
    }

    case 'area':
    case 'perimeter': {
      if (m.points.length < 3) break;

      const polyPoints = m.points.map((p) => toScreen(p, zoom));
      const polygon = new Polygon(polyPoints, {
        stroke: color,
        strokeWidth,
        fill: m.type === 'area' ? `${color}20` : 'transparent',
        opacity: effectiveOpacity,
        ...(dashArray ? { strokeDashArray: dashArray } : {}),
      });
      objects.push(polygon);

      polyPoints.forEach((pt) => {
        const dot = new Circle({
          left: pt.x - 3,
          top: pt.y - 3,
          radius: 3,
          fill: color,
          opacity: effectiveOpacity,
        });
        objects.push(dot);
      });

      const cx = polyPoints.reduce((sum, p) => sum + p.x, 0) / polyPoints.length;
      const cy = polyPoints.reduce((sum, p) => sum + p.y, 0) / polyPoints.length;
      const rawAreaLabel = m.label || formatMeasurement(m.value ?? 0, m.unit, m.type);
      const areaLabel = isDeduction ? `${labelPrefix}${rawAreaLabel}` : rawAreaLabel;
      const text = new FabricText(areaLabel, {
        left: cx,
        top: cy - 8,
        fontSize: 11,
        fill: labelColor,
        backgroundColor: 'rgba(0,0,0,0.6)',
        fontFamily: 'monospace',
        padding: 2,
        originX: 'center',
        opacity: effectiveOpacity,
      });
      objects.push(text);
      break;
    }

    case 'angle': {
      if (m.points.length < 3) break;
      const p1 = toScreen(m.points[0], zoom);
      const vertex = toScreen(m.points[1], zoom);
      const p3 = toScreen(m.points[2], zoom);

      const line1 = new Line([vertex.x, vertex.y, p1.x, p1.y], {
        stroke: color,
        strokeWidth,
        opacity: effectiveOpacity,
        ...(dashArray ? { strokeDashArray: dashArray } : {}),
      });
      const line2 = new Line([vertex.x, vertex.y, p3.x, p3.y], {
        stroke: color,
        strokeWidth,
        opacity: effectiveOpacity,
        ...(dashArray ? { strokeDashArray: dashArray } : {}),
      });
      objects.push(line1, line2);

      const dot = new Circle({
        left: vertex.x - 4,
        top: vertex.y - 4,
        radius: 4,
        fill: color,
        opacity: effectiveOpacity,
      });
      objects.push(dot);

      const rawAngleLabel = m.label || `${(m.value ?? 0).toFixed(1)}\u00b0`;
      const angleLabel = isDeduction ? `${labelPrefix}${rawAngleLabel}` : rawAngleLabel;
      const text = new FabricText(angleLabel, {
        left: vertex.x + 10,
        top: vertex.y - 14,
        fontSize: 11,
        fill: labelColor,
        backgroundColor: 'rgba(0,0,0,0.6)',
        fontFamily: 'monospace',
        padding: 2,
        opacity: effectiveOpacity,
      });
      objects.push(text);
      break;
    }

    case 'polyline': {
      if (m.points.length < 2) break;
      const pts = m.points.map((p) => toScreen(p, zoom));
      // Draw each segment (no closing line)
      for (let i = 0; i < pts.length - 1; i++) {
        const seg = new Line([pts[i].x, pts[i].y, pts[i+1].x, pts[i+1].y], {
          stroke: color, strokeWidth, opacity: effectiveOpacity,
          ...(dashArray ? { strokeDashArray: dashArray } : {}),
        });
        objects.push(seg);
      }
      // Dots at each point
      pts.forEach((pt) => {
        const dot = new Circle({
          left: pt.x - 3, top: pt.y - 3, radius: 3,
          fill: color, opacity: effectiveOpacity,
        });
        objects.push(dot);
      });
      // Label at midpoint between first and last point
      const mx = (pts[0].x + pts[pts.length-1].x) / 2;
      const my = (pts[0].y + pts[pts.length-1].y) / 2;
      const rawPolyLabel = m.label || formatMeasurement(m.value ?? 0, m.unit, m.type);
      const polyLabel = isDeduction ? `${labelPrefix}${rawPolyLabel}` : rawPolyLabel;
      const polyText = new FabricText(polyLabel, {
        left: mx, top: my - 14, fontSize: 11,
        fill: labelColor, backgroundColor: 'rgba(0,0,0,0.6)',
        fontFamily: 'monospace', padding: 2, opacity: effectiveOpacity,
      });
      objects.push(polyText);
      break;
    }

    case 'circle': {
      if (m.points.length < 2) break;
      const center = toScreen(m.points[0], zoom);
      const edge = toScreen(m.points[1], zoom);
      const radiusDisplay = Math.sqrt((edge.x - center.x) ** 2 + (edge.y - center.y) ** 2);

      const circle = new Circle({
        left: center.x - radiusDisplay,
        top: center.y - radiusDisplay,
        radius: radiusDisplay,
        fill: `${color}20`,
        stroke: color,
        strokeWidth,
        opacity: effectiveOpacity,
        ...(dashArray ? { strokeDashArray: dashArray } : {}),
      });
      objects.push(circle);

      // Center dot
      const centerDot = new Circle({
        left: center.x - 3,
        top: center.y - 3,
        radius: 3,
        fill: color,
        opacity: effectiveOpacity,
      });
      objects.push(centerDot);

      // Label (circle = area, treated as 'area' for unit suffix)
      const rawCircleLabel = m.label || formatMeasurement(m.value ?? 0, m.unit, 'area');
      const circleLabel = isDeduction ? `${labelPrefix}${rawCircleLabel}` : rawCircleLabel;
      const circleText = new FabricText(circleLabel, {
        left: center.x,
        top: center.y - 8,
        fontSize: 11,
        fill: labelColor,
        backgroundColor: 'rgba(0,0,0,0.6)',
        fontFamily: 'monospace',
        padding: 2,
        originX: 'center',
        opacity: effectiveOpacity,
      });
      objects.push(circleText);
      break;
    }

    case 'count': {
      if (m.points.length < 1) break;

      // Render each counted point with its sequential number
      m.points.forEach((p, index) => {
        const pt = toScreen(p, zoom);

        const marker = new Circle({
          left: pt.x - 8,
          top: pt.y - 8,
          radius: 8,
          fill: color,
          opacity: effectiveOpacity,
        });
        objects.push(marker);

        const numText = new FabricText(`${index + 1}`, {
          left: pt.x,
          top: pt.y,
          fontSize: 10,
          fill: labelColor,
          fontFamily: 'sans-serif',
          fontWeight: 'bold',
          originX: 'center',
          originY: 'center',
          opacity: effectiveOpacity,
        });
        objects.push(numText);
      });

      // Total label near the first point
      const firstPt = toScreen(m.points[0], zoom);
      const rawTotalLabel = m.label || `\u00d7${m.value}`;
      const totalLabel = isDeduction ? `${labelPrefix}${rawTotalLabel}` : rawTotalLabel;
      const totalText = new FabricText(totalLabel, {
        left: firstPt.x + 14,
        top: firstPt.y - 14,
        fontSize: 11,
        fill: labelColor,
        backgroundColor: 'rgba(0,0,0,0.6)',
        fontFamily: 'monospace',
        padding: 2,
        opacity: effectiveOpacity,
      });
      objects.push(totalText);
      break;
    }

    case 'dimension': {
      if (m.points.length < 3) break;
      const geom = computeDimensionGeometry(m.points[0], m.points[1], m.points[2]);
      const ds = toScreen(geom.dimLineStart, zoom);
      const de = toScreen(geom.dimLineEnd, zoom);
      const e1s = toScreen(geom.ext1Start, zoom);
      const e1e = toScreen(geom.ext1End, zoom);
      const e2s = toScreen(geom.ext2Start, zoom);
      const e2e = toScreen(geom.ext2End, zoom);
      const t1s = toScreen(geom.tick1Start, zoom);
      const t1e = toScreen(geom.tick1End, zoom);
      const t2s = toScreen(geom.tick2Start, zoom);
      const t2e = toScreen(geom.tick2End, zoom);
      const tp = toScreen(geom.textPosition, zoom);

      // Extension lines
      objects.push(
        new Line([e1s.x, e1s.y, e1e.x, e1e.y], {
          stroke: color, strokeWidth: 0.8, opacity: effectiveOpacity * 0.7,
          ...(dashArray ? { strokeDashArray: dashArray } : {}),
        }),
        new Line([e2s.x, e2s.y, e2e.x, e2e.y], {
          stroke: color, strokeWidth: 0.8, opacity: effectiveOpacity * 0.7,
          ...(dashArray ? { strokeDashArray: dashArray } : {}),
        }),
      );
      // Dimension line
      objects.push(
        new Line([ds.x, ds.y, de.x, de.y], {
          stroke: color, strokeWidth, opacity: effectiveOpacity,
          ...(dashArray ? { strokeDashArray: dashArray } : {}),
        }),
      );
      // Tick marks
      objects.push(
        new Line([t1s.x, t1s.y, t1e.x, t1e.y], {
          stroke: color, strokeWidth: 1.5, opacity: effectiveOpacity,
        }),
        new Line([t2s.x, t2s.y, t2e.x, t2e.y], {
          stroke: color, strokeWidth: 1.5, opacity: effectiveOpacity,
        }),
      );
      // Label (dimension annotation)
      const rawDimLabel = m.label || formatMeasurement(m.value ?? 0, m.unit, 'dimension');
      const dimLabel = isDeduction ? `${labelPrefix}${rawDimLabel}` : rawDimLabel;
      objects.push(
        new FabricText(dimLabel, {
          left: tp.x, top: tp.y - 8,
          fontSize: 11, fill: labelColor,
          backgroundColor: 'rgba(0,0,0,0.6)',
          fontFamily: 'monospace', padding: 2,
          originX: 'center',
          angle: geom.textAngle,
          opacity: effectiveOpacity,
        }),
      );
      break;
    }

    case 'arrow': {
      return createArrowObjects(m.points, zoom, color, strokeWidth, effectiveOpacity, m.label, m.fontSize);
    }

    case 'cloud': {
      return createCloudObjects(m.points, zoom, color, strokeWidth, effectiveOpacity, m.label, m.fontSize);
    }

    case 'freehand': {
      return createFreehandObjects(m.points, zoom, color, strokeWidth, effectiveOpacity);
    }

    case 'highlight': {
      return createHighlightObjects(m.points, zoom, color, strokeWidth, effectiveOpacity);
    }

    case 'text': {
      const textDisplay = m.textContent || m.label;
      return createTextAnnotationObjects(m.points, zoom, color, strokeWidth, effectiveOpacity, textDisplay, m.fontSize);
    }

    case 'note': {
      if (m.points.length < 1) break;
      const pt = toScreen(m.points[0], zoom);
      const fontSize = Math.max(8, (m.fontSize ?? 10) * Math.sqrt(zoom));
      const noteText = m.textContent || m.label || 'Note';
      const noteTitle = m.label || 'Note';
      const hasContent = !!(m.textContent && m.textContent.trim());

      // Measure approximate note box size based on content
      const lines = hasContent ? noteText.split('\n') : [noteTitle];
      const maxLineLen = Math.max(...lines.map((l) => l.length), 4);
      const boxW = Math.max(30, Math.min(200, maxLineLen * fontSize * 0.55 + 16));
      const boxH = Math.max(24, lines.length * (fontSize + 2) + 12);
      const halfW = boxW / 2;
      const halfH = boxH / 2;
      const foldSize = Math.min(8, boxW * 0.12);

      // Post-it body with folded corner
      const body = new Polygon(
        [
          { x: pt.x - halfW, y: pt.y - halfH },
          { x: pt.x + halfW - foldSize, y: pt.y - halfH },
          { x: pt.x + halfW, y: pt.y - halfH + foldSize },
          { x: pt.x + halfW, y: pt.y + halfH },
          { x: pt.x - halfW, y: pt.y + halfH },
        ],
        {
          fill: `${color}30`,
          stroke: color,
          strokeWidth: 1.5,
          opacity: effectiveOpacity,
        },
      );
      objects.push(body);

      // Folded corner triangle
      const fold = new Polygon(
        [
          { x: pt.x + halfW - foldSize, y: pt.y - halfH },
          { x: pt.x + halfW - foldSize, y: pt.y - halfH + foldSize },
          { x: pt.x + halfW, y: pt.y - halfH + foldSize },
        ],
        {
          fill: color,
          stroke: color,
          strokeWidth: 0.5,
          opacity: effectiveOpacity * 0.6,
        },
      );
      objects.push(fold);

      // Note text inside the box
      const displayText = hasContent ? noteText : noteTitle;
      const text = new FabricText(displayText, {
        left: pt.x,
        top: pt.y,
        fontSize,
        fill: labelColor,
        fontFamily: 'sans-serif',
        padding: 4,
        originX: 'center',
        originY: 'center',
        opacity: effectiveOpacity,
        textAlign: 'center',
      });
      objects.push(text);
      break;
    }

    case 'callout': {
      return createCalloutObjects(m.points, zoom, color, strokeWidth, effectiveOpacity, m.textContent || m.label, m.fontSize);
    }

    case 'symbol': {
      return createSymbolObjects(m, zoom, color, strokeWidth, effectiveOpacity);
    }
  }

  // Per-segment dimension labels for the selected measurement of multi-edge
  // types. Drawn last so they sit on top of the polygon outline. The label
  // rotates with the edge so oblique segments stay readable, and we offset
  // it perpendicularly so it doesn't sit directly on the line.
  if (isSelected && hasSegmentDimensions(m.type) && m.points.length >= 2) {
    const segments = computeSegments(m.points, isClosedShape(m.type), calibration, m.unit);
    for (const seg of segments) {
      const a = toScreen(seg.startPoint, zoom);
      const b = toScreen(seg.endPoint, zoom);
      const mid = toScreen(seg.midPoint, zoom);

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      // Skip degenerate segments (zero-length) AND non-finite ones (NaN /
      // Infinity from corrupt point data) — `NaN < 1` evaluates to false,
      // so we need an explicit Number.isFinite guard.
      if (!Number.isFinite(segLen) || segLen < 1) continue;

      const perpX = -dy / segLen;
      const perpY = dx / segLen;
      const labelX = mid.x + perpX * 12;
      const labelY = mid.y + perpY * 12;

      let textAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (textAngle > 90) textAngle -= 180;
      if (textAngle < -90) textAngle += 180;

      const segText = new FabricText(seg.formatted, {
        left: labelX,
        top: labelY,
        fontSize: 11,
        fill: labelColor,
        backgroundColor: 'rgba(0,0,0,0.6)',
        fontFamily: 'monospace',
        padding: 2,
        originX: 'center',
        originY: 'center',
        angle: textAngle,
        opacity: effectiveOpacity,
        selectable: false,
        evented: false,
      });
      objects.push(segText);
    }
  }

  return objects;
}


/**
 * Render an architectural symbol block as Fabric.js objects.
 * The symbol is drawn relative to its center point (m.points[0]) using the block's
 * normalized path data, scaled to real-world size via calibration.
 */
function createSymbolObjects(
  m: Measurement,
  zoom: number,
  color: string,
  strokeWidth: number,
  opacity: number,
): any[] {
  if (m.points.length < 1 || !m.symbolBlockId) return [];

  const store = useMetreStore.getState();
  const block = store.symbolBlocks.find((b) => b.id === m.symbolBlockId);
  if (!block) return [];

  const cal = store.calibration;
  const scaleFactor = cal?.scaleFactor ?? 1;

  // Convert meters to calibration unit, then to pixels
  const metersToCalUnit: Record<string, number> = {
    m: 1, cm: 100, mm: 1000, ft: 3.28084, in: 39.3701,
  };
  const unitFactor = metersToCalUnit[cal?.unit ?? 'ft'] ?? 1;

  const userScale = m.symbolScale ?? 1;
  const wPx = (block.widthReal * unitFactor / scaleFactor) * userScale;
  const hPx = (block.heightReal * unitFactor / scaleFactor) * userScale;

  const center = toScreen(m.points[0], zoom);
  const rotation = (m.symbolRotation ?? 0) * Math.PI / 180;

  const objects: any[] = [];

  // Transform a normalized (0-1) coordinate to screen pixel
  const transform = (nx: number, ny: number): { x: number; y: number } => {
    // Offset from center (symbol origin is top-left, shift to center)
    let lx = (nx - 0.5) * wPx * zoom;
    let ly = (ny - 0.5) * hPx * zoom;
    // Apply rotation
    if (rotation !== 0) {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const rx = lx * cos - ly * sin;
      const ry = lx * sin + ly * cos;
      lx = rx;
      ly = ry;
    }
    return { x: center.x + lx, y: center.y + ly };
  };

  for (const path of block.paths) {
    if (path.type === 'line') {
      const [x1, y1, x2, y2] = path.data;
      const p1 = transform(x1, y1);
      const p2 = transform(x2, y2);
      objects.push(new Line([p1.x, p1.y, p2.x, p2.y], {
        stroke: color,
        strokeWidth: Math.max(1, strokeWidth * zoom * 0.5),
        opacity,
        selectable: false,
        evented: false,
      }));
    } else if (path.type === 'rect') {
      const [x, y, w, h] = path.data;
      const tl = transform(x, y);
      const tr = transform(x + w, y);
      const br = transform(x + w, y + h);
      const bl = transform(x, y + h);
      // Draw as 4 lines (rotation-aware)
      const corners = [tl, tr, br, bl];
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        objects.push(new Line([a.x, a.y, b.x, b.y], {
          stroke: color,
          strokeWidth: Math.max(1, strokeWidth * zoom * 0.5),
          opacity,
          selectable: false,
          evented: false,
        }));
      }
    } else if (path.type === 'arc') {
      const [cx, cy, r, startDeg, endDeg] = path.data;
      // Approximate arc with line segments
      const fullCircle = Math.abs(endDeg - startDeg) >= 360;
      const steps = fullCircle ? 36 : Math.max(8, Math.round(Math.abs(endDeg - startDeg) / 10));
      const startRad = startDeg * Math.PI / 180;
      const endRad = endDeg * Math.PI / 180;
      for (let i = 0; i < steps; i++) {
        const t1 = startRad + (endRad - startRad) * (i / steps);
        const t2 = startRad + (endRad - startRad) * ((i + 1) / steps);
        const p1 = transform(cx + r * Math.cos(t1), cy + r * Math.sin(t1));
        const p2 = transform(cx + r * Math.cos(t2), cy + r * Math.sin(t2));
        objects.push(new Line([p1.x, p1.y, p2.x, p2.y], {
          stroke: color,
          strokeWidth: Math.max(1, strokeWidth * zoom * 0.5),
          opacity,
          selectable: false,
          evented: false,
        }));
      }
    }
  }

  // Label below the symbol
  const labelY = center.y + (hPx * zoom * 0.5) + 12;
  objects.push(new FabricText(m.label, {
    left: center.x,
    top: labelY,
    fontSize: Math.max(9, 11 * zoom),
    fill: color,
    opacity: Math.min(opacity, 0.8),
    fontFamily: 'sans-serif',
    originX: 'center',
    originY: 'top',
    selectable: false,
    evented: false,
  }));

  return objects;
}

/**
 * Get the bounding box of a symbol measurement in page coordinates.
 */
function getSymbolBBox(m: Measurement): { x: number; y: number; w: number; h: number } | null {
  if (m.points.length < 1 || !m.symbolBlockId) return null;
  const store = useMetreStore.getState();
  const block = store.symbolBlocks.find((b) => b.id === m.symbolBlockId);
  if (!block) return null;

  const cal = store.calibration;
  const scaleFactor = cal?.scaleFactor ?? 1;
  const metersToCalUnit: Record<string, number> = {
    m: 1, cm: 100, mm: 1000, ft: 3.28084, in: 39.3701,
  };
  const unitFactor = metersToCalUnit[cal?.unit ?? 'ft'] ?? 1;
  const userScale = m.symbolScale ?? 1;
  const wPx = (block.widthReal * unitFactor / scaleFactor) * userScale;
  const hPx = (block.heightReal * unitFactor / scaleFactor) * userScale;

  // Use axis-aligned bounding box (conservative for rotated symbols)
  const rotation = (m.symbolRotation ?? 0) * Math.PI / 180;
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  const bboxW = wPx * cos + hPx * sin;
  const bboxH = wPx * sin + hPx * cos;

  return {
    x: m.points[0].x - bboxW / 2,
    y: m.points[0].y - bboxH / 2,
    w: bboxW,
    h: bboxH,
  };
}

/**
 * Compute the minimum distance from point P to the line segment AB.
 */
export function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // Segment is a single point
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  }
  // Parameter t of the projection of P onto AB, clamped to [0,1]
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}


/**
 * Ray-casting algorithm to check if a point is inside a polygon.
 */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}


/**
 * Find the nearest measurement to a given point (hit-testing).
 * Returns the measurement ID or null if nothing is within tolerance.
 */
export function findMeasurementAtPoint(
  pt: Point,
  pageMeasurements: Measurement[],
  hitTolerance: number = 10,
): string | null {
  let bestId: string | null = null;
  let bestDist = hitTolerance;

  for (const m of pageMeasurements) {
    let dist = Infinity;

    switch (m.type) {
      case 'distance': {
        if (m.points.length >= 2) {
          dist = pointToSegmentDist(pt, m.points[0], m.points[1]);
        }
        break;
      }
      case 'area':
      case 'perimeter': {
        if (m.points.length >= 3) {
          for (let i = 0; i < m.points.length; i++) {
            const j = (i + 1) % m.points.length;
            const d = pointToSegmentDist(pt, m.points[i], m.points[j]);
            if (d < dist) dist = d;
          }
          if (m.type === 'area' && pointInPolygon(pt, m.points)) {
            dist = 0;
          }
        }
        break;
      }
      case 'polyline': {
        if (m.points.length >= 2) {
          for (let i = 0; i < m.points.length - 1; i++) {
            const d = pointToSegmentDist(pt, m.points[i], m.points[i + 1]);
            if (d < dist) dist = d;
          }
        }
        break;
      }
      case 'angle': {
        if (m.points.length >= 3) {
          const d1 = pointToSegmentDist(pt, m.points[1], m.points[0]);
          const d2 = pointToSegmentDist(pt, m.points[1], m.points[2]);
          dist = Math.min(d1, d2);
        }
        break;
      }
      case 'circle': {
        if (m.points.length >= 2) {
          const center = m.points[0];
          const radiusPx = Math.sqrt((m.points[1].x - center.x) ** 2 + (m.points[1].y - center.y) ** 2);
          const distToCenter = Math.sqrt((pt.x - center.x) ** 2 + (pt.y - center.y) ** 2);
          dist = Math.abs(distToCenter - radiusPx);
          if (distToCenter < radiusPx) dist = 0;
        }
        break;
      }
      case 'count': {
        // Check distance to any counted point
        for (const p of m.points) {
          const d = Math.sqrt((pt.x - p.x) ** 2 + (pt.y - p.y) ** 2);
          if (d < dist) dist = d;
        }
        break;
      }
      case 'text':
      case 'note': {
        if (m.points.length >= 1) {
          dist = Math.sqrt((pt.x - m.points[0].x) ** 2 + (pt.y - m.points[0].y) ** 2);
        }
        break;
      }
      case 'dimension': {
        if (m.points.length >= 3) {
          const geom = computeDimensionGeometry(m.points[0], m.points[1], m.points[2]);
          const d1 = pointToSegmentDist(pt, geom.dimLineStart, geom.dimLineEnd);
          const d2 = pointToSegmentDist(pt, geom.ext1Start, geom.ext1End);
          const d3 = pointToSegmentDist(pt, geom.ext2Start, geom.ext2End);
          dist = Math.min(d1, d2, d3);
        }
        break;
      }
      case 'arrow':
      case 'callout': {
        if (m.points.length >= 2) {
          dist = pointToSegmentDist(pt, m.points[0], m.points[1]);
        }
        break;
      }
      case 'cloud': {
        if (m.points.length >= 3) {
          for (let i = 0; i < m.points.length; i++) {
            const j = (i + 1) % m.points.length;
            const d = pointToSegmentDist(pt, m.points[i], m.points[j]);
            if (d < dist) dist = d;
          }
          if (pointInPolygon(pt, m.points)) {
            dist = 0;
          }
        }
        break;
      }
      case 'freehand': {
        if (m.points.length >= 2) {
          for (let i = 0; i < m.points.length - 1; i++) {
            const d = pointToSegmentDist(pt, m.points[i], m.points[i + 1]);
            if (d < dist) dist = d;
          }
        }
        break;
      }
      case 'highlight': {
        if (m.points.length >= 3) {
          if (pointInPolygon(pt, m.points)) {
            dist = 0;
          } else {
            for (let i = 0; i < m.points.length; i++) {
              const j = (i + 1) % m.points.length;
              const d = pointToSegmentDist(pt, m.points[i], m.points[j]);
              if (d < dist) dist = d;
            }
          }
        }
        break;
      }
      case 'symbol': {
        const bbox = getSymbolBBox(m);
        if (bbox) {
          if (pt.x >= bbox.x && pt.x <= bbox.x + bbox.w &&
              pt.y >= bbox.y && pt.y <= bbox.y + bbox.h) {
            dist = 0;
          } else {
            // Distance to bbox edges
            const cx = Math.max(bbox.x, Math.min(pt.x, bbox.x + bbox.w));
            const cy = Math.max(bbox.y, Math.min(pt.y, bbox.y + bbox.h));
            dist = Math.sqrt((pt.x - cx) ** 2 + (pt.y - cy) ** 2);
          }
        }
        break;
      }
    }

    if (dist < bestDist) {
      bestDist = dist;
      bestId = m.id;
    }
  }

  return bestId;
}


/**
 * Render an AI detection (status='pending') as a semi-transparent dashed
 * Fabric.js overlay with a confidence label. Accepted detections are not
 * rendered here because they are converted to regular Measurements upstream
 * by `createMeasurementObjects`. Rejected/corrected detections are filtered
 * out at source.
 */
export function createAIDetectionObjects(d: AIDetection, zoom: number): any[] {
  if (d.status !== 'pending' || !d.points || d.points.length === 0) return [];

  const objects: any[] = [];
  const color = d.color || '#9CA3AF';
  const fillAlpha = '40';      // hex alpha ~25% for surface fill
  const markerAlpha = '60';    // hex alpha ~38% for count markers
  const dashArray = [6, 4];    // dashed stroke to distinguish from manual measurements
  const safeConf = Number.isFinite(d.confidence) ? d.confidence : 0;
  const labelText = `${d.label ?? ''} ${Math.round(safeConf * 100)}%`.trim();

  switch (d.detectionType) {
    case 'surface': {
      if (d.points.length < 3) break;
      const polyPoints = d.points.map((p) => toScreen(p, zoom));
      const polygon = new Polygon(polyPoints, {
        stroke: color,
        strokeWidth: 2,
        strokeDashArray: dashArray,
        fill: `${color}${fillAlpha}`,
        opacity: 0.85,
        selectable: false,
        evented: false,
      });
      objects.push(polygon);

      const cx = polyPoints.reduce((s, p) => s + p.x, 0) / polyPoints.length;
      const cy = polyPoints.reduce((s, p) => s + p.y, 0) / polyPoints.length;
      objects.push(new FabricText(labelText, {
        left: cx,
        top: cy - 8,
        fontSize: 11,
        fill: color,
        backgroundColor: 'rgba(0,0,0,0.55)',
        fontFamily: 'monospace',
        padding: 2,
        originX: 'center',
        opacity: 0.95,
        selectable: false,
        evented: false,
      }));
      break;
    }

    case 'distance': {
      if (d.points.length < 2) break;
      const pts = d.points.map((p) => toScreen(p, zoom));
      // Render as a polyline (handles >=2 points).
      for (let i = 0; i < pts.length - 1; i++) {
        objects.push(new Line(
          [pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y],
          {
            stroke: color,
            strokeWidth: 2,
            strokeDashArray: dashArray,
            opacity: 0.85,
            selectable: false,
            evented: false,
          },
        ));
      }
      const mx = (pts[0].x + pts[pts.length - 1].x) / 2;
      const my = (pts[0].y + pts[pts.length - 1].y) / 2;
      objects.push(new FabricText(labelText, {
        left: mx,
        top: my - 14,
        fontSize: 11,
        fill: color,
        backgroundColor: 'rgba(0,0,0,0.55)',
        fontFamily: 'monospace',
        padding: 2,
        opacity: 0.95,
        selectable: false,
        evented: false,
      }));
      break;
    }

    case 'count': {
      // One small dashed circle per detected point.
      d.points.forEach((p) => {
        const pt = toScreen(p, zoom);
        const marker = new Circle({
          left: pt.x - 12,
          top: pt.y - 12,
          radius: 12,
          fill: `${color}${markerAlpha}`,
          stroke: color,
          strokeWidth: 2,
          strokeDashArray: dashArray,
          opacity: 0.85,
          selectable: false,
          evented: false,
        });
        objects.push(marker);
      });
      // Label above first point.
      const first = toScreen(d.points[0], zoom);
      objects.push(new FabricText(labelText, {
        left: first.x + 14,
        top: first.y - 16,
        fontSize: 11,
        fill: color,
        backgroundColor: 'rgba(0,0,0,0.55)',
        fontFamily: 'monospace',
        padding: 2,
        opacity: 0.95,
        selectable: false,
        evented: false,
      }));
      break;
    }
  }

  return objects;
}
