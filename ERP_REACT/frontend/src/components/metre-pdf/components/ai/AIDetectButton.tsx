import React, { useEffect, useState } from 'react';
import { Sparkles, AlertCircle } from 'lucide-react';
import { useMetreStore } from '../../store';
import AIDetectModal from './AIDetectModal';

interface Props {
  documentId: number | null;
  /** 1-based page number (matches the store / pdf.js convention). */
  pageNumber: number;
  disabled?: boolean;
  /** Optional explanatory tooltip shown when the button is disabled. */
  disabledReason?: string;
  className?: string;
}

/**
 * Bouton declenchant l'ouverture du modal de configuration de detection IA.
 *
 * PHASE 2: au lieu de lancer directement la detection generique, ouvre un
 * modal qui propose 3 modes (generique, section unique avec BOM, multi-sections).
 *
 * Indexation des pages:
 * - Le store / pdf.js utilisent une numerotation 1-based.
 * - Le modal convertit en 0-based avant d'appeler le backend.
 */
export const AIDetectButton: React.FC<Props> = ({
  documentId,
  pageNumber,
  disabled,
  disabledReason,
  className = '',
}) => {
  const loading = useMetreStore((s) => s.aiDetectionLoading);
  const error = useMetreStore((s) => s.aiDetectionError);

  const [modalOpen, setModalOpen] = useState(false);
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    if (error) {
      setShowError(true);
      const t = setTimeout(() => setShowError(false), 6000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const isDisabled = disabled || loading || !documentId;

  const titleText = !documentId
    ? (disabledReason ?? "Charger un document PDF d'abord")
    : disabled
      ? (disabledReason ?? "Calibrer l'echelle de la page d'abord")
      : 'Detection automatique IA (Claude Vision)';

  return (
    <div className={`relative inline-flex flex-col ${className}`}>
      <button
        type="button"
        onClick={() => !isDisabled && setModalOpen(true)}
        disabled={isDisabled}
        title={titleText}
        className={[
          'inline-flex items-center gap-2 px-3 py-1.5 rounded-md',
          'text-sm font-medium transition-colors',
          isDisabled
            ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
            : 'bg-indigo-600 text-white hover:bg-indigo-500 active:bg-indigo-700',
        ].join(' ')}
      >
        <Sparkles className="w-4 h-4" />
        <span>Detecter IA</span>
      </button>
      {showError && error && !modalOpen && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-rose-100 border border-rose-200 text-rose-700 text-xs rounded p-2 flex items-start gap-1 max-w-xs">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      <AIDetectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        documentId={documentId}
        pageNumber={pageNumber}
      />
    </div>
  );
};

export default AIDetectButton;
