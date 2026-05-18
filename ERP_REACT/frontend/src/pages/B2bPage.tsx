/**
 * ERP React - B2B / C2B Portal Page
 * 8 Tabs: Tableau de bord, Clients, Demandes, Soumissions, Contrats, Commandes, Messages, Catalogue
 * Ported from Streamlit b2b_admin.py + b2b_boutique.py + c2b_categories.py
 */
import { useEffect, useState, useRef } from 'react';
import {
  LayoutDashboard, Building2, FileText, Send, Handshake, Package,
  MessageSquare, ShoppingCart, Plus, Search, Check, X, ChevronRight,
  TrendingUp, Users, Clock, Trash2, Pencil, UserPlus, CheckCircle2, XCircle,
} from 'lucide-react';
import { useB2bStore } from '@/store/useB2bStore';
import type {
  B2bClientCreate, B2bDemandeCreate, B2bSoumissionCreate, B2bContratUpdate,
} from '@/api/b2b';
import {
  listClientUsers, approveClientUser, rejectClientUser,
  type B2bClientUserPending,
} from '@/api/b2b';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import type { BadgeColor } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { CommandBar } from '@/components/ui/CommandBar';
import { formatDate, formatCurrency } from '@/utils/format';

const TABS = ['dashboard', 'acces', 'clients', 'demandes', 'soumissions', 'contrats', 'commandes', 'messages', 'catalogue'] as const;
type TabKey = typeof TABS[number];

const TAB_LABELS: Record<TabKey, string> = {
  dashboard: 'Tableau de bord',
  acces: 'Demandes d\'acces',
  clients: 'Clients',
  demandes: 'Demandes',
  soumissions: 'Soumissions',
  contrats: 'Contrats',
  commandes: 'Commandes',
  messages: 'Messages',
  catalogue: 'Catalogue',
};

const TAB_ICONS: Record<TabKey, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  acces: UserPlus,
  clients: Building2,
  demandes: FileText,
  soumissions: Send,
  contrats: Handshake,
  commandes: Package,
  messages: MessageSquare,
  catalogue: ShoppingCart,
};

const DEMANDE_STATUT_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'NOUVELLE', label: 'Nouvelle' },
  { value: 'EN_COURS', label: 'En cours' },
  { value: 'SOUMISE', label: 'Soumise' },
  { value: 'ACCEPTEE', label: 'Acceptée' },
  { value: 'REFUSEE', label: 'Refusée' },
  { value: 'ANNULEE', label: 'Annulée' },
];

const DEMANDE_COLORS: Record<string, BadgeColor> = {
  NOUVELLE: 'blue', EN_COURS: 'yellow', SOUMISE: 'purple',
  ACCEPTEE: 'green', REFUSEE: 'red', ANNULEE: 'gray',
};

const SOUMISSION_COLORS: Record<string, BadgeColor> = {
  BROUILLON: 'gray', SOUMISE: 'blue', EN_EVALUATION: 'yellow',
  ACCEPTEE: 'green', REFUSEE: 'red', EXPIREE: 'gray',
};

const CONTRAT_COLORS: Record<string, BadgeColor> = {
  BROUILLON: 'gray', ACTIF: 'green', EN_COURS: 'blue',
  TERMINE: 'purple', ANNULE: 'red', SUSPENDU: 'yellow',
};

const COMMANDE_COLORS: Record<string, BadgeColor> = {
  EN_ATTENTE: 'yellow', CONFIRMEE: 'blue', EN_PREPARATION: 'purple',
  EXPEDIEE: 'blue', LIVREE: 'green', ANNULEE: 'red',
};

const PRIORITE_OPTIONS = [
  { value: 'faible', label: 'Faible' },
  { value: 'normale', label: 'Normale' },
  { value: 'elevee', label: 'Elevee' },
  { value: 'urgente', label: 'Urgente' },
];

export default function B2bPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const { error, clearError } = useB2bStore();

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={clearError}>{error}</Alert>}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Portail B2B / C2B</h2>
      </div>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => {
          const Icon = TAB_ICONS[tab];
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-2 md:px-3 py-2 md:py-2.5 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
              }`}
            >
              <Icon size={15} />
              <span className="hidden sm:inline">{TAB_LABELS[tab]}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'dashboard' && <DashboardTab />}
      {activeTab === 'acces' && <AccesTab />}
      {activeTab === 'clients' && <ClientsTab />}
      {activeTab === 'demandes' && <DemandesTab />}
      {activeTab === 'soumissions' && <SoumissionsTab />}
      {activeTab === 'contrats' && <ContratsTab />}
      {activeTab === 'commandes' && <CommandesTab />}
      {activeTab === 'messages' && <MessagesTab />}
      {activeTab === 'catalogue' && <CatalogueTab />}
    </div>
  );
}


// ============ Acces Tab (Demandes d'inscription B2B) ============

function AccesTab() {
  const [pending, setPending] = useState<B2bClientUserPending[]>([]);
  const [approved, setApproved] = useState<B2bClientUserPending[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);
  const [view, setView] = useState<'pending' | 'approved'>('pending');

  const fetchPending = async () => {
    setLoading(true);
    setError(null);
    try {
      const [pendingRes, approvedRes] = await Promise.all([
        listClientUsers({ active: false }),
        listClientUsers({ active: true }),
      ]);
      setPending(pendingRes.items ?? []);
      setApproved(approvedRes.items ?? []);
    } catch (err) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
        : null;
      setError(msg || 'Erreur chargement demandes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPending(); }, []);

  const handleApprove = async (u: B2bClientUserPending) => {
    if (!window.confirm(`Approuver la demande de ${u.nom || u.email} (${u.clientNom})?`)) return;
    setActionId(u.id);
    setError(null);
    setSuccess(null);
    try {
      const res = await approveClientUser(u.id);
      setSuccess(res.message);
      await fetchPending();
    } catch (err) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
        : null;
      setError(msg || 'Erreur approbation');
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (u: B2bClientUserPending) => {
    if (!window.confirm(`Rejeter et supprimer la demande de ${u.nom || u.email}?\n\nLa demande sera supprimee definitivement.`)) return;
    setActionId(u.id);
    setError(null);
    setSuccess(null);
    try {
      const res = await rejectClientUser(u.id);
      setSuccess(res.message);
      await fetchPending();
    } catch (err) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
        : null;
      setError(msg || 'Erreur rejet');
    } finally {
      setActionId(null);
    }
  };

  const list = view === 'pending' ? pending : approved;

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert type="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <UserPlus size={20} className="text-blue-600" />
              Demandes d'acces client B2B
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Approuvez ou rejetez les demandes d'inscription des clients au portail B2B.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={fetchPending} disabled={loading}>
            {loading ? <Spinner size="sm" /> : 'Actualiser'}
          </Button>
        </div>

        {/* Sub-tabs pending / approved */}
        <div className="flex gap-2 mb-4 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setView('pending')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              view === 'pending'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            En attente ({pending.length})
          </button>
          <button
            onClick={() => setView('approved')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              view === 'approved'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Approuves ({approved.length})
          </button>
        </div>

        {loading && list.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Spinner size="md" />
          </div>
        ) : list.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <UserPlus size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {view === 'pending'
                ? 'Aucune demande en attente d\'approbation'
                : 'Aucun client approuve pour le moment'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 dark:border-gray-700">
                <tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="py-2 px-3">Entreprise</th>
                  <th className="py-2 px-3">Contact</th>
                  <th className="py-2 px-3">Email</th>
                  <th className="py-2 px-3">Telephone</th>
                  <th className="py-2 px-3">Ville</th>
                  <th className="py-2 px-3">Date demande</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="py-2 px-3 font-medium text-gray-900 dark:text-white">
                      {u.clientNom}
                    </td>
                    <td className="py-2 px-3">{u.nom || '-'}</td>
                    <td className="py-2 px-3 text-gray-600">{u.email}</td>
                    <td className="py-2 px-3 text-gray-600">{u.telephone || u.clientTelephone || '-'}</td>
                    <td className="py-2 px-3 text-gray-600">{u.clientVille || '-'}</td>
                    <td className="py-2 px-3 text-gray-500 text-xs">{formatDate(u.createdAt)}</td>
                    <td className="py-2 px-3 text-right">
                      {view === 'pending' ? (
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleApprove(u)}
                            disabled={actionId === u.id}
                          >
                            {actionId === u.id ? <Spinner size="sm" /> : (
                              <>
                                <CheckCircle2 size={14} /> Approuver
                              </>
                            )}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleReject(u)}
                            disabled={actionId === u.id}
                          >
                            <XCircle size={14} /> Rejeter
                          </Button>
                        </div>
                      ) : (
                        <Badge color="green">Actif</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}


// ============ Dashboard Tab ============

function DashboardTab() {
  const { stats, fetchStats, isLoading } = useB2bStore();

  useEffect(() => { fetchStats(); }, [fetchStats]);

  if (isLoading && !stats) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
  if (!stats) return <p className="text-gray-400 text-center py-8">Aucune donnée B2B</p>;

  const kpis = [
    { label: 'Clients actifs', value: stats.clientsActifs, icon: Users, color: 'text-blue-600' },
    { label: 'Demandes nouvelles', value: stats.demandesNouvelles, icon: FileText, color: 'text-yellow-600' },
    { label: 'Contrats actifs', value: stats.contratsActifs, icon: Handshake, color: 'text-green-600' },
    { label: 'Valeur contrats', value: formatCurrency(stats.contratsValeur), icon: TrendingUp, color: 'text-purple-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} padding="sm">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-gray-50 dark:bg-gray-800 ${kpi.color}`}>
                <kpi.icon size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{kpi.value}</p>
                <p className="text-xs text-gray-500">{kpi.label}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Demandes par statut</h3>
          <div className="space-y-2">
            {stats.demandesParStatut.map((s) => (
              <div key={s.statut} className="flex items-center justify-between">
                <Badge color={DEMANDE_COLORS[s.statut] || 'gray'} size="sm">{s.statut}</Badge>
                <span className="text-sm font-medium text-gray-900 dark:text-white">{s.c}</span>
              </div>
            ))}
            {stats.demandesParStatut.length === 0 && <p className="text-xs text-gray-400">Aucune demande</p>}
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Résumé</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Total clients</span><span className="font-medium">{stats.clientsTotal}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Total demandes</span><span className="font-medium">{stats.demandesTotal}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Soumissions</span><span className="font-medium">{stats.soumissionsTotal}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Soumissions acceptees</span><span className="font-medium text-green-600">{stats.soumissionsAcceptees}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Commandes en attente</span><span className="font-medium text-yellow-600">{stats.commandesEnAttente}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Messages non lus</span><span className="font-medium text-blue-600">{stats.messagesNonLus}</span></div>
          </div>
        </Card>
      </div>

      {stats.activiteRecente.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Activite recente</h3>
          <div className="space-y-2">
            {stats.activiteRecente.map((a, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-gray-400" />
                  <span className="text-gray-700 dark:text-gray-300">{a.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={DEMANDE_COLORS[a.statut] || 'gray'} size="sm">{a.statut}</Badge>
                  <span className="text-xs text-gray-400">{formatDate(a.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}


// ============ Clients Tab ============

function ClientsTab() {
  const { clients, fetchClients, createClient, deactivateClient, isLoading } = useB2bStore();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<B2bClientCreate>({ nom: '' });

  useEffect(() => { fetchClients({ search: search || undefined }); }, [fetchClients, search]);

  const handleCreate = async () => {
    if (!form.nom.trim()) return;
    try {
      await createClient(form);
      setShowCreate(false);
      setForm({ nom: '' });
    } catch { /* error in store */ }
  };

  return (
    <div className="space-y-4">
      <CommandBar
        actions={[
          { label: 'Nouveau client', icon: <Plus size={16} />, onClick: () => setShowCreate(true), variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
          </div>
        }
      />

      {isLoading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <Card padding="sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Contact</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Telephone</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Ville</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase w-16">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {clients.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{c.nom}</td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{c.contactNom || '--'}</td>
                    <td className="px-4 py-3 text-gray-500">{c.email || '--'}</td>
                    <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">{c.telephone || '--'}</td>
                    <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">{c.ville || '--'}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge color={c.active !== false ? 'green' : 'gray'} size="sm">{c.active !== false ? 'Actif' : 'Inactif'}</Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {c.active !== false && (
                        <button type="button" onClick={() => { if (window.confirm('Desactiver ce client?')) deactivateClient(c.id); }}
                          className="p-1 text-gray-400 hover:text-red-500" title="Desactiver">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucun client B2B</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nouveau client B2B">
        <div className="space-y-4">
          <Input label="Nom entreprise *" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required />
          <Input label="Nom contact" value={form.contactNom || ''} onChange={(e) => setForm({ ...form, contactNom: e.target.value })} />
          <Input label="Email" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Téléphone" value={form.telephone || ''} onChange={(e) => setForm({ ...form, telephone: e.target.value })} />
            <Input label="Ville" value={form.ville || ''} onChange={(e) => setForm({ ...form, ville: e.target.value })} />
          </div>
          <Input label="Secteur" value={form.secteur || ''} onChange={(e) => setForm({ ...form, secteur: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={!form.nom.trim()}>Créer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}


// ============ Demandes Tab ============

function DemandesTab() {
  const { demandes, currentDemande, fetchDemandes, fetchDemande, createDemande, createSoumission, clearCurrentDemande, clients, fetchClients, isLoading } = useB2bStore();
  const [statutFilter, setStatutFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showSoumission, setShowSoumission] = useState(false);
  const [form, setForm] = useState<B2bDemandeCreate>({ clientId: 0, titre: '' });
  const [soumForm, setSoumForm] = useState<B2bSoumissionCreate>({ demandeId: 0, montantHt: 0 });

  useEffect(() => { fetchDemandes({ statut: statutFilter || undefined }); }, [fetchDemandes, statutFilter]);
  const clientsFetched = useRef(false);
  useEffect(() => { if (!clientsFetched.current) { clientsFetched.current = true; fetchClients(); } }, [fetchClients]);

  const handleCreate = async () => {
    if (!form.titre.trim() || !form.clientId) return;
    try {
      await createDemande(form);
      setShowCreate(false);
      setForm({ clientId: 0, titre: '' });
    } catch { /* error in store */ }
  };

  const handleSoumission = async () => {
    if (!currentDemande || !soumForm.montantHt) return;
    const demandeId = currentDemande.id;
    try {
      await createSoumission({ ...soumForm, demandeId });
      setShowSoumission(false);
      setSoumForm({ demandeId: 0, montantHt: 0 });
      await fetchDemande(demandeId);
    } catch { /* error in store */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="w-48">
          <Select options={DEMANDE_STATUT_OPTIONS} value={statutFilter} onChange={(e) => setStatutFilter(e.target.value)} />
        </div>
        <Button leftIcon={<Plus size={16} />} onClick={() => setShowCreate(true)}>Nouvelle demande</Button>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className={`flex-1 ${currentDemande ? 'lg:max-w-[60%]' : ''}`}>
          {isLoading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
            <Card padding="sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Titre</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Client</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Budget</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Date</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {demandes.map((d) => (
                      <tr key={d.id} onClick={() => fetchDemande(d.id)}
                        className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 ${currentDemande?.id === d.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                        <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-white">{d.titre}</td>
                        <td className="px-3 py-2.5 text-gray-500 hidden md:table-cell">{d.clientNom || '--'}</td>
                        <td className="px-3 py-2.5 text-right text-gray-500 hidden lg:table-cell">{d.budgetEstime ? formatCurrency(d.budgetEstime) : '--'}</td>
                        <td className="px-3 py-2.5 text-center"><Badge color={DEMANDE_COLORS[d.statut] || 'gray'} size="sm">{d.statut}</Badge></td>
                        <td className="px-3 py-2.5 text-gray-400 text-xs hidden md:table-cell">{formatDate(d.createdAt)}</td>
                      </tr>
                    ))}
                    {demandes.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Aucune demande</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        {currentDemande && (
          <div className="w-full lg:w-[40%] lg:min-w-[320px]">
            <Card>
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{currentDemande.titre}</h3>
                <button type="button" onClick={clearCurrentDemande} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>
              <div className="space-y-2 text-sm">
                <Badge color={DEMANDE_COLORS[currentDemande.statut] || 'gray'}>{currentDemande.statut}</Badge>
                {currentDemande.clientNom && <p className="text-gray-600 dark:text-gray-400">Client: <strong>{currentDemande.clientNom}</strong></p>}
                {currentDemande.categorie && <p className="text-gray-600 dark:text-gray-400">Catégorie: {currentDemande.categorie}</p>}
                {currentDemande.budgetEstime != null && <p className="text-gray-600 dark:text-gray-400">Budget: {formatCurrency(currentDemande.budgetEstime)}</p>}
                {currentDemande.priorite && <p className="text-gray-600 dark:text-gray-400">Priorité: {currentDemande.priorite}</p>}
                {currentDemande.adresseChantier && <p className="text-gray-500 text-xs">Chantier: {currentDemande.adresseChantier}{currentDemande.villeChantier ? `, ${currentDemande.villeChantier}` : ''}</p>}
                {currentDemande.description && <p className="text-gray-500 text-xs mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded">{currentDemande.description}</p>}

                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => { setSoumForm({ demandeId: currentDemande.id, montantHt: 0 }); setShowSoumission(true); }}>Créer soumission</Button>
                </div>

                {currentDemande.soumissions && currentDemande.soumissions.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Soumissions ({currentDemande.soumissions.length})</h4>
                    {currentDemande.soumissions.map((s) => (
                      <div key={s.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                        <div>
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{s.montantTotal != null ? formatCurrency(s.montantTotal) : '--'}</span>
                          {s.delaiExecutionJours && <span className="text-xs text-gray-400 ml-2">{s.delaiExecutionJours}j</span>}
                        </div>
                        <Badge color={SOUMISSION_COLORS[s.statut] || 'gray'} size="sm">{s.statut}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nouvelle demande B2B">
        <div className="space-y-4">
          <Select label="Client *" options={[{ value: '', label: 'Sélectionner...' }, ...clients.map(c => ({ value: String(c.id), label: c.nom }))]}
            value={String(form.clientId || '')} onChange={(e) => setForm({ ...form, clientId: parseInt(e.target.value) || 0 })} />
          <Input label="Titre *" value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} required />
          <Textarea label="Description" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Catégorie" value={form.categorie || ''} onChange={(e) => setForm({ ...form, categorie: e.target.value })} />
            <Input label="Budget estimé" type="number" value={form.budgetEstime ?? ''} onChange={(e) => setForm({ ...form, budgetEstime: parseFloat(e.target.value) || undefined })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Date limite" type="date" value={form.dateLimite || ''} onChange={(e) => setForm({ ...form, dateLimite: e.target.value })} />
            <Select label="Priorité" options={PRIORITE_OPTIONS} value={form.priorite || 'normale'} onChange={(e) => setForm({ ...form, priorite: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Adresse chantier" value={form.adresseChantier || ''} onChange={(e) => setForm({ ...form, adresseChantier: e.target.value })} />
            <Input label="Ville chantier" value={form.villeChantier || ''} onChange={(e) => setForm({ ...form, villeChantier: e.target.value })} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={!form.titre.trim() || !form.clientId}>Créer</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showSoumission} onClose={() => setShowSoumission(false)} title="Créer soumission">
        <div className="space-y-4">
          <Input label="Montant HT *" type="number" value={soumForm.montantHt || ''} onChange={(e) => setSoumForm({ ...soumForm, montantHt: parseFloat(e.target.value) || 0 })} required />
          <Textarea label="Description" value={soumForm.description || ''} onChange={(e) => setSoumForm({ ...soumForm, description: e.target.value })} rows={3} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Délai (jours)" type="number" value={soumForm.delaiExecutionJours ?? ''} onChange={(e) => setSoumForm({ ...soumForm, delaiExecutionJours: parseInt(e.target.value) || undefined })} />
            <Input label="Validite (jours)" type="number" value={soumForm.validiteJours ?? 30} onChange={(e) => setSoumForm({ ...soumForm, validiteJours: parseInt(e.target.value) || 30 })} />
          </div>
          <Input label="Conditions paiement" value={soumForm.conditionsPaiement || ''} onChange={(e) => setSoumForm({ ...soumForm, conditionsPaiement: e.target.value })} />
          <Textarea label="Garanties" value={soumForm.garanties || ''} onChange={(e) => setSoumForm({ ...soumForm, garanties: e.target.value })} rows={2} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowSoumission(false)}>Annuler</Button>
            <Button onClick={handleSoumission} disabled={!soumForm.montantHt}>Soumettre</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}


// ============ Soumissions Tab ============

function SoumissionsTab() {
  const { soumissions, fetchSoumissions, acceptSoumission, refuseSoumission, isLoading } = useB2bStore();
  const [statutFilter, setStatutFilter] = useState('');

  useEffect(() => { fetchSoumissions({ statut: statutFilter || undefined }); }, [fetchSoumissions, statutFilter]);

  const SOUMISSION_STATUT_OPTIONS = [
    { value: '', label: 'Tous' },
    { value: 'BROUILLON', label: 'Brouillon' },
    { value: 'SOUMISE', label: 'Soumise' },
    { value: 'EN_EVALUATION', label: 'En évaluation' },
    { value: 'ACCEPTEE', label: 'Acceptée' },
    { value: 'REFUSEE', label: 'Refusée' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="w-48">
          <Select options={SOUMISSION_STATUT_OPTIONS} value={statutFilter} onChange={(e) => setStatutFilter(e.target.value)} />
        </div>
      </div>

      {isLoading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <Card padding="sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Demande</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Client</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Montant</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Delai</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {soumissions.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-white">{s.demandeTitre || `Demande #${s.demandeId}`}</td>
                    <td className="px-3 py-2.5 text-gray-500 hidden md:table-cell">{s.clientNom || '--'}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-gray-900 dark:text-white">{s.montantTotal != null ? formatCurrency(s.montantTotal) : '--'}</td>
                    <td className="px-3 py-2.5 text-center text-gray-500 hidden md:table-cell">{s.delaiExecutionJours ? `${s.delaiExecutionJours}j` : '--'}</td>
                    <td className="px-3 py-2.5 text-center"><Badge color={SOUMISSION_COLORS[s.statut] || 'gray'} size="sm">{s.statut}</Badge></td>
                    <td className="px-3 py-2.5 text-center">
                      {s.statut !== 'ACCEPTEE' && s.statut !== 'REFUSEE' && s.statut !== 'EXPIREE' && (
                        <div className="flex justify-center gap-1">
                          <button type="button" onClick={() => { if (window.confirm('Accepter cette soumission?')) acceptSoumission(s.id); }}
                            className="p-1 text-green-500 hover:text-green-700" title="Accepter"><Check size={16} /></button>
                          <button type="button" onClick={() => { if (window.confirm('Refuser cette soumission?')) refuseSoumission(s.id); }}
                            className="p-1 text-red-500 hover:text-red-700" title="Refuser"><X size={16} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {soumissions.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucune soumission</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}


// ============ Contrats Tab ============

function ContratsTab() {
  const { contrats, currentContrat, fetchContrats, fetchContrat, updateContrat, isLoading, clearCurrentContrat } = useB2bStore();
  const [statutFilter, setStatutFilter] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<B2bContratUpdate>({});

  useEffect(() => { fetchContrats({ statut: statutFilter || undefined }); }, [fetchContrats, statutFilter]);

  const CONTRAT_STATUT_OPTIONS = [
    { value: '', label: 'Tous' },
    { value: 'BROUILLON', label: 'Brouillon' },
    { value: 'ACTIF', label: 'Actif' },
    { value: 'TERMINE', label: 'Termine' },
    { value: 'ANNULE', label: 'Annule' },
  ];

  const handleEdit = async (ct: typeof contrats[0]) => {
    await fetchContrat(ct.id);
    const full = useB2bStore.getState().currentContrat;
    setEditForm({
      avancementPourcentage: full?.avancementPourcentage ?? ct.avancementPourcentage ?? 0,
      statut: full?.statut || ct.statut,
      montantPaye: full?.montantPaye,
      notesInternes: full?.notesInternes || '',
    });
    setShowEdit(true);
  };

  const handleSaveEdit = async () => {
    if (!currentContrat) return;
    try {
      await updateContrat(currentContrat.id, editForm);
      setShowEdit(false);
    } catch { /* error in store */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="w-48">
          <Select options={CONTRAT_STATUT_OPTIONS} value={statutFilter} onChange={(e) => setStatutFilter(e.target.value)} />
        </div>
      </div>

      {isLoading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <Card padding="sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Numéro</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Titre</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Client</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Montant</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Avancement</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase w-16">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {contrats.map((ct) => (
                  <tr key={ct.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-3 py-2.5 text-xs text-gray-500 font-mono">{ct.numeroContrat || '--'}</td>
                    <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-white">{ct.titre || `Contrat #${ct.id}`}</td>
                    <td className="px-3 py-2.5 text-gray-500 hidden md:table-cell">{ct.clientNom || '--'}</td>
                    <td className="px-3 py-2.5 text-right text-gray-500">{ct.montant != null ? formatCurrency(ct.montant) : '--'}</td>
                    <td className="px-3 py-2.5 text-center hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${ct.avancementPourcentage || 0}%` }} />
                        </div>
                        <span className="text-xs text-gray-500">{ct.avancementPourcentage || 0}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center"><Badge color={CONTRAT_COLORS[ct.statut] || 'gray'} size="sm">{ct.statut}</Badge></td>
                    <td className="px-3 py-2.5 text-center">
                      <button type="button" onClick={() => handleEdit(ct)} className="p-1 text-gray-400 hover:text-blue-500" title="Modifier"><Pencil size={14} /></button>
                    </td>
                  </tr>
                ))}
                {contrats.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucun contrat B2B</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal isOpen={showEdit} onClose={() => { setShowEdit(false); clearCurrentContrat(); }} title="Modifier contrat">
        <div className="space-y-4">
          <Select label="Statut" options={CONTRAT_STATUT_OPTIONS.slice(1)} value={editForm.statut || ''}
            onChange={(e) => setEditForm({ ...editForm, statut: e.target.value })} />
          <Input label="Avancement (%)" type="number" value={editForm.avancementPourcentage ?? 0}
            onChange={(e) => setEditForm({ ...editForm, avancementPourcentage: parseFloat(e.target.value) || 0 })} />
          <Input label="Montant paye" type="number" value={editForm.montantPaye ?? ''}
            onChange={(e) => setEditForm({ ...editForm, montantPaye: parseFloat(e.target.value) || undefined })} />
          <Textarea label="Notes internes" value={editForm.notesInternes || ''}
            onChange={(e) => setEditForm({ ...editForm, notesInternes: e.target.value })} rows={3} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => { setShowEdit(false); clearCurrentContrat(); }}>Annuler</Button>
            <Button onClick={handleSaveEdit}>Enregistrer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}


// ============ Commandes Tab ============

function CommandesTab() {
  const { commandes, fetchCommandes, updateCommandeStatut, isLoading } = useB2bStore();
  const [statutFilter, setStatutFilter] = useState('');

  useEffect(() => { fetchCommandes({ statut: statutFilter || undefined }); }, [fetchCommandes, statutFilter]);

  const COMMANDE_STATUT_OPTIONS = [
    { value: '', label: 'Tous' },
    { value: 'EN_ATTENTE', label: 'En attente' },
    { value: 'CONFIRMEE', label: 'Confirmee' },
    { value: 'EN_PREPARATION', label: 'En preparation' },
    { value: 'EXPEDIEE', label: 'Expediee' },
    { value: 'LIVREE', label: 'Livree' },
    { value: 'ANNULEE', label: 'Annulée' },
  ];

  const nextStatut: Record<string, string> = {
    EN_ATTENTE: 'CONFIRMEE', CONFIRMEE: 'EN_PREPARATION',
    EN_PREPARATION: 'EXPEDIEE', EXPEDIEE: 'LIVREE',
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="w-48">
          <Select options={COMMANDE_STATUT_OPTIONS} value={statutFilter} onChange={(e) => setStatutFilter(e.target.value)} />
        </div>
      </div>

      {isLoading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <Card padding="sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Numéro</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Total TTC</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Ville</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Date</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Action</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {commandes.map((co) => (
                  <tr key={co.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-3 py-2.5 font-mono text-sm text-gray-900 dark:text-white">{co.numero || `#${co.id}`}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{co.totalTtc != null ? formatCurrency(co.totalTtc) : '--'}</td>
                    <td className="px-3 py-2.5 text-gray-500 hidden md:table-cell">{co.villeLivraison || '--'}</td>
                    <td className="px-3 py-2.5 text-center"><Badge color={COMMANDE_COLORS[co.statut] || 'gray'} size="sm">{co.statut}</Badge></td>
                    <td className="px-3 py-2.5 text-gray-400 text-xs hidden md:table-cell">{formatDate(co.dateCommande)}</td>
                    <td className="px-3 py-2.5 text-center">
                      {nextStatut[co.statut] && (
                        <button type="button" onClick={() => updateCommandeStatut(co.id, nextStatut[co.statut])}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                          <ChevronRight size={14} />{nextStatut[co.statut]}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {commandes.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucune commande</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}


// ============ Messages Tab ============

function MessagesTab() {
  const { demandes, fetchDemandes, messages, fetchMessages, sendMessage, isLoading } = useB2bStore();
  const [selectedDemandeId, setSelectedDemandeId] = useState<number | null>(null);
  const [newMessage, setNewMessage] = useState('');

  const demandesFetched = useRef(false);
  useEffect(() => { if (!demandesFetched.current) { demandesFetched.current = true; fetchDemandes(); } }, [fetchDemandes]);
  useEffect(() => { if (selectedDemandeId) fetchMessages({ demandeId: selectedDemandeId }); }, [selectedDemandeId, fetchMessages]);

  const handleSend = async () => {
    if (!selectedDemandeId || !newMessage.trim()) return;
    try {
      await sendMessage({ demandeId: selectedDemandeId, message: newMessage.trim() });
      setNewMessage('');
    } catch { /* error in store */ }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-h-[400px]">
      <div className="w-full lg:w-1/3 lg:max-w-[300px]">
        <Card padding="sm">
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 px-2">Demandes</h4>
          <div className="space-y-1 max-h-[500px] overflow-y-auto">
            {demandes.map((d) => (
              <button key={d.id} type="button" onClick={() => setSelectedDemandeId(d.id)}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  selectedDemandeId === d.id ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' : 'hover:bg-gray-50 dark:hover:bg-gray-800/30 text-gray-700 dark:text-gray-300'
                }`}>
                <span className="block truncate font-medium">{d.titre}</span>
                <span className="text-xs text-gray-400">{d.clientNom || 'N/A'} - {d.statut}</span>
              </button>
            ))}
            {demandes.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Aucune demande</p>}
          </div>
        </Card>
      </div>

      <div className="flex-1">
        <Card className="flex flex-col h-full min-h-[400px]">
          {selectedDemandeId ? (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[400px]">
                {messages.map((m) => (
                  <div key={m.id} className="flex flex-col">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        Utilisateur #{m.senderUserId}
                      </span>
                      <span className="text-xs text-gray-400">{formatDate(m.createdAt)}</span>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                      {m.message}
                    </div>
                  </div>
                ))}
                {messages.length === 0 && <p className="text-sm text-gray-400 text-center py-8">Aucun message</p>}
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 p-3 flex gap-2">
                <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="Ecrire un message..." className="erp-input flex-1" />
                <Button onClick={handleSend} disabled={!newMessage.trim() || isLoading}>Envoyer</Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Sélectionnez une demande pour voir les messages
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}


// ============ Catalogue Tab ============

function CatalogueTab() {
  const { catalogue, catalogueCategories, fetchCatalogue, addToPanier, panier, fetchPanier, isLoading } = useB2bStore();
  const [search, setSearch] = useState('');
  const [categorie, setCategorie] = useState('');

  useEffect(() => { fetchCatalogue({ search: search || undefined, categorie: categorie || undefined }); }, [fetchCatalogue, search, categorie]);
  useEffect(() => { fetchPanier(); }, [fetchPanier]);

  const handleAddToCart = async (produitId: number) => {
    try { await addToPanier(produitId); } catch { /* error in store */ }
  };

  return (
    <div className="space-y-4">
      <CommandBar
        actions={[]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            {catalogueCategories.length > 0 && (
              <div className="w-36 sm:w-48 shrink-0">
                <Select options={[{ value: '', label: 'Toutes categories' }, ...catalogueCategories.map(c => ({ value: c, label: c }))]}
                  value={categorie} onChange={(e) => setCategorie(e.target.value)} />
              </div>
            )}
          </div>
        }
      />
      {panier && panier.nombreItems > 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <ShoppingCart size={16} />
          <span>{panier.nombreItems} articles - {formatCurrency(panier.totalTtc)}</span>
        </div>
      )}

      {isLoading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {catalogue.map((p) => (
            <Card key={p.id} padding="sm" className="flex flex-col">
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{p.nom}</h4>
                {p.codeProduit && <p className="text-xs text-gray-400 font-mono mb-1">{p.codeProduit}</p>}
                {p.description && <p className="text-xs text-gray-500 mb-2 line-clamp-2">{p.description}</p>}
                {p.categorie && <Badge color="blue" size="sm">{p.categorie}</Badge>}
              </div>
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100 dark:border-gray-800">
                <div>
                  <span className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(p.prixUnitaire)}</span>
                  {p.unite && <span className="text-xs text-gray-400 ml-1">/ {p.unite}</span>}
                </div>
                <Button size="sm" onClick={() => handleAddToCart(p.id)}>
                  <ShoppingCart size={14} />
                </Button>
              </div>
              {p.stockDisponible != null && (
                <p className={`text-xs mt-1 ${p.stockDisponible > 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {p.stockDisponible > 0 ? `${p.stockDisponible} en stock` : 'Rupture de stock'}
                </p>
              )}
            </Card>
          ))}
          {catalogue.length === 0 && (
            <div className="col-span-full text-center py-12 text-gray-400">
              Aucun produit dans le catalogue
            </div>
          )}
        </div>
      )}
    </div>
  );
}
