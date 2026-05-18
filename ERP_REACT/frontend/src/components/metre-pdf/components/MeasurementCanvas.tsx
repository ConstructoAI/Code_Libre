import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { Canvas as FabricCanvas, Line, Circle, Rect } from 'fabric';
import { useMetreStore } from '../store';
import { useCanvasState } from '../hooks/useCanvasState';
import { snapToAngle, findAxisAlignment } from '../utils/geometry';
import { generateAllSnapPoints, findNearestSnapPoint } from '../utils/snap';
import {
  createMeasurementObjects,
  createAIDetectionObjects,
  findMeasurementAtPoint as findMeasurementAtPointUtil,
} from '../utils/measurementRendering';
import { buildDrawingPreview } from '../utils/drawingPreview';
import { hasEdgeMidpoints, isClosedShape } from '../utils/format';
import MurInput from './MurInput';
import {
  parseImperialInput,
  directionToDelta,
  angleToDelta,
  snapAngle15,
  angleFromPoints,
  ARROW_KEY_MAP,
  type DrawDirection,
} from '../utils/imperialInput';
import type { Measurement, Point, MeasurementType, MeasurementUnit, Tool } from '../types';

/**
 * Transparent Fabric.js overlay canvas for drawing and displaying measurements.
 * Stays perfectly synchronized with the PDF canvas underneath.
 */
export default function MeasurementCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const interactiveRef = useRef<HTMLDivElement>(null);

  const {
    viewState,
    activeTool, setActiveTool,
    measurements, addMeasurement,
    layers, currentPage, activeLayerId,
    selectedMeasurementIds,
    setSelectedMeasurementId, toggleMeasurementSelection, setSelectedMeasurementIds,
    drawingPoints, addDrawingPoint, clearDrawing,
    calibration, setLiveMeasurementValue,
    orthoEnabled, toggleOrtho,
    gridEnabled, toggleGrid,
    snapEnabled, setSnapPoints,
    pdfDocument,
  } = useCanvasState();

  // PHASE 1: subscribe to AI detection overlays so the canvas rebuilds when
  // they change (new run, accept/reject status updates, page switch). The
  // shared `useCanvasState` hook does not expose this slice, so we subscribe
  // to the store directly here.
  const aiDetections = useMetreStore((s) => s.aiDetections);

  // Regenerate snap points when measurements or page changes
  useEffect(() => {
    if (!snapEnabled) {
      setSnapPoints([]);
      useMetreStore.getState().setActiveSnapType(null);
      return;
    }
    const pageMeasurements = measurements.filter((m) => m.pageNumber === currentPage);
    const snaps = generateAllSnapPoints(pageMeasurements);
    setSnapPoints(snaps);
  }, [measurements, currentPage, snapEnabled, setSnapPoints]);

  // Mouse position for rubber-band preview
  const mousePosRef = useRef<Point>({ x: 0, y: 0 });
  const previewObjectsRef = useRef<any[]>([]);

  // RAF throttle ref for mousemove preview redraws
  const rafRef = useRef<number>(0);

  // Panning state (for middle-click / right-click / space+drag during drawing)
  const isPanningRef = useRef(false);
  const lastPanPosRef = useRef({ x: 0, y: 0 });
  const spaceHeldRef = useRef(false);

  // Dragging state (for moving individual measurement points)
  const draggingInfoRef = useRef<{ measurementId: string; pointIndex: number } | null>(null);
  // Edge-midpoint stretch state. Captures both endpoints' initial position
  // and the perpendicular unit vector at mousedown so subsequent moves can
  // project the cursor delta onto that perpendicular (default constraint)
  // or apply it freely when Shift is held.
  const draggingMidpointRef = useRef<{
    measurementId: string;
    pointAIndex: number;
    pointBIndex: number;
    startMouse: Point;
    startA: Point;
    startB: Point;
    perpX: number;
    perpY: number;
  } | null>(null);
  // Axis-alignment guide overlay objects (dashed Fabric Lines). Tracked so we
  // can clear them at drag end without scanning the whole canvas. The rebuild
  // useEffect re-creates them from `currentAlignmentRef` on each mousemove.
  const alignmentGuidesRef = useRef<any[]>([]);
  // Snapshot of the current alignment state during a drag — read by the
  // rebuild useEffect to draw dashed guide lines through the snapped point
  // and the reference points it aligned to.
  const currentAlignmentRef = useRef<{
    snappedPt: Point;
    refX?: Point;
    refY?: Point;
  } | null>(null);
  // Green-diamond snap-to-point indicator drawn when the cursor is locked
  // exactly onto an existing endpoint / midpoint / intersection during a
  // drag. Tracked so we can pull it off the canvas at mouseup, since the
  // store flag (`activeSnapPoint`) lives outside of the rebuild deps.
  const pointSnapMarkerRef = useRef<any[]>([]);
  const wasDraggingRef = useRef(false);

  // Moving state (for translating all selected measurements together)
  const movingInfoRef = useRef<{ lastPoint: Point } | null>(null);

  // Freehand drawing state (mouse-drag to draw continuously)
  const isFreehandDrawingRef = useRef(false);

  // Marquee selection state (rubber-band rectangle in select mode)
  const marqueeStartRef = useRef<Point | null>(null);
  const isMarqueeActiveRef = useRef(false);
  const marqueeRectRef = useRef<any>(null);

  // Numeric input state (Tab to type exact distance during drawing)
  const [showNumericInput, setShowNumericInput] = useState(false);
  const [numericInputValue, setNumericInputValue] = useState('');

  // Mur state (keyboard-driven imperial measurement entry)
  const [showMurInput, setShowMurInput] = useState(false);
  const [murInputValue, setMurInputValue] = useState('');
  const [murDirection, setMurDirection] = useState<DrawDirection | null>(null);
  const [murAngle, setMurAngle] = useState<number | null>(null);

  // Reset mur state when tool changes away from mur
  useEffect(() => {
    if (activeTool !== 'mur') {
      setShowMurInput(false);
      setMurInputValue('');
      setMurDirection(null);
      setMurAngle(null);
    }
  }, [activeTool]);
  const numericInputRef = useRef<HTMLInputElement>(null);

  // Determine if this layer should capture pointer events
  // Enable for select tool (click-to-select measurements) and all drawing tools
  // Disable when no document is loaded so the upload UI remains clickable
  const isDrawingTool = !!pdfDocument && !['pan'].includes(activeTool);

  // Track spacebar for space+drag pan
  useEffect(() => {
    const isInputFocused = () => {
      const tag = document.activeElement?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (document.activeElement as HTMLElement)?.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isInputFocused()) {
        spaceHeldRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false;
        isPanningRef.current = false;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Visible layers set
  const visibleLayerIds = useMemo(
    () => new Set(layers.filter((l) => l.visible).map((l) => l.id)),
    [layers]
  );

  // Layer color map
  const layerColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    layers.forEach((l) => {
      map[l.id] = l.color;
    });
    return map;
  }, [layers]);

  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const fc = new FabricCanvas(canvasRef.current, {
      selection: false,
      renderOnAddRemove: false,
      backgroundColor: 'transparent',
      skipTargetFind: true,
    });

    fc.hoverCursor = 'default';
    fc.moveCursor = 'default';

    // Disable Fabric's upper-canvas event interception so React handlers work
    const upperEl = (fc as any).upperCanvasEl || (fc as any).wrapperEl?.querySelector('.upper-canvas');
    if (upperEl) {
      upperEl.style.pointerEvents = 'none';
    }

    fabricRef.current = fc;

    return () => {
      fc.dispose();
      fabricRef.current = null;
    };
  }, []);

  // Sync canvas size with PDF canvas
  useEffect(() => {
    const syncSize = () => {
      const pdfCanvas = document.getElementById('pdf-canvas') as HTMLCanvasElement | null;
      const fc = fabricRef.current;
      if (!pdfCanvas || !fc) return;

      const w = parseFloat(pdfCanvas.style.width) || pdfCanvas.offsetWidth;
      const h = parseFloat(pdfCanvas.style.height) || pdfCanvas.offsetHeight;

      if (w > 0 && h > 0) {
        fc.setDimensions({ width: w, height: h });
        fc.renderAll();
      }
    };

    // Use mutation observer on PDF canvas
    const pdfCanvas = document.getElementById('pdf-canvas');
    if (pdfCanvas) {
      const observer = new MutationObserver(syncSize);
      observer.observe(pdfCanvas, {
        attributes: true,
        attributeFilter: ['width', 'height', 'style'],
      });
      syncSize();
      return () => observer.disconnect();
    }
  }, [viewState.zoom, viewState.rotation, currentPage]);

  // Render measurements onto Fabric canvas (structural rebuild)
  // Triggers on: measurement data changes, page change, layer visibility, zoom
  // Objects are rendered at display coordinates (page coords * zoom) with identity viewport transform
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    fc.clear();

    const selIds = new Set(useMetreStore.getState().selectedMeasurementIds);
    const currentZoom = useMetreStore.getState().viewState.zoom;

    const filteredMeasurements = measurements.filter(
      (m) => m.pageNumber === currentPage && visibleLayerIds.has(m.layer)
    );

    // Sort by layer draw order, then by zOrder within each layer
    const layerOrder = new Map(layers.map((l, i) => [l.id, i]));
    const pageMeasurements = filteredMeasurements.sort((a, b) => {
      const layerDiff = (layerOrder.get(a.layer) ?? 0) - (layerOrder.get(b.layer) ?? 0);
      if (layerDiff !== 0) return layerDiff;
      return (a.zOrder ?? 0) - (b.zOrder ?? 0);
    });

    // Per-segment dimension labels are reserved for the single-selection
    // case so the canvas stays readable on multi-select, and so the canvas
    // matches the RightPanel which only shows the SEGMENTS section for a
    // single selected measurement (mirrors the drag-handle policy).
    const isSingleSelection = selIds.size === 1;

    pageMeasurements.forEach((m) => {
      const color = m.color || layerColorMap[m.layer] || '#3b82f6';
      const isSelected = selIds.has(m.id);
      const baseStroke = m.strokeWidth ?? 2;
      const strokeWidth = isSelected ? baseStroke + 1 : baseStroke;
      const opacity = (m.opacity ?? 1) * (isSelected ? 1 : 0.85);

      const objects = createMeasurementObjects(m, color, strokeWidth, opacity, currentZoom, {
        isSelected: isSelected && isSingleSelection,
        calibration,
      });
      objects.forEach((obj) => {
        obj.set({
          selectable: false,
          evented: false,
          data: { measurementId: m.id },
        });
        fc.add(obj);
      });
    });

    // Render AI detection overlays (status='pending' only) on top of measurements.
    // Round 15 CRITICAL fix: ERP_REACT historical convention is 1-based pageNumber
    // (CalibrationModal stores pageNumber=currentPage as-is, see store.ts:917).
    // Round 6 had wrongly assumed backend was 0-based, causing "Calibration
    // requise pour page 0" error when user calibrated page 1.
    // ALL pageNumber values are 1-based (calibrations, measurements, AI detections).
    aiDetections
      .filter((d) => d.pageNumber === currentPage && d.status === 'pending')
      .forEach((det) => {
        const aiObjects = createAIDetectionObjects(det, currentZoom);
        aiObjects.forEach((obj) => {
          obj.set({
            selectable: false,
            evented: false,
            data: { aiDetectionId: det.id, isAIOverlay: true },
          });
          fc.add(obj);
        });
      });

    // Draw drag handles for the primary selected measurement only (single-drag)
    const primarySelId = useMetreStore.getState().selectedMeasurementId;
    if (primarySelId && selIds.size === 1) {
      const selMeasurement = pageMeasurements.find((m) => m.id === primarySelId);
      if (selMeasurement) {
        // Edge-midpoint stretch handles, drawn FIRST so corner handles
        // (drawn next) overlap them when an edge is degenerate. Square
        // markers visually distinguish midpoints from circular corner
        // handles. Default drag = perpendicular stretch; Shift = free 2D.
        if (hasEdgeMidpoints(selMeasurement.type) && selMeasurement.points.length >= 2) {
          const closed = isClosedShape(selMeasurement.type);
          const n = selMeasurement.points.length;
          const limit = closed && n >= 3 ? n : n - 1;
          for (let i = 0; i < limit; i++) {
            const a = selMeasurement.points[i];
            const b = selMeasurement.points[(i + 1) % n];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            // Skip degenerate segments — no useful midpoint to grab.
            if (dx * dx + dy * dy < 1) continue;
            const midX = ((a.x + b.x) / 2) * currentZoom;
            const midY = ((a.y + b.y) / 2) * currentZoom;
            const mid = new Rect({
              left: midX - 4,
              top: midY - 4,
              width: 8,
              height: 8,
              fill: '#ffffff',
              stroke: '#3b82f6',
              strokeWidth: 1.5,
              selectable: false,
              evented: false,
            });
            fc.add(mid);
          }
        }

        selMeasurement.points.forEach((p) => {
          const hp = { x: p.x * currentZoom, y: p.y * currentZoom };
          const handle = new Circle({
            left: hp.x - 6,
            top: hp.y - 6,
            radius: 6,
            fill: '#ffffff',
            stroke: '#3b82f6',
            strokeWidth: 2,
            selectable: false,
            evented: false,
          });
          fc.add(handle);
        });
      }
    }

    // Draw grid overlay
    if (gridEnabled) {
      const canvasW = fc.getWidth();
      const canvasH = fc.getHeight();

      // Calculate grid spacing in display pixels
      let spacingPx = 50; // default
      if (calibration && calibration.scaleFactor > 0) {
        // scaleFactor = real-world units per pixel → invert to get pixels per unit
        const pxPerUnit = 1 / calibration.scaleFactor;
        spacingPx = pxPerUnit * currentZoom;
        // Ensure spacing is visible (at least 20px)
        while (spacingPx < 20) spacingPx *= 2;
        while (spacingPx > 200) spacingPx /= 2;
      }

      // Vertical lines
      for (let x = spacingPx; x < canvasW; x += spacingPx) {
        const line = new Line([x, 0, x, canvasH], {
          stroke: '#6b7280',
          strokeWidth: 0.5,
          opacity: 0.15,
          selectable: false,
          evented: false,
        });
        fc.add(line);
      }

      // Horizontal lines
      for (let y = spacingPx; y < canvasH; y += spacingPx) {
        const line = new Line([0, y, canvasW, y], {
          stroke: '#6b7280',
          strokeWidth: 0.5,
          opacity: 0.15,
          selectable: false,
          evented: false,
        });
        fc.add(line);
      }
    }

    // Magnetic alignment guides — dashed lines extended a bit past the
    // dragged point and the reference point on each active axis. Drawn
    // last so they sit above the polygon outlines and the handles, like
    // SketchUp / Figma alignment indicators. fc.clear() at the top of
    // this effect already wiped the previous guides; we now repopulate
    // alignmentGuidesRef so handleMouseUp can clear them on its own
    // outside of a useEffect rebuild.
    alignmentGuidesRef.current = [];
    const alignState = currentAlignmentRef.current;
    if (alignState) {
      const sp = alignState.snappedPt;
      // Cyan rather than blue so the guides stand out against the default
      // blue measurement color (`#3b82f6`); a thin dashed line in the
      // measurement palette would otherwise look like just another edge.
      const guideStyle = {
        stroke: '#06b6d4',
        strokeWidth: 0.8,
        strokeDashArray: [4, 4],
        opacity: 0.9,
        selectable: false,
        evented: false,
      };
      const PAD = 24; // page-units padding past the extreme points
      if (alignState.refX) {
        // Vertical guide at x = sp.x = refX.x
        const minY = Math.min(alignState.refX.y, sp.y) - PAD;
        const maxY = Math.max(alignState.refX.y, sp.y) + PAD;
        const guide = new Line(
          [sp.x * currentZoom, minY * currentZoom, sp.x * currentZoom, maxY * currentZoom],
          guideStyle,
        );
        fc.add(guide);
        alignmentGuidesRef.current.push(guide);
      }
      if (alignState.refY) {
        // Horizontal guide at y = sp.y = refY.y
        const minX = Math.min(alignState.refY.x, sp.x) - PAD;
        const maxX = Math.max(alignState.refY.x, sp.x) + PAD;
        const guide = new Line(
          [minX * currentZoom, sp.y * currentZoom, maxX * currentZoom, sp.y * currentZoom],
          guideStyle,
        );
        fc.add(guide);
        alignmentGuidesRef.current.push(guide);
      }
    }

    // Snap-to-point marker — same green diamond + ring used by the drawing
    // mode preview. Drawn last so it sits above measurements, alignment
    // guides, and handles. Pulled from store state so the rebuild and the
    // drawing path stay in sync (single source of truth for "snap is
    // engaged"). Tracked for explicit cleanup at mouseup since the store
    // toggle is not part of this useEffect's dependency list.
    pointSnapMarkerRef.current = [];
    const activeSnap = useMetreStore.getState().activeSnapPoint;
    if (activeSnap) {
      const sx = activeSnap.x * currentZoom;
      const sy = activeSnap.y * currentZoom;
      const SZ = 8;
      const items = [
        new Line([sx - SZ, sy, sx + SZ, sy], {
          stroke: '#22c55e', strokeWidth: 2, selectable: false, evented: false,
        }),
        new Line([sx, sy - SZ, sx, sy + SZ], {
          stroke: '#22c55e', strokeWidth: 2, selectable: false, evented: false,
        }),
        new Circle({
          left: sx - SZ, top: sy - SZ, radius: SZ,
          fill: 'transparent', stroke: '#22c55e', strokeWidth: 1.5,
          selectable: false, evented: false,
        }),
      ];
      for (const item of items) fc.add(item);
      pointSnapMarkerRef.current = items;
    }

    // Identity viewport transform — zoom is already baked into object coordinates
    fc.setViewportTransform([1, 0, 0, 1, 0, 0]);

    fc.renderAll();
  }, [measurements, currentPage, visibleLayerIds, layerColorMap, layers, viewState.zoom, selectedMeasurementIds, gridEnabled, calibration, aiDetections]);

  // Zoom effect — zoom is now handled by rebuilding objects at zoomed coordinates
  // (triggered by viewState.zoom in the measurement render effect above).
  // We keep the viewport transform as identity.
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    fc.setViewportTransform([1, 0, 0, 1, 0, 0]);
    fc.renderAll();
  }, [viewState.zoom]);

  // Selection highlight effect (lightweight — only updates stroke/opacity, no rebuild)
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    const selSet = new Set(selectedMeasurementIds);
    fc.forEachObject((obj: any) => {
      const mid = obj.data?.measurementId;
      if (!mid) return;
      const isSelected = selSet.has(mid);
      obj.set({
        strokeWidth: isSelected ? 3 : 2,
        opacity: isSelected ? 1 : 0.85,
      });
    });
    fc.renderAll();
  }, [selectedMeasurementIds]);

  // Exact snap-to-point — locks the cursor onto an existing endpoint /
  // midpoint / intersection when within `15 / zoom` page-units. Reuses
  // the same store-driven indicator that drawing mode uses (green
  // diamond + ring) so the visual feedback is identical between drawing
  // and editing. Caller passes the CURRENT positions of the points being
  // moved (corner being dragged, or both endpoints + midpoint of the
  // edge being stretched) so the helper can filter them out and avoid
  // self-snap during the drag.
  const applyPointSnap = useCallback(
    (rawPt: Point, excludedPositions: Point[]): { pt: Point; snapped: boolean } => {
      const state = useMetreStore.getState();
      if (!state.snapEnabled || state.snapPoints.length === 0) {
        if (state.activeSnapPoint !== null) state.setActiveSnapPoint(null);
        if (state.activeSnapType !== null) state.setActiveSnapType(null);
        return { pt: rawPt, snapped: false };
      }
      const tolerance = 15 / state.viewState.zoom;
      const EPS = 0.5;
      const filtered = state.snapPoints.filter((sp) => {
        for (const ex of excludedPositions) {
          if (Math.abs(sp.x - ex.x) < EPS && Math.abs(sp.y - ex.y) < EPS) return false;
        }
        return true;
      });
      const snap = findNearestSnapPoint(rawPt, filtered, tolerance);
      if (snap) {
        state.setActiveSnapPoint(snap);
        state.setActiveSnapType(snap.type);
        return { pt: { x: snap.x, y: snap.y }, snapped: true };
      }
      if (state.activeSnapPoint !== null) state.setActiveSnapPoint(null);
      if (state.activeSnapType !== null) state.setActiveSnapType(null);
      return { pt: rawPt, snapped: false };
    },
    [],
  );

  // Magnetic axis-alignment snap — pulls a candidate page point onto the X
  // or Y of any other visible point on the current page, when the global
  // snap toggle is enabled. Returns the (possibly modified) point and
  // updates `currentAlignmentRef` so the rebuild useEffect can draw dashed
  // guide lines.
  //
  // The caller passes the indices of points that must be EXCLUDED from
  // candidate matching: the corner being dragged, or the two endpoints of
  // the edge being stretched. Without this exclusion the cursor would
  // happily snap to itself and freeze the drag. Points belonging to a
  // hidden layer are also filtered out so a decluttered view does not
  // ghost-snap to invisible geometry.
  //
  // `snapOptions.allowX` / `allowY` lets midpoint stretching restrict the
  // snap to the axis that the perpendicular projection can actually move:
  // a Y-snap on a horizontal-perp drag would otherwise show a guide line
  // that the projection silently absorbs, leaving the user staring at an
  // alignment indicator that does not match the resulting geometry.
  const applyAlignmentSnap = useCallback(
    (
      rawPt: Point,
      ownerMeasurementId: string,
      excludeIndices: number[],
      snapOptions?: { allowX?: boolean; allowY?: boolean },
    ): Point => {
      const state = useMetreStore.getState();
      if (!state.snapEnabled) {
        currentAlignmentRef.current = null;
        return rawPt;
      }
      const tolerance = 8 / state.viewState.zoom;
      const excludeSet = new Set(excludeIndices.map((i) => `${ownerMeasurementId}:${i}`));
      const candidates: Point[] = [];
      for (const mm of state.measurements) {
        if (mm.pageNumber !== state.currentPage) continue;
        if (!visibleLayerIds.has(mm.layer)) continue;
        if (!mm.points) continue;
        for (let pi = 0; pi < mm.points.length; pi++) {
          if (excludeSet.has(`${mm.id}:${pi}`)) continue;
          candidates.push(mm.points[pi]);
        }
      }
      const align = findAxisAlignment(rawPt, candidates, tolerance, snapOptions);
      let pt = rawPt;
      if (align.snappedX !== undefined) pt = { ...pt, x: align.snappedX };
      if (align.snappedY !== undefined) pt = { ...pt, y: align.snappedY };
      if (align.refX || align.refY) {
        currentAlignmentRef.current = {
          snappedPt: pt,
          refX: align.refX,
          refY: align.refY,
        };
      } else {
        currentAlignmentRef.current = null;
      }
      return pt;
    },
    [visibleLayerIds],
  );

  // Mouse handlers for drawing
  // Returns zoom-independent "page coordinates" by dividing screen pixels by zoom.
  // This ensures measurements stay anchored to the PDF content regardless of zoom level.
  const getCanvasPoint = useCallback(
    (e: React.MouseEvent): Point => {
      const fc = fabricRef.current;
      if (!fc) return { x: 0, y: 0 };
      const el = (fc as any).lowerCanvasEl as HTMLCanvasElement | undefined;
      const rect = el?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const zoom = useMetreStore.getState().viewState.zoom;
      return {
        x: (e.clientX - rect.left) / zoom,
        y: (e.clientY - rect.top) / zoom,
      };
    },
    []
  );

  // Calculate distance in pixels between two points
  const pixelDistance = useCallback((a: Point, b: Point): number => {
    return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  }, []);

  // Convert pixel distance to real-world value
  const toRealWorld = useCallback(
    (pixels: number): number => {
      if (!calibration) return pixels;
      return pixels * calibration.scaleFactor;
    },
    [calibration]
  );

  // Calculate polygon area in pixels squared using Shoelace formula
  const polygonArea = useCallback((points: Point[]): number => {
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
  }, []);

  // Calculate perimeter
  const polygonPerimeter = useCallback((points: Point[]): number => {
    let perim = 0;
    for (let i = 0; i < points.length; i++) {
      const next = points[(i + 1) % points.length];
      perim += pixelDistance(points[i], next);
    }
    return perim;
  }, [pixelDistance]);

  // Calculate angle between three points (vertex at second point)
  const angleBetween = useCallback((a: Point, vertex: Point, c: Point): number => {
    const v1 = { x: a.x - vertex.x, y: a.y - vertex.y };
    const v2 = { x: c.x - vertex.x, y: c.y - vertex.y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const cross = v1.x * v2.y - v1.y * v2.x;
    return Math.abs(Math.atan2(cross, dot) * (180 / Math.PI));
  }, []);

  // Recalculate measurement value from points (used during point dragging)
  const recalculateValue = useCallback(
    (type: MeasurementType, points: Point[]): number => {
      switch (type) {
        case 'distance':
          if (points.length < 2) return 0;
          return toRealWorld(pixelDistance(points[0], points[1]));
        case 'area':
          if (points.length < 3) return 0;
          return toRealWorld(1) ** 2 * polygonArea(points);
        case 'perimeter':
          if (points.length < 3) return 0;
          return toRealWorld(polygonPerimeter(points));
        case 'polyline': {
          if (points.length < 2) return 0;
          let total = 0;
          for (let i = 0; i < points.length - 1; i++) {
            total += pixelDistance(points[i], points[i + 1]);
          }
          return toRealWorld(total);
        }
        case 'angle':
          if (points.length < 3) return 0;
          return angleBetween(points[0], points[1], points[2]);
        case 'dimension':
          if (points.length < 3) return 0;
          return toRealWorld(pixelDistance(points[0], points[1]));
        case 'circle': {
          if (points.length < 2) return 0;
          const radiusPx = pixelDistance(points[0], points[1]);
          return Math.PI * toRealWorld(radiusPx) ** 2;
        }
        case 'count':
          return 1;
        case 'arrow':
          if (points.length < 2) return 0;
          return toRealWorld(pixelDistance(points[0], points[1]));
        case 'cloud':
          if (points.length < 3) return 0;
          return toRealWorld(1) ** 2 * polygonArea(points);
        case 'freehand':
        case 'highlight':
        case 'text':
        case 'note':
        case 'callout':
          return 0;
        default:
          return 0;
      }
    },
    [toRealWorld, pixelDistance, polygonArea, polygonPerimeter, angleBetween]
  );

  // Finalize a measurement
  const finalizeMeasurement = useCallback(
    (type: MeasurementType, points: Point[]) => {
      if (points.length === 0) return;
      const unit: MeasurementUnit = calibration?.unit ?? 'm';
      let value = 0;

      switch (type) {
        case 'distance':
          if (points.length < 2) return;
          value = toRealWorld(pixelDistance(points[0], points[1]));
          break;
        case 'area':
          value = toRealWorld(1) ** 2 * polygonArea(points);
          break;
        case 'perimeter':
          value = toRealWorld(polygonPerimeter(points));
          break;
        case 'polyline': {
          let total = 0;
          for (let i = 0; i < points.length - 1; i++) {
            total += pixelDistance(points[i], points[i + 1]);
          }
          value = toRealWorld(total);
          break;
        }
        case 'angle':
          if (points.length < 3) return;
          value = angleBetween(points[0], points[1], points[2]);
          break;
        case 'dimension':
          if (points.length < 3) return;
          value = toRealWorld(pixelDistance(points[0], points[1]));
          break;
        case 'circle': {
          if (points.length >= 2) {
            const radiusPx = pixelDistance(points[0], points[1]);
            value = Math.PI * toRealWorld(radiusPx) ** 2;
          }
          break;
        }
        case 'count':
          value = 1;
          break;
        case 'arrow':
          if (points.length >= 2) {
            value = toRealWorld(pixelDistance(points[0], points[1]));
          }
          break;
        case 'cloud':
          if (points.length >= 3) {
            value = toRealWorld(1) ** 2 * polygonArea(points);
          }
          break;
        case 'freehand':
        case 'highlight':
        case 'text':
        case 'note':
        case 'callout':
        case 'symbol':
          value = 0;
          break;
      }

      const store = useMetreStore.getState();
      const typeCount = store.measurements.filter((m) => m.type === type).length;
      const label = type === 'symbol'
        ? (store.symbolBlocks.find((b) => b.id === store.activeSymbolBlockId)?.name ?? `Symbole ${typeCount + 1}`)
        : type === 'text' ? 'Texte' : type === 'note' ? 'Note' : type === 'callout' ? 'Texte' :
        (['distance', 'area', 'perimeter', 'polyline', 'angle', 'count', 'dimension'].includes(type)
          ? `${({ distance: 'Distance', area: 'Aire', perimeter: 'Périmètre', polyline: 'Polyligne', angle: 'Angle', count: 'Comptage', dimension: 'Cotation' } as Record<string, string>)[type] ?? type} ${typeCount + 1}`
          : '');

      const m: Measurement = {
        id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        documentId: store.document?.id ?? '',
        pageNumber: currentPage,
        type,
        label,
        value,
        unit,
        points,
        color: type === 'symbol'
          ? (store.symbolBlocks.find((b) => b.id === store.activeSymbolBlockId)?.color ?? layerColorMap[activeLayerId ?? 'default'] ?? '#3b82f6')
          : layerColorMap[activeLayerId ?? 'default'] ?? '#3b82f6',
        layer: activeLayerId ?? 'default',
        createdAt: new Date().toISOString(),
        ...(type === 'symbol' && store.activeSymbolBlockId ? {
          symbolBlockId: store.activeSymbolBlockId,
          symbolRotation: 0,
          symbolScale: 1,
        } : {}),
      };

      addMeasurement(m);
      clearDrawing();
      setLiveMeasurementValue('');
    },
    [
      calibration, currentPage, activeLayerId, layerColorMap,
      toRealWorld, pixelDistance, polygonArea, polygonPerimeter, angleBetween,
      addMeasurement, clearDrawing, setLiveMeasurementValue,
    ]
  );

  // Handle calibration completion: open modal instead of browser prompt()
  const setPendingCalibrationPxLen = useMetreStore((s) => s.setPendingCalibrationPxLen);

  const finalizeCalibration = useCallback(
    (points: Point[]) => {
      if (points.length < 2) return;
      const pxLen = pixelDistance(points[0], points[1]);
      // Open the in-app calibration modal with the measured pixel length
      setPendingCalibrationPxLen(pxLen);
    },
    [pixelDistance, setPendingCalibrationPxLen]
  );

  // --- Pan handlers for middle-click / right-click / space+drag during drawing ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Start point dragging in select mode (left-click near a drag handle)
      if (e.button === 0 && !spaceHeldRef.current) {
        const state = useMetreStore.getState();
        if (state.activeTool === 'select') {
          const pt = getCanvasPoint(e);

          // Check if we're near a drag handle of the selected measurement
          if (state.selectedMeasurementId) {
            const selected = state.measurements.find((m) => m.id === state.selectedMeasurementId);
            if (selected && selected.points.length > 0) {
              const tolerance = 10 / state.viewState.zoom;
              for (let i = 0; i < selected.points.length; i++) {
                const dx = pt.x - selected.points[i].x;
                const dy = pt.y - selected.points[i].y;
                if (Math.sqrt(dx * dx + dy * dy) < tolerance) {
                  draggingInfoRef.current = { measurementId: selected.id, pointIndex: i };
                  state.pushUndo();
                  e.preventDefault();
                  if (interactiveRef.current) interactiveRef.current.style.cursor = 'grabbing';
                  return;
                }
              }

              // Edge-midpoint hit-test (after corner check so corners win
              // priority when both are within tolerance). Drag = stretch
              // the edge perpendicularly; Shift = free 2D translate.
              if (hasEdgeMidpoints(selected.type) && selected.points.length >= 2) {
                const closed = isClosedShape(selected.type);
                const n = selected.points.length;
                const limit = closed && n >= 3 ? n : n - 1;
                for (let i = 0; i < limit; i++) {
                  const aIdx = i;
                  const bIdx = (i + 1) % n;
                  const a = selected.points[aIdx];
                  const b = selected.points[bIdx];
                  const edx = b.x - a.x;
                  const edy = b.y - a.y;
                  const edgeLen = Math.sqrt(edx * edx + edy * edy);
                  if (edgeLen < 1) continue; // skip degenerate
                  const midX = (a.x + b.x) / 2;
                  const midY = (a.y + b.y) / 2;
                  const ddx = pt.x - midX;
                  const ddy = pt.y - midY;
                  if (Math.sqrt(ddx * ddx + ddy * ddy) < tolerance) {
                    draggingMidpointRef.current = {
                      measurementId: selected.id,
                      pointAIndex: aIdx,
                      pointBIndex: bIdx,
                      startMouse: pt,
                      startA: { ...a },
                      startB: { ...b },
                      perpX: -edy / edgeLen,
                      perpY: edx / edgeLen,
                    };
                    state.pushUndo();
                    e.preventDefault();
                    if (interactiveRef.current) interactiveRef.current.style.cursor = 'grabbing';
                    return;
                  }
                }
              }
            }
          }

          // No drag handle hit — check if click is on any selected measurement body (group move)
          if (state.selectedMeasurementIds.length > 0) {
            const pageMeasurements = state.measurements.filter(
              (m) => m.pageNumber === state.currentPage
            );
            const hitId = findMeasurementAtPointUtil(pt, pageMeasurements);
            if (hitId && state.selectedMeasurementIds.includes(hitId)) {
              movingInfoRef.current = { lastPoint: pt };
              state.pushUndo();
              e.preventDefault();
              if (interactiveRef.current) interactiveRef.current.style.cursor = 'move';
              return;
            }
          }

          // No handle or body hit — start marquee selection
          marqueeStartRef.current = pt;
          isMarqueeActiveRef.current = false; // becomes true after minimum drag distance
          e.preventDefault();
          return;
        }
      }

      // Start freehand drawing on left-click (before pan check)
      if (e.button === 0 && !spaceHeldRef.current) {
        const state = useMetreStore.getState();
        if (state.activeTool === 'freehand') {
          const pt = getCanvasPoint(e);
          isFreehandDrawingRef.current = true;
          state.clearDrawing();
          state.addDrawingPoint(pt);
          e.preventDefault();
          return;
        }
      }

      const shouldPan =
        e.button === 1 ||
        e.button === 2 ||
        (e.button === 0 && spaceHeldRef.current);
      if (shouldPan) {
        isPanningRef.current = true;
        lastPanPosRef.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      }
    },
    [getCanvasPoint]
  );

  const handleMouseUp = useCallback(() => {
    // Finalize marquee selection
    if (marqueeStartRef.current) {
      const wasMarquee = isMarqueeActiveRef.current;
      marqueeStartRef.current = null;
      isMarqueeActiveRef.current = false;

      // Remove marquee rectangle from canvas
      const fc = fabricRef.current;
      if (fc && marqueeRectRef.current) {
        fc.remove(marqueeRectRef.current);
        marqueeRectRef.current = null;
        fc.renderAll();
      }

      if (wasMarquee) {
        // Marquee was drawn — wasDraggingRef prevents click from firing
        wasDraggingRef.current = true;
        return;
      }
      // If no marquee drag happened (just a click), fall through to let handleClick handle it
    }

    if (draggingInfoRef.current) {
      draggingInfoRef.current = null;
      wasDraggingRef.current = true;
      // Tear down both kinds of drag overlays — alignment guides AND the
      // green snap-to-point marker — since mouseup does not trigger a
      // measurements-deps rebuild, the rebuild useEffect won't run to
      // clear them on its own. The activeSnap store flags are also
      // cleared so a future hover doesn't inherit a stale "snap engaged"
      // state.
      const fc = fabricRef.current;
      if (fc) {
        let dirty = false;
        for (const g of alignmentGuidesRef.current) { fc.remove(g); dirty = true; }
        alignmentGuidesRef.current = [];
        for (const m of pointSnapMarkerRef.current) { fc.remove(m); dirty = true; }
        pointSnapMarkerRef.current = [];
        if (dirty) fc.renderAll();
      }
      currentAlignmentRef.current = null;
      const store = useMetreStore.getState();
      if (store.activeSnapPoint !== null) store.setActiveSnapPoint(null);
      if (store.activeSnapType !== null) store.setActiveSnapType(null);
      store.saveMeasurementsToStorage();
      if (interactiveRef.current) interactiveRef.current.style.cursor = '';
      return;
    }

    if (draggingMidpointRef.current) {
      draggingMidpointRef.current = null;
      wasDraggingRef.current = true;
      const fc = fabricRef.current;
      if (fc) {
        let dirty = false;
        for (const g of alignmentGuidesRef.current) { fc.remove(g); dirty = true; }
        alignmentGuidesRef.current = [];
        for (const m of pointSnapMarkerRef.current) { fc.remove(m); dirty = true; }
        pointSnapMarkerRef.current = [];
        if (dirty) fc.renderAll();
      }
      currentAlignmentRef.current = null;
      const store = useMetreStore.getState();
      if (store.activeSnapPoint !== null) store.setActiveSnapPoint(null);
      if (store.activeSnapType !== null) store.setActiveSnapType(null);
      store.saveMeasurementsToStorage();
      if (interactiveRef.current) interactiveRef.current.style.cursor = '';
      return;
    }

    // Finalize whole-object move
    if (movingInfoRef.current) {
      movingInfoRef.current = null;
      wasDraggingRef.current = true;
      useMetreStore.getState().saveMeasurementsToStorage();
      if (interactiveRef.current) interactiveRef.current.style.cursor = '';
      return;
    }

    // Finalize freehand drawing on mouse up
    if (isFreehandDrawingRef.current) {
      isFreehandDrawingRef.current = false;
      const state = useMetreStore.getState();
      const pts = state.drawingPoints;
      if (pts.length >= 2) {
        finalizeMeasurement('freehand', pts);
      } else {
        state.clearDrawing();
      }
      return;
    }

    isPanningRef.current = false;
  }, [finalizeMeasurement]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Wheel zoom: use native event listener for non-passive (preventDefault works)
  useEffect(() => {
    const el = interactiveRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const { zoom } = useMetreStore.getState().viewState;
      const newZoom = Math.min(Math.max(zoom * delta, 0.1), 10);
      useMetreStore.getState().setViewState({ zoom: newZoom });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Find the nearest measurement to a click point (for select tool hit-testing)
  const findMeasurementAtPoint = useCallback(
    (pt: Point): string | null => {
      const pageMeasurements = measurements.filter(
        (m) => m.pageNumber === currentPage && visibleLayerIds.has(m.layer)
      );
      return findMeasurementAtPointUtil(pt, pageMeasurements);
    },
    [measurements, currentPage, visibleLayerIds]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Ignore clicks after a point drag operation
      if (wasDraggingRef.current) {
        wasDraggingRef.current = false;
        return;
      }
      // Ignore clicks during/after a pan gesture
      if (activeTool === 'pan') return;
      if (isPanningRef.current) return;

      // Select tool: hit-test measurements and select the nearest one
      // Ctrl+click toggles in/out of multi-selection
      if (activeTool === 'select') {
        const pt = getCanvasPoint(e);
        const hitId = findMeasurementAtPoint(pt);
        if (hitId && (e.ctrlKey || e.metaKey)) {
          toggleMeasurementSelection(hitId);
        } else {
          setSelectedMeasurementId(hitId);
        }
        return;
      }

      // Prevent event from reaching PDFViewer underneath
      e.stopPropagation();

      let pt = getCanvasPoint(e);

      // Apply snap to nearby endpoints/midpoints/intersections
      {
        const store = useMetreStore.getState();
        if (store.snapEnabled && store.snapPoints.length > 0) {
          const snap = findNearestSnapPoint(pt, store.snapPoints, 15 / store.viewState.zoom);
          if (snap) {
            pt = { x: snap.x, y: snap.y };
            store.setActiveSnapType(snap.type);
          } else {
            store.setActiveSnapType(null);
          }
        } else {
          store.setActiveSnapType(null);
        }
      }

      // Apply ortho constraint: snap to 0/45/90/135/180 degree angles from last point
      if (orthoEnabled && drawingPoints.length > 0) {
        const lastPt = drawingPoints[drawingPoints.length - 1];
        pt = snapToAngle(lastPt, pt, 45);
      }

      switch (activeTool) {
        case 'distance':
        case 'calibrate': {
          if (drawingPoints.length === 0) {
            addDrawingPoint(pt);
          } else {
            const pts = [...drawingPoints, pt];
            if (activeTool === 'calibrate') {
              finalizeCalibration(pts);
            } else {
              finalizeMeasurement('distance', pts);
            }
          }
          break;
        }
        case 'area':
        case 'perimeter':
        case 'polyline': {
          addDrawingPoint(pt);
          break;
        }
        case 'mur': {
          if (drawingPoints.length === 0) {
            // First click sets starting point and opens input overlay
            addDrawingPoint(pt);
            setShowMurInput(true);
            setMurInputValue('');
            setMurDirection(null);
            setMurAngle(null);
          } else {
            // Subsequent clicks: mouse determines direction, open input for distance
            const lastPt = drawingPoints[drawingPoints.length - 1];
            const angle = snapAngle15(angleFromPoints(lastPt, pt));
            setMurAngle(angle);
            setMurDirection(null);
            setShowMurInput(true);
            setMurInputValue('');
          }
          break;
        }
        case 'angle': {
          if (drawingPoints.length < 2) {
            addDrawingPoint(pt);
          } else {
            finalizeMeasurement('angle', [...drawingPoints, pt]);
          }
          break;
        }
        case 'dimension': {
          if (drawingPoints.length < 2) {
            addDrawingPoint(pt);
          } else {
            finalizeMeasurement('dimension', [...drawingPoints, pt]);
          }
          break;
        }
        case 'count': {
          useMetreStore.getState().incrementCount(pt);
          break;
        }
        case 'rectangle': {
          if (drawingPoints.length === 0) {
            addDrawingPoint(pt);
          } else {
            // Generate 4 corner points from 2 diagonal corners
            const p1 = drawingPoints[0];
            const p2 = pt;
            const rectPoints: Point[] = [
              { x: p1.x, y: p1.y },
              { x: p2.x, y: p1.y },
              { x: p2.x, y: p2.y },
              { x: p1.x, y: p2.y },
            ];
            finalizeMeasurement('area', rectPoints);
          }
          break;
        }
        case 'circle': {
          if (drawingPoints.length === 0) {
            addDrawingPoint(pt);
          } else {
            finalizeMeasurement('circle', [drawingPoints[0], pt]);
          }
          break;
        }
        case 'text': {
          // Single click creates text annotation immediately
          finalizeMeasurement('text', [pt]);
          break;
        }
        case 'note': {
          // Single click creates note annotation immediately
          finalizeMeasurement('note', [pt]);
          break;
        }
        case 'callout': {
          // Two clicks: first = arrow tip, second = text box
          if (drawingPoints.length === 0) {
            addDrawingPoint(pt);
          } else {
            finalizeMeasurement('callout', [drawingPoints[0], pt]);
          }
          break;
        }
        case 'arrow': {
          // Two clicks like distance: start → end
          if (drawingPoints.length === 0) {
            addDrawingPoint(pt);
          } else {
            finalizeMeasurement('arrow', [drawingPoints[0], pt]);
          }
          break;
        }
        case 'cloud': {
          // Multi-click polygon like area, closed on double-click or Enter
          addDrawingPoint(pt);
          break;
        }
        case 'highlight': {
          // Two clicks like rectangle: corner 1 → corner 2
          if (drawingPoints.length === 0) {
            addDrawingPoint(pt);
          } else {
            const p1 = drawingPoints[0];
            const p2 = pt;
            const rectPoints: Point[] = [
              { x: p1.x, y: p1.y },
              { x: p2.x, y: p1.y },
              { x: p2.x, y: p2.y },
              { x: p1.x, y: p2.y },
            ];
            finalizeMeasurement('highlight', rectPoints);
          }
          break;
        }
        case 'stamp': {
          // Single click places the active symbol block
          const activeId = useMetreStore.getState().activeSymbolBlockId;
          if (activeId) {
            finalizeMeasurement('symbol', [pt]);
          }
          break;
        }
        // freehand is handled via mousedown/mousemove/mouseup, not click
      }
    },
    [activeTool, drawingPoints, getCanvasPoint, addDrawingPoint, finalizeMeasurement, finalizeCalibration, orthoEnabled, findMeasurementAtPoint, setSelectedMeasurementId, toggleMeasurementSelection]
  );

  // Double-click to close area/perimeter/polyline
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (
        (activeTool === 'area' || activeTool === 'perimeter' || activeTool === 'cloud') &&
        drawingPoints.length >= 3
      ) {
        e.stopPropagation();
        e.preventDefault();
        finalizeMeasurement(activeTool === 'cloud' ? 'cloud' : activeTool, drawingPoints);
      } else if (activeTool === 'polyline' && drawingPoints.length >= 2) {
        e.stopPropagation();
        e.preventDefault();
        finalizeMeasurement('polyline', drawingPoints);
      } else if (activeTool === 'mur' && drawingPoints.length >= 2) {
        e.stopPropagation();
        e.preventDefault();
        setShowMurInput(false);
        setMurInputValue('');
        setMurDirection(null);
        setMurAngle(null);
        finalizeMeasurement('polyline', drawingPoints);
      }
    },
    [activeTool, drawingPoints, finalizeMeasurement]
  );

  // Mouse move for rubber-band preview + panning + marquee
  // Uses requestAnimationFrame throttling to limit preview redraws to ~60fps
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Handle marquee selection drag (immediate, not throttled)
      if (marqueeStartRef.current && activeTool === 'select') {
        const pt = getCanvasPoint(e);
        const start = marqueeStartRef.current;
        const dx = pt.x - start.x;
        const dy = pt.y - start.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Minimum 5px drag to activate marquee (distinguish from click)
        if (dist < 5 / (useMetreStore.getState().viewState.zoom || 1)) return;

        isMarqueeActiveRef.current = true;
        const fc = fabricRef.current;
        if (!fc) return;

        const currentZoom = useMetreStore.getState().viewState.zoom;
        const left = Math.min(start.x, pt.x) * currentZoom;
        const top = Math.min(start.y, pt.y) * currentZoom;
        const width = Math.abs(pt.x - start.x) * currentZoom;
        const height = Math.abs(pt.y - start.y) * currentZoom;

        // Update or create marquee rectangle
        if (marqueeRectRef.current) {
          fc.remove(marqueeRectRef.current);
        }
        const rect = new Rect({
          left,
          top,
          width,
          height,
          fill: 'rgba(59, 130, 246, 0.08)',
          stroke: '#3b82f6',
          strokeWidth: 1,
          strokeDashArray: [6, 3],
          selectable: false,
          evented: false,
        });
        marqueeRectRef.current = rect;
        fc.add(rect);
        fc.renderAll();

        // Live selection: find all measurements with any point inside the rectangle
        const state = useMetreStore.getState();
        const minX = Math.min(start.x, pt.x);
        const maxX = Math.max(start.x, pt.x);
        const minY = Math.min(start.y, pt.y);
        const maxY = Math.max(start.y, pt.y);

        const pageMeasurements = state.measurements.filter(
          (m) => m.pageNumber === state.currentPage && visibleLayerIds.has(m.layer)
        );

        const matchedIds = pageMeasurements
          .filter((m) =>
            m.points.some((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)
          )
          .map((m) => m.id);

        setSelectedMeasurementIds(matchedIds);
        return;
      }

      // Handle point dragging (immediate, not throttled via RAF)
      if (draggingInfoRef.current) {
        const info = draggingInfoRef.current;
        const state = useMetreStore.getState();
        // Symmetric with the midpoint-drag guard: if the user tapped a
        // tool keyboard shortcut while still holding the mouse, abort the
        // corner drag and tear down all overlay state (alignment guides,
        // snap-to-point marker, store snap flags) so the new tool starts
        // from a clean slate.
        if (state.activeTool !== 'select') {
          draggingInfoRef.current = null;
          const fcAbort = fabricRef.current;
          if (fcAbort) {
            let dirty = false;
            for (const g of alignmentGuidesRef.current) { fcAbort.remove(g); dirty = true; }
            alignmentGuidesRef.current = [];
            for (const m of pointSnapMarkerRef.current) { fcAbort.remove(m); dirty = true; }
            pointSnapMarkerRef.current = [];
            if (dirty) fcAbort.renderAll();
          }
          currentAlignmentRef.current = null;
          if (state.activeSnapPoint !== null) state.setActiveSnapPoint(null);
          if (state.activeSnapType !== null) state.setActiveSnapType(null);
          if (interactiveRef.current) interactiveRef.current.style.cursor = '';
          return;
        }
        const m = state.measurements.find((mm) => mm.id === info.measurementId);
        if (m) {
          // Snap hierarchy: exact snap-to-point first (15 / zoom, lands
          // pile on an endpoint / midpoint / intersection), and only fall
          // back to axis-alignment (8 / zoom) if no point was within the
          // larger tolerance. Both honour the global snapEnabled toggle.
          const rawPt = getCanvasPoint(e);
          const dragged = m.points[info.pointIndex];
          const exact = applyPointSnap(rawPt, [dragged]);
          let pt: Point;
          if (exact.snapped) {
            pt = exact.pt;
            currentAlignmentRef.current = null;
          } else {
            pt = applyAlignmentSnap(rawPt, info.measurementId, [info.pointIndex]);
          }
          const newPoints = [...m.points];
          newPoints[info.pointIndex] = pt;
          const newValue = recalculateValue(m.type as MeasurementType, newPoints);
          state.updateMeasurementPoints(m.id, newPoints, newValue);
        }
        return;
      }

      // Handle edge-midpoint stretch — translate both endpoints together.
      // Default: project the cursor delta onto the edge perpendicular (the
      // square-becomes-rectangle behaviour). Shift held: free 2D translate.
      if (draggingMidpointRef.current) {
        const info = draggingMidpointRef.current;
        const state = useMetreStore.getState();
        // Abort the drag if the user switched tool mid-stretch (e.g. tapped
        // a tool keyboard shortcut while still holding the mouse) — without
        // this guard the stretch would keep mutating the measurement after
        // the user already moved on to another mode. Also tear down any
        // alignment guide currently drawn on the canvas so it does not
        // linger in the new mode (which never refreshes them).
        if (state.activeTool !== 'select') {
          draggingMidpointRef.current = null;
          const fcAbort = fabricRef.current;
          if (fcAbort) {
            let dirty = false;
            for (const g of alignmentGuidesRef.current) { fcAbort.remove(g); dirty = true; }
            alignmentGuidesRef.current = [];
            for (const m of pointSnapMarkerRef.current) { fcAbort.remove(m); dirty = true; }
            pointSnapMarkerRef.current = [];
            if (dirty) fcAbort.renderAll();
          }
          currentAlignmentRef.current = null;
          if (state.activeSnapPoint !== null) state.setActiveSnapPoint(null);
          if (state.activeSnapType !== null) state.setActiveSnapType(null);
          if (interactiveRef.current) interactiveRef.current.style.cursor = '';
          return;
        }
        const m = state.measurements.find((mm) => mm.id === info.measurementId);
        if (m) {
          // Snap hierarchy: exact snap-to-point first (15 / zoom). The
          // excluded set covers both endpoints AND the current midpoint
          // since both are about to move and we don't want to snap onto
          // the very point we're dragging from. If no exact snap fires,
          // fall back to axis-alignment (8 / zoom) restricted to the axes
          // the perpendicular projection can actually move — a Y-snap on
          // a perfectly vertical edge would otherwise show a misleading
          // horizontal guide that the projection silently discards.
          const rawPt = getCanvasPoint(e);
          const posA = m.points[info.pointAIndex];
          const posB = m.points[info.pointBIndex];
          const midPos = { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2 };
          const exact = applyPointSnap(rawPt, [posA, posB, midPos]);
          let pt: Point;
          if (exact.snapped) {
            pt = exact.pt;
            currentAlignmentRef.current = null;
          } else {
            const allowX = e.shiftKey || Math.abs(info.perpX) > 0.001;
            const allowY = e.shiftKey || Math.abs(info.perpY) > 0.001;
            pt = applyAlignmentSnap(
              rawPt,
              info.measurementId,
              [info.pointAIndex, info.pointBIndex],
              { allowX, allowY },
            );
          }
          const dx = pt.x - info.startMouse.x;
          const dy = pt.y - info.startMouse.y;
          let appliedDx = dx;
          let appliedDy = dy;
          if (!e.shiftKey) {
            const dotPerp = dx * info.perpX + dy * info.perpY;
            appliedDx = dotPerp * info.perpX;
            appliedDy = dotPerp * info.perpY;
          }
          const newPoints = [...m.points];
          newPoints[info.pointAIndex] = {
            x: info.startA.x + appliedDx,
            y: info.startA.y + appliedDy,
          };
          newPoints[info.pointBIndex] = {
            x: info.startB.x + appliedDx,
            y: info.startB.y + appliedDy,
          };
          const newValue = recalculateValue(m.type as MeasurementType, newPoints);
          state.updateMeasurementPoints(m.id, newPoints, newValue);
        }
        return;
      }

      // Handle whole-group move (translate all selected measurements by the same delta)
      if (movingInfoRef.current) {
        const info = movingInfoRef.current;
        const state = useMetreStore.getState();
        const pt = getCanvasPoint(e);
        const dx = pt.x - info.lastPoint.x;
        const dy = pt.y - info.lastPoint.y;
        // Move all selected measurements at once
        const selectedIds = new Set(state.selectedMeasurementIds);
        const updated = state.measurements.map((m) => {
          if (!selectedIds.has(m.id)) return m;
          return { ...m, points: m.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
        });
        useMetreStore.setState({ measurements: updated });
        movingInfoRef.current = { lastPoint: pt };
        return;
      }

      // Handle panning during drawing mode — read latest viewState from store
      // Panning must be immediate (not throttled) for responsiveness
      if (isPanningRef.current) {
        const dx = e.clientX - lastPanPosRef.current.x;
        const dy = e.clientY - lastPanPosRef.current.y;
        lastPanPosRef.current = { x: e.clientX, y: e.clientY };
        const currentVS = useMetreStore.getState().viewState;
        useMetreStore.getState().setViewState({
          offsetX: currentVS.offsetX + dx,
          offsetY: currentVS.offsetY + dy,
        });
        return;
      }

      // Freehand: continuously collect points while mouse is down
      if (isFreehandDrawingRef.current && activeTool === 'freehand') {
        const fc = fabricRef.current;
        if (!fc) return;
        const el = (fc as any).lowerCanvasEl as HTMLCanvasElement | undefined;
        const rect = el?.getBoundingClientRect();
        if (!rect) return;
        const currentZoom = useMetreStore.getState().viewState.zoom;
        const pageX = (e.clientX - rect.left) / currentZoom;
        const pageY = (e.clientY - rect.top) / currentZoom;

        const state = useMetreStore.getState();
        const pts = state.drawingPoints;
        if (pts.length > 0) {
          const lastPt = pts[pts.length - 1];
          const dx = pageX - lastPt.x;
          const dy = pageY - lastPt.y;
          if (dx * dx + dy * dy > 25) { // 5px distance threshold for point thinning
            state.addDrawingPoint({ x: pageX, y: pageY });
          }
        }
        return;
      }

      // Capture event data before RAF (React synthetic events are pooled)
      const clientX = e.clientX;
      const clientY = e.clientY;

      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const fc = fabricRef.current;
        if (!fc) return;
        const el = (fc as any).lowerCanvasEl as HTMLCanvasElement | undefined;
        const rect = el?.getBoundingClientRect();
        if (!rect) return;
        const currentZoom = useMetreStore.getState().viewState.zoom;
        let pt: Point = {
          x: (clientX - rect.left) / currentZoom,
          y: (clientY - rect.top) / currentZoom,
        };

        // Apply snap during preview
        const snapState = useMetreStore.getState();
        if (snapState.snapEnabled && snapState.snapPoints.length > 0) {
          const snap = findNearestSnapPoint(pt, snapState.snapPoints, 15 / currentZoom);
          if (snap) {
            pt = { x: snap.x, y: snap.y };
            snapState.setActiveSnapType(snap.type);
          } else {
            snapState.setActiveSnapType(null);
          }
        } else {
          snapState.setActiveSnapType(null);
        }

        mousePosRef.current = pt;

        // Remove old preview objects
        previewObjectsRef.current.forEach((obj) => fc.remove(obj));
        previewObjectsRef.current = [];

        const isOrtho = useMetreStore.getState().orthoEnabled;

        const { objects: previewObjs, liveValue } = buildDrawingPreview(
          {
            zoom: currentZoom,
            drawingPoints,
            mousePoint: pt,
            activeTool,
            orthoEnabled: isOrtho,
            canvasWidth: fc.getWidth(),
            canvasHeight: fc.getHeight(),
          },
          {
            pixelDistance,
            toRealWorld,
            polygonArea,
            polygonPerimeter,
            angleBetween,
            calibrationUnit: calibration?.unit ?? 'm',
          },
        );

        previewObjs.forEach((obj) => fc.add(obj));
        previewObjectsRef.current = previewObjs;
        if (liveValue) setLiveMeasurementValue(liveValue);

        // Draw snap indicator (green diamond) when snapping to a point
        const snapType = useMetreStore.getState().activeSnapType;
        if (snapType) {
          const sx = pt.x * currentZoom;
          const sy = pt.y * currentZoom;
          const size = 8;
          // Diamond shape via two crossing lines
          const hLine = new Line([sx - size, sy, sx + size, sy], {
            stroke: '#22c55e', strokeWidth: 2, selectable: false, evented: false,
          });
          const vLine = new Line([sx, sy - size, sx, sy + size], {
            stroke: '#22c55e', strokeWidth: 2, selectable: false, evented: false,
          });
          const ring = new Circle({
            left: sx - size, top: sy - size, radius: size,
            fill: 'transparent', stroke: '#22c55e', strokeWidth: 1.5,
            selectable: false, evented: false,
          });
          fc.add(hLine, vLine, ring);
          previewObjectsRef.current.push(hLine, vLine, ring);
        }

        fc.renderAll();
      });
    },
    [
      activeTool, drawingPoints, pixelDistance, toRealWorld,
      polygonArea, polygonPerimeter, angleBetween, calibration, setLiveMeasurementValue,
      getCanvasPoint, recalculateValue, visibleLayerIds, setSelectedMeasurementIds,
    ]
  );

  // Escape key to cancel drawing
  // Escape key to cancel drawing + keyboard shortcuts for tool switching
  useEffect(() => {
    const SHORTCUTS: Record<string, Tool> = {
      v: 'select', d: 'distance', a: 'area', r: 'rectangle', p: 'perimeter',
      l: 'polyline', j: 'mur', n: 'angle', c: 'count', i: 'circle', x: 'dimension', k: 'calibrate', h: 'pan',
      t: 'text', w: 'arrow', q: 'cloud', f: 'freehand', g: 'highlight', e: 'note', b: 'callout', y: 'stamp',
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts when typing in input fields
      // Exception: allow arrow keys through when mur tool is active (direction control)
      const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      const isMurArrow = ARROW_KEY_MAP[e.key] && useMetreStore.getState().activeTool === 'mur';
      if (inInput && !isMurArrow) return;
      // Si la calculatrice Master Pro est ouverte, NE PAS traiter les raccourcis
      // outils (V/D/A/R/P/L/J/N/C/I/X/K/H/T/W/Q/F/G/E/B/Y) -- toutes les
      // touches sont deleguees au CalculatorPanel pour eviter qu'une touche
      // comme C ou V change l'outil PDF en arriere-plan pendant que l'user
      // calcule. Le bouton Calculatrice se ferme via le X du panel ou l'ESC
      // gere par CalculatorPanel lui-meme.
      if (useMetreStore.getState().showCalculator) return;

      if (e.key === 'Escape') {
        // Cancel any active marquee selection
        if (marqueeStartRef.current || isMarqueeActiveRef.current) {
          marqueeStartRef.current = null;
          isMarqueeActiveRef.current = false;
          const fc = fabricRef.current;
          if (fc && marqueeRectRef.current) {
            fc.remove(marqueeRectRef.current);
            marqueeRectRef.current = null;
            fc.renderAll();
          }
        }
        // Finalize any active count session
        useMetreStore.getState().finalizeCount();
        // Close mur input if open
        setShowMurInput(false);
        setMurInputValue('');
        setMurDirection(null);
        setMurAngle(null);
        clearDrawing();
        setShowNumericInput(false);
        setNumericInputValue('');
        setLiveMeasurementValue('');
        const fc = fabricRef.current;
        if (fc) {
          previewObjectsRef.current.forEach((obj) => fc.remove(obj));
          previewObjectsRef.current = [];
          fc.renderAll();
        }
        return;
      }

      // Enter to close polygon-type tools (area, perimeter, polyline, cloud)
      if (e.key === 'Enter') {
        const state = useMetreStore.getState();
        const tool = state.activeTool;
        const pts = state.drawingPoints;
        if ((tool === 'area' || tool === 'perimeter' || tool === 'cloud') && pts.length >= 3) {
          e.preventDefault();
          finalizeMeasurement(tool === 'cloud' ? 'cloud' : tool as MeasurementType, pts);
          return;
        } else if (tool === 'polyline' && pts.length >= 2) {
          e.preventDefault();
          finalizeMeasurement('polyline', pts);
          return;
        } else if (tool === 'mur' && pts.length >= 2 && !showMurInput) {
          e.preventDefault();
          finalizeMeasurement('polyline', pts);
          return;
        } else if (tool === 'dimension' && pts.length >= 3) {
          e.preventDefault();
          finalizeMeasurement('dimension', pts);
          return;
        }
      }

      // Tab to open numeric input during drawing
      if (e.key === 'Tab') {
        const state = useMetreStore.getState();
        if (state.drawingPoints.length > 0) {
          e.preventDefault();
          setShowNumericInput(true);
          setNumericInputValue('');
          // Focus the input after render
          setTimeout(() => numericInputRef.current?.focus(), 0);
          return;
        }
      }

      // Arrow keys for mur direction — works whenever mur tool is active and drawing
      // (inspired by CAO AI useKeyboardShortcuts: arrow keys always work in wall mode)
      if (ARROW_KEY_MAP[e.key]) {
        const murState = useMetreStore.getState();
        if (murState.activeTool === 'mur' && murState.drawingPoints.length > 0) {
          e.preventDefault();
          setMurDirection(ARROW_KEY_MAP[e.key]);
          setMurAngle(null); // cardinal overrides mouse angle
          // Auto-show input if not already visible
          if (!showMurInput) {
            setShowMurInput(true);
            setMurInputValue('');
          }
          return;
        }
      }

      // F7 toggles grid overlay
      if (e.key === 'F7') {
        e.preventDefault();
        toggleGrid();
        return;
      }

      // F8 or O toggles ortho mode (like AutoCAD)
      if (e.key === 'F8' || (e.key.toLowerCase() === 'o' && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        toggleOrtho();
        return;
      }

      // Ctrl+[ rotate left, Ctrl+] rotate right
      if (e.ctrlKey && e.key === '[') {
        e.preventDefault();
        const state = useMetreStore.getState();
        state.setViewState({ rotation: (state.viewState.rotation - 90 + 360) % 360 });
        return;
      }
      if (e.ctrlKey && e.key === ']') {
        e.preventDefault();
        const state = useMetreStore.getState();
        state.setViewState({ rotation: (state.viewState.rotation + 90) % 360 });
        return;
      }

      // Ctrl+Shift+C to copy measurement properties
      if (e.ctrlKey && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        const state = useMetreStore.getState();
        if (state.selectedMeasurementId) {
          e.preventDefault();
          state.copyMeasurementProperties(state.selectedMeasurementId);
          return;
        }
      }

      // Ctrl+Shift+V to paste measurement properties
      if (e.ctrlKey && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        const state = useMetreStore.getState();
        if (state.propertyClipboard && state.selectedMeasurementIds.length > 0) {
          e.preventDefault();
          state.pasteMeasurementProperties();
          return;
        }
      }

      // Ctrl+C to copy selected measurements to clipboard
      if (e.ctrlKey && e.key === 'c') {
        const state = useMetreStore.getState();
        if (state.selectedMeasurementIds.length > 0) {
          e.preventDefault();
          state.copySelectedToClipboard();
          return;
        }
      }

      // Ctrl+V to paste measurements from clipboard (onto current page)
      if (e.ctrlKey && e.key === 'v') {
        const state = useMetreStore.getState();
        if (state.clipboard.length > 0) {
          e.preventDefault();
          state.pasteFromClipboard();
          return;
        }
      }

      // Ctrl+D to duplicate selected measurement(s)
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        const state = useMetreStore.getState();
        // Duplicate each selected measurement
        for (const selId of state.selectedMeasurementIds) {
          state.duplicateMeasurement(selId);
        }
        return;
      }

      // Ctrl+A to select all measurements on current page
      if (e.ctrlKey && e.key === 'a') {
        e.preventDefault();
        const state = useMetreStore.getState();
        if (state.activeTool === 'select') {
          const pageIds = state.measurements
            .filter((m) => m.pageNumber === state.currentPage)
            .map((m) => m.id);
          state.setSelectedMeasurementIds(pageIds);
        }
        return;
      }

      // Delete / Backspace to delete all selected measurements
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const state = useMetreStore.getState();
        if (state.selectedMeasurementIds.length > 0) {
          state.removeSelectedMeasurements();
        }
        return;
      }

      // Transform shortcuts (R = rotate 45°, M = mirror copy) — only in select mode with selection
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const state = useMetreStore.getState();
        if (state.activeTool === 'select' && state.selectedMeasurementIds.length > 0) {
          // R — Rotate selected measurement 45° clockwise
          if (e.key.toLowerCase() === 'r') {
            e.preventDefault();
            for (const selId of state.selectedMeasurementIds) {
              state.rotateMeasurement45(selId);
            }
            return;
          }
          // M — Mirror copy (horizontal), Shift+M — Mirror copy (vertical)
          if (e.key === 'm' || e.key === 'M') {
            e.preventDefault();
            const axis = e.shiftKey ? 'vertical' : 'horizontal';
            for (const selId of state.selectedMeasurementIds) {
              state.mirrorCopyMeasurement(selId, axis);
            }
            return;
          }
        }
      }

      // Tool shortcuts (single key, no modifiers)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const tool = SHORTCUTS[e.key.toLowerCase()];
        if (tool) {
          e.preventDefault();
          setActiveTool(tool);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearDrawing, setLiveMeasurementValue, setActiveTool, toggleOrtho, toggleGrid, finalizeMeasurement, showMurInput]);

  // Handle mur imperial input confirmation: create segment at exact length + direction
  const handleMurConfirm = useCallback(() => {
    const parsed = parseImperialInput(murInputValue);
    if (!parsed) return;

    const state = useMetreStore.getState();
    const pts = state.drawingPoints;
    if (pts.length === 0) return;

    const lastPt = pts[pts.length - 1];
    const cal = state.calibration;

    // Convert meters to pixel distance using calibration
    // Guard against missing calibration or extremely small scaleFactor
    if (!cal || cal.scaleFactor <= 0) return; // Cannot draw without calibration
    // scaleFactor is in calibration-unit per pixel, so convert meters to cal unit first
    const metersToCalUnit: Record<string, number> = {
      m: 1, cm: 100, mm: 1000, ft: 3.28084, in: 39.3701,
    };
    const realDist = parsed.totalMeters * (metersToCalUnit[cal.unit] ?? 1);
    const pixDist = Math.min(realDist / cal.scaleFactor, 50000); // cap at 50k px to prevent canvas overflow

    let delta: Point;
    if (murDirection) {
      // Cardinal direction from arrow keys
      delta = directionToDelta(murDirection, pixDist);
    } else if (murAngle !== null) {
      // Angle from mouse position (snapped to 15°)
      delta = angleToDelta(murAngle, pixDist);
    } else {
      // Default: right
      delta = { x: pixDist, y: 0 };
    }

    const newPt: Point = {
      x: lastPt.x + delta.x,
      y: lastPt.y + delta.y,
    };

    // Add the new point to the polyline chain
    addDrawingPoint(newPt);

    // Update mouse position to the new endpoint so preview starts fresh
    // (no mouse move fires after confirm, so preview would otherwise be stale)
    mousePosRef.current = newPt;

    // Reset input for next segment but keep overlay open for chaining
    setMurInputValue('');
    setMurDirection(null);
    setMurAngle(null);

    // Force preview redraw after state update — inspired by CAO AI's atomic chainToPoint
    // Without this, the preview won't update until the next mouse move
    requestAnimationFrame(() => {
      const fc = fabricRef.current;
      if (!fc) return;

      previewObjectsRef.current.forEach((obj) => fc.remove(obj));
      previewObjectsRef.current = [];

      const state = useMetreStore.getState();
      const currentZoom = state.viewState.zoom;
      const pts = state.drawingPoints;

      if (pts.length === 0) { fc.renderAll(); return; }

      const { objects: previewObjs, liveValue } = buildDrawingPreview(
        {
          zoom: currentZoom,
          drawingPoints: pts,
          mousePoint: newPt,
          activeTool: 'mur',
          orthoEnabled: state.orthoEnabled,
          canvasWidth: fc.getWidth(),
          canvasHeight: fc.getHeight(),
        },
        {
          pixelDistance,
          toRealWorld,
          polygonArea,
          polygonPerimeter,
          angleBetween,
          calibrationUnit: calibration?.unit ?? 'm',
        },
      );

      previewObjs.forEach((obj) => fc.add(obj));
      previewObjectsRef.current = previewObjs;
      if (liveValue) setLiveMeasurementValue(liveValue);
      fc.renderAll();
    });
  }, [murInputValue, murDirection, murAngle, addDrawingPoint, pixelDistance, toRealWorld, polygonArea, polygonPerimeter, angleBetween, calibration, setLiveMeasurementValue]);

  // Handle mur cancel
  const handleMurCancel = useCallback(() => {
    setShowMurInput(false);
    setMurInputValue('');
    setMurDirection(null);
    setMurAngle(null);
    // If we have 2+ points, finalize as polyline
    const state = useMetreStore.getState();
    if (state.drawingPoints.length >= 2) {
      finalizeMeasurement('polyline', state.drawingPoints);
    } else {
      clearDrawing();
    }
  }, [finalizeMeasurement, clearDrawing]);

  // Handle numeric input submission: place next point at exact typed distance
  const handleNumericInputSubmit = useCallback(() => {
    const parsed = parseFloat(numericInputValue);
    if (isNaN(parsed) || parsed <= 0) {
      setShowNumericInput(false);
      setNumericInputValue('');
      return;
    }

    const state = useMetreStore.getState();
    const pts = state.drawingPoints;
    if (pts.length === 0) {
      setShowNumericInput(false);
      setNumericInputValue('');
      return;
    }

    const lastPt = pts[pts.length - 1];
    const mousePos = mousePosRef.current;

    // Convert typed real-world distance to pixel distance
    const pixDist = calibration ? parsed / calibration.scaleFactor : parsed;

    // Direction from last point to current mouse position
    const dx = mousePos.x - lastPt.x;
    const dy = mousePos.y - lastPt.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    let newPt: Point;
    if (len < 0.001) {
      // Mouse is at the same position as last point; default to right (positive x)
      newPt = { x: lastPt.x + pixDist, y: lastPt.y };
    } else {
      // Place point at exact distance in the direction of current mouse
      const ux = dx / len;
      const uy = dy / len;
      newPt = { x: lastPt.x + ux * pixDist, y: lastPt.y + uy * pixDist };
    }

    // For 2-point tools, auto-finalize instead of just adding a drawing point
    // (otherwise the next click would pass 3 points to a 2-point measurement)
    const tool = state.activeTool;
    if (
      (tool === 'distance' || tool === 'rectangle' || tool === 'circle' || tool === 'arrow' || tool === 'highlight') &&
      pts.length === 1
    ) {
      if (tool === 'rectangle') {
        const p1 = pts[0];
        const rectPoints: Point[] = [
          { x: p1.x, y: p1.y },
          { x: newPt.x, y: p1.y },
          { x: newPt.x, y: newPt.y },
          { x: p1.x, y: newPt.y },
        ];
        finalizeMeasurement('area', rectPoints);
      } else if (tool === 'highlight') {
        const p1 = pts[0];
        const hlPoints: Point[] = [
          { x: p1.x, y: p1.y },
          { x: newPt.x, y: p1.y },
          { x: newPt.x, y: newPt.y },
          { x: p1.x, y: newPt.y },
        ];
        finalizeMeasurement('highlight', hlPoints);
      } else if (tool === 'circle') {
        finalizeMeasurement('circle', [pts[0], newPt]);
      } else if (tool === 'arrow') {
        finalizeMeasurement('arrow', [pts[0], newPt]);
      } else {
        finalizeMeasurement('distance', [pts[0], newPt]);
      }
    } else if (tool === 'calibrate' && pts.length === 1) {
      finalizeCalibration([pts[0], newPt]);
    } else if (tool === 'angle' && pts.length === 2) {
      finalizeMeasurement('angle', [...pts, newPt]);
    } else if (tool === 'dimension' && pts.length === 2) {
      finalizeMeasurement('dimension', [...pts, newPt]);
    } else {
      addDrawingPoint(newPt);
    }

    setShowNumericInput(false);
    setNumericInputValue('');
  }, [numericInputValue, calibration, addDrawingPoint, finalizeMeasurement, finalizeCalibration]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
    >
      {/*
       * Event-capture layer: covers the full viewport so mouse events (click,
       * drag, pan) work even when the cursor is outside the canvas area.
       * pointer-events are enabled only when a drawing tool is active.
       */}
      <div
        ref={interactiveRef}
        className={`absolute inset-0 ${
          isDrawingTool ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
      />

      {/*
       * Canvas layer: mirrors the EXACT same DOM structure as PDFViewer so
       * the Fabric overlay stays pixel-perfect with the PDF underneath at
       * every zoom level.  PDFViewer uses:
       *   div[flex center] > div[translate(offset)] > canvas
       * We replicate that here.
       */}
      <div className="absolute inset-0 overflow-hidden flex items-center justify-center pointer-events-none">
        <div
          style={{
            transform: `translate(${viewState.offsetX}px, ${viewState.offsetY}px)`,
            position: 'relative',
          }}
        >
          <canvas
            ref={canvasRef}
            id="measurement-canvas"
          />
        </div>
      </div>

      {/* Mur imperial input overlay — keyboard-driven PP-II-SS dimension entry */}
      {showMurInput && drawingPoints.length > 0 && (() => {
        // Compute overlay position using the Fabric canvas bounding rect
        // to correctly account for flex centering of the PDF canvas
        const fc = fabricRef.current;
        const el = fc ? (fc as any).lowerCanvasEl as HTMLCanvasElement | undefined : undefined;
        const canvasRect = el?.getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect();
        const lastPt = drawingPoints[drawingPoints.length - 1];

        // Position relative to the container (absolute inset-0)
        const canvasOffsetX = canvasRect && containerRect ? canvasRect.left - containerRect.left : 0;
        const canvasOffsetY = canvasRect && containerRect ? canvasRect.top - containerRect.top : 0;
        const overlayX = canvasOffsetX + lastPt.x * viewState.zoom;
        const overlayY = canvasOffsetY + lastPt.y * viewState.zoom;
        const vpW = containerRect?.width ?? 800;
        const vpH = containerRect?.height ?? 600;

        return (
          <MurInput
            direction={murDirection}
            angleDeg={murAngle}
            inputValue={murInputValue}
            isCalibrated={!!calibration}
            calibrationUnit={calibration?.unit ?? 'm'}
            posX={overlayX}
            posY={overlayY}
            viewportWidth={vpW}
            viewportHeight={vpH}
            onInputChange={setMurInputValue}
            onDirectionChange={(dir) => {
              setMurDirection(dir);
              setMurAngle(null);
            }}
            onConfirm={handleMurConfirm}
            onCancel={handleMurCancel}
          />
        );
      })()}

      {/* Numeric input overlay — press Tab during drawing to type exact distance */}
      {showNumericInput && (
        <div
          className="absolute pointer-events-auto"
          style={{
            left: mousePosRef.current.x * viewState.zoom + viewState.offsetX,
            top: mousePosRef.current.y * viewState.zoom + viewState.offsetY - 36,
            zIndex: 9999,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--metre-bg)',
              borderRadius: 4,
              padding: '2px 6px',
              border: '1px solid #3b82f6',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}
          >
            <span style={{ color: 'var(--metre-muted)', fontSize: 11, fontFamily: 'monospace' }}>
              d=
            </span>
            <input
              ref={numericInputRef}
              type="text"
              value={numericInputValue}
              onChange={(e) => setNumericInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleNumericInputSubmit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowNumericInput(false);
                  setNumericInputValue('');
                }
                e.stopPropagation();
              }}
              onBlur={() => {
                setShowNumericInput(false);
                setNumericInputValue('');
              }}
              style={{
                width: 80,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--metre-text)',
                fontSize: 12,
                fontFamily: 'monospace',
                padding: 0,
              }}
              placeholder={calibration?.unit ?? 'm'}
              autoFocus
            />
          </div>
        </div>
      )}
    </div>
  );
}

// createMeasurementObjects, pointToSegmentDist, pointInPolygon, findMeasurementAtPoint
// are now imported from ./measurementRendering.ts
