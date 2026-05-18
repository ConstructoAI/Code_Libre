/**
 * ERP React Frontend - Analytics Page — Power BI Dashboard
 * Rich BI Dashboard with gradient charts, donut charts, KPI cards with trends.
 * Mobile-first responsive layout.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  DollarSign, Briefcase, UserCheck, AlertTriangle,
  TrendingUp, FileText, Receipt, Package,
  BarChart3, Users, Boxes,
  Eye, Clock, Building2, ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
  AreaChart, Area,
} from 'recharts';
import * as analyticsApi from '@/api/analytics';
import type {
  AnalyticsKpis, ProjectProfitability, ProjectEvolution,
  PipelineItem, EmployeeProductivity, DepartmentDistribution,
  RevenueExpense, StockAlert, TopClient,
  StatusDistribution, HoursTrend, FacturesAging, StockSummary,
} from '@/api/analytics';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { formatCurrency } from '@/utils/format';

// ============ CONSTANTS ============

const PERIOD_OPTIONS = [
  { value: '30', label: '30 jours' },
  { value: '90', label: '90 jours' },
  { value: '180', label: '6 mois' },
  { value: '365', label: '1 an' },
];

const COLORS = ['#7BAFD4', '#7DC4A5', '#F6C87A', '#E8919A', '#B09BD8', '#D4A0B0', '#7DC4B5', '#F0B07A'];
const STATUS_COLORS: Record<string, string> = {
  'PAYEE': '#7DC4A5', 'ENVOYEE': '#8B9FD4', 'BROUILLON': '#B8C4CE', 'EN_RETARD': '#E8919A',
  'EN_ATTENTE': '#F6C87A', 'ANNULEE': '#B8C4CE', 'PARTIELLE': '#F6C87A',
  'EN_COURS': '#7BAFD4', 'TERMINE': '#7DC4A5', 'COMPLETE': '#7DC4A5',
  'EN_PAUSE': '#E8C17A', 'PLANIFIE': '#9BB8D8', 'ANNULE': '#B8C4CE',
  'En cours': '#7BAFD4', 'Termine': '#7DC4A5', 'En attente': '#F6C87A',
  'PROSPECTION': '#9BB8D8', 'QUALIFICATION': '#F6C87A', 'PROPOSITION': '#B09BD8',
  'NEGOCIATION': '#F0B07A', 'GAGNE': '#7DC4A5', 'PERDU': '#E8919A',
};

type AnalyticsTab = 'vue_globale' | 'projets' | 'finances' | 'rh' | 'stock';

const ANALYTICS_TABS: { key: AnalyticsTab; label: string; shortLabel: string; icon: React.ReactNode }[] = [
  { key: 'vue_globale', label: 'Vue Globale', shortLabel: 'Global', icon: <Eye size={16} /> },
  { key: 'projets', label: 'Projets', shortLabel: 'Projets', icon: <BarChart3 size={16} /> },
  { key: 'finances', label: 'Finances', shortLabel: 'Finances', icon: <DollarSign size={16} /> },
  { key: 'rh', label: 'RH', shortLabel: 'RH', icon: <Users size={16} /> },
  { key: 'stock', label: 'Stock', shortLabel: 'Stock', icon: <Boxes size={16} /> },
];

// ============ TOOLTIP STYLE ============

const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 12, color: '#f3f4f6' },
  itemStyle: { color: '#f3f4f6' },
  labelStyle: { color: '#9ca3af', fontWeight: 600 },
};

// ============ HOOKS ============

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

// ============ KPI CARD COMPONENT ============

function KpiCard({ label, value, icon, color = 'blue', trend, trendLabel, subtitle }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: 'blue' | 'green' | 'red' | 'purple' | 'amber' | 'teal' | 'gray';
  trend?: number;
  trendLabel?: string;
  subtitle?: string;
}) {
  const borderColors: Record<string, string> = {
    blue: 'border-l-[#7BAFD4]', green: 'border-l-[#7DC4A5]', red: 'border-l-[#E8919A]',
    purple: 'border-l-[#B09BD8]', amber: 'border-l-[#E8C17A]', teal: 'border-l-[#7DC4B5]', gray: 'border-l-[#B8C4CE]',
  };
  const iconBgs: Record<string, string> = {
    blue: 'bg-[#7BAFD4]/10 text-[#4A7FA8] dark:bg-[#7BAFD4]/20 dark:text-[#9BC8E4]',
    green: 'bg-[#7DC4A5]/10 text-[#4A9475] dark:bg-[#7DC4A5]/20 dark:text-[#9DD4B5]',
    red: 'bg-[#E8919A]/10 text-[#B8616A] dark:bg-[#E8919A]/20 dark:text-[#E8A1AA]',
    purple: 'bg-[#B09BD8]/10 text-[#7A6BA8] dark:bg-[#B09BD8]/20 dark:text-[#C0ABE8]',
    amber: 'bg-[#E8C17A]/10 text-[#8B7030] dark:bg-[#E8C17A]/20 dark:text-[#E8D19A]',
    teal: 'bg-[#7DC4B5]/10 text-[#4A9485] dark:bg-[#7DC4B5]/20 dark:text-[#9DD4C5]',
    gray: 'bg-[#B8C4CE]/10 text-[#6B7B8A] dark:bg-[#B8C4CE]/20 dark:text-[#B8C4CE]',
  };

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 border-l-4 ${borderColors[color]} p-3 md:p-4`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] md:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate">{label}</p>
          <p className="text-lg md:text-2xl font-bold text-gray-900 dark:text-white mt-0.5">{value}</p>
          {trend != null && (
            <div className="flex items-center gap-1 mt-1">
              {trend > 0 ? <ArrowUpRight size={14} className="text-emerald-500" /> :
               trend < 0 ? <ArrowDownRight size={14} className="text-red-500" /> :
               <Minus size={14} className="text-gray-400" />}
              <span className={`text-xs font-medium ${trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                {trend > 0 ? '+' : ''}{Number(trend).toFixed(1)}%
              </span>
              {trendLabel && <span className="text-[10px] text-gray-400 ml-0.5">{trendLabel}</span>}
            </div>
          )}
          {subtitle && trend == null && (
            <p className="text-[11px] md:text-xs text-gray-400 dark:text-gray-500 mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`p-2 rounded-lg ${iconBgs[color]} shrink-0 ml-2`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

// ============ SECTION CARD ============

function SectionCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 md:p-5 ${className}`}>
      <h3 className="text-sm md:text-base font-semibold text-gray-900 dark:text-white mb-4">{title}</h3>
      {children}
    </div>
  );
}

// ============ EMPTY STATE ============

function EmptyState({ message = 'Aucune donnée disponible' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-gray-400 dark:text-gray-500">
      <BarChart3 size={32} className="mb-2 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ============ DONUT CHART COMPONENT ============

function DonutChart({ data, dataKey, nameKey, colors, height = 250, isMobile = false, formatter }: {
  data: any[];
  dataKey: string;
  nameKey: string;
  colors?: string[];
  height?: number;
  isMobile?: boolean;
  formatter?: (v: number) => string;
}) {
  const palette = colors || data.map((d) => STATUS_COLORS[d[nameKey]] || COLORS[data.indexOf(d) % COLORS.length]);
  const total = data.reduce((sum, d) => sum + (d[dataKey] || 0), 0);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey={dataKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          innerRadius={isMobile ? 35 : 55}
          outerRadius={isMobile ? 65 : 90}
          paddingAngle={2}
          label={isMobile ? false : ({ name, value }: any) => `${name}: ${formatter ? formatter(value) : value}`}
        >
          {data.map((_entry, idx) => (
            <Cell key={idx} fill={palette[idx] || COLORS[idx % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(value: number, name: string) => [formatter ? formatter(value) : value, name]}
        />
        <Legend
          layout={isMobile ? 'horizontal' : 'vertical'}
          verticalAlign={isMobile ? 'bottom' : 'middle'}
          align={isMobile ? 'center' : 'right'}
          wrapperStyle={{ fontSize: 11 }}
          formatter={(value: string) => {
            const item = data.find((d) => d[nameKey] === value);
            const pct = total > 0 && item ? ((item[dataKey] / total) * 100).toFixed(0) : '0';
            return `${value} (${pct}%)`;
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ============ MAIN COMPONENT ============

export default function AnalyticsPage() {
  const [period, setPeriod] = useState('30');
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('vue_globale');
  const [isLoading, setIsLoading] = useState(true);

  // Core data
  const [kpis, setKpis] = useState<AnalyticsKpis | null>(null);
  const [profitability, setProfitability] = useState<ProjectProfitability[]>([]);
  const [evolution, setEvolution] = useState<ProjectEvolution[]>([]);
  const [pipeline, setPipeline] = useState<PipelineItem[]>([]);
  const [productivity, setProductivity] = useState<EmployeeProductivity[]>([]);
  const [departments, setDepartments] = useState<DepartmentDistribution[]>([]);
  const [revenueExpenses, setRevenueExpenses] = useState<RevenueExpense[]>([]);
  const [stockAlerts, setStockAlerts] = useState<StockAlert[]>([]);
  const [topClients, setTopClients] = useState<TopClient[]>([]);

  // V2 / Power BI states
  const [trends, setTrends] = useState<any>(null);
  const [monthlyRevenue, setMonthlyRevenue] = useState<any[]>([]);
  const [projectProgress, setProjectProgress] = useState<any[]>([]);
  const [salesPipeline, setSalesPipeline] = useState<any[]>([]);
  const [stockValue, setStockValue] = useState<any[]>([]);
  const [topSuppliers, setTopSuppliers] = useState<any[]>([]);

  // New Power BI states
  const [invoicesByStatus, setInvoicesByStatus] = useState<StatusDistribution[]>([]);
  const [btByStatus, setBtByStatus] = useState<StatusDistribution[]>([]);
  const [hoursTrend, setHoursTrend] = useState<HoursTrend[]>([]);
  const [facturesAging, setFacturesAging] = useState<FacturesAging[]>([]);
  const [stockSummary, setStockSummary] = useState<StockSummary | null>(null);

  const isMobile = useIsMobile();

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const days = parseInt(period);
    try {
      const [kpisRes, profRes, evoRes, pipRes, prodRes, deptRes, revRes, stockRes, clientsRes] =
        await Promise.all([
          analyticsApi.getKpis(days),
          analyticsApi.getProjectProfitability(Math.max(days, 90)),
          analyticsApi.getProjectEvolution(365),
          analyticsApi.getCommercialPipeline(),
          analyticsApi.getEmployeeProductivity(days),
          analyticsApi.getDepartmentDistribution(days),
          analyticsApi.getRevenueExpenses(365),
          analyticsApi.getStockAlerts(),
          analyticsApi.getTopClients(365),
        ]);
      setKpis(kpisRes);
      setProfitability(profRes.items);
      setEvolution(evoRes.items);
      setPipeline(pipRes.items);
      setProductivity(prodRes.items);
      setDepartments(deptRes.items);
      setRevenueExpenses(revRes.items);
      setStockAlerts(stockRes.items);
      setTopClients(clientsRes.items);
    } catch (err) {
      console.error('Analytics fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  const fetchTabData = useCallback(async (tab: AnalyticsTab) => {
    try {
      if (tab === 'vue_globale') {
        const [trendsRes, revRes, invRes, btRes] = await Promise.all([
          analyticsApi.getTrends().catch(() => null),
          analyticsApi.getMonthlyRevenue().catch(() => ({ items: [] })),
          analyticsApi.getInvoicesByStatus().catch(() => ({ items: [] })),
          analyticsApi.getBtByStatus().catch(() => ({ items: [] })),
        ]);
        setTrends(trendsRes);
        setMonthlyRevenue(revRes.items || revRes || []);
        setInvoicesByStatus(invRes.items || []);
        setBtByStatus(btRes.items || []);
      } else if (tab === 'projets') {
        const progRes = await analyticsApi.getProjectProgress().catch(() => ({ items: [] }));
        setProjectProgress(progRes.items || progRes || []);
      } else if (tab === 'finances') {
        const [pipRes, revRes, invRes, agingRes] = await Promise.all([
          analyticsApi.getSalesPipeline().catch(() => ({ items: [] })),
          analyticsApi.getMonthlyRevenue().catch(() => ({ items: [] })),
          analyticsApi.getInvoicesByStatus().catch(() => ({ items: [] })),
          analyticsApi.getFacturesAging().catch(() => ({ items: [] })),
        ]);
        // Normalize: ensure montant and count keys exist for chart dataKey consistency
        setSalesPipeline((pipRes.items || pipRes || []).map((d: any) => ({
          ...d,
          montant: d.montant ?? d.valeurTotale ?? 0,
          count: d.count ?? d.nombre ?? 0,
        })));
        setMonthlyRevenue(revRes.items || revRes || []);
        setInvoicesByStatus(invRes.items || []);
        setFacturesAging(agingRes.items || []);
      } else if (tab === 'rh') {
        const htRes = await analyticsApi.getHoursTrend(365).catch(() => ({ items: [] }));
        setHoursTrend(htRes.items || []);
      } else if (tab === 'stock') {
        const [valRes, suppRes, summRes] = await Promise.all([
          analyticsApi.getStockValue().catch(() => ({ items: [] })),
          analyticsApi.getTopSuppliers().catch(() => ({ items: [] })),
          analyticsApi.getStockSummary().catch(() => null),
        ]);
        setStockValue(valRes.items || valRes || []);
        setTopSuppliers(suppRes.items || suppRes || []);
        setStockSummary(summRes);
      }
    } catch (err) {
      console.error('Tab data fetch error:', err);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchTabData(activeTab); }, [activeTab, fetchTabData]);

  if (isLoading && !kpis) return <SkeletonPage />;

  const chartH = isMobile ? 240 : 320;
  const smallH = isMobile ? 220 : 280;
  const xAxisProps = {
    tick: { fontSize: isMobile ? 10 : 12 },
    interval: isMobile ? 1 : 0 as any,
    angle: isMobile ? -45 : 0,
    textAnchor: (isMobile ? 'end' : 'middle') as any,
    height: isMobile ? 55 : 30,
  };

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Analyses</h2>
        <div className="w-32 sm:w-40 shrink-0">
          <Select options={PERIOD_OPTIONS} value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>
      </div>

      {/* Tab bar */}
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
        <div className="flex gap-0.5 md:gap-1 border-b border-gray-200 dark:border-gray-700 min-w-max md:min-w-0">
          {ANALYTICS_TABS.map(({ key, label, shortLabel, icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1 px-2.5 md:px-4 py-2 md:py-2.5 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === key
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <span className="md:hidden">{icon}</span>
              <span className="hidden md:inline">{label}</span>
              <span className="md:hidden">{shortLabel}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ===== VUE GLOBALE ===== */}
      {activeTab === 'vue_globale' && kpis && (
        <>
          {/* KPI Row 1 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
            <KpiCard
              label="Revenus (terminés)"
              value={formatCurrency(kpis.revenusTotal)}
              icon={<DollarSign size={isMobile ? 16 : 20} />}
              color="green"
              trend={trends?.revenusTrendPct}
              trendLabel="vs mois prec."
            />
            <KpiCard
              label="Soumissions envoyées"
              value={kpis.devisEnvoyes}
              icon={<FileText size={isMobile ? 16 : 20} />}
              color="blue"
              subtitle={`${kpis.devisAcceptes} acceptées`}
            />
            <KpiCard
              label="Projets actifs"
              value={kpis.projetsActifs}
              icon={<Briefcase size={isMobile ? 16 : 20} />}
              color="purple"
              subtitle={`${kpis.projetsTotal} total`}
            />
            <KpiCard
              label="Employés actifs"
              value={kpis.employesActifs}
              icon={<UserCheck size={isMobile ? 16 : 20} />}
              color="teal"
            />
          </div>

          {/* KPI Row 2 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
            <KpiCard
              label="Pipeline commercial"
              value={formatCurrency(kpis.valeurPipeline)}
              icon={<TrendingUp size={isMobile ? 16 : 20} />}
              color="purple"
              subtitle={`${kpis.opportunitesPipeline} opportunites`}
            />
            <KpiCard
              label="Alertes stock"
              value={kpis.alertesStock}
              icon={<AlertTriangle size={isMobile ? 16 : 20} />}
              color={kpis.alertesStock > 0 ? 'red' : 'green'}
            />
            <KpiCard
              label="Revenus encaisses"
              value={formatCurrency(kpis.revenusEncaisses)}
              icon={<Receipt size={isMobile ? 16 : 20} />}
              color="green"
            />
            <KpiCard
              label="Solde du (factures)"
              value={formatCurrency(kpis.facturesSoldeDu)}
              icon={<Package size={isMobile ? 16 : 20} />}
              color={kpis.facturesSoldeDu > 0 ? 'red' : 'green'}
            />
          </div>

          {/* Revenus mensuels — Gradient AreaChart */}
          <SectionCard title="Revenus mensuels">
            {monthlyRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height={chartH}>
                <AreaChart data={monthlyRevenue}>
                  <defs>
                    <linearGradient id="gradRevenu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7DC4A5" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#7DC4A5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.15} />
                  <XAxis dataKey="mois" {...xAxisProps} />
                  <YAxis tick={{ fontSize: 11 }} width={isMobile ? 55 : 70} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [formatCurrency(v), 'Revenus']} />
                  <Area type="monotone" dataKey="revenus" stroke="#7DC4A5" strokeWidth={2} fill="url(#gradRevenu)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </SectionCard>

          {/* Revenus vs Depenses + Evolution projets */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-5">
            <SectionCard title="Revenus vs Depenses">
              {revenueExpenses.length > 0 ? (
                <ResponsiveContainer width="100%" height={smallH}>
                  <AreaChart data={revenueExpenses}>
                    <defs>
                      <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7DC4A5" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#7DC4A5" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradDep" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#E8919A" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#E8919A" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.15} />
                    <XAxis dataKey="mois" {...xAxisProps} />
                    <YAxis tick={{ fontSize: 11 }} width={isMobile ? 50 : 65} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => formatCurrency(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="revenus" name="Revenus" stroke="#7DC4A5" strokeWidth={2} fill="url(#gradRev)" />
                    <Area type="monotone" dataKey="depenses" name="Depenses" stroke="#E8919A" strokeWidth={2} fill="url(#gradDep)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState />
              )}
            </SectionCard>

            <SectionCard title="Evolution des projets">
              {evolution.length > 0 ? (
                <ResponsiveContainer width="100%" height={smallH}>
                  <AreaChart data={evolution}>
                    <defs>
                      <linearGradient id="gradEnCours" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7BAFD4" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#7BAFD4" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradTermines" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7DC4A5" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#7DC4A5" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradAttente" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F6C87A" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#F6C87A" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.15} />
                    <XAxis dataKey="mois" {...xAxisProps} />
                    <YAxis tick={{ fontSize: 11 }} width={isMobile ? 35 : 50} />
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="enCours" name="En cours" stackId="1" stroke="#7BAFD4" fill="url(#gradEnCours)" />
                    <Area type="monotone" dataKey="termines" name="Terminés" stackId="1" stroke="#7DC4A5" fill="url(#gradTermines)" />
                    <Area type="monotone" dataKey="enAttente" name="En attente" stackId="1" stroke="#F6C87A" fill="url(#gradAttente)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState />
              )}
            </SectionCard>
          </div>

          {/* Donut charts: Factures + BT */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-5">
            <SectionCard title="Distribution des factures">
              {invoicesByStatus.length > 0 ? (
                <DonutChart data={invoicesByStatus} dataKey="count" nameKey="statut" isMobile={isMobile} height={smallH} />
              ) : (
                <EmptyState />
              )}
            </SectionCard>

            <SectionCard title="Bons de travail par statut">
              {btByStatus.length > 0 ? (
                <DonutChart data={btByStatus} dataKey="count" nameKey="statut" isMobile={isMobile} height={smallH} />
              ) : (
                <EmptyState />
              )}
            </SectionCard>
          </div>
        </>
      )}

      {/* ===== PROJETS ===== */}
      {activeTab === 'projets' && kpis && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
            <KpiCard label="Projets total" value={kpis.projetsTotal} icon={<Briefcase size={isMobile ? 16 : 20} />} color="blue" />
            <KpiCard label="En cours" value={kpis.projetsActifs} icon={<Clock size={isMobile ? 16 : 20} />} color="amber" />
            <KpiCard label="Terminés" value={kpis.projetsTermines} icon={<Briefcase size={isMobile ? 16 : 20} />} color="green" />
            <KpiCard
              label="Budget total"
              value={formatCurrency(profitability.reduce((s, p) => s + p.budget, 0))}
              icon={<DollarSign size={isMobile ? 16 : 20} />}
              color="purple"
            />
          </div>

          {/* Rentabilite: Budget vs Cout reel */}
          <SectionCard title="Rentabilité des projets — Budget vs Coût réel">
            {profitability.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={chartH}>
                  <BarChart data={profitability.slice(0, isMobile ? 5 : 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.15} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="nomProjet" width={isMobile ? 80 : 140} tick={{ fontSize: isMobile ? 10 : 11 }} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => formatCurrency(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="budget" name="Budget" fill="#7BAFD4" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="coutTotal" name="Coût réel" fill="#E8919A" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>

                {/* Table */}
                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Projet</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Statut</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Budget</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Coût</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Marge</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {profitability.map((p) => (
                        <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="px-3 py-2 text-gray-900 dark:text-white font-medium truncate max-w-[160px]">{p.nomProjet}</td>
                          <td className="px-3 py-2">
                            <Badge color={p.statut === 'Termine' ? 'green' : p.statut === 'En cours' ? 'blue' : 'gray'} size="sm">{p.statut}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{formatCurrency(p.budget)}</td>
                          <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{formatCurrency(p.coutTotal)}</td>
                          <td className="px-3 py-2 text-right font-medium" style={{ color: p.marge >= 0 ? '#7DC4A5' : '#E8919A' }}>
                            {formatCurrency(p.marge)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Badge color={p.margePct >= 20 ? 'green' : p.margePct >= 0 ? 'yellow' : 'red'} size="sm">
                              {(p.margePct ?? 0).toFixed(1)}%
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-semibold">
                        <td className="px-3 py-2 text-gray-900 dark:text-white" colSpan={2}>Total</td>
                        <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{formatCurrency(profitability.reduce((s, p) => s + p.budget, 0))}</td>
                        <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{formatCurrency(profitability.reduce((s, p) => s + p.coutTotal, 0))}</td>
                        <td className="px-3 py-2 text-right" style={{ color: profitability.reduce((s, p) => s + p.marge, 0) >= 0 ? '#7DC4A5' : '#E8919A' }}>
                          {formatCurrency(profitability.reduce((s, p) => s + p.marge, 0))}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {(() => {
                            const tBudget = profitability.reduce((s, p) => s + p.budget, 0);
                            const tMarge = profitability.reduce((s, p) => s + p.marge, 0);
                            const pct = tBudget > 0 ? (tMarge / tBudget * 100) : 0;
                            return <Badge color={pct >= 20 ? 'green' : pct >= 0 ? 'yellow' : 'red'} size="sm">{(pct ?? 0).toFixed(1)}%</Badge>;
                          })()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            ) : (
              <EmptyState />
            )}
          </SectionCard>

          {/* Progression des projets */}
          <SectionCard title="Progression des projets">
            {projectProgress.length > 0 ? (
              <div className="space-y-3">
                {projectProgress.map((p: any, idx: number) => {
                  const pct = p.pourcentageCompletion ?? p.progression ?? 0;
                  return (
                    <div key={p.id || idx} className="flex items-center gap-2 md:gap-3">
                      <span className="text-xs md:text-sm text-gray-900 dark:text-white min-w-[100px] md:min-w-[160px] truncate font-medium">{p.nomProjet || p.nom}</span>
                      <div className="flex-1 h-3 md:h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            pct >= 100 ? 'bg-[#7DC4A5]' : pct >= 50 ? 'bg-[#7BAFD4]' : 'bg-[#F6C87A]'
                          }`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs md:text-sm font-semibold min-w-[40px] text-right" style={{ color: pct >= 100 ? '#7DC4A5' : pct >= 50 ? '#7BAFD4' : '#F6C87A' }}>
                        {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState />
            )}
          </SectionCard>

          {/* Evolution mensuelle + Repartition statuts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-5">
            <SectionCard title="Création de projets par mois">
              {evolution.length > 0 ? (
                <ResponsiveContainer width="100%" height={smallH}>
                  <AreaChart data={evolution}>
                    <defs>
                      <linearGradient id="gradProjTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#B09BD8" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#B09BD8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.15} />
                    <XAxis dataKey="mois" {...xAxisProps} />
                    <YAxis tick={{ fontSize: 11 }} width={isMobile ? 30 : 40} />
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Area type="monotone" dataKey="total" name="Projets crees" stroke="#B09BD8" strokeWidth={2} fill="url(#gradProjTotal)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState />
              )}
            </SectionCard>

            <SectionCard title="Répartition par statut">
              {(() => {
                const statusData = [
                  { statut: 'En cours', count: kpis.projetsActifs },
                  { statut: 'Terminés', count: kpis.projetsTermines },
                  { statut: 'En attente', count: Math.max(0, kpis.projetsTotal - kpis.projetsActifs - kpis.projetsTermines) },
                ].filter((d) => d.count > 0);
                return statusData.length > 0 ? (
                  <DonutChart data={statusData} dataKey="count" nameKey="statut" isMobile={isMobile} height={smallH}
                    colors={['#7BAFD4', '#7DC4A5', '#F6C87A']}
                  />
                ) : (
                  <EmptyState />
                );
              })()}
            </SectionCard>
          </div>
        </>
      )}

      {/* ===== FINANCES ===== */}
      {activeTab === 'finances' && kpis && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
            <KpiCard
              label="Revenus encaisses"
              value={formatCurrency(kpis.revenusEncaisses)}
              icon={<DollarSign size={isMobile ? 16 : 20} />}
              color="green"
              trend={trends?.revenusTrendPct}
              trendLabel="vs mois prec."
            />
            <KpiCard
              label="Solde du"
              value={formatCurrency(kpis.facturesSoldeDu)}
              icon={<Receipt size={isMobile ? 16 : 20} />}
              color={kpis.facturesSoldeDu > 0 ? 'red' : 'green'}
              subtitle={`${kpis.facturesTotal} factures`}
            />
            <KpiCard
              label="Taux conversion devis"
              value={kpis.devisTotal > 0 ? `${((kpis.devisAcceptes / kpis.devisTotal) * 100).toFixed(0)}%` : '0%'}
              icon={<TrendingUp size={isMobile ? 16 : 20} />}
              color="blue"
              subtitle={`${kpis.devisAcceptes}/${kpis.devisTotal} acceptés`}
            />
            <KpiCard
              label="Pipeline commercial"
              value={formatCurrency(kpis.valeurPipeline)}
              icon={<Building2 size={isMobile ? 16 : 20} />}
              color="purple"
              subtitle={`${kpis.opportunitesPipeline} opportunites`}
            />
          </div>

          {/* Revenus vs Depenses — full width AreaChart */}
          <SectionCard title="Revenus vs Depenses (12 mois)">
            {revenueExpenses.length > 0 ? (
              <ResponsiveContainer width="100%" height={chartH}>
                <AreaChart data={revenueExpenses}>
                  <defs>
                    <linearGradient id="gradFinRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7DC4A5" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#7DC4A5" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradFinDep" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#E8919A" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#E8919A" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradFinMarge" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#B09BD8" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#B09BD8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.15} />
                  <XAxis dataKey="mois" {...xAxisProps} />
                  <YAxis tick={{ fontSize: 11 }} width={isMobile ? 55 : 70} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => formatCurrency(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="revenus" name="Revenus" stroke="#7DC4A5" strokeWidth={2} fill="url(#gradFinRev)" />
                  <Area type="monotone" dataKey="depenses" name="Depenses" stroke="#E8919A" strokeWidth={2} fill="url(#gradFinDep)" />
                  <Area type="monotone" dataKey="marge" name="Marge" stroke="#B09BD8" strokeWidth={2} fill="url(#gradFinMarge)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </SectionCard>

          {/* Distribution factures + Vieillissement */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-5">
            <SectionCard title="Distribution des factures">
              {invoicesByStatus.length > 0 ? (
                <DonutChart data={invoicesByStatus} dataKey="count" nameKey="statut" isMobile={isMobile} height={smallH} />
              ) : (
                <EmptyState />
              )}
            </SectionCard>

            <SectionCard title="Vieillissement des comptes clients">
              {facturesAging.length > 0 ? (
                <ResponsiveContainer width="100%" height={smallH}>
                  <BarChart data={facturesAging}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.15} />
                    <XAxis dataKey="tranche" {...xAxisProps} />
                    <YAxis tick={{ fontSize: 11 }} width={isMobile ? 55 : 70} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: number, name: string) => [name === 'count' ? v : formatCurrency(v), name === 'count' ? 'Factures' : 'Solde du']} />
                    <Bar dataKey="solde" name="Solde du" radius={[4, 4, 0, 0]}>
                      {facturesAging.map((_, idx) => (
                        <Cell key={idx} fill={idx < 1 ? '#7DC4A5' : idx < 2 ? '#F6C87A' : idx < 3 ? '#F0B07A' : '#E8919A'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState message="Aucune facture en souffrance" />
              )}
            </SectionCard>
          </div>

          {/* Pipeline commercial */}
          <SectionCard title="Pipeline commercial">
            {(salesPipeline.length > 0 || pipeline.length > 0) ? (
              <>
                <ResponsiveContainer width="100%" height={smallH}>
                  <BarChart data={salesPipeline.length > 0 ? salesPipeline : pipeline}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.15} />
                    <XAxis dataKey="statut" {...xAxisProps} />
                    <YAxis tick={{ fontSize: 11 }} width={isMobile ? 55 : 65} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="montant" name="Montant" radius={[4, 4, 0, 0]}>
                      {(salesPipeline.length > 0 ? salesPipeline : pipeline).map((d: any, idx: number) => (
                        <Cell key={idx} fill={STATUS_COLORS[d.statut] || COLORS[idx % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Étape</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Nombre</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Montant</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {(salesPipeline.length > 0 ? salesPipeline : pipeline).map((s: any, idx: number) => (
                        <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="px-3 py-2 text-gray-900 dark:text-white font-medium">
                            <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: STATUS_COLORS[s.statut] || COLORS[idx % COLORS.length] }} />
                            {s.statut}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{s.count ?? s.nombre}</td>
                          <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{formatCurrency(s.montant ?? s.valeurTotale ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-semibold">
                        <td className="px-3 py-2 text-gray-900 dark:text-white">Total</td>
                        <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                          {(salesPipeline.length > 0 ? salesPipeline : pipeline).reduce((s: number, d: any) => s + (d.count ?? d.nombre ?? 0), 0)}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                          {formatCurrency((salesPipeline.length > 0 ? salesPipeline : pipeline).reduce((s: number, d: any) => s + (d.montant ?? d.valeurTotale ?? 0), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            ) : (
              <EmptyState />
            )}
          </SectionCard>

          {/* Top clients */}
          <SectionCard title="Top clients (par chiffre d'affaires)">
            {topClients.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={Math.min(topClients.length * 35 + 40, smallH)}>
                  <BarChart data={topClients.slice(0, isMobile ? 5 : 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.15} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="client" width={isMobile ? 100 : 180} tick={{ fontSize: isMobile ? 10 : 11 }} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="caTotal" name="CA Total" fill="#7BAFD4" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>

                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Client</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Type</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">CA Total</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Projets</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {topClients.slice(0, 10).map((c) => (
                        <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="px-3 py-2 text-gray-900 dark:text-white font-medium">{c.client}</td>
                          <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{c.typeEntreprise}</td>
                          <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{formatCurrency(c.caTotal)}</td>
                          <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{c.nbProjets}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-semibold">
                        <td className="px-3 py-2 text-gray-900 dark:text-white" colSpan={2}>Total</td>
                        <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{formatCurrency(topClients.reduce((s, c) => s + c.caTotal, 0))}</td>
                        <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{topClients.reduce((s, c) => s + c.nbProjets, 0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            ) : (
              <EmptyState />
            )}
          </SectionCard>
        </>
      )}

      {/* ===== RH ===== */}
      {activeTab === 'rh' && kpis && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
            <KpiCard
              label="Employés actifs"
              value={kpis.employesActifs}
              icon={<Users size={isMobile ? 16 : 20} />}
              color="blue"
            />
            <KpiCard
              label="Heures totales"
              value={`${productivity.reduce((s, p) => s + p.heuresTotales, 0).toFixed(0)}h`}
              icon={<Clock size={isMobile ? 16 : 20} />}
              color="green"
            />
            <KpiCard
              label="Heures/jour moyen"
              value={`${productivity.length > 0 ? (productivity.reduce((s, p) => s + p.heuresParJour, 0) / productivity.length).toFixed(1) : '0'}h`}
              icon={<TrendingUp size={isMobile ? 16 : 20} />}
              color="amber"
            />
            <KpiCard
              label="Départements"
              value={departments.length}
              icon={<Briefcase size={isMobile ? 16 : 20} />}
              color="purple"
              subtitle={`${productivity.length} employés actifs`}
            />
          </div>

          {/* Tendance heures mensuelles */}
          <SectionCard title="Tendance des heures travaillées (12 mois)">
            {hoursTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={chartH}>
                <AreaChart data={hoursTrend}>
                  <defs>
                    <linearGradient id="gradHeures" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7BAFD4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#7BAFD4" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradEmpl" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7DC4A5" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#7DC4A5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.15} />
                  <XAxis dataKey="mois" {...xAxisProps} />
                  <YAxis yAxisId="h" tick={{ fontSize: 11 }} width={isMobile ? 45 : 55} />
                  <YAxis yAxisId="e" orientation="right" tick={{ fontSize: 11 }} width={isMobile ? 30 : 40} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number, name: string) => [name === 'Employes' ? v : `${v}h`, name]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area yAxisId="h" type="monotone" dataKey="heures" name="Heures" stroke="#7BAFD4" strokeWidth={2} fill="url(#gradHeures)" />
                  <Area yAxisId="e" type="monotone" dataKey="employes" name="Employes" stroke="#7DC4A5" strokeWidth={2} fill="url(#gradEmpl)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </SectionCard>

          {/* Repartition departement + Productivite */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-5">
            <SectionCard title="Répartition par département">
              {departments.length > 0 ? (
                <DonutChart data={departments} dataKey="heuresTotales" nameKey="departement" isMobile={isMobile} height={smallH}
                  formatter={(v) => `${v}h`}
                />
              ) : (
                <EmptyState />
              )}
            </SectionCard>

            <SectionCard title="Heures par employé">
              {productivity.length > 0 ? (
                <ResponsiveContainer width="100%" height={smallH}>
                  <BarChart data={productivity.slice(0, isMobile ? 5 : 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.15} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="employe" width={isMobile ? 80 : 130} tick={{ fontSize: isMobile ? 10 : 11 }} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`${v}h`, 'Heures']} />
                    <Bar dataKey="heuresTotales" name="Heures" fill="#7BAFD4" radius={[0, 4, 4, 0]}>
                      {productivity.slice(0, isMobile ? 5 : 8).map((_, idx) => (
                        <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState />
              )}
            </SectionCard>
          </div>

          {/* Table productivite detaillee */}
          <SectionCard title="Productivité détaillée">
            {productivity.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Employé</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Poste</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Dept.</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Jours</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Heures</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">h/jour</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Projets</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {productivity.map((emp) => (
                      <tr key={emp.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="px-3 py-2 text-gray-900 dark:text-white font-medium">{emp.employe}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{emp.poste}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{emp.departement}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{emp.joursTravailles}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{emp.heuresTotales}h</td>
                        <td className="px-3 py-2 text-right">
                          <span className={emp.heuresParJour >= 7.5 ? 'text-emerald-600' : emp.heuresParJour >= 6 ? 'text-amber-600' : 'text-red-600'}>
                            {emp.heuresParJour}h
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{emp.nbProjets}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-semibold">
                      <td className="px-3 py-2 text-gray-900 dark:text-white" colSpan={3}>Total / Moyenne</td>
                      <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{productivity.reduce((s, e) => s + e.joursTravailles, 0)}</td>
                      <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{productivity.reduce((s, e) => s + e.heuresTotales, 0).toFixed(0)}h</td>
                      <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                        {(productivity.reduce((s, e) => s + e.heuresParJour, 0) / productivity.length).toFixed(1)}h
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{productivity.reduce((s, e) => s + e.nbProjets, 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <EmptyState />
            )}
          </SectionCard>
        </>
      )}

      {/* ===== STOCK ===== */}
      {activeTab === 'stock' && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
            <KpiCard
              label="Produits actifs"
              value={stockSummary?.produitsActifs ?? 0}
              icon={<Package size={isMobile ? 16 : 20} />}
              color="blue"
              subtitle={`${stockSummary?.totalProduits ?? 0} total`}
            />
            <KpiCard
              label="Alertes stock"
              value={stockSummary?.alertes ?? kpis?.alertesStock ?? 0}
              icon={<AlertTriangle size={isMobile ? 16 : 20} />}
              color={(stockSummary?.alertes ?? 0) > 0 ? 'red' : 'green'}
            />
            <KpiCard
              label="Valeur totale"
              value={formatCurrency(stockSummary?.valeurTotale ?? 0)}
              icon={<DollarSign size={isMobile ? 16 : 20} />}
              color="green"
            />
            <KpiCard
              label="Catégories"
              value={stockSummary?.categories ?? 0}
              icon={<Boxes size={isMobile ? 16 : 20} />}
              color="purple"
            />
          </div>

          {/* Valeur du stock par categorie */}
          <SectionCard title="Valeur du stock par catégorie">
            {stockValue.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ResponsiveContainer width="100%" height={smallH}>
                  <BarChart data={stockValue}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.15} />
                    <XAxis dataKey="categorie" {...xAxisProps} />
                    <YAxis tick={{ fontSize: 11 }} width={isMobile ? 55 : 65} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="valeur" name="Valeur" radius={[4, 4, 0, 0]}>
                      {stockValue.map((_: any, idx: number) => (
                        <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                <DonutChart data={stockValue} dataKey="valeur" nameKey="categorie" isMobile={isMobile} height={smallH}
                  formatter={(v) => formatCurrency(v)}
                />
              </div>
            ) : (
              <EmptyState />
            )}
          </SectionCard>

          {/* Alertes stock */}
          <SectionCard title={`Alertes stock (${stockAlerts.length})`}>
            {stockAlerts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Produit</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Catégorie</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Stock</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Seuil</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Niveau</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {stockAlerts.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="px-3 py-2 text-gray-900 dark:text-white font-medium">{item.nom}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{item.categorie}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{item.stockActuel} {item.unite}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{item.seuilAlerte}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${item.tauxStock < 25 ? 'bg-red-500' : item.tauxStock < 50 ? 'bg-[#F6C87A]' : 'bg-[#7DC4A5]'}`}
                                style={{ width: `${Math.min(item.tauxStock, 100)}%` }}
                              />
                            </div>
                            <Badge color={item.tauxStock < 25 ? 'red' : item.tauxStock < 50 ? 'yellow' : 'green'} size="sm">
                              {item.tauxStock}%
                            </Badge>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState message="Aucune alerte de stock" />
            )}
          </SectionCard>

          {/* Top fournisseurs */}
          {topSuppliers.length > 0 && (
            <SectionCard title="Top fournisseurs">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ResponsiveContainer width="100%" height={Math.min(topSuppliers.length * 35 + 40, smallH)}>
                  <BarChart data={topSuppliers.slice(0, isMobile ? 5 : 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.15} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="nom" width={isMobile ? 90 : 150} tick={{ fontSize: isMobile ? 10 : 11 }} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="totalAchats" name="Achats" fill="#B09BD8" radius={[0, 4, 4, 0]}>
                      {topSuppliers.slice(0, isMobile ? 5 : 10).map((_: any, idx: number) => (
                        <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Fournisseur</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Cmd.</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Montant</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {topSuppliers.map((s: any, idx: number) => (
                        <tr key={s.id ?? idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="px-3 py-2 text-gray-900 dark:text-white font-medium">{s.nom || s.fournisseur}</td>
                          <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{s.nbCommandes ?? s.count ?? 0}</td>
                          <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{formatCurrency(s.totalAchats ?? s.montantTotal ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-semibold">
                        <td className="px-3 py-2 text-gray-900 dark:text-white">Total</td>
                        <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                          {topSuppliers.reduce((s: number, d: any) => s + (d.nbCommandes ?? d.count ?? 0), 0)}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                          {formatCurrency(topSuppliers.reduce((s: number, d: any) => s + (d.totalAchats ?? d.montantTotal ?? 0), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
