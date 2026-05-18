/**
 * ERP React - Logistique Page
 * Dashboard + Livraisons + Equipements + Vehicules + Coordination + GPS
 */
import { useEffect, useState } from 'react';
import {
  Truck, Package, Wrench, MapPin, ClipboardList, BarChart3,
  Plus, Trash2, Navigation, AlertTriangle, CheckCircle, Search,
} from 'lucide-react';
import { useLogistiqueStore } from '@/store/useLogistiqueStore';
import * as logisticsApi from '@/api/logistics';
import type {
  MaintenanceRecord, LogisticsAlert,
} from '@/api/logistics';
import * as gpsApi from '@/api/gps';
import type { GpsVehicle, GpsLocation, GpsGeofence, GpsRoute } from '@/api/gps';
import type {
  Delivery, LogisticsEquipment, Vehicle, SiteCoordination,
} from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CommandBar } from '@/components/ui/CommandBar';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { Pagination } from '@/components/ui/Pagination';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import StatCard from '@/components/dashboard/StatCard';
import { formatDate, formatCurrency } from '@/utils/format';
import { useSortable } from '@/hooks/useSortable';
import { SortableHeader } from '@/components/ui/SortableHeader';

// ── Constants ──────────────────────────────────────

const DELIVERY_STATUT_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'planifiee', label: 'Planifiee' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'livree', label: 'Livree' },
  { value: 'annulee', label: 'Annulée' },
];

const DELIVERY_TYPES = [
  { value: '', label: 'Sélectionner...' },
  { value: 'Fournisseur', label: 'Fournisseur' },
  { value: 'Chantier', label: 'Chantier' },
  { value: 'Transfert', label: 'Transfert' },
  { value: 'Retour', label: 'Retour' },
  { value: 'Collecte', label: 'Collecte' },
];

const EQUIPMENT_CATEGORIES = [
  { value: '', label: 'Toutes' },
  { value: 'Grue', label: 'Grue' },
  { value: 'Excavatrice', label: 'Excavatrice' },
  { value: 'Chargeuse', label: 'Chargeuse' },
  { value: 'Echafaudage', label: 'Echafaudage' },
  { value: 'Compacteur', label: 'Compacteur' },
  { value: 'Betonniere', label: 'Betonniere' },
  { value: 'Generatrice', label: 'Generatrice' },
  { value: 'Autre', label: 'Autre' },
];

const EQUIPMENT_STATUT_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'disponible', label: 'Disponible' },
  { value: 'en_utilisation', label: 'En utilisation' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'reserve', label: 'Reserve' },
];

const VEHICLE_TYPES = [
  { value: '', label: 'Sélectionner...' },
  { value: 'Camionnette', label: 'Camionnette' },
  { value: 'Camion leger', label: 'Camion leger' },
  { value: 'Camion lourd', label: 'Camion lourd' },
  { value: 'Fourgonnette', label: 'Fourgonnette' },
  { value: 'Remorque', label: 'Remorque' },
  { value: 'Voiture', label: 'Voiture' },
  { value: 'Autre', label: 'Autre' },
];

const VEHICLE_STATUT_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'disponible', label: 'Disponible' },
  { value: 'en_deplacement', label: 'En deplacement' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'hors_service', label: 'Hors service' },
];

const COORDINATION_TYPES = [
  { value: '', label: 'Sélectionner...' },
  { value: 'Livraison beton', label: 'Livraison beton' },
  { value: 'Livraison materiaux', label: 'Livraison materiaux' },
  { value: 'Arrivee grue', label: 'Arrivee grue' },
  { value: 'Coulee beton', label: 'Coulee beton' },
  { value: 'Installation equipement', label: 'Installation equipement' },
  { value: 'Inspection', label: 'Inspection' },
  { value: 'Reunion de chantier', label: 'Reunion de chantier' },
  { value: 'Fermeture de rue', label: 'Fermeture de rue' },
  { value: 'Autre', label: 'Autre' },
];

const COORDINATION_STATUT_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'planifie', label: 'Planifie' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'termine', label: 'Termine' },
  { value: 'annule', label: 'Annule' },
];

type TabKey = 'dashboard' | 'deliveries' | 'equipment' | 'vehicles' | 'coordination' | 'gps';

function statutColor(s: string): 'green' | 'blue' | 'yellow' | 'red' | 'gray' | 'teal' | 'purple' {
  const lower = (s || '').toLowerCase();
  if (lower.includes('livr') || lower.includes('dispon') || lower.includes('termin') || lower.includes('complet')) return 'green';
  if (lower.includes('en_cours') || lower.includes('en_dep') || lower.includes('activ') || lower.includes('en_util')) return 'blue';
  if (lower.includes('planif') || lower.includes('reserv')) return 'yellow';
  if (lower.includes('annul') || lower.includes('hors')) return 'red';
  if (lower.includes('maint')) return 'purple';
  return 'gray';
}

// ── Main Page ──────────────────────────────────────

export default function LogistiquePage() {
  const [tab, setTab] = useState<TabKey>('dashboard');

  // Store
  const deliveries = useLogistiqueStore((s) => s.deliveries);
  const deliveriesTotal = useLogistiqueStore((s) => s.deliveriesTotal);
  const equipment = useLogistiqueStore((s) => s.equipment);
  const equipmentTotal = useLogistiqueStore((s) => s.equipmentTotal);
  const vehicles = useLogistiqueStore((s) => s.vehicles);
  const vehiclesTotal = useLogistiqueStore((s) => s.vehiclesTotal);
  const coordination = useLogistiqueStore((s) => s.coordination);
  const coordinationTotal = useLogistiqueStore((s) => s.coordinationTotal);
  const error = useLogistiqueStore((s) => s.error);
  const clearError = useLogistiqueStore((s) => s.clearError);
  const fetchStats = useLogistiqueStore((s) => s.fetchStats);

  // Initial load
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Tableau de bord', icon: <BarChart3 size={14} /> },
    { key: 'deliveries', label: `Livraisons (${deliveriesTotal || deliveries.length})`, icon: <Package size={14} /> },
    { key: 'equipment', label: `Equipements (${equipmentTotal || equipment.length})`, icon: <Wrench size={14} /> },
    { key: 'vehicles', label: `Vehicules (${vehiclesTotal || vehicles.length})`, icon: <Truck size={14} /> },
    { key: 'coordination', label: `Coordination (${coordinationTotal || coordination.length})`, icon: <ClipboardList size={14} /> },
    { key: 'gps', label: 'GPS / Carte', icon: <MapPin size={14} /> },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Logistique</h2>

      {error && <Alert type="error" onClose={clearError}>{error}</Alert>}

      {/* Tabs */}
      <div className="overflow-x-auto scrollbar-hide border-b border-gray-200 dark:border-gray-700">
        <div className="flex gap-1 whitespace-nowrap min-w-max md:min-w-0">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-seaop-primary-600 text-seaop-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}>
              <span className="flex items-center gap-1.5">{t.icon} {t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'deliveries' && <DeliveriesTab />}
      {tab === 'equipment' && <EquipmentTab />}
      {tab === 'vehicles' && <VehiclesTab />}
      {tab === 'coordination' && <CoordinationTab />}
      {tab === 'gps' && <GpsTab />}
    </div>
  );
}

// ── Dashboard Tab ──────────────────────────────────────

function DashboardTab() {
  const stats = useLogistiqueStore((s) => s.stats);
  const isLoading = useLogistiqueStore((s) => s.isLoading);
  const fetchStats = useLogistiqueStore((s) => s.fetchStats);

  const [alerts, setAlerts] = useState<LogisticsAlert[]>([]);

  const fetchAlerts = async () => {
    try {
      const data = await logisticsApi.listAlerts({ statut: 'active' });
      setAlerts(data);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!stats) fetchStats();
    fetchAlerts();
  }, [stats, fetchStats]);

  if (isLoading && !stats) return <SkeletonPage />;

  const liv = stats?.livraisons ?? { total: 0, planifiees: 0, enCours: 0, cetteSemaine: 0 };
  const eqp = stats?.equipements ?? { total: 0, disponibles: 0, enUtilisation: 0, enMaintenance: 0 };
  const veh = stats?.vehicules ?? { total: 0, disponibles: 0, enDeplacement: 0, kmTotal: 0 };
  const alertes = stats?.alertes ?? 0;

  return (
    <div className="space-y-6">
      {/* KPI row — StatCard pastel (harmonise avec Suivi) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Livraisons planifiees" value={liv.planifiees} icon={<Package size={20} />} color="blue" trend={`Total: ${liv.total}`} />
        <StatCard label="Équipements disponibles" value={eqp.disponibles} icon={<Wrench size={20} />} color="green" trend={`Total: ${eqp.total}`} />
        <StatCard label="Vehicules disponibles" value={veh.disponibles} icon={<Truck size={20} />} color="teal" trend={`Total: ${veh.total}`} />
        <StatCard label="Alertes actives" value={alertes} icon={<AlertTriangle size={20} />} color={alertes > 0 ? 'red' : 'yellow'} />
      </div>

      {/* Details row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card padding="md">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5"><Package size={14} /> Livraisons</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Planifiees</span><Badge color="yellow" size="sm">{liv.planifiees}</Badge></div>
            <div className="flex justify-between"><span className="text-gray-500">En cours</span><Badge color="blue" size="sm">{liv.enCours}</Badge></div>
            <div className="flex justify-between"><span className="text-gray-500">Cette semaine</span><Badge color="green" size="sm">{liv.cetteSemaine}</Badge></div>
          </div>
        </Card>
        <Card padding="md">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5"><Wrench size={14} /> Equipements</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Disponibles</span><Badge color="green" size="sm">{eqp.disponibles}</Badge></div>
            <div className="flex justify-between"><span className="text-gray-500">En utilisation</span><Badge color="blue" size="sm">{eqp.enUtilisation}</Badge></div>
            <div className="flex justify-between"><span className="text-gray-500">Maintenance</span><Badge color="purple" size="sm">{eqp.enMaintenance}</Badge></div>
          </div>
        </Card>
        <Card padding="md">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5"><Truck size={14} /> Vehicules</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Disponibles</span><Badge color="green" size="sm">{veh.disponibles}</Badge></div>
            <div className="flex justify-between"><span className="text-gray-500">En deplacement</span><Badge color="blue" size="sm">{veh.enDeplacement}</Badge></div>
            <div className="flex justify-between"><span className="text-gray-500">KM total</span><span className="font-medium text-gray-700 dark:text-gray-300">{(veh.kmTotal || 0).toLocaleString()}</span></div>
          </div>
        </Card>
      </div>

      {/* Alertes actives */}
      {alerts.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">Alertes actives</h3>
          <div className="space-y-2">
            {alerts.map(a => (
              <div key={a.id} className={`p-3 rounded-md border-l-4 ${
                a.priorite === 'haute' ? 'bg-[#E8919A]/10 border-[#E8919A] dark:bg-[#E8919A]/20' :
                a.priorite === 'moyenne' ? 'bg-[#F0B07A]/10 border-[#F0B07A] dark:bg-[#F0B07A]/20' :
                'bg-[#F6C87A]/10 border-[#F6C87A] dark:bg-[#F6C87A]/20'
              }`}>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium dark:text-gray-200">{a.message}</span>
                  <Badge color={a.priorite === 'haute' ? 'red' : a.priorite === 'moyenne' ? 'yellow' : 'blue'} size="sm">
                    {a.priorite}
                  </Badge>
                </div>
                {a.dateEcheance && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Échéance: {formatDate(a.dateEcheance)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Deliveries Tab ──────────────────────────────────────

function DeliveriesTab() {
  const deliveries = useLogistiqueStore((s) => s.deliveries);
  const total = useLogistiqueStore((s) => s.deliveriesTotal);
  const isLoading = useLogistiqueStore((s) => s.isLoading);
  const filters = useLogistiqueStore((s) => s.deliveryFilters);
  const setFilter = useLogistiqueStore((s) => s.setDeliveryFilter);
  const fetchDeliveries = useLogistiqueStore((s) => s.fetchDeliveries);
  const storeCreate = useLogistiqueStore((s) => s.createDelivery);
  const storeUpdate = useLogistiqueStore((s) => s.updateDelivery);
  const storeDelete = useLogistiqueStore((s) => s.deleteDelivery);

  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ datePrevue: '', typeLivraison: '', zoneStockage: '', heurePrevue: '', notes: '' });

  const searchedDeliveries = search
    ? deliveries.filter((d) => {
        const q = search.toLowerCase();
        const hay = `${d.reference || ''} ${d.typeLivraison || ''} ${d.zoneStockage || ''} ${d.notes || ''}`.toLowerCase();
        return hay.includes(q);
      })
    : deliveries;
  const { sortedItems, sortConfig, requestSort } = useSortable(searchedDeliveries);

  useEffect(() => { fetchDeliveries(); }, [filters.page, filters.statut, fetchDeliveries]);

  const handleCreate = async () => {
    if (!form.datePrevue) return;
    try {
      await storeCreate({
        datePrevue: form.datePrevue,
        typeLivraison: form.typeLivraison || undefined,
        zoneStockage: form.zoneStockage || undefined,
        heurePrevue: form.heurePrevue || undefined,
        notes: form.notes || undefined,
      });
      setShowCreate(false);
      setForm({ datePrevue: '', typeLivraison: '', zoneStockage: '', heurePrevue: '', notes: '' });
    } catch { /* error set by store */ }
  };

  const handleStatusChange = async (d: Delivery, newStatut: string) => {
    try { await storeUpdate(d.id, { statut: newStatut }); } catch {}
  };

  const handleDelete = async (d: Delivery) => {
    if (!confirm(`Supprimer la livraison ${d.reference || d.id}?`)) return;
    try { await storeDelete(d.id); } catch {}
  };

  const totalPages = Math.ceil(total / filters.perPage);

  if (isLoading && deliveries.length === 0) return <SkeletonPage />;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <CommandBar
        actions={[
          { label: 'Nouvelle livraison', icon: <Plus size={16} />, onClick: () => setShowCreate(true), variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-32 sm:w-40 shrink-0">
              <Select label="" options={DELIVERY_STATUT_OPTIONS} value={filters.statut} onChange={(e) => setFilter('statut', e.target.value)} />
            </div>
          </div>
        }
      />

      {/* Desktop table */}
      <Card padding="sm" className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <SortableHeader label="Référence" sortKey="reference" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Type" sortKey="typeLivraison" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Zone" sortKey="zoneStockage" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Statut" sortKey="statut" sortConfig={sortConfig} onSort={requestSort} align="center" />
              <SortableHeader label="Date prevue" sortKey="datePrevue" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {sortedItems.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{d.reference || `#${d.id}`}</td>
                  <td className="px-4 py-3 text-gray-500">{d.typeLivraison || '--'}</td>
                  <td className="px-4 py-3 text-gray-500">{d.zoneStockage || '--'}</td>
                  <td className="px-4 py-3 text-center">
                    <select value={d.statut || ''} onChange={(e) => handleStatusChange(d, e.target.value)}
                      className="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1">
                      {DELIVERY_STATUT_OPTIONS.filter((o) => o.value).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(d.datePrevue || '')}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(d)} className="text-[#E8919A] hover:text-[#b8616a] p-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
              {deliveries.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucune livraison</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {sortedItems.map((d) => (
          <Card key={d.id} padding="sm">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 dark:text-white">{d.reference || `#${d.id}`}</p>
                <p className="text-xs text-gray-500 mt-1">{d.typeLivraison || '--'} &middot; {d.zoneStockage || '--'}</p>
              </div>
              <Badge color={statutColor(d.statut)} size="sm">{d.statut}</Badge>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <span className="text-xs text-gray-400">{formatDate(d.datePrevue || '')}</span>
              <button onClick={() => handleDelete(d)} className="text-[#E8919A] hover:text-[#b8616a] p-1"><Trash2 size={14} /></button>
            </div>
          </Card>
        ))}
        {deliveries.length === 0 && <p className="px-4 py-8 text-center text-gray-400">Aucune livraison</p>}
      </div>

      {totalPages > 1 && <Pagination page={filters.page} totalPages={totalPages} onPageChange={(p) => setFilter('page', p)} />}

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nouvelle livraison" size="lg">
        <div className="space-y-4">
          <Input label="Date prevue *" type="date" value={form.datePrevue} onChange={(e) => setForm({ ...form, datePrevue: e.target.value })} required />
          <Input label="Heure prevue" type="time" value={form.heurePrevue} onChange={(e) => setForm({ ...form, heurePrevue: e.target.value })} />
          <Select label="Type de livraison" options={DELIVERY_TYPES} value={form.typeLivraison} onChange={(e) => setForm({ ...form, typeLivraison: e.target.value })} />
          <Input label="Zone de stockage" value={form.zoneStockage} onChange={(e) => setForm({ ...form, zoneStockage: e.target.value })} />
          <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={!form.datePrevue}>Créer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Equipment Tab ──────────────────────────────────────

function EquipmentTab() {
  const equipment = useLogistiqueStore((s) => s.equipment);
  const total = useLogistiqueStore((s) => s.equipmentTotal);
  const isLoading = useLogistiqueStore((s) => s.isLoading);
  const filters = useLogistiqueStore((s) => s.equipmentFilters);
  const setFilter = useLogistiqueStore((s) => s.setEquipmentFilter);
  const fetchEquipment = useLogistiqueStore((s) => s.fetchEquipment);
  const storeCreate = useLogistiqueStore((s) => s.createEquipment);
  const storeUpdate = useLogistiqueStore((s) => s.updateEquipment);
  const storeDelete = useLogistiqueStore((s) => s.deleteEquipment);

  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ nom: '', categorie: '', typePossession: 'propriete', coutJournalier: '', coutMensuel: '', localisationActuelle: '', notes: '' });

  // --- Maintenance state ---
  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecord[]>([]);
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [maintenanceForm, setMaintenanceForm] = useState({
    typeIntervention: 'maintenance',
    dateIntervention: '',
    description: '',
    cout: '',
    technicien: '',
    prochaineDate: '',
    conforme: true,
  });
  const [maintenanceEquipmentId, setMaintenanceEquipmentId] = useState<number | null>(null);

  const searchedEquipment = search
    ? equipment.filter((e) => {
        const q = search.toLowerCase();
        const hay = `${e.code || ''} ${e.nom || ''} ${e.categorie || ''} ${e.localisationActuelle || ''} ${e.notes || ''}`.toLowerCase();
        return hay.includes(q);
      })
    : equipment;
  const { sortedItems, sortConfig, requestSort } = useSortable(searchedEquipment);

  useEffect(() => { fetchEquipment(); }, [filters.page, filters.categorie, filters.statut, fetchEquipment]);

  // --- Maintenance handlers ---
  const fetchMaintenance = async (equipmentId: number) => {
    try {
      const data = await logisticsApi.listMaintenance(equipmentId);
      setMaintenanceRecords(data);
    } catch { /* ignore */ }
  };

  const handleSelectEquipment = (equipmentId: number) => {
    setMaintenanceEquipmentId(equipmentId);
    fetchMaintenance(equipmentId);
  };

  const handleCreateMaintenance = async () => {
    if (!maintenanceEquipmentId || !maintenanceForm.dateIntervention) return;
    try {
      await logisticsApi.createMaintenance(maintenanceEquipmentId, {
        typeIntervention: maintenanceForm.typeIntervention || undefined,
        dateIntervention: maintenanceForm.dateIntervention,
        description: maintenanceForm.description || undefined,
        cout: maintenanceForm.cout ? parseFloat(maintenanceForm.cout) : undefined,
        technicien: maintenanceForm.technicien || undefined,
        prochaineDate: maintenanceForm.prochaineDate || undefined,
        conforme: maintenanceForm.conforme,
      });
      setShowMaintenanceModal(false);
      setMaintenanceForm({ typeIntervention: 'maintenance', dateIntervention: '', description: '', cout: '', technicien: '', prochaineDate: '', conforme: true });
      fetchMaintenance(maintenanceEquipmentId);
    } catch { /* ignore */ }
  };

  const handleDeleteMaintenance = async (id: number) => {
    if (!window.confirm('Supprimer cette intervention?')) return;
    try {
      await logisticsApi.deleteMaintenance(id);
      if (maintenanceEquipmentId) fetchMaintenance(maintenanceEquipmentId);
    } catch { /* ignore */ }
  };

  const handleCreate = async () => {
    if (!form.nom.trim()) return;
    try {
      await storeCreate({
        nom: form.nom,
        categorie: form.categorie || undefined,
        typePossession: form.typePossession || undefined,
        coutJournalier: form.coutJournalier ? parseFloat(form.coutJournalier) : undefined,
        coutMensuel: form.coutMensuel ? parseFloat(form.coutMensuel) : undefined,
        localisationActuelle: form.localisationActuelle || undefined,
        notes: form.notes || undefined,
      });
      setShowCreate(false);
      setForm({ nom: '', categorie: '', typePossession: 'propriete', coutJournalier: '', coutMensuel: '', localisationActuelle: '', notes: '' });
    } catch {}
  };

  const handleStatusChange = async (e: LogisticsEquipment, newStatut: string) => {
    try { await storeUpdate(e.id, { statut: newStatut }); } catch {}
  };

  const handleDelete = async (e: LogisticsEquipment) => {
    if (!confirm(`Supprimer l'equipement ${e.nom}?`)) return;
    try { await storeDelete(e.id); } catch {}
  };

  const totalPages = Math.ceil(total / filters.perPage);

  if (isLoading && equipment.length === 0) return <SkeletonPage />;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <CommandBar
        actions={[
          { label: 'Nouvel equipement', icon: <Plus size={16} />, onClick: () => setShowCreate(true), variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-32 sm:w-40 shrink-0">
              <Select label="" options={EQUIPMENT_CATEGORIES} value={filters.categorie} onChange={(e) => setFilter('categorie', e.target.value)} />
            </div>
            <div className="w-32 sm:w-40 shrink-0">
              <Select label="" options={EQUIPMENT_STATUT_OPTIONS} value={filters.statut} onChange={(e) => setFilter('statut', e.target.value)} />
            </div>
          </div>
        }
      />

      {/* Desktop table */}
      <Card padding="sm" className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <SortableHeader label="Code" sortKey="code" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Nom" sortKey="nom" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Catégorie" sortKey="categorie" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Statut" sortKey="statut" sortConfig={sortConfig} onSort={requestSort} align="center" />
              <SortableHeader label="Localisation" sortKey="localisationActuelle" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Coût/jour" sortKey="coutJournalier" sortConfig={sortConfig} onSort={requestSort} align="right" />
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {sortedItems.map((e) => (
                <tr key={e.id} onClick={() => handleSelectEquipment(e.id)}
                  className={`hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer ${maintenanceEquipmentId === e.id ? 'bg-[#7BAFD4]/10 dark:bg-[#7BAFD4]/20' : ''}`}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{e.code || `#${e.id}`}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{e.nom}</td>
                  <td className="px-4 py-3"><Badge color="blue" size="sm">{e.categorie || '--'}</Badge></td>
                  <td className="px-4 py-3 text-center">
                    <select value={e.statut || ''} onChange={(ev) => { ev.stopPropagation(); handleStatusChange(e, ev.target.value); }}
                      className="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1">
                      {EQUIPMENT_STATUT_OPTIONS.filter((o) => o.value).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{e.localisationActuelle || '--'}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{e.coutJournalier ? formatCurrency(e.coutJournalier) : '--'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={(ev) => { ev.stopPropagation(); handleDelete(e); }} className="text-[#E8919A] hover:text-[#b8616a] p-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
              {equipment.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucun équipement</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {sortedItems.map((e) => (
          <Card key={e.id} padding="sm" className={`cursor-pointer ${maintenanceEquipmentId === e.id ? 'ring-2 ring-blue-500' : ''}`}>
            <div className="flex items-start justify-between" onClick={() => handleSelectEquipment(e.id)}>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 dark:text-white">{e.nom}</p>
                <p className="text-xs text-gray-500 mt-1">{e.categorie || '--'} &middot; {e.code || `#${e.id}`}</p>
              </div>
              <Badge color={statutColor(e.statut)} size="sm">{e.statut}</Badge>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center text-xs">
              <span className="text-gray-400">{e.localisationActuelle || '--'}</span>
              <div className="flex items-center gap-2">
                {e.coutJournalier && <span className="text-gray-500">{formatCurrency(e.coutJournalier)}/j</span>}
                <button onClick={() => handleDelete(e)} className="text-[#E8919A] hover:text-[#b8616a] p-1"><Trash2 size={14} /></button>
              </div>
            </div>
          </Card>
        ))}
        {equipment.length === 0 && <p className="px-4 py-8 text-center text-gray-400">Aucun équipement</p>}
      </div>

      {totalPages > 1 && <Pagination page={filters.page} totalPages={totalPages} onPageChange={(p) => setFilter('page', p)} />}

      {/* Maintenance Section */}
      {maintenanceEquipmentId && (
        <Card padding="md" className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
              <Wrench size={14} /> Historique de maintenance — {equipment.find(eq => eq.id === maintenanceEquipmentId)?.nom || `#${maintenanceEquipmentId}`}
            </h3>
            <Button size="sm" onClick={() => setShowMaintenanceModal(true)} className="flex items-center gap-1">
              <Plus size={14} /> Ajouter intervention
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Technicien</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Coût</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-gray-500 uppercase">Conforme</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {maintenanceRecords.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-4 py-2 text-gray-900 dark:text-white text-xs">{formatDate(m.dateIntervention)}</td>
                    <td className="px-4 py-2"><Badge color="purple" size="sm">{m.typeIntervention || '--'}</Badge></td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{m.technicien || '--'}</td>
                    <td className="px-4 py-2 text-right text-gray-500 text-xs">{m.cout ? formatCurrency(m.cout) : '--'}</td>
                    <td className="px-4 py-2 text-center">
                      {m.conforme
                        ? <CheckCircle size={14} className="inline text-[#7DC4A5]" />
                        : <AlertTriangle size={14} className="inline text-[#E8919A]" />}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => handleDeleteMaintenance(m.id)} className="text-[#E8919A] hover:text-[#b8616a] p-1"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
                {maintenanceRecords.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400 text-sm">Aucune intervention enregistree</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nouvel équipement" size="lg">
        <div className="space-y-4">
          <Input label="Nom *" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select label="Catégorie" options={EQUIPMENT_CATEGORIES} value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })} />
            <Select label="Type de possession" options={[{ value: 'propriete', label: 'Propriété' }, { value: 'location', label: 'Location' }]} value={form.typePossession} onChange={(e) => setForm({ ...form, typePossession: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Coût journalier ($)" type="number" value={form.coutJournalier} onChange={(e) => setForm({ ...form, coutJournalier: e.target.value })} />
            <Input label="Coût mensuel ($)" type="number" value={form.coutMensuel} onChange={(e) => setForm({ ...form, coutMensuel: e.target.value })} />
          </div>
          <Input label="Localisation actuelle" value={form.localisationActuelle} onChange={(e) => setForm({ ...form, localisationActuelle: e.target.value })} />
          <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={!form.nom.trim()}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Maintenance Modal */}
      <Modal isOpen={showMaintenanceModal} onClose={() => setShowMaintenanceModal(false)} title="Nouvelle intervention de maintenance" size="lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Type d'intervention"
            value={maintenanceForm.typeIntervention}
            onChange={(e) => setMaintenanceForm(p => ({ ...p, typeIntervention: e.target.value }))}
            options={[
              { value: 'maintenance', label: 'Maintenance préventive' },
              { value: 'inspection', label: 'Inspection' },
              { value: 'reparation', label: 'Reparation' },
              { value: 'certification', label: 'Certification' },
            ]}
          />
          <Input
            label="Date intervention *"
            type="date"
            value={maintenanceForm.dateIntervention}
            onChange={(e) => setMaintenanceForm(p => ({ ...p, dateIntervention: e.target.value }))}
            required
          />
          <Input
            label="Technicien"
            value={maintenanceForm.technicien}
            onChange={(e) => setMaintenanceForm(p => ({ ...p, technicien: e.target.value }))}
          />
          <Input
            label="Coût ($)"
            type="number"
            value={maintenanceForm.cout}
            onChange={(e) => setMaintenanceForm(p => ({ ...p, cout: e.target.value }))}
          />
          <Input
            label="Prochaine date"
            type="date"
            value={maintenanceForm.prochaineDate}
            onChange={(e) => setMaintenanceForm(p => ({ ...p, prochaineDate: e.target.value }))}
          />
          <div className="flex items-center gap-2 mt-4">
            <input
              id="maint-conforme"
              type="checkbox"
              checked={maintenanceForm.conforme}
              onChange={(e) => setMaintenanceForm(p => ({ ...p, conforme: e.target.checked }))}
            />
            <label htmlFor="maint-conforme" className="text-sm dark:text-gray-300">Conforme</label>
          </div>
          <div className="md:col-span-2">
            <Textarea
              label="Description"
              value={maintenanceForm.description}
              onChange={(e) => setMaintenanceForm(p => ({ ...p, description: e.target.value }))}
              rows={2}
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <Button variant="ghost" onClick={() => setShowMaintenanceModal(false)}>Annuler</Button>
          <Button onClick={handleCreateMaintenance} disabled={!maintenanceForm.dateIntervention}>Créer</Button>
        </div>
      </Modal>
    </div>
  );
}

// ── Vehicles Tab ──────────────────────────────────────

function VehiclesTab() {
  const vehicles = useLogistiqueStore((s) => s.vehicles);
  const isLoading = useLogistiqueStore((s) => s.isLoading);
  const filters = useLogistiqueStore((s) => s.vehicleFilters);
  const setFilter = useLogistiqueStore((s) => s.setVehicleFilter);
  const fetchVehicles = useLogistiqueStore((s) => s.fetchVehicles);
  const storeCreate = useLogistiqueStore((s) => s.createVehicle);
  const storeUpdate = useLogistiqueStore((s) => s.updateVehicle);
  const storeDelete = useLogistiqueStore((s) => s.deleteVehicle);

  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    immatriculation: '', marque: '', modele: '', annee: '', typeVehicule: '',
    capaciteCharge: '', uniteCapacite: 'kg', kilometrage: '', consommationMoyenne: '', coutKm: '', notes: '',
  });

  const searchedVehicles = search
    ? vehicles.filter((v) => {
        const q = search.toLowerCase();
        const hay = `${v.immatriculation || ''} ${v.marque || ''} ${v.modele || ''} ${v.typeVehicule || ''}`.toLowerCase();
        return hay.includes(q);
      })
    : vehicles;
  const { sortedItems, sortConfig, requestSort } = useSortable(searchedVehicles);

  useEffect(() => { fetchVehicles(); }, [filters.statut, fetchVehicles]);

  const handleCreate = async () => {
    if (!form.immatriculation.trim()) return;
    try {
      await storeCreate({
        immatriculation: form.immatriculation,
        marque: form.marque || undefined,
        modele: form.modele || undefined,
        annee: form.annee ? parseInt(form.annee) : undefined,
        typeVehicule: form.typeVehicule || undefined,
        capaciteCharge: form.capaciteCharge ? parseFloat(form.capaciteCharge) : undefined,
        uniteCapacite: form.uniteCapacite || undefined,
        kilometrage: form.kilometrage ? parseFloat(form.kilometrage) : undefined,
        consommationMoyenne: form.consommationMoyenne ? parseFloat(form.consommationMoyenne) : undefined,
        coutKm: form.coutKm ? parseFloat(form.coutKm) : undefined,
        notes: form.notes || undefined,
      });
      setShowCreate(false);
      setForm({ immatriculation: '', marque: '', modele: '', annee: '', typeVehicule: '', capaciteCharge: '', uniteCapacite: 'kg', kilometrage: '', consommationMoyenne: '', coutKm: '', notes: '' });
    } catch {}
  };

  const handleStatusChange = async (v: Vehicle, newStatut: string) => {
    try { await storeUpdate(v.id, { statut: newStatut }); } catch {}
  };

  const handleDelete = async (v: Vehicle) => {
    if (!confirm(`Supprimer le vehicule ${v.immatriculation}?`)) return;
    try { await storeDelete(v.id); } catch {}
  };

  if (isLoading && vehicles.length === 0) return <SkeletonPage />;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <CommandBar
        actions={[
          { label: 'Nouveau vehicule', icon: <Plus size={16} />, onClick: () => setShowCreate(true), variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-32 sm:w-40 shrink-0">
              <Select label="" options={VEHICLE_STATUT_OPTIONS} value={filters.statut} onChange={(e) => setFilter('statut', e.target.value)} />
            </div>
          </div>
        }
      />

      {/* Desktop table */}
      <Card padding="sm" className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <SortableHeader label="Vehicule" sortKey="marque" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Immatriculation" sortKey="immatriculation" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Type" sortKey="typeVehicule" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Statut" sortKey="statut" sortConfig={sortConfig} onSort={requestSort} align="center" />
              <SortableHeader label="KM" sortKey="kilometrage" sortConfig={sortConfig} onSort={requestSort} align="right" />
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {sortedItems.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{v.marque || ''} {v.modele || ''}</td>
                  <td className="px-4 py-3 text-gray-500">{v.immatriculation}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{v.typeVehicule || '--'}</td>
                  <td className="px-4 py-3 text-center">
                    <select value={v.statut || ''} onChange={(e) => handleStatusChange(v, e.target.value)}
                      className="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1">
                      {VEHICLE_STATUT_OPTIONS.filter((o) => o.value).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">{v.kilometrage != null ? Number(v.kilometrage).toLocaleString() : '--'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(v)} className="text-[#E8919A] hover:text-[#b8616a] p-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
              {vehicles.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucun vehicule</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {sortedItems.map((v) => (
          <Card key={v.id} padding="sm">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 dark:text-white">{v.marque || ''} {v.modele || ''}</p>
                <p className="text-xs text-gray-500 mt-1">{v.immatriculation} &middot; {v.typeVehicule || '--'}</p>
              </div>
              <Badge color={statutColor(v.statut)} size="sm">{v.statut}</Badge>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center text-xs">
              <span className="text-gray-500">KM: <span className="font-medium text-gray-900 dark:text-white">{v.kilometrage != null ? Number(v.kilometrage).toLocaleString() : '--'}</span></span>
              <button onClick={() => handleDelete(v)} className="text-[#E8919A] hover:text-[#b8616a] p-1"><Trash2 size={14} /></button>
            </div>
          </Card>
        ))}
        {vehicles.length === 0 && <p className="px-4 py-8 text-center text-gray-400">Aucun vehicule</p>}
      </div>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nouveau vehicule" size="lg">
        <div className="space-y-4">
          <Input label="Immatriculation *" value={form.immatriculation} onChange={(e) => setForm({ ...form, immatriculation: e.target.value })} required />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Marque" value={form.marque} onChange={(e) => setForm({ ...form, marque: e.target.value })} />
            <Input label="Modele" value={form.modele} onChange={(e) => setForm({ ...form, modele: e.target.value })} />
            <Input label="Année" type="number" value={form.annee} onChange={(e) => setForm({ ...form, annee: e.target.value })} />
          </div>
          <Select label="Type de vehicule" options={VEHICLE_TYPES} value={form.typeVehicule} onChange={(e) => setForm({ ...form, typeVehicule: e.target.value })} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Capacite charge" type="number" value={form.capaciteCharge} onChange={(e) => setForm({ ...form, capaciteCharge: e.target.value })} />
            <Select label="Unité" options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }, { value: 'tonnes', label: 'tonnes' }]} value={form.uniteCapacite} onChange={(e) => setForm({ ...form, uniteCapacite: e.target.value })} />
            <Input label="Kilometrage" type="number" value={form.kilometrage} onChange={(e) => setForm({ ...form, kilometrage: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Consommation (L/100km)" type="number" value={form.consommationMoyenne} onChange={(e) => setForm({ ...form, consommationMoyenne: e.target.value })} />
            <Input label="Coût par km ($)" type="number" value={form.coutKm} onChange={(e) => setForm({ ...form, coutKm: e.target.value })} />
          </div>
          <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={!form.immatriculation.trim()}>Créer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Coordination Tab ──────────────────────────────────────

function CoordinationTab() {
  const coordination = useLogistiqueStore((s) => s.coordination);
  const total = useLogistiqueStore((s) => s.coordinationTotal);
  const isLoading = useLogistiqueStore((s) => s.isLoading);
  const filters = useLogistiqueStore((s) => s.coordinationFilters);
  const setFilter = useLogistiqueStore((s) => s.setCoordinationFilter);
  const fetchCoordination = useLogistiqueStore((s) => s.fetchCoordination);
  const storeCreate = useLogistiqueStore((s) => s.createCoordination);
  const storeUpdate = useLogistiqueStore((s) => s.updateCoordination);
  const storeDelete = useLogistiqueStore((s) => s.deleteCoordination);

  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ dateCoordination: '', typeActivite: '', heureDebut: '', heureFin: '', zoneConcernee: '', responsable: '', notes: '' });

  const searchedCoordination = search
    ? coordination.filter((c) => {
        const q = search.toLowerCase();
        const hay = `${c.typeActivite || ''} ${c.zoneConcernee || ''} ${c.responsable || ''} ${c.notes || ''}`.toLowerCase();
        return hay.includes(q);
      })
    : coordination;
  const { sortedItems, sortConfig, requestSort } = useSortable(searchedCoordination);

  useEffect(() => { fetchCoordination(); }, [filters.page, filters.statut, fetchCoordination]);

  const handleCreate = async () => {
    if (!form.dateCoordination || !form.typeActivite) return;
    try {
      await storeCreate({
        dateCoordination: form.dateCoordination,
        typeActivite: form.typeActivite,
        heureDebut: form.heureDebut || undefined,
        heureFin: form.heureFin || undefined,
        zoneConcernee: form.zoneConcernee || undefined,
        responsable: form.responsable || undefined,
        notes: form.notes || undefined,
      });
      setShowCreate(false);
      setForm({ dateCoordination: '', typeActivite: '', heureDebut: '', heureFin: '', zoneConcernee: '', responsable: '', notes: '' });
    } catch {}
  };

  const handleStatusChange = async (c: SiteCoordination, newStatut: string) => {
    try { await storeUpdate(c.id, { statut: newStatut }); } catch {}
  };

  const handleDelete = async (c: SiteCoordination) => {
    if (!confirm('Supprimer cette activite de coordination?')) return;
    try { await storeDelete(c.id); } catch {}
  };

  const totalPages = Math.ceil(total / filters.perPage);

  if (isLoading && coordination.length === 0) return <SkeletonPage />;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <CommandBar
        actions={[
          { label: 'Nouvelle activite', icon: <Plus size={16} />, onClick: () => setShowCreate(true), variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-32 sm:w-40 shrink-0">
              <Select label="" options={COORDINATION_STATUT_OPTIONS} value={filters.statut} onChange={(e) => setFilter('statut', e.target.value)} />
            </div>
          </div>
        }
      />

      {/* Desktop table */}
      <Card padding="sm" className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <SortableHeader label="Date" sortKey="dateCoordination" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Type" sortKey="typeActivite" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Horaire" sortKey="heureDebut" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Zone" sortKey="zoneConcernee" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Responsable" sortKey="responsable" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Statut" sortKey="statut" sortConfig={sortConfig} onSort={requestSort} align="center" />
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {sortedItems.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="px-4 py-3 text-gray-900 dark:text-white">{formatDate(c.dateCoordination || '')}</td>
                  <td className="px-4 py-3"><Badge color="blue" size="sm">{c.typeActivite || '--'}</Badge></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {c.heureDebut || '--'}{c.heureFin ? ` - ${c.heureFin}` : ''}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{c.zoneConcernee || '--'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.responsable || '--'}</td>
                  <td className="px-4 py-3 text-center">
                    <select value={c.statut || ''} onChange={(e) => handleStatusChange(c, e.target.value)}
                      className="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1">
                      {COORDINATION_STATUT_OPTIONS.filter((o) => o.value).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(c)} className="text-[#E8919A] hover:text-[#b8616a] p-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
              {coordination.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucune activite de coordination</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {sortedItems.map((c) => (
          <Card key={c.id} padding="sm">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 dark:text-white">{c.typeActivite || '--'}</p>
                <p className="text-xs text-gray-500 mt-1">{formatDate(c.dateCoordination || '')} &middot; {c.heureDebut || '--'}{c.heureFin ? ` - ${c.heureFin}` : ''}</p>
              </div>
              <Badge color={statutColor(c.statut)} size="sm">{c.statut}</Badge>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center text-xs">
              <span className="text-gray-400">{c.zoneConcernee || '--'} &middot; {c.responsable || '--'}</span>
              <button onClick={() => handleDelete(c)} className="text-[#E8919A] hover:text-[#b8616a] p-1"><Trash2 size={14} /></button>
            </div>
          </Card>
        ))}
        {coordination.length === 0 && <p className="px-4 py-8 text-center text-gray-400">Aucune activite de coordination</p>}
      </div>

      {totalPages > 1 && <Pagination page={filters.page} totalPages={totalPages} onPageChange={(p) => setFilter('page', p)} />}

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nouvelle activité de coordination" size="lg">
        <div className="space-y-4">
          <Input label="Date *" type="date" value={form.dateCoordination} onChange={(e) => setForm({ ...form, dateCoordination: e.target.value })} required />
          <Select label="Type d'activité *" options={COORDINATION_TYPES} value={form.typeActivite} onChange={(e) => setForm({ ...form, typeActivite: e.target.value })} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Heure début" type="time" value={form.heureDebut} onChange={(e) => setForm({ ...form, heureDebut: e.target.value })} />
            <Input label="Heure fin" type="time" value={form.heureFin} onChange={(e) => setForm({ ...form, heureFin: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Zone concernée" value={form.zoneConcernee} onChange={(e) => setForm({ ...form, zoneConcernee: e.target.value })} />
            <Input label="Responsable" value={form.responsable} onChange={(e) => setForm({ ...form, responsable: e.target.value })} />
          </div>
          <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={!form.dateCoordination || !form.typeActivite}>Créer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── GPS Tab (preserved from original) ──────────────────────────────────────

function GpsTab() {
  const [gpsVehicles, setGpsVehicles] = useState<GpsVehicle[]>([]);
  const [locations, setLocations] = useState<GpsLocation[]>([]);
  const [geofences, setGeofences] = useState<GpsGeofence[]>([]);
  const [routes, setRoutes] = useState<GpsRoute[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [subTab, setSubTab] = useState<'vehicles' | 'locations' | 'geofences' | 'routes'>('vehicles');
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [locForm, setLocForm] = useState({ nom: '', latitude: '', longitude: '', typeLieu: 'chantier', ville: '' });

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      gpsApi.listVehicles(),
      gpsApi.listLocations(),
      gpsApi.listGeofences(),
      gpsApi.listRoutes(),
    ])
      .then(([v, l, g, r]) => {
        setGpsVehicles(v.items || []);
        setLocations(l.items || []);
        setGeofences(g.items || []);
        setRoutes(r.items || []);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const handleAddLocation = async () => {
    if (!locForm.nom.trim() || !locForm.latitude || !locForm.longitude) return;
    try {
      await gpsApi.createLocation({
        nom: locForm.nom,
        typeLieu: locForm.typeLieu,
        latitude: parseFloat(locForm.latitude),
        longitude: parseFloat(locForm.longitude),
        ville: locForm.ville || undefined,
      });
      setShowAddLocation(false);
      setLocForm({ nom: '', latitude: '', longitude: '', typeLieu: 'chantier', ville: '' });
      const res = await gpsApi.listLocations();
      setLocations(res.items || []);
    } catch {}
  };

  if (isLoading) return <SkeletonPage />;

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-2 flex-wrap">
        {([
          { key: 'vehicles' as const, label: `Vehicules GPS (${gpsVehicles.length})`, icon: <Truck size={14} /> },
          { key: 'locations' as const, label: `Lieux (${locations.length})`, icon: <MapPin size={14} /> },
          { key: 'geofences' as const, label: `Geofences (${geofences.length})`, icon: <Navigation size={14} /> },
          { key: 'routes' as const, label: `Routes (${routes.length})`, icon: <Navigation size={14} /> },
        ]).map((t) => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              subTab === t.key ? 'bg-seaop-primary-100 text-seaop-primary-700 dark:bg-seaop-primary-900/30 dark:text-seaop-primary-300'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Vehicles with GPS */}
      {subTab === 'vehicles' && (
        <>
          <Card padding="sm" className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Vehicule</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Immatriculation</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Latitude</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Longitude</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Vitesse</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Derniere pos.</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {gpsVehicles.map((v) => (
                    <tr key={v.id}>
                      <td className="px-4 py-3 text-gray-900 dark:text-white">{v.marque} {v.modele}</td>
                      <td className="px-4 py-3 text-gray-500">{v.immatriculation || '--'}</td>
                      <td className="px-4 py-3 text-center"><Badge color={v.statut === 'Disponible' ? 'green' : 'yellow'} size="sm">{v.statut || '--'}</Badge></td>
                      <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">{v.latitude?.toFixed(6) || '--'}</td>
                      <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">{v.longitude?.toFixed(6) || '--'}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{v.vitesse != null ? `${(v.vitesse ?? 0).toFixed(0)} km/h` : '--'}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{v.dernierePosition ? formatDate(v.dernierePosition) : '--'}</td>
                    </tr>
                  ))}
                  {gpsVehicles.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucun véhicule avec données GPS</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="md:hidden space-y-3">
            {gpsVehicles.map((v) => (
              <Card key={v.id} padding="sm">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">{v.marque} {v.modele}</p>
                    <p className="text-xs text-gray-500 mt-1">{v.immatriculation || '--'}</p>
                  </div>
                  <Badge color={v.statut === 'Disponible' ? 'green' : 'yellow'} size="sm">{v.statut || '--'}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-xs">
                  <div><span className="text-gray-400">Lat:</span> <span className="font-mono text-gray-500">{v.latitude?.toFixed(6) || '--'}</span></div>
                  <div><span className="text-gray-400">Lng:</span> <span className="font-mono text-gray-500">{v.longitude?.toFixed(6) || '--'}</span></div>
                  <div><span className="text-gray-400">Vitesse:</span> <span className="text-gray-500">{v.vitesse != null ? `${(v.vitesse ?? 0).toFixed(0)} km/h` : '--'}</span></div>
                  <div><span className="text-gray-400">Pos.:</span> <span className="text-gray-500">{v.dernierePosition ? formatDate(v.dernierePosition) : '--'}</span></div>
                </div>
              </Card>
            ))}
            {gpsVehicles.length === 0 && <p className="px-4 py-8 text-center text-gray-400">Aucun véhicule avec données GPS</p>}
          </div>
        </>
      )}

      {/* Locations */}
      {subTab === 'locations' && (
        <>
          <CommandBar
            actions={[
              { label: 'Ajouter lieu', icon: <Plus size={16} />, onClick: () => setShowAddLocation(true), variant: 'primary' },
            ]}
          />
          <Card padding="sm" className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Latitude</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Longitude</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Ville</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {locations.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{l.nom}</td>
                      <td className="px-4 py-3"><Badge color="blue" size="sm">{l.typeLieu}</Badge></td>
                      <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">{l.latitude?.toFixed(6)}</td>
                      <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">{l.longitude?.toFixed(6)}</td>
                      <td className="px-4 py-3 text-gray-500">{l.ville || '--'}</td>
                    </tr>
                  ))}
                  {locations.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Aucun lieu enregistré</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="md:hidden space-y-3">
            {locations.map((l) => (
              <Card key={l.id} padding="sm">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-white truncate">{l.nom}</p>
                    <p className="text-xs text-gray-500 mt-1">{l.ville || '--'}</p>
                  </div>
                  <Badge color="blue" size="sm">{l.typeLieu}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-xs">
                  <div><span className="text-gray-400">Lat:</span> <span className="font-mono text-gray-500">{l.latitude?.toFixed(6)}</span></div>
                  <div><span className="text-gray-400">Lng:</span> <span className="font-mono text-gray-500">{l.longitude?.toFixed(6)}</span></div>
                </div>
              </Card>
            ))}
            {locations.length === 0 && <p className="px-4 py-8 text-center text-gray-400">Aucun lieu enregistré</p>}
          </div>

          <Modal isOpen={showAddLocation} onClose={() => setShowAddLocation(false)} title="Ajouter un lieu GPS">
            <div className="space-y-4">
              <Input label="Nom *" value={locForm.nom} onChange={(e) => setLocForm({ ...locForm, nom: e.target.value })} required />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input label="Latitude *" type="number" value={locForm.latitude} onChange={(e) => setLocForm({ ...locForm, latitude: e.target.value })} required />
                <Input label="Longitude *" type="number" value={locForm.longitude} onChange={(e) => setLocForm({ ...locForm, longitude: e.target.value })} required />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input label="Type" value={locForm.typeLieu} onChange={(e) => setLocForm({ ...locForm, typeLieu: e.target.value })} />
                <Input label="Ville" value={locForm.ville} onChange={(e) => setLocForm({ ...locForm, ville: e.target.value })} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setShowAddLocation(false)}>Annuler</Button>
                <Button onClick={handleAddLocation} disabled={!locForm.nom.trim() || !locForm.latitude || !locForm.longitude}>Ajouter</Button>
              </div>
            </div>
          </Modal>
        </>
      )}

      {/* Geofences */}
      {subTab === 'geofences' && (
        <Card padding="sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type zone</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Centre (lat)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Centre (lng)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Rayon (m)</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Alertes</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {geofences.map((g) => (
                  <tr key={g.id}>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{g.nom}</td>
                    <td className="px-4 py-3"><Badge color="purple" size="sm">{g.typeZone}</Badge></td>
                    <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">{g.latitudeCentre?.toFixed(6)}</td>
                    <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">{g.longitudeCentre?.toFixed(6)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{g.rayonMetres}m</td>
                    <td className="px-4 py-3 text-center text-xs text-gray-400">
                      {g.alerteEntree && <span className="mr-1">Entree</span>}
                      {g.alerteSortie && <span>Sortie</span>}
                    </td>
                  </tr>
                ))}
                {geofences.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucune geofence</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Routes */}
      {subTab === 'routes' && (
        <Card padding="sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Origine</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Distance (km)</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Destination</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {routes.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{r.origine || `Route #${r.id}`}</td>
                    <td className="px-4 py-3"><Badge color={statutColor(r.statut || '')} size="sm">{r.statut || '--'}</Badge></td>
                    <td className="px-4 py-3 text-right text-gray-500">{r.distanceKm?.toFixed(1) || '--'}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{r.destination || '--'}</td>
                  </tr>
                ))}
                {routes.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Aucune route</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

