/**
 * Export the current annotated page (PDF or image) as a high-resolution PNG.
 *
 * 1. Re-renders the base layer (PDF page or image) at a fixed high DPI.
 * 2. Overlays all visible measurements via Fabric.js StaticCanvas.
 * 3. Composites both layers and triggers a PNG download.
 *
 * Coordinate system invariant
 * ───────────────────────────
 * Measurements are stored in CSS-pixel space at viewState.zoom=1, after the
 * page's `baseScale` (container fit) has been applied. So a stored point
 * `p.x` corresponds to PDF-native-pixel `p.x / baseScale`.
 *
 * On screen, MeasurementCanvas renders measurements at zoom = viewState.zoom.
 * For export, we render at zoom = exportScale / baseScale so that:
 *
 *   normalized export position = p.x * (exportScale / baseScale) / (nativeWidth * exportScale)
 *                              = p.x / (nativeWidth * baseScale)
 *
 * which matches the on-screen normalized position. ✓
 *
 * Bug history
 * ───────────
 * Earlier versions used `drawImage(fabricEl, 0, 0)` to composite the Fabric
 * overlay. With Fabric's default `enableRetinaScaling=true`, the canvas
 * buffer is sized at `width*DPR × height*DPR`; a 3-arg `drawImage` then
 * draws the FULL buffer (e.g. 12000 px on retina) onto a 6000 px base canvas,
 * doubling the apparent size and offsetting every annotation. The fix is
 * either (a) disable retina scaling on the export Fabric canvas, or (b) use
 * the 5-arg `drawImage(img, dx, dy, dW, dH)` to explicitly downscale. We do
 * BOTH for defence in depth. Same applies to direct `toDataURL` exports.
 */

import { StaticCanvas } from 'fabric';
import { useMetreStore } from '../store';
import { createMeasurementObjects } from './measurementRendering';
import { PRICE_UNITS } from '../types';

// Lookup table: price-unit code (`'pi2'`) → human-readable label (`'pi²'`).
// Built once at module load — the PRICE_UNITS array is constant. Map is
// explicitly typed as <string, string> so callers can pass a plain `string`
// (PRICE_UNITS.value is a strict literal union — without the cast, TS rejects
// runtime-arbitrary keys at .get()).
const UNIT_LABEL_BY_CODE = new Map<string, string>(
  PRICE_UNITS.map((u) => [u.value, u.label]),
);
function unitLabel(code: string | undefined | null): string {
  if (!code) return '';
  return UNIT_LABEL_BY_CODE.get(code) ?? code;
}

/** Hard browser canvas-area limit (varies by browser; 16384 is a safe ceiling). */
const MAX_CANVAS_DIM = 16384;

/**
 * Export the current page as an annotated PNG.
 *
 * @param exportScale – multiplier relative to native size (default 3 ≈ 216 DPI for a 72-DPI PDF).
 *   Capped automatically when the resulting canvas would exceed browser limits.
 * @returns `true` if a file was actually downloaded, `false` if there was
 *   nothing to export (no PDF and no image) or rendering failed silently.
 *   The orchestrator uses this to count exported files accurately.
 */
export async function exportAnnotatedPng(exportScale = 3): Promise<boolean> {
  const pdfDoc = (window as unknown as { __metrePdfDoc?: unknown }).__metrePdfDoc as
    | { getPage: (n: number) => Promise<unknown> }
    | undefined;
  const store = useMetreStore.getState();
  const {
    currentPage,
    measurements,
    layers,
    viewState,
    imageObjectUrl,
    imageNativeSize,
    baseScale: storeBaseScale,
  } = store;

  const isImage = !!imageObjectUrl && !!imageNativeSize;
  if (!pdfDoc && !isImage) {
    console.warn('[exportAnnotatedPng] no document loaded');
    return false;
  }

  // Visible layers only, sorted by layer order then zOrder (matches MeasurementCanvas).
  const visibleLayerIds = new Set(layers.filter((l) => l.visible).map((l) => l.id));
  const layerColorMap: Record<string, string> = {};
  layers.forEach((l) => {
    layerColorMap[l.id] = l.color;
  });

  const layerOrder = new Map(layers.map((l, i) => [l.id, i]));
  const pageMeasurements = measurements
    .filter((m) => m.pageNumber === currentPage && visibleLayerIds.has(m.layer))
    .sort((a, b) => {
      const layerDiff = (layerOrder.get(a.layer) ?? 0) - (layerOrder.get(b.layer) ?? 0);
      if (layerDiff !== 0) return layerDiff;
      return (a.zOrder ?? 0) - (b.zOrder ?? 0);
    });

  // ── 1. Render base layer at export scale ───────────────────────────────
  let exportWidth: number;
  let exportHeight: number;
  let nativeWidth: number;
  let nativeHeight: number;
  /** Effective resolution multiplier (`exportWidth / nativeWidth`). May be
   *  smaller than `exportScale` if we hit the browser canvas-size cap. */
  let effectiveScale: number;

  const baseCanvas = document.createElement('canvas');

  if (isImage) {
    nativeWidth = imageNativeSize.width;
    nativeHeight = imageNativeSize.height;

    // Cap export scale to avoid exceeding browser canvas limits.
    const maxDim = Math.max(nativeWidth, nativeHeight);
    effectiveScale =
      maxDim * exportScale > MAX_CANVAS_DIM ? MAX_CANVAS_DIM / maxDim : exportScale;

    exportWidth = Math.round(nativeWidth * effectiveScale);
    exportHeight = Math.round(nativeHeight * effectiveScale);

    baseCanvas.width = exportWidth;
    baseCanvas.height = exportHeight;
    const ctx = baseCanvas.getContext('2d');
    if (!ctx) return false;

    const img = new Image();
    img.src = imageObjectUrl;
    await img.decode();
    ctx.drawImage(img, 0, 0, exportWidth, exportHeight);
  } else {
    if (!pdfDoc) return false;
    // Type-narrow the PDF.js page object — pdfjs-dist types aren't available
    // here but the runtime API is stable.
    type PdfPage = {
      getViewport: (opts: { scale: number; rotation: number }) => {
        width: number;
        height: number;
      };
      render: (opts: {
        canvasContext: CanvasRenderingContext2D;
        viewport: { width: number; height: number };
      }) => { promise: Promise<void> };
    };
    const page = (await pdfDoc.getPage(currentPage)) as PdfPage;
    const baseViewport = page.getViewport({ scale: 1, rotation: viewState.rotation });
    nativeWidth = baseViewport.width;
    nativeHeight = baseViewport.height;

    // Cap export scale to avoid exceeding browser canvas limits.
    const maxDim = Math.max(nativeWidth, nativeHeight);
    effectiveScale =
      maxDim * exportScale > MAX_CANVAS_DIM ? MAX_CANVAS_DIM / maxDim : exportScale;

    const exportViewport = page.getViewport({
      scale: effectiveScale,
      rotation: viewState.rotation,
    });
    exportWidth = exportViewport.width;
    exportHeight = exportViewport.height;

    baseCanvas.width = exportWidth;
    baseCanvas.height = exportHeight;
    const ctx = baseCanvas.getContext('2d');
    if (!ctx) return false;

    await page.render({ canvasContext: ctx, viewport: exportViewport }).promise;
  }

  // ── 2. Compute measurement render zoom ──────────────────────────────────
  // Read baseScale directly from the store — it is published by PDFViewer on
  // every render via setBaseScale() and reflects the current container-fit
  // ratio. Falling back to a DOM-derived value (parsing the canvas style.width)
  // is brittle: the canvas dimensions may not match expectations on retina
  // screens, during a re-render, or when the user has resized the window.
  const baseScale = storeBaseScale > 0 ? storeBaseScale : 1;
  const measurementZoom = effectiveScale / baseScale;
  // Strokes are stored in CSS pixels at zoom=1. Scale them so they have the
  // same VISUAL thickness as on screen (proportional to canvas resolution).
  const strokeScale = measurementZoom / Math.max(viewState.zoom, 0.0001);

  // ── 3. Render measurements via Fabric StaticCanvas ─────────────────────
  // Disable Fabric's retina scaling: when enabled (default), the underlying
  // canvas BUFFER is sized at `width*DPR × height*DPR` for crisper rendering
  // on HiDPI screens. That is fine for visible canvases but BREAKS the
  // composite step below — `drawImage(fabricEl, 0, 0)` would draw the inflated
  // buffer onto our exportWidth-sized base canvas, doubling the apparent size
  // of every annotation on a retina screen. Disabling retina scaling makes
  // the buffer match exportWidth × exportHeight 1:1 with no DPR multiplier.
  const fabricEl = document.createElement('canvas');
  fabricEl.width = exportWidth;
  fabricEl.height = exportHeight;
  const fabricCanvas = new StaticCanvas(fabricEl, {
    width: exportWidth,
    height: exportHeight,
    enableRetinaScaling: false,
  });

  pageMeasurements.forEach((m) => {
    const color = m.color || layerColorMap[m.layer] || '#3b82f6';
    const baseStroke = m.strokeWidth ?? 2;
    const scaledStroke = Math.max(1, Math.round(baseStroke * strokeScale));
    const opacity = m.opacity ?? 1;

    const objects = createMeasurementObjects(m, color, scaledStroke, opacity, measurementZoom);
    objects.forEach((obj: { set: (props: Record<string, unknown>) => void }) => {
      obj.set({ selectable: false, evented: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fabricCanvas.add(obj as any);
    });
  });

  fabricCanvas.renderAll();

  // ── 4. Composite: base + measurements ──────────────────────────────────
  // Use the 5-arg drawImage form with EXPLICIT destination dimensions.
  // Defence-in-depth pairing with `enableRetinaScaling: false` above: even if
  // a future Fabric upgrade re-enables retina scaling implicitly, this draw
  // call will still scale-fit the source buffer to (exportWidth, exportHeight)
  // and avoid the offset/oversize bug.
  const baseCtx = baseCanvas.getContext('2d');
  if (!baseCtx) return false;
  baseCtx.drawImage(fabricEl, 0, 0, exportWidth, exportHeight);

  // ── 5. Download as PNG ─────────────────────────────────────────────────
  const filename = (() => {
    const docName =
      store.document?.filename?.replace(/\.(pdf|png|jpe?g|bmp|tiff?|webp)$/i, '') || 'plan';
    return `${docName}-page-${currentPage}-annote.png`;
  })();

  // Track whether toBlob actually produced a Blob — when the canvas is too
  // large or the browser refuses to encode (e.g. tainted by a CORS image),
  // toBlob calls back with `null`. The orchestrator counts files based on
  // this so the "x/3" summary alert stays accurate.
  let downloaded = false;
  await new Promise<void>((resolve) => {
    baseCanvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve();
          return;
        }
        downloadBlob(blob, filename);
        downloaded = true;
        resolve();
      },
      'image/png',
    );
  });

  // Cleanup
  fabricCanvas.dispose();
  return downloaded;
}

/* ────────────────────────────────────────────────────────────────────────
   Helpers shared by table-rendering exports (produits / BOM).
   ──────────────────────────────────────────────────────────────────────── */

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface TableColumn {
  header: string;
  align?: 'left' | 'center' | 'right';
  /** Width at scale=1 (CSS pixels). */
  width: number;
}

interface TableRow {
  cells: (string | number)[];
  /** Row variant: 'header-band' is a section header spanning all columns, 'subtotal' is a footer-style band. */
  variant?: 'normal' | 'header-band' | 'subtotal' | 'total';
  /** Set true on a row that represents a deduction (rendered in red). */
  isDeduction?: boolean;
}

interface RenderTableOptions {
  /** Scale multiplier for the output canvas resolution (default 3 ≈ 216 DPI). */
  scale?: number;
  /** Optional subtitle rendered just below the title. */
  subtitle?: string;
  /** Optional summary footer rendered after the rows. */
  footer?: string;
}

const TABLE_COLORS = {
  bg: '#ffffff',
  title: '#0f172a',
  subtitle: '#64748b',
  headerBg: '#0f172a',
  headerText: '#ffffff',
  rowBorder: '#e2e8f0',
  rowText: '#1e293b',
  altRowBg: '#f8fafc',
  bandBg: '#059669',
  bandText: '#ffffff',
  subtotalBg: '#f1f5f9',
  totalBg: '#dbeafe',
  totalText: '#1e3a8a',
  deduction: '#dc2626',
  footer: '#94a3b8',
} as const;

const TITLE_HEIGHT = 36;
const SUBTITLE_HEIGHT = 18;
const HEADER_HEIGHT = 26;
const ROW_HEIGHT = 22;
const PADDING = 16;
const FOOTER_HEIGHT = 24;

/**
 * Render a structured table to a high-resolution PNG Blob.
 *
 * Uses native Canvas API (no extra deps) so the output renders identically
 * regardless of the user's browser font installation. Long cell content is
 * truncated with an ellipsis rather than wrapped — column widths should be
 * sized generously upstream.
 *
 * Coordinates inside this function are expressed in CSS pixels at scale=1,
 * then multiplied by `scale` for the final canvas. This keeps the math
 * readable while still producing print-quality output at scale=3.
 */
async function renderTableToBlob(
  title: string,
  columns: TableColumn[],
  rows: TableRow[],
  options: RenderTableOptions = {},
): Promise<Blob | null> {
  const scale = options.scale ?? 3;

  const tableWidth = columns.reduce((s, c) => s + c.width, 0);
  const cssWidth = tableWidth + PADDING * 2;

  // CSS height: title + optional subtitle + header + rows + optional footer + padding
  // The +8 below mirrors the spacing applied during rendering between the
  // header block and the table, and (separately) before the footer if any —
  // omitting either would clip the bottom of the footer text.
  let cssHeight = PADDING + TITLE_HEIGHT;
  if (options.subtitle) cssHeight += SUBTITLE_HEIGHT;
  cssHeight += 8; // spacing between header text and table
  cssHeight += HEADER_HEIGHT;
  cssHeight += rows.length * ROW_HEIGHT;
  if (options.footer) cssHeight += 8 + FOOTER_HEIGHT;
  cssHeight += PADDING;

  // Browser canvas max is 16384px on most engines — clamp scale to stay safe.
  const maxDim = Math.max(cssWidth, cssHeight);
  const effectiveScale = maxDim * scale > MAX_CANVAS_DIM ? MAX_CANVAS_DIM / maxDim : scale;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cssWidth * effectiveScale);
  canvas.height = Math.round(cssHeight * effectiveScale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Apply scale once so the rest of the drawing logic stays in CSS pixels.
  ctx.scale(effectiveScale, effectiveScale);
  ctx.imageSmoothingEnabled = true;
  ctx.textBaseline = 'middle';

  // ── Background ──
  ctx.fillStyle = TABLE_COLORS.bg;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  // ── Title ──
  let y = PADDING;
  ctx.fillStyle = TABLE_COLORS.title;
  ctx.font = 'bold 20px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, PADDING, y + TITLE_HEIGHT / 2);
  y += TITLE_HEIGHT;

  if (options.subtitle) {
    ctx.fillStyle = TABLE_COLORS.subtitle;
    ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(options.subtitle, PADDING, y + SUBTITLE_HEIGHT / 2);
    y += SUBTITLE_HEIGHT;
  }
  y += 8;

  // ── Header row ──
  ctx.fillStyle = TABLE_COLORS.headerBg;
  ctx.fillRect(PADDING, y, tableWidth, HEADER_HEIGHT);
  ctx.fillStyle = TABLE_COLORS.headerText;
  ctx.font = 'bold 11px system-ui, -apple-system, "Segoe UI", sans-serif';
  let x = PADDING;
  for (const col of columns) {
    drawCell(ctx, col.header, x, y, col.width, HEADER_HEIGHT, col.align ?? 'left', 6);
    x += col.width;
  }
  y += HEADER_HEIGHT;

  // ── Body rows ──
  ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowY = y;

    // Row background per variant
    if (row.variant === 'header-band') {
      ctx.fillStyle = TABLE_COLORS.bandBg;
      ctx.fillRect(PADDING, rowY, tableWidth, ROW_HEIGHT);
      ctx.fillStyle = TABLE_COLORS.bandText;
      ctx.font = 'bold 11px system-ui, -apple-system, "Segoe UI", sans-serif';
      const text = row.cells.map((c) => String(c)).join(' ');
      drawCell(ctx, text, PADDING, rowY, tableWidth, ROW_HEIGHT, 'left', 6);
      ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    } else if (row.variant === 'subtotal') {
      ctx.fillStyle = TABLE_COLORS.subtotalBg;
      ctx.fillRect(PADDING, rowY, tableWidth, ROW_HEIGHT);
      ctx.fillStyle = TABLE_COLORS.rowText;
      ctx.font = 'bold 11px system-ui, -apple-system, "Segoe UI", sans-serif';
      let cx = PADDING;
      for (let c = 0; c < columns.length; c++) {
        const col = columns[c];
        const text = String(row.cells[c] ?? '');
        drawCell(ctx, text, cx, rowY, col.width, ROW_HEIGHT, col.align ?? 'left', 6);
        cx += col.width;
      }
      ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    } else if (row.variant === 'total') {
      ctx.fillStyle = TABLE_COLORS.totalBg;
      ctx.fillRect(PADDING, rowY, tableWidth, ROW_HEIGHT);
      ctx.fillStyle = TABLE_COLORS.totalText;
      ctx.font = 'bold 12px system-ui, -apple-system, "Segoe UI", sans-serif';
      let cx = PADDING;
      for (let c = 0; c < columns.length; c++) {
        const col = columns[c];
        const text = String(row.cells[c] ?? '');
        drawCell(ctx, text, cx, rowY, col.width, ROW_HEIGHT, col.align ?? 'left', 6);
        cx += col.width;
      }
      ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    } else {
      // Normal row with alternation
      if (i % 2 === 1) {
        ctx.fillStyle = TABLE_COLORS.altRowBg;
        ctx.fillRect(PADDING, rowY, tableWidth, ROW_HEIGHT);
      }
      ctx.fillStyle = row.isDeduction ? TABLE_COLORS.deduction : TABLE_COLORS.rowText;
      let cx = PADDING;
      for (let c = 0; c < columns.length; c++) {
        const col = columns[c];
        const text = String(row.cells[c] ?? '');
        drawCell(ctx, text, cx, rowY, col.width, ROW_HEIGHT, col.align ?? 'left', 6);
        cx += col.width;
      }
    }

    // Bottom border per row
    ctx.strokeStyle = TABLE_COLORS.rowBorder;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(PADDING, rowY + ROW_HEIGHT);
    ctx.lineTo(PADDING + tableWidth, rowY + ROW_HEIGHT);
    ctx.stroke();

    y += ROW_HEIGHT;
  }

  // Outer border around the table body (already has rows borders inside)
  ctx.strokeStyle = TABLE_COLORS.rowBorder;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(PADDING - 0.25, y - rows.length * ROW_HEIGHT - HEADER_HEIGHT, tableWidth + 0.5, HEADER_HEIGHT + rows.length * ROW_HEIGHT);

  // ── Footer ──
  if (options.footer) {
    y += 8;
    ctx.fillStyle = TABLE_COLORS.footer;
    ctx.font = 'italic 10px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(options.footer, PADDING, y + FOOTER_HEIGHT / 2);
  }

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png');
  });
}

/**
 * Draw a single cell with horizontal alignment + ellipsis truncation.
 * Operates in CSS pixel coordinates (call after ctx.scale).
 */
function drawCell(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  align: 'left' | 'center' | 'right',
  padding: number,
): void {
  const available = width - padding * 2;
  // Bail out cleanly when the cell is so narrow that even the ellipsis itself
  // wouldn't fit — otherwise drawing a lone '…' would overflow into the next
  // column. The caller is responsible for sizing columns wide enough; this
  // guard exists for defence-in-depth so a misconfigured column never bleeds.
  if (available <= 0 || ctx.measureText('…').width > available) return;
  let display = text;
  if (ctx.measureText(display).width > available) {
    while (display.length > 0 && ctx.measureText(display + '…').width > available) {
      display = display.slice(0, -1);
    }
    display = display + '…';
  }
  let tx = x + padding;
  if (align === 'center') {
    ctx.textAlign = 'center';
    tx = x + width / 2;
  } else if (align === 'right') {
    ctx.textAlign = 'right';
    tx = x + width - padding;
  } else {
    ctx.textAlign = 'left';
  }
  ctx.fillText(display, tx, y + height / 2);
}

/**
 * Format a number for display in tables — French locale, 2 decimals, thousands
 * separator. Returns "0,00" for non-finite values to avoid "NaN" leaking.
 */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0,00';
  return n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ────────────────────────────────────────────────────────────────────────
   Export #2: Detailed products table (one row per measurement with product).
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Export the per-measurement product detail table as a PNG file. Mirrors the
 * "Détail des mesures et coûts" section of the soumission PDF: one row per
 * measurement, grouped by layer/category, with subtotals and grand total.
 *
 * Returns `false` and downloads nothing if there are no measurements with a
 * product associated — caller should check before chaining other exports.
 */
export async function exportProductsDetailPng(exportScale = 3): Promise<boolean> {
  const store = useMetreStore.getState();
  const { measurements, products, layers } = store;

  // Pre-compute deductions so net quantities match the soumission/PDF behaviour
  // (a parent measurement's net = gross − Σ child deductions, clamped ≥ 0).
  const deductionsByParent = new Map<string, number>();
  for (const m of measurements) {
    if (m.isDeduction && m.parentMeasurementId) {
      const v = m.quantity ?? m.value;
      if (Number.isFinite(v)) {
        deductionsByParent.set(
          m.parentMeasurementId,
          (deductionsByParent.get(m.parentMeasurementId) ?? 0) + v,
        );
      }
    }
  }
  const productById = new Map(products.map((p) => [p.id, p]));
  const layerById = new Map(layers.map((l) => [l.id, l]));

  // Build sorted, grouped rows
  type Block = {
    category: string;
    rows: TableRow[];
    subtotal: number;
  };
  const blocks = new Map<string, Block>();
  let grandTotal = 0;

  const linked = measurements.filter((m) => m.productId);
  for (const m of linked) {
    const product = productById.get(m.productId as string);
    if (!product) continue;
    const layer = m.layer ? layerById.get(m.layer) : undefined;
    const categoryLabel = layer?.name || product.category || 'General';
    const isDeduction = m.isDeduction ?? false;
    const grossValue = m.quantity ?? m.value;
    if (!Number.isFinite(grossValue)) continue;
    const slopeFactor = m.slopeFactor ?? 1;
    const netValue = isDeduction
      ? 0
      : Math.max(0, grossValue - (deductionsByParent.get(m.id) ?? 0));
    const netQty = netValue * slopeFactor;
    // Coerce non-finite product fields to 0 so a single corrupted product
    // (NaN price / wastePct from a botched import) cannot poison the entire
    // table totals via `subtotal += NaN`. The fmt() display helper already
    // handles NaN, but accumulation requires upstream sanitisation.
    const wastePct = Number.isFinite(product.wastePct) ? (product.wastePct as number) : 0;
    const safePrice = Number.isFinite(product.price) ? product.price : 0;
    const qtyWaste = isDeduction ? 0 : netQty * (1 + wastePct / 100);
    const cost = isDeduction ? 0 : qtyWaste * safePrice;

    if (!blocks.has(categoryLabel)) {
      blocks.set(categoryLabel, { category: categoryLabel, rows: [], subtotal: 0 });
    }
    const block = blocks.get(categoryLabel) as Block;
    const measureLabel = m.label || `${m.type} #${m.id.slice(-4)}`;
    const qtyDisplay = isDeduction ? -Math.abs(grossValue * slopeFactor) : netQty;
    // Description: single-line (drawCell does not wrap on newlines, so a literal
    // `\n` would render as a mojibake glyph). Use the explicit "(déduction)"
    // marker instead — visually distinguishable AND screen-reader friendly.
    const description = isDeduction
      ? `${product.name} (déduction) — ${measureLabel}`
      : `${product.name} — ${measureLabel}`;
    block.rows.push({
      cells: [
        description,
        fmt(qtyDisplay),
        // Show human label (pi², unité, …) — not the raw storage code.
        unitLabel(product.priceUnit) || m.unit || '',
        isDeduction ? '—' : `${wastePct.toFixed(0)}%`,
        isDeduction ? '—' : fmt(qtyWaste),
        `${fmt(safePrice)} $`,
        isDeduction ? '—' : `${fmt(cost)} $`,
      ],
      isDeduction,
    });
    block.subtotal += cost;
    grandTotal += cost;
  }

  if (blocks.size === 0) {
    console.info('[exportProductsDetailPng] no measurements with product — skipping');
    return false;
  }

  const cols: TableColumn[] = [
    { header: 'Produit / Mesure', width: 320, align: 'left' },
    { header: 'Quantité', width: 80, align: 'right' },
    { header: 'Unité', width: 60, align: 'center' },
    { header: 'Perte', width: 60, align: 'center' },
    { header: 'Qté+perte', width: 90, align: 'right' },
    { header: 'Prix unit.', width: 90, align: 'right' },
    { header: 'Montant', width: 110, align: 'right' },
  ];

  // Flatten blocks into rows with category headers and subtotals.
  const rows: TableRow[] = [];
  const sortedBlocks = Array.from(blocks.values()).sort((a, b) =>
    a.category.localeCompare(b.category, 'fr-CA'),
  );
  for (const block of sortedBlocks) {
    rows.push({ cells: [block.category.toUpperCase()], variant: 'header-band' });
    for (const r of block.rows) rows.push(r);
    rows.push({
      cells: [`Sous-total — ${block.category}`, '', '', '', '', '', `${fmt(block.subtotal)} $`],
      variant: 'subtotal',
    });
  }
  rows.push({
    cells: ['TOTAL', '', '', '', '', '', `${fmt(grandTotal)} $`],
    variant: 'total',
  });

  const docName =
    store.document?.filename?.replace(/\.(pdf|png|jpe?g|bmp|tiff?|webp)$/i, '') || 'plan';
  const blob = await renderTableToBlob(
    'Détail des mesures et coûts',
    cols,
    rows,
    {
      scale: exportScale,
      subtitle: `${linked.filter((m) => !m.isDeduction).length} mesures · ${blocks.size} catégorie(s)`,
      footer: `Généré le ${new Date().toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    },
  );
  if (!blob) return false;
  downloadBlob(blob, `${docName}-produits-detail.png`);
  return true;
}

/* ────────────────────────────────────────────────────────────────────────
   Export #3: Detailed BOM table (composite + child + formula + qty).
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Export the detailed BOM breakdown as a PNG file. For every measurement that
 * points to a composite product, emit one row per child component, including:
 *   - composite parent name
 *   - child product name
 *   - the parametric formula (when defined) or `quantityPerUnit × parentUnit`
 *   - parent quantity (net, with slope)
 *   - calculated child quantity (effParent × qtyPerUnit × (1+childWaste))
 *   - unit, unit price, line amount
 *
 * Returns `false` and downloads nothing if there are no composite measurements.
 */
export async function exportBomDetailPng(exportScale = 3): Promise<boolean> {
  const store = useMetreStore.getState();
  const { measurements, products } = store;

  const productById = new Map(products.map((p) => [p.id, p]));
  const deductionsByParent = new Map<string, number>();
  for (const m of measurements) {
    if (m.isDeduction && m.parentMeasurementId) {
      const v = m.quantity ?? m.value;
      if (Number.isFinite(v)) {
        deductionsByParent.set(
          m.parentMeasurementId,
          (deductionsByParent.get(m.parentMeasurementId) ?? 0) + v,
        );
      }
    }
  }

  const rows: TableRow[] = [];
  let grandTotal = 0;

  for (const m of measurements) {
    if (!m.productId || m.isDeduction) continue;
    const product = productById.get(m.productId);
    if (!product || !product.isComposite || (product.components?.length ?? 0) === 0) continue;

    const grossValue = m.quantity ?? m.value;
    if (!Number.isFinite(grossValue)) continue;
    const netValue = Math.max(0, grossValue - (deductionsByParent.get(m.id) ?? 0));
    const parentQty = netValue * (m.slopeFactor ?? 1);
    // Coerce non-finite parent/child fields to 0 — same rationale as in
    // exportProductsDetailPng: a corrupted product field must not poison
    // grandTotal via NaN propagation.
    const wastePct = Number.isFinite(product.wastePct) ? (product.wastePct as number) : 0;
    const parentWasteMul = 1 + wastePct / 100;
    const effParentQty = parentQty * parentWasteMul;
    const components = product.components ?? [];

    // For scale calculation (priceOverride): same logic as generateSoumissionItems.
    // Skip non-finite child fields so a single bad component cannot NaN-poison
    // the autoUnitPrice (which would then propagate through `scale`).
    const autoUnitPrice = components.reduce((sum, c) => {
      const childPrice = Number.isFinite(c.childPrice) ? (c.childPrice as number) : 0;
      const childWaste = Number.isFinite(c.childWastePct) ? (c.childWastePct as number) / 100 : 0;
      const qpu = Number.isFinite(c.quantityPerUnit) ? c.quantityPerUnit : 0;
      return sum + childPrice * qpu * (1 + childWaste);
    }, 0);
    const scale =
      product.priceOverride != null && autoUnitPrice > 0
        ? product.priceOverride / autoUnitPrice
        : 1;

    // Edge case mirroring generateSoumissionItems: when all child prices sum
    // to 0 but the composite has a non-zero priceOverride, the per-child
    // expansion silently drops the override (total would be 0). Collapse to a
    // single assembly line so the BOM total matches the soumission total.
    const detailedWouldDropOverride =
      autoUnitPrice === 0 &&
      product.priceOverride != null &&
      product.priceOverride !== 0;

    const measureLabel = m.label || product.name;
    rows.push({
      cells: [`${product.name} (${measureLabel})`],
      variant: 'header-band',
    });

    if (detailedWouldDropOverride) {
      const unitPrice = product.priceOverride as number;
      const lineTotal = effParentQty * unitPrice;
      grandTotal += lineTotal;
      rows.push({
        cells: [
          `Assemblage (${components.length} produit${components.length !== 1 ? 's' : ''})`,
          'priceOverride (sous-produits a 0$)',
          fmt(parentQty),
          fmt(effParentQty),
          unitLabel(product.priceUnit) || 'un',
          `${fmt(unitPrice)} $`,
          `${fmt(lineTotal)} $`,
        ],
      });
      continue;
    }

    for (const c of components) {
      // Same defensive coercion as autoUnitPrice above — protects per-row
      // childQty and lineTotal from NaN propagation when a component field
      // is missing or corrupted in the catalogue.
      const childWastePct = Number.isFinite(c.childWastePct) ? (c.childWastePct as number) : 0;
      const qpu = Number.isFinite(c.quantityPerUnit) ? c.quantityPerUnit : 0;
      const childPriceRaw = Number.isFinite(c.childPrice) ? (c.childPrice as number) : 0;
      const childWasteMul = 1 + childWastePct / 100;
      const childQty = effParentQty * qpu * childWasteMul;
      const childPrice = childPriceRaw * scale;
      const lineTotal = childQty * childPrice;
      grandTotal += lineTotal;

      const formulaDisplay = c.formula
        ? c.formula
        : `${qpu} / ${unitLabel(product.priceUnit) || 'un'}`;

      rows.push({
        cells: [
          c.childName ?? 'Sous-produit',
          formulaDisplay,
          fmt(parentQty),
          fmt(childQty),
          unitLabel(c.childPriceUnit) || unitLabel(product.priceUnit) || 'un',
          `${fmt(childPrice)} $`,
          `${fmt(lineTotal)} $`,
        ],
      });
    }
  }

  if (rows.length === 0) {
    console.info('[exportBomDetailPng] no composite measurements — skipping');
    return false;
  }

  const cols: TableColumn[] = [
    { header: 'Sous-produit', width: 200, align: 'left' },
    { header: 'Formule', width: 220, align: 'left' },
    { header: 'Qté parent', width: 80, align: 'right' },
    { header: 'Qté calculée', width: 90, align: 'right' },
    { header: 'Unité', width: 60, align: 'center' },
    { header: 'Prix unit.', width: 90, align: 'right' },
    { header: 'Montant', width: 110, align: 'right' },
  ];

  rows.push({
    cells: ['TOTAL BOM', '', '', '', '', '', `${fmt(grandTotal)} $`],
    variant: 'total',
  });

  // Detect whether any component carries a parametric formula — when present,
  // the displayed "Qté calculée" uses quantityPerUnit (not the formula
  // resolution) so the user knows to consult the live BOM panel for the
  // formula-aware value. This mirrors the generateSoumissionItems behaviour.
  const hasFormula = measurements.some((m) => {
    if (!m.productId || m.isDeduction) return false;
    const p = productById.get(m.productId);
    return !!p?.isComposite && (p?.components ?? []).some((c) => !!c.formula);
  });

  const dateStr = new Date().toLocaleDateString('fr-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const footerStr = hasFormula
    ? `Généré le ${dateStr} · Qté calculée via quantityPerUnit — consulter le panneau BOM pour la formule paramétrique`
    : `Généré le ${dateStr}`;

  const docName =
    store.document?.filename?.replace(/\.(pdf|png|jpe?g|bmp|tiff?|webp)$/i, '') || 'plan';
  const blob = await renderTableToBlob('Bordereau BOM détaillé', cols, rows, {
    scale: exportScale,
    subtitle: 'Composite parent · sous-produit · formule · quantité calculée',
    footer: footerStr,
  });
  if (!blob) return false;
  downloadBlob(blob, `${docName}-bom-detail.png`);
  return true;
}

/* ────────────────────────────────────────────────────────────────────────
   Orchestrator: trigger the 3 downloads sequentially.
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Download the annotated page PNG plus the products-detail and BOM-detail
 * tables as separate PNG files. Each download is triggered with a 250 ms
 * delay between them so browsers don't merge / block them as a single popup.
 * Returns the number of files actually downloaded (1-3) since the tables
 * are skipped when their data sets are empty.
 */
export async function exportAllAnnotated(exportScale = 3): Promise<number> {
  // Delay between sequential downloads. 400 ms is the safe value across
  // Chrome / Edge / Firefox AND Safari — Safari historically de-duplicates
  // repeated programmatic a.click() calls fired within ~300 ms.
  const DOWNLOAD_DELAY_MS = 400;

  let count = 0;
  if (await exportAnnotatedPng(exportScale)) count++;

  await new Promise((r) => setTimeout(r, DOWNLOAD_DELAY_MS));
  if (await exportProductsDetailPng(exportScale)) count++;

  await new Promise((r) => setTimeout(r, DOWNLOAD_DELAY_MS));
  if (await exportBomDetailPng(exportScale)) count++;

  return count;
}
