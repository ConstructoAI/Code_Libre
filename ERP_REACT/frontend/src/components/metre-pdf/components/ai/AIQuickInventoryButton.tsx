import React, { useState } from 'react';
import { ListChecks } from 'lucide-react';
import AIQuickInventoryModal from './AIQuickInventoryModal';

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
 * PHASE 3: Bouton "Inventaire IA rapide".
 *
 * Alternative au mode markup overlay. Ouvre un modal ou Claude analyse le
 * plan et retourne une liste texte structuree (item, dimensions, qty, notes)
 * SANS coords ni overlay.
 *
 * Ce mode N'EXIGE PAS la calibration (Claude lit les annotations du plan,
 * pas besoin de scale_factor). Le bouton n'est desactive que si aucun
 * document n'est charge.
 */
export const AIQuickInventoryButton: React.FC<Props> = ({
  documentId,
  pageNumber,
  disabled,
  disabledReason,
  className = '',
}) => {
  const [modalOpen, setModalOpen] = useState(false);

  const isDisabled = disabled || !documentId;

  const titleText = !documentId
    ? (disabledReason ?? "Charger un document PDF d'abord")
    : disabled
      ? (disabledReason ?? 'Indisponible')
      : 'Inventaire IA rapide (liste texte sans markup)';

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
            : 'bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700',
        ].join(' ')}
      >
        <ListChecks className="w-4 h-4" />
        <span>Inventaire IA</span>
      </button>
      <AIQuickInventoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        documentId={documentId}
        pageNumber={pageNumber}
      />
    </div>
  );
};

export default AIQuickInventoryButton;
