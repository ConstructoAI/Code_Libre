/**
 * FloorPlanEditor - Editeur de plan d'etage 2D dessinable
 *
 * Inspiration: Wall Builder Pro - vue de dessus avec grille a carreaux,
 * permet de dessiner des murs en drag/drop qui se convertissent ensuite
 * en murs parametrables pour MursParametriquePanel.
 *
 * Fonctionnalites:
 *  - Canvas SVG avec grille a carreaux (snap configurable 3"/6"/12"/24")
 *  - Modes de dessin: select / draw-wall / draw-room / rule / delete / add-opening
 *  - Murs typeses: exterieur / interieur / mitoyen (epaisseurs distinctes)
 *  - Mesure en pi-po avec snap 1/16e
 *  - Zoom in/out + pan (drag fond ou espace)
 *  - Detection automatique des pieces fermees (polygones)
 *  - Export JSON et conversion vers structure MurWallExport
 *
 * Limitations Phase 16:
 *  - 2D vue de dessus uniquement (3D viendra plus tard)
 *  - Murs droits uniquement (pas de courbes)
 *  - 1 niveau a la fois
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MousePointer2, Minus, Square, Ruler, Scissors, DoorOpen,
  ZoomIn, ZoomOut, Grid3x3, Save, Download, Trash2,
  Eye, EyeOff, Plus, Camera, FileText, Layers,
} from 'lucide-react';

// ============================================
// TYPES EXPORTES
// ============================================

export interface FloorPoint {
  x: number; // pouces (unite interne)
  y: number;
}

export interface FloorWall {
  id: string;
  startId: string;
  endId: string;
  type: 'exterieur' | 'interieur' | 'mitoyen';
  thicknessIn: number;
}

export interface FloorRoom {
  id: string;
  label: string;
  wallIds: string[];
  areaFt2: number;
}

export interface FloorOpening {
  id: string;
  wallId: string;
  type: 'porte' | 'fenetre';
  positionOnWall: number; // 0-1 ratio sur la longueur du mur
  widthIn: number;
  heightIn: number;
}

export interface FloorPlan {
  id: string;
  levelId: number;
  name: string;
  points: Record<string, FloorPoint>;
  walls: FloorWall[];
  rooms: FloorRoom[];
  openings: FloorOpening[];
  gridSizeIn: number;
}

export type ToolMode = 'select' | 'draw-wall' | 'draw-room' | 'rule' | 'delete' | 'add-opening';

export type WallType = 'exterieur' | 'interieur' | 'mitoyen';

/** Structure d'export compatible avec MursParametriquePanel */
export interface MurWallExport {
  id: string;
  name: string;
  lengthIn: number;
  type: WallType;
  thicknessIn: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  angleDeg: number;
}

// ============================================
// CONSTANTES
// ============================================

export const DEFAULT_GRID_IN = 6;
export const WALL_THICKNESS: Record<WallType, number> = {
  exterieur: 6,
  interieur: 3.5,
  mitoyen: 7,
};
export const COLORS = {
  exterieur: '#92400e',
  interieur: '#a3a3a3',
  mitoyen: '#1e40af',
  selected: '#f59e0b',
  preview: '#3b82f6',
  rule: '#10b981',
  grid: '#e5e7eb',
  gridStrong: '#d1d5db',
  background: '#fafafa',
  point: '#374151',
  pointHover: '#f59e0b',
};
export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const GRID_OPTIONS = [3, 6, 12, 24];
const MIN_WALL_LENGTH_IN = 6;
const CANVAS_PADDING = 1200; // zone de dessin en pouces

// ============================================
// FONCTIONS PURES EXPORTEES
// ============================================

/** Snap une valeur a la grille (multiplier le plus proche de gridSize) */
export function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

/** Distance euclidienne entre 2 points (retour en pouces) */
export function distanceBetweenPoints(p1: FloorPoint, p2: FloorPoint): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Convertit pouces en format pi-po avec fraction 1/16e (ex: 12'6 1/2") */
export function formatLength(inches: number): string {
  const totalSixteenths = Math.round(inches * 16);
  const feet = Math.floor(totalSixteenths / (12 * 16));
  const remainSixteenths = totalSixteenths - feet * 12 * 16;
  const wholeInches = Math.floor(remainSixteenths / 16);
  const fracSixteenths = remainSixteenths - wholeInches * 16;

  let frac = '';
  if (fracSixteenths > 0) {
    // Reduire fraction
    let num = fracSixteenths;
    let den = 16;
    while (num % 2 === 0 && den % 2 === 0) {
      num /= 2;
      den /= 2;
    }
    frac = ` ${num}/${den}`;
  }

  if (feet === 0 && wholeInches === 0 && fracSixteenths === 0) return `0"`;
  if (feet === 0) return `${wholeInches}${frac}"`;
  return `${feet}'${wholeInches}${frac}"`;
}

/** Aire d'un polygone (formule de Shoelace) - retour en ft2 */
export function polygonArea(points: FloorPoint[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2 / 144;
}

/** Angle en degres entre 2 points (axe X positif = 0) */
export function angleBetweenPoints(p1: FloorPoint, p2: FloorPoint): number {
  return (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
}

/** Convertit un FloorPlan en MurWall[] compatibles MursParametriquePanel */
export function floorPlanToMurWalls(plan: FloorPlan): MurWallExport[] {
  return plan.walls.map((w, idx) => {
    const start = plan.points[w.startId];
    const end = plan.points[w.endId];
    if (!start || !end) {
      return {
        id: w.id,
        name: `Mur ${idx + 1}`,
        lengthIn: 0,
        type: w.type,
        thicknessIn: w.thicknessIn,
        startX: 0, startY: 0, endX: 0, endY: 0,
        angleDeg: 0,
      };
    }
    return {
      id: w.id,
      name: `Mur ${idx + 1}`,
      lengthIn: distanceBetweenPoints(start, end),
      type: w.type,
      thicknessIn: w.thicknessIn,
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y,
      angleDeg: angleBetweenPoints(start, end),
    };
  });
}

/** Genere un ID unique court */
function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Detecte automatiquement les pieces fermees (cycles dans le graphe de murs) */
export function detectClosedRooms(plan: FloorPlan): FloorRoom[] {
  // Construire graphe adjacence
  const adj: Record<string, { neighborId: string; wallId: string }[]> = {};
  for (const w of plan.walls) {
    if (!adj[w.startId]) adj[w.startId] = [];
    if (!adj[w.endId]) adj[w.endId] = [];
    adj[w.startId].push({ neighborId: w.endId, wallId: w.id });
    adj[w.endId].push({ neighborId: w.startId, wallId: w.id });
  }

  const rooms: FloorRoom[] = [];
  const seenCycles = new Set<string>();
  let iterations = 0;
  const MAX_ITERATIONS = 5000;

  // DFS basique pour cycles courts (max 12 points par piece)
  function dfs(start: string, current: string, path: string[], wallPath: string[], depth: number) {
    if (++iterations > MAX_ITERATIONS) return;
    if (depth > 12) return;
    const neighbors = adj[current] || [];
    for (const { neighborId, wallId } of neighbors) {
      if (wallPath.includes(wallId)) continue;
      if (neighborId === start && path.length >= 3) {
        // Cycle ferme trouve
        const sortedKey = [...wallPath, wallId].sort().join('|');
        if (seenCycles.has(sortedKey)) continue;
        seenCycles.add(sortedKey);
        const polyPoints = path.map((pid) => plan.points[pid]).filter(Boolean);
        const area = polygonArea(polyPoints);
        if (area > 1) {
          rooms.push({
            id: genId('room'),
            label: `Piece ${rooms.length + 1}`,
            wallIds: [...wallPath, wallId],
            areaFt2: area,
          });
        }
        continue;
      }
      if (path.includes(neighborId)) continue;
      dfs(start, neighborId, [...path, neighborId], [...wallPath, wallId], depth + 1);
    }
  }

  const pointIds = Object.keys(adj);
  for (const pid of pointIds) {
    if (iterations > MAX_ITERATIONS) break; // Cutoff strict de securite
    dfs(pid, pid, [pid], [], 0);
    if (rooms.length > 20) break; // Safe-guard
  }

  return rooms;
}

// ============================================
// VALEURS PAR DEFAUT
// ============================================

function createEmptyPlan(): FloorPlan {
  return {
    id: genId('plan'),
    levelId: 1,
    name: 'Nouveau plan',
    points: {},
    walls: [],
    rooms: [],
    openings: [],
    gridSizeIn: DEFAULT_GRID_IN,
  };
}

// ============================================
// PROPS DU COMPOSANT
// ============================================

interface FloorPlanEditorProps {
  initialPlan?: FloorPlan;
  onSave?: (plan: FloorPlan) => void;
  onConvertToMurs?: (walls: MurWallExport[]) => void;
}

// ============================================
// COMPOSANT
// ============================================

export default function FloorPlanEditor({
  initialPlan,
  onSave,
  onConvertToMurs,
}: FloorPlanEditorProps) {
  // ---------- ETAT ----------
  const [plan, setPlan] = useState<FloorPlan>(() => initialPlan ?? createEmptyPlan());
  const [tool, setTool] = useState<ToolMode>('select');
  const [activeWallType, setActiveWallType] = useState<WallType>('exterieur');
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<FloorPoint>({ x: 200, y: 200 });
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [drawStart, setDrawStart] = useState<FloorPoint | null>(null);
  const [drawStartId, setDrawStartId] = useState<string | null>(null);
  const [ruleStart, setRuleStart] = useState<FloorPoint | null>(null);
  const [cursor, setCursor] = useState<FloorPoint>({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState<FloorPoint>({ x: 0, y: 0 });
  const [draggingPan, setDraggingPan] = useState<boolean>(false);
  const [draggingPoint, setDraggingPoint] = useState<string | null>(null);
  const [panStart, setPanStart] = useState<FloorPoint | null>(null);
  const [spacePressed, setSpacePressed] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>('');

  const svgRef = useRef<SVGSVGElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  // Reference vers deleteWall pour que le handler clavier ait toujours la derniere version
  // sans avoir a se reattacher (et sans avertissement ESLint sur les deps).
  const deleteWallRef = useRef<((wallId: string) => void) | null>(null);

  // ---------- GESTION ESPACE = PAN ----------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ne pas intercepter les touches quand l'utilisateur tape dans un champ
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'Space') setSpacePressed(true);
      if (e.key === 'Escape') {
        setDrawStart(null);
        setDrawStartId(null);
        setRuleStart(null);
        setSelectedWallId(null);
        setSelectedPointId(null);
      }
      if (e.key === 'Delete' && selectedWallId) {
        deleteWallRef.current?.(selectedWallId);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    // Si la touche Espace est relachee hors fenetre, on doit reinitialiser spacePressed
    const onBlur = () => setSpacePressed(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [selectedWallId]);

  // ---------- CONVERSION COORD ECRAN <-> MONDE ----------
  const screenToWorld = useCallback(
    (sx: number, sy: number): FloorPoint => {
      return {
        x: (sx - pan.x) / zoom,
        y: (sy - pan.y) / zoom,
      };
    },
    [pan, zoom],
  );

  const worldToScreen = useCallback(
    (wx: number, wy: number): FloorPoint => {
      return {
        x: wx * zoom + pan.x,
        y: wy * zoom + pan.y,
      };
    },
    [pan, zoom],
  );

  // ---------- TROUVE OU CREE POINT (avec snap+fusion) ----------
  const findOrCreatePoint = useCallback(
    (worldX: number, worldY: number, currentPlan: FloorPlan): { pointId: string; updated: FloorPlan } => {
      const snapX = snapToGrid(worldX, currentPlan.gridSizeIn);
      const snapY = snapToGrid(worldY, currentPlan.gridSizeIn);
      // Cherche un point existant proche (< gridSize/4)
      const tolerance = currentPlan.gridSizeIn / 2;
      for (const [pid, p] of Object.entries(currentPlan.points)) {
        if (Math.abs(p.x - snapX) < tolerance && Math.abs(p.y - snapY) < tolerance) {
          return { pointId: pid, updated: currentPlan };
        }
      }
      const newId = genId('pt');
      const newPlan: FloorPlan = {
        ...currentPlan,
        points: { ...currentPlan.points, [newId]: { x: snapX, y: snapY } },
      };
      return { pointId: newId, updated: newPlan };
    },
    [],
  );

  // ---------- AJOUTER UN MUR ----------
  const addWall = useCallback(
    (worldStart: FloorPoint, worldEnd: FloorPoint) => {
      setPlan((prev) => {
        const r1 = findOrCreatePoint(worldStart.x, worldStart.y, prev);
        const r2 = findOrCreatePoint(worldEnd.x, worldEnd.y, r1.updated);
        if (r1.pointId === r2.pointId) {
          setStatusMsg('Mur invalide : meme point de depart et de fin.');
          return prev;
        }
        const startPt = r2.updated.points[r1.pointId];
        const endPt = r2.updated.points[r2.pointId];
        const dist = distanceBetweenPoints(startPt, endPt);
        if (dist < MIN_WALL_LENGTH_IN) {
          setStatusMsg(`Mur trop court (${formatLength(dist)}). Minimum 6".`);
          return prev;
        }
        // Verifier doublon
        const exists = r2.updated.walls.some(
          (w) =>
            (w.startId === r1.pointId && w.endId === r2.pointId) ||
            (w.startId === r2.pointId && w.endId === r1.pointId),
        );
        if (exists) {
          setStatusMsg('Ce mur existe deja.');
          return prev;
        }
        const newWall: FloorWall = {
          id: genId('wall'),
          startId: r1.pointId,
          endId: r2.pointId,
          type: activeWallType,
          thicknessIn: WALL_THICKNESS[activeWallType],
        };
        setStatusMsg(`Mur ajoute : ${formatLength(dist)} (${activeWallType}).`);
        return { ...r2.updated, walls: [...r2.updated.walls, newWall] };
      });
    },
    [activeWallType, findOrCreatePoint],
  );

  // ---------- AJOUTER PIECE RECTANGLE ----------
  const addRoomRect = useCallback(
    (worldStart: FloorPoint, worldEnd: FloorPoint) => {
      const x1 = snapToGrid(Math.min(worldStart.x, worldEnd.x), plan.gridSizeIn);
      const y1 = snapToGrid(Math.min(worldStart.y, worldEnd.y), plan.gridSizeIn);
      const x2 = snapToGrid(Math.max(worldStart.x, worldEnd.x), plan.gridSizeIn);
      const y2 = snapToGrid(Math.max(worldStart.y, worldEnd.y), plan.gridSizeIn);
      if (x2 - x1 < MIN_WALL_LENGTH_IN || y2 - y1 < MIN_WALL_LENGTH_IN) {
        setStatusMsg('Piece trop petite.');
        return;
      }
      setPlan((prev) => {
        let working = prev;
        const p1 = findOrCreatePoint(x1, y1, working);
        working = p1.updated;
        const p2 = findOrCreatePoint(x2, y1, working);
        working = p2.updated;
        const p3 = findOrCreatePoint(x2, y2, working);
        working = p3.updated;
        const p4 = findOrCreatePoint(x1, y2, working);
        working = p4.updated;
        const pairs: [string, string][] = [
          [p1.pointId, p2.pointId],
          [p2.pointId, p3.pointId],
          [p3.pointId, p4.pointId],
          [p4.pointId, p1.pointId],
        ];
        const newWalls: FloorWall[] = pairs.map(([sId, eId]) => ({
          id: genId('wall'),
          startId: sId,
          endId: eId,
          type: activeWallType,
          thicknessIn: WALL_THICKNESS[activeWallType],
        }));
        setStatusMsg(`Piece rectangulaire ajoutee (4 murs).`);
        return { ...working, walls: [...working.walls, ...newWalls] };
      });
    },
    [activeWallType, findOrCreatePoint, plan.gridSizeIn],
  );

  // ---------- SUPPRIMER MUR ----------
  const deleteWall = useCallback((wallId: string) => {
    setPlan((prev) => {
      const newWalls = prev.walls.filter((w) => w.id !== wallId);
      // Nettoyer points orphelins
      const usedPointIds = new Set<string>();
      newWalls.forEach((w) => {
        usedPointIds.add(w.startId);
        usedPointIds.add(w.endId);
      });
      const newPoints: Record<string, FloorPoint> = {};
      Object.entries(prev.points).forEach(([pid, p]) => {
        if (usedPointIds.has(pid)) newPoints[pid] = p;
      });
      return { ...prev, walls: newWalls, points: newPoints };
    });
    setSelectedWallId(null);
    setStatusMsg('Mur supprime.');
  }, []);

  // Garde la reference vers la derniere version de deleteWall a jour pour le handler clavier
  useEffect(() => {
    deleteWallRef.current = deleteWall;
  }, [deleteWall]);

  // ---------- HANDLERS SOURIS ----------
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // Throttle via requestAnimationFrame pour eviter un re-render par pixel
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        setMousePos({ x: sx, y: sy });
        const world = screenToWorld(sx, sy);
        const snapped = {
          x: snapToGrid(world.x, plan.gridSizeIn),
          y: snapToGrid(world.y, plan.gridSizeIn),
        };
        setCursor(snapped);

        // Pan en cours
        if (draggingPan && panStart) {
          setPan({
            x: pan.x + (sx - panStart.x),
            y: pan.y + (sy - panStart.y),
          });
          setPanStart({ x: sx, y: sy });
        }

        // Drag d'un point : on valide que tous les murs connectes restent >= MIN_WALL_LENGTH_IN
        if (draggingPoint) {
          // TODO: merge points proches lors drag (fusionner deux extremites quand l'utilisateur
          // depose un point exactement sur un autre point existant pour eviter les doublons).
          const dragId = draggingPoint;
          setPlan((prev) => {
            const wallsWithThisPoint = prev.walls.filter(
              (w) => w.startId === dragId || w.endId === dragId,
            );
            const allValid = wallsWithThisPoint.every((w) => {
              const start = w.startId === dragId ? snapped : prev.points[w.startId];
              const end = w.endId === dragId ? snapped : prev.points[w.endId];
              if (!start || !end) return true;
              return distanceBetweenPoints(start, end) >= MIN_WALL_LENGTH_IN;
            });
            if (!allValid) return prev; // Rejette le drag pour preserver les longueurs minimales
            return {
              ...prev,
              points: {
                ...prev.points,
                [dragId]: { x: snapped.x, y: snapped.y },
              },
            };
          });
        }
      });
    },
    [draggingPan, panStart, pan, screenToWorld, plan.gridSizeIn, draggingPoint],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // Pan declenche par espace ou bouton du milieu
      if (spacePressed || e.button === 1) {
        setDraggingPan(true);
        setPanStart({ x: sx, y: sy });
        return;
      }
    },
    [spacePressed],
  );

  const handleMouseUp = useCallback(() => {
    setDraggingPan(false);
    setPanStart(null);
    setDraggingPoint(null);
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (spacePressed) return;
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = screenToWorld(sx, sy);
      const snapped = {
        x: snapToGrid(world.x, plan.gridSizeIn),
        y: snapToGrid(world.y, plan.gridSizeIn),
      };

      if (tool === 'select') {
        setSelectedWallId(null);
        return;
      }
      if (tool === 'draw-wall') {
        if (!drawStart) {
          setDrawStart(snapped);
          setStatusMsg('Clic pour le 2e point du mur.');
        } else {
          addWall(drawStart, snapped);
          setDrawStart(null);
        }
        return;
      }
      if (tool === 'draw-room') {
        if (!drawStart) {
          setDrawStart(snapped);
          setStatusMsg('Clic pour le coin oppose de la piece.');
        } else {
          addRoomRect(drawStart, snapped);
          setDrawStart(null);
        }
        return;
      }
      if (tool === 'rule') {
        if (!ruleStart) {
          setRuleStart(snapped);
          setStatusMsg('Clic pour la fin de la mesure.');
        } else {
          const dist = distanceBetweenPoints(ruleStart, snapped);
          setStatusMsg(`Mesure : ${formatLength(dist)}`);
          setRuleStart(null);
        }
        return;
      }
    },
    [spacePressed, screenToWorld, plan.gridSizeIn, tool, drawStart, addWall, addRoomRect, ruleStart],
  );

  const handleWallClick = useCallback(
    (e: React.MouseEvent, wallId: string) => {
      e.stopPropagation();
      if (tool === 'delete') {
        if (!window.confirm('Supprimer ce mur ?')) return;
        deleteWall(wallId);
        return;
      }
      setSelectedWallId(wallId);
      setStatusMsg(`Mur ${wallId.slice(-5)} selectionne.`);
    },
    [tool, deleteWall],
  );

  const handlePointMouseDown = useCallback(
    (e: React.MouseEvent, pointId: string) => {
      e.stopPropagation();
      if (tool === 'select') {
        setSelectedPointId(pointId);
        setDraggingPoint(pointId);
      }
    },
    [tool],
  );

  // ---------- ZOOM ----------
  const zoomIn = useCallback(() => {
    const idx = ZOOM_LEVELS.findIndex((z) => z >= zoom);
    if (idx >= 0 && idx < ZOOM_LEVELS.length - 1) {
      setZoom(ZOOM_LEVELS[idx + 1]);
    }
  }, [zoom]);

  const zoomOut = useCallback(() => {
    const idx = ZOOM_LEVELS.findIndex((z) => z >= zoom);
    if (idx > 0) {
      setZoom(ZOOM_LEVELS[idx - 1]);
    }
  }, [zoom]);

  // ---------- SAUVEGARDE / EXPORT ----------
  const handleSave = useCallback(() => {
    if (onSave) onSave(plan);
    const json = JSON.stringify(plan, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${plan.name.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg('Plan sauvegarde.');
  }, [plan, onSave]);

  const handleConvert = useCallback(() => {
    const exported = floorPlanToMurWalls(plan);
    if (onConvertToMurs) onConvertToMurs(exported);
    setStatusMsg(`${exported.length} murs exportes vers le panneau parametrique.`);
  }, [plan, onConvertToMurs]);

  const handleClear = useCallback(() => {
    if (confirm('Effacer tout le plan ?')) {
      setPlan(createEmptyPlan());
      setSelectedWallId(null);
      setSelectedPointId(null);
      setStatusMsg('Plan efface.');
    }
  }, []);

  // ---------- DETECTION PIECES (memo) ----------
  const detectedRooms = useMemo(() => detectClosedRooms(plan), [plan]);

  // ---------- VALIDATION ----------
  const validation = useMemo(() => {
    const issues: string[] = [];
    plan.walls.forEach((w) => {
      const s = plan.points[w.startId];
      const e = plan.points[w.endId];
      if (s && e) {
        const d = distanceBetweenPoints(s, e);
        if (d < MIN_WALL_LENGTH_IN) issues.push(`Mur ${w.id.slice(-5)} : trop court (${formatLength(d)})`);
      }
    });
    // Compter degres de chaque point
    const degree: Record<string, number> = {};
    plan.walls.forEach((w) => {
      degree[w.startId] = (degree[w.startId] || 0) + 1;
      degree[w.endId] = (degree[w.endId] || 0) + 1;
    });
    const openPoints = Object.entries(degree).filter(([, d]) => d === 1).length;
    if (openPoints > 0 && plan.walls.length > 0) {
      issues.push(`${openPoints} extremite(s) non connectee(s) - polygone ouvert.`);
    }
    return issues;
  }, [plan]);

  // ---------- GRID RENDER ----------
  const gridLines = useMemo(() => {
    if (!showGrid) return null;
    const lines: JSX.Element[] = [];
    const step = plan.gridSizeIn * zoom;
    const w = 2000;
    const h = 2000;
    const offsetX = pan.x % step;
    const offsetY = pan.y % step;
    const major = plan.gridSizeIn === 6 ? 12 : plan.gridSizeIn === 3 ? 12 : 4; // tous les X traits

    let idx = 0;
    for (let x = offsetX; x < w; x += step, idx++) {
      const isMajor = idx % major === 0;
      lines.push(
        <line
          key={`vx${x}`}
          x1={x}
          y1={0}
          x2={x}
          y2={h}
          stroke={isMajor ? COLORS.gridStrong : COLORS.grid}
          strokeWidth={isMajor ? 1 : 0.5}
        />,
      );
    }
    idx = 0;
    for (let y = offsetY; y < h; y += step, idx++) {
      const isMajor = idx % major === 0;
      lines.push(
        <line
          key={`hy${y}`}
          x1={0}
          y1={y}
          x2={w}
          y2={y}
          stroke={isMajor ? COLORS.gridStrong : COLORS.grid}
          strokeWidth={isMajor ? 1 : 0.5}
        />,
      );
    }
    return <g>{lines}</g>;
  }, [showGrid, plan.gridSizeIn, zoom, pan]);

  // ---------- RENDU ----------
  const cursorStyle = useMemo(() => {
    if (spacePressed || draggingPan) return 'grabbing';
    if (tool === 'draw-wall' || tool === 'draw-room' || tool === 'rule') return 'crosshair';
    if (tool === 'delete') return 'not-allowed';
    return 'default';
  }, [tool, spacePressed, draggingPan]);

  return (
    <div className="w-full h-full flex flex-col bg-gray-50 select-none" style={{ minHeight: '600px' }}>
      {/* ---------- BARRE HAUT ---------- */}
      <div className="flex items-center justify-between bg-white border-b border-gray-200 px-4 py-2 gap-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-gray-600" />
          <select
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            value={plan.levelId}
            onChange={(e) => setPlan((p) => ({ ...p, levelId: parseInt(e.target.value, 10) }))}
          >
            <option value={1}>Niveau 1</option>
            <option value={2}>Niveau 2</option>
            <option value={3}>Niveau 3</option>
          </select>
          <input
            type="text"
            value={plan.name}
            onChange={(e) => setPlan((p) => ({ ...p, name: e.target.value }))}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-48"
            placeholder="Nom du plan"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 border border-gray-300 rounded px-2 py-1">
            <span className="text-xs text-gray-600">Grille :</span>
            <select
              className="text-sm border-none focus:outline-none bg-transparent"
              value={plan.gridSizeIn}
              onChange={(e) =>
                setPlan((p) => ({ ...p, gridSizeIn: parseInt(e.target.value, 10) }))
              }
            >
              {GRID_OPTIONS.map((g) => (
                <option key={g} value={g}>{`${g}"`}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => setShowGrid((v) => !v)}
            className="p-2 rounded hover:bg-gray-100 border border-gray-300"
            title={showGrid ? 'Cacher grille' : 'Afficher grille'}
          >
            {showGrid ? <Grid3x3 className="w-4 h-4" /> : <Grid3x3 className="w-4 h-4 text-gray-300" />}
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={zoomOut}
              className="p-2 rounded hover:bg-gray-100 border border-gray-300"
              title="Zoom -"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-sm w-12 text-center font-medium">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={zoomIn}
              className="p-2 rounded hover:bg-gray-100 border border-gray-300"
              title="Zoom +"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
            title="Sauvegarder le plan"
          >
            <Save className="w-4 h-4" />
            Sauvegarder
          </button>

          <button
            type="button"
            onClick={handleConvert}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
            title="Convertir en murs parametriques"
          >
            <Download className="w-4 h-4" />
            Exporter murs
          </button>
        </div>
      </div>

      {/* ---------- ZONE CENTRALE ---------- */}
      <div className="flex flex-1 overflow-hidden">
        {/* ---------- TOOLBAR GAUCHE ---------- */}
        <div className="w-14 bg-white border-r border-gray-200 flex flex-col items-center py-3 gap-1">
          <ToolButton icon={<MousePointer2 />} label="Selection" active={tool === 'select'} onClick={() => setTool('select')} />
          <ToolButton icon={<Minus />} label="Mur" active={tool === 'draw-wall'} onClick={() => setTool('draw-wall')} />
          <ToolButton icon={<Square />} label="Piece" active={tool === 'draw-room'} onClick={() => setTool('draw-room')} />
          <ToolButton icon={<Ruler />} label="Mesure" active={tool === 'rule'} onClick={() => setTool('rule')} />
          <ToolButton icon={<Scissors />} label="Supprimer" active={tool === 'delete'} onClick={() => setTool('delete')} />
          <ToolButton icon={<DoorOpen />} label="Ouverture" active={tool === 'add-opening'} onClick={() => setTool('add-opening')} />
          <div className="border-t border-gray-200 w-8 my-2" />
          <ToolButton icon={<Camera />} label="Vue" active={false} onClick={() => setStatusMsg('Vue de dessus 2D')} />
          <ToolButton icon={<Eye />} label="Apercu" active={false} onClick={() => setStatusMsg(`Aperçu : ${plan.walls.length} murs`)} />
          <div className="border-t border-gray-200 w-8 my-2" />
          <ToolButton icon={<Trash2 />} label="Tout effacer" active={false} onClick={handleClear} />
        </div>

        {/* ---------- CANVAS SVG ---------- */}
        <div className="flex-1 relative overflow-hidden bg-gray-100">
          <svg
            ref={svgRef}
            className="w-full h-full"
            style={{ cursor: cursorStyle, backgroundColor: COLORS.background }}
            onClick={handleCanvasClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Grille */}
            {gridLines}

            {/* Groupe transforme (pan + zoom) */}
            <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
              {/* Murs */}
              {plan.walls.map((w) => {
                const start = plan.points[w.startId];
                const end = plan.points[w.endId];
                if (!start || !end) return null;
                const isSel = selectedWallId === w.id;
                const color = isSel ? COLORS.selected : COLORS[w.type];
                const thicknessPx = (w.thicknessIn / zoom) * (zoom * 0.7);
                const len = distanceBetweenPoints(start, end);
                const midX = (start.x + end.x) / 2;
                const midY = (start.y + end.y) / 2;
                const angle = angleBetweenPoints(start, end);
                return (
                  <g key={w.id}>
                    {/* Trait epais cliquable */}
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                      stroke={color}
                      strokeWidth={w.thicknessIn}
                      strokeLinecap="butt"
                      style={{ cursor: tool === 'delete' ? 'not-allowed' : 'pointer' }}
                      onClick={(e) => handleWallClick(e, w.id)}
                    />
                    {/* Trait fin pour visibilite */}
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                      stroke="#000"
                      strokeWidth={0.5 / zoom}
                      pointerEvents="none"
                    />
                    {/* Etiquette longueur */}
                    {len > 0 && (
                      <text
                        x={midX}
                        y={midY}
                        fontSize={11 / zoom}
                        fontWeight="600"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        transform={`rotate(${angle}, ${midX}, ${midY})`}
                        fill="#111"
                        style={{ pointerEvents: 'none', paintOrder: 'stroke fill' }}
                        stroke="#fff"
                        strokeWidth={3 / zoom}
                      >
                        {formatLength(len)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Points (extremites) */}
              {Object.entries(plan.points).map(([pid, p]) => {
                const isSel = selectedPointId === pid;
                return (
                  <circle
                    key={pid}
                    cx={p.x}
                    cy={p.y}
                    r={4 / zoom}
                    fill={isSel ? COLORS.pointHover : COLORS.point}
                    stroke="#fff"
                    strokeWidth={1 / zoom}
                    style={{ cursor: tool === 'select' ? 'move' : 'default' }}
                    onMouseDown={(e) => handlePointMouseDown(e, pid)}
                  />
                );
              })}

              {/* Preview de mur en cours */}
              {drawStart && tool === 'draw-wall' && (
                <line
                  x1={drawStart.x}
                  y1={drawStart.y}
                  x2={cursor.x}
                  y2={cursor.y}
                  stroke={COLORS.preview}
                  strokeWidth={WALL_THICKNESS[activeWallType]}
                  strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                  opacity={0.6}
                  pointerEvents="none"
                />
              )}

              {/* Preview rectangle piece */}
              {drawStart && tool === 'draw-room' && (
                <rect
                  x={Math.min(drawStart.x, cursor.x)}
                  y={Math.min(drawStart.y, cursor.y)}
                  width={Math.abs(cursor.x - drawStart.x)}
                  height={Math.abs(cursor.y - drawStart.y)}
                  fill="none"
                  stroke={COLORS.preview}
                  strokeWidth={WALL_THICKNESS[activeWallType]}
                  strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                  opacity={0.5}
                  pointerEvents="none"
                />
              )}

              {/* Preview regle */}
              {ruleStart && tool === 'rule' && (
                <>
                  <line
                    x1={ruleStart.x}
                    y1={ruleStart.y}
                    x2={cursor.x}
                    y2={cursor.y}
                    stroke={COLORS.rule}
                    strokeWidth={1.5 / zoom}
                    strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                    pointerEvents="none"
                  />
                  <text
                    x={(ruleStart.x + cursor.x) / 2}
                    y={(ruleStart.y + cursor.y) / 2 - 8 / zoom}
                    fontSize={12 / zoom}
                    fontWeight="700"
                    fill={COLORS.rule}
                    textAnchor="middle"
                    stroke="#fff"
                    strokeWidth={3 / zoom}
                    style={{ pointerEvents: 'none', paintOrder: 'stroke fill' }}
                  >
                    {formatLength(distanceBetweenPoints(ruleStart, cursor))}
                  </text>
                </>
              )}

              {/* Etiquettes pieces detectees */}
              {detectedRooms.map((r) => {
                const pts = r.wallIds
                  .map((wid) => plan.walls.find((w) => w.id === wid))
                  .filter(Boolean)
                  .flatMap((w) => [plan.points[w!.startId], plan.points[w!.endId]])
                  .filter(Boolean);
                if (pts.length === 0) return null;
                const cx = pts.reduce((s, p) => s + p!.x, 0) / pts.length;
                const cy = pts.reduce((s, p) => s + p!.y, 0) / pts.length;
                return (
                  <g key={r.id} pointerEvents="none">
                    <text
                      x={cx}
                      y={cy}
                      fontSize={14 / zoom}
                      fontWeight="700"
                      textAnchor="middle"
                      fill="#1e3a8a"
                    >
                      {r.label}
                    </text>
                    <text
                      x={cx}
                      y={cy + 16 / zoom}
                      fontSize={11 / zoom}
                      textAnchor="middle"
                      fill="#475569"
                    >
                      {r.areaFt2.toFixed(1)} pi²
                    </text>
                  </g>
                );
              })}
            </g>

            {/* Indicateur snap (point a la position curseur) */}
            <circle
              cx={worldToScreen(cursor.x, cursor.y).x}
              cy={worldToScreen(cursor.x, cursor.y).y}
              r={4}
              fill="none"
              stroke="#ef4444"
              strokeWidth={1.5}
              pointerEvents="none"
              opacity={0.6}
            />
          </svg>

          {/* Selecteur type de mur en overlay */}
          {(tool === 'draw-wall' || tool === 'draw-room') && (
            <div className="absolute top-3 left-3 bg-white rounded shadow border border-gray-200 p-2 flex gap-1">
              {(['exterieur', 'interieur', 'mitoyen'] as WallType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setActiveWallType(t)}
                  className={`px-3 py-1 rounded text-xs font-medium border ${
                    activeWallType === t
                      ? 'text-white border-transparent'
                      : 'bg-white text-gray-700 border-gray-300'
                  }`}
                  style={{
                    backgroundColor: activeWallType === t ? COLORS[t] : undefined,
                  }}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)} ({WALL_THICKNESS[t]}")
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ---------- SIDEBAR DROITE ---------- */}
        <div className="w-72 bg-white border-l border-gray-200 overflow-y-auto">
          <div className="p-3 border-b border-gray-200">
            <h3 className="font-semibold text-sm text-gray-800 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Elements du plan
            </h3>
            <div className="mt-2 text-xs text-gray-600 space-y-1">
              <div>Points : {Object.keys(plan.points).length}</div>
              <div>Murs : {plan.walls.length}</div>
              <div>Pieces detectees : {detectedRooms.length}</div>
              <div>Ouvertures : {plan.openings.length}</div>
            </div>
          </div>

          {/* Liste des murs */}
          <div className="p-3 border-b border-gray-200">
            <h4 className="font-semibold text-xs uppercase text-gray-600 mb-2">Murs ({plan.walls.length})</h4>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {plan.walls.length === 0 && (
                <div className="text-xs text-gray-400 italic">Aucun mur dessine.</div>
              )}
              {plan.walls.map((w, idx) => {
                const s = plan.points[w.startId];
                const e = plan.points[w.endId];
                const len = s && e ? distanceBetweenPoints(s, e) : 0;
                const isSel = selectedWallId === w.id;
                return (
                  <div
                    key={w.id}
                    className={`flex items-center justify-between p-2 rounded text-xs cursor-pointer border ${
                      isSel ? 'bg-amber-50 border-amber-400' : 'bg-gray-50 border-transparent hover:border-gray-300'
                    }`}
                    onClick={() => setSelectedWallId(w.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-3 h-3 rounded"
                        style={{ backgroundColor: COLORS[w.type] }}
                      />
                      <span className="font-medium">M{idx + 1}</span>
                      <span className="text-gray-600">{formatLength(len)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        deleteWall(w.id);
                      }}
                      className="text-red-600 hover:text-red-800"
                      title="Supprimer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Liste des pieces */}
          {detectedRooms.length > 0 && (
            <div className="p-3 border-b border-gray-200">
              <h4 className="font-semibold text-xs uppercase text-gray-600 mb-2">
                Pieces ({detectedRooms.length})
              </h4>
              <div className="space-y-1">
                {detectedRooms.map((r) => (
                  <div key={r.id} className="flex justify-between items-center p-2 bg-blue-50 rounded text-xs">
                    <span className="font-medium text-blue-900">{r.label}</span>
                    <span className="text-blue-700">{r.areaFt2.toFixed(1)} pi²</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Validation */}
          {validation.length > 0 && (
            <div className="p-3 border-b border-gray-200">
              <h4 className="font-semibold text-xs uppercase text-orange-600 mb-2">
                Avertissements ({validation.length})
              </h4>
              <ul className="space-y-1 text-xs text-orange-700">
                {validation.map((v, i) => (
                  <li key={i}>• {v}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Selection mur details */}
          {selectedWallId && (() => {
            const w = plan.walls.find((x) => x.id === selectedWallId);
            if (!w) return null;
            return (
              <div className="p-3 border-b border-gray-200">
                <h4 className="font-semibold text-xs uppercase text-gray-600 mb-2">Detail mur</h4>
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="block text-gray-600 mb-1">Type</label>
                    <select
                      className="w-full border border-gray-300 rounded p-1"
                      value={w.type}
                      onChange={(ev) => {
                        const t = ev.target.value as WallType;
                        setPlan((prev) => ({
                          ...prev,
                          walls: prev.walls.map((x) =>
                            x.id === w.id ? { ...x, type: t, thicknessIn: WALL_THICKNESS[t] } : x,
                          ),
                        }));
                      }}
                    >
                      <option value="exterieur">Exterieur (6")</option>
                      <option value="interieur">Interieur (3.5")</option>
                      <option value="mitoyen">Mitoyen (7")</option>
                    </select>
                  </div>
                  <div className="text-gray-600">
                    Epaisseur : <span className="font-medium text-gray-900">{w.thicknessIn}"</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ---------- BARRE STATUS BAS ---------- */}
      <div className="flex items-center justify-between bg-gray-800 text-white px-4 py-1.5 text-xs">
        <div className="flex items-center gap-4">
          <span>Mode : <strong>{toolLabel(tool)}</strong></span>
          <span>Curseur : ({cursor.x.toFixed(0)}", {cursor.y.toFixed(0)}")</span>
          <span>Murs : {plan.walls.length}</span>
          <span>Pieces : {detectedRooms.length}</span>
        </div>
        <div className="text-gray-300" role="status" aria-live="polite">
          {statusMsg || 'Pret. Espace + drag = pan. Echap = annuler.'}
        </div>
      </div>
    </div>
  );
}

// ============================================
// SOUS-COMPOSANTS
// ============================================

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function ToolButton({ icon, label, active, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      <span className="w-5 h-5 flex items-center justify-center">{icon}</span>
    </button>
  );
}

function toolLabel(t: ToolMode): string {
  switch (t) {
    case 'select': return 'Selection';
    case 'draw-wall': return 'Dessiner mur';
    case 'draw-room': return 'Dessiner piece';
    case 'rule': return 'Mesure';
    case 'delete': return 'Supprimer';
    case 'add-opening': return 'Ajouter ouverture';
    default: return t;
  }
}
