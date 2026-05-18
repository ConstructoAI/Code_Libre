import { useRef, useEffect, useCallback, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { FolderOpen, FilePlus2 } from 'lucide-react';
import { generateBlankTemplatePdf } from '../utils/blankTemplate';
import { useMetreStore } from '../store';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/bmp', 'image/webp', 'image/tiff']);
const IMAGE_EXT = /\.(png|jpe?g|bmp|tiff?|webp)$/i;

function isImageFile(file: File): boolean {
  return IMAGE_TYPES.has(file.type) || IMAGE_EXT.test(file.name);
}

/** LRU cache for rendered PDF page bitmaps to avoid re-rendering on zoom/pan. */
interface CachedPage {
  pageNum: number;
  rotation: number;
  /** Native PDF width at scale=1 */
  nativeW: number;
  nativeH: number;
  /** The rendered bitmap at RENDER_SCALE x base viewport */
  bitmap: ImageBitmap;
  /** The scale at which this bitmap was rendered (relative to PDF native units) */
  renderScale: number;
}

const PAGE_CACHE_MAX = 7;
/** Fixed scale multiplier for the cached render (higher = sharper when zoomed in, more VRAM) */
const CACHE_RENDER_SCALE = 3;

export default function PDFViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const pageCacheRef = useRef<CachedPage[]>([]);
  // Flipped to `true` by the unmount cleanup so any in-flight `loadPDF` /
  // `loadImage` promise from this dying instance bails out instead of writing
  // its result onto `pdfDocRef` / `imageRef` / the `__metrePdfDoc` window
  // global — which would otherwise clobber values already set by a freshly
  // mounted instance (StrictMode / fast tab switch).
  const unmountedRef = useRef(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  // Initialise from the store so the placeholder doesn't flash on remount when
  // a cached document is about to be restored by the effect below.
  const [hasDocument, setHasDocument] = useState(() => {
    const s = useMetreStore.getState();
    return !!(s.document && (s.pdfBuffer || s.imageBlob));
  });
  // Incremented after every successful loadPDF/loadImage. Used as a render-effect
  // dep so the effect re-fires once `pdfDocRef.current` / `imageRef.current` is
  // populated by an async load. We can't rely on `hasDocument` for this: on
  // remount it's already `true` (initialised from the surviving store), so
  // `setHasDocument(true)` at the end of `loadPDF(restore: true)` is a no-op
  // (Object.is bail-out) and the render effect would never re-fire → blank
  // canvas (was the "switch onglet → PDF disparu" bug).
  const [loadEpoch, setLoadEpoch] = useState(0);

  const viewState = useMetreStore((s) => s.viewState);
  const currentPage = useMetreStore((s) => s.currentPage);
  const setDocument = useMetreStore((s) => s.setDocument);
  const activeTool = useMetreStore((s) => s.activeTool);
  const setMousePosition = useMetreStore((s) => s.setMousePosition);
  const setMouseWorldPosition = useMetreStore((s) => s.setMouseWorldPosition);
  const imageNativeSize = useMetreStore((s) => s.imageNativeSize);
  // Source binary cache — used to restore the plan after the component is
  // unmounted (e.g. when navigating between ERP modules) without forcing the
  // user to re-pick the file.
  const cachedDocument = useMetreStore((s) => s.document);
  const cachedPdfBuffer = useMetreStore((s) => s.pdfBuffer);
  const cachedImageBlob = useMetreStore((s) => s.imageBlob);

  // Track dragging for pan
  const isPanningRef = useRef(false);
  const lastPanPosRef = useRef({ x: 0, y: 0 });
  const spaceHeldRef = useRef(false);

  // Track spacebar for space+drag pan (like AutoCAD / Photoshop)
  useEffect(() => {
    const isInputFocused = () => {
      const tag = document.activeElement?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (document.activeElement as HTMLElement)?.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isInputFocused()) {
        spaceHeldRef.current = true;
        e.preventDefault();
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

  // Observe container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ── Load PDF ──
  // `restore` is true when re-opening a PDF from the in-memory cache (after
  // unmount/remount). In that case we keep the existing document metadata in
  // the store so measurements/layers/calibration are NOT wiped by setDocument.
  const loadPDF = useCallback(
    async (source: string | ArrayBuffer, opts?: { restore?: boolean }) => {
      try {
        // Clear image state
        if (imageRef.current) {
          const prevUrl = useMetreStore.getState().imageObjectUrl;
          if (prevUrl) URL.revokeObjectURL(prevUrl);
          imageRef.current = null;
          useMetreStore.getState().setImageObjectUrl(null);
          useMetreStore.getState().setImageNativeSize(null);
        }

        // Clear page cache
        pageCacheRef.current.forEach((c) => c.bitmap.close());
        pageCacheRef.current = [];

        // PDF.js may transfer/consume an ArrayBuffer passed via `data`. Clone it
        // before handing it off so the original stays usable for re-opening
        // later (e.g. on remount). For URL sources just pass through.
        const loadArg =
          typeof source === 'string'
            ? source
            : { data: new Uint8Array(source.slice(0)) };

        const loadingTask = pdfjsLib.getDocument(loadArg);
        const pdf = await loadingTask.promise;
        if (unmountedRef.current) {
          // We were unmounted while pdf.js was parsing. Discard the parsed
          // proxy (would leak GPU memory and could clobber the next mount's
          // PDF) but preserve the source binary in the store on a fresh load:
          // callers like handleOpenMetre keep going after `await loader()`
          // and set the document id on the store — without the buffer here,
          // the next remount sees a `cachedDocument` with no `cachedPdfBuffer`
          // and the restore-effect bails, leaving a blank canvas. The restore
          // path skips this on purpose (the buffer is already in the store).
          if (!opts?.restore && typeof source !== 'string'
              && !useMetreStore.getState().pdfBuffer) {
            useMetreStore.getState().setPdfBuffer(source.slice(0));
          }
          try { await pdf.destroy(); } catch { /* ignore */ }
          return;
        }
        pdfDocRef.current = pdf;
        (window as any).__metrePdfDoc = pdf;

        if (opts?.restore) {
          // Same document re-opened — do NOT call setDocument (it would wipe
          // measurements/layers/calibration) and do NOT overwrite pdfBuffer.
          setHasDocument(true);
          setLoadEpoch((e) => e + 1);
          return;
        }

        // Fresh load: register the document FIRST (this triggers setDocument's
        // wipe, which clears the previous pdfBuffer/imageBlob), THEN cache the
        // new binary. Order matters: if setPdfBuffer runs before setDocument,
        // the wipe clobbers the value we just wrote → persistence across
        // remounts is broken.
        setDocument({
          id: `doc-${Date.now()}`,
          projectId: '',
          filename: typeof source === 'string' ? source.split('/').pop() ?? 'document.pdf' : 'document.pdf',
          pageCount: pdf.numPages,
          uploadedAt: new Date().toISOString(),
        });
        if (typeof source !== 'string') {
          useMetreStore.getState().setPdfBuffer(source.slice(0));
        }
        setHasDocument(true);
        setLoadEpoch((e) => e + 1);
      } catch (err) {
        console.error('Failed to load PDF:', err);
      }
    },
    [setDocument]
  );

  // ── Load Image ──
  // `restore` is true when re-opening from the in-memory cache after remount.
  const loadImage = useCallback(
    async (file: File | Blob, opts?: { restore?: boolean; filename?: string }) => {
      try {
        // Clear PDF state and page cache
        pdfDocRef.current = null;
        (window as any).__metrePdfDoc = null;
        pageCacheRef.current.forEach((c) => c.bitmap.close());
        pageCacheRef.current = [];

        // Revoke previous image URL if any
        const prevUrl = useMetreStore.getState().imageObjectUrl;
        if (prevUrl) URL.revokeObjectURL(prevUrl);

        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.src = objectUrl;
        await img.decode();
        if (unmountedRef.current) {
          // Unmounted while decoding. Discard the decoded image and free the
          // blob URL we just allocated. On a fresh load (not restore), seed
          // `imageBlob` in the store so the next remount can restore — same
          // rationale as the loadPDF fresh-bail path above.
          if (!opts?.restore && !useMetreStore.getState().imageBlob) {
            useMetreStore.getState().setImageBlob(file);
          }
          URL.revokeObjectURL(objectUrl);
          return;
        }

        imageRef.current = img;
        useMetreStore.getState().setImageObjectUrl(objectUrl);
        useMetreStore.getState().setImageNativeSize({ width: img.naturalWidth, height: img.naturalHeight });

        if (opts?.restore) {
          // Same document re-opened — keep store metadata intact.
          setHasDocument(true);
          setLoadEpoch((e) => e + 1);
          return;
        }

        // Fresh load: setDocument FIRST (triggers wipe which clears any old
        // pdfBuffer/imageBlob), THEN cache the new blob. Order matters — see
        // loadPDF above for the same rationale.
        setDocument({
          id: `doc-${Date.now()}`,
          projectId: '',
          filename: (file instanceof File ? file.name : opts?.filename) ?? 'image',
          pageCount: 1,
          uploadedAt: new Date().toISOString(),
        });
        useMetreStore.getState().setImageBlob(file);
        useMetreStore.getState().setCurrentPage(1);
        setHasDocument(true);
        setLoadEpoch((e) => e + 1);
      } catch (err) {
        console.error('Failed to load image:', err);
      }
    },
    [setDocument]
  );

  // Expose loaders on window
  useEffect(() => {
    (window as any).__metrePdfLoad = loadPDF;
    (window as any).__metreImageLoad = loadImage;
    return () => {
      delete (window as any).__metrePdfLoad;
      delete (window as any).__metreImageLoad;
    };
  }, [loadPDF, loadImage]);

  // Cleanup at unmount: release ImageBitmaps and cancel any in-flight
  // pdf.js render task. Without this, navigating away leaves up to
  // PAGE_CACHE_MAX bitmaps (each one a multi-megabyte GPU resource on
  // ARCH-D plans at 3x scale) live in memory until GC reclaims them —
  // and ImageBitmap GPU memory is only freed by .close(), not GC.
  // We also nullify the dead instance's `pdfDocRef` and clear the global
  // `window.__metrePdfDoc` if it still points at this instance's PDF —
  // otherwise an in-flight `loadPDF` from this dying instance can finish
  // *after* the next mount has already populated the global, leaving
  // exporters (TopToolbar, exportPng) reading a stale PDFDocumentProxy.
  useEffect(() => {
    const cache = pageCacheRef;
    const renderTask = renderTaskRef;
    const pdfDoc = pdfDocRef;
    const unmounted = unmountedRef;
    return () => {
      // Set BEFORE the rest so any in-flight loadPDF/loadImage promise that
      // resolves between here and microtask flush bails out at the
      // `if (unmountedRef.current)` check.
      unmounted.current = true;
      cache.current.forEach((c) => {
        try { c.bitmap.close(); } catch { /* ignore */ }
      });
      cache.current = [];
      if (renderTask.current) {
        try { renderTask.current.cancel(); } catch { /* ignore */ }
        renderTask.current = null;
      }
      if ((window as any).__metrePdfDoc === pdfDoc.current) {
        (window as any).__metrePdfDoc = null;
      }
      pdfDoc.current = null;
    };
  }, []);

  // Restore the cached plan on mount (after navigating away and back).
  // Runs only once on mount: if the store has a document AND its source
  // binary, re-open it without wiping measurements/layers/calibration.
  // We gate on `pdfDocRef.current` / `imageRef.current` (component-local) and
  // NOT on `hasDocument` (initialised from the surviving Zustand store) —
  // otherwise on remount `hasDocument` is already `true`, the restore is
  // skipped, `pdfDocRef.current` stays `null`, and the canvas renders blank
  // (was the "switch onglet → PDF disparu" bug).
  useEffect(() => {
    if (pdfDocRef.current || imageRef.current) return;
    if (!cachedDocument) return;
    if (cachedPdfBuffer) {
      void loadPDF(cachedPdfBuffer, { restore: true });
    } else if (cachedImageBlob) {
      void loadImage(cachedImageBlob, { restore: true, filename: cachedDocument.filename });
    }
    // Intentionally only depend on the loader callbacks — we want this to fire
    // exactly once when the component mounts with a non-empty store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPDF, loadImage]);

  // (Removed: a former useEffect re-published `pdfDocRef.current` to
  // `window.__metrePdfDoc` on every render. Without a deps array it ran on
  // every mouse-move/zoom/pan, and in StrictMode / fast remount could clobber
  // the new instance's PDFDocumentProxy with a stale ref. The single
  // assignment in `loadPDF` after the unmount-guard plus the unset in the
  // cleanup hook are sufficient.)

  // ── Render PDF page (cached) ──
  // Renders each page once at a high fixed resolution and caches the bitmap.
  // On zoom/pan changes, the cached bitmap is drawn scaled — no PDF.js re-render.
  useEffect(() => {
    if (imageRef.current) return; // image mode — skip PDF rendering
    const pdf = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas) return;

    let cancelled = false;

    const renderPage = async () => {
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch { /* ignore */ }
      }

      try {
        const page = await pdf.getPage(currentPage);
        if (cancelled) return;

        const dpr = window.devicePixelRatio || 1;
        const baseViewport = page.getViewport({ scale: 1, rotation: viewState.rotation });
        const scaleX = containerSize.width / baseViewport.width;
        const scaleY = containerSize.height / baseViewport.height;
        const baseScale = Math.min(scaleX, scaleY) || 1;

        // Publish baseScale to store so measurements can rescale on container resize
        useMetreStore.getState().setBaseScale(baseScale);

        // Target display size
        const displayW = baseViewport.width * baseScale * viewState.zoom;
        const displayH = baseViewport.height * baseScale * viewState.zoom;

        canvas.width = displayW * dpr;
        canvas.height = displayH * dpr;
        canvas.style.width = `${displayW}px`;
        canvas.style.height = `${displayH}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx || cancelled) return;

        // Check cache for this page+rotation
        const cache = pageCacheRef.current;
        let cached = cache.find((c) => c.pageNum === currentPage && c.rotation === viewState.rotation);

        if (!cached) {
          // Render at fixed high resolution and cache
          const renderScale = CACHE_RENDER_SCALE;
          const rv = page.getViewport({ scale: renderScale, rotation: viewState.rotation });

          const offscreen = document.createElement('canvas');
          offscreen.width = rv.width;
          offscreen.height = rv.height;
          const offCtx = offscreen.getContext('2d');
          if (!offCtx || cancelled) return;

          const task = page.render({ canvasContext: offCtx, viewport: rv });
          renderTaskRef.current = task;
          await task.promise;
          if (cancelled) return;

          const bitmap = await createImageBitmap(offscreen);

          cached = {
            pageNum: currentPage,
            rotation: viewState.rotation,
            nativeW: rv.width / renderScale,
            nativeH: rv.height / renderScale,
            bitmap,
            renderScale,
          };

          // LRU eviction
          cache.push(cached);
          while (cache.length > PAGE_CACHE_MAX) {
            const evicted = cache.shift();
            evicted?.bitmap.close();
          }
        }

        // Draw the cached bitmap scaled to the display canvas
        ctx.drawImage(cached.bitmap, 0, 0, canvas.width, canvas.height);
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error('PDF render error:', err);
        }
      }
    };

    renderPage();
    return () => { cancelled = true; };
    // `cachedDocument?.id` is included so the effect re-runs when the user
    // replaces the PDF (e.g. clicking "Nouveau plan vierge" on top of an
    // existing plan). Without it, if currentPage/zoom/rotation happen to be
    // identical, the effect skips re-running and the stale bitmap stays on
    // the canvas — pdfDocRef.current is updated by loadPDF but the effect
    // never knows.
    // `loadEpoch` is included so the effect re-fires after a `restore: true`
    // load on remount: in that path setDocument is NOT called, so
    // cachedDocument?.id stays the same. We can't use `hasDocument` because
    // on remount it's already `true` (initialised from the surviving store)
    // and `setHasDocument(true)` after the async load is a no-op (Object.is
    // bail-out). `loadEpoch` is incremented on every successful load and so
    // always changes — guaranteeing the render effect re-fires.
  }, [currentPage, viewState.zoom, viewState.rotation, containerSize, cachedDocument?.id, loadEpoch]);

  // ── Render Image ──
  useEffect(() => {
    const img = imageRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !imageNativeSize) return;

    const dpr = window.devicePixelRatio || 1;
    const scaleX = containerSize.width / img.naturalWidth;
    const scaleY = containerSize.height / img.naturalHeight;
    const baseScale = Math.min(scaleX, scaleY) || 1;

    // Publish baseScale to store so measurements can rescale on container resize
    useMetreStore.getState().setBaseScale(baseScale);

    const finalScale = baseScale * viewState.zoom * dpr;

    const w = img.naturalWidth * finalScale;
    const h = img.naturalHeight * finalScale;

    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w / dpr}px`;
    canvas.style.height = `${h / dpr}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, w, h);
    // `loadEpoch` is included so this effect re-fires after a `restore: true`
    // image load on remount (same rationale as the PDF render effect above).
  }, [imageNativeSize, viewState.zoom, containerSize, loadEpoch]);

  // Wheel zoom
  useEffect(() => {
    const el = containerRef.current;
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

  // Pan
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const shouldPan =
        e.button === 1 ||
        e.button === 2 ||
        (e.button === 0 && activeTool === 'pan') ||
        (e.button === 0 && spaceHeldRef.current);
      if (shouldPan) {
        isPanningRef.current = true;
        lastPanPosRef.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      }
    },
    [activeTool]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      setMousePosition({ x: canvasX, y: canvasY });

      const cal = useMetreStore.getState().calibration;
      const currentZoom = useMetreStore.getState().viewState.zoom;
      if (cal && canvas) {
        const dpr = window.devicePixelRatio || 1;
        const canvasRect = canvas.getBoundingClientRect();
        const pxOnCanvas = e.clientX - canvasRect.left;
        const pyOnCanvas = e.clientY - canvasRect.top;
        const displayW = parseFloat(canvas.style.width) || canvas.width / dpr;
        const displayH = parseFloat(canvas.style.height) || canvas.height / dpr;
        const pageX = (pxOnCanvas / displayW) * (canvas.width / dpr);
        const pageY = (pyOnCanvas / displayH) * (canvas.height / dpr);
        const worldX = pageX * cal.scaleFactor / currentZoom;
        const worldY = pageY * cal.scaleFactor / currentZoom;
        setMouseWorldPosition({ x: worldX, y: worldY });
      } else {
        setMouseWorldPosition(null);
      }

      if (isPanningRef.current) {
        const dx = e.clientX - lastPanPosRef.current.x;
        const dy = e.clientY - lastPanPosRef.current.y;
        lastPanPosRef.current = { x: e.clientX, y: e.clientY };
        const currentVS = useMetreStore.getState().viewState;
        useMetreStore.getState().setViewState({
          offsetX: currentVS.offsetX + dx,
          offsetY: currentVS.offsetY + dy,
        });
      }
    },
    [setMousePosition, setMouseWorldPosition]
  );

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  // File drop handler — supports PDF and images
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;

      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const reader = new FileReader();
        reader.onload = () => {
          if (reader.result) loadPDF(reader.result as ArrayBuffer);
        };
        reader.readAsArrayBuffer(file);
      } else if (isImageFile(file)) {
        loadImage(file);
      }
    },
    [loadPDF, loadImage]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const cursorClass =
    activeTool === 'pan'
      ? isPanningRef.current
        ? 'cursor-grabbing'
        : 'cursor-grab'
      : activeTool === 'select'
      ? 'cursor-default'
      : 'cursor-crosshair';

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 overflow-hidden flex items-center justify-center ${cursorClass}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={handleContextMenu}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div
        style={{
          transform: `translate(${viewState.offsetX}px, ${viewState.offsetY}px)`,
          position: 'relative',
        }}
      >
        <canvas
          ref={canvasRef}
          id="pdf-canvas"
          className="shadow-xl"
        />

        {/* Placeholder when no document */}
        {!hasDocument && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <FolderOpen size={48} className="text-metre-muted/40" />
            <p className="text-metre-muted text-sm text-center max-w-md px-4">
              Glissez-déposez un PDF ou une image directement ici, ou utilisez le bouton{' '}
              <FolderOpen size={14} className="inline -mt-0.5" /> dans la barre d&apos;outils.
            </p>
            <button
              className="flex items-center gap-2 px-4 py-2 rounded bg-metre-accent text-white text-sm hover:bg-metre-accent-hover transition-colors"
              onClick={() => {
                const buf = generateBlankTemplatePdf();
                loadPDF(buf);
              }}
            >
              <FilePlus2 size={16} />
              Nouveau plan vierge (ARCH D 36&quot;&times;24&quot;)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
