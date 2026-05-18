import type { Point, SnapPoint, Measurement } from '../types';
import { distance, midpoint, lineIntersection } from './geometry';

/**
 * Find the nearest snap point within `threshold` pixels of `point`.
 * Returns the closest match or null if nothing is close enough.
 */
export function findNearestSnapPoint(
  point: Point,
  snapPoints: SnapPoint[],
  threshold: number,
): SnapPoint | null {
  let best: SnapPoint | null = null;
  let bestDist = threshold;

  for (const sp of snapPoints) {
    const d = distance(point, sp);
    if (d < bestDist) {
      bestDist = d;
      best = sp;
    }
  }

  return best;
}

const SNAP_EPSILON = 0.5;

function isDuplicate(p: Point, existing: Point[]): boolean {
  for (const e of existing) {
    if (Math.abs(p.x - e.x) < SNAP_EPSILON && Math.abs(p.y - e.y) < SNAP_EPSILON) {
      return true;
    }
  }
  return false;
}

/**
 * Generate endpoint snap points from all measurements.
 */
export function generateEndpoints(
  measurements: Measurement[],
): SnapPoint[] {
  const points: SnapPoint[] = [];

  for (const m of measurements) {
    for (const p of m.points) {
      if (!isDuplicate(p, points)) {
        points.push({ x: p.x, y: p.y, type: 'endpoint' });
      }
    }
  }

  return points;
}

/**
 * Generate midpoint snap points for each segment of each measurement.
 */
export function generateMidpoints(
  measurements: Measurement[],
): SnapPoint[] {
  const points: SnapPoint[] = [];

  for (const m of measurements) {
    if (m.points.length < 2) continue;

    // Segments
    for (let i = 0; i < m.points.length - 1; i++) {
      const mid = midpoint(m.points[i], m.points[i + 1]);
      if (!isDuplicate(mid, points)) {
        points.push({ x: mid.x, y: mid.y, type: 'midpoint' });
      }
    }

    // Closing segment for polygons (area/perimeter with 3+ points)
    if (
      (m.type === 'area' || m.type === 'perimeter') &&
      m.points.length >= 3
    ) {
      const mid = midpoint(
        m.points[m.points.length - 1],
        m.points[0],
      );
      if (!isDuplicate(mid, points)) {
        points.push({ x: mid.x, y: mid.y, type: 'midpoint' });
      }
    }
  }

  return points;
}

/**
 * Generate intersection snap points between all measurement segments.
 */
export function generateIntersections(
  measurements: Measurement[],
): SnapPoint[] {
  const points: SnapPoint[] = [];

  // Collect all segments
  interface Segment {
    a: Point;
    b: Point;
  }
  const segments: Segment[] = [];

  for (const m of measurements) {
    for (let i = 0; i < m.points.length - 1; i++) {
      segments.push({ a: m.points[i], b: m.points[i + 1] });
    }
    // Closing segment for polygons
    if (
      (m.type === 'area' || m.type === 'perimeter') &&
      m.points.length >= 3
    ) {
      segments.push({
        a: m.points[m.points.length - 1],
        b: m.points[0],
      });
    }
  }

  // Test all pairs
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const ix = lineIntersection(
        segments[i].a,
        segments[i].b,
        segments[j].a,
        segments[j].b,
      );
      if (ix) {
        if (!isDuplicate(ix, points)) {
          points.push({ x: ix.x, y: ix.y, type: 'intersection' });
        }
      }
    }
  }

  return points;
}

/**
 * Generate all snap points from measurements.
 * Combines endpoints, midpoints, and intersections.
 */
export function generateAllSnapPoints(
  measurements: Measurement[],
): SnapPoint[] {
  return [
    ...generateEndpoints(measurements),
    ...generateMidpoints(measurements),
    ...generateIntersections(measurements),
  ];
}
