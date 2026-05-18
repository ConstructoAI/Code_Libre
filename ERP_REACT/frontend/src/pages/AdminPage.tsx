/**
 * ERP React Frontend - Admin Page
 * Super-admin dashboard with tabs: Entreprises, En Ligne, Usage IA, Mises à jour.
 * Based on super_admin_ui.py (3,864 lines) — 12 tabs.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Building2, Users, CheckCircle, XCircle, Wifi, Bot, Bell,
  RefreshCw, Pencil, Trash2, Plus, UserCheck, DollarSign, TrendingUp,
  CreditCard, ChevronLeft, ChevronRight, Wallet,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import * as adminApi from '@/api/admin';
import type { EntrepriseAdmin } from '@/api/admin';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { formatDate, formatRelativeTime } from '@/utils/format';
import api from '@/api/client';

type TabKey = 'entreprises' | 'online' | 'ai-usage' | 'finances' | 'updates' | 'representants';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'entreprises', label: 'Entreprises', icon: <Building2 size={16} /> },
  { key: 'online', label: 'En Ligne', icon: <Wifi size={16} /> },
  { key: 'ai-usage', label: 'Usage IA', icon: <Bot size={16} /> },
  { key: 'finances', label: 'Finances', icon: <Wallet size={16} /> },
  { key: 'updates', label: 'Mises à jour', icon: <Bell size={16} /> },
  { key: 'representants', label: 'Représentants', icon: <UserCheck size={16} /> },
];

function extractError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const resp = (err as { response: { data?: { detail?: string } } }).response;
    if (resp?.data?.detail) return resp.data.detail;
  }
  if (err instanceof Error) return err.message;
  return 'Erreur';
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('entreprises');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Entreprises
  const [entreprises, setEntreprises] = useState<EntrepriseAdmin[]>([]);
  const [stats, setStats] = useState<{
    totalEntreprises: number; activeEntreprises: number; inactiveEntreprises: number;
    newThisMonth: number; totalSubscriptions: number; activeSubscriptions: number;
    signupTrend: { month: string; signups: number }[];
    subscriptionDistribution: { status: string; count: number }[];
    revenueClients: { nom: string; charged: number; consumed: number; balance: number; charges: number }[];
  } | null>(null);

  // Online
  const [onlineData, setOnlineData] = useState<{
    stats: { erpOnline: number; expertsOnline: number; totalSessions: number };
    sessions: { sessionId: string; username: string; entrepriseNom: string; productType: string; derniereActivite: string | null }[];
    byEntreprise: { nom: string; sessions: number }[];
    loginTrend: { date: string; logins: number; companies: number }[];
    peakHours: { hour: string; logins: number }[];
    topUsers: { username: string; entrepriseNom: string; sessions: number; lastSeen: string | null }[];
  } | null>(null);

  // AI Usage
  const [aiUsage, setAiUsage] = useState<{
    month: number; year: number;
    totalCost: number; anthropicCost: number; profit: number; totalRevenue: number;
    totalRequests: number; avgTokens: number; activeClients: number;
    byCompany: {
      companyId: string; entrepriseNom: string; entrepriseEmail: string;
      monthlyCost: number; anthropicCost: number; profit: number;
      totalRequests: number; totalTokens: number;
      balanceUsd: number; totalChargedUsd: number; totalConsumedUsd: number; chargesCount: number;
    }[];
    dailyTrend: { date: string; cost: number; anthropic: number; profit: number; requests: number }[];
    byFeature: { feature: string; cost: number; requests: number }[];
  } | null>(null);
  const [aiMonth, setAiMonth] = useState(new Date().getMonth() + 1);
  const [aiYear, setAiYear] = useState(new Date().getFullYear());

  // Updates
  const [updates, setUpdates] = useState<{
    id: number; message: string; type: string; createdAt: string | null; isActive: boolean;
  }[]>([]);
  const [newUpdateMsg, setNewUpdateMsg] = useState('');

  // Representants
  const [representants, setRepresentants] = useState<adminApi.Representant[]>([]);
  const [repEditId, setRepEditId] = useState<number | null>(null);
  const [repForm, setRepForm] = useState<{ nom: string; email: string; telephone: string }>({ nom: '', email: '', telephone: '' });
  const [repCreating, setRepCreating] = useState(false);
  // Guards against double-click during async submit (without this, a 2s
  // network round-trip lets the user fire 2 POSTs and create duplicates).
  const [repSubmitting, setRepSubmitting] = useState(false);

  // Finances
  const [finances, setFinances] = useState<adminApi.FinancesData | null>(null);
  const [finMonth, setFinMonth] = useState(new Date().getMonth() + 1);
  const [finYear, setFinYear] = useState(new Date().getFullYear());

  const fetchEntreprises = useCallback(async () => {
    setIsLoading(true);
    try {
      const [entreprisesRes, statsRes] = await Promise.all([
        adminApi.listEntreprises(),
        adminApi.getAdminStats(),
      ]);
      setEntreprises(entreprisesRes.items);
      setStats({
        newThisMonth: 0,
        totalSubscriptions: 0,
        activeSubscriptions: 0,
        signupTrend: [],
        subscriptionDistribution: [],
        revenueClients: [],
        ...statsRes,
      });
      adminApi.listRepresentants().then(res => setRepresentants(res.items)).catch(() => {});
    } catch (err) {
      setError(extractError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchOnline = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data } = await api.get('/admin/online');
      setOnlineData(data);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchAiUsage = useCallback(async (m?: number, yr?: number) => {
    setIsLoading(true);
    try {
      const { data } = await api.get('/admin/ai-usage', { params: { month: m || aiMonth, year: yr || aiYear } });
      setAiUsage(data);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setIsLoading(false);
    }
  }, [aiMonth, aiYear]);

  const fetchUpdates = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await adminApi.listUpdates();
      setUpdates(res.items || []);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchRepresentants = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await adminApi.listRepresentants();
      setRepresentants(res.items || []);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchFinances = useCallback(async (m?: number, yr?: number) => {
    setIsLoading(true);
    try {
      const data = await adminApi.getFinances(m || finMonth, yr || finYear);
      setFinances(data);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setIsLoading(false);
    }
  }, [finMonth, finYear]);

  useEffect(() => {
    if (activeTab === 'entreprises') fetchEntreprises();
    else if (activeTab === 'online') fetchOnline();
    else if (activeTab === 'ai-usage') fetchAiUsage();
    else if (activeTab === 'finances') fetchFinances();
    else if (activeTab === 'updates') fetchUpdates();
    else if (activeTab === 'representants') fetchRepresentants();
  }, [activeTab, fetchEntreprises, fetchOnline, fetchAiUsage, fetchFinances, fetchUpdates, fetchRepresentants]);

  const handleToggle = async (id: number, active: boolean) => {
    try {
      await adminApi.toggleEntreprise(id, active);
      fetchEntreprises();
    } catch (err) {
      setError(extractError(err));
    }
  };

  const handleCreateUpdate = async () => {
    if (!newUpdateMsg.trim()) return;
    try {
      await adminApi.createUpdate({ message: newUpdateMsg, type: 'feature' });
      setNewUpdateMsg('');
      fetchUpdates();
    } catch (err) {
      setError(extractError(err));
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Administration</h2>

      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setError(null); }}
            className={`flex items-center gap-2 px-2.5 md:px-4 py-2 md:py-2.5 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'border-seaop-primary-600 text-seaop-primary-600 dark:text-seaop-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex justify-center py-8">
          <Spinner size="md" />
        </div>
      )}

      {/* TAB: Entreprises — Dashboard */}
      {activeTab === 'entreprises' && !isLoading && (() => {
        const E_COLORS = ['#7BAFD4', '#7DC4A5', '#F6C87A', '#E8919A', '#B09BD8', '#D4A0B0', '#7DC4B5', '#F0B07A'];
        return (
        <>
          {/* KPI Cards */}
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-500 uppercase">Total entreprises</span>
                  <Building2 size={16} className="text-blue-500" />
                </div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalEntreprises}</p>
                <p className="text-xs text-gray-400 mt-1">{stats.newThisMonth ?? 0} nouvelles ce mois</p>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-500 uppercase">Actives</span>
                  <CheckCircle size={16} className="text-emerald-500" />
                </div>
                <p className="text-2xl font-bold text-emerald-600">{stats.activeEntreprises}</p>
                <p className="text-xs text-gray-400 mt-1">{stats.inactiveEntreprises} inactives</p>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-500 uppercase">Abonnements</span>
                  <CreditCard size={16} className="text-violet-500" />
                </div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.activeSubscriptions ?? 0}</p>
                <p className="text-xs text-gray-400 mt-1">sur {stats.totalSubscriptions ?? 0} total</p>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-500 uppercase">Revenu IA total</span>
                  <DollarSign size={16} className="text-blue-500" />
                </div>
                <p className="text-2xl font-bold text-blue-600">${(stats.revenueClients ?? []).reduce((s, c) => s + (c.charged ?? 0), 0).toFixed(2)}</p>
                <p className="text-xs text-gray-400 mt-1">Charges Stripe cumul</p>
              </div>
            </div>
          )}

          {/* Charts Row */}
          {stats && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Signup Trend */}
              <Card className="lg:col-span-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Croissance des inscriptions</h3>
                {(stats.signupTrend ?? []).length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={stats.signupTrend}>
                      <defs>
                        <linearGradient id="gradSignups" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#7BAFD4" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#7BAFD4" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                      <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                      <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 12 }} />
                      <Area type="monotone" dataKey="signups" stroke="#7BAFD4" fill="url(#gradSignups)" strokeWidth={2} name="Inscriptions" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-gray-400 text-center py-12">Aucune donnée</p>}
              </Card>

              {/* Subscription Distribution */}
              <Card>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Statut abonnements</h3>
                {(stats.subscriptionDistribution ?? []).length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={160}>
                      <PieChart>
                        <Pie data={stats.subscriptionDistribution} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={60} innerRadius={30}>
                          {(stats.subscriptionDistribution ?? []).map((_, idx) => (
                            <Cell key={idx} fill={E_COLORS[idx % E_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1.5 mt-2">
                      {(stats.subscriptionDistribution ?? []).map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: E_COLORS[i % E_COLORS.length] }} />
                            <span className="text-gray-600 dark:text-gray-400">{s.status}</span>
                          </div>
                          <span className="font-medium text-gray-900 dark:text-white">{s.count}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : <p className="text-sm text-gray-400 text-center py-12">Aucune donnée</p>}
              </Card>
            </div>
          )}

          {/* Revenue by Client Bar Chart */}
          {stats && (stats.revenueClients ?? []).length > 0 && (
            <Card>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Revenus IA par client</h3>
              <ResponsiveContainer width="100%" height={Math.max(200, (stats.revenueClients ?? []).length * 40)}>
                <BarChart data={stats.revenueClients} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="nom" tick={{ fontSize: 11 }} stroke="#9ca3af" width={180} />
                  <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 12 }} formatter={(value: number, name: string) => [`$${(value ?? 0).toFixed(2)}`, name === 'charged' ? 'Charge Stripe' : name === 'consumed' ? 'Consomme' : 'Balance']} />
                  <Legend formatter={(v) => v === 'charged' ? 'Charge Stripe' : v === 'consumed' ? 'Consomme' : 'Balance'} />
                  <Bar dataKey="charged" fill="#7BAFD4" radius={[0, 4, 4, 0]} name="charged" />
                  <Bar dataKey="consumed" fill="#F0B07A" radius={[0, 4, 4, 0]} name="consumed" />
                  <Bar dataKey="balance" fill="#7DC4A5" radius={[0, 4, 4, 0]} name="balance" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Entreprises Table */}
          <Card padding="sm" className="hidden md:block">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 px-4 pt-2">Liste des entreprises</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Plan</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase">Users</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Representant</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Créé</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {entreprises.map((e) => (
                    <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-white">{e.nom}</td>
                      <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 text-xs">{e.email || '--'}</td>
                      <td className="px-3 py-2.5"><Badge color={e.subscriptionStatus === 'active' ? 'green' : 'gray'}>{e.planType || 'Free'}</Badge></td>
                      <td className="px-3 py-2.5 text-center text-gray-500"><Users size={14} className="inline mr-1" />{e.userCount}</td>
                      <td className="px-3 py-2.5 text-center"><Badge color={e.active ? 'green' : 'red'}>{e.active ? 'Active' : 'Inactive'}</Badge></td>
                      <td className="px-3 py-2.5">
                        <select className="text-xs border border-gray-200 dark:border-gray-600 rounded px-1 py-0.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300" value={e.representant || ''} onChange={async (ev) => { const val = ev.target.value || ''; setEntreprises(prev => prev.map(ent => ent.id === e.id ? { ...ent, representant: val || undefined } : ent)); try { await adminApi.assignRepresentant(e.id, val || null); } catch { fetchEntreprises(); } }}>
                          <option value="">--</option>
                          {representants.filter(r => r.actif).map(r => (<option key={r.id} value={r.nom}>{r.nom}</option>))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 text-xs">{formatDate(e.createdAt)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <Button size="sm" variant={e.active ? 'danger' : 'primary'} onClick={() => handleToggle(e.id, !e.active)}>{e.active ? 'Desactiver' : 'Activer'}</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {entreprises.map((e) => (
              <div key={e.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate mr-2">{e.nom}</span>
                  <Badge color={e.active ? 'green' : 'red'}>{e.active ? 'Active' : 'Inactive'}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mb-2">
                  <span>{e.email || '--'}</span>
                  <Badge color={e.subscriptionStatus === 'active' ? 'green' : 'gray'} size="sm">{e.planType || 'Free'}</Badge>
                  <span><Users size={12} className="inline mr-1" />{e.userCount} users</span>
                </div>
                <Button size="sm" variant={e.active ? 'danger' : 'primary'} onClick={() => handleToggle(e.id, !e.active)}>{e.active ? 'Desactiver' : 'Activer'}</Button>
              </div>
            ))}
            {entreprises.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">Aucune entreprise</p>
            )}
          </div>
        </>
        );
      })()}

      {/* TAB: Online — Dashboard */}
      {activeTab === 'online' && !isLoading && onlineData && (() => {
        const O_COLORS = ['#7BAFD4', '#7DC4A5', '#F6C87A', '#E8919A', '#B09BD8', '#D4A0B0', '#7DC4B5', '#F0B07A'];
        return (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 uppercase">ERP en ligne</span>
                <Building2 size={16} className="text-blue-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{onlineData.stats.erpOnline}</p>
              <p className="text-xs text-gray-400 mt-1">Entreprises connectees</p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 uppercase">Sessions actives</span>
                <Wifi size={16} className="text-emerald-500" />
              </div>
              <p className="text-2xl font-bold text-emerald-600">{onlineData.stats.totalSessions}</p>
              <p className="text-xs text-gray-400 mt-1">En ce moment</p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 uppercase">Top utilisateurs</span>
                <Users size={16} className="text-violet-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{(onlineData.topUsers ?? []).length}</p>
              <p className="text-xs text-gray-400 mt-1">Actifs 30 derniers jours</p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 uppercase">Connexions 30j</span>
                <TrendingUp size={16} className="text-blue-500" />
              </div>
              <p className="text-2xl font-bold text-blue-600">{(onlineData.loginTrend ?? []).reduce((s, d) => s + d.logins, 0)}</p>
              <p className="text-xs text-gray-400 mt-1">Total logins</p>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Login Trend */}
            <Card className="lg:col-span-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Connexions — 30 derniers jours</h3>
              {(onlineData.loginTrend ?? []).length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={onlineData.loginTrend}>
                    <defs>
                      <linearGradient id="gradLogins" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7BAFD4" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#7BAFD4" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradCompanies" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7DC4A5" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#7DC4A5" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 12 }} />
                    <Legend />
                    <Area type="monotone" dataKey="logins" stroke="#7BAFD4" fill="url(#gradLogins)" strokeWidth={2} name="Connexions" />
                    <Area type="monotone" dataKey="companies" stroke="#7DC4A5" fill="url(#gradCompanies)" strokeWidth={2} name="Entreprises" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-gray-400 text-center py-12">Aucune donnée</p>}
            </Card>

            {/* Sessions by Entreprise (Pie) */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Sessions par entreprise</h3>
              {(onlineData.byEntreprise ?? []).length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={onlineData.byEntreprise} dataKey="sessions" nameKey="nom" cx="50%" cy="50%" outerRadius={60} innerRadius={30}>
                        {(onlineData.byEntreprise ?? []).map((_, idx) => (
                          <Cell key={idx} fill={O_COLORS[idx % O_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-2">
                    {(onlineData.byEntreprise ?? []).map((e, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: O_COLORS[i % O_COLORS.length] }} />
                          <span className="text-gray-600 dark:text-gray-400 truncate max-w-[120px]">{e.nom}</span>
                        </div>
                        <span className="font-medium text-gray-900 dark:text-white">{e.sessions}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : <p className="text-sm text-gray-400 text-center py-12">Aucune session</p>}
            </Card>
          </div>

          {/* Peak Hours Bar Chart */}
          {(onlineData.peakHours ?? []).length > 0 && (
            <Card>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Heures de pointe — 30 derniers jours</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={onlineData.peakHours}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="hour" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="logins" fill="#7BAFD4" radius={[4, 4, 0, 0]} name="Connexions" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Top Users + Active Sessions side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Users */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Utilisateurs les plus actifs (30j)</h3>
              <div className="space-y-2">
                {(onlineData.topUsers ?? []).map((u, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{u.username}</span>
                      <p className="text-xs text-gray-400">{u.entrepriseNom}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-semibold text-blue-600">{u.sessions}</span>
                      <p className="text-xs text-gray-400">sessions</p>
                    </div>
                  </div>
                ))}
                {(onlineData.topUsers ?? []).length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">Aucune donnée</p>
                )}
              </div>
            </Card>

            {/* Current Sessions */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Sessions actives maintenant</h3>
                <Button size="sm" variant="ghost" leftIcon={<RefreshCw size={14} />} onClick={fetchOnline}>Rafraîchir</Button>
              </div>
              <div className="space-y-2">
                {onlineData.sessions.map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{s.username}</span>
                      <p className="text-xs text-gray-400">{s.entrepriseNom}</p>
                    </div>
                    <span className="text-xs text-gray-400">{formatRelativeTime(s.derniereActivite)}</span>
                  </div>
                ))}
                {onlineData.sessions.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">Aucune session active</p>
                )}
              </div>
            </Card>
          </div>
        </>
        );
      })()}

      {/* TAB: AI Usage — Financial Dashboard */}
      {activeTab === 'ai-usage' && !isLoading && aiUsage && (() => {
        const COLORS = ['#7BAFD4', '#7DC4A5', '#F6C87A', '#E8919A', '#B09BD8', '#D4A0B0', '#7DC4B5', '#F0B07A'];
        const monthNames = ['', 'Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
        const handleMonthNav = (dir: number) => {
          let nm = aiMonth + dir;
          let ny = aiYear;
          if (nm < 1) { nm = 12; ny--; }
          if (nm > 12) { nm = 1; ny++; }
          setAiMonth(nm);
          setAiYear(ny);
          fetchAiUsage(nm, ny);
        };
        return (
        <>
          {/* Month Navigator */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Dashboard Financier IA</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => handleMonthNav(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"><ChevronLeft size={18} /></button>
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 min-w-[140px] text-center">
                {monthNames[aiMonth]} {aiYear}
              </span>
              <button onClick={() => handleMonthNav(1)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"><ChevronRight size={18} /></button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 uppercase">Revenu client</span>
                <DollarSign size={16} className="text-blue-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">${(aiUsage.totalCost ?? 0).toFixed(2)}</p>
              <p className="text-xs text-gray-400 mt-1">{aiUsage.totalRequests} requetes ce mois</p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 uppercase">Coût Anthropic</span>
                <CreditCard size={16} className="text-orange-500" />
              </div>
              <p className="text-2xl font-bold text-orange-600">${(aiUsage.anthropicCost ?? 0).toFixed(2)}</p>
              <p className="text-xs text-gray-400 mt-1">Coût réel API Claude</p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 uppercase">Profit net (30%)</span>
                <TrendingUp size={16} className="text-emerald-500" />
              </div>
              <p className="text-2xl font-bold text-emerald-600">${(aiUsage.profit ?? 0).toFixed(2)}</p>
              <p className="text-xs text-gray-400 mt-1">Marge sur utilisation IA</p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 uppercase">Clients actifs</span>
                <Users size={16} className="text-violet-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{aiUsage.activeClients ?? 0}</p>
              <p className="text-xs text-gray-400 mt-1">Revenu total Stripe: ${(aiUsage.totalRevenue ?? 0).toFixed(2)}</p>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Area Chart — Daily Trend */}
            <Card className="lg:col-span-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Tendance journaliere</h3>
              {aiUsage.dailyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={aiUsage.dailyTrend}>
                    <defs>
                      <linearGradient id="gradRevenu" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7BAFD4" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#7BAFD4" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7DC4A5" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#7DC4A5" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#9ca3af' }}
                      formatter={(value: number, name: string) => [`$${(value ?? 0).toFixed(2)}`, name === 'cost' ? 'Revenu' : name === 'anthropic' ? 'Anthropic' : 'Profit']}
                    />
                    <Area type="monotone" dataKey="cost" stroke="#7BAFD4" fill="url(#gradRevenu)" strokeWidth={2} name="cost" />
                    <Area type="monotone" dataKey="profit" stroke="#7DC4A5" fill="url(#gradProfit)" strokeWidth={2} name="profit" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-gray-400 text-center py-12">Aucune donnée pour ce mois</p>
              )}
            </Card>

            {/* Pie Chart — By Feature */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Repartition par service</h3>
              {aiUsage.byFeature.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={aiUsage.byFeature}
                        dataKey="cost"
                        nameKey="feature"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        innerRadius={35}
                      >
                        {aiUsage.byFeature.map((_, idx) => (
                          <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 12 }}
                        formatter={(value: number) => [`$${(value ?? 0).toFixed(2)}`]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-2">
                    {aiUsage.byFeature.map((f, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="text-gray-600 dark:text-gray-400 truncate max-w-[120px]">{f.feature.replace(/_/g, ' ')}</span>
                        </div>
                        <span className="font-medium text-gray-900 dark:text-white">${(f.cost ?? 0).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-400 text-center py-12">Aucune donnée</p>
              )}
            </Card>
          </div>

          {/* Bar Chart — Revenue vs Cost by Company */}
          {aiUsage.byCompany.length > 0 && (
            <Card>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Revenu vs Coût par client</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={aiUsage.byCompany} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v) => `$${v}`} />
                  <YAxis
                    type="category"
                    dataKey="entrepriseNom"
                    tick={{ fontSize: 11 }}
                    stroke="#9ca3af"
                    width={150}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number, name: string) => [`$${(value ?? 0).toFixed(2)}`, name === 'monthlyCost' ? 'Revenu client' : name === 'anthropicCost' ? 'Coût Anthropic' : 'Profit']}
                  />
                  <Legend formatter={(value) => value === 'monthlyCost' ? 'Revenu' : value === 'anthropicCost' ? 'Anthropic' : 'Profit'} />
                  <Bar dataKey="monthlyCost" fill="#7BAFD4" radius={[0, 4, 4, 0]} name="monthlyCost" />
                  <Bar dataKey="anthropicCost" fill="#F0B07A" radius={[0, 4, 4, 0]} name="anthropicCost" />
                  <Bar dataKey="profit" fill="#7DC4A5" radius={[0, 4, 4, 0]} name="profit" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Detailed Table */}
          <Card>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Détail par entreprise</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Entreprise</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Revenu</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Anthropic</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Profit</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Balance</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Charge Stripe</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Req.</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Tokens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {aiUsage.byCompany.map((c, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-gray-900 dark:text-white">{c.entrepriseNom}</div>
                        <div className="text-xs text-gray-400">{c.entrepriseEmail}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-blue-600">${(c.monthlyCost ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right text-orange-500">${(c.anthropicCost ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-emerald-600">${(c.profit ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={(c.balanceUsd ?? 0) <= 0 ? 'text-red-500 font-medium' : 'text-gray-600 dark:text-gray-400'}>
                          ${(c.balanceUsd ?? 0).toFixed(2)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-600 dark:text-gray-400">
                        ${(c.totalChargedUsd ?? 0).toFixed(2)}
                        {c.chargesCount > 0 && <span className="text-xs text-gray-400 ml-1">({c.chargesCount}x)</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-600 dark:text-gray-400">{c.totalRequests}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600 dark:text-gray-400">{c.totalTokens.toLocaleString()}</td>
                    </tr>
                  ))}
                  {aiUsage.byCompany.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Aucune utilisation IA ce mois</td></tr>
                  )}
                </tbody>
                {aiUsage.byCompany.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 font-semibold">
                      <td className="px-3 py-2.5 text-gray-900 dark:text-white">Total</td>
                      <td className="px-3 py-2.5 text-right text-blue-600">${(aiUsage.totalCost ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right text-orange-500">${(aiUsage.anthropicCost ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right text-emerald-600">${(aiUsage.profit ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-2.5" />
                      <td className="px-3 py-2.5" />
                      <td className="px-3 py-2.5 text-right text-gray-600 dark:text-gray-400">{aiUsage.totalRequests}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600 dark:text-gray-400">
                        {aiUsage.byCompany.reduce((s, c) => s + c.totalTokens, 0).toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3 mt-4">
              {aiUsage.byCompany.map((c, i) => (
                <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{c.entrepriseNom}</span>
                      <p className="text-xs text-gray-400">{c.entrepriseEmail}</p>
                    </div>
                    <span className="text-sm font-bold text-emerald-600">+${(c.profit ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><span className="text-gray-400">Revenu</span><br /><span className="font-medium text-blue-600">${(c.monthlyCost ?? 0).toFixed(2)}</span></div>
                    <div><span className="text-gray-400">Anthropic</span><br /><span className="font-medium text-orange-500">${(c.anthropicCost ?? 0).toFixed(2)}</span></div>
                    <div><span className="text-gray-400">Balance</span><br /><span className={`font-medium ${(c.balanceUsd ?? 0) <= 0 ? 'text-red-500' : ''}`}>${(c.balanceUsd ?? 0).toFixed(2)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
        );
      })()}

      {/* TAB: Finances — P&L Dashboard with Charts */}
      {activeTab === 'finances' && !isLoading && finances && (() => {
        const monthNames = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
        const handleFinMonthNav = (dir: number) => {
          let nm = finMonth + dir;
          let ny = finYear;
          if (nm < 1) { nm = 12; ny--; }
          if (nm > 12) { nm = 1; ny++; }
          setFinMonth(nm);
          setFinYear(ny);
        };
        const COLORS = ['#7BAFD4', '#B09BD8', '#F6C87A', '#E8919A', '#7DC4B5', '#7DC4A5'];
        const revExpData = [
          { name: 'Abonnements', value: finances.subscriptionRevenue ?? 0, color: '#2563eb' },
          { name: 'Revenus IA', value: finances.aiRevenue ?? 0, color: '#B09BD8' },
        ].filter(d => d.value > 0);
        const expenseData = [
          { name: 'Commissions', value: finances.commissionsTotal ?? 0, color: '#F0B07A' },
          { name: 'Serveurs', value: finances.renderCost ?? 0, color: '#E8919A' },
          { name: 'Anthropic IA', value: finances.anthropicCost ?? 0, color: '#F6C87A' },
        ].filter(d => d.value > 0);
        const commBarData = (finances.commissionsByRep ?? []).map(r => ({
          name: r.representant.split(' ')[0],
          revenu: r.revenue,
          commission: r.commission,
          net: r.revenue - r.commission,
        }));
        const plData = [
          { name: 'Revenus', montant: finances.totalRevenue ?? 0 },
          { name: 'Dépenses', montant: -(finances.totalExpenses ?? 0) },
          { name: 'Profit net', montant: finances.profitAfterTax ?? 0 },
        ];
        const marginPct = (finances.totalRevenue ?? 0) > 0 ? ((finances.profitAfterTax ?? 0) / (finances.totalRevenue ?? 1) * 100) : 0;
        return (
        <>
          {/* Month Navigator */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Tableau Financier</h2>
              <p className="text-xs text-gray-400 mt-0.5">{finances.subscriptionCount} entreprises actives sur {finances.totalEntreprises ?? '—'} total · {(finances.erpMonthlyPrice ?? 79.99).toFixed(2)}$/mois par abonnement</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => handleFinMonthNav(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500" aria-label="Mois précédent"><ChevronLeft size={18} /></button>
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 min-w-[140px] text-center">
                {monthNames[finMonth]} {finYear}
              </span>
              <button onClick={() => handleFinMonthNav(1)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500" aria-label="Mois suivant"><ChevronRight size={18} /></button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Revenu mensuel</span>
                <DollarSign size={16} className="text-blue-500" />
              </div>
              <p className="text-2xl font-bold text-blue-600">${(finances.totalRevenue ?? 0).toLocaleString('fr-CA', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
              <p className="text-xs text-gray-400 mt-1">{finances.subscriptionCount ?? 0} abonnements actifs</p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Dépenses</span>
                <CreditCard size={16} className="text-orange-500" />
              </div>
              <p className="text-2xl font-bold text-orange-600">${(finances.totalExpenses ?? 0).toLocaleString('fr-CA', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
              <p className="text-xs text-gray-400 mt-1">Commissions + Infra + IA</p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Profit avant impôt</span>
                <TrendingUp size={16} className="text-emerald-500" />
              </div>
              <p className={`text-2xl font-bold ${(finances.profitBeforeTax ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                ${(finances.profitBeforeTax ?? 0).toLocaleString('fr-CA', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </p>
              <p className="text-xs text-gray-400 mt-1">Revenu - Dépenses</p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Profit net</span>
                <Wallet size={16} className="text-violet-500" />
              </div>
              <p className={`text-2xl font-bold ${(finances.profitAfterTax ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                ${(finances.profitAfterTax ?? 0).toLocaleString('fr-CA', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </p>
              <p className="text-xs text-gray-400 mt-1">Après impôt ({((finances.taxRate ?? 0) * 100).toFixed(1)}%)</p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Marge nette</span>
                <TrendingUp size={16} className="text-cyan-500" />
              </div>
              <p className={`text-2xl font-bold ${marginPct >= 0 ? 'text-cyan-600' : 'text-red-600'}`}>
                {(marginPct ?? 0).toFixed(1)}%
              </p>
              <p className="text-xs text-gray-400 mt-1">Profit / Revenu</p>
            </div>
          </div>

          {/* Charts Row: Revenue Pie + Expenses Pie + P&L Bar */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Revenue Pie */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Répartition des revenus</h3>
              {revExpData.length > 0 ? (
              <>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={revExpData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {revExpData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `$${(v ?? 0).toFixed(2)}`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-4 mt-2">
                {revExpData.map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-gray-500">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.name}: <span className="font-semibold text-gray-700 dark:text-gray-300">${(d.value ?? 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              </>
              ) : <p className="text-sm text-gray-400 text-center py-16">Aucun revenu ce mois</p>}
            </Card>

            {/* Expenses Pie */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Répartition des dépenses</h3>
              {expenseData.length > 0 ? (
              <>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={expenseData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {expenseData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `$${(v ?? 0).toFixed(2)}`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-4 mt-2 flex-wrap">
                {expenseData.map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-gray-500">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.name}: <span className="font-semibold text-gray-700 dark:text-gray-300">${(d.value ?? 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              </>
              ) : <p className="text-sm text-gray-400 text-center py-16">Aucune dépense ce mois</p>}
            </Card>

            {/* P&L Bar */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">État des résultats</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={plData} layout="vertical" margin={{ left: 10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                    <XAxis type="number" tickFormatter={(v) => `$${Math.abs(v).toFixed(0)}`} style={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={75} style={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => `$${(v ?? 0).toFixed(2)}`} />
                    <Bar dataKey="montant" radius={[0, 4, 4, 0]}>
                      {plData.map((d, i) => <Cell key={i} fill={d.montant >= 0 ? '#7DC4A5' : '#E8919A'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Commissions Chart + Table */}
          {commBarData.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Commissions Bar Chart */}
              <Card>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Commissions par représentant</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={commBarData} margin={{ left: 10, right: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                      <XAxis dataKey="name" style={{ fontSize: 11 }} />
                      <YAxis tickFormatter={(v) => `$${v}`} style={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => `$${(v ?? 0).toFixed(2)}`} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="revenu" name="Revenu" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="commission" name="Commission" fill="#F0B07A" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="net" name="Net" fill="#7DC4A5" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* Commissions Table */}
              <Card>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Détail commissions</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Représentant</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Clients</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Revenu</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Taux</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Commission</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {finances.commissionsByRep.map((r, i) => (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-white">{r.representant}</td>
                          <td className="px-3 py-2.5 text-center text-gray-600 dark:text-gray-400">{r.clients}</td>
                          <td className="px-3 py-2.5 text-right text-blue-600 font-medium">${(r.revenue ?? 0).toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-center">
                            <Badge color={(r.rate ?? 0) === 0 ? 'green' : 'yellow'}>
                              {(r.rate ?? 0) === 0 ? '0% (propriétaire)' : `${((r.rate ?? 0) * 100).toFixed(0)}%`}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 text-right text-orange-600">${(r.commission ?? 0).toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-emerald-600">${((r.revenue ?? 0) - (r.commission ?? 0)).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 font-semibold">
                        <td className="px-3 py-2.5 text-gray-900 dark:text-white">Total</td>
                        <td className="px-3 py-2.5 text-center">{finances.commissionsByRep.reduce((s, r) => s + r.clients, 0)}</td>
                        <td className="px-3 py-2.5 text-right text-blue-600">${finances.commissionsByRep.reduce((s, r) => s + (r.revenue ?? 0), 0).toFixed(2)}</td>
                        <td />
                        <td className="px-3 py-2.5 text-right text-orange-600">${(finances.commissionsTotal ?? 0).toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right text-emerald-600">${((finances.subscriptionRevenue ?? 0) - (finances.commissionsTotal ?? 0)).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* P&L Detailed Statement */}
          <Card>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">État des résultats détaillé (P&L)</h3>
            <div className="max-w-lg mx-auto space-y-2">
              <div className="flex justify-between py-1.5 text-sm">
                <span className="text-gray-600 dark:text-gray-400 pl-4">Abonnements ({finances.subscriptionCount} × ${(finances.erpMonthlyPrice ?? 79.99).toFixed(2)})</span>
                <span className="text-gray-900 dark:text-white">${(finances.subscriptionRevenue ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-1.5 text-sm">
                <span className="text-gray-600 dark:text-gray-400 pl-4">Revenus IA (marge 30%)</span>
                <span className="text-gray-900 dark:text-white">${(finances.aiRevenue ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-1.5 text-sm font-bold border-t border-gray-200 dark:border-gray-700">
                <span className="text-gray-900 dark:text-white">Total revenus</span>
                <span className="text-blue-600">${(finances.totalRevenue ?? 0).toFixed(2)}</span>
              </div>

              <div className="flex justify-between py-1.5 text-sm mt-2">
                <span className="text-gray-600 dark:text-gray-400 pl-4">Commissions représentants (40%)</span>
                <span className="text-red-500">-${(finances.commissionsTotal ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-1.5 text-sm">
                <span className="text-gray-600 dark:text-gray-400 pl-4">Infrastructure Render</span>
                <span className="text-red-500">-${(finances.renderCost ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-1.5 text-sm">
                <span className="text-gray-600 dark:text-gray-400 pl-4">Coût Anthropic IA</span>
                <span className="text-red-500">-${(finances.anthropicCost ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-1.5 text-sm font-bold border-t border-gray-200 dark:border-gray-700">
                <span className="text-gray-900 dark:text-white">Total dépenses</span>
                <span className="text-orange-600">-${(finances.totalExpenses ?? 0).toFixed(2)}</span>
              </div>

              <div className="flex justify-between py-2 text-sm font-bold border-t-2 border-gray-300 dark:border-gray-600 mt-2">
                <span className="text-gray-900 dark:text-white">Profit avant impôt</span>
                <span className={(finances.profitBeforeTax ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                  ${(finances.profitBeforeTax ?? 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between py-1.5 text-sm">
                <span className="text-gray-600 dark:text-gray-400 pl-4">Impôt corporatif estimé ({((finances.taxRate ?? 0) * 100).toFixed(1)}%)</span>
                <span className="text-red-500">-${(finances.estimatedTax ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-3 text-base font-bold border-t-2 border-gray-300 dark:border-gray-600 bg-emerald-50 dark:bg-emerald-900/20 px-3 rounded-lg mt-1">
                <span className="text-gray-900 dark:text-white">PROFIT NET</span>
                <span className={(finances.profitAfterTax ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                  ${(finances.profitAfterTax ?? 0).toFixed(2)}
                </span>
              </div>
            </div>
          </Card>

          {/* Subscription Detail Table */}
          {(finances.subscriptionsDetail ?? []).length > 0 && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Entreprises actives ({finances.subscriptionCount})</h3>
                <Badge color="green">{(finances.erpMonthlyPrice ?? 79.99).toFixed(2)}$/mois chacune</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">#</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Entreprise</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Plan</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Prix/mois</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Représentant</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Commission</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Net Constructo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {finances.subscriptionsDetail.map((s, i) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-3 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                        <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-white">{s.nom}</td>
                        <td className="px-3 py-2.5"><Badge color="blue">{s.planType}</Badge></td>
                        <td className="px-3 py-2.5 text-right text-gray-900 dark:text-white font-medium">${(s.priceMonthly ?? 0).toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{s.representant}</td>
                        <td className="px-3 py-2.5 text-right">
                          {(s.commission ?? 0) > 0
                            ? <span className="text-orange-600">${(s.commission ?? 0).toFixed(2)}</span>
                            : <span className="text-green-600">$0.00</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-emerald-600">${(s.net ?? 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 font-semibold">
                      <td />
                      <td className="px-3 py-2.5 text-gray-900 dark:text-white">Total ({finances.subscriptionCount})</td>
                      <td />
                      <td className="px-3 py-2.5 text-right text-gray-900 dark:text-white">${(finances.subscriptionRevenue ?? 0).toFixed(2)}</td>
                      <td />
                      <td className="px-3 py-2.5 text-right text-orange-600">${(finances.commissionsTotal ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right text-emerald-600">${((finances.subscriptionRevenue ?? 0) - (finances.commissionsTotal ?? 0)).toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )}
        </>
        );
      })()}

      {/* TAB: Updates */}
      {activeTab === 'updates' && !isLoading && (
        <>
          <Card>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Nouvelle mise à jour</h3>
            <div className="flex gap-3">
              <input
                type="text"
                value={newUpdateMsg}
                onChange={(e) => setNewUpdateMsg(e.target.value)}
                placeholder="Message de mise à jour..."
                className="flex-1 erp-input"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateUpdate()}
              />
              <Button onClick={handleCreateUpdate} disabled={!newUpdateMsg.trim()}>Publier</Button>
            </div>
          </Card>
          <Card>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Historique</h3>
            <div className="space-y-3">
              {updates.map((u) => (
                <div key={u.id} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-800">
                  <Bell size={16} className="shrink-0 mt-0.5 text-seaop-primary-500" />
                  <div className="flex-1">
                    <p className="text-sm text-gray-900 dark:text-white">{u.message}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {formatRelativeTime(u.createdAt)}
                      {u.type && <Badge color="blue" size="sm">{u.type}</Badge>}
                    </p>
                  </div>
                </div>
              ))}
              {updates.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Aucune mise à jour</p>
              )}
            </div>
          </Card>
        </>
      )}

      {/* TAB: Representants
          Note: do NOT gate on `!isLoading` here. fetchRepresentants() toggles
          isLoading, which would unmount the create form mid-submit and make
          the user think "rien ne se passe". The Card renders during refresh,
          showing the previous list until the new one arrives. */}
      {activeTab === 'representants' && (
        <>
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Gestion des représentants</h3>
              <Button
                size="sm"
                leftIcon={<Plus size={14} />}
                onClick={() => {
                  setRepCreating(true);
                  setRepEditId(null);
                  setRepForm({ nom: '', email: '', telephone: '' });
                }}
              >
                Ajouter
              </Button>
            </div>

            {/* Create / Edit form */}
            {(repCreating || repEditId !== null) && (
              <div className="mb-4 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                  {repEditId !== null ? 'Modifier le représentant' : 'Nouveau représentant'}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                  <input
                    type="text"
                    placeholder="Nom *"
                    value={repForm.nom}
                    onChange={(ev) => setRepForm({ ...repForm, nom: ev.target.value })}
                    className="erp-input text-sm"
                  />
                  <input
                    type="email"
                    placeholder="Email"
                    value={repForm.email}
                    onChange={(ev) => setRepForm({ ...repForm, email: ev.target.value })}
                    className="erp-input text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Téléphone"
                    value={repForm.telephone}
                    onChange={(ev) => setRepForm({ ...repForm, telephone: ev.target.value })}
                    className="erp-input text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!repForm.nom.trim() || repSubmitting}
                    onClick={async () => {
                      if (repSubmitting) return;
                      setRepSubmitting(true);
                      try {
                        if (repEditId !== null) {
                          await adminApi.updateRepresentant(repEditId, {
                            nom: repForm.nom,
                            email: repForm.email || undefined,
                            telephone: repForm.telephone || undefined,
                          });
                        } else {
                          await adminApi.createRepresentant({
                            nom: repForm.nom,
                            email: repForm.email || undefined,
                            telephone: repForm.telephone || undefined,
                          });
                        }
                        // POST/PUT succeeded — close the form now so a
                        // subsequent fetch failure can't trick the user into
                        // retrying and creating a duplicate row.
                        setRepCreating(false);
                        setRepEditId(null);
                        setRepForm({ nom: '', email: '', telephone: '' });
                        // Refresh is best-effort: the write is already
                        // committed server-side. If the list fetch fails,
                        // swallow it — the row will appear on next refresh.
                        try {
                          await fetchRepresentants();
                        } catch {
                          // intentional: don't surface a fetch error after a
                          // successful write
                        }
                      } catch (err) {
                        setError(extractError(err));
                      } finally {
                        setRepSubmitting(false);
                      }
                    }}
                  >
                    {repSubmitting ? '...' : (repEditId !== null ? 'Enregistrer' : 'Créer')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={repSubmitting}
                    onClick={() => {
                      setRepCreating(false);
                      setRepEditId(null);
                      setRepForm({ nom: '', email: '', telephone: '' });
                    }}
                  >
                    Annuler
                  </Button>
                </div>
              </div>
            )}

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Téléphone</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Actif</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {representants.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{r.nom}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{r.email || '--'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{r.telephone || '--'}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge color={r.actif ? 'green' : 'red'}>{r.actif ? 'Actif' : 'Inactif'}</Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            className="p-1 text-gray-400 hover:text-seaop-primary-500 transition-colors"
                            title="Modifier"
                            onClick={() => {
                              setRepEditId(r.id);
                              setRepCreating(false);
                              setRepForm({ nom: r.nom, email: r.email || '', telephone: r.telephone || '' });
                            }}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                            title="Supprimer"
                            onClick={async () => {
                              if (!confirm(`Supprimer le représentant "${r.nom}" ?`)) return;
                              try {
                                await adminApi.deleteRepresentant(r.id);
                                fetchRepresentants();
                              } catch (err) {
                                setError(extractError(err));
                              }
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                          <button
                            className="p-1 text-gray-400 hover:text-orange-500 transition-colors"
                            title={r.actif ? 'Désactiver' : 'Activer'}
                            onClick={async () => {
                              try {
                                await adminApi.updateRepresentant(r.id, { actif: !r.actif });
                                fetchRepresentants();
                              } catch (err) {
                                setError(extractError(err));
                              }
                            }}
                          >
                            {r.actif ? <XCircle size={14} /> : <CheckCircle size={14} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {representants.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-400">Aucun représentant</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {representants.map((r) => (
                <div key={r.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate mr-2">{r.nom}</span>
                    <Badge color={r.actif ? 'green' : 'red'}>{r.actif ? 'Actif' : 'Inactif'}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mb-2">
                    <span>{r.email || '--'}</span>
                    <span>{r.telephone || '--'}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRepEditId(r.id);
                        setRepCreating(false);
                        setRepForm({ nom: r.nom, email: r.email || '', telephone: r.telephone || '' });
                      }}
                    >
                      <Pencil size={12} className="mr-1" /> Modifier
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        if (!confirm(`Supprimer le représentant "${r.nom}" ?`)) return;
                        try {
                          await adminApi.deleteRepresentant(r.id);
                          fetchRepresentants();
                        } catch (err) {
                          setError(extractError(err));
                        }
                      }}
                    >
                      <Trash2 size={12} className="mr-1" /> Supprimer
                    </Button>
                  </div>
                </div>
              ))}
              {representants.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Aucun représentant</p>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
