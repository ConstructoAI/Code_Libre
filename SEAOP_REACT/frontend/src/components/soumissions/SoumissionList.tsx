/**
 * SEAOP React Frontend - Soumission List
 * Displays a sortable grid of SoumissionCard items.
 */

import { useState, useMemo } from 'react';
import clsx from 'clsx';
import { ArrowUpDown, FileText } from 'lucide-react';

import type { Soumission } from '@/types';
import { SoumissionCard } from './SoumissionCard';
import { Spinner } from '@/components/ui/Spinner';

interface Props {
  soumissions: Soumission[];
  isClientView?: boolean;
  onAccept?: (id: number) => void;
  onReject?: (id: number) => void;
  onAward?: (id: number) => void;
  onViewDetails?: (id: number) => void;
  isLoading?: boolean;
}

type SortKey = 'montant_asc' | 'montant_desc' | 'date' | 'evaluation';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'montant_asc', label: 'Montant (croissant)' },
  { key: 'montant_desc', label: 'Montant (décroissant)' },
  { key: 'date', label: 'Plus récentes' },
  { key: 'evaluation', label: 'Meilleure évaluation' },
];

function sortSoumissions(items: Soumission[], sortKey: SortKey): Soumission[] {
  const sorted = [...items];
  switch (sortKey) {
    case 'montant_asc':
      return sorted.sort((a, b) => a.montant - b.montant);
    case 'montant_desc':
      return sorted.sort((a, b) => b.montant - a.montant);
    case 'date':
      return sorted.sort((a, b) => {
        const da = a.dateCreation ? new Date(a.dateCreation).getTime() : 0;
        const db = b.dateCreation ? new Date(b.dateCreation).getTime() : 0;
        return db - da;
      });
    case 'evaluation':
      return sorted.sort(
        (a, b) => (b.evaluationsMoyenne ?? 0) - (a.evaluationsMoyenne ?? 0),
      );
    default:
      return sorted;
  }
}

function SoumissionList({
  soumissions,
  isClientView = false,
  onAccept,
  onReject,
  onAward,
  onViewDetails,
  isLoading = false,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('date');

  const sortedSoumissions = useMemo(
    () => sortSoumissions(soumissions, sortKey),
    [soumissions, sortKey],
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (soumissions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileText className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" />
        <p className="text-lg font-medium text-gray-500 dark:text-gray-400">
          Aucune soumission
        </p>
        <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">
          {isClientView
            ? "Aucun entrepreneur n'a encore soumis de proposition pour ce projet."
            : "Vous n'avez pas encore soumis de proposition."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sort controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
          <ArrowUpDown className="h-4 w-4" />
          <span>Trier par :</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setSortKey(opt.key)}
              className={clsx(
                'px-3 py-1 rounded-full text-xs font-medium transition-colors duration-150',
                sortKey === opt.key
                  ? 'bg-seaop-primary-100 text-seaop-primary-700 dark:bg-seaop-primary-900/40 dark:text-seaop-primary-300'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">
          {soumissions.length} soumission{soumissions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sortedSoumissions.map((s) => (
          <SoumissionCard
            key={s.id}
            soumission={s}
            isClientView={isClientView}
            onAccept={onAccept}
            onReject={onReject}
            onAward={onAward}
            onViewDetails={onViewDetails}
          />
        ))}
      </div>
    </div>
  );
}

SoumissionList.displayName = 'SoumissionList';

export { SoumissionList };
export type { Props as SoumissionListProps };
