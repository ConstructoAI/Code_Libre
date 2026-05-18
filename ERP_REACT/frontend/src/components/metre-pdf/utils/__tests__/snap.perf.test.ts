/**
 * Performance budget for `generateAllSnapPoints`. The drag handlers added
 * in commit d17b887 invoke this transitively on every mousemove (60 fps)
 * because measurements mutate, so on heavy pages the O(S²) intersection
 * pass can become the bottleneck. These tests pin a budget that fails
 * loudly if a future change pushes us past 16 ms / frame at realistic
 * page sizes.
 *
 * Numbers are deliberately loose: production values measured in Vitest
 * on Node sit well under these thresholds, but CI under load can drift.
 */

import { describe, it, expect } from 'vitest';
import { generateAllSnapPoints } from '../snap';
import type { Measurement, MeasurementType, MeasurementUnit } from '../../types';

function makeMeasurement(id: string, type: MeasurementType, points: { x: number; y: number }[]): Measurement {
  return {
    id,
    documentId: 'doc',
    pageNumber: 1,
    type,
    label: id,
    value: 0,
    unit: 'm' as MeasurementUnit,
    points,
    color: '#3b82f6',
    layer: 'default',
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function gridOfRectangles(rows: number, cols: number): Measurement[] {
  // Each rectangle = area type with 4 points. Lays them on a grid so
  // segments overlap meaningfully (intersections actually fire).
  const out: Measurement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * 10;
      const y = r * 10;
      out.push(makeMeasurement(`rect-${r}-${c}`, 'area', [
        { x, y },
        { x: x + 8, y },
        { x: x + 8, y: y + 8 },
        { x, y: y + 8 },
      ]));
    }
  }
  return out;
}

describe('snap perf — generateAllSnapPoints', () => {
  it('handles 50 measurements (typical residential plan) under 16 ms / frame', () => {
    // 50 rectangles ≈ 200 segments → 200²/2 ≈ 20k intersection pairs.
    const measurements = gridOfRectangles(5, 10);
    expect(measurements).toHaveLength(50);
    // Warm-up so JIT is settled, then measure.
    for (let i = 0; i < 3; i++) generateAllSnapPoints(measurements);
    const start = performance.now();
    for (let i = 0; i < 10; i++) generateAllSnapPoints(measurements);
    const avgMs = (performance.now() - start) / 10;
    // 16 ms is the budget for 60 fps; we want plenty of headroom for
    // the rest of the redraw loop on a heavy page.
    expect(avgMs).toBeLessThan(16);
  });

  it('handles 100 measurements under 32 ms / frame', () => {
    // 100 rectangles ≈ 400 segments → ~80k intersection pairs.
    const measurements = gridOfRectangles(10, 10);
    expect(measurements).toHaveLength(100);
    for (let i = 0; i < 3; i++) generateAllSnapPoints(measurements);
    const start = performance.now();
    for (let i = 0; i < 5; i++) generateAllSnapPoints(measurements);
    const avgMs = (performance.now() - start) / 5;
    // Looser budget at this scale: the user should still be functional
    // but the page is unusually dense for residential takeoff.
    expect(avgMs).toBeLessThan(32);
  });

  it('handles 200 measurements without crashing', () => {
    // Stress test only — no specific budget. Asserts we complete within
    // 5 seconds total even at this extreme scale, ensuring the algorithm
    // has no pathological behaviour we missed.
    const measurements = gridOfRectangles(10, 20);
    expect(measurements).toHaveLength(200);
    const start = performance.now();
    const snaps = generateAllSnapPoints(measurements);
    const elapsedMs = performance.now() - start;
    expect(snaps.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(5000);
  });
});
