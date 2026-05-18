import { describe, it, expect } from 'vitest';
import {
  computeSegments,
  hasSegmentDimensions,
  isClosedShape,
  hasEdgeMidpoints,
  convertUnit,
  getUnitLabel,
  formatMeasurement,
  defaultMeasurementLabel,
} from '../format';
import type { Calibration, Point } from '../../types';

const NO_CAL: Calibration | null = null;

const calM: Calibration = {
  id: 'c1',
  documentId: 'd1',
  pageNumber: 1,
  scaleFactor: 0.01, // 1 px = 0.01 m
  unit: 'm',
  referenceLength: 100,
  pixelLength: 10000,
};

describe('hasSegmentDimensions', () => {
  it('returns true for polyline / area / perimeter', () => {
    expect(hasSegmentDimensions('polyline')).toBe(true);
    expect(hasSegmentDimensions('area')).toBe(true);
    expect(hasSegmentDimensions('perimeter')).toBe(true);
  });
  it('returns false for everything else', () => {
    for (const t of ['distance', 'angle', 'count', 'circle', 'text', 'arrow', 'cloud', 'note', 'symbol', 'dimension', 'callout', 'highlight', 'freehand']) {
      expect(hasSegmentDimensions(t)).toBe(false);
    }
  });
});

describe('isClosedShape', () => {
  it('returns true only for area and perimeter', () => {
    expect(isClosedShape('area')).toBe(true);
    expect(isClosedShape('perimeter')).toBe(true);
    expect(isClosedShape('polyline')).toBe(false);
    expect(isClosedShape('distance')).toBe(false);
  });
});

describe('hasEdgeMidpoints', () => {
  it('returns true for distance / polyline / area / perimeter', () => {
    expect(hasEdgeMidpoints('distance')).toBe(true);
    expect(hasEdgeMidpoints('polyline')).toBe(true);
    expect(hasEdgeMidpoints('area')).toBe(true);
    expect(hasEdgeMidpoints('perimeter')).toBe(true);
  });
  it('returns false for non-edge-bearing types', () => {
    for (const t of ['angle', 'count', 'circle', 'text', 'arrow', 'cloud', 'note', 'symbol', 'dimension', 'callout', 'highlight', 'freehand']) {
      expect(hasEdgeMidpoints(t)).toBe(false);
    }
  });
});

describe('computeSegments - input validation', () => {
  it('returns [] for empty points', () => {
    expect(computeSegments([], false, NO_CAL, 'm')).toEqual([]);
  });
  it('returns [] for single point', () => {
    expect(computeSegments([{ x: 0, y: 0 }], false, NO_CAL, 'm')).toEqual([]);
  });
  it('returns [] for null/undefined points', () => {
    expect(computeSegments(undefined as unknown as Point[], false, NO_CAL, 'm')).toEqual([]);
    expect(computeSegments(null as unknown as Point[], false, NO_CAL, 'm')).toEqual([]);
  });
});

describe('computeSegments - open polyline (2 points)', () => {
  const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  it('emits exactly 1 segment', () => {
    const segs = computeSegments(pts, false, NO_CAL, 'm');
    expect(segs).toHaveLength(1);
  });
  it('segment connects P0 to P1', () => {
    const [s] = computeSegments(pts, false, NO_CAL, 'm');
    expect(s.startPoint).toEqual({ x: 0, y: 0 });
    expect(s.endPoint).toEqual({ x: 100, y: 0 });
  });
  it('midpoint is geometric center', () => {
    const [s] = computeSegments(pts, false, NO_CAL, 'm');
    expect(s.midPoint).toEqual({ x: 50, y: 0 });
  });
  it('pixel length is exact Euclidean distance', () => {
    const [s] = computeSegments(pts, false, NO_CAL, 'm');
    expect(s.pixelLength).toBe(100);
  });
  it('formatted is in pixels when not calibrated', () => {
    const [s] = computeSegments(pts, false, NO_CAL, 'm');
    expect(s.formatted).toBe('100 px');
    expect(s.realLength).toBeNull();
  });
});

describe('computeSegments - calibrated', () => {
  it('converts pixels to metres correctly', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const [s] = computeSegments(pts, false, calM, 'm');
    expect(s.pixelLength).toBe(100);
    expect(s.realLength).toBeCloseTo(1.0, 5);
    expect(s.displayLength).toBeCloseTo(1.0, 5);
    expect(s.formatted).toBe('1.00 m');
  });
  it('converts m to ft (display unit different from calibration unit)', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const [s] = computeSegments(pts, false, calM, 'ft');
    // 100 px * 0.01 m/px = 1.0 m. 1 m / 0.3048 m/ft ≈ 3.281 ft
    expect(s.realLength).toBeCloseTo(1.0, 5);
    expect(s.displayLength).toBeCloseTo(3.2808, 3);
    // Imperial format (1/16" precision): 3.2808 ft = 3 ft + 0.2808*192 = 53.91
    // sixteenths -> round to 54 -> 3 ft + 3 inches + 6/16 (= 3/8")
    // -> "3'-3 3/8\""
    expect(s.formatted).toMatch(/^3'-3 3\/8"$/);
  });
});

describe('computeSegments - closed shape (area / perimeter)', () => {
  // Square (10x10) at origin
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it('emits 4 segments for a 4-point closed shape (with closing edge)', () => {
    const segs = computeSegments(square, true, NO_CAL, 'm');
    expect(segs).toHaveLength(4);
  });
  it('last segment is the closing edge (last → first)', () => {
    const segs = computeSegments(square, true, NO_CAL, 'm');
    const closing = segs[3];
    expect(closing.startPoint).toEqual({ x: 0, y: 10 });
    expect(closing.endPoint).toEqual({ x: 0, y: 0 });
  });
  it('open mode emits N-1 segments (no closing edge)', () => {
    const segs = computeSegments(square, false, NO_CAL, 'm');
    expect(segs).toHaveLength(3);
  });
  it('closed shape with only 2 points falls back to open mode (no wrap)', () => {
    // n=2 with closed=true must NOT emit 2 segments — wrap-around with 2 points
    // would create a degenerate (back-and-forth) duplicate.
    const segs = computeSegments(
      [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      true,
      NO_CAL,
      'm',
    );
    expect(segs).toHaveLength(1);
  });
});

describe('computeSegments - degenerate / corrupt input', () => {
  it('handles two identical points (zero-length edge)', () => {
    const pts: Point[] = [{ x: 5, y: 5 }, { x: 5, y: 5 }];
    const segs = computeSegments(pts, false, NO_CAL, 'm');
    expect(segs).toHaveLength(1);
    expect(segs[0].pixelLength).toBe(0);
    expect(segs[0].displayLength).toBe(0);
    expect(segs[0].formatted).toBe('0 px');
  });

  it('handles NaN coordinates without producing "NaN" in the formatted string', () => {
    const pts: Point[] = [{ x: NaN, y: 0 }, { x: 10, y: 0 }];
    const segs = computeSegments(pts, false, NO_CAL, 'm');
    expect(segs).toHaveLength(1);
    // distance() returns 0 for non-finite — and our fallback fixes pixelLength to 0.
    expect(segs[0].pixelLength).toBe(0);
    expect(segs[0].formatted).toBe('0 px');
    expect(segs[0].formatted).not.toContain('NaN');
  });

  it('handles Infinity scaleFactor without crashing or printing "Infinity"', () => {
    const corruptCal: Calibration = { ...calM, scaleFactor: Infinity };
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const segs = computeSegments(pts, false, corruptCal, 'm');
    expect(segs).toHaveLength(1);
    // The guard (Number.isFinite check) should kick in and route to the
    // pixel fallback rather than producing "Infinity m".
    expect(segs[0].formatted).not.toContain('Infinity');
  });

  it('handles NaN scaleFactor by routing to pixel fallback', () => {
    const corruptCal: Calibration = { ...calM, scaleFactor: NaN };
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const segs = computeSegments(pts, false, corruptCal, 'm');
    expect(segs[0].formatted).not.toContain('NaN');
    expect(segs[0].formatted).toBe('100 px');
  });

  it('handles negative or zero scaleFactor by routing to pixel fallback', () => {
    const zeroCal: Calibration = { ...calM, scaleFactor: 0 };
    const negCal: Calibration = { ...calM, scaleFactor: -0.01 };
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(computeSegments(pts, false, zeroCal, 'm')[0].formatted).toBe('100 px');
    expect(computeSegments(pts, false, negCal, 'm')[0].formatted).toBe('100 px');
  });
});

describe('computeSegments - real-world geometry (square → rectangle)', () => {
  // The exact scenario the user wants: take a square, stretch right edge
  // perpendicularly, the perimeter should be the new rectangle's perimeter.
  it('square 10x10 has 4 segments of length 10 each', () => {
    const square: Point[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const segs = computeSegments(square, true, NO_CAL, 'm');
    for (const s of segs) {
      expect(s.pixelLength).toBeCloseTo(10, 5);
    }
    const total = segs.reduce((acc, s) => acc + s.displayLength, 0);
    expect(total).toBeCloseTo(40, 5); // perimeter
  });

  it('rectangle 15x10 has alternating segment lengths', () => {
    const rect: Point[] = [
      { x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 10 }, { x: 0, y: 10 },
    ];
    const segs = computeSegments(rect, true, NO_CAL, 'm');
    expect(segs[0].pixelLength).toBeCloseTo(15, 5); // bottom
    expect(segs[1].pixelLength).toBeCloseTo(10, 5); // right
    expect(segs[2].pixelLength).toBeCloseTo(15, 5); // top
    expect(segs[3].pixelLength).toBeCloseTo(10, 5); // closing (left)
    const total = segs.reduce((acc, s) => acc + s.displayLength, 0);
    expect(total).toBeCloseTo(50, 5);
  });

  it('triangle 3-4-5 right triangle has perimeter 12', () => {
    const tri: Point[] = [
      { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 },
    ];
    const segs = computeSegments(tri, true, NO_CAL, 'm');
    expect(segs).toHaveLength(3);
    expect(segs[0].pixelLength).toBeCloseTo(3, 5);
    expect(segs[1].pixelLength).toBeCloseTo(5, 5); // hypotenuse
    expect(segs[2].pixelLength).toBeCloseTo(4, 5);
    const total = segs.reduce((acc, s) => acc + s.displayLength, 0);
    expect(total).toBeCloseTo(12, 5);
  });
});

describe('convertUnit - sanity', () => {
  it('returns same value when units match', () => {
    expect(convertUnit(5, 'm', 'm')).toBe(5);
  });
  it('m to ft', () => {
    expect(convertUnit(1, 'm', 'ft')).toBeCloseTo(3.2808, 3);
  });
  it('cm to m', () => {
    expect(convertUnit(100, 'cm', 'm')).toBeCloseTo(1, 5);
  });
  it('returns input unchanged for unknown unit', () => {
    expect(convertUnit(5, 'parsec', 'm')).toBe(5);
  });
});

describe('getUnitLabel', () => {
  it('returns expected labels', () => {
    expect(getUnitLabel('m')).toBe('m');
    expect(getUnitLabel('ft')).toBe('ft');
    expect(getUnitLabel('mm')).toBe('mm');
  });
  it('falls back to input for unknown unit', () => {
    expect(getUnitLabel('xyz')).toBe('xyz');
  });
});

describe('formatMeasurement - regression', () => {
  it('angle uses degrees', () => {
    expect(formatMeasurement(45.5, 'm', 'angle')).toMatch(/45\.5°/);
  });
  it('count rounds to integer', () => {
    expect(formatMeasurement(3.7, 'm', 'count')).toBe('4');
  });
  it('area uses squared unit', () => {
    expect(formatMeasurement(12.34, 'm', 'area')).toBe('12.34 m²');
  });
  it('distance / perimeter uses linear unit', () => {
    expect(formatMeasurement(12.34, 'm', 'distance')).toBe('12.34 m');
    expect(formatMeasurement(12.34, 'm', 'perimeter')).toBe('12.34 m');
  });
});

describe('defaultMeasurementLabel', () => {
  it('uses French labels by type', () => {
    expect(defaultMeasurementLabel('distance', 0)).toBe('Distance 1');
    expect(defaultMeasurementLabel('area', 2)).toBe('Aire 3');
    expect(defaultMeasurementLabel('perimeter', 0)).toBe('Périmètre 1');
    expect(defaultMeasurementLabel('polyline', 0)).toBe('Polyligne 1');
  });
  it('falls back to type for unknown', () => {
    expect(defaultMeasurementLabel('mystery', 0)).toBe('mystery 1');
  });
});
