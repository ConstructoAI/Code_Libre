import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  html: string;
  title: string;
  loading?: boolean;
}

/**
 * Devis HTML preview modal (iframe).
 *
 * Inlined (instead of reusing the global Modal) so it can:
 *   1. Render on top of another modal — uses z-[60] vs the global Modal's z-50.
 *   2. Handle Escape without bubbling to the parent modal's document listener.
 *   3. Use a strict iframe sandbox="" — blocks scripts, same-origin, popups.
 */
export default function DevisHtmlPreviewModal({ isOpen, onClose, html, title, loading = false }: Props) {
  const [popupError, setPopupError] = useState<string | null>(null);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    // Capture phase so this handler runs before any parent modal listener,
    // then stopPropagation prevents the parent from also closing on Escape.
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [isOpen, handleEscape]);

  const openInNewTab = () => {
    setPopupError(null);
    try {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win) {
        URL.revokeObjectURL(url);
        setPopupError('Popup bloqué par le navigateur. Autorisez les popups pour ce site et réessayez.');
        return;
      }
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setPopupError('Impossible d\'ouvrir un nouvel onglet.');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="devis-html-preview-title"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={clsx(
          'relative w-full max-w-[calc(100vw-1rem)] sm:max-w-5xl rounded-xl shadow-2xl max-h-[95vh] overflow-hidden',
          'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700',
          'flex flex-col',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3 sm:px-6 sm:py-4 flex-shrink-0">
          <h2
            id="devis-html-preview-title"
            className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mr-2 truncate"
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            className={clsx(
              'rounded-lg p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400',
              'hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
              'transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500',
            )}
            aria-label="Fermer"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : html ? (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden h-[calc(100vh-240px)] md:h-[70vh]">
              <iframe
                srcDoc={html}
                title={title}
                className="w-full h-full bg-white"
                sandbox=""
              />
            </div>
          ) : (
            <div className="flex justify-center py-12 text-sm text-gray-500 dark:text-gray-400">
              Aucun contenu à afficher
            </div>
          )}
          {popupError && (
            <div className="px-3 py-2 rounded-md text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800">
              {popupError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 sm:px-6 sm:py-4 flex justify-end gap-3 flex-shrink-0">
          <Button variant="ghost" onClick={openInNewTab} disabled={!html}>
            Ouvrir dans un nouvel onglet
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </div>
  );
}
