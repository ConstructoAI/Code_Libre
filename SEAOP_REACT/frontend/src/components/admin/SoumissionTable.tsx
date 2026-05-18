/**
 * SEAOP React Frontend - Admin Soumission Overview Table
 * Displays all soumissions sorted by date with colored status badges.
 */

import { useEffect } from 'react';
import clsx from 'clsx';
import { FileText } from 'lucide-react';
import { useAdminStore } from '@/store/useAdminStore';
import { Badge, type BadgeColor } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { formatCurrency, formatDate } from '@/utils/format';

// ============ Status Badge Mapping ============

const STATUS_COLORS: Record<string, BadgeColor> = {
  envoyee: 'blue',
  vue: 'purple',
  en_evaluation: 'yellow',
  acceptee: 'green',
  refusee: 'red',
};

const STATUS_LABELS: Record<string, string> = {
  envoyee: 'Envoyée',
  vue: 'Vue',
  en_evaluation: 'En évaluation',
  acceptee: 'Acceptée',
  refusee: 'Refusée',
};

function getStatusColor(statut: string): BadgeColor {
  return STATUS_COLORS[statut] ?? 'gray';
}

function getStatusLabel(statut: string): string {
  return STATUS_LABELS[statut] ?? statut;
}

// ============ Component ============

export default function SoumissionTable() {
  const { soumissions, isLoading, error, fetchSoumissions, clearError } = useAdminStore();

  useEffect(() => {
    fetchSoumissions();
  }, [fetchSoumissions]);

  // Sort by date (most recent first)
  const sorted = [...soumissions].sort((a, b) => {
    const dateA = String(a.dateSoumission ?? a.createdAt ?? '');
    const dateB = String(b.dateSoumission ?? b.createdAt ?? '');
    return dateB.localeCompare(dateA);
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert type="error" onClose={clearError}>
        {error}
      </Alert>
    );
  }

  if (sorted.length === 0) {
    return (
      <Card>
        <div className="text-center py-12">
          <FileText className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            Aucune soumission enregistrée
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        Soumissions récentes
      </h3>
      {/* Mobile: Card list (< sm) */}
      <div className="space-y-3 sm:hidden" role="list" aria-label="Soumissions (vue mobile)">
        {sorted.map((soum, idx) => {
          const statut = String(soum.statut ?? 'envoyee');
          const reference = String(soum.projetReference ?? soum.projetId ?? '--');
          const entrepreneur = String(
            soum.entrepreneurNom ?? soum.nomEntreprise ?? '--',
          );
          const montant = Number(soum.montantTotal ?? soum.montant ?? 0);
          const date = String(soum.dateSoumission ?? soum.createdAt ?? '');

          return (
            <Card key={soum.id != null ? `soum-${soum.id}` : `soum-idx-${idx}`} padding="sm">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-mono text-sm font-semibold text-seaop-primary-600 dark:text-seaop-primary-400 break-all">
                    {reference}
                  </div>
                  <Badge color={getStatusColor(statut)} size="sm">
                    {getStatusLabel(statut)}
                  </Badge>
                </div>
                <div className="text-sm text-gray-900 dark:text-gray-100 break-words">
                  {entrepreneur}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {formatCurrency(montant)}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {formatDate(date)}
                  </span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Desktop: Table (sm+) */}
      <Card padding="sm" className="hidden sm:block">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  Réf. projet
                </th>
                <th className="text-left py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  Entrepreneur
                </th>
                <th className="text-right py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  Montant
                </th>
                <th className="text-center py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  Statut
                </th>
                <th className="text-right py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {sorted.map((soum, idx) => {
                const statut = String(soum.statut ?? 'envoyee');
                const reference = String(soum.projetReference ?? soum.projetId ?? '--');
                const entrepreneur = String(
                  soum.entrepreneurNom ?? soum.nomEntreprise ?? '--',
                );
                const montant = Number(soum.montantTotal ?? soum.montant ?? 0);
                const date = String(soum.dateSoumission ?? soum.createdAt ?? '');

                return (
                  <tr
                    key={soum.id != null ? `soum-${soum.id}` : `soum-idx-${idx}`}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono text-sm font-semibold text-seaop-primary-600 dark:text-seaop-primary-400 whitespace-nowrap">
                      {reference}
                    </td>
                    <td className="py-3 px-4 text-gray-900 dark:text-gray-100">
                      {entrepreneur}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                      {formatCurrency(montant)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge color={getStatusColor(statut)} size="sm">
                        {getStatusLabel(statut)}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(date)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
