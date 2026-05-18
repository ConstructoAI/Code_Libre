import React, { useEffect, useId, useRef } from 'react';
import clsx from 'clsx';
import { lockBodyScroll, unlockBodyScroll } from '@/hooks/useScrollLock';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
}

const sizeStyles: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-[calc(100vw-1rem)] sm:max-w-sm',
  md: 'max-w-[calc(100vw-1rem)] sm:max-w-md',
  lg: 'max-w-[calc(100vw-1rem)] sm:max-w-lg',
  xl: 'max-w-[calc(100vw-1rem)] sm:max-w-3xl',
};

// Module-level pile LIFO des modaux ouverts: seul le modal au sommet reagit
// a ESC (sinon un appui fermerait tous les modaux empiles d'un coup).
// Le verrou de scroll est gere par le hook partage useScrollLock pour ne
// pas se desynchroniser avec d'autres overlays (DocumentViewer, etc.).
const modalStack: symbol[] = [];

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  size = 'md',
  children,
}) => {
  // Lazy-init Symbol pour ne pas en allouer un nouveau a chaque render (useRef
  // ne stocke que la 1ere valeur mais l'expression est evaluee a chaque render).
  const modalIdRef = useRef<symbol | null>(null);
  if (modalIdRef.current === null) modalIdRef.current = Symbol('modal');

  // ID HTML unique par instance pour aria-labelledby (sans ca, 2 modaux
  // imbriques avec id="modal-title" identique = HTML invalide + a11y cassee).
  const titleId = useId();
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const id = modalIdRef.current;
    if (id === null) return;
    modalStack.push(id);
    lockBodyScroll();

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (modalStack[modalStack.length - 1] !== id) return;
      onCloseRef.current();
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
      const idx = modalStack.indexOf(id);
      if (idx !== -1) modalStack.splice(idx, 1);
      unlockBodyScroll();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4',
        'transition-opacity duration-200',
        isOpen ? 'opacity-100' : 'opacity-0',
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Content panel */}
      <div
        className={clsx(
          'relative w-full rounded-xl shadow-xl max-h-[95vh] overflow-y-auto',
          'bg-white dark:bg-gray-800',
          'border border-gray-200 dark:border-gray-700',
          'transform transition-all duration-200',
          isOpen
            ? 'translate-y-0 opacity-100 scale-100'
            : 'translate-y-4 opacity-0 scale-95',
          sizeStyles[size],
        )}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3 sm:px-6 sm:py-4">
            <h2
              id={titleId}
              className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mr-2"
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className={clsx(
                'rounded-lg p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
                'hover:bg-gray-100 dark:hover:bg-gray-700',
                'transition-colors duration-150',
                'focus:outline-none focus:ring-2 focus:ring-seaop-primary-500',
              )}
              aria-label="Close modal"
            >
              <svg
                className="h-5 w-5"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* Close button when no title */}
        {!title && (
          <button
            type="button"
            onClick={onClose}
            className={clsx(
              'absolute right-2 top-2 rounded-lg p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
              'hover:bg-gray-100 dark:hover:bg-gray-700',
              'transition-colors duration-150',
              'focus:outline-none focus:ring-2 focus:ring-seaop-primary-500',
            )}
            aria-label="Close modal"
          >
            <svg
              className="h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}

        {/* Body */}
        <div className="px-4 py-3 sm:px-6 sm:py-4">{children}</div>
      </div>
    </div>
  );
};

Modal.displayName = 'Modal';

export { Modal };
export type { ModalProps };
