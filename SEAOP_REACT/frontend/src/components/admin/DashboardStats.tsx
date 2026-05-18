/**
 * SEAOP React Frontend - Admin Dashboard Statistics
 * Displays KPI cards, top entrepreneurs table, and monthly evolution chart.
 */

import { useEffect } from 'react';
import clsx from 'clsx';
import { Briefcase, Users, FileText, DollarSign, Star } from 'lucide-react';
import { useAdminStore } from '@/store/useAdminStore';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { formatCurrency } from '@/utils/format';

// ============ StatCard Sub-Component ============

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ label, value, icon, color }: StatCardProps) {
  return (
    <Card>
      <div className="flex items-center gap-4">
        <div
          className={clsx(
            'flex items-center justify-center h-12 w-12 rounded-xl shrink-0',
            color,
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
        </div>
      </div>
    </Card>
  );
}

// ============ Monthly Bar Chart (CSS-only) ============

interface MonthlyBarProps {
  data: { mois: string; montant: number }[];
}

function MonthlyBarChart({ data }: MonthlyBarProps) {
  const max = Math.max(...data.map((d) => d.montant), 1);

  return (
    <Card>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        Évolution mensuelle
      </h3>
      <div className="flex items-end gap-2 h-48">
        {data.map((item) => {
          const heightPct = (item.montant / max) * 100;
          return (
            <div key={item.mois} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {formatCurrency(item.montant)}
              </span>
              <div
                className={clsx(
                  'w-full rounded-t-md transition-all duration-500',
                  'bg-seaop-primary-500 dark:bg-seaop-primary-400',
                )}
                style={{ height: `${Math.max(heightPct, 2)}%` }}
              />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                {item.mois}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ============ Main Component ============

export default function DashboardStats() {
  const { stats, isLoading, error, fetchStats } = useAdminStore();

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert type="error" title="Erreur">
        {error}
      </Alert>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-20 text-gray-500 dark:text-gray-400">
        Aucune statistique disponible
      </div>
    );
  }

  // Extract stats data
  const totalProjets = Number(stats.totalProjets ?? stats.projets ?? 0);
  const totalEntrepreneurs = Number(stats.totalEntrepreneurs ?? stats.entrepreneurs ?? 0);
  const totalSoumissions = Number(stats.totalSoumissions ?? stats.soumissions ?? 0);
  const caTotal = Number(stats.caTotal ?? stats.chiffreAffaires ?? 0);
  const topEntrepreneurs = (stats.topEntrepreneurs ?? []) as Record<string, unknown>[];
  const evolutionMensuelle = (stats.evolutionMensuelle ?? []) as {
    mois: string;
    montant: number;
  }[];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Projets"
          value={totalProjets}
          icon={<Briefcase className="h-6 w-6 text-white" />}
          color="bg-blue-500"
        />
        <StatCard
          label="Entrepreneurs"
          value={totalEntrepreneurs}
          icon={<Users className="h-6 w-6 text-white" />}
          color="bg-teal-500"
        />
        <StatCard
          label="Soumissions"
          value={totalSoumissions}
          icon={<FileText className="h-6 w-6 text-white" />}
          color="bg-purple-500"
        />
        <StatCard
          label="CA total"
          value={formatCurrency(caTotal)}
          icon={<DollarSign className="h-6 w-6 text-white" />}
          color="bg-green-500"
        />
      </div>

      {/* Monthly Evolution Chart */}
      {evolutionMensuelle.length > 0 && (
        <MonthlyBarChart data={evolutionMensuelle} />
      )}

      {/* Top 5 Entrepreneurs Table */}
      {topEntrepreneurs.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Top 5 entrepreneurs
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-3 px-4 font-medium text-gray-500 dark:text-gray-400">
                    Entrepreneur
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500 dark:text-gray-400">
                    Soumissions
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500 dark:text-gray-400">
                    Acceptées
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500 dark:text-gray-400">
                    Revenus
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500 dark:text-gray-400">
                    Évaluation
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {topEntrepreneurs.slice(0, 5).map((ent, idx) => (
                  <tr
                    key={String(ent.id ?? idx)}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                  >
                    <td className="py-3 px-4 font-medium text-gray-900 dark:text-gray-100">
                      {String(ent.nomEntreprise ?? ent.nom ?? '--')}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600 dark:text-gray-400">
                      {Number(ent.totalSoumissions ?? 0)}
                    </td>
                    <td className="py-3 px-4 text-right text-green-600 dark:text-green-400">
                      {Number(ent.soumissionsAcceptees ?? 0)}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600 dark:text-gray-400">
                      {formatCurrency(Number(ent.revenus ?? 0))}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="inline-flex items-center gap-1 text-yellow-500">
                        <Star className="h-4 w-4 fill-current" />
                        {Number(ent.evaluationMoyenne ?? ent.evaluation ?? 0).toFixed(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
