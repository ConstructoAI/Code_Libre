/**
 * AttachmentViewer - Visionneuse plein ecran pour pieces jointes mobiles.
 *
 * Supporte images (pinch zoom), PDF (placeholder telecharger), texte plain
 * et fallback generique. Navigation par swipe horizontal entre attachments.
 * Cache offline via IndexedDB (getCachedBlob / cacheBlob).
 *
 * TODO Phase 3 : npm install react-pdf pdfjs-dist puis activer le viewer
 * inline via React.lazy (AttachmentPdfViewer.tsx ci-cote).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X, Share2, Download, FileText, FileX, ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { Attachment } from '@/types';
import { getPreviewUrl, downloadAttachmentBlob } from '@/api/attachments';
import { getCachedBlob, cacheBlob } from '@/utils/attachmentCache';
import { extractApiError } from '@/types/api';
import { Spinner } from './ui/Spinner';

interface AttachmentViewerProps {
  attachments: Attachment[];
  index: number;
  onClose: () => void;
  onIndexChange?: (newIndex: number) => void;
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'image'; url: string; isObjectUrl: boolean }
  | { kind: 'text'; content: string }
  | { kind: 'pdf' }
  | { kind: 'fallback' }
  | { kind: 'error'; message: string };

const SWIPE_THRESHOLD = 50;
const PINCH_MIN_SCALE = 1;
const PINCH_MAX_SCALE = 4;

// Type structurel compatible avec Touch DOM ET React.Touch (qui n'a pas force/radius/rotationAngle)
type PointLike = { clientX: number; clientY: number };
function distance(t1: PointLike, t2: PointLike): number {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

const AttachmentViewer: React.FC<AttachmentViewerProps> = ({
  attachments,
  index,
  onClose,
  onIndexChange,
}) => {
  const current = attachments[index];
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [scale, setScale] = useState<number>(1);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [reloadKey, setReloadKey] = useState<number>(0);

  // Refs pour touch handlers
  const swipeStartX = useRef<number | null>(null);
  const swipeStartY = useRef<number | null>(null);
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartScale = useRef<number>(1);
  const objectUrlRef = useRef<string | null>(null);

  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  // Charge le contenu selon le mimeType
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    setScale(1);

    // Cleanup objectURL precedent
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    const mime = current.mimeType;

    const loadImage = async (): Promise<void> => {
      try {
        const cached = await getCachedBlob(current.id);
        if (cancelled) return;
        if (cached) {
          const objectUrl = URL.createObjectURL(cached);
          objectUrlRef.current = objectUrl;
          setState({ kind: 'image', url: objectUrl, isObjectUrl: true });
          return;
        }
        const url = await getPreviewUrl(current.id);
        if (cancelled) return;
        setState({ kind: 'image', url, isObjectUrl: false });
        // Cache en background (best-effort)
        void downloadAttachmentBlob(current.id)
          .then((blob) => cacheBlob(current.id, blob, mime))
          .catch(() => undefined);
      } catch (err) {
        if (!cancelled) {
          setState({ kind: 'error', message: extractApiError(err, "Impossible de charger l'image") });
        }
      }
    };

    const loadText = async (): Promise<void> => {
      try {
        const cached = await getCachedBlob(current.id);
        const blob = cached ?? (await downloadAttachmentBlob(current.id));
        if (cancelled) return;
        if (!cached) {
          void cacheBlob(current.id, blob, mime);
        }
        const content = await blob.text();
        if (!cancelled) setState({ kind: 'text', content });
      } catch (err) {
        if (!cancelled) {
          setState({ kind: 'error', message: extractApiError(err, 'Impossible de charger le texte') });
        }
      }
    };

    if (mime.startsWith('image/')) {
      void loadImage();
    } else if (mime === 'application/pdf') {
      setState({ kind: 'pdf' });
    } else if (mime === 'text/plain') {
      void loadText();
    } else {
      setState({ kind: 'fallback' });
    }

    return () => {
      cancelled = true;
    };
  }, [current, reloadKey]);

  // Cleanup objectURL au unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  // ESC pour fermer (UX desktop / clavier physique)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, attachments.length]);

  const goPrev = useCallback((): void => {
    if (index > 0) onIndexChange?.(index - 1);
  }, [index, onIndexChange]);

  const goNext = useCallback((): void => {
    if (index < attachments.length - 1) onIndexChange?.(index + 1);
  }, [index, attachments.length, onIndexChange]);

  // Telecharger le fichier brut
  const handleDownload = useCallback(async (): Promise<void> => {
    if (!current || isDownloading) return;
    setIsDownloading(true);
    try {
      const blob = await downloadAttachmentBlob(current.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = current.originalFilename || current.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert(extractApiError(err, 'Echec du telechargement'));
    } finally {
      setIsDownloading(false);
    }
  }, [current, isDownloading]);

  // Partage natif (Web Share API)
  const handleShare = useCallback(async (): Promise<void> => {
    if (!current || !canShare) return;
    try {
      const blob = await downloadAttachmentBlob(current.id);
      const file = new File([blob], current.originalFilename || current.filename, {
        type: current.mimeType,
      });
      const shareData: ShareData = { title: current.originalFilename || current.filename };
      const navWithFiles = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (navWithFiles.canShare && navWithFiles.canShare({ files: [file] })) {
        (shareData as ShareData & { files?: File[] }).files = [file];
      }
      await navigator.share(shareData);
    } catch {
      // utilisateur annule ou pas supporte : silencieux
    }
  }, [current, canShare]);

  // Touch handlers (body)
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>): void => {
    if (e.touches.length === 2) {
      pinchStartDist.current = distance(e.touches[0], e.touches[1]);
      pinchStartScale.current = scale;
      swipeStartX.current = null;
      swipeStartY.current = null;
    } else if (e.touches.length === 1) {
      swipeStartX.current = e.touches[0].clientX;
      swipeStartY.current = e.touches[0].clientY;
      pinchStartDist.current = null;
    }
  }, [scale]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>): void => {
    if (e.touches.length === 2 && pinchStartDist.current !== null && state.kind === 'image') {
      const newDist = distance(e.touches[0], e.touches[1]);
      const ratio = newDist / pinchStartDist.current;
      const newScale = Math.min(
        PINCH_MAX_SCALE,
        Math.max(0.5, pinchStartScale.current * ratio),
      );
      setScale(newScale);
    }
  }, [state.kind]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>): void => {
    // Fin pinch
    if (pinchStartDist.current !== null) {
      pinchStartDist.current = null;
      if (scale < PINCH_MIN_SCALE) {
        setScale(1);
      }
      return;
    }
    // Fin swipe (single touch)
    if (swipeStartX.current !== null && swipeStartY.current !== null) {
      const endTouch = e.changedTouches[0];
      const deltaX = endTouch.clientX - swipeStartX.current;
      const deltaY = endTouch.clientY - swipeStartY.current;
      swipeStartX.current = null;
      swipeStartY.current = null;
      // Ignorer si scale > 1 (l'utilisateur zoom/pan) ou geste vertical dominant
      if (scale > PINCH_MIN_SCALE) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) return;
      if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
        if (deltaX < 0) goNext();
        else goPrev();
      }
    }
  }, [scale, goNext, goPrev]);

  if (!current) return null;

  const fileName = current.originalFilename || current.filename;
  const hasPrev = index > 0;
  const hasNext = index < attachments.length - 1;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" role="dialog" aria-modal="true">
      {/* Header sticky top */}
      <div className="sticky top-0 z-10 flex items-center bg-black/70 backdrop-blur-sm border-b border-white/10">
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center text-white hover:bg-white/10 active:bg-white/20"
          aria-label="Fermer"
        >
          <X className="h-6 w-6" />
        </button>
        <span className="text-sm font-medium text-white truncate flex-1 px-3 text-center">
          {fileName}
        </span>
        {canShare && (
          <button
            type="button"
            onClick={handleShare}
            className="flex h-11 w-11 items-center justify-center text-white hover:bg-white/10 active:bg-white/20"
            aria-label="Partager"
          >
            <Share2 className="h-5 w-5" />
          </button>
        )}
        <button
          type="button"
          onClick={handleDownload}
          disabled={isDownloading}
          className="flex h-11 w-11 items-center justify-center text-white hover:bg-white/10 active:bg-white/20 disabled:opacity-50"
          aria-label="Telecharger"
        >
          {isDownloading ? <Spinner size="sm" className="text-white" /> : <Download className="h-5 w-5" />}
        </button>
      </div>

      {/* Body */}
      <div
        className="relative flex-1 overflow-hidden flex items-center justify-center"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {state.kind === 'loading' && <Spinner size="lg" className="text-white" />}

        {state.kind === 'image' && (
          <img
            src={state.url}
            alt={fileName}
            className="object-contain max-h-full max-w-full select-none pointer-events-none"
            style={{ transform: `scale(${scale})`, transition: pinchStartDist.current === null ? 'transform 0.2s' : 'none' }}
            draggable={false}
          />
        )}

        {state.kind === 'pdf' && (
          <div className="flex flex-col items-center gap-4 p-6 text-center">
            <FileText className="h-16 w-16 text-white/70" />
            <p className="text-sm text-white/80 max-w-xs">
              Visionneuse PDF en ligne disponible Phase 3. Telechargez le fichier pour le consulter.
            </p>
            <button
              type="button"
              onClick={handleDownload}
              disabled={isDownloading}
              className="flex h-11 items-center gap-2 rounded-md bg-white px-4 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
            >
              {isDownloading ? <Spinner size="sm" /> : <Download className="h-4 w-4" />}
              Telecharger pour voir le PDF
            </button>
          </div>
        )}

        {state.kind === 'text' && (
          <pre className="text-xs text-white overflow-auto p-4 w-full h-full whitespace-pre-wrap font-mono">
            {state.content}
          </pre>
        )}

        {state.kind === 'fallback' && (
          <div className="flex flex-col items-center gap-4 p-6 text-center">
            <FileX className="h-16 w-16 text-white/70" />
            <p className="text-sm text-white/80 max-w-xs">
              Apercu non disponible pour ce type de fichier ({current.mimeType}).
            </p>
            <button
              type="button"
              onClick={handleDownload}
              disabled={isDownloading}
              className="flex h-11 items-center gap-2 rounded-md bg-white px-4 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
            >
              {isDownloading ? <Spinner size="sm" /> : <Download className="h-4 w-4" />}
              Telecharger pour ouvrir
            </button>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="flex flex-col items-center gap-4 p-6 text-center">
            <FileX className="h-16 w-16 text-red-400" />
            <p className="text-sm text-white max-w-xs">{state.message}</p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="flex h-11 items-center gap-2 rounded-md bg-white px-4 text-sm font-medium text-black hover:bg-white/90"
            >
              Reessayer
            </button>
          </div>
        )}

        {/* Boutons navigation desktop (caches sur mobile via swipe) */}
        {hasPrev && (
          <button
            type="button"
            onClick={goPrev}
            className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
            aria-label="Precedent"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            onClick={goNext}
            className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
            aria-label="Suivant"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Footer compteur si plusieurs */}
      {attachments.length > 1 && (
        <div className="flex items-center justify-center py-2 text-xs text-white/70 bg-black/40">
          {index + 1} / {attachments.length}
        </div>
      )}
    </div>
  );
};

AttachmentViewer.displayName = 'AttachmentViewer';

export { AttachmentViewer };
export type { AttachmentViewerProps };
