/**
 * ERP React - Location Page (Equipment Rental)
 * Tableau de bord + Catalogue (CRUD) + Contrats (detail/lines) + Retours (inspection)
 * + Employes (4 sub-tabs) + Statistiques
 */
import { useEffect, useState, useRef } from 'react';
import {
  HardHat, FileText, BarChart3, Plus, Pencil, RotateCcw,
  Users, Package, DollarSign, ClipboardList, CheckCircle2,
  Trash2, Eye, Wrench, Clock, Search,
} from 'lucide-react';
import { useLocationStore } from '@/store/useLocationStore';
import * as locApi from '@/api/location';
import type {
  RentalItem, RentalContract, RentalContratLigne, RentalRetour,
  RentalEmployee, RentalEmployeeContract, RentalEmployeeStats,
} from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CommandBar } from '@/components/ui/CommandBar';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import StatCard from '@/components/dashboard/StatCard';
import { formatCurrency, formatDate } from '@/utils/format';
import { useSortable } from '@/hooks/useSortable';
import { SortableHeader } from '@/components/ui/SortableHeader';

// ── Constants ──────────────────────────────────────

const CONTRACT_STATUTS_FULL = [
  { value: '', label: 'Tous' },
  { value: 'BROUILLON', label: 'Brouillon' },
  { value: 'RESERVE', label: 'Reserve' },
  { value: 'EN_COURS', label: 'En cours' },
  { value: 'RETOURNE', label: 'Retourné' },
  { value: 'FACTURE', label: 'Facturé' },
  { value: 'ANNULE', label: 'Annulé' },
  { value: 'EN_RETARD', label: 'En retard' },
];

const EQUIPMENT_CATEGORIES = [
  { value: '', label: 'Toutes' },
  { value: 'Excavatrice', label: 'Excavatrice' },
  { value: 'Grue', label: 'Grue' },
  { value: 'Chargeuse', label: 'Chargeuse' },
  { value: 'Compacteur', label: 'Compacteur' },
  { value: 'Echafaudage', label: 'Échafaudage' },
  { value: 'Betonniere', label: 'Bétonnière' },
  { value: 'Generatrice', label: 'Génératrice' },
  { value: 'Nacelle', label: 'Nacelle' },
  { value: 'Outil', label: 'Outil' },
  { value: 'Autre', label: 'Autre' },
];

const EQUIPMENT_ETATS = [
  { value: '', label: 'Tous' },
  { value: 'NEUF', label: 'Neuf' },
  { value: 'EXCELLENT', label: 'Excellent' },
  { value: 'BON', label: 'Bon' },
  { value: 'ACCEPTABLE', label: 'Acceptable' },
  { value: 'USURE', label: 'Usure' },
  { value: 'REPARATION', label: 'Réparation' },
];

const METIERS_CCQ = [
  { value: '', label: 'Tous' },
  { value: 'Charpentier-menuisier', label: 'Charpentier-menuisier' },
  { value: 'Electricien', label: 'Électricien' },
  { value: 'Plombier', label: 'Plombier' },
  { value: 'Soudeur', label: 'Soudeur' },
  { value: 'Operateur equipement lourd', label: 'Opérateur équipement lourd' },
  { value: 'Grutier', label: 'Grutier' },
  { value: 'Briqueteur-macon', label: 'Briqueteur-maçon' },
  { value: 'Peintre', label: 'Peintre' },
  { value: 'Mecanicien de chantier', label: 'Mécanicien de chantier' },
  { value: 'Manoeuvre', label: 'Manœuvre' },
  { value: 'Contremaitre', label: 'Contremaître' },
  { value: 'Autre', label: 'Autre' },
];

const TARIF_TYPES = [
  { value: 'JOUR', label: 'Par jour' },
  { value: 'SEMAINE', label: 'Par semaine' },
  { value: 'MOIS', label: 'Par mois' },
  { value: 'FORFAIT', label: 'Forfait' },
];

const EMPLOYEE_STATUTS = [
  { value: 'DISPONIBLE', label: 'Disponible' },
  { value: 'EN_LOCATION', label: 'En location' },
  { value: 'INDISPONIBLE', label: 'Indisponible' },
  { value: 'EN_CONGE', label: 'En congé' },
];

const EMPLOYEE_CONTRACT_STATUTS = [
  { value: 'BROUILLON', label: 'Brouillon' },
  { value: 'EN_COURS', label: 'En cours' },
  { value: 'TERMINE', label: 'Terminé' },
  { value: 'FACTURE', label: 'Facturé' },
  { value: 'ANNULE', label: 'Annulé' },
];

type TabKey = 'dashboard' | 'catalogue' | 'contrats' | 'retours' | 'employes' | 'statistiques';

function statutColor(s: string): 'green' | 'blue' | 'yellow' | 'red' | 'gray' | 'teal' | 'purple' {
  const lower = (s || '').toLowerCase();
  if (lower.includes('actif') || lower.includes('disponible') || lower.includes('neuf') || lower.includes('excellent')) return 'green';
  if (lower.includes('en_cours') || lower.includes('reserve') || lower.includes('bon')) return 'blue';
  if (lower.includes('retard') || lower.includes('acceptable') || lower.includes('usure')) return 'yellow';
  if (lower.includes('annul') || lower.includes('reparation')) return 'red';
  if (lower.includes('termin') || lower.includes('retourne') || lower.includes('complet') || lower.includes('facture')) return 'teal';
  if (lower.includes('brouillon')) return 'gray';
  return 'gray';
}

// ── Main Component ─────────────────────────────────

export default function LocationPage() {
  const [tab, setTab] = useState<TabKey>('dashboard');
  const [initialized, setInitialized] = useState(false);

  const {
    items, contracts, stats, returns, employees, employeeContracts, employeeStats,
    selectedContract,
    error,
    contractFilters,
    fetchItems, fetchContracts, fetchStats,
    createItem, updateItem, deleteItem,
    createContract, updateContract, deleteContract,
    fetchContractDetail, clearSelectedContract,
    addContractLine, deleteContractLine,
    fetchReturns, createReturn,
    fetchEmployees, updateEmployeeConfig,
    fetchEmployeeContracts, createEmployeeContract, updateEmployeeContract, recordEmployeeHours,
    fetchEmployeeStats,
    setContractFilter, clearError,
  } = useLocationStore();

  // Initial load — skeleton only shows until these complete.
  // DO NOT re-gate on isLoading afterwards: sub-tabs (Retours, Employes) call
  // fetchReturns/fetchEmployees which set isLoading=true. On an empty tenant
  // (items=[], contracts=[]) that would re-activate a skeleton guard and cause
  // an infinite mount/unmount loop between SkeletonPage and the tab content.
  useEffect(() => {
    const loadAll = async () => {
      try {
        await Promise.all([fetchItems(), fetchContracts(), fetchStats()]);
      } finally {
        setInitialized(true);
      }
    };
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch contracts when filters change (skip the initial render — already loaded above)
  const isFirstFilterRender = useRef(true);
  useEffect(() => {
    if (isFirstFilterRender.current) {
      isFirstFilterRender.current = false;
      return;
    }
    fetchContracts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractFilters.statut]);

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Tableau de bord', icon: <BarChart3 size={14} /> },
    { key: 'catalogue', label: `Catalogue (${items.length})`, icon: <HardHat size={14} /> },
    { key: 'contrats', label: `Contrats (${contracts.length})`, icon: <FileText size={14} /> },
    { key: 'retours', label: 'Retours', icon: <RotateCcw size={14} /> },
    { key: 'employes', label: 'Employés', icon: <Users size={14} /> },
    { key: 'statistiques', label: 'Statistiques', icon: <ClipboardList size={14} /> },
  ];

  if (!initialized) return <SkeletonPage />;

  return (
    <div className="space-y-4">
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Location</h2>

      {error && <Alert type="error" onClose={clearError}>{error}</Alert>}

      {/* Tabs */}
      <div className="overflow-x-auto scrollbar-hide border-b border-gray-200 dark:border-gray-700">
        <div className="flex gap-1 whitespace-nowrap min-w-max md:min-w-0">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => { setTab(t.key); clearError(); }}
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

      {/* Content */}
      {tab === 'dashboard' && <DashboardTab items={items} contracts={contracts} stats={stats} />}
      {tab === 'catalogue' && (
        <CatalogueTab
          items={items}
          onCreateItem={createItem}
          onUpdateItem={updateItem}
          onDeleteItem={deleteItem}
        />
      )}
      {tab === 'contrats' && (
        <ContratsTab
          items={items} contracts={contracts} filters={contractFilters}
          setFilter={setContractFilter}
          onCreate={createContract} onUpdate={updateContract} onDelete={deleteContract}
          fetchDetail={fetchContractDetail}
          selectedContract={selectedContract}
          clearSelectedContract={clearSelectedContract}
          onAddLine={addContractLine}
          onDeleteLine={deleteContractLine}
        />
      )}
      {tab === 'retours' && (
        <RetoursTab
          contracts={contracts}
          items={items}
          returns={returns}
          fetchReturns={fetchReturns}
          createReturn={createReturn}
          selectedContract={selectedContract}
          fetchContractDetail={fetchContractDetail}
        />
      )}
      {tab === 'employes' && (
        <EmployesTab
          employees={employees}
          employeeContracts={employeeContracts}
          employeeStats={employeeStats}
          fetchEmployees={fetchEmployees}
          updateEmployeeConfig={updateEmployeeConfig}
          fetchEmployeeContracts={fetchEmployeeContracts}
          createEmployeeContract={createEmployeeContract}
          updateEmployeeContract={updateEmployeeContract}
          recordEmployeeHours={recordEmployeeHours}
          fetchEmployeeStats={fetchEmployeeStats}
        />
      )}
      {tab === 'statistiques' && <StatistiquesTab stats={stats} items={items} contracts={contracts} />}
    </div>
  );
}

// ── Dashboard Tab ─────────────────────────────────

function DashboardTab({ items, contracts, stats }: {
  items: RentalItem[]; contracts: RentalContract[]; stats: import('@/types').RentalStats | null;
}) {
  // Use stats from backend (unfiltered, accurate) not filtered local contracts list
  const actifs = stats?.actifs ?? contracts.filter((c) => c.statut === 'ACTIF' || c.statut === 'EN_COURS').length;
  const disponibles = items.filter((it) => it.disponible !== false && (it.etat || '').toUpperCase() !== 'REPARATION').length;
  const montant = stats?.montantTotal ?? contracts.reduce((s, c) => s + (c.montantTotal || 0), 0);
  const recent = contracts.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* KPI Cards — StatCard pastel (harmonise avec Suivi) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Équipements" value={items.length} icon={<Package size={20} />} color="blue" />
        <StatCard label="Disponibles" value={disponibles} icon={<CheckCircle2 size={20} />} color="green" />
        <StatCard label="Contrats actifs" value={actifs} icon={<FileText size={20} />} color="purple" />
        <StatCard label="Montant total" value={formatCurrency(montant)} icon={<DollarSign size={20} />} color="yellow" />
      </div>

      {/* Recent contracts */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Derniers contrats</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Aucun contrat</p>
        ) : (
          <div className="space-y-2">
            {recent.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{c.clientNomCache || c.clientNom || '--'}</p>
                  <p className="text-xs text-gray-500">{c.numeroContrat || `#${c.id}`} &middot; {formatDate(c.dateDebut || c.createdAt || '')}</p>
                </div>
                <div className="flex items-center gap-2">
                  {c.montantTotal ? <span className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(c.montantTotal)}</span> : null}
                  <Badge color={statutColor(c.statut)} size="sm">{c.statut}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Equipment by category */}
      {items.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Equipements par categorie</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {(() => {
              const cats: Record<string, number> = {};
              items.forEach((it) => { const cat = it.categorie || 'Autre'; cats[cat] = (cats[cat] || 0) + 1; });
              return Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                <div key={cat} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{cat}</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-white">{count}</span>
                </div>
              ));
            })()}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Catalogue Tab (with CRUD) ─────────────────────

function CatalogueTab({ items, onCreateItem, onUpdateItem, onDeleteItem }: {
  items: RentalItem[];
  onCreateItem: (data: Parameters<typeof locApi.createItem>[0]) => Promise<void>;
  onUpdateItem: (id: number, data: Parameters<typeof locApi.updateItem>[1]) => Promise<void>;
  onDeleteItem: (id: number) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [etatFilter, setEtatFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<RentalItem | null>(null);

  const emptyForm = {
    nom: '', description: '', categorie: '', etat: '', numeroSerie: '',
    marque: '', modele: '', anneeFabrication: '', quantiteTotale: '',
    valeurAchat: '', valeurRemplacement: '',
    tarifJournalier: '', tarifHebdomadaire: '', tarifMensuel: '',
    cautionRequise: '', assuranceRequise: false, conditionsLocation: '', notes: '',
  };
  const [form, setForm] = useState(emptyForm);

  const filtered = items.filter((it) => {
    if (catFilter && (it.categorie || '') !== catFilter) return false;
    if (etatFilter && (it.etat || '') !== etatFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${it.nom || ''} ${it.numeroSerie || ''} ${it.marque || ''} ${it.modele || ''} ${it.categorie || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const { sortedItems, sortConfig, requestSort } = useSortable(filtered);

  const openCreate = () => {
    setEditItem(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (it: RentalItem) => {
    setEditItem(it);
    setForm({
      nom: it.nom || '',
      description: it.description || '',
      categorie: it.categorie || '',
      etat: it.etat || '',
      numeroSerie: it.numeroSerie || '',
      marque: it.marque || '',
      modele: it.modele || '',
      anneeFabrication: it.anneeFabrication != null ? String(it.anneeFabrication) : '',
      quantiteTotale: it.quantiteTotale != null ? String(it.quantiteTotale) : '',
      valeurAchat: it.valeurAchat != null ? String(it.valeurAchat) : '',
      valeurRemplacement: it.valeurRemplacement != null ? String(it.valeurRemplacement) : '',
      tarifJournalier: it.tarifJournalier != null ? String(it.tarifJournalier) : '',
      tarifHebdomadaire: it.tarifHebdomadaire != null ? String(it.tarifHebdomadaire) : '',
      tarifMensuel: it.tarifMensuel != null ? String(it.tarifMensuel) : '',
      cautionRequise: it.cautionRequise != null ? String(it.cautionRequise) : '',
      assuranceRequise: it.assuranceRequise === true,
      conditionsLocation: it.conditionsLocation || '',
      notes: it.notes || '',
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!form.nom.trim()) return;
    const payload = {
      nom: form.nom.trim(),
      description: form.description || undefined,
      categorie: form.categorie || undefined,
      etat: form.etat || undefined,
      numeroSerie: form.numeroSerie || undefined,
      marque: form.marque || undefined,
      modele: form.modele || undefined,
      anneeFabrication: form.anneeFabrication ? parseInt(form.anneeFabrication) : undefined,
      quantiteTotale: form.quantiteTotale ? parseInt(form.quantiteTotale) : undefined,
      valeurAchat: form.valeurAchat ? parseFloat(form.valeurAchat) : undefined,
      valeurRemplacement: form.valeurRemplacement ? parseFloat(form.valeurRemplacement) : undefined,
      tarifJournalier: form.tarifJournalier ? parseFloat(form.tarifJournalier) : undefined,
      tarifHebdomadaire: form.tarifHebdomadaire ? parseFloat(form.tarifHebdomadaire) : undefined,
      tarifMensuel: form.tarifMensuel ? parseFloat(form.tarifMensuel) : undefined,
      cautionRequise: form.cautionRequise ? parseFloat(form.cautionRequise) : undefined,
      assuranceRequise: form.assuranceRequise || undefined,
      conditionsLocation: form.conditionsLocation || undefined,
      notes: form.notes || undefined,
    };
    try {
      if (editItem) {
        await onUpdateItem(editItem.id, payload);
      } else {
        await onCreateItem(payload);
      }
      setShowModal(false);
      setForm(emptyForm);
      setEditItem(null);
    } catch { /* store handles error */ }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Supprimer cet equipement? Cette action est irreversible.')) return;
    try {
      await onDeleteItem(id);
    } catch { /* store handles error */ }
  };

  return (
    <div className="space-y-4">
      <CommandBar
        actions={[
          { label: 'Ajouter un item', icon: <Plus size={16} />, onClick: openCreate, variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-32 sm:w-40 shrink-0">
              <Select label="" options={EQUIPMENT_CATEGORIES} value={catFilter} onChange={(e) => setCatFilter(e.target.value)} />
            </div>
            <div className="w-32 sm:w-40 shrink-0">
              <Select label="" options={EQUIPMENT_ETATS} value={etatFilter} onChange={(e) => setEtatFilter(e.target.value)} />
            </div>
          </div>
        }
      />

      {/* Desktop table */}
      <Card padding="sm" className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <SortableHeader label="Équipement" sortKey="nom" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="N/S" sortKey="numeroSerie" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Catégorie" sortKey="categorie" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Etat</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Dispo</th>
              <SortableHeader label="Tarif/jour" sortKey="tarifJournalier" sortConfig={sortConfig} onSort={requestSort} align="right" />
              <SortableHeader label="Tarif/sem" sortKey="tarifHebdomadaire" sortConfig={sortConfig} onSort={requestSort} align="right" />
              <SortableHeader label="Tarif/mois" sortKey="tarifMensuel" sortConfig={sortConfig} onSort={requestSort} align="right" />
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {sortedItems.map((it) => (
                <tr key={it.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{it.nom}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{it.numeroSerie || '--'}</td>
                  <td className="px-4 py-3 text-gray-500">{it.categorie || '--'}</td>
                  <td className="px-4 py-3 text-center"><Badge color={statutColor(it.etat || '')} size="sm">{it.etat || 'N/A'}</Badge></td>
                  <td className="px-4 py-3 text-center">
                    <Badge color={it.disponible !== false ? 'green' : 'red'} size="sm">
                      {it.disponible !== false ? 'Oui' : 'Non'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">{it.tarifJournalier ? formatCurrency(it.tarifJournalier) : '--'}</td>
                  <td className="px-4 py-3 text-right">{it.tarifHebdomadaire ? formatCurrency(it.tarifHebdomadaire) : '--'}</td>
                  <td className="px-4 py-3 text-right">{it.tarifMensuel ? formatCurrency(it.tarifMensuel) : '--'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(it)} className="text-[#7BAFD4] hover:text-[#4a7fa8] p-1" title="Modifier"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(it.id)} className="text-[#E8919A] hover:text-[#b8616a] p-1" title="Supprimer"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {sortedItems.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Aucun équipement</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {sortedItems.map((it) => (
          <Card key={it.id} padding="sm">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 dark:text-white truncate">{it.nom}</p>
                <p className="text-xs text-gray-500 mt-1">{it.categorie || '--'} &middot; {it.numeroSerie || 'Sans N/S'}</p>
              </div>
              <div className="flex items-center gap-1">
                <Badge color={statutColor(it.etat || '')} size="sm">{it.etat || 'N/A'}</Badge>
                <button onClick={() => openEdit(it)} className="text-[#7BAFD4] hover:text-[#4a7fa8] p-1"><Pencil size={14} /></button>
                <button onClick={() => handleDelete(it.id)} className="text-[#E8919A] hover:text-[#b8616a] p-1"><Trash2 size={14} /></button>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 grid grid-cols-3 gap-2 text-xs">
              <div><span className="text-gray-400">Jour</span><br /><span className="font-medium text-gray-900 dark:text-white">{it.tarifJournalier ? formatCurrency(it.tarifJournalier) : '--'}</span></div>
              <div><span className="text-gray-400">Sem.</span><br /><span className="font-medium text-gray-900 dark:text-white">{it.tarifHebdomadaire ? formatCurrency(it.tarifHebdomadaire) : '--'}</span></div>
              <div><span className="text-gray-400">Mois</span><br /><span className="font-medium text-gray-900 dark:text-white">{it.tarifMensuel ? formatCurrency(it.tarifMensuel) : '--'}</span></div>
            </div>
          </Card>
        ))}
        {sortedItems.length === 0 && <p className="px-4 py-8 text-center text-gray-400">Aucun équipement</p>}
      </div>

      {/* Create/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditItem(null); setForm(emptyForm); }}
        title={editItem ? 'Modifier l\'equipement' : 'Ajouter un equipement'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Nom *" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required />
            <Input label="Numéro de série" value={form.numeroSerie} onChange={(e) => setForm({ ...form, numeroSerie: e.target.value })} />
            <Select label="Catégorie" options={EQUIPMENT_CATEGORIES} value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })} />
            <Select label="Etat" options={EQUIPMENT_ETATS} value={form.etat} onChange={(e) => setForm({ ...form, etat: e.target.value })} />
            <Input label="Marque" value={form.marque} onChange={(e) => setForm({ ...form, marque: e.target.value })} />
            <Input label="Modèle" value={form.modele} onChange={(e) => setForm({ ...form, modele: e.target.value })} />
            <Input label="Année de fabrication" type="number" value={form.anneeFabrication} onChange={(e) => setForm({ ...form, anneeFabrication: e.target.value })} />
            <Input label="Quantité totale" type="number" value={form.quantiteTotale} onChange={(e) => setForm({ ...form, quantiteTotale: e.target.value })} />
            <Input label="Valeur d'achat ($)" type="number" value={form.valeurAchat} onChange={(e) => setForm({ ...form, valeurAchat: e.target.value })} />
            <Input label="Valeur de remplacement ($)" type="number" value={form.valeurRemplacement} onChange={(e) => setForm({ ...form, valeurRemplacement: e.target.value })} />
            <Input label="Tarif journalier ($)" type="number" value={form.tarifJournalier} onChange={(e) => setForm({ ...form, tarifJournalier: e.target.value })} />
            <Input label="Tarif hebdomadaire ($)" type="number" value={form.tarifHebdomadaire} onChange={(e) => setForm({ ...form, tarifHebdomadaire: e.target.value })} />
            <Input label="Tarif mensuel ($)" type="number" value={form.tarifMensuel} onChange={(e) => setForm({ ...form, tarifMensuel: e.target.value })} />
            <Input label="Caution requise ($)" type="number" value={form.cautionRequise} onChange={(e) => setForm({ ...form, cautionRequise: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Assurance requise</label>
            <input type="checkbox" checked={form.assuranceRequise}
              onChange={(e) => setForm({ ...form, assuranceRequise: e.target.checked })}
              className="rounded border-gray-300 dark:border-gray-600" />
          </div>
          <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          <Textarea label="Conditions de location" value={form.conditionsLocation} onChange={(e) => setForm({ ...form, conditionsLocation: e.target.value })} rows={2} />
          <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => { setShowModal(false); setEditItem(null); setForm(emptyForm); }}>Annuler</Button>
            <Button onClick={handleSubmit} disabled={!form.nom.trim()}>{editItem ? 'Enregistrer' : 'Créer'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Contrats Tab (with detail + lines) ──────────────

function ContratsTab({ items, contracts, filters, setFilter, onCreate, onUpdate, onDelete,
  fetchDetail, selectedContract, clearSelectedContract, onAddLine, onDeleteLine }: {
  items: RentalItem[];
  contracts: RentalContract[];
  filters: { statut: string };
  setFilter: (key: string, value: unknown) => void;
  onCreate: (data: Parameters<typeof locApi.createContract>[0]) => Promise<void>;
  onUpdate: (id: number, data: Parameters<typeof locApi.updateContract>[1]) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  fetchDetail: (id: number) => Promise<void>;
  selectedContract: (RentalContract & { lignes?: RentalContratLigne[] }) | null;
  clearSelectedContract: () => void;
  onAddLine: (contractId: number, data: Parameters<typeof locApi.addContractLine>[1]) => Promise<void>;
  onDeleteLine: (contractId: number, ligneId: number) => Promise<void>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    clientNomCache: '', clientType: 'ENTREPRISE', dateDebut: '', dateFinPrevue: '',
    dureeType: 'JOUR', dureeNombre: '', conditionsParticulieres: '', lieuLivraison: '', notes: '',
  });
  const [lineForm, setLineForm] = useState({
    locationItemId: '', quantite: '1', tarifUnitaire: '', tarifType: 'JOUR', remisePourcent: '',
  });

  const searchedContracts = search
    ? contracts.filter((c) => {
        const q = search.toLowerCase();
        const hay = `${c.numeroContrat || ''} ${c.clientNomCache || ''} ${c.clientNom || ''} ${c.lieuLivraison || ''} ${c.conditionsParticulieres || ''} ${c.notes || ''}`.toLowerCase();
        return hay.includes(q);
      })
    : contracts;
  const { sortedItems, sortConfig, requestSort } = useSortable(searchedContracts);

  const resetForm = () => setForm({
    clientNomCache: '', clientType: 'ENTREPRISE', dateDebut: '', dateFinPrevue: '',
    dureeType: 'JOUR', dureeNombre: '', conditionsParticulieres: '', lieuLivraison: '', notes: '',
  });

  const resetLineForm = () => setLineForm({
    locationItemId: '', quantite: '1', tarifUnitaire: '', tarifType: 'JOUR', remisePourcent: '',
  });

  const handleCreate = async () => {
    if (!form.clientNomCache.trim()) return;
    try {
      await onCreate({
        clientNomCache: form.clientNomCache.trim(),
        clientType: form.clientType || undefined,
        dateDebut: form.dateDebut || new Date().toISOString().split('T')[0],
        dateFinPrevue: form.dateFinPrevue || undefined,
        dureeType: form.dureeType || undefined,
        dureeNombre: form.dureeNombre ? parseInt(form.dureeNombre) : undefined,
        conditionsParticulieres: form.conditionsParticulieres || undefined,
        lieuLivraison: form.lieuLivraison || undefined,
        notes: form.notes || undefined,
      });
      setShowCreate(false);
      resetForm();
    } catch { /* store handles error */ }
  };

  const openDetail = async (c: RentalContract) => {
    await fetchDetail(c.id);
    setShowDetail(true);
  };

  const handleAddLine = async () => {
    if (!selectedContract || !lineForm.locationItemId) return;
    const tarif = parseFloat(lineForm.tarifUnitaire);
    const qte = parseInt(lineForm.quantite || '1');
    if (!Number.isFinite(tarif) || tarif <= 0) return;
    if (!Number.isFinite(qte) || qte <= 0) return;
    try {
      await onAddLine(selectedContract.id, {
        locationItemId: parseInt(lineForm.locationItemId),
        quantite: qte,
        tarifUnitaire: tarif,
        tarifType: lineForm.tarifType || 'JOUR',
        remisePourcent: lineForm.remisePourcent ? parseFloat(lineForm.remisePourcent) : undefined,
      });
      resetLineForm();
    } catch { /* store handles error */ }
  };

  const handleDeleteLine = async (ligneId: number) => {
    if (!selectedContract) return;
    if (!window.confirm('Supprimer cette ligne?')) return;
    try {
      await onDeleteLine(selectedContract.id, ligneId);
    } catch { /* store handles error */ }
  };

  const handleDeleteContract = async () => {
    if (!selectedContract) return;
    if (!window.confirm(`Supprimer le contrat ${selectedContract.numeroContrat || '#' + selectedContract.id}? Cette action est irreversible.`)) return;
    try {
      await onDelete(selectedContract.id);
      setShowDetail(false);
      clearSelectedContract();
    } catch { /* store handles error */ }
  };

  const closeDetail = () => {
    setShowDetail(false);
    clearSelectedContract();
    resetLineForm();
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <CommandBar
        actions={[
          { label: 'Nouveau contrat', icon: <Plus size={16} />, onClick: () => setShowCreate(true), variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-32 sm:w-40 shrink-0">
              <Select label="" options={CONTRACT_STATUTS_FULL} value={filters.statut} onChange={(e) => setFilter('statut', e.target.value)} />
            </div>
          </div>
        }
      />

      {/* Desktop table */}
      <Card padding="sm" className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <SortableHeader label="Contrat" sortKey="numeroContrat" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Client" sortKey="clientNomCache" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Début" sortKey="dateDebut" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <SortableHeader label="Fin prévue" sortKey="dateFinPrevue" sortConfig={sortConfig} onSort={requestSort} align="left" />
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
              <SortableHeader label="Montant" sortKey="montantTotal" sortConfig={sortConfig} onSort={requestSort} align="right" />
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {sortedItems.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer" onClick={() => openDetail(c)}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-900 dark:text-white">{c.numeroContrat || `#${c.id}`}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{c.clientNomCache || c.clientNom || '--'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(c.dateDebut || '')}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(c.dateFinPrevue || '')}</td>
                  <td className="px-4 py-3 text-center"><Badge color={statutColor(c.statut)} size="sm">{c.statut}</Badge></td>
                  <td className="px-4 py-3 text-right font-medium">{c.montantTotal ? formatCurrency(c.montantTotal) : '--'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={(e) => { e.stopPropagation(); openDetail(c); }} className="text-[#7BAFD4] hover:text-[#4a7fa8] p-1" title="Détail">
                      <Eye size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {sortedItems.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucun contrat</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {sortedItems.map((c) => (
          <Card key={c.id} padding="sm" className="cursor-pointer" onClick={() => openDetail(c)}>
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-gray-900 dark:text-white">{c.numeroContrat || `#${c.id}`}</p>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">{c.clientNomCache || c.clientNom || '--'}</p>
                <p className="text-xs text-gray-500 mt-1">{formatDate(c.dateDebut || '')} &rarr; {formatDate(c.dateFinPrevue || '')}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge color={statutColor(c.statut)} size="sm">{c.statut}</Badge>
              </div>
            </div>
            {c.montantTotal ? (
              <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-right">
                <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(c.montantTotal)}</span>
              </div>
            ) : null}
          </Card>
        ))}
        {sortedItems.length === 0 && <p className="px-4 py-8 text-center text-gray-400">Aucun contrat</p>}
      </div>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => { setShowCreate(false); resetForm(); }} title="Nouveau contrat de location" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Client *" value={form.clientNomCache} onChange={(e) => setForm({ ...form, clientNomCache: e.target.value })} required />
            <Select label="Type de client" options={[
              { value: 'ENTREPRISE', label: 'Entreprise' },
              { value: 'CONTACT', label: 'Contact' },
            ]} value={form.clientType} onChange={(e) => setForm({ ...form, clientType: e.target.value })} />
            <Input label="Date début" type="date" value={form.dateDebut} onChange={(e) => setForm({ ...form, dateDebut: e.target.value })} />
            <Input label="Date fin prévue" type="date" value={form.dateFinPrevue} onChange={(e) => setForm({ ...form, dateFinPrevue: e.target.value })} />
            <Select label="Type de durée" options={TARIF_TYPES} value={form.dureeType} onChange={(e) => setForm({ ...form, dureeType: e.target.value })} />
            <Input label="Nombre de périodes" type="number" value={form.dureeNombre} onChange={(e) => setForm({ ...form, dureeNombre: e.target.value })} />
            <Input label="Lieu de livraison" value={form.lieuLivraison} onChange={(e) => setForm({ ...form, lieuLivraison: e.target.value })} />
          </div>
          <Textarea label="Conditions particulières" value={form.conditionsParticulieres} onChange={(e) => setForm({ ...form, conditionsParticulieres: e.target.value })} rows={2} />
          <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => { setShowCreate(false); resetForm(); }}>Annuler</Button>
            <Button onClick={handleCreate} disabled={!form.clientNomCache.trim()}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={showDetail && selectedContract !== null} onClose={closeDetail}
        title={`Contrat ${selectedContract?.numeroContrat || '#' + (selectedContract?.id || '')}`} size="xl">
        {selectedContract && (
          <div className="space-y-6">
            {/* Header info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Client</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedContract.clientNomCache || selectedContract.clientNom || '--'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Periode</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {formatDate(selectedContract.dateDebut || '')} &rarr; {formatDate(selectedContract.dateFinPrevue || '')}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Statut</p>
                <select
                  value={selectedContract.statut}
                  onChange={async (e) => {
                    const newStatut = e.target.value;
                    if (newStatut === selectedContract.statut) return;
                    try {
                      await onUpdate(selectedContract.id, { statut: newStatut });
                      await fetchDetail(selectedContract.id);
                    } catch { /* store handles error */ }
                  }}
                  className="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1"
                >
                  {CONTRACT_STATUTS_FULL.filter(s => s.value).map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              {selectedContract.lieuLivraison && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Lieu livraison</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{selectedContract.lieuLivraison}</p>
                </div>
              )}
              {selectedContract.conditionsParticulieres && (
                <div className="md:col-span-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Conditions</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{selectedContract.conditionsParticulieres}</p>
                </div>
              )}
            </div>

            {/* Lines table */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Lignes du contrat</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Item</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase">Qte</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Tarif</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Remise</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Montant</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase"></th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {(selectedContract.lignes || []).map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">{l.itemNom || `Item #${l.locationItemId}`}</td>
                        <td className="px-3 py-2 text-center">{l.quantite}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(l.tarifUnitaire)}</td>
                        <td className="px-3 py-2 text-center text-xs">{l.tarifType || 'JOUR'}</td>
                        <td className="px-3 py-2 text-right">{l.remisePourcent ? `${l.remisePourcent}%` : '--'}</td>
                        <td className="px-3 py-2 text-right font-medium">{l.montantLigne ? formatCurrency(l.montantLigne) : '--'}</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => handleDeleteLine(l.id)} className="text-[#E8919A] hover:text-[#b8616a] p-1" title="Supprimer">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(selectedContract.lignes || []).length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400 text-sm">Aucune ligne</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Add line form */}
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Ajouter une ligne</h4>
              {items.length === 0 && (
                <Alert type="info">
                  Aucun équipement dans le catalogue. Créez un équipement dans l'onglet Catalogue avant d'ajouter une ligne.
                </Alert>
              )}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Equipement</label>
                  <select value={lineForm.locationItemId} onChange={(e) => setLineForm({ ...lineForm, locationItemId: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-3 py-2 text-sm">
                    <option value="">-- Choisir --</option>
                    {items.map((it) => (
                      <option key={it.id} value={String(it.id)}>{it.nom}{it.numeroSerie ? ` (${it.numeroSerie})` : ''}</option>
                    ))}
                  </select>
                </div>
                <Input label="Qte" type="number" value={lineForm.quantite} onChange={(e) => setLineForm({ ...lineForm, quantite: e.target.value })} />
                <Input label="Tarif ($)" type="number" value={lineForm.tarifUnitaire} onChange={(e) => setLineForm({ ...lineForm, tarifUnitaire: e.target.value })} />
                <Select label="Type" options={TARIF_TYPES} value={lineForm.tarifType} onChange={(e) => setLineForm({ ...lineForm, tarifType: e.target.value })} />
                <Input label="Remise (%)" type="number" value={lineForm.remisePourcent} onChange={(e) => setLineForm({ ...lineForm, remisePourcent: e.target.value })} />
              </div>
              <div className="mt-3">
                <Button size="sm" leftIcon={<Plus size={14} />} onClick={handleAddLine}
                  disabled={!lineForm.locationItemId || !(parseFloat(lineForm.tarifUnitaire || '0') > 0) || !(parseInt(lineForm.quantite || '0') > 0)}>
                  Ajouter
                </Button>
              </div>
            </div>

            {/* Totals */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="flex flex-col items-end gap-1 text-sm">
                <div className="flex gap-8">
                  <span className="text-gray-500 dark:text-gray-400">Sous-total HT</span>
                  <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(selectedContract.montantHt || 0)}</span>
                </div>
                <div className="flex gap-8">
                  <span className="text-gray-500 dark:text-gray-400">TPS (5%)</span>
                  <span className="text-gray-700 dark:text-gray-300">{formatCurrency(selectedContract.montantTps || 0)}</span>
                </div>
                <div className="flex gap-8">
                  <span className="text-gray-500 dark:text-gray-400">TVQ (9.975%)</span>
                  <span className="text-gray-700 dark:text-gray-300">{formatCurrency(selectedContract.montantTvq || 0)}</span>
                </div>
                <div className="flex gap-8 pt-1 border-t border-gray-300 dark:border-gray-600">
                  <span className="font-semibold text-gray-700 dark:text-gray-200">Total TTC</span>
                  <span className="font-bold text-gray-900 dark:text-white">{formatCurrency(selectedContract.montantTotal || 0)}</span>
                </div>
              </div>
            </div>

            {/* Delete contract button (only for BROUILLON or ANNULE) */}
            <div className="flex justify-between items-center pt-2">
              {(selectedContract.statut === 'BROUILLON' || selectedContract.statut === 'ANNULE') ? (
                <Button variant="ghost" size="sm" onClick={handleDeleteContract}
                  className="text-[#B8616A] hover:text-[#8B4A52] dark:text-[#E8919A]">
                  <Trash2 size={14} className="mr-1" /> Supprimer ce contrat
                </Button>
              ) : <div />}
              <Button variant="ghost" onClick={closeDetail}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Retours Tab (inspection-based returns) ─────────

function RetoursTab({ contracts, items, returns, fetchReturns, createReturn, selectedContract, fetchContractDetail }: {
  contracts: RentalContract[];
  items: RentalItem[];
  returns: RentalRetour[];
  fetchReturns: (contratId?: number) => Promise<void>;
  createReturn: (data: Parameters<typeof locApi.createReturn>[0]) => Promise<void>;
  selectedContract: (RentalContract & { lignes?: RentalContratLigne[] }) | null;
  fetchContractDetail: (id: number) => Promise<void>;
}) {
  const [showInspection, setShowInspection] = useState(false);
  const [selectedLine, setSelectedLine] = useState<{ contratId: number; ligne: RentalContratLigne } | null>(null);
  const [inspForm, setInspForm] = useState({
    etatApres: 'BON', dommagesConstates: '', fraisReparation: '', fraisNettoyage: '', fraisRetard: '', commentaires: '',
  });
  const [viewContractId, setViewContractId] = useState<number | null>(null);
  const [unreturned, setUnreturned] = useState<{ contratId: number; contratNum: string; clientNom: string; lignes: RentalContratLigne[] }[]>([]);

  useEffect(() => {
    fetchReturns();
  }, []);

  // Prune stale unreturned entries when contracts list changes
  useEffect(() => {
    setUnreturned(prev => prev.filter(u => contracts.some(c => c.id === u.contratId)));
  }, [contracts]);

  // Find active contracts and load their lines to identify unreturned items
  const activeContracts = contracts.filter((c) => {
    const s = (c.statut || '').toUpperCase();
    return s === 'ACTIF' || s === 'EN_COURS' || s === 'RESERVE';
  });

  // When user clicks "Voir les lignes" for a contract, fetch its detail
  const loadContractLines = async (contractId: number) => {
    setViewContractId(contractId);
    await fetchContractDetail(contractId);
  };

  // Build unreturned list from selectedContract when it changes
  useEffect(() => {
    if (selectedContract && viewContractId === selectedContract.id) {
      const lignes = (selectedContract.lignes || []).filter(l => !l.dateRetourReelle);
      setUnreturned(prev => {
        const exists = prev.find(u => u.contratId === selectedContract.id);
        const entry = {
          contratId: selectedContract.id,
          contratNum: selectedContract.numeroContrat || `#${selectedContract.id}`,
          clientNom: selectedContract.clientNomCache || selectedContract.clientNom || '--',
          lignes,
        };
        if (exists) {
          return prev.map(u => u.contratId === selectedContract.id ? entry : u);
        }
        return [...prev, entry];
      });
    }
  }, [selectedContract, viewContractId]);

  const openInspection = (contratId: number, ligne: RentalContratLigne) => {
    setSelectedLine({ contratId, ligne });
    setInspForm({
      etatApres: 'BON', dommagesConstates: '', fraisReparation: '', fraisNettoyage: '', fraisRetard: '', commentaires: '',
    });
    setShowInspection(true);
  };

  const handleReturn = async () => {
    if (!selectedLine) return;
    const safeFloat = (s: string) => {
      if (!s) return undefined;
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : undefined;
    };
    try {
      const contratIdToRefresh = selectedLine.contratId;
      await createReturn({
        contratId: selectedLine.contratId,
        ligneId: selectedLine.ligne.id,
        locationItemId: selectedLine.ligne.locationItemId,
        etatAvant: selectedLine.ligne.etatSortie || undefined,
        etatApres: inspForm.etatApres || undefined,
        dommagesConstates: inspForm.dommagesConstates || undefined,
        fraisReparation: safeFloat(inspForm.fraisReparation),
        fraisNettoyage: safeFloat(inspForm.fraisNettoyage),
        fraisRetard: safeFloat(inspForm.fraisRetard),
        commentaires: inspForm.commentaires || undefined,
      });
      setShowInspection(false);
      setSelectedLine(null);
      fetchReturns();
      // Refresh contract lines so the unreturned list updates
      await fetchContractDetail(contratIdToRefresh);
    } catch { /* store handles error */ }
  };

  return (
    <div className="space-y-6">
      {/* Active contracts with unreturned items */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          Contrats actifs -- en attente de retour ({activeContracts.length})
        </h3>
        {activeContracts.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Aucun contrat actif</p>
        ) : (
          <div className="space-y-3">
            {activeContracts.map((c) => {
              const contractUnreturned = unreturned.find(u => u.contratId === c.id);
              return (
                <div key={c.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{c.clientNomCache || c.clientNom || '--'}</p>
                      <p className="text-xs text-gray-500">{c.numeroContrat || `#${c.id}`} &middot; Depuis {formatDate(c.dateDebut || '')}</p>
                    </div>
                    <Button size="sm" variant="secondary" leftIcon={<Eye size={14} />}
                      onClick={() => loadContractLines(c.id)}>
                      Voir les lignes
                    </Button>
                  </div>
                  {/* Show unreturned lines for this contract */}
                  {contractUnreturned && contractUnreturned.lignes.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {contractUnreturned.lignes.map((l) => (
                        <div key={l.id} className="flex items-center justify-between py-1.5 px-2 bg-gray-50 dark:bg-gray-800/50 rounded text-sm">
                          <div>
                            <span className="font-medium text-gray-900 dark:text-white">{l.itemNom || `Item #${l.locationItemId}`}</span>
                            <span className="text-xs text-gray-500 ml-2">
                              Sorti: {formatDate(l.dateSortie || '')} &middot; Etat: {l.etatSortie || 'N/A'}
                            </span>
                          </div>
                          <Button size="sm" variant="primary" leftIcon={<RotateCcw size={13} />}
                            onClick={() => openInspection(c.id, l)}>
                            Enregistrer retour
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  {contractUnreturned && contractUnreturned.lignes.length === 0 && (
                    <p className="text-xs text-gray-400 mt-1">Toutes les lignes ont été retournées.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Completed returns */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          Retours completes ({returns.length})
        </h3>
        {returns.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Aucun retour enregistre</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Contrat</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Item</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date retour</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Etat avant</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Etat apres</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Frais total</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {returns.map((r) => {
                  const fraisTotal = (r.fraisReparation || 0) + (r.fraisNettoyage || 0) + (r.fraisRetard || 0);
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-3 font-mono text-xs">{r.numeroContrat || `#${r.contratId}`}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{r.itemNom || `Item #${r.locationItemId}`}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(r.dateRetour || r.createdAt || '')}</td>
                      <td className="px-4 py-3 text-center"><Badge color={statutColor(r.etatAvant || '')} size="sm">{r.etatAvant || 'N/A'}</Badge></td>
                      <td className="px-4 py-3 text-center"><Badge color={statutColor(r.etatApres || '')} size="sm">{r.etatApres || 'N/A'}</Badge></td>
                      <td className="px-4 py-3 text-right font-medium">{fraisTotal > 0 ? formatCurrency(fraisTotal) : '--'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Inspection Modal */}
      <Modal isOpen={showInspection} onClose={() => { setShowInspection(false); setSelectedLine(null); }}
        title="Inspection de retour" size="lg">
        {selectedLine && (
          <div className="space-y-4">
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedLine.ligne.itemNom || `Item #${selectedLine.ligne.locationItemId}`}</p>
              <p className="text-xs text-gray-500 mt-1">
                Etat a la sortie: <Badge color={statutColor(selectedLine.ligne.etatSortie || '')} size="sm">{selectedLine.ligne.etatSortie || 'N/A'}</Badge>
              </p>
            </div>

            <Select label="Etat apres retour" options={EQUIPMENT_ETATS.filter(e => e.value)} value={inspForm.etatApres}
              onChange={(e) => setInspForm({ ...inspForm, etatApres: e.target.value })} />

            <Textarea label="Dommages constates" value={inspForm.dommagesConstates}
              onChange={(e) => setInspForm({ ...inspForm, dommagesConstates: e.target.value })} rows={3}
              placeholder="Decrire les dommages observes..." />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input label="Frais reparation ($)" type="number" value={inspForm.fraisReparation}
                onChange={(e) => setInspForm({ ...inspForm, fraisReparation: e.target.value })} />
              <Input label="Frais nettoyage ($)" type="number" value={inspForm.fraisNettoyage}
                onChange={(e) => setInspForm({ ...inspForm, fraisNettoyage: e.target.value })} />
              <Input label="Frais retard ($)" type="number" value={inspForm.fraisRetard}
                onChange={(e) => setInspForm({ ...inspForm, fraisRetard: e.target.value })} />
            </div>

            <Textarea label="Commentaires" value={inspForm.commentaires}
              onChange={(e) => setInspForm({ ...inspForm, commentaires: e.target.value })} rows={2} />

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => { setShowInspection(false); setSelectedLine(null); }}>Annuler</Button>
              <Button onClick={handleReturn}>Enregistrer le retour</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Employes Tab (4 sub-tabs) ────────────────────

type EmpSubTab = 'dashboard' | 'employes' | 'contrats' | 'heures';

function EmployesTab({
  employees, employeeContracts, employeeStats,
  fetchEmployees, updateEmployeeConfig,
  fetchEmployeeContracts, createEmployeeContract, updateEmployeeContract, recordEmployeeHours,
  fetchEmployeeStats,
}: {
  employees: RentalEmployee[];
  employeeContracts: RentalEmployeeContract[];
  employeeStats: RentalEmployeeStats | null;
  fetchEmployees: (params?: { disponibleOnly?: boolean; metier?: string }) => Promise<void>;
  updateEmployeeConfig: (id: number, data: Parameters<typeof locApi.updateEmployeeConfig>[1]) => Promise<void>;
  fetchEmployeeContracts: (params?: { statut?: string; employeeId?: number }) => Promise<void>;
  createEmployeeContract: (data: Parameters<typeof locApi.createEmployeeContract>[0]) => Promise<void>;
  updateEmployeeContract: (id: number, data: Parameters<typeof locApi.updateEmployeeContract>[1]) => Promise<void>;
  recordEmployeeHours: (contractId: number, data: Parameters<typeof locApi.recordEmployeeHours>[1]) => Promise<void>;
  fetchEmployeeStats: () => Promise<void>;
}) {
  const [empSubTab, setEmpSubTab] = useState<EmpSubTab>('dashboard');

  useEffect(() => {
    fetchEmployees();
    fetchEmployeeContracts();
    fetchEmployeeStats();
  }, []);

  return (
    <div>
      {/* Sub-tab navigation */}
      <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700 pb-2">
        {([
          { key: 'dashboard' as EmpSubTab, label: 'Tableau de bord' },
          { key: 'employes' as EmpSubTab, label: 'Employés' },
          { key: 'contrats' as EmpSubTab, label: 'Contrats' },
          { key: 'heures' as EmpSubTab, label: 'Heures' },
        ]).map(st => (
          <button
            key={st.key}
            onClick={() => setEmpSubTab(st.key)}
            className={`px-4 py-2 rounded-t text-sm font-medium ${
              empSubTab === st.key
                ? 'bg-[#7BAFD4] text-white'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      {empSubTab === 'dashboard' && <EmpDashboard stats={employeeStats} />}
      {empSubTab === 'employes' && (
        <EmpList employees={employees} fetchEmployees={fetchEmployees} updateConfig={updateEmployeeConfig} />
      )}
      {empSubTab === 'contrats' && (
        <EmpContracts
          contracts={employeeContracts} employees={employees}
          createContract={createEmployeeContract} updateContract={updateEmployeeContract}
        />
      )}
      {empSubTab === 'heures' && (
        <EmpHeures contracts={employeeContracts} recordHours={recordEmployeeHours} />
      )}
    </div>
  );
}

// Employee sub-tab: Dashboard
function EmpDashboard({ stats }: { stats: RentalEmployeeStats | null }) {
  return (
    <div className="space-y-4">
      {/* KPI Cards — StatCard pastel (harmonise avec Suivi) */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        <StatCard label="Total employés" value={stats?.totalEmployes ?? 0} icon={<Users size={20} />} color="blue" />
        <StatCard label="En location" value={stats?.enLocation ?? 0} icon={<Wrench size={20} />} color="purple" />
        <StatCard label="Disponibles" value={stats?.disponibles ?? 0} icon={<CheckCircle2 size={20} />} color="green" />
        <StatCard label="Contrats actifs" value={stats?.contratsActifs ?? 0} icon={<FileText size={20} />} color="yellow" />
        <StatCard label="Heures totales" value={stats?.heuresTotales ?? 0} icon={<Clock size={20} />} color="teal" />
        <StatCard label="Montant facture" value={formatCurrency(stats?.montantFacture ?? 0)} icon={<DollarSign size={20} />} color="red" />
      </div>
    </div>
  );
}

// Employee sub-tab: List
function EmpList({ employees, fetchEmployees, updateConfig }: {
  employees: RentalEmployee[];
  fetchEmployees: (params?: { disponibleOnly?: boolean; metier?: string }) => Promise<void>;
  updateConfig: (id: number, data: Parameters<typeof locApi.updateEmployeeConfig>[1]) => Promise<void>;
}) {
  const [metierFilter, setMetierFilter] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [configEmp, setConfigEmp] = useState<RentalEmployee | null>(null);
  const [configForm, setConfigForm] = useState({
    disponibleLocation: true, statutLocation: 'DISPONIBLE', metierPrincipal: '',
    tauxHoraireLocation: '', tauxJournalierLocation: '', notesLocation: '',
  });

  useEffect(() => {
    if (metierFilter) {
      fetchEmployees({ metier: metierFilter });
    } else {
      fetchEmployees();
    }
  }, [metierFilter]);

  const openConfig = (emp: RentalEmployee) => {
    setConfigEmp(emp);
    setConfigForm({
      disponibleLocation: emp.disponibleLocation !== false,
      statutLocation: emp.statutLocation || 'DISPONIBLE',
      metierPrincipal: emp.metierPrincipal || '',
      tauxHoraireLocation: emp.tauxHoraireLocation != null ? String(emp.tauxHoraireLocation) : '',
      tauxJournalierLocation: emp.tauxJournalierLocation != null ? String(emp.tauxJournalierLocation) : '',
      notesLocation: emp.notesLocation || '',
    });
    setShowConfig(true);
  };

  const handleSaveConfig = async () => {
    if (!configEmp) return;
    try {
      await updateConfig(configEmp.employeeId, {
        disponibleLocation: configForm.disponibleLocation,
        statutLocation: configForm.statutLocation || undefined,
        metierPrincipal: configForm.metierPrincipal || undefined,
        tauxHoraireLocation: configForm.tauxHoraireLocation ? parseFloat(configForm.tauxHoraireLocation) : undefined,
        tauxJournalierLocation: configForm.tauxJournalierLocation ? parseFloat(configForm.tauxJournalierLocation) : undefined,
        notesLocation: configForm.notesLocation || undefined,
      });
      setShowConfig(false);
      setConfigEmp(null);
    } catch { /* store handles error */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select label="" options={METIERS_CCQ} value={metierFilter} onChange={(e) => setMetierFilter(e.target.value)} className="w-52" />
        <span className="text-xs text-gray-400 ml-auto">{employees.length} employé{employees.length !== 1 ? 's' : ''}</span>
      </div>

      <Card padding="sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Métier</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Taux horaire</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Taux journalier</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    {emp.prenom || ''} {emp.nom || ''}{!emp.prenom && !emp.nom ? `Employé #${emp.employeeId}` : ''}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{emp.metierPrincipal || emp.poste || '--'}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge color={statutColor(emp.statutLocation || 'DISPONIBLE')} size="sm">
                      {emp.statutLocation || 'DISPONIBLE'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">{emp.tauxHoraireLocation ? formatCurrency(emp.tauxHoraireLocation) : '--'}</td>
                  <td className="px-4 py-3 text-right">{emp.tauxJournalierLocation ? formatCurrency(emp.tauxJournalierLocation) : '--'}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="secondary" leftIcon={<Wrench size={13} />} onClick={() => openConfig(emp)}>
                      Configurer
                    </Button>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucun employé</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Config Modal */}
      <Modal isOpen={showConfig} onClose={() => { setShowConfig(false); setConfigEmp(null); }}
        title={`Configuration - ${configEmp ? (configEmp.prenom || '') + ' ' + (configEmp.nom || '') : ''}`} size="lg">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Disponible pour location</label>
            <input type="checkbox" checked={configForm.disponibleLocation}
              onChange={(e) => setConfigForm({ ...configForm, disponibleLocation: e.target.checked })}
              className="rounded border-gray-300 dark:border-gray-600" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select label="Statut location" options={EMPLOYEE_STATUTS.map(s => ({ value: s.value, label: s.label }))}
              value={configForm.statutLocation}
              onChange={(e) => setConfigForm({ ...configForm, statutLocation: e.target.value })} />
            <Select label="Métier principal" options={METIERS_CCQ}
              value={configForm.metierPrincipal}
              onChange={(e) => setConfigForm({ ...configForm, metierPrincipal: e.target.value })} />
            <Input label="Taux horaire ($)" type="number" value={configForm.tauxHoraireLocation}
              onChange={(e) => setConfigForm({ ...configForm, tauxHoraireLocation: e.target.value })} />
            <Input label="Taux journalier ($)" type="number" value={configForm.tauxJournalierLocation}
              onChange={(e) => setConfigForm({ ...configForm, tauxJournalierLocation: e.target.value })} />
          </div>
          <Textarea label="Notes" value={configForm.notesLocation}
            onChange={(e) => setConfigForm({ ...configForm, notesLocation: e.target.value })} rows={3} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => { setShowConfig(false); setConfigEmp(null); }}>Annuler</Button>
            <Button onClick={handleSaveConfig}>Enregistrer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Employee sub-tab: Contracts
function EmpContracts({ contracts, employees, createContract, updateContract }: {
  contracts: RentalEmployeeContract[];
  employees: RentalEmployee[];
  createContract: (data: Parameters<typeof locApi.createEmployeeContract>[0]) => Promise<void>;
  updateContract: (id: number, data: Parameters<typeof locApi.updateEmployeeContract>[1]) => Promise<void>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    employeeId: '', dateDebut: '', dateFinPrevue: '', tarifType: 'JOUR',
    tarifUnitaire: '', heuresPrevues: '', lieuTravail: '', descriptionMission: '', notes: '',
  });

  const resetForm = () => setForm({
    employeeId: '', dateDebut: '', dateFinPrevue: '', tarifType: 'JOUR',
    tarifUnitaire: '', heuresPrevues: '', lieuTravail: '', descriptionMission: '', notes: '',
  });

  const handleCreate = async () => {
    if (!form.employeeId || !form.dateDebut || !form.dateFinPrevue) return;
    try {
      await createContract({
        employeeId: parseInt(form.employeeId),
        dateDebut: form.dateDebut,
        dateFinPrevue: form.dateFinPrevue,
        tarifType: form.tarifType || undefined,
        tarifUnitaire: form.tarifUnitaire ? parseFloat(form.tarifUnitaire) : undefined,
        heuresPrevues: form.heuresPrevues ? parseFloat(form.heuresPrevues) : undefined,
        lieuTravail: form.lieuTravail || undefined,
        descriptionMission: form.descriptionMission || undefined,
        notes: form.notes || undefined,
      });
      setShowCreate(false);
      resetForm();
    } catch { /* store handles error */ }
  };

  const handleStatusChange = async (id: number, newStatut: string) => {
    try {
      await updateContract(id, { statut: newStatut });
    } catch { /* store handles error */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowCreate(true)}>Nouveau contrat employé</Button>
        <span className="text-xs text-gray-400 ml-auto">{contracts.length} contrat{contracts.length !== 1 ? 's' : ''}</span>
      </div>

      <Card padding="sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Numéro</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Employé</th>
              <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Dates</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Tarif</th>
              <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Heures P/R</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Montant</th>
              <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Action</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {contracts.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="px-3 py-3 font-mono text-xs text-gray-900 dark:text-white">{c.numeroContrat || `#${c.id}`}</td>
                  <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{c.employeNom || `Emp #${c.employeeId}`}</td>
                  <td className="px-3 py-3 text-center"><Badge color={statutColor(c.statut)} size="sm">{c.statut}</Badge></td>
                  <td className="px-3 py-3 text-gray-500 text-xs">{formatDate(c.dateDebut)} &rarr; {formatDate(c.dateFinPrevue)}</td>
                  <td className="px-3 py-3 text-right text-xs">
                    {c.tarifUnitaire ? formatCurrency(c.tarifUnitaire) : '--'}
                    {c.tarifType ? <span className="text-gray-400 ml-1">/{c.tarifType}</span> : ''}
                  </td>
                  <td className="px-3 py-3 text-center text-xs">
                    {c.heuresPrevues ?? '--'} / {c.heuresReelles ?? 0}
                  </td>
                  <td className="px-3 py-3 text-right font-medium">
                    {c.montantFacture ? formatCurrency(c.montantFacture) : c.montantEstimeHt ? formatCurrency(c.montantEstimeHt) : '--'}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <select value={c.statut}
                      onChange={(e) => handleStatusChange(c.id, e.target.value)}
                      className="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1">
                      {EMPLOYEE_CONTRACT_STATUTS.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {contracts.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Aucun contrat employé</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => { setShowCreate(false); resetForm(); }} title="Nouveau contrat employé" size="lg">
        <div className="space-y-4">
          {employees.filter(e => e.disponibleLocation !== false).length === 0 && (
            <Alert type="info">
              Aucun employé disponible pour location. Configurez un employé dans le sous-onglet Employés avant de créer un contrat.
            </Alert>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Employé *</label>
            <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-3 py-2 text-sm">
              <option value="">-- Sélectionner un employé --</option>
              {employees.filter(e => e.disponibleLocation !== false).map((emp) => (
                <option key={emp.id} value={String(emp.employeeId)}>
                  {emp.prenom || ''} {emp.nom || ''}{!emp.prenom && !emp.nom ? `Employé #${emp.employeeId}` : ''} - {emp.metierPrincipal || emp.poste || 'N/A'}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Date début *" type="date" value={form.dateDebut} onChange={(e) => setForm({ ...form, dateDebut: e.target.value })} required />
            <Input label="Date fin prévue *" type="date" value={form.dateFinPrevue} onChange={(e) => setForm({ ...form, dateFinPrevue: e.target.value })} required />
            <Select label="Type de tarif" options={TARIF_TYPES} value={form.tarifType} onChange={(e) => setForm({ ...form, tarifType: e.target.value })} />
            <Input label="Tarif unitaire ($)" type="number" value={form.tarifUnitaire} onChange={(e) => setForm({ ...form, tarifUnitaire: e.target.value })} />
            <Input label="Heures prévues" type="number" value={form.heuresPrevues} onChange={(e) => setForm({ ...form, heuresPrevues: e.target.value })} />
            <Input label="Lieu de travail" value={form.lieuTravail} onChange={(e) => setForm({ ...form, lieuTravail: e.target.value })} />
          </div>
          <Textarea label="Description de la mission" value={form.descriptionMission}
            onChange={(e) => setForm({ ...form, descriptionMission: e.target.value })} rows={2} />
          <Textarea label="Notes" value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => { setShowCreate(false); resetForm(); }}>Annuler</Button>
            <Button onClick={handleCreate} disabled={!form.employeeId || !form.dateDebut || !form.dateFinPrevue}>Créer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Employee sub-tab: Hours
function EmpHeures({ contracts, recordHours }: {
  contracts: RentalEmployeeContract[];
  recordHours: (contractId: number, data: Parameters<typeof locApi.recordEmployeeHours>[1]) => Promise<void>;
}) {
  const [hoursForm, setHoursForm] = useState({
    contractId: '', dateTravail: '', heuresNormales: '', heuresSupplementaires: '', descriptionTaches: '',
  });
  const [recentEntries, setRecentEntries] = useState<{ contractId: number; date: string; normales: string; supp: string; desc: string }[]>([]);

  const activeContracts = contracts.filter(c => {
    const s = (c.statut || '').toUpperCase();
    return s === 'EN_COURS' || s === 'ACTIF';
  });

  const handleSubmitHours = async () => {
    if (!hoursForm.contractId || !hoursForm.dateTravail) return;
    const hn = parseFloat(hoursForm.heuresNormales || '0');
    const hs = parseFloat(hoursForm.heuresSupplementaires || '0');
    const safeHn = Number.isFinite(hn) ? hn : 0;
    const safeHs = Number.isFinite(hs) ? hs : 0;
    if (safeHn + safeHs <= 0) return;
    try {
      await recordHours(parseInt(hoursForm.contractId), {
        dateTravail: hoursForm.dateTravail,
        heuresNormales: safeHn > 0 ? safeHn : undefined,
        heuresSupplementaires: safeHs > 0 ? safeHs : undefined,
        notes: hoursForm.descriptionTaches || undefined,
      });
      // Track locally for display
      setRecentEntries(prev => [{
        contractId: parseInt(hoursForm.contractId),
        date: hoursForm.dateTravail,
        normales: hoursForm.heuresNormales,
        supp: hoursForm.heuresSupplementaires,
        desc: hoursForm.descriptionTaches,
      }, ...prev].slice(0, 20));
      setHoursForm({ contractId: hoursForm.contractId, dateTravail: '', heuresNormales: '', heuresSupplementaires: '', descriptionTaches: '' });
    } catch { /* store handles error */ }
  };

  return (
    <div className="space-y-6">
      {/* Entry form */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Saisie des heures</h3>
        <div className="space-y-3">
          {activeContracts.length === 0 && (
            <Alert type="info">
              Aucun contrat employé actif. Créez ou activez un contrat dans le sous-onglet Contrats avant de saisir des heures.
            </Alert>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contrat employé *</label>
            <select value={hoursForm.contractId} onChange={(e) => setHoursForm({ ...hoursForm, contractId: e.target.value })}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-3 py-2 text-sm">
              <option value="">-- Sélectionner un contrat --</option>
              {activeContracts.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.numeroContrat || `#${c.id}`} - {c.employeNom || `Emp #${c.employeeId}`}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Date de travail *" type="date" value={hoursForm.dateTravail}
              onChange={(e) => setHoursForm({ ...hoursForm, dateTravail: e.target.value })} required />
            <Input label="Heures normales" type="number" value={hoursForm.heuresNormales}
              onChange={(e) => setHoursForm({ ...hoursForm, heuresNormales: e.target.value })} placeholder="8" />
            <Input label="Heures supplementaires" type="number" value={hoursForm.heuresSupplementaires}
              onChange={(e) => setHoursForm({ ...hoursForm, heuresSupplementaires: e.target.value })} placeholder="0" />
          </div>
          <Textarea label="Description des taches" value={hoursForm.descriptionTaches}
            onChange={(e) => setHoursForm({ ...hoursForm, descriptionTaches: e.target.value })} rows={2} />
          <Button leftIcon={<Clock size={14} />} onClick={handleSubmitHours}
            disabled={!hoursForm.contractId || !hoursForm.dateTravail || (!hoursForm.heuresNormales && !hoursForm.heuresSupplementaires)}>
            Enregistrer les heures
          </Button>
        </div>
      </Card>

      {/* Recent entries */}
      {recentEntries.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Saisies recentes</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Contrat</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Normales</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Suppl.</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Description</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {recentEntries.map((entry) => {
                  const contract = contracts.find(c => c.id === entry.contractId);
                  return (
                    <tr key={`${entry.contractId}-${entry.date}-${entry.normales}-${entry.supp}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-2 font-mono text-xs">{contract?.numeroContrat || `#${entry.contractId}`}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs">{formatDate(entry.date)}</td>
                      <td className="px-4 py-2 text-right">{entry.normales || '0'}h</td>
                      <td className="px-4 py-2 text-right">{entry.supp || '0'}h</td>
                      <td className="px-4 py-2 text-gray-500 text-xs truncate max-w-[200px]">{entry.desc || '--'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Statistiques Tab ──────────────────────────────

function StatistiquesTab({ stats, items, contracts }: {
  stats: import('@/types').RentalStats | null; items: RentalItem[]; contracts: RentalContract[];
}) {
  const total = stats?.total ?? contracts.length;
  const actifs = stats?.actifs ?? contracts.filter((c) => c.statut === 'ACTIF' || c.statut === 'EN_COURS').length;
  const montant = stats?.montantTotal ?? contracts.reduce((s, c) => s + (c.montantTotal || 0), 0);
  const eqLoues = stats?.equipementsLoues ?? 0;
  const termines = contracts.filter((c) => (c.statut || '').toUpperCase() === 'TERMINE' || (c.statut || '').toUpperCase() === 'RETOURNE').length;

  // Contracts by status
  const byStatut: Record<string, number> = {};
  contracts.forEach((c) => { const s = c.statut || 'INCONNU'; byStatut[s] = (byStatut[s] || 0) + 1; });

  // Items by etat
  const byEtat: Record<string, number> = {};
  items.forEach((it) => { const e = it.etat || 'N/A'; byEtat[e] = (byEtat[e] || 0) + 1; });

  // Revenue by client
  const byClient: Record<string, number> = {};
  contracts.forEach((c) => {
    const client = c.clientNomCache || c.clientNom || 'Inconnu';
    byClient[client] = (byClient[client] || 0) + (c.montantTotal || 0);
  });
  const topClients = Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 10);

  return (
    <div className="space-y-6">
      {/* KPI Cards — StatCard pastel (harmonise avec Suivi) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
        <StatCard label="Total contrats" value={total} icon={<FileText size={20} />} color="purple" />
        <StatCard label="Actifs" value={actifs} icon={<CheckCircle2 size={20} />} color="green" />
        <StatCard label="Terminés" value={termines} icon={<CheckCircle2 size={20} />} color="teal" />
        <StatCard label="Eq. loues" value={eqLoues} icon={<Package size={20} />} color="blue" />
        <StatCard label="Revenu total" value={formatCurrency(montant)} icon={<DollarSign size={20} />} color="yellow" />
      </div>

      {/* Distribution rows */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Contracts by status */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Contrats par statut</h3>
          {Object.keys(byStatut).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Aucune donnée</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(byStatut).sort((a, b) => b[1] - a[1]).map(([s, count]) => {
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div key={s}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-700 dark:text-gray-300 flex items-center gap-2"><Badge color={statutColor(s)} size="sm">{s}</Badge></span>
                      <span className="text-gray-500">{count} ({(pct ?? 0).toFixed(0)}%)</span>
                    </div>
                    <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-[#7BAFD4] rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Equipment by condition */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Equipements par etat</h3>
          {Object.keys(byEtat).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Aucune donnée</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(byEtat).sort((a, b) => b[1] - a[1]).map(([e, count]) => {
                const pct = items.length > 0 ? (count / items.length) * 100 : 0;
                return (
                  <div key={e}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-700 dark:text-gray-300 flex items-center gap-2"><Badge color={statutColor(e)} size="sm">{e}</Badge></span>
                      <span className="text-gray-500">{count} ({(pct ?? 0).toFixed(0)}%)</span>
                    </div>
                    <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-[#7DC4A5] rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Top clients */}
      {topClients.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Top clients par revenu</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">#</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Client</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Revenu</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {topClients.map(([client, rev], idx) => (
                  <tr key={client} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-4 py-2 text-gray-400">{idx + 1}</td>
                    <td className="px-4 py-2 text-gray-900 dark:text-white">{client}</td>
                    <td className="px-4 py-2 text-right font-medium text-gray-900 dark:text-white">{formatCurrency(rev)}</td>
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
