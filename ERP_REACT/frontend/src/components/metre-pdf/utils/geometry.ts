import type { Point } from '../types';

/** Euclidean distance between two 2D points. */
export function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  return isFinite(d) ? d : 0;
}

/**
 * Area of a simple polygon using the Shoelace formula.
 * Returns a positive value regardless of vertex winding order.
 */
export function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j].x * points[i].y;
    area -= points[i].x * points[j].y;
  }
  const result = Math.abs(area) / 2;
  return isFinite(result) ? result : 0;
}

/** Perimeter of a polygon (sum of edge lengths, closing the loop). */
export function polygonPerimeter(points: Point[]): number {
  if (points.length < 2) return 0;

  let perimeter = 0;
  for (let i = 0; i < points.length - 1; i++) {
    perimeter += distance(points[i], points[i + 1]);
  }
  // Close the polygon
  if (points.length > 2) {
    perimeter += distance(points[points.length - 1], points[0]);
  }
  return perimeter;
}

/**
 * Angle at vertex `vertex` between rays to `p1` and `p2`, in degrees.
 * Always returns a positive value in [0, 180].
 */
export function angleBetween(p1: Point, vertex: Point, p2: Point): number {
  const v1x = p1.x - vertex.x;
  const v1y = p1.y - vertex.y;
  const v2x = p2.x - vertex.x;
  const v2y = p2.y - vertex.y;

  const dot = v1x * v2x + v1y * v2y;
  const mag1 = Math.sqrt(v1x ** 2 + v1y ** 2);
  const mag2 = Math.sqrt(v2x ** 2 + v2y ** 2);

  if (mag1 < 0.001 || mag2 < 0.001) return 0;

  const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return (Math.acos(cosAngle) * 180) / Math.PI;
}

/** Midpoint between two points. */
export function midpoint(p1: Point, p2: Point): Point {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  };
}

/**
 * Nearest point on the line segment [lineStart, lineEnd] to `point`.
 * The result is clamped to the segment.
 */
export function nearestPointOnLine(
  point: Point,
  lineStart: Point,
  lineEnd: Point,
): Point {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return { ...lineStart };

  let t =
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return {
    x: lineStart.x + t * dx,
    y: lineStart.y + t * dy,
  };
}

/**
 * Intersection of two line segments (a1-a2) and (b1-b2).
 * Returns the intersection point or null if the segments don't intersect.
 */
export function lineIntersection(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): Point | null {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null; // parallel

  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return {
    x: a1.x + t * d1x,
    y: a1.y + t * d1y,
  };
}

/**
 * Snap `point` to the nearest angle step relative to `origin`.
 * Used for ortho mode (steps of 45 degrees by default).
 */
export function snapToAngle(
  origin: Point,
  point: Point,
  angleStep = 45,
): Point {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist === 0) return { ...origin };

  const rawAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const snapped = Math.round(rawAngle / angleStep) * angleStep;
  const rad = (snapped * Math.PI) / 180;

  return {
    x: origin.x + dist * Math.cos(rad),
    y: origin.y + dist * Math.sin(rad),
  };
}

/**
 * Ray-casting algorithm to determine if a point is inside a polygon.
 */
export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}

/** Convert degrees to radians. */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Convert radians to degrees. */
export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/* ── Dimension (cotation) geometry ────────────────────────── */

export interface DimensionGeometry {
  dimLineStart: Point;
  dimLineEnd: Point;
  ext1Start: Point;
  ext1End: Point;
  ext2Start: Point;
  ext2End: Point;
  tick1Start: Point;
  tick1End: Point;
  tick2Start: Point;
  tick2End: Point;
  textPosition: Point;
  textAngle: number; // degrees, so text reads left-to-right
}

/**
 * Compute geometry for an architectural dimension annotation.
 *
 * @param p1 - Start of measured edge
 * @param p2 - End of measured edge
 * @param p3 - User click defining the offset of the dimension line
 */
export function computeDimensionGeometry(
  p1: Point,
  p2: Point,
  p3: Point,
): DimensionGeometry {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  // Degenerate case: p1 ≈ p2
  if (len < 1e-6) {
    return {
      dimLineStart: { ...p3 },
      dimLineEnd: { ...p3 },
      ext1Start: { ...p1 },
      ext1End: { ...p3 },
      ext2Start: { ...p2 },
      ext2End: { ...p3 },
      tick1Start: { ...p3 },
      tick1End: { ...p3 },
      tick2Start: { ...p3 },
      tick2End: { ...p3 },
      textPosition: { ...p3 },
      textAngle: 0,
    };
  }

  // Direction along measured edge and normal
  const dirX = dx / len;
  const dirY = dy / len;
  const normX = -dirY;
  const normY = dirX;

  // Signed offset: project p3 onto normal relative to midpoint of p1-p2
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  let offset = (p3.x - midX) * normX + (p3.y - midY) * normY;

  // Clamp minimum offset to 10px for visibility
  const sign = offset >= 0 ? 1 : -1;
  if (Math.abs(offset) < 10) offset = sign * 10;

  // Dimension line endpoints (p1 and p2 projected along normal by offset)
  const dimLineStart: Point = { x: p1.x + normX * offset, y: p1.y + normY * offset };
  const dimLineEnd: Point = { x: p2.x + normX * offset, y: p2.y + normY * offset };

  // Extension lines: from measurement points to dimension line, with gap and overshoot
  const GAP = 3;
  const OVERSHOOT = 4;
  const ext1Start: Point = { x: p1.x + normX * sign * GAP, y: p1.y + normY * sign * GAP };
  const ext1End: Point = {
    x: dimLineStart.x + normX * sign * OVERSHOOT,
    y: dimLineStart.y + normY * sign * OVERSHOOT,
  };
  const ext2Start: Point = { x: p2.x + normX * sign * GAP, y: p2.y + normY * sign * GAP };
  const ext2End: Point = {
    x: dimLineEnd.x + normX * sign * OVERSHOOT,
    y: dimLineEnd.y + normY * sign * OVERSHOOT,
  };

  // Tick marks: 45-degree architectural ticks at dimension line endpoints
  const TICK_SIZE = 5;
  // Tick direction: 45° between dimension line direction and normal
  const tickDx = (dirX + normX * sign) * TICK_SIZE * 0.707;
  const tickDy = (dirY + normY * sign) * TICK_SIZE * 0.707;
  const tick1Start: Point = { x: dimLineStart.x - tickDx, y: dimLineStart.y - tickDy };
  const tick1End: Point = { x: dimLineStart.x + tickDx, y: dimLineStart.y + tickDy };
  const tick2Start: Point = { x: dimLineEnd.x - tickDx, y: dimLineEnd.y - tickDy };
  const tick2End: Point = { x: dimLineEnd.x + tickDx, y: dimLineEnd.y + tickDy };

  // Text position: midpoint of dimension line, offset slightly
  const textPosition: Point = {
    x: (dimLineStart.x + dimLineEnd.x) / 2,
    y: (dimLineStart.y + dimLineEnd.y) / 2,
  };

  // Text angle: along the dimension line, always readable (left-to-right)
  let textAngle = (Math.atan2(dirY, dirX) * 180) / Math.PI;
  if (textAngle > 90) textAngle -= 180;
  if (textAngle < -90) textAngle += 180;

  return {
    dimLineStart,
    dimLineEnd,
    ext1Start,
    ext1End,
    ext2Start,
    ext2End,
    tick1Start,
    tick1End,
    tick2Start,
    tick2End,
    textPosition,
    textAngle,
  };
}

/** Centroid (average) of a set of points. */
export function centroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/* ── Axis-alignment snap (magnetic alignment guides) ───────── */

export interface AxisAlignmentResult {
  /** Snapped X coordinate, defined only when an X-axis alignment is found. */
  snappedX?: number;
  /** Snapped Y coordinate, defined only when a Y-axis alignment is found. */
  snappedY?: number;
  /** The reference point we aligned to on the X axis (for visual guides). */
  refX?: Point;
  /** The reference point we aligned to on the Y axis. */
  refY?: Point;
}

export interface AxisAlignmentOptions {
  /** Allow X-axis alignment (snap to a candidate's X coord). Default true. */
  allowX?: boolean;
  /** Allow Y-axis alignment (snap to a candidate's Y coord). Default true. */
  allowY?: boolean;
}

/**
 * Find the closest axis-aligned reference point to `pt` among `candidates`,
 * within `tolerance` (in page units). Returns snapped coordinates and the
 * reference points used so callers can draw alignment guides.
 *
 * The X and Y dimensions are checked independently — `pt` may snap on X
 * only, on Y only, or on both axes when two different reference points
 * align.
 */
export function findAxisAlignment(
  pt: Point,
  candidates: Point[],
  tolerance: number,
  options: AxisAlignmentOptions = {},
): AxisAlignmentResult {
  const allowX = options.allowX !== false;
  const allowY = options.allowY !== false;
  const result: AxisAlignmentResult = {};
  if (!candidates || candidates.length === 0) return result;
  if (!Number.isFinite(tolerance) || tolerance <= 0) return result;

  let bestDx = tolerance;
  let bestDy = tolerance;

  for (const c of candidates) {
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    if (allowX) {
      const dx = Math.abs(pt.x - c.x);
      if (dx <= bestDx) {
        bestDx = dx;
        result.snappedX = c.x;
        result.refX = c;
      }
    }
    if (allowY) {
      const dy = Math.abs(pt.y - c.y);
      if (dy <= bestDy) {
        bestDy = dy;
        result.snappedY = c.y;
        result.refY = c;
      }
    }
  }

  return result;
}
