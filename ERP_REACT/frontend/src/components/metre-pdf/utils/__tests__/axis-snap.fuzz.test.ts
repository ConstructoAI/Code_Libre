/**
 * Property-based / fuzz tests for the axis-alignment snap helpers. These
 * complement the deterministic geometry.test.ts suite by feeding random
 * inputs to findAxisAlignment and asserting invariants that should hold
 * regardless of the specific values:
 *
 *   1. snappedX / snappedY are always within `tolerance` of `pt`
 *   2. refX.x === snappedX and refY.y === snappedY (pointer integrity)
 *   3. The chosen reference is the closest candidate on each axis
 *   4. Disabled axes never produce a snap, no matter what the data looks like
 *   5. Non-finite candidates are silently skipped without crashing
 *
 * The seed is fixed so failures are reproducible.
 */

import { describe, it, expect } from 'vitest';
import { findAxisAlignment } from '../geometry';
import type { Point } from '../../types';

// Deterministic Mulberry32 PRNG so a regression always reproduces the
// same input sequence — important for shrinking once a fuzz failure
// is reported.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPoint(rng: () => number, scale = 1000): Point {
  return {
    x: (rng() - 0.5) * 2 * scale,
    y: (rng() - 0.5) * 2 * scale,
  };
}

function randomPoints(rng: () => number, n: number, scale = 1000): Point[] {
  return Array.from({ length: n }, () => randomPoint(rng, scale));
}

describe('fuzz: findAxisAlignment - invariants over random inputs', () => {
  it('snappedX/Y always within tolerance of pt across 500 random calls', () => {
    const rng = makeRng(1234);
    for (let i = 0; i < 500; i++) {
      const tolerance = rng() * 50 + 1; // 1..51
      const pt = randomPoint(rng);
      const candidates = randomPoints(rng, Math.floor(rng() * 20) + 1);
      const r = findAxisAlignment(pt, candidates, tolerance);
      if (r.snappedX !== undefined) {
        expect(Math.abs(r.snappedX - pt.x)).toBeLessThanOrEqual(tolerance);
      }
      if (r.snappedY !== undefined) {
        expect(Math.abs(r.snappedY - pt.y)).toBeLessThanOrEqual(tolerance);
      }
    }
  });

  it('refX.x === snappedX and refY.y === snappedY across 500 random calls', () => {
    const rng = makeRng(2345);
    for (let i = 0; i < 500; i++) {
      const tolerance = rng() * 50 + 1;
      const pt = randomPoint(rng);
      const candidates = randomPoints(rng, Math.floor(rng() * 20) + 1);
      const r = findAxisAlignment(pt, candidates, tolerance);
      if (r.refX !== undefined && r.snappedX !== undefined) {
        expect(r.refX.x).toBe(r.snappedX);
      }
      if (r.refY !== undefined && r.snappedY !== undefined) {
        expect(r.refY.y).toBe(r.snappedY);
      }
    }
  });

  it('chosen reference is genuinely the closest candidate on each axis', () => {
    const rng = makeRng(3456);
    for (let i = 0; i < 300; i++) {
      const tolerance = rng() * 50 + 1;
      const pt = randomPoint(rng);
      const candidates = randomPoints(rng, Math.floor(rng() * 30) + 1);
      const r = findAxisAlignment(pt, candidates, tolerance);

      // Manually find the closest X / Y candidate within tolerance
      let bestX: Point | undefined;
      let bestY: Point | undefined;
      let bestDx = tolerance + 1e-12;
      let bestDy = tolerance + 1e-12;
      for (const c of candidates) {
        const dx = Math.abs(pt.x - c.x);
        const dy = Math.abs(pt.y - c.y);
        if (dx <= bestDx) {
          bestDx = dx;
          bestX = c;
        }
        if (dy <= bestDy) {
          bestDy = dy;
          bestY = c;
        }
      }

      if (bestX !== undefined) {
        // The library result might pick a different candidate that ties on
        // distance; just check that its X-distance equals the optimal.
        expect(Math.abs(pt.x - r.snappedX!)).toBeCloseTo(bestDx, 9);
      } else {
        expect(r.snappedX).toBeUndefined();
      }
      if (bestY !== undefined) {
        expect(Math.abs(pt.y - r.snappedY!)).toBeCloseTo(bestDy, 9);
      } else {
        expect(r.snappedY).toBeUndefined();
      }
    }
  });

  it('allowX=false never produces an X snap (200 calls)', () => {
    const rng = makeRng(4567);
    for (let i = 0; i < 200; i++) {
      const tolerance = rng() * 50 + 1;
      const pt = randomPoint(rng);
      const candidates = randomPoints(rng, Math.floor(rng() * 20) + 1);
      const r = findAxisAlignment(pt, candidates, tolerance, { allowX: false });
      expect(r.snappedX).toBeUndefined();
      expect(r.refX).toBeUndefined();
    }
  });

  it('allowY=false never produces a Y snap (200 calls)', () => {
    const rng = makeRng(5678);
    for (let i = 0; i < 200; i++) {
      const tolerance = rng() * 50 + 1;
      const pt = randomPoint(rng);
      const candidates = randomPoints(rng, Math.floor(rng() * 20) + 1);
      const r = findAxisAlignment(pt, candidates, tolerance, { allowY: false });
      expect(r.snappedY).toBeUndefined();
      expect(r.refY).toBeUndefined();
    }
  });

  it('survives non-finite candidate coordinates without crashing', () => {
    const rng = makeRng(6789);
    for (let i = 0; i < 100; i++) {
      const tolerance = rng() * 50 + 1;
      const pt = randomPoint(rng);
      const baseCandidates = randomPoints(rng, 5);
      // Inject some bad candidates
      const corrupted: Point[] = [
        ...baseCandidates,
        { x: NaN, y: rng() * 1000 },
        { x: rng() * 1000, y: NaN },
        { x: Infinity, y: 0 },
        { x: 0, y: -Infinity },
        { x: NaN, y: NaN },
      ];
      // Should not throw and should still find snaps among the clean candidates
      expect(() => findAxisAlignment(pt, corrupted, tolerance)).not.toThrow();
      const r = findAxisAlignment(pt, corrupted, tolerance);
      // Any snapped result must come from a finite candidate
      if (r.refX) {
        expect(Number.isFinite(r.refX.x)).toBe(true);
        expect(Number.isFinite(r.refX.y)).toBe(true);
      }
      if (r.refY) {
        expect(Number.isFinite(r.refY.x)).toBe(true);
        expect(Number.isFinite(r.refY.y)).toBe(true);
      }
    }
  });

  it('large candidate sets (1000 points) complete within 50ms', () => {
    const rng = makeRng(7890);
    const candidates = randomPoints(rng, 1000);
    const pt = randomPoint(rng);
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      findAxisAlignment(pt, candidates, 8);
    }
    const elapsed = performance.now() - start;
    // 100 iterations × 1000 candidates = 100k comparisons. Well below
    // a millisecond per call on a modern engine; the budget here is loose
    // to avoid flaking on slow CI.
    expect(elapsed).toBeLessThan(50);
  });

  it('idempotent: calling twice with the same input returns the same result', () => {
    const rng = makeRng(8901);
    for (let i = 0; i < 100; i++) {
      const tolerance = rng() * 50 + 1;
      const pt = randomPoint(rng);
      const candidates = randomPoints(rng, Math.floor(rng() * 20) + 1);
      const r1 = findAxisAlignment(pt, candidates, tolerance);
      const r2 = findAxisAlignment(pt, candidates, tolerance);
      expect(r1).toEqual(r2);
    }
  });

  it('order-invariant: shuffling candidates does not change the snap result (modulo ties)', () => {
    const rng = makeRng(9012);
    for (let i = 0; i < 100; i++) {
      const tolerance = rng() * 50 + 1;
      const pt = randomPoint(rng);
      const candidates = randomPoints(rng, Math.floor(rng() * 20) + 5);
      // Make a shuffled copy
      const shuffled = [...candidates].sort(() => rng() - 0.5);
      const r1 = findAxisAlignment(pt, candidates, tolerance);
      const r2 = findAxisAlignment(pt, shuffled, tolerance);
      // Distances must match exactly even if the chosen reference point
      // identity differs in the case of ties.
      if (r1.snappedX !== undefined && r2.snappedX !== undefined) {
        expect(Math.abs(pt.x - r1.snappedX)).toBeCloseTo(Math.abs(pt.x - r2.snappedX), 9);
      } else {
        expect(r1.snappedX).toBe(r2.snappedX);
      }
      if (r1.snappedY !== undefined && r2.snappedY !== undefined) {
        expect(Math.abs(pt.y - r1.snappedY)).toBeCloseTo(Math.abs(pt.y - r2.snappedY), 9);
      } else {
        expect(r1.snappedY).toBe(r2.snappedY);
      }
    }
  });
});
