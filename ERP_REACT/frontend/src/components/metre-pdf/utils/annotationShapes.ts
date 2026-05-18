import { Line, Polygon, FabricText, Path } from 'fabric';
import type { Point } from '../types';

/**
 * Create an arrow (line with arrowhead) at display coordinates.
 */
export function createArrowObjects(
  points: Point[],
  zoom: number,
  color: string,
  strokeWidth: number,
  opacity: number,
  label?: string,
  fontSize?: number,
): any[] {
  if (points.length < 2) return [];
  const [p0, p1] = points;
  const x1 = p0.x * zoom, y1 = p0.y * zoom;
  const x2 = p1.x * zoom, y2 = p1.y * zoom;

  const objects: any[] = [];

  // Main line
  objects.push(new Line([x1, y1, x2, y2], {
    stroke: color, strokeWidth, opacity,
    selectable: false, evented: false,
  }));

  // Arrowhead (triangle at end point)
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 12 * (strokeWidth / 2);
  const ax1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
  const ay1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
  const ax2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
  const ay2 = y2 - headLen * Math.sin(angle + Math.PI / 6);

  objects.push(new Polygon(
    [{ x: x2, y: y2 }, { x: ax1, y: ay1 }, { x: ax2, y: ay2 }],
    { fill: color, stroke: color, strokeWidth: 1, opacity, selectable: false, evented: false },
  ));

  // Label at midpoint
  if (label) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const size = Math.max(8, (fontSize ?? 14) * Math.sqrt(zoom));
    objects.push(new FabricText(label, {
      left: mx, top: my - size - 4,
      fontSize: size, fill: color,
      fontFamily: 'sans-serif', fontWeight: 'bold', opacity,
      backgroundColor: 'rgba(0,0,0,0.5)', padding: 2,
      selectable: false, evented: false,
    }));
  }

  return objects;
}

/**
 * Create a revision cloud (scalloped polygon) at display coordinates.
 */
export function createCloudObjects(
  points: Point[],
  zoom: number,
  color: string,
  strokeWidth: number,
  opacity: number,
  label?: string,
  fontSize?: number,
): any[] {
  if (points.length < 3) return [];

  const objects: any[] = [];
  const scaledPts = points.map(p => ({ x: p.x * zoom, y: p.y * zoom }));

  // Draw scalloped arcs between consecutive points
  // Use a series of small arcs (bumps) along each edge
  let pathData = '';
  for (let i = 0; i < scaledPts.length; i++) {
    const curr = scaledPts[i];
    const next = scaledPts[(i + 1) % scaledPts.length];
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);

    // Number of bumps proportional to segment length
    const bumpSize = 15;
    const numBumps = Math.max(1, Math.round(segLen / bumpSize));
    const stepX = dx / numBumps;
    const stepY = dy / numBumps;

    for (let j = 0; j < numBumps; j++) {
      const sx = curr.x + stepX * j;
      const sy = curr.y + stepY * j;
      const ex = curr.x + stepX * (j + 1);
      const ey = curr.y + stepY * (j + 1);
      const r = Math.sqrt(stepX * stepX + stepY * stepY) / 2;

      if (j === 0 && i === 0) {
        pathData += `M ${sx} ${sy} `;
      }
      // Arc: A rx ry rotation large-arc-flag sweep-flag x y
      pathData += `A ${r} ${r} 0 0 1 ${ex} ${ey} `;
    }
  }

  // Close path
  pathData += 'Z';

  try {
    const path = new Path(pathData, {
      stroke: color,
      strokeWidth,
      fill: 'transparent',
      opacity,
      selectable: false,
      evented: false,
    });
    objects.push(path);
  } catch {
    // Fallback: just draw as polygon outline
    objects.push(new Polygon(
      scaledPts,
      { stroke: color, strokeWidth, fill: 'transparent', opacity, strokeDashArray: [5, 3], selectable: false, evented: false },
    ));
  }

  // Label at centroid
  if (label) {
    const cx = scaledPts.reduce((s, p) => s + p.x, 0) / scaledPts.length;
    const cy = scaledPts.reduce((s, p) => s + p.y, 0) / scaledPts.length;
    const size = Math.max(8, (fontSize ?? 14) * Math.sqrt(zoom));
    objects.push(new FabricText(label, {
      left: cx, top: cy,
      fontSize: size, fill: color,
      fontFamily: 'sans-serif', fontWeight: 'bold', opacity,
      backgroundColor: 'rgba(0,0,0,0.5)', padding: 2,
      originX: 'center', originY: 'center',
      selectable: false, evented: false,
    }));
  }

  return objects;
}

/**
 * Create freehand path at display coordinates.
 */
export function createFreehandObjects(
  points: Point[],
  zoom: number,
  color: string,
  strokeWidth: number,
  opacity: number,
): any[] {
  if (points.length < 2) return [];

  const scaledPts = points.map(p => ({ x: p.x * zoom, y: p.y * zoom }));

  // Build SVG path with smooth curves
  let pathData = `M ${scaledPts[0].x} ${scaledPts[0].y}`;
  for (let i = 1; i < scaledPts.length; i++) {
    // Use quadratic curves for smoothness
    if (i < scaledPts.length - 1) {
      const midX = (scaledPts[i].x + scaledPts[i + 1].x) / 2;
      const midY = (scaledPts[i].y + scaledPts[i + 1].y) / 2;
      pathData += ` Q ${scaledPts[i].x} ${scaledPts[i].y} ${midX} ${midY}`;
    } else {
      pathData += ` L ${scaledPts[i].x} ${scaledPts[i].y}`;
    }
  }

  try {
    const path = new Path(pathData, {
      stroke: color,
      strokeWidth: strokeWidth * 1.5,
      fill: 'transparent',
      opacity,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      selectable: false,
      evented: false,
    });
    return [path];
  } catch {
    return [];
  }
}

/**
 * Create a semi-transparent highlight rectangle at display coordinates.
 */
export function createHighlightObjects(
  points: Point[],
  zoom: number,
  color: string,
  _strokeWidth: number,
  opacity: number,
): any[] {
  if (points.length < 3) return [];

  const scaledPts = points.map(p => ({ x: p.x * zoom, y: p.y * zoom }));

  const rect = new Polygon(
    scaledPts,
    {
      fill: color,
      stroke: 'transparent',
      strokeWidth: 0,
      opacity: opacity * 0.25,  // Very transparent
      selectable: false,
      evented: false,
    },
  );

  return [rect];
}

/**
 * Create text annotation at display coordinates.
 */
export function createTextAnnotationObjects(
  points: Point[],
  zoom: number,
  color: string,
  _strokeWidth: number,
  opacity: number,
  label: string,
  customFontSize?: number,
): any[] {
  if (points.length < 1) return [];

  const x = points[0].x * zoom;
  const y = points[0].y * zoom;
  const fontSize = Math.max(8, (customFontSize ?? 14) * Math.sqrt(zoom));

  const text = new FabricText(label || 'Texte', {
    left: x,
    top: y,
    fontSize,
    fill: color,
    fontFamily: 'sans-serif',
    fontWeight: 'bold',
    opacity,
    selectable: false,
    evented: false,
  });

  return [text];
}

/**
 * Create a callout annotation (text box with leader arrow) at display coordinates.
 * points[0] = arrow tip, points[1] = text box position.
 */
export function createCalloutObjects(
  points: Point[],
  zoom: number,
  color: string,
  strokeWidth: number,
  opacity: number,
  label: string,
  fontSize?: number,
): any[] {
  if (points.length < 2) return [];
  const objects: any[] = [];

  const tipX = points[0].x * zoom;
  const tipY = points[0].y * zoom;
  const boxX = points[1].x * zoom;
  const boxY = points[1].y * zoom;
  const size = Math.max(8, (fontSize ?? 12) * Math.sqrt(zoom));
  const displayLabel = label || 'Texte';

  // Text box with background
  const text = new FabricText(displayLabel, {
    left: boxX,
    top: boxY,
    fontSize: size,
    fill: color,
    fontFamily: 'sans-serif',
    fontWeight: 'bold',
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 4,
    opacity,
    selectable: false,
    evented: false,
  });
  objects.push(text);

  // Leader line from text box to arrow tip
  objects.push(new Line([boxX, boxY + size / 2, tipX, tipY], {
    stroke: color,
    strokeWidth,
    opacity,
    selectable: false,
    evented: false,
  }));

  // Arrowhead at the tip
  const angle = Math.atan2(tipY - boxY, tipX - boxX);
  const headLen = 10 * (strokeWidth / 2);
  const ax1 = tipX - headLen * Math.cos(angle - Math.PI / 6);
  const ay1 = tipY - headLen * Math.sin(angle - Math.PI / 6);
  const ax2 = tipX - headLen * Math.cos(angle + Math.PI / 6);
  const ay2 = tipY - headLen * Math.sin(angle + Math.PI / 6);

  objects.push(new Polygon(
    [{ x: tipX, y: tipY }, { x: ax1, y: ay1 }, { x: ax2, y: ay2 }],
    { fill: color, stroke: color, strokeWidth: 1, opacity, selectable: false, evented: false },
  ));

  return objects;
}
