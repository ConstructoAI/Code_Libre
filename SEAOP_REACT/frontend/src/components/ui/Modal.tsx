import React, { useEffect, useCallback } from 'react';
import clsx from 'clsx';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
}

const sizeStyles: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
};

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  size = 'md',
  children,
}) => {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 flex items-center justify-center',
        'sm:p-4',
        'transition-opacity duration-200',
        isOpen ? 'opacity-100' : 'opacity-0',
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Content panel — full-screen on mobile, centered card on desktop */}
      <div
        className={clsx(
          'relative w-full shadow-xl',
          'bg-white dark:bg-[#292827]',
          'border-0 sm:border border-[#edebe9] dark:border-[#3b3a39]',
          'transform transition-all duration-200',
          // Full-screen on mobile, auto-height centered card on sm+
          'h-full sm:h-auto',
          'rounded-none sm:rounded-md',
          'overflow-y-auto',
          isOpen
            ? 'translate-y-0 opacity-100 scale-100'
            : 'translate-y-4 opacity-0 scale-95',
          sizeStyles[size],
        )}
      >
        {/* Header */}
        {title && (
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#edebe9] dark:border-[#3b3a39] px-4 sm:px-6 py-4 bg-white dark:bg-[#292827]">
            <h2
              id="modal-title"
              className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]"
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              className={clsx(
                'rounded p-1.5 text-[#a19f9d] hover:text-[#323130] dark:hover:text-[#f3f2f1]',
                'hover:bg-[#f3f2f1] dark:hover:bg-[#3b3a39]',
                'transition-colors duration-150',
                'focus:outline-none focus:ring-2 focus:ring-[#0078D4]',
                'min-h-[44px] min-w-[44px] flex items-center justify-center',
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
            onClick={onClose}
            className={clsx(
              'absolute right-3 top-3 rounded p-1.5 text-[#a19f9d] hover:text-[#323130] dark:hover:text-[#f3f2f1]',
              'hover:bg-[#f3f2f1] dark:hover:bg-[#3b3a39]',
              'transition-colors duration-150',
              'focus:outline-none focus:ring-2 focus:ring-[#0078D4]',
              'min-h-[44px] min-w-[44px] flex items-center justify-center',
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
        <div className="px-4 sm:px-6 py-4">{children}</div>
      </div>
    </div>
  );
};

Modal.displayName = 'Modal';

export { Modal };
export type { ModalProps };
