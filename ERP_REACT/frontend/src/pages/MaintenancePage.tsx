/**
 * ERP React - Maintenance Module
 * 9 onglets: Tableau de bord, Types, Planification, Demandes, Interventions,
 * Pieces, Alertes, Historique, Statistiques.
 */
import { useEffect, useState, useMemo } from 'react';
import {
  Wrench, Plus, BarChart3, ClipboardList, Calendar, History,
  AlertTriangle, CheckCircle2, Settings, Package, Bell,
  Trash2, Edit, X, Zap, DollarSign,
  RefreshCcw, Eye, BellRing, Clock, Search,
} from 'lucide-react';
import { useMaintenanceStore } from '@/store/useMaintenanceStore';
import * as maintApi from '@/api/maintenance';
import type {
  MaintenanceType, MaintenancePlanification,
  MaintenanceIntervention,
} from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import { CommandBar } from '@/components/ui/CommandBar';
import StatCard from '@/components/dashboard/StatCard';
import { formatDate, formatCurrency } from '@/utils/format';

// ────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────

type BadgeColor = 'blue' | 'green' | 'yellow' | 'red' | 'gray' | 'amber' | 'teal';

const STATUT_COLORS: Record<string, BadgeColor> = {
  DEMANDE: 'yellow', APPROUVE: 'blue', PLANIFIE: 'teal', EN_COURS: 'green',
  EN_ATTENTE_PIECES: 'amber', TERMINE: 'green', ANNULE: 'gray',
};

const STATUT_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: 'DEMANDE', label: 'Demande' },
  { value: 'APPROUVE', label: 'Approuve' },
  { value: 'PLANIFIE', label: 'Planifie' },
  { value: 'EN_COURS', label: 'En cours' },
  { value: 'EN_ATTENTE_PIECES', label: 'En attente pieces' },
  { value: 'TERMINE', label: 'Termine' },
  { value: 'ANNULE', label: 'Annule' },
];

const INTERV_STATUT_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'EN_COURS', label: 'En cours' },
  { value: 'TERMINE', label: 'Termine' },
  { value: 'REPORTE', label: 'Reporte' },
];

const PRIORITE_OPTIONS = [
  { value: 'BASSE', label: 'Basse' },
  { value: 'NORMALE', label: 'Normale' },
  { value: 'HAUTE', label: 'Haute' },
  { value: 'CRITIQUE', label: 'Critique' },
];

const TYPE_MAINTENANCE_OPTIONS = [
  { value: 'CORRECTIVE', label: 'Corrective' },
  { value: 'PREVENTIVE', label: 'Preventive' },
  { value: 'URGENTE', label: 'Urgente' },
];

const CATEGORIE_OPTIONS = [
  { value: 'PREVENTIVE', label: 'Preventive' },
  { value: 'CORRECTIVE', label: 'Corrective' },
  { value: 'PREDICTIVE', label: 'Predictive' },
];

const FREQUENCE_TYPES = [
  { value: 'JOURS', label: 'Jours' },
  { value: 'SEMAINES', label: 'Semaines' },
  { value: 'MOIS', label: 'Mois' },
  { value: 'HEURES_UTILISATION', label: 'Heures utilisation' },
  { value: 'KILOMETRES', label: 'Kilometres' },
];

const EQUIPEMENT_TYPES = [
  { value: 'INVENTORY', label: 'Inventaire' },
  { value: 'LOCATION', label: 'Location' },
  { value: 'VEHICULE', label: 'Vehicule' },
];

const TYPE_EVENEMENT_OPTIONS = [
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'PANNE', label: 'Panne' },
  { value: 'INSPECTION', label: 'Inspection' },
  { value: 'REMPLACEMENT', label: 'Remplacement' },
  { value: 'MISE_EN_SERVICE', label: 'Mise en service' },
  { value: 'MISE_HORS_SERVICE', label: 'Mise hors service' },
];

const TYPE_ALERTE_OPTIONS = [
  { value: 'MAINTENANCE_DUE', label: 'Maintenance due' },
  { value: 'MAINTENANCE_RETARD', label: 'Maintenance en retard' },
  { value: 'PANNE', label: 'Panne' },
  { value: 'INSPECTION_REQUISE', label: 'Inspection requise' },
  { value: 'GARANTIE_EXPIRATION', label: 'Expiration garantie' },
];

function prioriteColor(p?: string): BadgeColor {
  if (p === 'CRITIQUE') return 'red';
  if (p === 'HAUTE') return 'yellow';
  if (p === 'NORMALE') return 'blue';
  return 'gray';
}

type TabKey = 'dashboard' | 'types' | 'planification' | 'demandes' | 'interventions' | 'pieces' | 'alertes' | 'historique' | 'stats';

// ────────────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────────────

export default function MaintenancePage() {
  const [tab, setTab] = useState<TabKey>('dashboard');

  const error = useMaintenanceStore((s) => s.error);
  const clearError = useMaintenanceStore((s) => s.clearError);
  const stats = useMaintenanceStore((s) => s.stats);
  const fetchStats = useMaintenanceStore((s) => s.fetchStats);
  const fetchRequests = useMaintenanceStore((s) => s.fetchRequests);
  const fetchPlanifications = useMaintenanceStore((s) => s.fetchPlanifications);
  const fetchAlertes = useMaintenanceStore((s) => s.fetchAlertes);

  useEffect(() => {
    fetchStats();
    fetchRequests();
    fetchPlanifications();
    fetchAlertes();
  }, [fetchStats, fetchRequests, fetchPlanifications, fetchAlertes]);

  const alertBadge = stats?.alertesNonLues ?? 0;
  const enCours = stats?.enCours ?? 0;
  const enAttente = stats?.enAttente ?? 0;
  const planifRetard = stats?.planificationsRetard ?? 0;

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Tableau de bord', icon: <BarChart3 size={14} /> },
    { key: 'types', label: 'Types', icon: <Settings size={14} /> },
    { key: 'planification', label: `Planification${planifRetard > 0 ? ` (${planifRetard})` : ''}`, icon: <Calendar size={14} /> },
    { key: 'demandes', label: `Demandes (${enAttente})`, icon: <ClipboardList size={14} /> },
    { key: 'interventions', label: `Interventions (${enCours})`, icon: <Wrench size={14} /> },
    { key: 'pieces', label: 'Pieces', icon: <Package size={14} /> },
    { key: 'alertes', label: `Alertes${alertBadge > 0 ? ` (${alertBadge})` : ''}`, icon: <Bell size={14} /> },
    { key: 'historique', label: 'Historique', icon: <History size={14} /> },
    { key: 'stats', label: 'Statistiques', icon: <BarChart3 size={14} /> },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Maintenance</h2>

      {error && <Alert type="error" onClose={clearError}>{error}</Alert>}

      <div className="overflow-x-auto scrollbar-hide border-b border-gray-200 dark:border-gray-700">
        <div className="flex gap-1 whitespace-nowrap min-w-max md:min-w-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); clearError(); }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-seaop-primary-600 text-seaop-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <span className="flex items-center gap-1.5">{t.icon} {t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'types' && <TypesTab />}
      {tab === 'planification' && <PlanificationTab />}
      {tab === 'demandes' && <DemandesTab />}
      {tab === 'interventions' && <InterventionsTab />}
      {tab === 'pieces' && <PiecesTab />}
      {tab === 'alertes' && <AlertesTab />}
      {tab === 'historique' && <HistoriqueTab />}
      {tab === 'stats' && <StatsTab />}
    </div>
  );
}

// ────────────────────────────────────────────────────
// Dashboard Tab
// ────────────────────────────────────────────────────

function DashboardTab() {
  const stats = useMaintenanceStore((s) => s.stats);
  const requests = useMaintenanceStore((s) => s.requests);
  const alertes = useMaintenanceStore((s) => s.alertes);
  const planifications = useMaintenanceStore((s) => s.planifications);

  const urgentes = useMemo(
    () => requests.filter((r) => r.priorite === 'CRITIQUE' || r.priorite === 'HAUTE').slice(0, 5),
    [requests]
  );
  const planifDues = useMemo(() => {
    const now = new Date();
    return planifications
      .filter((p) => p.actif && p.prochaineMaintenance && new Date(p.prochaineMaintenance) <= now)
      .slice(0, 5);
  }, [planifications]);

  return (
    <div className="space-y-4">
      {/* KPI Cards — StatCard pastel (harmonise avec Suivi) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Interventions ce mois" value={stats?.interventionsMois ?? 0} icon={<Wrench size={20} />} color="blue" />
        <StatCard label="En cours" value={stats?.enCours ?? 0} icon={<RefreshCcw size={20} />} color="green" />
        <StatCard label="En attente" value={stats?.enAttente ?? 0} icon={<ClipboardList size={20} />} color="yellow" />
        <StatCard label="Alertes non lues" value={stats?.alertesNonLues ?? 0} icon={<BellRing size={20} />} color="red" />
      </div>

      {/* Demandes urgentes */}
      <Card className="p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-3">
          <AlertTriangle size={16} className="text-[#b8616a] dark:text-[#E8919A]" /> Demandes urgentes
        </h3>
        {urgentes.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune demande urgente</p>
        ) : (
          <div className="space-y-2">
            {urgentes.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-800">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.titre}</div>
                  <div className="text-xs text-gray-500 truncate">{r.numeroDemande} - {r.description}</div>
                </div>
                <div className="flex gap-2 items-center ml-2">
                  <Badge color={prioriteColor(r.priorite)}>{r.priorite}</Badge>
                  <Badge color={STATUT_COLORS[r.statut] || 'gray'}>{r.statut}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Planifications dues */}
      <Card className="p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-3">
          <Calendar size={16} className="text-[#b8802a] dark:text-[#F0B07A]" /> Planifications dues
        </h3>
        {planifDues.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune planification en retard</p>
        ) : (
          <div className="space-y-2">
            {planifDues.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-800">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.nomPlanification}</div>
                  <div className="text-xs text-gray-500">Prevue: {formatDate(p.prochaineMaintenance || '')}</div>
                </div>
                <Badge color={prioriteColor(p.priorite)}>{p.priorite || 'NORMALE'}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Dernieres alertes */}
      <Card className="p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-3">
          <Bell size={16} className="text-[#c8962a] dark:text-[#F6C87A]" /> Dernieres alertes
        </h3>
        {alertes.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune alerte active</p>
        ) : (
          <div className="space-y-2">
            {alertes.slice(0, 5).map((a) => (
              <div key={a.id} className="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-800">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{a.titre}</div>
                  <div className="text-xs text-gray-500 truncate">{a.message}</div>
                </div>
                <Badge color={prioriteColor(a.priorite)}>{a.priorite}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────
// Types Tab
// ────────────────────────────────────────────────────

function TypesTab() {
  const types = useMaintenanceStore((s) => s.types);
  const fetchTypes = useMaintenanceStore((s) => s.fetchTypes);
  const createType = useMaintenanceStore((s) => s.createType);
  const updateType = useMaintenanceStore((s) => s.updateType);
  const deleteType = useMaintenanceStore((s) => s.deleteType);
  const isLoading = useMaintenanceStore((s) => s.isLoading);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MaintenanceType | null>(null);
  const [form, setForm] = useState({
    nom: '',
    description: '',
    categorie: 'PREVENTIVE',
    frequenceJours: 30,
    dureeEstimeeHeures: 1,
    coutEstime: 0,
    competencesRequises: '',
  });

  useEffect(() => { fetchTypes(); }, [fetchTypes]);

  const openNew = () => {
    setEditing(null);
    setForm({
      nom: '', description: '', categorie: 'PREVENTIVE',
      frequenceJours: 30, dureeEstimeeHeures: 1, coutEstime: 0, competencesRequises: '',
    });
    setShowForm(true);
  };

  const openEdit = (t: MaintenanceType) => {
    setEditing(t);
    setForm({
      nom: t.nom,
      description: t.description || '',
      categorie: t.categorie || 'PREVENTIVE',
      frequenceJours: t.frequenceJours || 30,
      dureeEstimeeHeures: t.dureeEstimeeHeures || 1,
      coutEstime: t.coutEstime || 0,
      competencesRequises: t.competencesRequises || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nom) return;
    try {
      if (editing) {
        await updateType(editing.id, form);
      } else {
        await createType(form);
      }
      setShowForm(false);
    } catch { /* error in store */ }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Desactiver ce type de maintenance?')) return;
    try { await deleteType(id); } catch { /* */ }
  };

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const filteredTypes = types.filter((t) => {
    if (catFilter && (t.categorie || '') !== catFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${t.nom || ''} ${t.description || ''} ${t.categorie || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (isLoading && types.length === 0) return <SkeletonPage />;

  return (
    <div className="space-y-3">
      <CommandBar
        actions={[
          { label: 'Nouveau type', icon: <Plus size={15} />, onClick: openNew, variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-32 sm:w-40 shrink-0">
              <Select label="" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
                options={[{ value: '', label: 'Toutes' }, ...CATEGORIE_OPTIONS]} />
            </div>
          </div>
        }
      />
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Types de maintenance</h3>

      {filteredTypes.length === 0 ? (
        <Alert type="info">Aucun type de maintenance. Creez-en un pour commencer.</Alert>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 dark:border-gray-700">
              <tr className="text-left">
                <th className="py-2 px-2">Nom</th>
                <th className="py-2 px-2">Catégorie</th>
                <th className="py-2 px-2">Frequence</th>
                <th className="py-2 px-2">Durée est.</th>
                <th className="py-2 px-2">Coût est.</th>
                <th className="py-2 px-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTypes.map((t) => (
                <tr key={t.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 px-2 font-medium">{t.nom}</td>
                  <td className="py-2 px-2">
                    <Badge color={t.categorie === 'CORRECTIVE' ? 'yellow' : t.categorie === 'PREDICTIVE' ? 'teal' : 'blue'}>
                      {t.categorie}
                    </Badge>
                  </td>
                  <td className="py-2 px-2">{t.frequenceJours ? `${t.frequenceJours} jours` : '-'}</td>
                  <td className="py-2 px-2">{t.dureeEstimeeHeures ? `${t.dureeEstimeeHeures}h` : '-'}</td>
                  <td className="py-2 px-2">{t.coutEstime ? formatCurrency(t.coutEstime) : '-'}</td>
                  <td className="py-2 px-2 text-right">
                    <button onClick={() => openEdit(t)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded mr-1">
                      <Edit size={14} />
                    </button>
                    <button onClick={() => handleDelete(t.id)} className="p-1 hover:bg-[#E8919A]/10 dark:hover:bg-[#E8919A]/20 rounded">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={editing ? 'Modifier type' : 'Nouveau type'}>
        <div className="space-y-3">
          <Input label="Nom *" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
          <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          <Select label="Catégorie" value={form.categorie}
            onChange={(e) => setForm({ ...form, categorie: e.target.value })}
            options={CATEGORIE_OPTIONS} />
          <div className="grid grid-cols-2 gap-3">
            <Input type="number" label="Fréquence (jours)" value={form.frequenceJours}
              onChange={(e) => setForm({ ...form, frequenceJours: Number(e.target.value) || 0 })} />
            <Input type="number" label="Durée estimée (h)" value={form.dureeEstimeeHeures}
              onChange={(e) => setForm({ ...form, dureeEstimeeHeures: Number(e.target.value) || 0 })} />
          </div>
          <Input type="number" label="Coût estimé ($)" value={form.coutEstime}
            onChange={(e) => setForm({ ...form, coutEstime: Number(e.target.value) || 0 })} />
          <Textarea label="Compétences requises" value={form.competencesRequises}
            onChange={(e) => setForm({ ...form, competencesRequises: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowForm(false)}>Annuler</Button>
            <Button variant="primary" onClick={handleSave} disabled={!form.nom}>
              {editing ? 'Mettre à jour' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────
// Planification Tab
// ────────────────────────────────────────────────────

function PlanificationTab() {
  const planifications = useMaintenanceStore((s) => s.planifications);
  const types = useMaintenanceStore((s) => s.types);
  const fetchPlanifications = useMaintenanceStore((s) => s.fetchPlanifications);
  const fetchTypes = useMaintenanceStore((s) => s.fetchTypes);
  const createPlanification = useMaintenanceStore((s) => s.createPlanification);
  const updatePlanification = useMaintenanceStore((s) => s.updatePlanification);
  const deletePlanification = useMaintenanceStore((s) => s.deletePlanification);
  const isLoading = useMaintenanceStore((s) => s.isLoading);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MaintenancePlanification | null>(null);
  const [form, setForm] = useState({
    equipementType: 'INVENTORY',
    equipementId: 0,
    maintenanceTypeId: 0,
    nomPlanification: '',
    description: '',
    frequenceType: 'JOURS',
    frequenceValeur: 30,
    derniereMaintenance: '',
    prochaineMaintenance: '',
    seuilAlerteJours: 7,
    priorite: 'NORMALE',
  });

  useEffect(() => {
    fetchPlanifications();
    fetchTypes();
  }, [fetchPlanifications, fetchTypes]);

  const openNew = () => {
    setEditing(null);
    setForm({
      equipementType: 'INVENTORY', equipementId: 0, maintenanceTypeId: 0,
      nomPlanification: '', description: '', frequenceType: 'JOURS', frequenceValeur: 30,
      derniereMaintenance: '', prochaineMaintenance: '', seuilAlerteJours: 7, priorite: 'NORMALE',
    });
    setShowForm(true);
  };

  const openEdit = (p: MaintenancePlanification) => {
    setEditing(p);
    setForm({
      equipementType: p.equipementType || 'INVENTORY',
      equipementId: p.equipementId || 0,
      maintenanceTypeId: p.maintenanceTypeId || 0,
      nomPlanification: p.nomPlanification,
      description: p.description || '',
      frequenceType: p.frequenceType || 'JOURS',
      frequenceValeur: p.frequenceValeur || 30,
      derniereMaintenance: p.derniereMaintenance || '',
      prochaineMaintenance: p.prochaineMaintenance || '',
      seuilAlerteJours: p.seuilAlerteJours || 7,
      priorite: p.priorite || 'NORMALE',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nomPlanification || !form.equipementId) return;
    const payload: Parameters<typeof createPlanification>[0] = {
      equipementType: form.equipementType,
      equipementId: form.equipementId,
      maintenanceTypeId: form.maintenanceTypeId || undefined,
      nomPlanification: form.nomPlanification,
      description: form.description || undefined,
      frequenceType: form.frequenceType,
      frequenceValeur: form.frequenceValeur,
      derniereMaintenance: form.derniereMaintenance || undefined,
      prochaineMaintenance: form.prochaineMaintenance || undefined,
      seuilAlerteJours: form.seuilAlerteJours,
      priorite: form.priorite,
    };
    try {
      if (editing) {
        await updatePlanification(editing.id, payload);
      } else {
        await createPlanification(payload);
      }
      setShowForm(false);
    } catch { /* */ }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Desactiver cette planification?')) return;
    try { await deletePlanification(id); } catch { /* */ }
  };

  const [search, setSearch] = useState('');
  const [prioFilter, setPrioFilter] = useState('');
  const filteredPlans = planifications.filter((p) => {
    if (prioFilter && (p.priorite || '') !== prioFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${p.nomPlanification || ''} ${p.description || ''} ${p.equipementType || ''} ${p.equipementId || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (isLoading && planifications.length === 0) return <SkeletonPage />;

  return (
    <div className="space-y-3">
      <CommandBar
        actions={[
          { label: 'Nouvelle planification', icon: <Plus size={15} />, onClick: openNew, variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-32 sm:w-40 shrink-0">
              <Select label="" value={prioFilter} onChange={(e) => setPrioFilter(e.target.value)}
                options={[{ value: '', label: 'Toutes priorites' }, ...PRIORITE_OPTIONS]} />
            </div>
          </div>
        }
      />
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Planification preventive</h3>

      {filteredPlans.length === 0 ? (
        <Alert type="info">Aucune planification. Creez-en une pour planifier vos maintenances.</Alert>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 dark:border-gray-700">
              <tr className="text-left">
                <th className="py-2 px-2">Nom</th>
                <th className="py-2 px-2">Equipement</th>
                <th className="py-2 px-2">Frequence</th>
                <th className="py-2 px-2">Derniere</th>
                <th className="py-2 px-2">Prochaine</th>
                <th className="py-2 px-2">Priorité</th>
                <th className="py-2 px-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlans.map((p) => {
                const isRetard = p.prochaineMaintenance && new Date(p.prochaineMaintenance) < new Date();
                return (
                  <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 px-2 font-medium">{p.nomPlanification}</td>
                    <td className="py-2 px-2 text-xs">{p.equipementType} #{p.equipementId}</td>
                    <td className="py-2 px-2">{p.frequenceValeur} {p.frequenceType?.toLowerCase()}</td>
                    <td className="py-2 px-2">{p.derniereMaintenance ? formatDate(p.derniereMaintenance) : '-'}</td>
                    <td className="py-2 px-2">
                      <span className={isRetard ? 'text-[#B8616A] font-semibold' : ''}>
                        {p.prochaineMaintenance ? formatDate(p.prochaineMaintenance) : '-'}
                      </span>
                      {isRetard && <Badge color="red" className="ml-1">Retard</Badge>}
                    </td>
                    <td className="py-2 px-2">
                      <Badge color={prioriteColor(p.priorite)}>{p.priorite}</Badge>
                    </td>
                    <td className="py-2 px-2 text-right">
                      <button onClick={() => openEdit(p)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded mr-1">
                        <Edit size={14} />
                      </button>
                      <button onClick={() => handleDelete(p.id)} className="p-1 hover:bg-[#E8919A]/10 dark:hover:bg-[#E8919A]/20 rounded">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={editing ? 'Modifier planification' : 'Nouvelle planification'}>
        <div className="space-y-3">
          <Input label="Nom planification *" value={form.nomPlanification}
            onChange={(e) => setForm({ ...form, nomPlanification: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Type équipement" value={form.equipementType}
              onChange={(e) => setForm({ ...form, equipementType: e.target.value })}
              options={EQUIPEMENT_TYPES} />
            <Input type="number" label="ID équipement *" value={form.equipementId}
              onChange={(e) => setForm({ ...form, equipementId: Number(e.target.value) || 0 })} />
          </div>
          <Select label="Type de maintenance" value={String(form.maintenanceTypeId)}
            onChange={(e) => setForm({ ...form, maintenanceTypeId: Number(e.target.value) || 0 })}
            options={[{ value: '0', label: '-- Aucun --' }, ...types.map((t) => ({ value: String(t.id), label: t.nom }))]} />
          <Textarea label="Description" value={form.description} rows={2}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Frequence type" value={form.frequenceType}
              onChange={(e) => setForm({ ...form, frequenceType: e.target.value })}
              options={FREQUENCE_TYPES} />
            <Input type="number" label="Frequence valeur" min={1} value={form.frequenceValeur}
              onChange={(e) => setForm({ ...form, frequenceValeur: Math.max(1, Number(e.target.value) || 1) })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input type="date" label="Dernière maintenance" value={form.derniereMaintenance}
              onChange={(e) => setForm({ ...form, derniereMaintenance: e.target.value })} />
            <Input type="date" label="Prochaine (optionnelle)" value={form.prochaineMaintenance}
              onChange={(e) => setForm({ ...form, prochaineMaintenance: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input type="number" label="Seuil alerte (jours)" value={form.seuilAlerteJours}
              onChange={(e) => setForm({ ...form, seuilAlerteJours: Number(e.target.value) || 0 })} />
            <Select label="Priorité" value={form.priorite}
              onChange={(e) => setForm({ ...form, priorite: e.target.value })}
              options={PRIORITE_OPTIONS} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowForm(false)}>Annuler</Button>
            <Button variant="primary" onClick={handleSave} disabled={!form.nomPlanification || !form.equipementId}>
              {editing ? 'Mettre à jour' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────
// Demandes Tab
// ────────────────────────────────────────────────────

function DemandesTab() {
  const requests = useMaintenanceStore((s) => s.requests);
  const fetchRequests = useMaintenanceStore((s) => s.fetchRequests);
  const createRequest = useMaintenanceStore((s) => s.createRequest);
  const updateRequest = useMaintenanceStore((s) => s.updateRequest);
  const deleteRequest = useMaintenanceStore((s) => s.deleteRequest);
  const fetchRequestDetail = useMaintenanceStore((s) => s.fetchRequestDetail);
  const selectedRequest = useMaintenanceStore((s) => s.selectedRequest);
  const clearSelectedRequest = useMaintenanceStore((s) => s.clearSelectedRequest);
  const setFilter = useMaintenanceStore((s) => s.setRequestFilter);
  const filters = useMaintenanceStore((s) => s.requestFilters);
  const isLoading = useMaintenanceStore((s) => s.isLoading);

  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    titre: '',
    description: '',
    typeMaintenance: 'CORRECTIVE',
    priorite: 'NORMALE',
    equipementType: 'INVENTORY',
    equipementId: 0,
    symptomes: '',
    coutEstime: 0,
  });

  useEffect(() => { fetchRequests(); }, [fetchRequests, filters.statut]);

  const filteredRequests = search
    ? requests.filter((r) => {
        const q = search.toLowerCase();
        const hay = `${r.numeroDemande || ''} ${r.titre || ''} ${r.description || ''} ${r.typeMaintenance || ''}`.toLowerCase();
        return hay.includes(q);
      })
    : requests;

  const handleCreate = async () => {
    if (!form.description) return;
    try {
      await createRequest({
        ...form,
        titre: form.titre || (form.description ? form.description.slice(0, 80) : 'Demande maintenance'),
        equipementId: form.equipementId || undefined,
      });
      setShowForm(false);
      setForm({
        titre: '', description: '', typeMaintenance: 'CORRECTIVE', priorite: 'NORMALE',
        equipementType: 'INVENTORY', equipementId: 0, symptomes: '', coutEstime: 0,
      });
    } catch { /* */ }
  };

  const openDetail = (id: number) => { fetchRequestDetail(id); };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Supprimer cette demande?')) return;
    try { await deleteRequest(id); } catch { /* */ }
  };

  if (isLoading && requests.length === 0) return <SkeletonPage />;

  return (
    <div className="space-y-3">
      <CommandBar
        actions={[
          { label: 'Nouvelle demande', icon: <Plus size={15} />, onClick: () => setShowForm(true), variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-36 sm:w-44 shrink-0">
              <Select label="" value={filters.statut} onChange={(e) => setFilter('statut', e.target.value)} options={STATUT_OPTIONS} />
            </div>
          </div>
        }
      />
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Demandes de maintenance</h3>

      {filteredRequests.length === 0 ? (
        <Alert type="info">Aucune demande de maintenance.</Alert>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 dark:border-gray-700">
              <tr className="text-left">
                <th className="py-2 px-2">Numéro</th>
                <th className="py-2 px-2">Titre</th>
                <th className="py-2 px-2">Type</th>
                <th className="py-2 px-2">Priorité</th>
                <th className="py-2 px-2">Statut</th>
                <th className="py-2 px-2">Date</th>
                <th className="py-2 px-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 px-2 font-mono text-xs">{r.numeroDemande}</td>
                  <td className="py-2 px-2 font-medium truncate max-w-xs">{r.titre}</td>
                  <td className="py-2 px-2 text-xs">{r.typeMaintenance}</td>
                  <td className="py-2 px-2">
                    <Badge color={prioriteColor(r.priorite)}>{r.priorite}</Badge>
                  </td>
                  <td className="py-2 px-2">
                    <Badge color={STATUT_COLORS[r.statut] || 'gray'}>{r.statut}</Badge>
                  </td>
                  <td className="py-2 px-2 text-xs">{r.dateDemande ? formatDate(r.dateDemande) : '-'}</td>
                  <td className="py-2 px-2 text-right">
                    <button onClick={() => openDetail(r.id)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded mr-1">
                      <Eye size={14} />
                    </button>
                    <button onClick={() => handleDelete(r.id)} className="p-1 hover:bg-[#E8919A]/10 dark:hover:bg-[#E8919A]/20 rounded">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Nouvelle demande */}
      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Nouvelle demande">
        <div className="space-y-3">
          <Input label="Titre" value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} />
          <Textarea label="Description *" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
          <Textarea label="Symptômes" value={form.symptomes}
            onChange={(e) => setForm({ ...form, symptomes: e.target.value })} rows={2} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Type" value={form.typeMaintenance}
              onChange={(e) => setForm({ ...form, typeMaintenance: e.target.value })}
              options={TYPE_MAINTENANCE_OPTIONS} />
            <Select label="Priorité" value={form.priorite}
              onChange={(e) => setForm({ ...form, priorite: e.target.value })}
              options={PRIORITE_OPTIONS} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Type équipement" value={form.equipementType}
              onChange={(e) => setForm({ ...form, equipementType: e.target.value })}
              options={EQUIPEMENT_TYPES} />
            <Input type="number" label="ID équipement" value={form.equipementId}
              onChange={(e) => setForm({ ...form, equipementId: Number(e.target.value) || 0 })} />
          </div>
          <Input type="number" label="Coût estimé ($)" value={form.coutEstime}
            onChange={(e) => setForm({ ...form, coutEstime: Number(e.target.value) || 0 })} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowForm(false)}>Annuler</Button>
            <Button variant="primary" onClick={handleCreate} disabled={!form.description}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Modal Detail */}
      {selectedRequest && (
        <RequestDetailModal
          data={selectedRequest}
          onClose={clearSelectedRequest}
          onUpdate={updateRequest}
        />
      )}
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────
// Request Detail Modal (avec pieces + interventions)
// ────────────────────────────────────────────────────

function RequestDetailModal({
  data, onClose, onUpdate,
}: {
  data: NonNullable<ReturnType<typeof useMaintenanceStore.getState>['selectedRequest']>;
  onClose: () => void;
  onUpdate: (id: number, body: Parameters<typeof maintApi.updateRequest>[1]) => Promise<void>;
}) {
  const demande = data.demande;
  const pieces = data.pieces;
  const interventions = data.interventions;
  const createIntervention = useMaintenanceStore((s) => s.createIntervention);
  const createPiece = useMaintenanceStore((s) => s.createPiece);
  const deletePiece = useMaintenanceStore((s) => s.deletePiece);

  const [statut, setStatut] = useState(demande.statut);
  const [coutReel, setCoutReel] = useState(demande.coutReel || 0);
  const [solution, setSolution] = useState(demande.solution || '');
  const [showPieceForm, setShowPieceForm] = useState(false);
  const [pieceForm, setPieceForm] = useState({ pieceNom: '', pieceReference: '', quantite: 1, coutUnitaire: 0 });
  const [showInterventionForm, setShowInterventionForm] = useState(false);
  const [interventionDesc, setInterventionDesc] = useState('');
  const [interventionType, setInterventionType] = useState('');

  const handleSaveDetails = async () => {
    const payload: Parameters<typeof onUpdate>[1] = {};
    if (statut !== demande.statut) payload.statut = statut;
    if (coutReel !== demande.coutReel) payload.coutReel = coutReel;
    if (solution !== demande.solution) payload.solution = solution;
    if (Object.keys(payload).length === 0) return;
    try { await onUpdate(demande.id, payload); } catch { /* */ }
  };

  const handleAddPiece = async () => {
    if (!pieceForm.pieceNom) return;
    try {
      await createPiece({
        demandeId: demande.id,
        pieceNom: pieceForm.pieceNom,
        pieceReference: pieceForm.pieceReference || undefined,
        quantite: pieceForm.quantite,
        coutUnitaire: pieceForm.coutUnitaire,
        coutTotal: pieceForm.quantite * pieceForm.coutUnitaire,
      });
      setPieceForm({ pieceNom: '', pieceReference: '', quantite: 1, coutUnitaire: 0 });
      setShowPieceForm(false);
    } catch { /* */ }
  };

  const handleAddIntervention = async () => {
    if (!interventionDesc) return;
    try {
      await createIntervention({
        demandeId: demande.id,
        descriptionTravaux: interventionDesc,
        typeIntervention: interventionType || undefined,
      });
      setShowInterventionForm(false);
      setInterventionDesc('');
      setInterventionType('');
    } catch { /* */ }
  };

  const totalPieces = pieces.reduce((sum, p) => sum + (p.coutTotal || 0), 0);

  return (
    <Modal isOpen={true} onClose={onClose} title={`Demande ${demande.numeroDemande}`} size="xl">
      <div className="space-y-4">
        {/* Infos */}
        <Card className="p-3 bg-gray-50 dark:bg-gray-900">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-500">Titre:</span> <span className="font-medium">{demande.titre}</span></div>
            <div><span className="text-gray-500">Priorité:</span> <Badge color={prioriteColor(demande.priorite)}>{demande.priorite}</Badge></div>
            <div><span className="text-gray-500">Type:</span> {demande.typeMaintenance}</div>
            <div><span className="text-gray-500">Equipement:</span> {demande.equipementType} #{demande.equipementId}</div>
            <div className="md:col-span-2"><span className="text-gray-500">Description:</span> {demande.description}</div>
            {demande.symptomes && (
              <div className="md:col-span-2"><span className="text-gray-500">Symptomes:</span> {demande.symptomes}</div>
            )}
          </div>
        </Card>

        {/* Mise a jour */}
        <Card className="p-3 space-y-2">
          <h4 className="font-semibold text-sm">Mise a jour</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select label="Statut" value={statut} onChange={(e) => setStatut(e.target.value)}
              options={STATUT_OPTIONS.filter((o) => o.value)} />
            <Input type="number" label="Coût réel ($)" value={coutReel}
              onChange={(e) => setCoutReel(Number(e.target.value) || 0)} />
            <div className="flex items-end">
              <Button variant="primary" onClick={handleSaveDetails} size="sm" className="w-full">Enregistrer</Button>
            </div>
          </div>
          <Textarea label="Solution" value={solution} onChange={(e) => setSolution(e.target.value)} rows={2} />
        </Card>

        {/* Pieces */}
        <Card className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Pieces ({pieces.length}) - Total: {formatCurrency(totalPieces)}</h4>
            <Button size="sm" variant="secondary" onClick={() => setShowPieceForm((v) => !v)}>
              <Plus size={12} /> Ajouter
            </Button>
          </div>
          {showPieceForm && (
            <div className="space-y-2 p-2 bg-gray-50 dark:bg-gray-900 rounded">
              <Input label="Nom piece *" value={pieceForm.pieceNom}
                onChange={(e) => setPieceForm({ ...pieceForm, pieceNom: e.target.value })} />
              <div className="grid grid-cols-3 gap-2">
                <Input label="Référence" value={pieceForm.pieceReference}
                  onChange={(e) => setPieceForm({ ...pieceForm, pieceReference: e.target.value })} />
                <Input type="number" label="Quantité" value={pieceForm.quantite}
                  onChange={(e) => setPieceForm({ ...pieceForm, quantite: Number(e.target.value) || 1 })} />
                <Input type="number" label="Coût unit." value={pieceForm.coutUnitaire}
                  onChange={(e) => setPieceForm({ ...pieceForm, coutUnitaire: Number(e.target.value) || 0 })} />
              </div>
              <Button size="sm" variant="primary" onClick={handleAddPiece} disabled={!pieceForm.pieceNom}>Enregistrer</Button>
            </div>
          )}
          {pieces.length > 0 && (
            <table className="w-full text-xs">
              <thead><tr className="text-left"><th className="py-1">Nom</th><th>Ref</th><th>Qte</th><th>Coût</th><th></th></tr></thead>
              <tbody>
                {pieces.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-1">{p.pieceNom}</td>
                    <td>{p.pieceReference || '-'}</td>
                    <td>{p.quantite}</td>
                    <td>{formatCurrency(p.coutTotal || 0)}</td>
                    <td>
                      <button onClick={() => deletePiece(p.id)} className="p-0.5 hover:bg-[#E8919A]/10 rounded">
                        <X size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Interventions */}
        <Card className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Interventions ({interventions.length})</h4>
            <Button size="sm" variant="secondary" onClick={() => setShowInterventionForm((v) => !v)}>
              <Plus size={12} /> Nouvelle
            </Button>
          </div>
          {showInterventionForm && (
            <div className="space-y-2 p-2 bg-gray-50 dark:bg-gray-900 rounded">
              <Input label="Type" value={interventionType} onChange={(e) => setInterventionType(e.target.value)}
                placeholder="Ex: Révision, Réparation..." />
              <Textarea label="Description *" value={interventionDesc}
                onChange={(e) => setInterventionDesc(e.target.value)} rows={2} />
              <Button size="sm" variant="primary" onClick={handleAddIntervention} disabled={!interventionDesc}>Enregistrer</Button>
            </div>
          )}
          {interventions.length > 0 ? (
            <div className="space-y-1 text-xs">
              {interventions.map((i) => (
                <div key={i.id} className="p-2 bg-gray-50 dark:bg-gray-900 rounded">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{i.typeIntervention || 'Intervention'}</div>
                    <Badge color={STATUT_COLORS[i.statut || 'EN_COURS'] || 'gray'}>{i.statut}</Badge>
                  </div>
                  {i.descriptionTravaux && <div className="text-gray-600 mt-1">{i.descriptionTravaux}</div>}
                  <div className="text-gray-500 text-xs mt-1">{i.dateIntervention ? formatDate(i.dateIntervention) : ''}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500">Aucune intervention enregistree</p>
          )}
        </Card>
      </div>
    </Modal>
  );
}

// ────────────────────────────────────────────────────
// Interventions Tab
// ────────────────────────────────────────────────────

function InterventionsTab() {
  const interventions = useMaintenanceStore((s) => s.interventions);
  const fetchInterventions = useMaintenanceStore((s) => s.fetchInterventions);
  const updateIntervention = useMaintenanceStore((s) => s.updateIntervention);
  const deleteIntervention = useMaintenanceStore((s) => s.deleteIntervention);
  const setFilter = useMaintenanceStore((s) => s.setInterventionFilter);
  const filters = useMaintenanceStore((s) => s.interventionFilters);
  const isLoading = useMaintenanceStore((s) => s.isLoading);

  const [editing, setEditing] = useState<MaintenanceIntervention | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ statut: 'EN_COURS', observations: '', dureeHeures: 0 });

  useEffect(() => { fetchInterventions(); }, [fetchInterventions, filters.statut]);

  const filteredInterventions = search
    ? interventions.filter((i) => {
        const q = search.toLowerCase();
        const hay = `${i.numeroDemande || ''} ${i.typeIntervention || ''} ${i.descriptionTravaux || ''} ${i.observations || ''}`.toLowerCase();
        return hay.includes(q);
      })
    : interventions;

  const openEdit = (i: MaintenanceIntervention) => {
    setEditing(i);
    setForm({
      statut: i.statut || 'EN_COURS',
      observations: i.observations || '',
      dureeHeures: i.dureeHeures || 0,
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    try {
      await updateIntervention(editing.id, form);
      setEditing(null);
      setForm({ statut: 'EN_COURS', observations: '', dureeHeures: 0 });
    } catch { /* */ }
  };

  const handleCancel = () => {
    setEditing(null);
    setForm({ statut: 'EN_COURS', observations: '', dureeHeures: 0 });
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Supprimer cette intervention?')) return;
    try { await deleteIntervention(id); } catch { /* */ }
  };

  if (isLoading && interventions.length === 0) return <SkeletonPage />;

  return (
    <div className="space-y-3">
      <CommandBar
        actions={[]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-32 sm:w-40 shrink-0">
              <Select label="" value={filters.statut} onChange={(e) => setFilter('statut', e.target.value)} options={INTERV_STATUT_OPTIONS} />
            </div>
          </div>
        }
      />
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Interventions</h3>

      {filteredInterventions.length === 0 ? (
        <Alert type="info">Aucune intervention. Creez des interventions depuis le detail d'une demande.</Alert>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 dark:border-gray-700">
              <tr className="text-left">
                <th className="py-2 px-2">Demande</th>
                <th className="py-2 px-2">Type</th>
                <th className="py-2 px-2">Description</th>
                <th className="py-2 px-2">Durée</th>
                <th className="py-2 px-2">Statut</th>
                <th className="py-2 px-2">Date</th>
                <th className="py-2 px-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInterventions.map((i) => (
                <tr key={i.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 px-2 font-mono text-xs">{i.numeroDemande || `#${i.demandeId}`}</td>
                  <td className="py-2 px-2 text-xs">{i.typeIntervention || '-'}</td>
                  <td className="py-2 px-2 max-w-xs truncate">{i.descriptionTravaux}</td>
                  <td className="py-2 px-2">{i.dureeHeures ? `${i.dureeHeures}h` : '-'}</td>
                  <td className="py-2 px-2">
                    <Badge color={STATUT_COLORS[i.statut || 'EN_COURS'] || 'gray'}>{i.statut}</Badge>
                  </td>
                  <td className="py-2 px-2 text-xs">{i.dateIntervention ? formatDate(i.dateIntervention) : '-'}</td>
                  <td className="py-2 px-2 text-right">
                    <button onClick={() => openEdit(i)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded mr-1">
                      <Edit size={14} />
                    </button>
                    <button onClick={() => handleDelete(i.id)} className="p-1 hover:bg-[#E8919A]/10 dark:hover:bg-[#E8919A]/20 rounded">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={!!editing} onClose={handleCancel} title="Modifier intervention">
        {editing && (
          <div className="space-y-3">
            <Select label="Statut" value={form.statut}
              onChange={(e) => setForm({ ...form, statut: e.target.value })}
              options={[
                { value: 'EN_COURS', label: 'En cours' },
                { value: 'TERMINE', label: 'Termine' },
                { value: 'REPORTE', label: 'Reporte' },
              ]} />
            <Input type="number" label="Durée (heures)" value={form.dureeHeures}
              onChange={(e) => setForm({ ...form, dureeHeures: Number(e.target.value) || 0 })} />
            <Textarea label="Observations" value={form.observations}
              onChange={(e) => setForm({ ...form, observations: e.target.value })} rows={3} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={handleCancel}>Annuler</Button>
              <Button variant="primary" onClick={handleSave}>Enregistrer</Button>
            </div>
          </div>
        )}
      </Modal>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────
// Pieces Tab
// ────────────────────────────────────────────────────

function PiecesTab() {
  const pieces = useMaintenanceStore((s) => s.pieces);
  const fetchPieces = useMaintenanceStore((s) => s.fetchPieces);
  const deletePiece = useMaintenanceStore((s) => s.deletePiece);
  const isLoading = useMaintenanceStore((s) => s.isLoading);
  const [search, setSearch] = useState('');

  useEffect(() => { fetchPieces(); }, [fetchPieces]);

  const filteredPieces = search
    ? pieces.filter((p) => {
        const q = search.toLowerCase();
        const hay = `${p.pieceNom || ''} ${p.pieceReference || ''} ${p.demandeId || ''}`.toLowerCase();
        return hay.includes(q);
      })
    : pieces;
  const totalCost = filteredPieces.reduce((sum, p) => sum + (p.coutTotal || 0), 0);

  const handleDelete = async (id: number) => {
    if (!window.confirm('Supprimer cette piece?')) return;
    try { await deletePiece(id); } catch { /* */ }
  };

  if (isLoading && pieces.length === 0) return <SkeletonPage />;

  return (
    <div className="space-y-3">
      <CommandBar
        actions={[]}
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
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Pieces detachees</h3>
          <div className="text-sm text-gray-500">Total: {formatCurrency(totalCost)}</div>
        </div>

      {filteredPieces.length === 0 ? (
        <Alert type="info">Aucune piece enregistree. Les pieces sont ajoutees depuis le detail des demandes ou interventions.</Alert>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 dark:border-gray-700">
              <tr className="text-left">
                <th className="py-2 px-2">Piece</th>
                <th className="py-2 px-2">Reference</th>
                <th className="py-2 px-2">Demande</th>
                <th className="py-2 px-2">Quantité</th>
                <th className="py-2 px-2">Coût unit.</th>
                <th className="py-2 px-2">Coût total</th>
                <th className="py-2 px-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filteredPieces.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 px-2 font-medium">{p.pieceNom}</td>
                  <td className="py-2 px-2 text-xs">{p.pieceReference || '-'}</td>
                  <td className="py-2 px-2 text-xs">{p.demandeId ? `#${p.demandeId}` : '-'}</td>
                  <td className="py-2 px-2">{p.quantite}</td>
                  <td className="py-2 px-2">{p.coutUnitaire ? formatCurrency(p.coutUnitaire) : '-'}</td>
                  <td className="py-2 px-2 font-semibold">{p.coutTotal ? formatCurrency(p.coutTotal) : '-'}</td>
                  <td className="py-2 px-2 text-right">
                    <button onClick={() => handleDelete(p.id)} className="p-1 hover:bg-[#E8919A]/10 dark:hover:bg-[#E8919A]/20 rounded">
                      <Trash2 size={14} />
                    </button>
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

// ────────────────────────────────────────────────────
// Alertes Tab
// ────────────────────────────────────────────────────

function AlertesTab() {
  const alertes = useMaintenanceStore((s) => s.alertes);
  const fetchAlertes = useMaintenanceStore((s) => s.fetchAlertes);
  const updateAlerte = useMaintenanceStore((s) => s.updateAlerte);
  const generateAlertes = useMaintenanceStore((s) => s.generateAlertes);
  const filters = useMaintenanceStore((s) => s.alerteFilters);
  const setFilter = useMaintenanceStore((s) => s.setAlerteFilter);
  const isLoading = useMaintenanceStore((s) => s.isLoading);

  useEffect(() => { fetchAlertes(); }, [fetchAlertes, filters.nonLuesOnly, filters.priorite]);

  const handleMarkRead = async (id: number) => {
    try { await updateAlerte(id, { lue: true }); } catch { /* */ }
  };

  const handleMarkTraitee = async (id: number) => {
    try { await updateAlerte(id, { traitee: true, lue: true }); } catch { /* */ }
  };

  const handleGenerate = async () => {
    try { await generateAlertes(); } catch { /* */ }
  };

  if (isLoading && alertes.length === 0) return <SkeletonPage />;

  return (
    <div className="space-y-3">
      <CommandBar
        actions={[
          { label: 'Generer alertes', icon: <Zap size={15} />, onClick: handleGenerate },
        ]}
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={filters.nonLuesOnly}
                onChange={(e) => setFilter('nonLuesOnly', e.target.checked)} />
              Non lues seulement
            </label>
            <Select value={filters.priorite} onChange={(e) => setFilter('priorite', e.target.value)}
              options={[{ value: '', label: 'Toutes priorites' }, ...PRIORITE_OPTIONS]} />
          </div>
        }
      />
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Alertes de maintenance</h3>

      {alertes.length === 0 ? (
        <Alert type="info">Aucune alerte. Cliquez sur "Générer" pour créer les alertes automatiques depuis les planifications.</Alert>
      ) : (
        <div className="space-y-2">
          {alertes.map((a) => (
            <div key={a.id}
              className={`p-3 rounded border ${a.lue ? 'border-gray-200 dark:border-gray-700' : 'border-[#E8C17A]/60 dark:border-[#E8C17A]/40 bg-[#F6C87A]/10 dark:bg-[#F6C87A]/20'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge color={prioriteColor(a.priorite)}>{a.priorite}</Badge>
                    <span className="font-semibold">{a.titre}</span>
                    {a.traitee && <Badge color="green">Traitee</Badge>}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">{a.message}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {a.typeAlerte} - {a.dateAlerte ? formatDate(a.dateAlerte) : ''}
                    {a.dateEcheance && ` - Echeance: ${formatDate(a.dateEcheance)}`}
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {!a.lue && (
                    <Button size="sm" variant="secondary" onClick={() => handleMarkRead(a.id)}>
                      <Eye size={12} /> Lue
                    </Button>
                  )}
                  {!a.traitee && (
                    <Button size="sm" variant="primary" onClick={() => handleMarkTraitee(a.id)}>
                      <CheckCircle2 size={12} /> Traiter
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────
// Historique Tab
// ────────────────────────────────────────────────────

function HistoriqueTab() {
  const historique = useMaintenanceStore((s) => s.historique);
  const fetchHistorique = useMaintenanceStore((s) => s.fetchHistorique);
  const createHistoriqueEntry = useMaintenanceStore((s) => s.createHistoriqueEntry);
  const isLoading = useMaintenanceStore((s) => s.isLoading);

  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [form, setForm] = useState({
    equipementType: 'INVENTORY',
    equipementId: 0,
    typeEvenement: 'MAINTENANCE',
    description: '',
    cout: 0,
    technicien: '',
  });

  useEffect(() => { fetchHistorique(); }, [fetchHistorique]);

  const filteredHistorique = historique.filter((h) => {
    if (typeFilter && (h.typeEvenement || '') !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${h.description || ''} ${h.technicien || ''} ${h.equipementType || ''} ${h.typeEvenement || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const handleSave = async () => {
    if (!form.equipementId || !form.typeEvenement) return;
    try {
      await createHistoriqueEntry(form);
      setShowForm(false);
      setForm({ equipementType: 'INVENTORY', equipementId: 0, typeEvenement: 'MAINTENANCE', description: '', cout: 0, technicien: '' });
    } catch { /* */ }
  };

  if (isLoading && historique.length === 0) return <SkeletonPage />;

  return (
    <div className="space-y-3">
      <CommandBar
        actions={[
          { label: 'Nouvelle entree', icon: <Plus size={15} />, onClick: () => setShowForm(true), variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-36 sm:w-44 shrink-0">
              <Select label="" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
                options={[{ value: '', label: 'Tous evenements' }, ...TYPE_EVENEMENT_OPTIONS]} />
            </div>
          </div>
        }
      />
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Historique de maintenance</h3>

      {filteredHistorique.length === 0 ? (
        <Alert type="info">Aucune entree d'historique.</Alert>
      ) : (
        <div className="space-y-2">
          {filteredHistorique.map((h) => (
            <div key={h.id} className="p-3 rounded border border-gray-200 dark:border-gray-700">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge color={h.typeEvenement === 'PANNE' ? 'red' : h.typeEvenement === 'INSPECTION' ? 'blue' : 'green'}>
                      {h.typeEvenement}
                    </Badge>
                    <span className="font-semibold text-sm">{h.equipementType} #{h.equipementId}</span>
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">{h.description}</div>
                  <div className="text-xs text-gray-500 mt-1 flex gap-3 flex-wrap">
                    <span>{h.dateEvenement ? formatDate(h.dateEvenement) : ''}</span>
                    {h.technicien && <span>Technicien: {h.technicien}</span>}
                    {h.cout && <span>{formatCurrency(h.cout)}</span>}
                    {h.dureeHeures && <span>{h.dureeHeures}h</span>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Nouvelle entrée historique">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Type équipement" value={form.equipementType}
              onChange={(e) => setForm({ ...form, equipementType: e.target.value })}
              options={EQUIPEMENT_TYPES} />
            <Input type="number" label="ID équipement *" value={form.equipementId}
              onChange={(e) => setForm({ ...form, equipementId: Number(e.target.value) || 0 })} />
          </div>
          <Select label="Type événement *" value={form.typeEvenement}
            onChange={(e) => setForm({ ...form, typeEvenement: e.target.value })}
            options={TYPE_EVENEMENT_OPTIONS} />
          <Textarea label="Description" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          <div className="grid grid-cols-2 gap-3">
            <Input type="number" label="Coût ($)" value={form.cout}
              onChange={(e) => setForm({ ...form, cout: Number(e.target.value) || 0 })} />
            <Input label="Technicien" value={form.technicien}
              onChange={(e) => setForm({ ...form, technicien: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowForm(false)}>Annuler</Button>
            <Button variant="primary" onClick={handleSave} disabled={!form.equipementId}>Enregistrer</Button>
          </div>
        </div>
      </Modal>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────
// Stats Tab
// ────────────────────────────────────────────────────

function StatsTab() {
  const stats = useMaintenanceStore((s) => s.stats);
  const fetchStats = useMaintenanceStore((s) => s.fetchStats);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  if (!stats) return <SkeletonPage />;

  return (
    <div className="space-y-4">
      {/* KPI Cards — StatCard pastel (harmonise avec Suivi) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
        <StatCard label="Total demandes" value={stats.total} icon={<ClipboardList size={20} />} color="blue" />
        <StatCard label="En cours" value={stats.enCours} icon={<RefreshCcw size={20} />} color="green" />
        <StatCard label="En attente" value={stats.enAttente} icon={<Clock size={20} />} color="yellow" />
        <StatCard label="Terminées ce mois" value={stats.termineesMois ?? 0} icon={<CheckCircle2 size={20} />} color="teal" />
        <StatCard label="Coût réel total" value={formatCurrency(stats.coutReel)} icon={<DollarSign size={20} />} color="purple" />
        <StatCard label="Coût estimé total" value={formatCurrency(stats.coutEstime ?? 0)} icon={<DollarSign size={20} />} color="blue" />
        <StatCard label="Planifications actives" value={stats.planificationsActives ?? 0} icon={<Calendar size={20} />} color="green" />
        <StatCard label="Planifications retard" value={stats.planificationsRetard ?? 0} icon={<AlertTriangle size={20} />} color="red" />
        <StatCard label="Alertes non lues" value={stats.alertesNonLues ?? 0} icon={<BellRing size={20} />} color="red" />
        <StatCard label="Interventions ce mois" value={stats.interventionsMois ?? 0} icon={<Wrench size={20} />} color="purple" />
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Repartition par statut</h3>
        {Object.entries(stats.parStatut || {}).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between py-1">
            <Badge color={STATUT_COLORS[k] || 'gray'}>{k}</Badge>
            <span className="font-medium">{v}</span>
          </div>
        ))}
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Repartition par priorite</h3>
        {Object.entries(stats.parPriorite || {}).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between py-1">
            <Badge color={prioriteColor(k)}>{k}</Badge>
            <span className="font-medium">{v}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
