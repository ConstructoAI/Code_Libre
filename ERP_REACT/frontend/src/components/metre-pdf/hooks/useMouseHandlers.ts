import { useCallback, useRef, useState } from 'react';
import type { Point, Measurement, MeasurementType } from '../types';
import { useMetreStore } from '../store';
import { useProjectStore } from '../store';
import {
  distance as calcDistance,
  polygonArea,
  polygonPerimeter,
  angleBetween,
  snapToAngle,
} from '../utils/geometry';
import { findNearestSnapPoint } from '../utils/snap';
import { defaultMeasurementLabel } from '../utils/format';

interface UseMouseHandlersOptions {
  /** Callback after calibration line is drawn (pixel length passed). */
  onCalibrationLine?: (pixelLength: number, points: [Point, Point]) => void;
}

interface MouseHandlers {
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleDoubleClick: (e: React.MouseEvent) => void;
  handleContextMenu: (e: React.MouseEvent) => void;
  /** Preview point following the cursor (for rubber-band rendering). */
  previewPoint: Point | null;
}

/**
 * Provides mouse event handlers for the measurement canvas.
 * Reads from and writes to the unified metre store.
 */
export function useMouseHandlers(
  options: UseMouseHandlersOptions = {},
): MouseHandlers {
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);
  const panStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  /* ── resolve cursor position to a page-coordinate Point ──── */

  const resolvePoint = useCallback(
    (e: React.MouseEvent): Point => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      let pagePoint = useMetreStore.getState().screenToPage(screenX, screenY);

      const store = useMetreStore.getState();

      // Apply snap
      if (store.snapEnabled && store.snapPoints.length > 0) {
        const snap = findNearestSnapPoint(
          pagePoint,
          store.snapPoints,
          15 / store.viewState.zoom,
        );
        if (snap) {
          pagePoint = { x: snap.x, y: snap.y };
          useMetreStore.getState().setActiveSnapPoint(snap);
        } else {
          useMetreStore.getState().setActiveSnapPoint(null);
        }
      }

      // Apply ortho constraint:
      // - Shift key held -> 15 deg angle snapping
      // - orthoEnabled toggle (O key) -> 45 deg angle snapping
      if (store.currentPoints.length > 0) {
        const lastPt = store.currentPoints[store.currentPoints.length - 1];
        if (e.shiftKey) {
          pagePoint = snapToAngle(lastPt, pagePoint, 15);
        } else if (store.orthoEnabled) {
          pagePoint = snapToAngle(lastPt, pagePoint, 45);
        }
      }

      return pagePoint;
    },
    [],
  );

  /* ── create a completed measurement ───────────────────────── */

  const finalizeMeasurement = useCallback(
    (type: MeasurementType, points: Point[]) => {
      const store = useMetreStore.getState();
      const { calibration, measurements, activeLayerId } = store;
      const { currentDocument, currentPage } = useProjectStore.getState();

      const scaleFactor = calibration?.scaleFactor ?? 1;
      const unit = calibration?.unit ?? 'm';

      let value = 0;
      switch (type) {
        case 'distance':
          value = calcDistance(points[0], points[1]) * scaleFactor;
          break;
        case 'area':
          value = polygonArea(points) * scaleFactor * scaleFactor;
          break;
        case 'perimeter':
          value = polygonPerimeter(points) * scaleFactor;
          break;
        case 'angle':
          value = angleBetween(points[0], points[1], points[2]);
          break;
        case 'count':
          // Count increments are handled differently
          value = 1;
          break;
      }

      const countOfType = measurements.filter((m) => m.type === type).length;

      const measurement: Measurement = {
        id: crypto.randomUUID(),
        documentId: currentDocument?.id ?? '',
        pageNumber: currentPage,
        type,
        label: defaultMeasurementLabel(type, countOfType),
        value,
        unit,
        points: [...points],
        color: getDefaultColor(type),
        layer: activeLayerId ?? 'default',
        createdAt: new Date().toISOString(),
      };

      useMetreStore.getState().addMeasurement(measurement);
      useMetreStore.getState().clearPoints();
    },
    [],
  );

  /* ── mouse down / click ──────────────────────────────────── */

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // left click only

      const { activeTool, currentPoints } = useMetreStore.getState();

      // Pan tool
      if (activeTool === 'pan') {
        const { viewState } = useMetreStore.getState();
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          ox: viewState.offsetX,
          oy: viewState.offsetY,
        };
        return;
      }

      // Select tool
      if (activeTool === 'select') {
        // Selection logic handled at the component level
        return;
      }

      const point = resolvePoint(e);

      // Calibrate tool: 2 clicks
      if (activeTool === 'calibrate') {
        useMetreStore.getState().addPoint(point);
        if (currentPoints.length === 1) {
          const p1 = currentPoints[0];
          const pixelLen = calcDistance(p1, point);
          useMetreStore.getState().clearPoints();
          options.onCalibrationLine?.(pixelLen, [p1, point]);
        }
        return;
      }

      // Distance tool: 2 clicks
      if (activeTool === 'distance') {
        useMetreStore.getState().addPoint(point);
        if (currentPoints.length === 1) {
          finalizeMeasurement('distance', [currentPoints[0], point]);
        }
        return;
      }

      // Angle tool: 3 clicks (p1, vertex, p2)
      if (activeTool === 'angle') {
        useMetreStore.getState().addPoint(point);
        if (currentPoints.length === 2) {
          finalizeMeasurement('angle', [currentPoints[0], currentPoints[1], point]);
        }
        return;
      }

      // Count tool: incremental counting (each click adds a point)
      if (activeTool === 'count') {
        useMetreStore.getState().incrementCount(point);
        return;
      }

      // Area / Perimeter: multi-click, completed by double-click
      if (activeTool === 'area' || activeTool === 'perimeter') {
        useMetreStore.getState().addPoint(point);
        return;
      }
    },
    [resolvePoint, finalizeMeasurement, options],
  );

  /* ── mouse move ──────────────────────────────────────────── */

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { activeTool } = useMetreStore.getState();

      // Pan drag
      if (activeTool === 'pan' && panStartRef.current && e.buttons === 1) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        useMetreStore.getState().setOffset({
          x: panStartRef.current.ox + dx,
          y: panStartRef.current.oy + dy,
        });
        return;
      }

      if (panStartRef.current && e.buttons === 0) {
        panStartRef.current = null;
      }

      const point = resolvePoint(e);
      useMetreStore.getState().setMousePosition(point);

      // Show preview point for rubber-band while drawing
      const { isDrawing } = useMetreStore.getState();
      if (isDrawing) {
        setPreviewPoint(point);
      } else {
        setPreviewPoint(null);
      }
    },
    [resolvePoint],
  );

  /* ── double click (complete polygon) ─────────────────────── */

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const { activeTool, currentPoints } = useMetreStore.getState();

      if (activeTool === 'area' && currentPoints.length >= 3) {
        finalizeMeasurement('area', currentPoints);
        setPreviewPoint(null);
        return;
      }

      if (activeTool === 'perimeter' && currentPoints.length >= 2) {
        finalizeMeasurement('perimeter', currentPoints);
        setPreviewPoint(null);
        return;
      }
    },
    [finalizeMeasurement],
  );

  /* ── right click (cancel) ────────────────────────────────── */

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const { isDrawing } = useMetreStore.getState();
      if (isDrawing) {
        useMetreStore.getState().clearPoints();
        setPreviewPoint(null);
      }
    },
    [],
  );

  return {
    handleMouseDown,
    handleMouseMove,
    handleDoubleClick,
    handleContextMenu,
    previewPoint,
  };
}

/* ── helpers ────────────────────────────────────────────────── */

function getDefaultColor(type: string): string {
  const colors: Record<string, string> = {
    distance: '#3b82f6', // blue
    area: '#10b981', // green
    perimeter: '#f59e0b', // amber
    angle: '#8b5cf6', // violet
    count: '#ef4444', // red
  };
  return colors[type] ?? '#6b7280';
}
