import { describe, it, expect } from 'vitest';
import { findAxisAlignment, distance, midpoint, polygonArea, polygonPerimeter } from '../geometry';
import type { Point } from '../../types';

describe('findAxisAlignment - input validation', () => {
  it('returns empty when no candidates', () => {
    const r = findAxisAlignment({ x: 10, y: 20 }, [], 5);
    expect(r.snappedX).toBeUndefined();
    expect(r.snappedY).toBeUndefined();
  });

  it('returns empty for non-finite tolerance', () => {
    const cands: Point[] = [{ x: 10, y: 20 }];
    expect(findAxisAlignment({ x: 10, y: 20 }, cands, NaN)).toEqual({});
    expect(findAxisAlignment({ x: 10, y: 20 }, cands, Infinity)).toEqual({});
    expect(findAxisAlignment({ x: 10, y: 20 }, cands, 0)).toEqual({});
    expect(findAxisAlignment({ x: 10, y: 20 }, cands, -1)).toEqual({});
  });

  it('skips candidates with NaN coordinates', () => {
    const cands: Point[] = [{ x: NaN, y: 20 }, { x: 10, y: NaN }];
    const r = findAxisAlignment({ x: 10, y: 20 }, cands, 5);
    expect(r.snappedX).toBeUndefined();
    expect(r.snappedY).toBeUndefined();
  });
});

describe('findAxisAlignment - X axis snap', () => {
  it('snaps X when within tolerance', () => {
    const cands: Point[] = [{ x: 100, y: 50 }];
    const r = findAxisAlignment({ x: 102, y: 200 }, cands, 5);
    expect(r.snappedX).toBe(100);
    expect(r.refX).toEqual({ x: 100, y: 50 });
    expect(r.snappedY).toBeUndefined();
  });

  it('does not snap when outside tolerance', () => {
    const cands: Point[] = [{ x: 100, y: 50 }];
    const r = findAxisAlignment({ x: 110, y: 200 }, cands, 5);
    expect(r.snappedX).toBeUndefined();
    expect(r.refX).toBeUndefined();
  });

  it('picks the closest X candidate', () => {
    const cands: Point[] = [
      { x: 100, y: 50 },
      { x: 95, y: 30 },
      { x: 90, y: 10 },
    ];
    // pt.x = 96 → candidates within tolerance 8: 100 (Δ=4), 95 (Δ=1), 90 (Δ=6).
    // The closest one wins.
    const r = findAxisAlignment({ x: 96, y: 200 }, cands, 8);
    expect(r.snappedX).toBe(95);
    expect(r.refX).toEqual({ x: 95, y: 30 });
  });
});

describe('findAxisAlignment - Y axis snap', () => {
  it('snaps Y when within tolerance', () => {
    const cands: Point[] = [{ x: 50, y: 100 }];
    const r = findAxisAlignment({ x: 200, y: 102 }, cands, 5);
    expect(r.snappedY).toBe(100);
    expect(r.refY).toEqual({ x: 50, y: 100 });
    expect(r.snappedX).toBeUndefined();
  });

  it('picks the closest Y candidate', () => {
    const cands: Point[] = [
      { x: 10, y: 100 },
      { x: 30, y: 95 },
      { x: 50, y: 90 },
    ];
    const r = findAxisAlignment({ x: 200, y: 96 }, cands, 8);
    expect(r.snappedY).toBe(95);
    expect(r.refY).toEqual({ x: 30, y: 95 });
  });
});

describe('findAxisAlignment - both axes', () => {
  it('snaps both X and Y to different reference points', () => {
    // X-aligned ref at x=100, Y-aligned ref at y=200, two distinct points.
    const cands: Point[] = [
      { x: 100, y: 999 }, // matches X
      { x: 999, y: 200 }, // matches Y
    ];
    const r = findAxisAlignment({ x: 102, y: 198 }, cands, 5);
    expect(r.snappedX).toBe(100);
    expect(r.snappedY).toBe(200);
    expect(r.refX).toEqual({ x: 100, y: 999 });
    expect(r.refY).toEqual({ x: 999, y: 200 });
  });

  it('snaps both axes to the same reference point if the cursor is right next to it', () => {
    const cands: Point[] = [{ x: 100, y: 200 }];
    const r = findAxisAlignment({ x: 102, y: 198 }, cands, 5);
    expect(r.snappedX).toBe(100);
    expect(r.snappedY).toBe(200);
    expect(r.refX).toEqual({ x: 100, y: 200 });
    expect(r.refY).toEqual({ x: 100, y: 200 });
  });
});

describe('findAxisAlignment - allowX/allowY options', () => {
  it('disables X snap when allowX=false', () => {
    const cands: Point[] = [{ x: 100, y: 200 }];
    const r = findAxisAlignment({ x: 102, y: 198 }, cands, 5, { allowX: false });
    expect(r.snappedX).toBeUndefined();
    expect(r.refX).toBeUndefined();
    expect(r.snappedY).toBe(200);
  });

  it('disables Y snap when allowY=false', () => {
    const cands: Point[] = [{ x: 100, y: 200 }];
    const r = findAxisAlignment({ x: 102, y: 198 }, cands, 5, { allowY: false });
    expect(r.snappedX).toBe(100);
    expect(r.snappedY).toBeUndefined();
    expect(r.refY).toBeUndefined();
  });

  it('returns empty when both allowX and allowY are false', () => {
    const cands: Point[] = [{ x: 100, y: 200 }];
    const r = findAxisAlignment({ x: 102, y: 198 }, cands, 5, { allowX: false, allowY: false });
    expect(r).toEqual({});
  });
});

describe('findAxisAlignment - tolerance boundary', () => {
  it('snaps exactly at the tolerance limit', () => {
    const cands: Point[] = [{ x: 100, y: 200 }];
    const r = findAxisAlignment({ x: 105, y: 200 }, cands, 5);
    expect(r.snappedX).toBe(100); // |105 - 100| = 5 ≤ 5
  });

  it('does not snap just outside the tolerance', () => {
    const cands: Point[] = [{ x: 100, y: 200 }];
    const r = findAxisAlignment({ x: 105.1, y: 200 }, cands, 5);
    expect(r.snappedX).toBeUndefined();
  });
});

describe('regression - existing geometry helpers', () => {
  it('distance returns Euclidean distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  it('distance returns 0 for non-finite coords', () => {
    expect(distance({ x: NaN, y: 0 }, { x: 0, y: 0 })).toBe(0);
    expect(distance({ x: 0, y: 0 }, { x: Infinity, y: 0 })).toBe(0);
  });
  it('midpoint averages coords', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
  });
  it('polygonArea uses Shoelace (10x10 square = 100)', () => {
    const sq: Point[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    expect(polygonArea(sq)).toBe(100);
  });
  it('polygonPerimeter sums edges including closing edge', () => {
    const sq: Point[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    expect(polygonPerimeter(sq)).toBe(40);
  });
});
