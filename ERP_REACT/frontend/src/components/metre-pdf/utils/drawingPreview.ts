/**
 * Pure functions for building the real-time drawing preview (rubber-band)
 * shown on the Fabric.js canvas while the user is placing points.
 *
 * Extracted from MeasurementCanvas.tsx to keep it lean.
 */

import { Line, Circle, Polygon, FabricText } from 'fabric';
import { snapToAngle, computeDimensionGeometry } from './geometry';
import { useMetreStore } from '../store';
import type { Point, Tool } from '../types';

/* ── Types ──────────────────────────────────────────────────── */

interface DrawingState {
  zoom: number;
  drawingPoints: Point[];
  mousePoint: Point;
  activeTool: Tool;
  orthoEnabled: boolean;
  canvasWidth: number;
  canvasHeight: number;
}

interface MeasureFns {
  pixelDistance: (a: Point, b: Point) => number;
  toRealWorld: (px: number) => number;
  polygonArea: (pts: Point[]) => number;
  polygonPerimeter: (pts: Point[]) => number;
  angleBetween: (p1: Point, vertex: Point, p2: Point) => number;
  calibrationUnit: string;
}

interface PreviewResult {
  objects: any[];
  liveValue: string | null;
}

/* ── Helpers ─────────────────────────────────────────────────── */

function toScreen(p: Point, zoom: number): Point {
  return { x: p.x * zoom, y: p.y * zoom };
}

function formatUnit(value: number, unit: string, suffix = ''): string {
  return `${(value ?? 0).toFixed(2)} ${unit}${suffix}`;
}

/* ── Orthogonal guide lines ─────────────────────────────────── */

function buildOrthoGuides(
  origin: Point,
  snapped: Point,
  zoom: number,
  w: number,
  h: number,
): any[] {
  const o = toScreen(origin, zoom);
  const s = toScreen(snapped, zoom);

  const guides: any[] = [];

  // Horizontal guide
  if (Math.abs(s.y - o.y) < 2) {
    guides.push(
      new Line([0, s.y, w, s.y], {
        stroke: '#00bfff',
        strokeWidth: 0.5,
        strokeDashArray: [4, 4],
        opacity: 0.5,
      }),
    );
  }

  // Vertical guide
  if (Math.abs(s.x - o.x) < 2) {
    guides.push(
      new Line([s.x, 0, s.x, h], {
        stroke: '#00bfff',
        strokeWidth: 0.5,
        strokeDashArray: [4, 4],
        opacity: 0.5,
      }),
    );
  }

  return guides;
}

/* ── Main builder ───────────────────────────────────────────── */

export function buildDrawingPreview(
  state: DrawingState,
  fns: MeasureFns,
): PreviewResult {
  const {
    zoom,
    drawingPoints: pts,
    mousePoint: mouse,
    activeTool,
    orthoEnabled,
    canvasWidth,
    canvasHeight,
  } = state;
  const { pixelDistance, toRealWorld, polygonArea, angleBetween, calibrationUnit } = fns;

  const objects: any[] = [];
  let liveValue: string | null = null;

  if (pts.length === 0) return { objects, liveValue };

  // Apply ortho snapping if enabled
  const lastPt = pts[pts.length - 1];
  const mp = orthoEnabled ? snapToAngle(lastPt, mouse) : mouse;

  const PREVIEW_COLOR = '#00bfff';
  const PREVIEW_STROKE = 1.5;
  const PREVIEW_OPACITY = 0.8;

  switch (activeTool) {
    /* ── Distance / Calibrate ─────────────────────────────── */
    case 'distance':
    case 'calibrate': {
      if (pts.length < 1) break;
      const a = toScreen(pts[0], zoom);
      const b = toScreen(mp, zoom);

      objects.push(
        new Line([a.x, a.y, b.x, b.y], {
          stroke: PREVIEW_COLOR,
          strokeWidth: PREVIEW_STROKE,
          strokeDashArray: [6, 3],
          opacity: PREVIEW_OPACITY,
        }),
      );

      // End-point dots
      [a, b].forEach((pt) => {
        objects.push(
          new Circle({
            left: pt.x - 3,
            top: pt.y - 3,
            radius: 3,
            fill: PREVIEW_COLOR,
            opacity: PREVIEW_OPACITY,
          }),
        );
      });

      // Live distance label
      const dist = toRealWorld(pixelDistance(pts[0], mp));
      liveValue = formatUnit(dist, calibrationUnit);

      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      objects.push(
        new FabricText(liveValue, {
          left: midX,
          top: midY - 16,
          fontSize: 11,
          fill: '#ffffff',
          backgroundColor: 'rgba(0,0,0,0.7)',
          fontFamily: 'monospace',
          padding: 2,
        }),
      );

      if (orthoEnabled) {
        objects.push(...buildOrthoGuides(pts[0], mp, zoom, canvasWidth, canvasHeight));
      }
      break;
    }

    /* ── Area / Rectangle ─────────────────────────────────── */
    case 'area':
    case 'rectangle': {
      const allPts = [...pts, mp];

      if (activeTool === 'rectangle' && pts.length === 1) {
        // Rectangle: 2 corners → 4-point polygon
        const p0 = pts[0];
        const rectPts = [
          p0,
          { x: mp.x, y: p0.y },
          mp,
          { x: p0.x, y: mp.y },
        ];
        const screenPts = rectPts.map((p) => toScreen(p, zoom));
        objects.push(
          new Polygon(screenPts, {
            stroke: PREVIEW_COLOR,
            strokeWidth: PREVIEW_STROKE,
            strokeDashArray: [6, 3],
            fill: `${PREVIEW_COLOR}15`,
            opacity: PREVIEW_OPACITY,
          }),
        );
        const area = toRealWorld(1) ** 2 * polygonArea(rectPts);
        liveValue = formatUnit(area, calibrationUnit, '\u00b2');
      } else if (allPts.length >= 3) {
        const screenPts = allPts.map((p) => toScreen(p, zoom));
        objects.push(
          new Polygon(screenPts, {
            stroke: PREVIEW_COLOR,
            strokeWidth: PREVIEW_STROKE,
            strokeDashArray: [6, 3],
            fill: `${PREVIEW_COLOR}15`,
            opacity: PREVIEW_OPACITY,
          }),
        );
        const area = toRealWorld(1) ** 2 * polygonArea(allPts);
        liveValue = formatUnit(area, calibrationUnit, '\u00b2');
      } else {
        // Only 1 point placed: show a dashed line from first point to mouse
        const a = toScreen(pts[0], zoom);
        const b = toScreen(mp, zoom);
        objects.push(
          new Line([a.x, a.y, b.x, b.y], {
            stroke: PREVIEW_COLOR,
            strokeWidth: PREVIEW_STROKE,
            strokeDashArray: [6, 3],
            opacity: PREVIEW_OPACITY,
          }),
        );
      }

      // Dots at each placed point
      pts.forEach((p) => {
        const sp = toScreen(p, zoom);
        objects.push(
          new Circle({
            left: sp.x - 3,
            top: sp.y - 3,
            radius: 3,
            fill: PREVIEW_COLOR,
            opacity: PREVIEW_OPACITY,
          }),
        );
      });

      if (orthoEnabled) {
        objects.push(...buildOrthoGuides(lastPt, mp, zoom, canvasWidth, canvasHeight));
      }
      break;
    }

    /* ── Perimeter / Polyline / Mur ──────────────────── */
    case 'perimeter':
    case 'polyline':
    case 'mur': {
      const allPts = [...pts, mp];

      // Draw segments
      for (let i = 0; i < allPts.length - 1; i++) {
        const a = toScreen(allPts[i], zoom);
        const b = toScreen(allPts[i + 1], zoom);
        objects.push(
          new Line([a.x, a.y, b.x, b.y], {
            stroke: PREVIEW_COLOR,
            strokeWidth: PREVIEW_STROKE,
            strokeDashArray: [6, 3],
            opacity: PREVIEW_OPACITY,
          }),
        );
      }

      // Closing line for perimeter
      if (activeTool === 'perimeter' && allPts.length >= 3) {
        const first = toScreen(allPts[0], zoom);
        const last = toScreen(allPts[allPts.length - 1], zoom);
        objects.push(
          new Line([last.x, last.y, first.x, first.y], {
            stroke: PREVIEW_COLOR,
            strokeWidth: PREVIEW_STROKE,
            strokeDashArray: [3, 6],
            opacity: PREVIEW_OPACITY * 0.5,
          }),
        );
      }

      // Dots
      allPts.forEach((p) => {
        const sp = toScreen(p, zoom);
        objects.push(
          new Circle({
            left: sp.x - 3,
            top: sp.y - 3,
            radius: 3,
            fill: PREVIEW_COLOR,
            opacity: PREVIEW_OPACITY,
          }),
        );
      });

      // Live value
      let total = 0;
      for (let i = 0; i < allPts.length - 1; i++) {
        total += pixelDistance(allPts[i], allPts[i + 1]);
      }
      if (activeTool === 'perimeter' && allPts.length >= 3) {
        total += pixelDistance(allPts[allPts.length - 1], allPts[0]);
      }
      liveValue = formatUnit(toRealWorld(total), calibrationUnit);

      if (orthoEnabled) {
        objects.push(...buildOrthoGuides(lastPt, mp, zoom, canvasWidth, canvasHeight));
      }
      break;
    }

    /* ── Angle ────────────────────────────────────────────── */
    case 'angle': {
      if (pts.length >= 1) {
        // Line from first point (or vertex) to mouse
        const a = toScreen(pts[pts.length - 1], zoom);
        const b = toScreen(mp, zoom);
        objects.push(
          new Line([a.x, a.y, b.x, b.y], {
            stroke: PREVIEW_COLOR,
            strokeWidth: PREVIEW_STROKE,
            strokeDashArray: [6, 3],
            opacity: PREVIEW_OPACITY,
          }),
        );
      }

      if (pts.length === 2) {
        // Both rays are visible: show angle value
        const a = toScreen(pts[0], zoom);
        const v = toScreen(pts[1], zoom);
        objects.push(
          new Line([v.x, v.y, a.x, a.y], {
            stroke: PREVIEW_COLOR,
            strokeWidth: PREVIEW_STROKE,
            strokeDashArray: [6, 3],
            opacity: PREVIEW_OPACITY * 0.6,
          }),
        );
        const angle = angleBetween(pts[0], pts[1], mp);
        liveValue = `${(angle ?? 0).toFixed(1)}\u00b0`;

        const tv = toScreen(pts[1], zoom);
        objects.push(
          new FabricText(liveValue, {
            left: tv.x + 12,
            top: tv.y - 16,
            fontSize: 11,
            fill: '#ffffff',
            backgroundColor: 'rgba(0,0,0,0.7)',
            fontFamily: 'monospace',
            padding: 2,
          }),
        );
      }

      // Dots
      pts.forEach((p) => {
        const sp = toScreen(p, zoom);
        objects.push(
          new Circle({
            left: sp.x - 4,
            top: sp.y - 4,
            radius: 4,
            fill: PREVIEW_COLOR,
            opacity: PREVIEW_OPACITY,
          }),
        );
      });
      break;
    }

    /* ── Circle ───────────────────────────────────────────── */
    case 'circle': {
      if (pts.length === 1) {
        const center = toScreen(pts[0], zoom);
        const edge = toScreen(mp, zoom);
        const radiusPx = Math.sqrt((edge.x - center.x) ** 2 + (edge.y - center.y) ** 2);

        objects.push(
          new Circle({
            left: center.x - radiusPx,
            top: center.y - radiusPx,
            radius: radiusPx,
            fill: `${PREVIEW_COLOR}10`,
            stroke: PREVIEW_COLOR,
            strokeWidth: PREVIEW_STROKE,
            strokeDashArray: [6, 3],
            opacity: PREVIEW_OPACITY,
          }),
        );

        // Center dot
        objects.push(
          new Circle({
            left: center.x - 3,
            top: center.y - 3,
            radius: 3,
            fill: PREVIEW_COLOR,
            opacity: PREVIEW_OPACITY,
          }),
        );

        // Radius line
        objects.push(
          new Line([center.x, center.y, edge.x, edge.y], {
            stroke: PREVIEW_COLOR,
            strokeWidth: 1,
            strokeDashArray: [4, 4],
            opacity: PREVIEW_OPACITY * 0.6,
          }),
        );

        const realRadius = toRealWorld(pixelDistance(pts[0], mp));
        const area = Math.PI * realRadius ** 2;
        liveValue = formatUnit(area, calibrationUnit, '\u00b2');
      }
      break;
    }

    /* ── Dimension (cotation) ──────────────────────────────── */
    case 'dimension': {
      if (pts.length === 1) {
        // Phase 1: line from p1 to mouse
        const a = toScreen(pts[0], zoom);
        const b = toScreen(mp, zoom);
        objects.push(
          new Line([a.x, a.y, b.x, b.y], {
            stroke: PREVIEW_COLOR,
            strokeWidth: PREVIEW_STROKE,
            strokeDashArray: [6, 3],
            opacity: PREVIEW_OPACITY,
          }),
        );
        [a, b].forEach((pt) => {
          objects.push(
            new Circle({
              left: pt.x - 3,
              top: pt.y - 3,
              radius: 3,
              fill: PREVIEW_COLOR,
              opacity: PREVIEW_OPACITY,
            }),
          );
        });
        const dist = toRealWorld(pixelDistance(pts[0], mp));
        liveValue = formatUnit(dist, calibrationUnit);
      } else if (pts.length === 2) {
        // Phase 2: full dimension annotation preview as user positions offset (p3)
        const geom = computeDimensionGeometry(pts[0], pts[1], mp);
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
            stroke: PREVIEW_COLOR, strokeWidth: 0.8, opacity: PREVIEW_OPACITY * 0.7,
          }),
          new Line([e2s.x, e2s.y, e2e.x, e2e.y], {
            stroke: PREVIEW_COLOR, strokeWidth: 0.8, opacity: PREVIEW_OPACITY * 0.7,
          }),
        );
        // Dimension line
        objects.push(
          new Line([ds.x, ds.y, de.x, de.y], {
            stroke: PREVIEW_COLOR, strokeWidth: PREVIEW_STROKE,
            strokeDashArray: [6, 3], opacity: PREVIEW_OPACITY,
          }),
        );
        // Tick marks
        objects.push(
          new Line([t1s.x, t1s.y, t1e.x, t1e.y], {
            stroke: PREVIEW_COLOR, strokeWidth: 1.5, opacity: PREVIEW_OPACITY,
          }),
          new Line([t2s.x, t2s.y, t2e.x, t2e.y], {
            stroke: PREVIEW_COLOR, strokeWidth: 1.5, opacity: PREVIEW_OPACITY,
          }),
        );
        // Dots at measurement points
        [toScreen(pts[0], zoom), toScreen(pts[1], zoom)].forEach((pt) => {
          objects.push(
            new Circle({
              left: pt.x - 3, top: pt.y - 3, radius: 3,
              fill: PREVIEW_COLOR, opacity: PREVIEW_OPACITY,
            }),
          );
        });
        // Label
        const dist = toRealWorld(pixelDistance(pts[0], pts[1]));
        liveValue = formatUnit(dist, calibrationUnit);
        objects.push(
          new FabricText(liveValue, {
            left: tp.x, top: tp.y - 8,
            fontSize: 11, fill: '#ffffff',
            backgroundColor: 'rgba(0,0,0,0.7)',
            fontFamily: 'monospace', padding: 2,
            originX: 'center',
            angle: geom.textAngle,
          }),
        );
      }

      if (orthoEnabled && pts.length === 1) {
        objects.push(...buildOrthoGuides(pts[0], mp, zoom, canvasWidth, canvasHeight));
      }
      break;
    }

    /* ── Count ────────────────────────────────────────────── */
    case 'count': {
      // Show a marker at mouse position for the next count point
      const sp = toScreen(mp, zoom);
      objects.push(
        new Circle({
          left: sp.x - 8,
          top: sp.y - 8,
          radius: 8,
          fill: PREVIEW_COLOR,
          opacity: PREVIEW_OPACITY * 0.5,
        }),
      );
      objects.push(
        new FabricText(`${pts.length + 1}`, {
          left: sp.x,
          top: sp.y,
          fontSize: 10,
          fill: '#ffffff',
          fontFamily: 'sans-serif',
          fontWeight: 'bold',
          originX: 'center',
          originY: 'center',
          opacity: PREVIEW_OPACITY * 0.6,
        }),
      );
      liveValue = `\u00d7${pts.length + 1}`;
      break;
    }

    /* ── Stamp — ghost preview of selected symbol ─────────── */
    case 'stamp': {
      const store = useMetreStore.getState();
      const blockId = store.activeSymbolBlockId;
      const block = blockId ? store.symbolBlocks.find((b) => b.id === blockId) : null;
      if (block) {
        const cal = store.calibration;
        const scaleFactor = cal?.scaleFactor ?? 1;
        const metersToCalUnit: Record<string, number> = {
          m: 1, cm: 100, mm: 1000, ft: 3.28084, in: 39.3701,
        };
        const unitFactor = metersToCalUnit[cal?.unit ?? 'ft'] ?? 1;
        const wPx = (block.widthReal * unitFactor / scaleFactor);
        const hPx = (block.heightReal * unitFactor / scaleFactor);

        const cx = mp.x * zoom;
        const cy = mp.y * zoom;

        for (const path of block.paths) {
          if (path.type === 'line') {
            const [x1, y1, x2, y2] = path.data;
            objects.push(new Line([
              cx + (x1 - 0.5) * wPx * zoom,
              cy + (y1 - 0.5) * hPx * zoom,
              cx + (x2 - 0.5) * wPx * zoom,
              cy + (y2 - 0.5) * hPx * zoom,
            ], { stroke: block.color, strokeWidth: 1, opacity: 0.5, selectable: false, evented: false }));
          } else if (path.type === 'rect') {
            const [x, y, w, h] = path.data;
            const corners = [
              [x, y], [x + w, y], [x + w, y + h], [x, y + h],
            ];
            for (let i = 0; i < 4; i++) {
              const [ax, ay] = corners[i];
              const [bx, by] = corners[(i + 1) % 4];
              objects.push(new Line([
                cx + (ax - 0.5) * wPx * zoom,
                cy + (ay - 0.5) * hPx * zoom,
                cx + (bx - 0.5) * wPx * zoom,
                cy + (by - 0.5) * hPx * zoom,
              ], { stroke: block.color, strokeWidth: 1, opacity: 0.5, selectable: false, evented: false }));
            }
          } else if (path.type === 'arc') {
            const [acx, acy, r, startDeg, endDeg] = path.data;
            const steps = Math.abs(endDeg - startDeg) >= 360 ? 24 : Math.max(6, Math.round(Math.abs(endDeg - startDeg) / 15));
            const sRad = startDeg * Math.PI / 180;
            const eRad = endDeg * Math.PI / 180;
            for (let i = 0; i < steps; i++) {
              const t1 = sRad + (eRad - sRad) * (i / steps);
              const t2 = sRad + (eRad - sRad) * ((i + 1) / steps);
              objects.push(new Line([
                cx + (acx + r * Math.cos(t1) - 0.5) * wPx * zoom,
                cy + (acy + r * Math.sin(t1) - 0.5) * hPx * zoom,
                cx + (acx + r * Math.cos(t2) - 0.5) * wPx * zoom,
                cy + (acy + r * Math.sin(t2) - 0.5) * hPx * zoom,
              ], { stroke: block.color, strokeWidth: 1, opacity: 0.5, selectable: false, evented: false }));
            }
          }
        }

        liveValue = block.name;
      } else {
        liveValue = 'Choisir un symbole';
      }
      break;
    }

    /* ── Pan / Select — no preview ────────────────────────── */
    case 'pan':
    case 'select':
    default:
      break;
  }

  return { objects, liveValue };
}
