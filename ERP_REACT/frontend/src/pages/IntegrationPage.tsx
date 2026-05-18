/**
 * ERP React Frontend - Integration Page
 * QuickBooks Online & Sage 50 integration management.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  Link2, RefreshCw, Plus, Trash2, Send, ExternalLink,
  CheckCircle2, XCircle, Clock, ArrowRightLeft, ArrowUpRight,
  ArrowDownLeft, AlertCircle, BookOpen, Globe,
  ChevronDown, ChevronRight, Copy, Database,
} from 'lucide-react';
import { useIntegrationStore } from '@/store/useIntegrationStore';
import {
  QUICKBOOKS_MAPPINGS,
  SAGE50_MAPPINGS,
  WEBHOOK_EVENTS,
  getQuickBooksAuthUrl,
  quickBooksOAuthCallback,
} from '@/api/integration';
import type {
  IntegrationConnection,
  SyncLog,
  SyncStats,
  WebhookConfig,
} from '@/api/integration';

type TabKey = 'overview' | 'quickbooks' | 'sage50' | 'webhooks' | 'mapping' | 'history';

const TAB_LABELS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Vue d\'ensemble', icon: <Database size={16} /> },
  { key: 'quickbooks', label: 'QuickBooks', icon: <BookOpen size={16} /> },
  { key: 'sage50', label: 'Sage 50', icon: <BookOpen size={16} /> },
  { key: 'webhooks', label: 'Webhooks', icon: <Globe size={16} /> },
  { key: 'mapping', label: 'Correspondance', icon: <ArrowRightLeft size={16} /> },
  { key: 'history', label: 'Historique', icon: <Clock size={16} /> },
];

// ── Helpers ────────────────────────────────────────────────
function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Lecon M8 S33: couleurs renforcees pour respecter WCAG AA (ratio >= 4.5:1
// sur fond blanc/sombre). Palette Fluent Design standard.
const STATUS_MAP: Record<string, { bg: string; text: string; label: string }> = {
  connected: { bg: 'bg-[#107c10]/10', text: 'text-[#107c10] dark:text-[#92c353]', label: 'connecté' },
  success: { bg: 'bg-[#107c10]/10', text: 'text-[#107c10] dark:text-[#92c353]', label: 'succès' },
  disconnected: { bg: 'bg-[#605e5c]/15', text: 'text-[#323130] dark:text-[#c8c6c4]', label: 'déconnecté' },
  error: { bg: 'bg-[#d13438]/10', text: 'text-[#a4262c] dark:text-[#f1707b]', label: 'erreur' },
  pending: { bg: 'bg-[#797673]/15', text: 'text-[#605e5c] dark:text-[#c8c6c4]', label: 'en attente' },
  skipped: { bg: 'bg-[#605e5c]/15', text: 'text-[#323130] dark:text-[#c8c6c4]', label: 'ignoré' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.pending;
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', s.bg, s.text)}>
      {s.label}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────
export default function IntegrationPage() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [searchParams, setSearchParams] = useSearchParams();
  const [oauthMsg, setOauthMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const connections = useIntegrationStore((s) => s.connections);
  const syncLogs = useIntegrationStore((s) => s.syncLogs);
  const syncStats = useIntegrationStore((s) => s.syncStats);
  const webhooks = useIntegrationStore((s) => s.webhooks);
  const isLoading = useIntegrationStore((s) => s.isLoading);
  const error = useIntegrationStore((s) => s.error);
  const fetchConnections = useIntegrationStore((s) => s.fetchConnections);
  const fetchSyncStats = useIntegrationStore((s) => s.fetchSyncStats);
  const fetchWebhooks = useIntegrationStore((s) => s.fetchWebhooks);
  const clearError = useIntegrationStore((s) => s.clearError);

  // Fetch initial des donnees (separe du callback OAuth pour eviter race condition).
  useEffect(() => {
    fetchConnections();
    fetchSyncStats();
    fetchWebhooks();
  }, [fetchConnections, fetchSyncStats, fetchWebhooks]);

  // Lecon C5 S33: handler OAuth callback isole avec deps correctes.
  // Lit URL params OR sessionStorage (set par main.tsx avant boot React,
  // survit au redirect Intuit -> /dashboard -> /integration?callback=...).
  // Une ref locale `handled` evite double-execution si React strict mode.
  useEffect(() => {
    let cancelled = false;
    const handleCallback = async () => {
      let code: string | null = null;
      let realmId = '';
      let state: string | undefined;

      if (searchParams.get('callback') === 'quickbooks' && searchParams.get('code')) {
        code = searchParams.get('code');
        realmId = searchParams.get('realmId') || '';
        state = searchParams.get('state') || undefined;
        setSearchParams({}, { replace: true });
      }

      if (!code) {
        const stored = sessionStorage.getItem('qb_oauth_callback');
        if (stored) {
          sessionStorage.removeItem('qb_oauth_callback');
          try {
            const parsed = JSON.parse(stored);
            code = parsed.code;
            realmId = parsed.realmId || '';
            state = parsed.state || undefined;
          } catch { /* ignore parse errors */ }
        }
      }

      if (!code || cancelled) return;

      setTab('quickbooks');
      try {
        await quickBooksOAuthCallback({ code, realmId, state });
        if (cancelled) return;
        setOauthMsg({ ok: true, text: 'QuickBooks connecté avec succès !' });
        // Lecon QA1-C1 S33: re-check cancelled apres chaque await
        if (cancelled) return;
        await fetchConnections();
      } catch {
        if (cancelled) return;
        setOauthMsg({ ok: false, text: 'Échec de la connexion QuickBooks. Réessayez.' });
      }
    };

    handleCallback();
    return () => { cancelled = true; };
  }, [searchParams, setSearchParams, fetchConnections]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#323130] dark:text-[#f3f2f1]">
          Intégrations comptables
        </h1>
        <p className="text-sm text-[#605e5c] dark:text-[#a19f9d] mt-0.5">
          QuickBooks Online & Sage 50 — Synchronisation des données
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
          <AlertCircle size={16} />
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="ml-auto text-red-500 hover:text-red-700" aria-label="Fermer">&times;</button>
        </div>
      )}

      {/* OAuth callback message */}
      {oauthMsg && (
        <div className={clsx(
          'flex items-center gap-2 p-3 rounded-lg text-sm',
          oauthMsg.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300',
        )}>
          {oauthMsg.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span className="flex-1">{oauthMsg.text}</span>
          <button onClick={() => setOauthMsg(null)} className="ml-auto opacity-60 hover:opacity-100" aria-label="Fermer">&times;</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-[#edebe9] dark:border-[#3b3a39]" role="tablist">
        {TAB_LABELS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
              tab === t.key
                ? 'border-[#0078D4] text-[#0078D4] dark:text-[#6cb8f6]'
                : 'border-transparent text-[#605e5c] dark:text-[#a19f9d] hover:text-[#323130] dark:hover:text-[#f3f2f1] hover:border-[#c8c6c4]',
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <RefreshCw size={24} className="animate-spin text-[#0078D4]" />
        </div>
      )}

      {!isLoading && tab === 'overview' && (
        <OverviewTab connections={connections} syncStats={syncStats} webhooks={webhooks} />
      )}
      {!isLoading && tab === 'quickbooks' && <ProviderTab provider="quickbooks" connections={connections} />}
      {!isLoading && tab === 'sage50' && <ProviderTab provider="sage50" connections={connections} />}
      {!isLoading && tab === 'webhooks' && <WebhooksTab />}
      {!isLoading && tab === 'mapping' && <MappingTab />}
      {!isLoading && tab === 'history' && <HistoryTab syncLogs={syncLogs} />}
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────
function OverviewTab({
  connections,
  syncStats,
  webhooks,
}: {
  connections: IntegrationConnection[];
  syncStats: SyncStats | null;
  webhooks: WebhookConfig[];
}) {
  const qbConn = connections.find((c) => c.provider === 'quickbooks');
  const sageConn = connections.find((c) => c.provider === 'sage50');
  const activeWebhooks = webhooks.filter((w) => w.active).length;

  const kpis = [
    { label: 'Connexions', value: connections.length, sub: `${connections.filter((c) => c.status === 'connected').length} actives`, color: 'text-blue-600' },
    { label: 'Syncs totales', value: syncStats?.totalSyncs ?? 0, sub: `${syncStats?.errorCount ?? 0} erreurs`, color: 'text-green-600' },
    { label: 'Webhooks actifs', value: activeWebhooks, sub: `${webhooks.length} configurés`, color: 'text-purple-600' },
    { label: 'Dernière sync', value: syncStats?.lastSyncAt ? fmtDate(syncStats.lastSyncAt) : 'Aucune', sub: '', color: 'text-amber-600' },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white dark:bg-[#252423] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] p-4">
            <p className="text-xs text-[#605e5c] dark:text-[#a19f9d] uppercase tracking-wide">{k.label}</p>
            <p className={clsx('text-2xl font-bold mt-1', k.color)}>{k.value}</p>
            {k.sub && <p className="text-xs text-[#a19f9d] mt-0.5">{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* Provider Cards */}
      <div className="grid md:grid-cols-2 gap-4">
        <ProviderCard
          name="QuickBooks Online"
          description="Intégration avec Intuit QuickBooks pour la comptabilité et la facturation."
          connection={qbConn}
          logo="QB"
          color="bg-green-600"
        />
        <ProviderCard
          name="Sage 50 (Simply Accounting)"
          description="Connexion ODBC via Pervasive/Actian pour Sage 50 Canada."
          connection={sageConn}
          logo="S50"
          color="bg-blue-700"
        />
      </div>

      {/* Sync Methods */}
      <div className="bg-white dark:bg-[#252423] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] p-5">
        <h3 className="font-semibold text-[#323130] dark:text-[#f3f2f1] mb-3">Méthodes d'intégration supportées</h3>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { name: 'Zapier', desc: 'Connecteur no-code simple. Idéal pour démarrer.', tag: 'Recommandé' },
            { name: 'n8n', desc: 'Workflow open-source auto-hébergé. Gratuit.', tag: 'Gratuit' },
            { name: 'API directe', desc: 'Intégration Python/REST personnalisée.', tag: 'Avancé' },
          ].map((m) => (
            <div key={m.name} className="p-3 rounded-lg border border-[#edebe9] dark:border-[#3b3a39]">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm text-[#323130] dark:text-[#f3f2f1]">{m.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                  {m.tag}
                </span>
              </div>
              <p className="text-xs text-[#605e5c] dark:text-[#a19f9d]">{m.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tax Info */}
      <div className="bg-white dark:bg-[#252423] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] p-5">
        <h3 className="font-semibold text-[#323130] dark:text-[#f3f2f1] mb-3">Configuration taxes Québec (TPS/TVQ)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#edebe9] dark:border-[#3b3a39]">
                <th className="text-left py-2 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">Taxe</th>
                <th className="text-left py-2 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">Taux</th>
                <th className="text-left py-2 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">Organisme</th>
                <th className="text-left py-2 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">Champ Constructo</th>
                <th className="text-left py-2 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">QuickBooks</th>
              </tr>
            </thead>
            <tbody className="text-[#323130] dark:text-[#c8c6c4]">
              <tr className="border-b border-[#edebe9] dark:border-[#3b3a39]">
                <td className="py-2 px-3 font-medium">TPS</td>
                <td className="py-2 px-3">5 %</td>
                <td className="py-2 px-3">Agence du revenu du Canada</td>
                <td className="py-2 px-3"><code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">tps</code></td>
                <td className="py-2 px-3"><code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">TxnTaxDetail.TaxLine[0]</code></td>
              </tr>
              <tr className="border-b border-[#edebe9] dark:border-[#3b3a39]">
                <td className="py-2 px-3 font-medium">TVQ</td>
                <td className="py-2 px-3">9,975 %</td>
                <td className="py-2 px-3">Revenu Québec</td>
                <td className="py-2 px-3"><code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">tvq</code></td>
                <td className="py-2 px-3"><code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">TxnTaxDetail.TaxLine[1]</code></td>
              </tr>
              <tr>
                <td className="py-2 px-3 font-bold">Combiné</td>
                <td className="py-2 px-3 font-bold">14,975 %</td>
                <td className="py-2 px-3">—</td>
                <td className="py-2 px-3"><code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">montant_ttc</code></td>
                <td className="py-2 px-3"><code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">TotalAmt</code></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[#a19f9d] mt-2">
          Note : La TVQ est calculée sur le montant HT uniquement, pas sur HT + TPS.
        </p>
      </div>
    </div>
  );
}

// ── Provider Card ──────────────────────────────────────────
function ProviderCard({
  name,
  description,
  connection,
  logo,
  color,
}: {
  name: string;
  description: string;
  connection?: IntegrationConnection;
  logo: string;
  color: string;
}) {
  return (
    <div className="bg-white dark:bg-[#252423] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] p-5">
      <div className="flex items-start gap-3">
        <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm', color)}>
          {logo}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-[#323130] dark:text-[#f3f2f1]">{name}</h3>
            <StatusBadge status={connection?.status ?? 'disconnected'} />
          </div>
          <p className="text-xs text-[#605e5c] dark:text-[#a19f9d] mt-1">{description}</p>
          {connection?.lastSyncAt && (
            <p className="text-xs text-[#a19f9d] mt-2">
              Dernière sync : {fmtDate(connection.lastSyncAt)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Provider Tab (QuickBooks / Sage 50) ────────────────────
function ProviderTab({
  provider,
  connections,
}: {
  provider: 'quickbooks' | 'sage50';
  connections: IntegrationConnection[];
}) {
  const providerConns = connections.filter((c) => c.provider === provider);
  const isQB = provider === 'quickbooks';
  const createConnection = useIntegrationStore((s) => s.createConnection);
  const deleteConnection = useIntegrationStore((s) => s.deleteConnection);
  const testConnection = useIntegrationStore((s) => s.testConnection);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Sage 50 form
  const [showSageForm, setShowSageForm] = useState(false);
  const [sageName, setSageName] = useState('');
  const [sageDsn, setSageDsn] = useState('');

  // Lecon M9 S33: ne pas appeler setConnecting(false) sur succes -
  // window.location.href demonte le composant avant que React puisse
  // re-render, mais une double-execution pourrait causer un flash UI.
  // setConnecting(false) reste uniquement dans le catch (echec).
  const handleConnectQuickBooks = async () => {
    if (connecting) return; // guard double-click
    setConnecting(true);
    setTestResult(null);
    try {
      await createConnection({ provider: 'quickbooks', name: 'QuickBooks Online', config: {} });
      const qbConns = useIntegrationStore.getState().connections.filter((c) => c.provider === 'quickbooks');
      const latest = qbConns[0]; // sorted by created_at DESC
      if (!latest) throw new Error('Connexion non créée');
      const { authUrl } = await getQuickBooksAuthUrl(latest.id);
      window.location.href = authUrl;
      // Pas de setConnecting(false) ici - composant va etre demonte
    } catch {
      setTestResult({ success: false, message: 'Impossible de lancer la connexion. Vérifiez que QuickBooks est configuré sur le serveur.' });
      setConnecting(false);
    }
  };

  const handleReconnectQuickBooks = async (connId: number) => {
    if (connecting) return;
    setConnecting(true);
    setTestResult(null);
    try {
      const { authUrl } = await getQuickBooksAuthUrl(connId);
      window.location.href = authUrl;
    } catch {
      setTestResult({ success: false, message: 'Impossible de lancer la connexion OAuth.' });
      setConnecting(false);
    }
  };

  // Lecon M11 S33: bouton "Synchroniser maintenant" pour declencher
  // un sync manuel depuis l'UI. Le store expose deja triggerSync.
  const triggerSyncAction = useIntegrationStore((s) => s.triggerSync);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const handleSyncNow = async (id: number, direction: 'export' | 'import') => {
    setSyncingId(id);
    setTestResult(null);
    try {
      await triggerSyncAction(id, { direction });
      setTestResult({ success: true, message: `Synchronisation ${direction === 'export' ? 'sortante' : 'entrante'} terminée. Consultez l'historique.` });
    } catch {
      setTestResult({ success: false, message: 'Échec de la synchronisation. Voir l\'historique pour les détails.' });
    } finally {
      setSyncingId(null);
    }
  };

  // Sage 50: create with DSN
  const handleCreateSage = async () => {
    try {
      await createConnection({ provider: 'sage50', name: sageName || 'Sage 50', config: { dsn: sageDsn } });
      setShowSageForm(false);
      setSageName('');
      setSageDsn('');
    } catch {
      // error in store
    }
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    try {
      const res = await testConnection(id);
      setTestResult(res);
    } catch {
      setTestResult({ success: false, message: 'Erreur de test' });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = (id: number) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer cette connexion ?')) return;
    deleteConnection(id);
  };

  const inputCls = "w-full px-3 py-2 text-sm border border-[#c8c6c4] dark:border-[#605e5c] rounded-lg bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:outline-none focus:border-[#0078D4]";

  return (
    <div className="space-y-4">
      {/* Header */}
      <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">
        {isQB ? 'QuickBooks Online' : 'Sage 50 (Simply Accounting)'}
      </h2>

      {/* QuickBooks: simple explanation + one big button */}
      {isQB && (
        <div className="bg-white dark:bg-[#252423] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-green-600 flex items-center justify-center text-white font-bold text-lg shrink-0">QB</div>
            <div className="flex-1">
              <h3 className="font-semibold text-[#323130] dark:text-[#f3f2f1]">Connectez votre compte QuickBooks</h3>
              <p className="text-sm text-[#605e5c] dark:text-[#a19f9d] mt-1">
                Synchronisez vos factures, clients et paiements entre Constructo AI et QuickBooks Online.
                La connexion est sécurisée via OAuth 2.0 — vos identifiants QuickBooks ne sont jamais partagés.
              </p>
              {providerConns.length === 0 && (
                <button
                  onClick={handleConnectQuickBooks}
                  disabled={connecting}
                  className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {connecting ? <RefreshCw size={16} className="animate-spin" /> : <ExternalLink size={16} />}
                  Connecter QuickBooks
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sage 50: explanation + add form */}
      {!isQB && (
        <div className="bg-white dark:bg-[#252423] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-700 flex items-center justify-center text-white font-bold text-sm shrink-0">S50</div>
            <div className="flex-1">
              <h3 className="font-semibold text-[#323130] dark:text-[#f3f2f1]">Connectez Sage 50</h3>
              <p className="text-sm text-[#605e5c] dark:text-[#a19f9d] mt-1">
                Connectez Sage 50 (Simply Accounting) via ODBC. Votre technicien informatique doit
                d'abord configurer un DSN sur le poste où Sage 50 est installé.
              </p>
              {providerConns.length === 0 && !showSageForm && (
                <button
                  onClick={() => setShowSageForm(true)}
                  className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors"
                >
                  <Plus size={16} /> Ajouter une connexion Sage 50
                </button>
              )}
              {showSageForm && (
                <div className="mt-4 space-y-3 max-w-md">
                  <div>
                    <label className="block text-xs text-[#605e5c] dark:text-[#a19f9d] mb-1">Nom (optionnel)</label>
                    <input type="text" value={sageName} onChange={(e) => setSageName(e.target.value)} placeholder="Ex: Sage 50 Bureau" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-[#605e5c] dark:text-[#a19f9d] mb-1">DSN (Data Source Name)</label>
                    <input type="text" value={sageDsn} onChange={(e) => setSageDsn(e.target.value)} placeholder="Ex: Sage50_MonEntreprise" className={inputCls} />
                    <p className="text-[11px] text-[#a19f9d] mt-1">Le nom exact du DSN configuré dans les sources de données ODBC Windows.</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleCreateSage} disabled={!sageDsn} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50">
                      <Link2 size={14} /> Connecter
                    </button>
                    <button onClick={() => setShowSageForm(false)} className="px-4 py-2 text-sm text-[#605e5c] hover:text-[#323130]">Annuler</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Test result */}
      {testResult && (
        <div className={clsx(
          'flex items-center gap-2 p-3 rounded-lg text-sm',
          testResult.success ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300',
        )}>
          {testResult.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span className="flex-1">{testResult.message}</span>
          <button onClick={() => setTestResult(null)} className="opacity-60 hover:opacity-100" aria-label="Fermer">&times;</button>
        </div>
      )}

      {/* Connections list */}
      {providerConns.map((conn) => (
        <div key={conn.id} className="bg-white dark:bg-[#252423] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center text-white text-xs font-bold', isQB ? 'bg-green-600' : 'bg-blue-700')}>
                {isQB ? 'QB' : 'S50'}
              </div>
              <div>
                <span className="font-medium text-sm text-[#323130] dark:text-[#f3f2f1]">{conn.name}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <StatusBadge status={conn.status} />
                  {conn.lastSyncAt && <span className="text-xs text-[#a19f9d]">Sync : {fmtDate(conn.lastSyncAt)}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {isQB && conn.status !== 'connected' && (
                <button
                  onClick={() => handleReconnectQuickBooks(conn.id)}
                  disabled={connecting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {connecting ? <RefreshCw size={12} className="animate-spin" /> : <ExternalLink size={12} />}
                  Reconnecter
                </button>
              )}
              {/* Lecon M11 S33: bouton Sync now visible uniquement si connecte */}
              {isQB && conn.status === 'connected' && (
                <>
                  <button
                    onClick={() => handleSyncNow(conn.id, 'export')}
                    disabled={syncingId === conn.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#0078D4] rounded-lg hover:bg-[#106ebe] disabled:opacity-50"
                    aria-label="Synchroniser vers QuickBooks"
                  >
                    {syncingId === conn.id ? <RefreshCw size={12} className="animate-spin" /> : <ArrowUpRight size={12} />}
                    Sync export
                  </button>
                  <button
                    onClick={() => handleSyncNow(conn.id, 'import')}
                    disabled={syncingId === conn.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0078D4] border border-[#0078D4] rounded-lg hover:bg-[#0078D4]/10 disabled:opacity-50"
                    aria-label="Synchroniser depuis QuickBooks"
                  >
                    {syncingId === conn.id ? <RefreshCw size={12} className="animate-spin" /> : <ArrowDownLeft size={12} />}
                    Sync import
                  </button>
                </>
              )}
              <button onClick={() => handleTest(conn.id)} disabled={testingId === conn.id} className="p-2 rounded text-[#605e5c] hover:bg-[#f3f2f1] dark:hover:bg-[#323130] disabled:opacity-50" aria-label="Tester la connexion">
                {testingId === conn.id ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
              <button onClick={() => handleDelete(conn.id)} className="p-2 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" aria-label="Supprimer">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* What gets synced */}
      <div className="bg-white dark:bg-[#252423] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] p-5">
        <h3 className="font-semibold text-sm text-[#323130] dark:text-[#f3f2f1] mb-3">Données synchronisables</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Clients / Fournisseurs', icon: <ArrowRightLeft size={16} />, dir: 'Bidirectionnel' },
            { label: 'Factures', icon: <ArrowUpRight size={16} />, dir: 'Export' },
            { label: 'Paiements', icon: <ArrowUpRight size={16} />, dir: 'Export' },
            { label: 'Projets', icon: <ArrowUpRight size={16} />, dir: 'Export (métadonnées)' },
          ].map((d) => (
            <div key={d.label} className="p-3 rounded-lg border border-[#edebe9] dark:border-[#3b3a39] text-center">
              <div className="flex justify-center mb-1 text-[#0078D4]">{d.icon}</div>
              <p className="text-xs font-medium text-[#323130] dark:text-[#f3f2f1]">{d.label}</p>
              <p className="text-[10px] text-[#a19f9d] mt-0.5">{d.dir}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Webhooks Tab ──────────────────────────────────────────
function WebhooksTab() {
  const webhooks = useIntegrationStore((s) => s.webhooks);
  // Lecon QA2-R14 S33: scope par webhook id pour eviter fuite de deliveries
  // entre webhooks distincts ouverts simultanement.
  const webhookDeliveriesByWebhookId = useIntegrationStore((s) => s.webhookDeliveriesByWebhookId);
  const createWebhookAction = useIntegrationStore((s) => s.createWebhook);
  const deleteWebhookAction = useIntegrationStore((s) => s.deleteWebhook);
  const testWebhookAction = useIntegrationStore((s) => s.testWebhook);
  const fetchDeliveries = useIntegrationStore((s) => s.fetchWebhookDeliveries);
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  // Lecon M10 S33: loading state pour fetchDeliveries async sans feedback.
  const [loadingDeliveriesId, setLoadingDeliveriesId] = useState<number | null>(null);

  const toggleEvent = (ev: string) => {
    setSelectedEvents((prev) => prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]);
  };

  const handleCreate = async () => {
    try {
      await createWebhookAction({ url, events: selectedEvents, description });
      setShowForm(false);
      setUrl('');
      setDescription('');
      setSelectedEvents([]);
    } catch {
      // error set in store
    }
  };

  const handleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setLoadingDeliveriesId(null); // Lecon QA1-C9 S33: reset spinner au collapse
      return;
    }
    setExpandedId(id);
    setLoadingDeliveriesId(id);
    try {
      // Lecon QA2-R14 S33: le scoping webhookDeliveriesByWebhookId[wh.id]
      // resout naturellement la race (chaque fetch ecrit dans sa propre cle).
      // Plus besoin du check expandedId post-await (qui souffrait de closure stale).
      await fetchDeliveries(id);
    } finally {
      setLoadingDeliveriesId((cur) => (cur === id ? null : cur));
    }
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    try {
      await testWebhookAction(id);
      if (expandedId === id) fetchDeliveries(id);
    } finally {
      setTestingId(null);
    }
  };

  const handleDeleteWebhook = (id: number) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer ce webhook ?')) return;
    deleteWebhookAction(id);
  };

  const grouped = WEBHOOK_EVENTS.reduce<Record<string, typeof WEBHOOK_EVENTS>>((acc, ev) => {
    (acc[ev.category] ??= []).push(ev);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">Webhooks</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#0078D4] rounded-lg hover:bg-[#106ebe]"
        >
          <Plus size={14} /> Nouveau webhook
        </button>
      </div>

      {/* Info */}
      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 text-sm text-blue-800 dark:text-blue-200">
        <p>
          Les webhooks envoient une notification HTTP POST à votre URL chaque fois qu'un événement se produit.
          Utilisez-les avec Zapier, n8n ou votre propre serveur pour synchroniser automatiquement avec QuickBooks ou Sage 50.
        </p>
        <p className="mt-1 text-xs opacity-80">
          Chaque payload est signé avec HMAC-SHA256 pour la vérification d'intégrité.
        </p>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white dark:bg-[#252423] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] p-5 space-y-4">
          <h3 className="font-medium text-sm text-[#323130] dark:text-[#f3f2f1]">Nouveau webhook</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-[#605e5c] dark:text-[#a19f9d] mb-1">URL de destination</label>
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/..." className="w-full px-3 py-2 text-sm border border-[#c8c6c4] dark:border-[#605e5c] rounded-lg bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:outline-none focus:border-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs text-[#605e5c] dark:text-[#a19f9d] mb-1">Description</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Sync factures vers QuickBooks" className="w-full px-3 py-2 text-sm border border-[#c8c6c4] dark:border-[#605e5c] rounded-lg bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:outline-none focus:border-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs text-[#605e5c] dark:text-[#a19f9d] mb-2">Événements</label>
              <div className="space-y-3">
                {Object.entries(grouped).map(([cat, evts]) => (
                  <div key={cat}>
                    <p className="text-xs font-semibold text-[#605e5c] dark:text-[#a19f9d] mb-1">{cat}</p>
                    <div className="flex flex-wrap gap-2">
                      {evts.map((ev) => (
                        <button
                          key={ev.event}
                          onClick={() => toggleEvent(ev.event)}
                          className={clsx(
                            'px-2.5 py-1 text-xs rounded-full border transition-colors',
                            selectedEvents.includes(ev.event)
                              ? 'bg-[#0078D4] text-white border-[#0078D4]'
                              : 'border-[#c8c6c4] dark:border-[#605e5c] text-[#323130] dark:text-[#c8c6c4] hover:border-[#0078D4]',
                          )}
                        >
                          {ev.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={!url} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#0078D4] rounded-lg hover:bg-[#106ebe] disabled:opacity-50">
              <Plus size={14} /> Créer
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-[#605e5c] hover:text-[#323130]">
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {webhooks.length === 0 && !showForm && (
        <div className="text-center py-12 text-[#605e5c] dark:text-[#a19f9d]">
          <Globe size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Aucun webhook configuré</p>
          <p className="text-xs mt-1">Créez un webhook pour déclencher les synchronisations</p>
        </div>
      )}

      {/* Webhooks list */}
      {webhooks.map((wh) => (
        <div key={wh.id} className="bg-white dark:bg-[#252423] rounded-lg border border-[#edebe9] dark:border-[#3b3a39]">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <button onClick={() => handleExpand(wh.id)} className="shrink-0 text-[#605e5c]" aria-label="Détails">
                {expandedId === wh.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[#323130] dark:text-[#f3f2f1] truncate">{wh.description || wh.url}</span>
                  <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', wh.active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400')}>
                    {wh.active ? 'Actif' : 'Inactif'}
                  </span>
                </div>
                <p className="text-xs text-[#a19f9d] truncate mt-0.5">{wh.url}</p>
                {wh.events && wh.events.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {wh.events.map((ev) => (
                      <span key={ev} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[#605e5c] dark:text-[#a19f9d]">{ev}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => handleTest(wh.id)} disabled={testingId === wh.id} className="p-2 rounded text-[#605e5c] hover:bg-[#f3f2f1] dark:hover:bg-[#323130] disabled:opacity-50" aria-label="Tester le webhook">
                {testingId === wh.id ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
              <button onClick={() => handleDeleteWebhook(wh.id)} className="p-2 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" aria-label="Supprimer le webhook">
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {/* Deliveries */}
          {expandedId === wh.id && (
            <div className="border-t border-[#edebe9] dark:border-[#3b3a39] p-4">
              <h4 className="text-xs font-semibold text-[#605e5c] dark:text-[#a19f9d] mb-2">Livraisons récentes</h4>
              {/* Lecon M10 S33: loading state pendant fetchDeliveries async */}
              {loadingDeliveriesId === wh.id ? (
                <p className="flex items-center gap-1.5 text-xs text-[#a19f9d]">
                  <RefreshCw size={12} className="animate-spin" /> Chargement…
                </p>
              ) : (() => {
                // Lecon QA2-R14 S33: lire les deliveries scopees par webhook id.
                // Resout aussi le bug closure stale R10 - plus de risque que
                // les data d'un autre webhook s'affichent ici.
                const deliveries = webhookDeliveriesByWebhookId[wh.id] || [];
                return deliveries.length === 0 ? (
                  <p className="text-xs text-[#a19f9d]">Aucune livraison</p>
                ) : (
                  <div className="space-y-1">
                    {deliveries.slice(0, 10).map((d) => (
                      <div key={d.id} className="flex items-center gap-3 text-xs py-1">
                        {d.success ? <CheckCircle2 size={12} className="text-green-600 shrink-0" /> : <XCircle size={12} className="text-red-500 shrink-0" />}
                        <span className="text-[#323130] dark:text-[#c8c6c4]">{d.eventType}</span>
                        <span className="text-[#a19f9d]">{d.responseStatus ?? '—'}</span>
                        <span className="text-[#a19f9d] ml-auto">{fmtDate(d.deliveredAt)}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      ))}

      {/* Webhook payload example */}
      <div className="bg-white dark:bg-[#252423] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] p-5">
        <h3 className="font-semibold text-sm text-[#323130] dark:text-[#f3f2f1] mb-3">Exemple de payload webhook</h3>
        <WebhookPayloadExample />
      </div>
    </div>
  );
}

function WebhookPayloadExample() {
  const [copied, setCopied] = useState(false);
  const payload = JSON.stringify({
    event: 'invoice.created',
    timestamp: '2026-04-03T10:30:00Z',
    data: {
      id: 123,
      numero: 'FAC-202604-0001',
      client_company_id: 45,
      montant_ht: 1000.00,
      tps: 50.00,
      tvq: 99.75,
      montant_ttc: 1149.75,
      statut: 'BROUILLON',
      date_facture: '2026-04-03',
      date_echeance: '2026-05-03',
    },
  }, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  return (
    <div className="relative">
      <button onClick={handleCopy} className="absolute top-2 right-2 p-1.5 rounded text-[#605e5c] hover:bg-[#f3f2f1] dark:hover:bg-[#323130]" aria-label="Copier le payload">
        {copied ? <CheckCircle2 size={14} className="text-green-600" /> : <Copy size={14} />}
      </button>
      <pre className="text-xs bg-[#f3f2f1] dark:bg-[#1b1a19] rounded-lg p-4 overflow-x-auto text-[#323130] dark:text-[#c8c6c4]">
        {payload}
      </pre>
    </div>
  );
}

// ── Mapping Tab ──────────────────────────────────────────
function MappingTab() {
  const [provider, setProvider] = useState<'quickbooks' | 'sage50'>('quickbooks');
  const [entityFilter, setEntityFilter] = useState('');
  const mappings = provider === 'quickbooks' ? QUICKBOOKS_MAPPINGS : SAGE50_MAPPINGS;
  const entities = [...new Set(mappings.map((m) => m.entityType))];
  const filtered = entityFilter ? mappings.filter((m) => m.entityType === entityFilter) : mappings;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">Correspondance des champs</h2>
        <div className="flex gap-2">
          <select
            value={provider}
            onChange={(e) => { setProvider(e.target.value as 'quickbooks' | 'sage50'); setEntityFilter(''); }}
            className="px-3 py-1.5 text-sm border border-[#c8c6c4] dark:border-[#605e5c] rounded-lg bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]"
            aria-label="Fournisseur"
          >
            <option value="quickbooks">QuickBooks</option>
            <option value="sage50">Sage 50</option>
          </select>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-[#c8c6c4] dark:border-[#605e5c] rounded-lg bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]"
            aria-label="Type d'entité"
          >
            <option value="">Toutes les entités</option>
            {entities.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-[#252423] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f3f2f1] dark:bg-[#323130] border-b border-[#edebe9] dark:border-[#3b3a39]">
                <th className="text-left py-2.5 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">Entité</th>
                <th className="text-left py-2.5 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">Champ Constructo AI</th>
                <th className="text-left py-2.5 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">Champ {provider === 'quickbooks' ? 'QuickBooks' : 'Sage 50'}</th>
                <th className="text-left py-2.5 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">Direction</th>
              </tr>
            </thead>
            <tbody className="text-[#323130] dark:text-[#c8c6c4]">
              {filtered.map((m) => (
                <tr key={`${m.entityType}-${m.constructoField}`} className="border-b border-[#edebe9] dark:border-[#3b3a39] hover:bg-[#faf9f8] dark:hover:bg-[#2b2a29]">
                  <td className="py-2 px-3 text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-[10px] font-medium">{m.entityType}</span>
                  </td>
                  <td className="py-2 px-3"><code className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{m.constructoField}</code></td>
                  <td className="py-2 px-3"><code className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{m.externalField}</code></td>
                  <td className="py-2 px-3">
                    <span className="inline-flex items-center gap-1 text-xs">
                      {m.direction === 'both' && <><ArrowRightLeft size={12} /> Bidirectionnel</>}
                      {m.direction === 'export' && <><ArrowUpRight size={12} /> Export</>}
                      {m.direction === 'import' && <><ArrowDownLeft size={12} /> Import</>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── History Tab ──────────────────────────────────────────
function HistoryTab({ syncLogs }: { syncLogs: SyncLog[] }) {
  const filters = useIntegrationStore((s) => s.filters);
  const setFilter = useIntegrationStore((s) => s.setFilter);
  const totalLogs = useIntegrationStore((s) => s.totalLogs);
  const fetchSyncHistory = useIntegrationStore((s) => s.fetchSyncHistory);

  // Fetch on mount + refetch when individual filter primitives change.
  // Lecon QA1-R5 S33: perPage dans les deps sinon changement page-size ne refresh pas.
  const { provider, status, entityType, page, perPage } = filters;
  useEffect(() => {
    fetchSyncHistory();
  }, [provider, status, entityType, page, perPage, fetchSyncHistory]);

  // Lecon H7 S33: pagination explicite. Sans cap, le DOM explose a 1000+ logs.
  const totalPages = Math.max(1, Math.ceil(totalLogs / perPage));
  const fromIndex = totalLogs === 0 ? 0 : (page - 1) * perPage + 1;
  const toIndex = Math.min(page * perPage, totalLogs);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">Historique de synchronisation</h2>
        <span className="text-sm text-[#a19f9d]">{totalLogs} entrée{totalLogs !== 1 ? 's' : ''}</span>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <select value={filters.provider} onChange={(e) => setFilter('provider', e.target.value)} className="px-3 py-1.5 text-sm border border-[#c8c6c4] dark:border-[#605e5c] rounded-lg bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]" aria-label="Fournisseur">
          <option value="">Tous les fournisseurs</option>
          <option value="quickbooks">QuickBooks</option>
          <option value="sage50">Sage 50</option>
        </select>
        <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className="px-3 py-1.5 text-sm border border-[#c8c6c4] dark:border-[#605e5c] rounded-lg bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]" aria-label="Statut">
          <option value="">Tous les statuts</option>
          <option value="success">Succès</option>
          <option value="error">Erreur</option>
          <option value="pending">En attente</option>
          <option value="skipped">Ignoré</option>
        </select>
        <select value={filters.entityType} onChange={(e) => setFilter('entityType', e.target.value)} className="px-3 py-1.5 text-sm border border-[#c8c6c4] dark:border-[#605e5c] rounded-lg bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]" aria-label="Type d'entité">
          <option value="">Toutes les entités</option>
          <option value="facture">Factures</option>
          <option value="entreprise">Entreprises</option>
          <option value="paiement">Paiements</option>
          <option value="projet">Projets</option>
        </select>
      </div>

      {/* Table */}
      {syncLogs.length === 0 ? (
        <div className="text-center py-12 text-[#605e5c] dark:text-[#a19f9d]">
          <Clock size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Aucun historique de synchronisation</p>
          <p className="text-xs mt-1">Les synchronisations apparaitront ici une fois configurées</p>
        </div>
      ) : (
        <>
          <div className="bg-white dark:bg-[#252423] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#f3f2f1] dark:bg-[#323130] border-b border-[#edebe9] dark:border-[#3b3a39]">
                    <th className="text-left py-2.5 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">Date</th>
                    <th className="text-left py-2.5 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">Fournisseur</th>
                    <th className="text-left py-2.5 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">Direction</th>
                    <th className="text-left py-2.5 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">Entité</th>
                    <th className="text-left py-2.5 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">Statut</th>
                    <th className="text-left py-2.5 px-3 font-medium text-[#605e5c] dark:text-[#a19f9d]">Détails</th>
                  </tr>
                </thead>
                <tbody className="text-[#323130] dark:text-[#c8c6c4]">
                  {syncLogs.map((log) => (
                    <tr key={log.id} className="border-b border-[#edebe9] dark:border-[#3b3a39] hover:bg-[#faf9f8] dark:hover:bg-[#2b2a29]">
                      <td className="py-2 px-3 text-xs">{fmtDate(log.createdAt)}</td>
                      <td className="py-2 px-3 text-xs capitalize">{log.provider}</td>
                      <td className="py-2 px-3">
                        <span className="inline-flex items-center gap-1 text-xs">
                          {log.direction === 'export' ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
                          {log.direction === 'export' ? 'Export' : 'Import'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs capitalize">{log.entityType}</td>
                      <td className="py-2 px-3"><StatusBadge status={log.status} /></td>
                      <td className="py-2 px-3 text-xs text-[#605e5c] dark:text-[#a19f9d] max-w-[200px] truncate">
                        {log.errorMessage || log.details || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Lecon H7 S33: pagination explicite */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-[#605e5c] dark:text-[#a19f9d]">
              {fromIndex}–{toIndex} sur {totalLogs}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setFilter('page', Math.max(1, page - 1))}
                className="px-2.5 py-1 text-xs border border-[#c8c6c4] dark:border-[#605e5c] rounded text-[#323130] dark:text-[#c8c6c4] disabled:opacity-40 hover:bg-[#f3f2f1] dark:hover:bg-[#3b3a39]"
              >
                Précédent
              </button>
              <span className="text-xs text-[#605e5c] dark:text-[#a19f9d]">
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setFilter('page', Math.min(totalPages, page + 1))}
                className="px-2.5 py-1 text-xs border border-[#c8c6c4] dark:border-[#605e5c] rounded text-[#323130] dark:text-[#c8c6c4] disabled:opacity-40 hover:bg-[#f3f2f1] dark:hover:bg-[#3b3a39]"
              >
                Suivant
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
