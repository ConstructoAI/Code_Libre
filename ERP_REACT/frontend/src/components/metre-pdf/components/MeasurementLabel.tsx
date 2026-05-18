import React, { useMemo } from 'react';
import type { Measurement } from '../types';
import { formatMeasurement } from '../utils/format';
import { centroid } from '../utils/geometry';

interface MeasurementLabelProps {
  measurement: Measurement;
  zoom: number;
  /** Offset in page coordinates to avoid overlap. */
  offsetY?: number;
}

/**
 * Renders a formatted measurement label at the centroid of the
 * measurement's points. Drawn as an SVG foreign object or
 * absolutely positioned HTML — consumers decide the approach.
 *
 * This component returns a positioned <div> meant to be placed
 * inside a container with `position: relative` that covers the
 * PDF page at 1:1 scale.
 */
export const MeasurementLabel: React.FC<MeasurementLabelProps> = ({
  measurement,
  zoom,
  offsetY = -20,
}) => {
  const pos = useMemo(() => {
    if (measurement.points.length === 0) return { x: 0, y: 0 };

    if (measurement.type === 'distance' && measurement.points.length === 2) {
      // Place label at midpoint of line
      const [p1, p2] = measurement.points;
      return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    }

    if (measurement.type === 'angle' && measurement.points.length === 3) {
      // Place near the vertex
      return { x: measurement.points[1].x, y: measurement.points[1].y };
    }

    return centroid(measurement.points);
  }, [measurement.points, measurement.type]);

  const text = formatMeasurement(
    measurement.value,
    measurement.unit,
    measurement.type,
  );

  // Scale font inversely with zoom so labels remain readable
  const fontSize = Math.max(10, 12 / zoom);
  const padding = Math.max(2, 4 / zoom);

  return (
    <div
      className="pointer-events-none absolute whitespace-nowrap"
      style={{
        left: pos.x,
        top: pos.y + offsetY / zoom,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <span
        className="inline-block rounded-md font-medium shadow-md"
        style={{
          backgroundColor: measurement.color,
          color: '#fff',
          fontSize: `${fontSize}px`,
          padding: `${padding}px ${padding * 2}px`,
          lineHeight: 1.3,
        }}
      >
        {text}
      </span>
    </div>
  );
};
