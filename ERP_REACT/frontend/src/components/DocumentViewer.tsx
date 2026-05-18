/**
 * Reusable modal to preview a dossier attachment inline (PDF, image, text).
 *
 * Fetches the file via the authenticated /preview endpoint as a Blob, then:
 *   - PDF  → renders each page to a <canvas> via pdfjs-dist (PDF.js).
 *            We can't use <iframe> because Chrome's built-in PDF viewer
 *            creates an internal sub-iframe with src="" that violates our
 *            `frame-src 'self' blob:` CSP. <object type="application/pdf">
 *            also falls through to its fallback silently on some Chrome
 *            builds. Rendering to canvas bypasses both quirks.
 *   - Image → <img> centered with contain-fit
 *   - Text (txt/csv/log/json/md/xml) → <pre> wrapped
 *   - Everything else → fallback card with a "Télécharger" CTA
 *
 * The object URL is revoked on unmount / file change to avoid memory leaks.
 */

import React, { useEffect, useRef, useState } from 'react';
import { X, Download, FileWarning, Loader2, ExternalLink } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { previewAttachment, downloadAttachment } from '@/api/documents';
import { useScrollLock } from '@/hooks/useScrollLock';

// Configure the PDF.js worker. Vite resolves this URL to a bundled asset
// served from the frontend's origin, so the worker loads under our
// `script-src 'self'` CSP. Assigning the same URL more than once (the
// metre-pdf module also sets it) is idempotent — it's just a string.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export interface DocumentViewerProps {
  dossierId: number;
  attId: number;
  fileName: string;
  contentType?: string;
  onClose: () => void;
}

type PreviewKind = 'pdf' | 'image' | 'text' | 'unsupported';

function detectKind(name: string, ct?: string): PreviewKind {
  const mime = (ct || '').toLowerCase();
  const lname = (name || '').toLowerCase();
  if (mime === 'application/pdf' || lname.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lname)) return 'image';
  if (
    mime.startsWith('text/') ||
    /\.(txt|csv|log|json|md|xml|html?|ya?ml)$/i.test(lname)
  ) {
    return 'text';
  }
  return 'unsupported';
}

function formatBytes(n?: number): string {
  if (n == null || Number.isNaN(n)) return '';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

export function DocumentViewer({
  dossierId,
  attId,
  fileName,
  contentType,
  onClose,
}: DocumentViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  // Raw PDF bytes kept alongside blobUrl: PdfCanvasViewer feeds them into
  // pdfjs-dist, and the blobUrl still powers the "Nouvel onglet" fallback.
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [blobSize, setBlobSize] = useState<number | null>(null);
  const urlRef = useRef<string | null>(null);

  const kind = detectKind(fileName, contentType);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTextContent(null);
    setBlobUrl(null);
    setPdfBlob(null);

    previewAttachment(dossierId, attId)
      .then(async (resp) => {
        if (cancelled) return;
        const blob = resp.data as Blob;
        if (!cancelled) setBlobSize(blob.size);
        if (kind === 'text') {
          // Cap text preview size to prevent freezing the tab on huge logs.
          // Users can still download large text files via the Download button.
          const TEXT_PREVIEW_CAP_BYTES = 5 * 1024 * 1024; // 5 Mo
          if (blob.size > TEXT_PREVIEW_CAP_BYTES) {
            if (!cancelled) setError('Fichier trop volumineux pour l’aperçu texte. Téléchargez-le pour le consulter.');
            return;
          }
          const txt = await blob.text();
          if (!cancelled) setTextContent(txt);
        } else {
          // Re-check `cancelled` right before createObjectURL: the effect may
          // have been torn down between the .then start and here (e.g. user
          // closed the modal while fetch was in flight). Without this guard
          // we'd allocate an orphan blob URL that the cleanup has already
          // run past, leaking it until the page reloads.
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          setBlobUrl(url);
          // PDFs also need the raw Blob so PdfCanvasViewer can hand it to
          // pdfjs-dist. The blobUrl is still used by the "Nouvel onglet"
          // button as a fallback viewer.
          if (kind === 'pdf' && !cancelled) setPdfBlob(blob);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const detail =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setError(detail || 'Impossible de charger le document');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      // Defer the revoke by 60s so that if the user clicked "Ouvrir dans
      // nouvel onglet" just before closing the modal, the blob URL stays
      // valid in the new tab long enough to load and be cached by the
      // browser. Without the defer, closing the modal immediately breaks
      // the fallback tab. Memory cost: a single Blob held for 60s max.
      if (urlRef.current) {
        const toRevoke = urlRef.current;
        urlRef.current = null;
        setTimeout(() => URL.revokeObjectURL(toRevoke), 60_000);
      }
    };
  }, [dossierId, attId, kind]);

  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Verrou de scroll partage avec Modal.tsx via ref-counting -- evite que la
  // fermeture du DocumentViewer libere body.overflow alors qu'un Modal parent
  // est encore ouvert (ou inversement).
  useScrollLock(true);

  const handleDownload = async () => {
    try {
      const resp = await downloadAttachment(dossierId, attId);
      const url = URL.createObjectURL(resp.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // fall through — the preview modal stays open
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Aperçu: ${fileName}`}
    >
      <div
        className="relative flex flex-col w-full h-full max-w-6xl bg-white dark:bg-gray-900 rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate" title={fileName}>
              {fileName}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {contentType || 'Document'}
              {blobSize != null && <span> · {formatBytes(blobSize)}</span>}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {blobUrl && (kind === 'pdf' || kind === 'image') && (
              <button
                type="button"
                onClick={() => window.open(blobUrl, '_blank', 'noopener,noreferrer')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600"
                title="Ouvrir dans un nouvel onglet du navigateur"
              >
                <ExternalLink size={14} />
                <span className="hidden sm:inline">Nouvel onglet</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600"
              title="Télécharger le fichier"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Télécharger</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 rounded"
              aria-label="Fermer"
              title="Fermer (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 bg-gray-100 dark:bg-gray-950 flex items-stretch justify-center">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
              <Loader2 size={28} className="animate-spin" />
              <span className="text-sm">Chargement du document…</span>
            </div>
          )}

          {!loading && error && (
            <div
              role="alert"
              className="flex flex-col items-center justify-center gap-3 p-6 text-center"
            >
              <FileWarning size={40} className="text-amber-500" />
              <p className="text-sm font-medium text-gray-900 dark:text-white">Aperçu indisponible</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md">{error}</p>
              <button
                type="button"
                onClick={handleDownload}
                className="mt-2 flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-seaop-primary-600 hover:bg-seaop-primary-700 rounded"
              >
                <Download size={14} />
                Télécharger le fichier
              </button>
            </div>
          )}

          {!loading && !error && kind === 'pdf' && pdfBlob && (
            <PdfCanvasViewer blob={pdfBlob} />
          )}

          {!loading && !error && kind === 'image' && blobUrl && (
            <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
              <img
                src={blobUrl}
                alt={fileName}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}

          {!loading && !error && kind === 'text' && textContent != null && (
            <div className="w-full h-full overflow-auto p-4">
              <pre className="text-xs font-mono text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
                {textContent}
              </pre>
            </div>
          )}

          {!loading && !error && kind === 'unsupported' && (
            <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
              <FileWarning size={40} className="text-gray-400" />
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                Aperçu non disponible pour ce format
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md">
                Les formats Office (Excel, Word) et autres fichiers spécialisés ne peuvent pas
                être prévisualisés directement. Téléchargez le fichier pour l&apos;ouvrir dans
                l&apos;application appropriée.
              </p>
              <button
                type="button"
                onClick={handleDownload}
                className="mt-2 flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-seaop-primary-600 hover:bg-seaop-primary-700 rounded"
              >
                <Download size={14} />
                Télécharger le fichier
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Internal: PDF renderer built on pdfjs-dist
// ────────────────────────────────────────────────────────────────────────
//
// Renders every page of a PDF Blob to its own <canvas>, stacked in a
// scrollable column. Pages are lazy-rendered on scroll via
// IntersectionObserver so opening a 100-page PDF only rasterises the first
// page up-front.
//
// We use this instead of <iframe>/<object> because:
//   - Chrome's native PDF viewer creates an internal sub-iframe with
//     src="" when embedded in an <iframe>, which violates our
//     `frame-src 'self' blob:` CSP ("Framing '' violates…").
//   - <object type="application/pdf"> falls through to its fallback
//     content silently on some Chrome builds, leaving only the "we can't
//     display this PDF" message.
//
// Rendering to canvas sidesteps both issues — the worker is served from
// the frontend origin (allowed by `script-src 'self'`) and nothing gets
// framed.

function PdfCanvasViewer({ blob }: { blob: Blob }) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let activePdf: pdfjsLib.PDFDocumentProxy | null = null;
    setPdf(null);
    setPageCount(0);
    setLoadError(null);

    (async () => {
      try {
        const buf = await blob.arrayBuffer();
        if (cancelled) return;
        // Pass a fresh Uint8Array — pdfjs may transfer/consume the buffer
        // it's given, and reusing the original would break a subsequent
        // re-open of the same file from the same Blob.
        const task = pdfjsLib.getDocument({ data: new Uint8Array(buf) });
        activePdf = await task.promise;
        if (cancelled) {
          try { activePdf.destroy(); } catch { /* ignore */ }
          return;
        }
        setPdf(activePdf);
        setPageCount(activePdf.numPages);
      } catch (err) {
        console.error('PDF.js failed to load document:', err);
        if (!cancelled) setLoadError('Impossible de lire ce PDF');
      }
    })();

    return () => {
      cancelled = true;
      if (activePdf) {
        try { activePdf.destroy(); } catch { /* ignore */ }
      }
    };
  }, [blob]);

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
        <FileWarning size={40} className="text-amber-500" />
        <p className="text-sm font-medium text-gray-900 dark:text-white">
          {loadError}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md">
          Essayez «&nbsp;Nouvel onglet&nbsp;» ou téléchargez le fichier.
        </p>
      </div>
    );
  }

  if (!pdf) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
        <Loader2 size={24} className="animate-spin" />
        <span className="text-xs">Analyse du PDF…</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto bg-gray-200 dark:bg-gray-950 p-4">
      <div className="flex flex-col items-center gap-4">
        {Array.from({ length: pageCount }, (_, i) => (
          <PdfPage key={i + 1} pdf={pdf} pageNum={i + 1} scale={1.5} />
        ))}
      </div>
    </div>
  );
}

interface PdfPageProps {
  pdf: pdfjsLib.PDFDocumentProxy;
  pageNum: number;
  /** Render scale relative to the PDF's native point grid (1 = 72dpi). */
  scale: number;
}

function PdfPage({ pdf, pageNum, scale }: PdfPageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [shouldRender, setShouldRender] = useState(false);

  // Fetch page dimensions up-front so the placeholder reserves the right
  // vertical space (avoids layout shift as later pages render).
  useEffect(() => {
    let cancelled = false;
    pdf
      .getPage(pageNum)
      .then((page) => {
        if (cancelled) return;
        const vp = page.getViewport({ scale });
        setDims({ w: Math.round(vp.width), h: Math.round(vp.height) });
      })
      .catch(() => {
        /* page metadata unavailable — fall back to default dims */
      });
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNum, scale]);

  // IntersectionObserver triggers the actual rasterisation only when the
  // page is about to enter the viewport. rootMargin: '400px' pre-renders
  // one screen-height ahead so scrolling doesn't catch a blank page.
  useEffect(() => {
    if (shouldRender) return;
    const node = wrapperRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShouldRender(true);
          io.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [shouldRender]);

  // Rasterise the page once shouldRender flips true.
  useEffect(() => {
    if (!shouldRender || !canvasRef.current || !dims) return;
    let cancelled = false;
    let task: pdfjsLib.RenderTask | null = null;
    (async () => {
      try {
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
        // Render at scale * devicePixelRatio into the canvas backing
        // store, then let CSS scale it back down — keeps text crisp on
        // retina displays without inflating display size.
        const dpr = window.devicePixelRatio || 1;
        const vp = page.getViewport({ scale: scale * dpr });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        task = page.render({ canvasContext: ctx, viewport: vp });
        await task.promise;
      } catch (err) {
        if ((err as { name?: string })?.name !== 'RenderingCancelledException') {
          console.error(`PDF page ${pageNum} render failed:`, err);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (task) {
        try { task.cancel(); } catch { /* ignore */ }
      }
    };
  }, [shouldRender, pdf, pageNum, scale, dims]);

  return (
    <div
      ref={wrapperRef}
      className="bg-white shadow-md relative w-full"
      style={{
        maxWidth: dims?.w ?? 918,
        aspectRatio: dims ? `${dims.w} / ${dims.h}` : '612 / 792',
      }}
    >
      {shouldRender ? (
        <canvas ref={canvasRef} className="block w-full h-auto" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-gray-300">
          <Loader2 size={18} className="animate-spin" />
        </div>
      )}
    </div>
  );
}

export default DocumentViewer;
