/**
 * ERP React Frontend - Dashboard Page
 * Main dashboard with KPI stat cards and alerts.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Briefcase, Building2, UserCheck, FileText,
  Receipt, Package, Truck, ClipboardList,
  AlertTriangle, AlertCircle,
} from 'lucide-react';
import { useDashboardStore } from '@/store/useDashboardStore';
import { useAuthStore } from '@/store/useAuthStore';
import * as dashboardApi from '@/api/dashboard';
import StatCard from '@/components/dashboard/StatCard';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { formatCurrency } from '@/utils/format';

export default function DashboardPage() {
  const { stats, alerts, isLoading, error, fetchDashboard } = useDashboardStore();
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const [dashAlerts, setDashAlerts] = useState<any[]>([]);
  const [charts, setCharts] = useState<any>(null);
  const [topSuppliers, setTopSuppliers] = useState<any[]>([]);

  const fetchExtras = useCallback(async () => {
    try {
      const [alertsRes, chartsRes, suppRes] = await Promise.all([
        dashboardApi.getDashboardAlerts().catch(() => ({ items: [] })),
        dashboardApi.getDashboardCharts().catch(() => null),
        dashboardApi.getDashboardTopSuppliers().catch(() => ({ items: [] })),
      ]);
      setDashAlerts(alertsRes.items || alertsRes || []);
      setCharts(chartsRes);
      setTopSuppliers(suppRes.items || suppRes || []);
    } catch {
      // silent fallback
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    fetchExtras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading && !stats) {
    return <SkeletonPage />;
  }

  return (
    <div className="space-y-6">
      {/* Welcome message */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Bonjour, {user?.displayName || 'Utilisateur'}
        </h2>
        {tenant && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {tenant.entrepriseNom}
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <Alert type="error">
          {error}
        </Alert>
      )}

      {/* Alerts — D365-style compact notification bar */}
      {alerts.length > 0 && (
        <div className="bg-[#fff4ce] dark:bg-[#4a3c00] border border-[#f7d87c] dark:border-[#8a7400] rounded px-4 py-2 flex items-start gap-2">
          <AlertTriangle size={16} className="text-[#835c00] dark:text-[#f7d87c] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="text-[13px] font-semibold text-[#835c00] dark:text-[#f7d87c]">
              {alerts.length} notification{alerts.length > 1 ? 's' : ''}
            </span>
            <span className="text-[12px] text-[#835c00]/70 dark:text-[#f7d87c]/70 ml-2">
              {alerts.slice(0, 2).map(a => a.title || a.message).join(' • ')}
              {alerts.length > 2 && ` • +${alerts.length - 2} autres`}
            </span>
          </div>
        </div>
      )}

      {/* KPI Grid */}
      {stats && (
        <>
          {/* Row 1: Core metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Projets en cours"
              value={stats.projectsEnCours}
              icon={<Briefcase size={20} />}
              color="blue"
              trend={`${stats.projectsTotal} total`}
            />
            <StatCard
              label="Entreprises"
              value={stats.companiesTotal}
              icon={<Building2 size={20} />}
              color="purple"
            />
            <StatCard
              label="Employés actifs"
              value={stats.employesActifs}
              icon={<UserCheck size={20} />}
              color="green"
            />
            <StatCard
              label="Soumissions"
              value={stats.devisTotal}
              icon={<FileText size={20} />}
              color="teal"
              trend={`${stats.devisAcceptes} acceptés`}
            />
          </div>

          {/* Row 2: Financial */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Factures"
              value={stats.facturesTotal}
              icon={<Receipt size={20} />}
              color="blue"
            />
            <StatCard
              label="Solde dû"
              value={formatCurrency(stats.facturesSoldeDu)}
              icon={<AlertCircle size={20} />}
              color={stats.facturesSoldeDu > 0 ? 'red' : 'green'}
            />
            <StatCard
              label="Produits"
              value={stats.produitsTotal}
              icon={<Package size={20} />}
              color="yellow"
            />
            <StatCard
              label="Fournisseurs"
              value={stats.fournisseursTotal}
              icon={<Truck size={20} />}
              color="purple"
            />
          </div>

          {/* Row 3: Operations */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Bons de travail"
              value={stats.btTotal}
              icon={<ClipboardList size={20} />}
              color="blue"
              trend={`${stats.btEnCours} en cours`}
            />
            <StatCard
              label="Projets terminés"
              value={stats.projectsTermines}
              icon={<Briefcase size={20} />}
              color="green"
            />
            <StatCard
              label="Soumissions brouillon"
              value={stats.devisBrouillon}
              icon={<FileText size={20} />}
              color="yellow"
              trend="À finaliser"
            />
            <StatCard
              label="Alertes"
              value={alerts.length}
              icon={<AlertTriangle size={20} />}
              color={alerts.length > 0 ? 'red' : 'green'}
            />
          </div>
        </>
      )}

      {/* Dashboard Alerts — D365 compact grouped notification */}
      {dashAlerts.length > 0 && (() => {
        const overdueAlerts = dashAlerts.filter((a: any) => a.type === 'overdue' || a.severity === 'critical' || a.type === 'danger');
        const warningAlerts = dashAlerts.filter((a: any) => a.type === 'warning' || a.severity === 'warning');
        const infoAlerts = dashAlerts.filter((a: any) => !overdueAlerts.includes(a) && !warningAlerts.includes(a));
        return (
          <div className="flex flex-col gap-1.5">
            {overdueAlerts.length > 0 && (
              <div className="bg-[#fde7e9] dark:bg-[#4a0000] border border-[#f1707b] dark:border-[#d13438] rounded px-4 py-2 flex items-center gap-2">
                <AlertCircle size={15} className="text-[#a4262c] dark:text-[#f1707b] shrink-0" />
                <span className="text-[12px] font-semibold text-[#a4262c] dark:text-[#f1707b]">{overdueAlerts.length} en retard</span>
                <span className="text-[11px] text-[#a4262c]/70 dark:text-[#f1707b]/70 truncate">
                  {overdueAlerts.slice(0, 3).map((a: any) => a.title || a.message || String(a)).join(' • ')}
                </span>
              </div>
            )}
            {warningAlerts.length > 0 && (
              <div className="bg-[#fff4ce] dark:bg-[#4a3c00] border border-[#f7d87c] dark:border-[#8a7400] rounded px-4 py-2 flex items-center gap-2">
                <AlertTriangle size={15} className="text-[#835c00] dark:text-[#f7d87c] shrink-0" />
                <span className="text-[12px] font-semibold text-[#835c00] dark:text-[#f7d87c]">{warningAlerts.length} avertissement{warningAlerts.length > 1 ? 's' : ''}</span>
                <span className="text-[11px] text-[#835c00]/70 dark:text-[#f7d87c]/70 truncate">
                  {warningAlerts.slice(0, 3).map((a: any) => a.title || a.message || String(a)).join(' • ')}
                </span>
              </div>
            )}
            {infoAlerts.length > 0 && (
              <div className="bg-[#deecf9] dark:bg-[#002050] border border-[#6cb8f6] dark:border-[#0078D4] rounded px-4 py-2 flex items-center gap-2">
                <AlertCircle size={15} className="text-[#004578] dark:text-[#6cb8f6] shrink-0" />
                <span className="text-[12px] font-semibold text-[#004578] dark:text-[#6cb8f6]">{infoAlerts.length} info</span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Charts Section: Projects by status + Monthly Revenue */}
      {charts && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Projects by Status */}
          {charts.projectsByStatus && charts.projectsByStatus.length > 0 && (
            <Card>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
                Projets par statut
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Statut</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Nombre</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {charts.projectsByStatus.map((row: any, idx: number) => {
                      const total = charts.projectsByStatus.reduce((s: number, r: any) => s + (r.count || 0), 0);
                      const pct = total > 0 ? ((row.count || 0) / total * 100).toFixed(1) : '0';
                      return (
                        <tr key={idx}>
                          <td className="px-3 py-2 text-gray-900 dark:text-white">
                            <div className="flex items-center gap-2">
                              <span>{row.statut}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{row.count}</td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-2 bg-gray-200 dark:bg-gray-700 rounded-full">
                                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-gray-500">{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Monthly Revenue */}
          {charts.monthlyRevenue && charts.monthlyRevenue.length > 0 && (
            <Card>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
                Revenus mensuels
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Mois</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Montant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {charts.monthlyRevenue.map((row: any, idx: number) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">{row.mois}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{formatCurrency(row.montant || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Top Suppliers */}
      {topSuppliers.length > 0 && (
        <Card>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            Top 5 fournisseurs
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Fournisseur</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Commandes</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Montant total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {topSuppliers.slice(0, 5).map((s: any, idx: number) => (
                  <tr key={idx}>
                    <td className="px-3 py-2 text-gray-900 dark:text-white">{s.nom || s.fournisseur}</td>
                    <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{s.nbCommandes || s.count || 0}</td>
                    <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{formatCurrency(s.montantTotal || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Empty state */}
      {stats && stats.projectsTotal === 0 && stats.companiesTotal === 0 && (
        <div className="erp-card p-8 text-center">
          <Briefcase size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Bienvenue dans Constructo AI!
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            Commencez par ajouter une entreprise ou créer un projet.
          </p>
        </div>
      )}
    </div>
  );
}
