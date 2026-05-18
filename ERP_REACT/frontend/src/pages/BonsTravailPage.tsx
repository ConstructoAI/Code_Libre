/**
 * ERP React Frontend - Bons de Travail (Work Orders) Page
 * Full CRUD with tabs: Bons de Travail, Operations + Detail mode.
 * Lines, assignations, comments sub-resources.
 */

import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ClipboardList, Plus, Search, X, Trash2, Send, UserPlus, MessageSquare,
  Calendar, DollarSign, AlertTriangle, Play, CheckCircle, Pause, XCircle, Printer,
  Code2, Eye, Pencil, Save, ArrowLeft, Clock, Wrench, Package, Ban, RotateCcw,
} from 'lucide-react';
import { useProductionStore } from '@/store/useProductionStore';
import { openWorkOrderExport } from '@/api/exports';
import * as productionApi from '@/api/production';
import * as projectsApi from '@/api/projects';
import * as employeesApi from '@/api/employees';
import * as inventoryApi from '@/api/inventory';
import * as suppliersApi from '@/api/suppliers';
import type { Project } from '@/api/projects';
import type { Employee } from '@/api/employees';
import type { Product } from '@/api/inventory';
import type { Supplier } from '@/api/suppliers';
import type { ProductionStatistics, Operation, LineItem } from '@/api/production';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import type { BadgeColor } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Alert } from '@/components/ui/Alert';
import { Textarea } from '@/components/ui/Textarea';
import { formatDate, formatCurrency, formatRelativeTime } from '@/utils/format';
import { useSortable } from '@/hooks/useSortable';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { useColumnResize } from '@/hooks/useColumnResize';
import { CommandBar } from '@/components/ui/CommandBar';

// ============ Constants ============

type TabKey = 'liste' | 'detail' | 'operations';

const STATUT_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: 'BROUILLON', label: 'Brouillon' },
  { value: 'EN_COURS', label: 'En cours' },
  { value: 'EN_PAUSE', label: 'En pause' },
  { value: 'TERMINE', label: 'Terminé' },
  { value: 'ANNULE', label: 'Annulé' },
];

const PRIORITE_OPTIONS = [
  { value: '', label: 'Toutes les priorités' },
  { value: 'BASSE', label: 'Basse' },
  { value: 'NORMALE', label: 'Normale' },
  { value: 'HAUTE', label: 'Haute' },
  { value: 'URGENTE', label: 'Urgente' },
];

const PRIORITE_FORM_OPTIONS = [
  { value: 'BASSE', label: 'Basse' },
  { value: 'NORMALE', label: 'Normale' },
  { value: 'HAUTE', label: 'Haute' },
  { value: 'URGENTE', label: 'Urgente' },
];

const PRIORITE_COLORS: Record<string, BadgeColor> = {
  BASSE: 'gray',
  NORMALE: 'blue',
  HAUTE: 'orange',
  URGENTE: 'red',
  // Legacy lowercase compat
  basse: 'gray',
  normale: 'blue',
  haute: 'orange',
  urgente: 'red',
};

const STATUT_COLORS: Record<string, BadgeColor> = {
  BROUILLON: 'gray',
  EN_COURS: 'blue',
  EN_PAUSE: 'amber',
  TERMINE: 'green',
  ANNULE: 'red',
};

// ============ Operations constants ============

const OPERATION_STATUT_OPTIONS = [
  { value: 'En attente', label: 'En attente' },
  { value: 'En cours', label: 'En cours' },
  { value: 'Termine', label: 'Terminé' },
  { value: 'Annule', label: 'Annulé' },
];

const OPERATION_STATUT_COLORS: Record<string, BadgeColor> = {
  'En attente': 'yellow',
  'En cours': 'blue',
  'Termine': 'green',
  'Annule': 'red',
  // Legacy compat
  'A FAIRE': 'gray',
  'À FAIRE': 'gray',
};

// Canonical statuses for the edit dropdown — pinned to avoid the fragility of
// `Object.keys(OPERATION_STATUT_COLORS).slice(0, 4)` (slice would silently
// pick wrong values if the colors map gets reordered or extended).
// Mirrors backend OPERATION_STATUSES in production.py.
const OPERATION_STATUTS_EDITABLE = ['En attente', 'En cours', 'Termine', 'Annule'] as const;

// ============ Component ============

export default function BonsTravailPage() {
  const items = useProductionStore((s) => s.items);
  const total = useProductionStore((s) => s.total);
  const isLoading = useProductionStore((s) => s.isLoading);
  const error = useProductionStore((s) => s.error);
  const filters = useProductionStore((s) => s.filters);
  const selected = useProductionStore((s) => s.selected);
  const lines = useProductionStore((s) => s.lines);
  const assignations = useProductionStore((s) => s.assignations);
  const comments = useProductionStore((s) => s.comments);
  const detailLoading = useProductionStore((s) => s.detailLoading);
  const fetchAll = useProductionStore((s) => s.fetchAll);
  const setFilter = useProductionStore((s) => s.setFilter);
  const clearError = useProductionStore((s) => s.clearError);
  const clearSelection = useProductionStore((s) => s.clearSelection);
  const createBT = useProductionStore((s) => s.create);
  const updateBT = useProductionStore((s) => s.update);
  const removeBT = useProductionStore((s) => s.remove);
  const restoreBT = useProductionStore((s) => s.restore);
  const selectWorkOrder = useProductionStore((s) => s.selectWorkOrder);
  const storeAddLine = useProductionStore((s) => s.addLine);
  const storeRemoveLine = useProductionStore((s) => s.removeLine);
  const storeAddAssignation = useProductionStore((s) => s.addAssignation);
  const storeRemoveAssignation = useProductionStore((s) => s.removeAssignation);
  const storeAddComment = useProductionStore((s) => s.addComment);
  const operations = useProductionStore((s) => s.operations);
  const allOperations = useProductionStore((s) => s.allOperations);
  const operationTypes = useProductionStore((s) => s.operationTypes);
  const storeAddOperation = useProductionStore((s) => s.addOperation);
  const storeUpdateOperation = useProductionStore((s) => s.updateOperation);
  const storeRemoveOperation = useProductionStore((s) => s.removeOperation);
  const fetchAllOperations = useProductionStore((s) => s.fetchAllOperations);
  const fetchOperationTypes = useProductionStore((s) => s.fetchOperationTypes);

  const [activeTab, setActiveTab] = useState<TabKey>('liste');
  const [isCreating, setIsCreating] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // Create form
  const [form, setForm] = useState({
    nom: '', projectId: '' as string, priorite: 'NORMALE',
    dateEcheance: '', dateDebut: '', dateFin: '', notes: '',
  });
  const [pendingOps, setPendingOps] = useState<Record<string, unknown>[]>([]);
  const [pendingLines, setPendingLines] = useState<Record<string, unknown>[]>([]);

  // Add line form
  const [showAddLine, setShowAddLine] = useState(false);
  const [lineForm, setLineForm] = useState({
    description: '', quantite: '1', unite: '', prixUnitaire: '0', produitId: '',
  });

  // Add assignation
  const [showAssign, setShowAssign] = useState(false);
  const [assignForm, setAssignForm] = useState({ employeeId: '', role: '' });

  // Comment
  const [commentText, setCommentText] = useState('');

  // Statistics
  const [statistics, setStatistics] = useState<ProductionStatistics | null>(null);

  const perPage = filters.perPage;
  const totalPages = Math.ceil(total / perPage);

  // ============ Data fetching ============

  useEffect(() => {
    fetchAll();
  }, [fetchAll, filters.page, filters.statut, filters.priorite, filters.search]);

  // Load projects, employees, products, suppliers, statistics on mount
  useEffect(() => {
    projectsApi.listProjects({ perPage: 100 }).then((res) => setProjects(res.items)).catch(() => {});
    employeesApi.listEmployees({ perPage: 100 }).then((res) => setEmployees(res.items)).catch(() => {});
    inventoryApi.listProducts({ perPage: 100 }).then((res) => setProducts(res.items)).catch(() => {});
    // Charger les fournisseurs du Magasin pour les operations sous-traitance.
    // Backend limite per_page a 100 (Query(le=100)) -- demander plus retourne 422.
    suppliersApi.listSuppliers({ perPage: 100 })
      .then((res) => setSuppliers(res.items))
      .catch((err) => console.warn('[BT] listSuppliers failed:', err?.response?.data || err?.message || err));
    fetchStatistics();
    fetchOperationTypes();
  }, []);

  // Options du dropdown Fournisseur/Sous-traitant pour les operations BT.
  // Premier choix "-- Interne --" (= travail employe interne, valeur stockee "Interne").
  // Suivants: liste des fournisseurs actifs du Magasin (alphabetique).
  // Les chaines arbitraires sauvegardees historiquement (ex: tenant legacy)
  // sont preservees et affichees comme option supplementaire si non listee.
  // Fallback robuste: certains tenants ont nom_fournisseur NULL mais une
  // company associee, on essaie alors nomFournisseur puis companyNom.
  const supplierOptionsBase = React.useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: 'Interne', label: '-- Interne --' },
    ];
    const getName = (s: Supplier): string =>
      (s.nom || s.nomFournisseur || s.companyNom || '').trim();
    const sorted = [...suppliers].sort((a, b) =>
      getName(a).localeCompare(getName(b), 'fr', { sensitivity: 'base' })
    );
    const seen = new Set<string>();
    for (const s of sorted) {
      const name = getName(s);
      if (name && !seen.has(name)) {
        seen.add(name);
        opts.push({ value: name, label: name });
      }
    }
    return opts;
  }, [suppliers]);

  const buildSupplierOptions = (currentValue?: string) => {
    const v = (currentValue || '').trim();
    const knownValues = new Set(supplierOptionsBase.map((o) => o.value));
    if (v && !knownValues.has(v)) {
      // Preserver une valeur arbitraire heritee (ex: "Sylvain Leduc" tape a la main)
      // sans la perdre lors de l'edition.
      return [...supplierOptionsBase, { value: v, label: `${v} (libre)` }];
    }
    return supplierOptionsBase;
  };

  // Auto-open item from ?open= query param (e.g. from calendar double-click)
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenHandled = useRef(false);
  // Lock anti double-click pour les actions destructives depuis la liste
  // (ListeTab utilise window.confirm comme barriere mais sans state lock).
  const deletingFromListRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId && !autoOpenHandled.current) {
      autoOpenHandled.current = true;
      handleSelectBT(Number(openId));
      searchParams.delete('open');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams]);

  const fetchStatistics = async () => {
    try {
      const stats = await productionApi.getProductionStatistics();
      setStatistics(stats);
    } catch {
      // silently ignore
    }
  };


  // ============ Handlers ============

  const handleCreate = async (ops: Record<string, unknown>[] = [], lines: Record<string, unknown>[] = []) => {
    try {
      const res = await createBT({
        nom: form.nom.trim() || undefined,
        projectId: form.projectId ? Number(form.projectId) : undefined,
        priorite: form.priorite,
        dateEcheance: form.dateEcheance || undefined,
        dateDebut: form.dateDebut || undefined,
        dateFin: form.dateFin || undefined,
        notes: form.notes || undefined,
      });
      setForm({ nom: '', projectId: '', priorite: 'NORMALE', dateEcheance: '', dateDebut: '', dateFin: '', notes: '' });
      // Batch-create pending operations
      if (res?.id != null && ops.length > 0) {
        for (const op of ops) {
          try { await storeAddOperation(res.id, op); } catch { /* continue */ }
        }
      }
      // Batch-create pending lines (products)
      if (res?.id != null && lines.length > 0) {
        for (const ln of lines) {
          try { await storeAddLine(res.id, ln as { description: string; quantite?: number; unite?: string; prixUnitaire?: number; produitId?: number }); } catch { /* continue */ }
        }
      }
      fetchAll();
      // Auto-select the new BT and switch to detail view
      if (res?.id != null) {
        await selectWorkOrder(res.id);
      }
      setIsCreating(false);
      setActiveTab('detail');
    } catch (err) {
      // error set by store — re-throw so callers can distinguish success/failure
      throw err;
    }
  };

  // Compteur incrementiel utilise par DetailTab pour declencher startEditing
  // une seule fois apres que le BT ait ete charge (vs un boolean qui resterait
  // sticky entre 2 ouvertures successives).
  const [autoEditTrigger, setAutoEditTrigger] = useState(0);
  // FIX P0 (round 5): compteur sortie-mode-edition. Si user en mode edition
  // sur BT A clique sur BT B dans la liste, DetailTab doit fermer le mode
  // edition (sinon editForm garde valeurs de A et UPDATE serait fait sur B
  // avec donnees de A — corruption silencieuse).
  const [autoCancelEditTrigger, setAutoCancelEditTrigger] = useState(0);

  const handleSelectBT = async (id: number) => {
    setAutoCancelEditTrigger((n) => n + 1); // force exit edit mode dans DetailTab
    await selectWorkOrder(id);
    setActiveTab('detail');
  };

  const handleEditBT = async (id: number) => {
    await selectWorkOrder(id);
    setActiveTab('detail');
    setAutoEditTrigger((n) => n + 1);
  };

  const handleStatusChange = async (newStatut: string) => {
    if (!selected) return;
    await updateBT(selected.id, { statut: newStatut });
    fetchAll();
  };

  // 3 actions distinctes pour le cycle de vie BT:
  // - handleCancel: soft-delete (statut != ANNULE -> ANNULE), reverse stock,
  //   garde le BT dans la liste pour permettre Restaurer.
  // - handleHardDelete: suppression definitive (statut == ANNULE seulement),
  //   retire de la base + cascade enfants.
  // - handleRestore: ANNULE -> BROUILLON.
  const handleCancel = async () => {
    if (!selected) return;
    const msg = `Annuler ce bon de travail ?\n\nLe stock sera restaure et le BT passera en ANNULE. Vous pourrez le restaurer ou le supprimer definitivement par la suite.`;
    if (!window.confirm(msg)) return;
    try {
      await removeBT(selected.id);
    } catch { /* error shown via store.error banner */ }
  };

  const handleHardDelete = async () => {
    if (!selected) return;
    const msg = `Supprimer DEFINITIVEMENT ce bon de travail ?\n\nCette action est IRREVERSIBLE. Toutes les operations, lignes, assignations et commentaires associes seront aussi supprimes.`;
    if (!window.confirm(msg)) return;
    try {
      await removeBT(selected.id);
      setActiveTab('liste');
      fetchAll();
    } catch { /* error shown via store.error banner */ }
  };

  const handleRestore = async () => {
    if (!selected) return;
    if (!window.confirm('Restaurer ce bon de travail ? Il repassera en BROUILLON.')) return;
    try {
      await restoreBT(selected.id);
    } catch { /* error shown via store.error banner */ }
  };

  const handleAddLine = async () => {
    if (!selected || !lineForm.description.trim()) return;
    await storeAddLine(selected.id, {
      description: lineForm.description,
      quantite: parseFloat(lineForm.quantite) || 1,
      unite: lineForm.unite || undefined,
      prixUnitaire: parseFloat(lineForm.prixUnitaire) || 0,
      produitId: lineForm.produitId ? Number(lineForm.produitId) : undefined,
    });
    setLineForm({ description: '', quantite: '1', unite: '', prixUnitaire: '0', produitId: '' });
    setShowAddLine(false);
    // Refresh products to reflect updated stock
    inventoryApi.listProducts({ perPage: 100 }).then((res) => setProducts(res.items)).catch(() => {});
  };

  const handleRemoveLine = async (lineId: number) => {
    if (!selected) return;
    await storeRemoveLine(selected.id, lineId);
    // Refresh products to reflect restored stock
    inventoryApi.listProducts({ perPage: 100 }).then((res) => setProducts(res.items)).catch(() => {});
  };

  const handleUpdateLine = async (lineId: number, data: Record<string, unknown>) => {
    if (!selected) return;
    await productionApi.updateLine(selected.id, lineId, data as any);
    await selectWorkOrder(selected.id);
    inventoryApi.listProducts({ perPage: 100 }).then((res) => setProducts(res.items)).catch(() => {});
  };

  const handleAssign = async () => {
    if (!selected || !assignForm.employeeId) return;
    await storeAddAssignation(selected.id, {
      employeeId: Number(assignForm.employeeId),
      role: assignForm.role || undefined,
    });
    setAssignForm({ employeeId: '', role: '' });
    setShowAssign(false);
  };

  const handleRemoveAssignation = async (assignationId: number) => {
    if (!selected) return;
    await storeRemoveAssignation(selected.id, assignationId);
  };

  const handleAddComment = async () => {
    if (!selected || !commentText.trim()) return;
    await storeAddComment(selected.id, commentText.trim());
    setCommentText('');
  };

  // ============ Project options ============

  const projectOptions = [
    { value: '', label: 'Aucun projet' },
    ...projects.map((p) => ({ value: String(p.id), label: p.nomProjet })),
  ];

  const employeeOptions = [
    { value: '', label: 'Sélectionner un employé' },
    ...employees.map((e) => ({ value: String(e.id), label: `${e.prenom} ${e.nom}` })),
  ];

  // ============ Tab renderer ============

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'liste', label: 'Bons de Travail' },
    { key: 'operations', label: 'Opérations' },
  ];

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={clearError}>{error}</Alert>}

      {/* Header */}
      <div className="flex items-center gap-3">
        <ClipboardList size={28} className="text-seaop-primary-600 dark:text-seaop-primary-400" />
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Bons de Travail</h2>
      </div>

      {/* Tabs / Back button */}
      {activeTab === 'detail' ? (
        <div className="flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 pb-2">
          <button
            onClick={() => { setIsCreating(false); setActiveTab('liste'); setPendingOps([]); setPendingLines([]); }}
            className="flex items-center gap-1.5 text-sm font-medium text-seaop-primary-600 hover:text-seaop-primary-700 transition-colors"
          >
            <ArrowLeft size={16} />
            Bons de Travail
          </button>
          {selected && (
            <span className="text-sm text-gray-400">/ {selected.numeroDocument} — {selected.nom}</span>
          )}
        </div>
      ) : (
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-2.5 md:px-4 py-2 md:py-2.5 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-seaop-primary-600 text-seaop-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* KPI Stats Cards — always visible */}
      {statistics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <Card padding="md">
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Total BT</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{statistics.total || 0}</div>
          </Card>
          <Card padding="md">
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">En cours</div>
            <div className="text-2xl font-bold text-blue-600">{statistics.enCours || 0}</div>
          </Card>
          <Card padding="md">
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Terminés</div>
            <div className="text-2xl font-bold text-green-600">{statistics.termines || 0}</div>
          </Card>
          <Card padding="md">
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Montant total</div>
            <div className="text-2xl font-bold text-seaop-primary-600 dark:text-seaop-primary-400">{formatCurrency(statistics.montantTotal || 0)}</div>
          </Card>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'liste' && (
        <ListeTab
          items={items}
          total={total}
          isLoading={isLoading}
          filters={filters}
          totalPages={totalPages}
          onSearch={(v) => setFilter('search', v)}
          onStatut={(v) => setFilter('statut', v)}
          onPriorite={(v) => setFilter('priorite', v)}
          onPageChange={(v) => setFilter('page', v)}
          onSelect={handleSelectBT}
          onEdit={handleEditBT}
          onHardDelete={async (btId) => {
            // Lock anti double-fire (un BT en cours de delete ne peut pas etre re-cliqué)
            if (deletingFromListRef.current.has(btId)) return;
            const msg = `Supprimer DEFINITIVEMENT ce bon de travail ?\n\nCette action est IRREVERSIBLE. Toutes les operations, lignes, assignations et commentaires associes seront aussi supprimes.`;
            if (!window.confirm(msg)) return;
            deletingFromListRef.current.add(btId);
            try {
              await removeBT(btId);
              fetchAll();
            } catch { /* error shown via store.error banner */ }
            finally { deletingFromListRef.current.delete(btId); }
          }}
          selectedId={selected?.id}
          onCreate={() => { clearSelection(); setIsCreating(true); setActiveTab('detail'); setForm({ nom: '', projectId: '', priorite: 'NORMALE', dateEcheance: '', dateDebut: '', dateFin: '', notes: '' }); setPendingOps([]); setPendingLines([]); }}
        />
      )}

      {activeTab === 'detail' && (
        <DetailTab
          selected={selected}
          detailLoading={detailLoading}
          lines={lines}
          assignations={assignations}
          comments={comments}
          commentText={commentText}
          onCommentTextChange={setCommentText}
          onAddComment={handleAddComment}
          onStatusChange={handleStatusChange}
          onUpdate={async (data) => { if (!selected) return; await updateBT(selected.id, data as Partial<typeof selected>); await selectWorkOrder(selected.id); fetchAll(); }}
          onCancel={handleCancel}
          onHardDelete={handleHardDelete}
          onRestore={handleRestore}
          onShowAddLine={() => setShowAddLine(true)}
          onRemoveLine={handleRemoveLine}
          onUpdateLine={handleUpdateLine}
          onShowAssign={() => setShowAssign(true)}
          onRemoveAssignation={handleRemoveAssignation}
          onBackToList={() => { setIsCreating(false); setActiveTab('liste'); }}
          projects={projects}
          operations={operations}
          operationTypes={operationTypes}
          employees={employees}
          onAddOperation={async (data) => { if (!selected) return; await storeAddOperation(selected.id, data); }}
          onUpdateOperation={async (opId, data) => { if (!selected) return; await storeUpdateOperation(selected.id, opId, data); }}
          onRemoveOperation={async (opId) => { if (!selected) return; await storeRemoveOperation(selected.id, opId); }}
          isCreating={isCreating}
          createForm={form}
          onCreateFormChange={setForm}
          onCreateSubmit={handleCreate}
          onCancelCreate={() => { setIsCreating(false); setActiveTab('liste'); setPendingOps([]); setPendingLines([]); }}
          pendingOps={pendingOps}
          onPendingOpsChange={setPendingOps}
          pendingLines={pendingLines}
          onPendingLinesChange={setPendingLines}
          products={products}
          suppliers={suppliers}
          buildSupplierOptions={buildSupplierOptions}
          autoEditTrigger={autoEditTrigger}
          autoCancelEditTrigger={autoCancelEditTrigger}
        />
      )}

      {activeTab === 'operations' && (
        <OperationsTab
          allOperations={allOperations}
          isLoading={isLoading}
          onFetch={fetchAllOperations}
          employees={employees}
          supplierOptions={supplierOptionsBase}
        />
      )}

      {/* ========== Add Line Modal ========== */}
      <Modal isOpen={showAddLine} onClose={() => setShowAddLine(false)} title="Ajouter une ligne" size="lg">
        <div className="space-y-4">
          <Select
            label="Produit de l'inventaire (optionnel)"
            options={[
              { value: '', label: 'Saisie libre (sans produit)' },
              ...products.map((p) => ({ value: String(p.id), label: `${p.nom}${p.codeProduit ? ` (${p.codeProduit})` : ''} — ${p.stockDisponible} en stock` })),
            ]}
            value={lineForm.produitId}
            onChange={(e) => {
              const pid = e.target.value;
              const p = products.find((pr) => String(pr.id) === pid);
              if (p) {
                setLineForm({ ...lineForm, produitId: pid, description: p.nom, unite: p.uniteVente || '', prixUnitaire: String(p.prixUnitaire || p.coutRevient || 0) });
              } else {
                setLineForm({ ...lineForm, produitId: '', description: '', unite: '', prixUnitaire: '0' });
              }
            }}
          />
          <Input
            label="Description *"
            value={lineForm.description}
            onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })}
            placeholder="Ex: Tuyau PVC 4 pouces"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <Input
              label="Quantité"
              type="number"
              min="0"
              step="0.01"
              value={lineForm.quantite}
              onChange={(e) => setLineForm({ ...lineForm, quantite: e.target.value })}
            />
            <Input
              label="Unité"
              value={lineForm.unite}
              onChange={(e) => setLineForm({ ...lineForm, unite: e.target.value })}
              placeholder="m, kg, unité..."
            />
            <Input
              label="Prix unitaire"
              type="number"
              min="0"
              step="0.01"
              value={lineForm.prixUnitaire}
              onChange={(e) => setLineForm({ ...lineForm, prixUnitaire: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowAddLine(false)}>Annuler</Button>
            <Button onClick={handleAddLine} disabled={!lineForm.description.trim()}>Ajouter</Button>
          </div>
        </div>
      </Modal>

      {/* ========== Assign Employee Modal ========== */}
      <Modal isOpen={showAssign} onClose={() => setShowAssign(false)} title="Assigner un employé" size="md">
        <div className="space-y-4">
          <Select
            label="Employé *"
            options={employeeOptions}
            value={assignForm.employeeId}
            onChange={(e) => setAssignForm({ ...assignForm, employeeId: e.target.value })}
          />
          <Input
            label="Role"
            value={assignForm.role}
            onChange={(e) => setAssignForm({ ...assignForm, role: e.target.value })}
            placeholder="Ex: Soudeur, Chef d'équipe..."
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowAssign(false)}>Annuler</Button>
            <Button onClick={handleAssign} disabled={!assignForm.employeeId}>Assigner</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

// ---------- Liste Tab ----------

interface ListeTabProps {
  items: ReturnType<typeof useProductionStore.getState>['items'];
  total: number;
  isLoading: boolean;
  filters: ReturnType<typeof useProductionStore.getState>['filters'];
  totalPages: number;
  onSearch: (v: string) => void;
  onStatut: (v: string) => void;
  onPriorite: (v: string) => void;
  onPageChange: (v: number) => void;
  onSelect: (id: number) => void;
  onEdit: (id: number) => void;
  onHardDelete: (id: number) => void;
  selectedId?: number;
  onCreate: () => void;
}

function ListeTab({
  items, total, isLoading, filters, totalPages,
  onSearch, onStatut, onPriorite, onPageChange, onSelect, onEdit, onHardDelete, selectedId, onCreate,
}: ListeTabProps) {
  const { sortedItems, sortConfig, requestSort } = useSortable(items || []);
  const { colWidths, startResize, autoFit } = useColumnResize({ numero: 90, nom: 280, statut: 100, priorite: 90, projetNom: 250, dateDebut: 110, dateFin: 110, dateEcheance: 120, montantTotal: 100 });
  const [editingDateCell, setEditingDateCell] = useState<{ id: number; field: 'dateDebut' | 'dateFin' } | null>(null);
  // FIX P0: debounce 300ms sur la recherche pour eviter spam backend a chaque
  // touche. Local state pour reactivite UI immediate, propagation differee.
  const [searchInput, setSearchInput] = useState(filters.search);
  useEffect(() => { setSearchInput(filters.search); }, [filters.search]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== filters.search) onSearch(searchInput);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const saveInlineDate = async (btId: number, field: 'dateDebut' | 'dateFin', value: string) => {
    try {
      await productionApi.updateWorkOrder(btId, { [field]: value || undefined } as any);
    } catch { /* silent */ }
    setEditingDateCell(null);
  };

  return (
    <>
      {/* Command Bar */}
      <CommandBar
        actions={[
          { label: 'Nouveau bon de travail', icon: <Plus size={16} />, onClick: onCreate, variant: 'primary' },
        ]}
        right={
          <>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Rechercher..."
                className="erp-input pl-9 w-full sm:w-48"
              />
            </div>
            <Select options={STATUT_OPTIONS} value={filters.statut} onChange={(e) => onStatut(e.target.value)} className="w-full sm:w-40" />
            <Select options={PRIORITE_OPTIONS} value={filters.priorite} onChange={(e) => onPriorite(e.target.value)} className="w-full sm:w-40" />
          </>
        }
      />

      {/* Table */}
      {isLoading ? (
        <SkeletonPage />
      ) : (
        <>
          {/* Desktop table */}
          <Card padding="sm" className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <SortableHeader sortKey="numero" sortConfig={sortConfig} onSort={requestSort} width={colWidths.numero} onResizeStart={(e) => startResize(e, 'numero')} onAutoFit={(e) => autoFit(e, 'numero')}>Numéro</SortableHeader>
                    <SortableHeader sortKey="nom" sortConfig={sortConfig} onSort={requestSort} width={colWidths.nom} onResizeStart={(e) => startResize(e, 'nom')} onAutoFit={(e) => autoFit(e, 'nom')}>Nom</SortableHeader>
                    <SortableHeader sortKey="statut" sortConfig={sortConfig} onSort={requestSort} width={colWidths.statut} onResizeStart={(e) => startResize(e, 'statut')} onAutoFit={(e) => autoFit(e, 'statut')}>Statut</SortableHeader>
                    <SortableHeader sortKey="priorite" sortConfig={sortConfig} onSort={requestSort} width={colWidths.priorite} onResizeStart={(e) => startResize(e, 'priorite')} onAutoFit={(e) => autoFit(e, 'priorite')}>Priorité</SortableHeader>
                    <SortableHeader sortKey="projetNom" sortConfig={sortConfig} onSort={requestSort} width={colWidths.projetNom} onResizeStart={(e) => startResize(e, 'projetNom')} onAutoFit={(e) => autoFit(e, 'projetNom')}>Projet</SortableHeader>
                    <SortableHeader sortKey="dateDebut" sortConfig={sortConfig} onSort={requestSort} width={colWidths.dateDebut} onResizeStart={(e) => startResize(e, 'dateDebut')} onAutoFit={(e) => autoFit(e, 'dateDebut')}>Début</SortableHeader>
                    <SortableHeader sortKey="dateFin" sortConfig={sortConfig} onSort={requestSort} width={colWidths.dateFin} onResizeStart={(e) => startResize(e, 'dateFin')} onAutoFit={(e) => autoFit(e, 'dateFin')}>Fin</SortableHeader>
                    <SortableHeader sortKey="dateEcheance" sortConfig={sortConfig} onSort={requestSort} width={colWidths.dateEcheance} onResizeStart={(e) => startResize(e, 'dateEcheance')} onAutoFit={(e) => autoFit(e, 'dateEcheance')}>Échéance</SortableHeader>
                    <SortableHeader sortKey="montantTotal" sortConfig={sortConfig} onSort={requestSort} align="right" width={colWidths.montantTotal} onResizeStart={(e) => startResize(e, 'montantTotal')} onAutoFit={(e) => autoFit(e, 'montantTotal')}>Montant</SortableHeader>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400" style={{ width: 90 }}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {sortedItems.map((bt) => (
                    <tr
                      key={bt.id}
                      onClick={() => onSelect(bt.id)}
                      className={`cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30 ${
                        selectedId === bt.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-seaop-primary-600 dark:text-seaop-primary-400">
                          {bt.numeroDocument}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 dark:text-white">{bt.nom}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={STATUT_COLORS[bt.statut] || 'gray'}>{bt.statut}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={PRIORITE_COLORS[bt.priorite] || 'gray'}>{bt.priorite}</Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                        {bt.projectNom || '--'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingDateCell({ id: bt.id, field: 'dateDebut' }); }}>
                        {editingDateCell?.id === bt.id && editingDateCell.field === 'dateDebut' ? (
                          <input type="date" autoFocus className="border border-blue-400 rounded px-1 py-0.5 text-xs bg-white dark:bg-gray-800" defaultValue={bt.dateDebut || ''} onChange={(e) => saveInlineDate(bt.id, 'dateDebut', e.target.value)} onBlur={() => setEditingDateCell(null)} onClick={(e) => e.stopPropagation()} />
                        ) : (formatDate(bt.dateDebut) || '--')}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingDateCell({ id: bt.id, field: 'dateFin' }); }}>
                        {editingDateCell?.id === bt.id && editingDateCell.field === 'dateFin' ? (
                          <input type="date" autoFocus className="border border-blue-400 rounded px-1 py-0.5 text-xs bg-white dark:bg-gray-800" defaultValue={bt.dateFin || ''} onChange={(e) => saveInlineDate(bt.id, 'dateFin', e.target.value)} onBlur={() => setEditingDateCell(null)} onClick={(e) => e.stopPropagation()} />
                        ) : (formatDate(bt.dateFin) || '--')}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                        {formatDate(bt.dateEcheance)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300 font-medium">
                        {bt.montantTotal ? formatCurrency(bt.montantTotal) : '--'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onEdit(bt.id); }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-seaop-primary-600 dark:text-seaop-primary-400 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20 rounded transition-colors"
                            title="Modifier le bon de travail"
                          >
                            <Pencil size={14} />
                            <span className="hidden lg:inline">Modifier</span>
                          </button>
                          {bt.statut === 'ANNULE' && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onHardDelete(bt.id); }}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                              title="Supprimer définitivement"
                            >
                              <Trash2 size={14} />
                              <span className="hidden lg:inline">Supprimer</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                        Aucun bon de travail trouve
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {sortedItems.map((bt) => (
              <div
                key={bt.id}
                onClick={() => onSelect(bt.id)}
                className={`border border-gray-200 dark:border-gray-700 rounded-lg p-3 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30 ${
                  selectedId === bt.id ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate mr-2">{bt.nom}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge color={STATUT_COLORS[bt.statut] || 'gray'}>{bt.statut}</Badge>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onEdit(bt.id); }}
                      className="p-1.5 text-seaop-primary-600 dark:text-seaop-primary-400 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20 rounded"
                      title="Modifier"
                    >
                      <Pencil size={14} />
                    </button>
                    {bt.statut === 'ANNULE' && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onHardDelete(bt.id); }}
                        className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                        title="Supprimer définitivement"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span className="font-mono text-seaop-primary-600 dark:text-seaop-primary-400">{bt.numeroDocument}</span>
                  <Badge color={PRIORITE_COLORS[bt.priorite] || 'gray'} size="sm">{bt.priorite}</Badge>
                  {bt.projectNom && <span>{bt.projectNom}</span>}
                  {bt.dateEcheance && (
                    <span className="flex items-center gap-1">
                      <Calendar size={10} />
                      {formatDate(bt.dateEcheance)}
                    </span>
                  )}
                  {bt.montantTotal ? (
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {formatCurrency(bt.montantTotal)}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <p className="text-center text-gray-400 py-8 text-sm">Aucun bon de travail trouve</p>
            )}
          </div>
          {totalPages > 1 && (
            <div className="mt-4">
              <Pagination page={filters.page} totalPages={totalPages} onPageChange={onPageChange} />
            </div>
          )}
          <p className="mt-2 text-xs text-gray-400 text-center">
            {total} bon{total !== 1 ? 's' : ''} de travail
          </p>
        </>
      )}
    </>
  );
}

// ---------- Detail Tab ----------

interface DetailTabProps {
  selected: ReturnType<typeof useProductionStore.getState>['selected'];
  detailLoading: boolean;
  lines: ReturnType<typeof useProductionStore.getState>['lines'];
  assignations: ReturnType<typeof useProductionStore.getState>['assignations'];
  comments: ReturnType<typeof useProductionStore.getState>['comments'];
  commentText: string;
  onCommentTextChange: (v: string) => void;
  onAddComment: () => void;
  onStatusChange: (statut: string) => void;
  onUpdate: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => Promise<void>;
  onHardDelete: () => Promise<void>;
  onRestore: () => Promise<void>;
  onShowAddLine: () => void;
  onRemoveLine: (lineId: number) => void;
  onUpdateLine: (lineId: number, data: Record<string, unknown>) => Promise<void>;
  onShowAssign: () => void;
  onRemoveAssignation: (id: number) => void;
  onBackToList: () => void;
  projects: Project[];
  operations: Operation[];
  operationTypes: string[];
  employees: Employee[];
  onAddOperation: (data: Record<string, unknown>) => Promise<void>;
  onUpdateOperation: (opId: number, data: Record<string, unknown>) => Promise<void>;
  onRemoveOperation: (opId: number) => Promise<void>;
  isCreating?: boolean;
  createForm?: { nom: string; projectId: string; priorite: string; dateEcheance: string; dateDebut: string; dateFin: string; notes: string };
  onCreateFormChange?: (form: { nom: string; projectId: string; priorite: string; dateEcheance: string; dateDebut: string; dateFin: string; notes: string }) => void;
  onCreateSubmit?: (pendingOps: Record<string, unknown>[], pendingLines: Record<string, unknown>[]) => Promise<void>;
  onCancelCreate?: () => void;
  pendingOps?: Record<string, unknown>[];
  onPendingOpsChange?: (ops: Record<string, unknown>[]) => void;
  pendingLines?: Record<string, unknown>[];
  onPendingLinesChange?: (lines: Record<string, unknown>[]) => void;
  products?: Product[];
  suppliers?: Supplier[];
  buildSupplierOptions: (currentValue?: string) => { value: string; label: string }[];
  // Permet a la liste BT (bouton "Modifier" rapide) d'ouvrir directement le
  // formulaire d'edition au lieu de la vue lecture. Le parent incremente ce
  // compteur pour declencher startEditing une seule fois (debounce StrictMode).
  autoEditTrigger?: number;
  // Force exit edit mode quand user change de BT depuis la liste (cf. handleSelectBT)
  autoCancelEditTrigger?: number;
}

function DetailTab({
  selected, detailLoading, lines, assignations, comments,
  commentText, onCommentTextChange, onAddComment,
  onStatusChange, onUpdate, onCancel, onHardDelete, onRestore, onShowAddLine, onRemoveLine, onUpdateLine,
  onShowAssign, onRemoveAssignation, onBackToList, projects,
  operations, operationTypes, employees,
  onAddOperation, onUpdateOperation, onRemoveOperation,
  isCreating, createForm, onCreateFormChange, onCreateSubmit, onCancelCreate,
  pendingOps: parentPendingOps, onPendingOpsChange,
  pendingLines: parentPendingLines, onPendingLinesChange, products: availableProducts,
  suppliers: availableSuppliers, buildSupplierOptions, autoEditTrigger, autoCancelEditTrigger,
}: DetailTabProps) {
  const [btHtmlContent, setBtHtmlContent] = useState('');
  const [showBtHtmlPreview, setShowBtHtmlPreview] = useState(false);
  const [btHtmlLoading, setBtHtmlLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ nom: '', statut: '', priorite: '', projectId: '', dateEcheance: '', dateDebut: '', dateFin: '', notes: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [showAddOp, setShowAddOp] = useState(false);
  const [editingOpId, setEditingOpId] = useState<number | null>(null);
  const [editOpForm, setEditOpForm] = useState({
    nom: '', quantite: '1', employeeId: '', fournisseur: '',
    heuresPrevues: '0', heuresReelles: '0', statut: '', dateDebut: '', dateFin: '',
  });
  const [editOpSaving, setEditOpSaving] = useState(false);
  // Lock anti double-click pour les actions destructives (Annuler / Restaurer
  // / Supprimer definitivement). Important car le bouton change de label/effet
  // selon le statut: un 2eme click rapide pourrait passer du soft au hard delete.
  const [actionPending, setActionPending] = useState(false);
  const wrapAction = (fn: () => Promise<void>) => async () => {
    if (actionPending) return;
    setActionPending(true);
    try { await fn(); }
    finally { setActionPending(false); }
  };

  const startEditOp = (op: Operation) => {
    setEditingOpId(op.id);
    setEditOpForm({
      nom: op.nom || '',
      quantite: String(op.quantite ?? 1),
      employeeId: op.employeeId ? String(op.employeeId) : '',
      fournisseur: op.fournisseur || 'Interne',
      heuresPrevues: String(op.heuresPrevues ?? 0),
      heuresReelles: String(op.heuresReelles ?? 0),
      statut: op.statut || 'En attente',
      dateDebut: op.dateDebut || '',
      dateFin: op.dateFin || '',
    });
  };

  const saveEditOp = async () => {
    if (editingOpId === null) return;
    setEditOpSaving(true);
    try {
      await onUpdateOperation(editingOpId, {
        nom: editOpForm.nom || undefined,
        quantite: parseFloat(editOpForm.quantite) || 1,
        employeeId: editOpForm.employeeId ? Number(editOpForm.employeeId) : null,
        fournisseur: editOpForm.fournisseur || undefined,
        heuresPrevues: parseFloat(editOpForm.heuresPrevues) || 0,
        heuresReelles: parseFloat(editOpForm.heuresReelles) || 0,
        statut: editOpForm.statut,
        dateDebut: editOpForm.dateDebut || undefined,
        dateFin: editOpForm.dateFin || undefined,
      });
      // FIX P1 (round 3): ne fermer le mode edition QUE en cas de succes,
      // pour preserver les modifications utilisateur si le backend rejette
      // (ex: 403 RBAC, 400 transition statut, 500). L'erreur est affichee via
      // l'Alert global du parent (extractError).
      setEditingOpId(null);
    } catch {
      // Mode edition reste ouvert; user voit l'erreur en banner et peut corriger.
    }
    finally { setEditOpSaving(false); }
  };

  // --- Line editing ---
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [editLineForm, setEditLineForm] = useState({ description: '', quantite: '1', unite: '', prixUnitaire: '0' });
  const [editLineSaving, setEditLineSaving] = useState(false);

  const startEditLine = (line: LineItem) => {
    setEditingLineId(line.id);
    setEditLineForm({
      description: line.description || '',
      quantite: String(line.quantite ?? 1),
      unite: line.unite || '',
      prixUnitaire: String(line.prixUnitaire ?? 0),
    });
  };

  const saveEditLine = async () => {
    if (editingLineId === null) return;
    setEditLineSaving(true);
    try {
      await onUpdateLine(editingLineId, {
        description: editLineForm.description,
        quantite: parseFloat(editLineForm.quantite) || 1,
        unite: editLineForm.unite || undefined,
        prixUnitaire: parseFloat(editLineForm.prixUnitaire) || 0,
      });
      setEditingLineId(null);
    } catch { /* error handled by parent */ }
    finally { setEditLineSaving(false); }
  };

  const [opForm, setOpForm] = useState({
    nom: '', description: '', quantite: '1', employeeId: '', fournisseur: 'Interne',
    heuresPrevues: '0', statut: 'En attente', dateDebut: '', dateFin: '',
  });
  const resetOpForm = () => setOpForm({
    nom: '', description: '', quantite: '1', employeeId: '', fournisseur: 'Interne',
    heuresPrevues: '0', statut: 'En attente', dateDebut: '', dateFin: '',
  });
  const [opAdding, setOpAdding] = useState(false);
  const handleAddOperation = async () => {
    if (opAdding) return;
    setOpAdding(true);
    try {
      await onAddOperation({
        nom: opForm.nom || undefined,
        description: opForm.description || undefined,
        quantite: parseFloat(opForm.quantite) || 1,
        employeeId: opForm.employeeId ? Number(opForm.employeeId) : undefined,
        fournisseur: opForm.fournisseur || 'Interne',
        heuresPrevues: parseFloat(opForm.heuresPrevues) || 0,
        statut: opForm.statut,
        dateDebut: opForm.dateDebut || undefined,
        dateFin: opForm.dateFin || undefined,
      });
      // FIX P1 (round 5): reset + close UNIQUEMENT en succes (cf. saveEditOp).
      // Si backend reject (RBAC, validation), preserve les valeurs saisies.
      resetOpForm();
      setShowAddOp(false);
    } catch {
      // Erreur affichee via Alert global (store.error). Form reste ouvert.
    } finally {
      setOpAdding(false);
    }
  };
  // FIX P1 (round 5): wrapper pour confirm + catch silent (re-throw du store)
  const handleRemoveOperation = async (opId: number) => {
    if (!window.confirm('Supprimer cette opération ?')) return;
    try {
      await onRemoveOperation(opId);
    } catch {
      // Erreur affichee via Alert global. Operation reste affichee.
    }
  };
  const opTotalPrevues = operations.reduce((s, o) => s + (o.heuresPrevues || 0), 0);
  const opTotalReelles = operations.reduce((s, o) => s + (o.heuresReelles || 0), 0);
  const opTypeOptions = [
    { value: '', label: 'Sélectionner une opération' },
    ...operationTypes.map((t) => ({ value: t, label: t })),
  ];
  const empOptions = [
    { value: '', label: '-- Interne --' },
    ...employees.map((e) => ({ value: String(e.id), label: `${e.prenom} ${e.nom}` })),
  ];

  const handlePreviewHtml = async () => {
    if (!selected) return;
    setBtHtmlLoading(true);
    try {
      const res = await productionApi.generateBTHtml(selected.id);
      setBtHtmlContent(res.html);
      setShowBtHtmlPreview(true);
    } catch {
      // silent
    } finally {
      setBtHtmlLoading(false);
    }
  };

  // FIX React #310: tous les hooks doivent etre appeles inconditionnellement.
  // Ces refs/effects etaient apres les early returns (detailLoading, isCreating)
  // ce qui violait les Rules of Hooks lors d'une transition entre modes.
  const lastAutoEditRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      autoEditTrigger !== undefined
      && autoEditTrigger !== lastAutoEditRef.current
      && selected
      && !isEditing
      && !isCreating
    ) {
      lastAutoEditRef.current = autoEditTrigger;
      startEditing();
    }
  }, [autoEditTrigger, selected]);

  const lastAutoCancelEditRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      autoCancelEditTrigger !== undefined
      && autoCancelEditTrigger !== lastAutoCancelEditRef.current
    ) {
      lastAutoCancelEditRef.current = autoCancelEditTrigger;
      if (isEditing) setIsEditing(false);
      // Defense en profondeur: reset editForm pour eviter qu'une future
      // re-entree en mode edition (sans appeler startEditing) affiche les
      // valeurs de l'ancien BT.
      setEditForm({ nom: '', statut: '', priorite: '', projectId: '', dateEcheance: '', dateDebut: '', dateFin: '', notes: '' });
    }
  }, [autoCancelEditTrigger]);

  if (detailLoading) {
    return <SkeletonPage />;
  }

  // ---- MODE CREATION PLEINE PAGE ----
  if (isCreating && !selected && createForm && onCreateFormChange) {
    const ops = parentPendingOps || [];
    const setOps = onPendingOpsChange || (() => {});
    const handleCancelCreate = () => {
      setOps([]);
      if (onPendingLinesChange) onPendingLinesChange([]);
      resetOpForm();
      setShowAddOp(false);
      if (onCancelCreate) onCancelCreate();
    };
    const handleAddPendingOp = () => {
      setOps([...ops, {
        nom: opForm.nom || undefined,
        description: opForm.description || undefined,
        quantite: parseFloat(opForm.quantite) || 1,
        employeeId: opForm.employeeId ? Number(opForm.employeeId) : undefined,
        fournisseur: opForm.fournisseur || 'Interne',
        heuresPrevues: parseFloat(opForm.heuresPrevues) || 0,
        statut: opForm.statut,
        dateDebut: opForm.dateDebut || undefined,
        dateFin: opForm.dateFin || undefined,
      }]);
      resetOpForm();
      setShowAddOp(false);
    };
    const handleRemovePendingOp = (idx: number) => {
      setOps(ops.filter((_, i) => i !== idx));
    };
    const handleSubmitCreate = async () => {
      if (!onCreateSubmit) return;
      setCreateSaving(true);
      try {
        const lns = parentPendingLines || [];
        await onCreateSubmit(ops, lns);
        setOps([]);
        if (onPendingLinesChange) onPendingLinesChange([]);
      } finally {
        setCreateSaving(false);
      }
    };
    const pendingTotalH = ops.reduce((s, o) => s + (Number(o.heuresPrevues) || 0), 0);
    const projectOptions = [
      { value: '', label: 'Aucun projet' },
      ...projects.map((p) => ({ value: String(p.id), label: p.nomProjet })),
    ];
    return (
      <div className="space-y-6">
        <Card>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Plus size={16} className="text-gray-400" />
                Nouveau bon de travail
              </h3>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={handleCancelCreate} disabled={createSaving}>
                  Annuler
                </Button>
                <Button size="sm" variant="primary" leftIcon={<Save size={14} />} onClick={handleSubmitCreate} isLoading={createSaving}>
                  Créer{ops.length > 0 || (parentPendingLines || []).length > 0 ? ` + ${ops.length} op. ${(parentPendingLines || []).length} prod.` : ''}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Nom</label>
                <Input
                  value={createForm.nom}
                  onChange={(e) => onCreateFormChange({ ...createForm, nom: e.target.value })}
                  placeholder="Optionnel — le nom du projet sera utilise si vide"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Priorité</label>
                <Select
                  value={createForm.priorite}
                  onChange={(e) => onCreateFormChange({ ...createForm, priorite: e.target.value })}
                  options={PRIORITE_FORM_OPTIONS}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Projet</label>
                <Select
                  value={createForm.projectId}
                  onChange={(e) => onCreateFormChange({ ...createForm, projectId: e.target.value })}
                  options={projectOptions}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1 flex items-center gap-1">
                  <Calendar size={12} /> Date debut prevu
                </label>
                <Input type="date" value={createForm.dateDebut} onChange={(e) => onCreateFormChange({ ...createForm, dateDebut: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1 flex items-center gap-1">
                  <Calendar size={12} /> Date fin prevu
                </label>
                <Input type="date" value={createForm.dateFin} onChange={(e) => onCreateFormChange({ ...createForm, dateFin: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1 flex items-center gap-1">
                  <Calendar size={12} /> Date d'echeance
                </label>
                <Input type="date" value={createForm.dateEcheance} onChange={(e) => onCreateFormChange({ ...createForm, dateEcheance: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Montant total</label>
                <p className="text-sm text-gray-400 py-2">-- (calcule depuis les lignes)</p>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Notes</label>
                <Textarea
                  value={createForm.notes}
                  onChange={(e) => onCreateFormChange({ ...createForm, notes: e.target.value })}
                  placeholder="Instructions, détails supplémentaires..."
                  rows={3}
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Operations — ajout local avant creation */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Wrench size={16} className="text-gray-400" /> Opérations ({ops.length})
            </h4>
            <Button size="sm" variant="ghost" leftIcon={<Plus size={14} />} onClick={() => setShowAddOp(true)}>
              Ajouter une tâche
            </Button>
          </div>

          {showAddOp && (
            <div className="mb-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/30 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Select label="Poste/Opération" options={opTypeOptions} value={opForm.nom} onChange={(e) => setOpForm((f) => ({ ...f, nom: e.target.value }))} />
                <Input label="Quantité" type="number" min="0" step="1" value={opForm.quantite} onChange={(e) => setOpForm((f) => ({ ...f, quantite: e.target.value }))} />
                <Select label="Assigné à" options={empOptions} value={opForm.employeeId} onChange={(e) => setOpForm((f) => ({ ...f, employeeId: e.target.value }))} />
                <Select
                  label="Fournisseur/Sous-traitant"
                  options={buildSupplierOptions(opForm.fournisseur)}
                  value={opForm.fournisseur || 'Interne'}
                  onChange={(e) => setOpForm((f) => ({ ...f, fournisseur: e.target.value }))}
                />
                <Input label="Heures prévues" type="number" min="0" step="0.5" value={opForm.heuresPrevues} onChange={(e) => setOpForm((f) => ({ ...f, heuresPrevues: e.target.value }))} />
                <Select label="Statut" options={OPERATION_STATUT_OPTIONS} value={opForm.statut} onChange={(e) => setOpForm((f) => ({ ...f, statut: e.target.value }))} />
                <Input label="Date début" type="date" value={opForm.dateDebut} onChange={(e) => setOpForm((f) => ({ ...f, dateDebut: e.target.value }))} />
                <Input label="Date fin" type="date" value={opForm.dateFin} onChange={(e) => setOpForm((f) => ({ ...f, dateFin: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => { resetOpForm(); setShowAddOp(false); }}>Annuler</Button>
                <Button size="sm" onClick={handleAddPendingOp} disabled={!opForm.nom}>Ajouter</Button>
              </div>
            </div>
          )}

          {ops.length === 0 && !showAddOp ? (
            <p className="text-xs text-gray-400 text-center py-4">Aucune opération — cliquez &quot;Ajouter une tâche&quot;</p>
          ) : ops.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="pb-2 text-left text-xs font-medium text-gray-500">Opération</th>
                      <th className="pb-2 text-right text-xs font-medium text-gray-500">Qte</th>
                      <th className="pb-2 text-left text-xs font-medium text-gray-500">Fournisseur</th>
                      <th className="pb-2 text-right text-xs font-medium text-gray-500">H. Prevues</th>
                      <th className="pb-2 text-center text-xs font-medium text-gray-500">Statut</th>
                      <th className="pb-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {ops.map((op, idx) => (
                      <tr key={idx}>
                        <td className="py-2 text-sm">{String(op.nom || '')}</td>
                        <td className="py-2 text-sm text-right">{String(op.quantite || 1)}</td>
                        <td className="py-2 text-sm">{String(op.fournisseur || 'Interne')}</td>
                        <td className="py-2 text-sm text-right">{Number(op.heuresPrevues || 0)}h</td>
                        <td className="py-2 text-sm text-center">{String(op.statut || 'En attente')}</td>
                        <td className="py-2 text-center">
                          <button onClick={() => handleRemovePendingOp(idx)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-right text-xs text-gray-500 mt-2">
                Total: <strong>{pendingTotalH}h</strong> prevues
              </div>
            </>
          )}
        </Card>

        {/* Produits / Materiaux — selection depuis l'inventaire */}
        {(() => {
          const prodLines = parentPendingLines || [];
          const setLines = onPendingLinesChange || (() => {});
          const prods = availableProducts || [];
          const prodOptions = [
            { value: '', label: 'Sélectionner un produit...' },
            ...prods.map((p) => ({ value: String(p.id), label: `${p.nom}${p.codeProduit ? ` (${p.codeProduit})` : ''} — ${p.stockDisponible} en stock` })),
          ];
          const prodTotal = prodLines.reduce((s, l) => s + (Number(l.montant) || 0), 0);
          return (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Package size={16} className="text-gray-400" /> Produits / Materiaux ({prodLines.length})
                </h4>
                <Button size="sm" variant="ghost" leftIcon={<Plus size={14} />} onClick={() => {
                  const defaultLine = { productId: '', description: '', quantite: '1', unite: '', prixUnitaire: '0', montant: 0 };
                  setLines([...prodLines, defaultLine]);
                }}>
                  Ajouter un produit
                </Button>
              </div>

              {prodLines.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">Aucun produit — cliquez &quot;Ajouter un produit&quot;</p>
              ) : (
                <>
                  <div className="space-y-3">
                    {prodLines.map((line, idx) => {
                      const selectedProd = prods.find((p) => String(p.id) === String(line.productId));
                      return (
                        <div key={idx} className="flex items-end gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/30">
                          <div className="flex-1 min-w-0">
                            <label className="block text-xs text-gray-500 mb-1">Produit</label>
                            <Select
                              options={prodOptions}
                              value={String(line.productId || '')}
                              onChange={(e) => {
                                const pid = e.target.value;
                                const p = prods.find((pr) => String(pr.id) === pid);
                                const updated = [...prodLines];
                                const q = Number(line.quantite) || 1;
                                const pu = p?.prixUnitaire || p?.coutRevient || 0;
                                updated[idx] = { ...line, productId: pid, produitId: pid ? Number(pid) : undefined, description: p?.nom || '', unite: p?.uniteVente || '', prixUnitaire: String(pu), montant: q * pu };
                                setLines(updated);
                              }}
                            />
                          </div>
                          <div className="w-20">
                            <label className="block text-xs text-gray-500 mb-1">Qte</label>
                            <Input
                              type="number" min="0" step="1"
                              value={String(line.quantite || '1')}
                              onChange={(e) => {
                                const q = parseFloat(e.target.value) || 0;
                                const pu = Number(line.prixUnitaire) || 0;
                                const updated = [...prodLines];
                                updated[idx] = { ...line, quantite: e.target.value, montant: q * pu };
                                setLines(updated);
                              }}
                            />
                          </div>
                          <div className="w-20">
                            <label className="block text-xs text-gray-500 mb-1">Unité</label>
                            <Input value={String(line.unite || '')} disabled className="bg-gray-100" />
                          </div>
                          <div className="w-28">
                            <label className="block text-xs text-gray-500 mb-1">Prix unit.</label>
                            <Input
                              type="number" min="0" step="0.01"
                              value={String(line.prixUnitaire || '0')}
                              onChange={(e) => {
                                const pu = parseFloat(e.target.value) || 0;
                                const q = Number(line.quantite) || 1;
                                const updated = [...prodLines];
                                updated[idx] = { ...line, prixUnitaire: e.target.value, montant: q * pu };
                                setLines(updated);
                              }}
                            />
                          </div>
                          <div className="w-28 text-right">
                            <label className="block text-xs text-gray-500 mb-1">Montant</label>
                            <p className="text-sm font-semibold py-2">{(Number(line.montant) || 0).toFixed(2)} $</p>
                          </div>
                          <button onClick={() => setLines(prodLines.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 pb-2">
                            <X size={16} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-right text-xs text-gray-500 mt-3">
                    Total materiaux: <strong>{(prodTotal ?? 0).toFixed(2)} $</strong>
                  </div>
                </>
              )}
            </Card>
          );
        })()}
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="text-center py-16">
        <ClipboardList size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-gray-500 dark:text-gray-400">
          Sélectionnez un bon de travail dans la liste pour voir ses détails
        </p>
        <Button variant="ghost" className="mt-4" onClick={onBackToList}>
          Retour a la liste
        </Button>
      </div>
    );
  }

  // Status workflow buttons - transitions valides UNIQUEMENT (pas l'annulation,
  // qui est gere via le bouton dedie onCancel pour eviter le doublon avec
  // statut=ANNULE qui faisait juste un PUT sans reverse stock).
  const statusActions: { label: string; statut: string; icon: React.ReactNode; variant: 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger' }[] = [];
  if (selected.statut === 'BROUILLON') {
    statusActions.push({ label: 'Demarrer', statut: 'EN_COURS', icon: <Play size={14} />, variant: 'primary' });
  } else if (selected.statut === 'EN_COURS') {
    statusActions.push({ label: 'Pause', statut: 'EN_PAUSE', icon: <Pause size={14} />, variant: 'secondary' });
    statusActions.push({ label: 'Terminer', statut: 'TERMINE', icon: <CheckCircle size={14} />, variant: 'accent' });
  } else if (selected.statut === 'EN_PAUSE') {
    statusActions.push({ label: 'Reprendre', statut: 'EN_COURS', icon: <Play size={14} />, variant: 'primary' });
  }

  const linesTotalCalc = lines.reduce((sum, l) => sum + (l.montantLigne || 0), 0);

  const startEditing = () => {
    setEditForm({
      nom: selected.nom || '',
      statut: selected.statut || 'BROUILLON',
      priorite: selected.priorite || 'NORMALE',
      projectId: selected.projectId ? String(selected.projectId) : '',
      dateEcheance: selected.dateEcheance ? selected.dateEcheance.slice(0, 10) : '',
      dateDebut: selected.dateDebut ? selected.dateDebut.slice(0, 10) : '',
      dateFin: selected.dateFin ? selected.dateFin.slice(0, 10) : '',
      notes: selected.notes || '',
    });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const saveEditing = async () => {
    setEditSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (editForm.nom !== (selected.nom || '')) updates.nom = editForm.nom;
      if (editForm.statut !== (selected.statut || '')) updates.statut = editForm.statut;
      if (editForm.priorite !== (selected.priorite || '')) updates.priorite = editForm.priorite;
      const newProjectId = editForm.projectId ? Number(editForm.projectId) : null;
      const oldProjectId = selected.projectId || null;
      if (newProjectId !== oldProjectId) updates.projectId = newProjectId;
      const newDate = editForm.dateEcheance || null;
      const oldDate = selected.dateEcheance ? selected.dateEcheance.slice(0, 10) : null;
      if (newDate !== oldDate) updates.dateEcheance = newDate;
      const newDebut = editForm.dateDebut || null;
      const oldDebut = selected.dateDebut ? selected.dateDebut.slice(0, 10) : null;
      if (newDebut !== oldDebut) updates.dateDebut = newDebut;
      const newFin = editForm.dateFin || null;
      const oldFin = selected.dateFin ? selected.dateFin.slice(0, 10) : null;
      if (newFin !== oldFin) updates.dateFin = newFin;
      if (editForm.notes !== (selected.notes || '')) updates.notes = editForm.notes;
      if (Object.keys(updates).length > 0) {
        await onUpdate(updates);
      }
      setIsEditing(false);
    } catch {
      // error handled by store
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        {isEditing ? (
          /* ---- MODE EDITION ---- */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Pencil size={16} className="text-gray-400" />
                Modifier le bon de travail
              </h3>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={cancelEditing} disabled={editSaving}>
                  Annuler
                </Button>
                <Button size="sm" variant="primary" leftIcon={<Save size={14} />} onClick={saveEditing} isLoading={editSaving}>
                  Enregistrer
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Nom</label>
                <Input
                  value={editForm.nom}
                  onChange={(e) => setEditForm((f) => ({ ...f, nom: e.target.value }))}
                  placeholder="Nom du bon de travail"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Statut</label>
                <Select
                  value={editForm.statut}
                  onChange={(e) => setEditForm((f) => ({ ...f, statut: e.target.value }))}
                  options={[
                    { value: 'BROUILLON', label: 'Brouillon' },
                    { value: 'EN_COURS', label: 'En cours' },
                    { value: 'EN_PAUSE', label: 'En pause' },
                    { value: 'TERMINE', label: 'Terminé' },
                    { value: 'ANNULE', label: 'Annule' },
                  ]}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Priorité</label>
                <Select
                  value={editForm.priorite}
                  onChange={(e) => setEditForm((f) => ({ ...f, priorite: e.target.value }))}
                  options={PRIORITE_FORM_OPTIONS}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Projet</label>
                <Select
                  value={editForm.projectId}
                  onChange={(e) => setEditForm((f) => ({ ...f, projectId: e.target.value }))}
                  options={[
                    { value: '', label: 'Aucun projet' },
                    ...projects.map((p) => ({ value: String(p.id), label: p.nomProjet })),
                  ]}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1 flex items-center gap-1">
                  <Calendar size={12} /> Date debut prevu
                </label>
                <Input type="date" value={editForm.dateDebut} onChange={(e) => setEditForm((f) => ({ ...f, dateDebut: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1 flex items-center gap-1">
                  <Calendar size={12} /> Date fin prevu
                </label>
                <Input type="date" value={editForm.dateFin} onChange={(e) => setEditForm((f) => ({ ...f, dateFin: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1 flex items-center gap-1">
                  <Calendar size={12} /> Date d'echeance
                </label>
                <Input type="date" value={editForm.dateEcheance} onChange={(e) => setEditForm((f) => ({ ...f, dateEcheance: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Montant total</label>
                <p className="text-sm text-gray-400 py-2">
                  {selected.montantTotal ? formatCurrency(selected.montantTotal) : '--'} (calcule depuis les lignes)
                </p>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Notes</label>
                <Textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Notes..."
                  rows={3}
                />
              </div>
            </div>
          </div>
        ) : (
          /* ---- MODE LECTURE ---- */
          <>
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-mono text-sm text-seaop-primary-600 dark:text-seaop-primary-400 bg-seaop-primary-50 dark:bg-seaop-primary-900/20 px-2 py-0.5 rounded">
                    {selected.numeroDocument}
                  </span>
                  <Badge color={STATUT_COLORS[selected.statut] || 'gray'} size="md">
                    {selected.statut}
                  </Badge>
                  <Badge color={PRIORITE_COLORS[selected.priorite] || 'gray'} size="md">
                    {selected.priorite === 'URGENTE' && <AlertTriangle size={12} className="mr-1" />}
                    {selected.priorite}
                  </Badge>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">{selected.nom}</h3>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Pencil size={14} />}
                  onClick={startEditing}
                >
                  Modifier
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Code2 size={14} />}
                  onClick={handlePreviewHtml}
                  isLoading={btHtmlLoading}
                >
                  HTML
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Eye size={14} />}
                  onClick={handlePreviewHtml}
                  disabled={btHtmlLoading}
                >
                  Aperçu
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<Printer size={14} />}
                  onClick={() => openWorkOrderExport(selected.id)}
                >
                  PDF
                </Button>
                {statusActions.map((action) => (
                  <Button
                    key={action.statut}
                    size="sm"
                    variant={action.variant}
                    leftIcon={action.icon}
                    onClick={() => onStatusChange(action.statut)}
                  >
                    {action.label}
                  </Button>
                ))}
                {selected.statut === 'ANNULE' ? (
                  <>
                    <Button
                      size="sm"
                      variant="accent"
                      leftIcon={<RotateCcw size={14} />}
                      onClick={wrapAction(onRestore)}
                      disabled={actionPending}
                      isLoading={actionPending}
                      title="Restaurer ce BT en BROUILLON"
                    >
                      Restaurer
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      leftIcon={<Trash2 size={14} />}
                      onClick={wrapAction(onHardDelete)}
                      disabled={actionPending}
                      isLoading={actionPending}
                      title="Suppression definitive (irreversible)"
                    >
                      Supprimer définitivement
                    </Button>
                  </>
                ) : selected.statut !== 'TERMINE' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Ban size={14} />}
                    onClick={wrapAction(onCancel)}
                    disabled={actionPending}
                    isLoading={actionPending}
                    title="Annuler ce BT (statut -> ANNULE, stock restaure)"
                  >
                    Annuler
                  </Button>
                ) : null}
              </div>
            </div>

            {/* Info grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <div>
                <p className="text-xs text-gray-500 uppercase font-medium mb-1">Projet</p>
                <p className="text-sm text-gray-900 dark:text-white">{selected.projectNom || '--'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-medium mb-1 flex items-center gap-1">
                  <Calendar size={12} /> Debut prevu
                </p>
                <p className="text-sm text-gray-900 dark:text-white">{formatDate(selected.dateDebut)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-medium mb-1 flex items-center gap-1">
                  <Calendar size={12} /> Fin prevu
                </p>
                <p className="text-sm text-gray-900 dark:text-white">{formatDate(selected.dateFin)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-medium mb-1 flex items-center gap-1">
                  <Calendar size={12} /> Echeance
                </p>
                <p className="text-sm text-gray-900 dark:text-white">{formatDate(selected.dateEcheance)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-medium mb-1 flex items-center gap-1">
                  <DollarSign size={12} /> Montant total
                </p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {selected.montantTotal ? formatCurrency(selected.montantTotal) : '--'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-medium mb-1">Créé le</p>
                <p className="text-sm text-gray-900 dark:text-white">{formatDate(selected.createdAt)}</p>
              </div>
            </div>

            {selected.notes && (
              <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-sm text-gray-600 dark:text-gray-400">
                {selected.notes}
              </div>
            )}
          </>
        )}
      </Card>

      {/* Operations section */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Wrench size={16} className="text-gray-400" /> Opérations ({operations.length})
          </h4>
          <Button size="sm" variant="ghost" leftIcon={<Plus size={14} />} onClick={() => setShowAddOp(true)}>
            Ajouter une tâche
          </Button>
        </div>

        {showAddOp && (
          <div className="mb-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/30 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Select
                label="Poste/Opération"
                options={opTypeOptions}
                value={opForm.nom}
                onChange={(e) => setOpForm((f) => ({ ...f, nom: e.target.value }))}
              />
              <Input
                label="Quantité"
                type="number"
                min="0"
                step="1"
                value={opForm.quantite}
                onChange={(e) => setOpForm((f) => ({ ...f, quantite: e.target.value }))}
              />
              <Select
                label="Assigne a"
                options={empOptions}
                value={opForm.employeeId}
                onChange={(e) => setOpForm((f) => ({ ...f, employeeId: e.target.value }))}
              />
              <Select
                label="Fournisseur/Sous-traitant"
                options={buildSupplierOptions(opForm.fournisseur)}
                value={opForm.fournisseur || 'Interne'}
                onChange={(e) => setOpForm((f) => ({ ...f, fournisseur: e.target.value }))}
              />
              <Input
                label="Heures prévues"
                type="number"
                min="0"
                step="0.5"
                value={opForm.heuresPrevues}
                onChange={(e) => setOpForm((f) => ({ ...f, heuresPrevues: e.target.value }))}
              />
              <Select
                label="Statut"
                options={OPERATION_STATUT_OPTIONS}
                value={opForm.statut}
                onChange={(e) => setOpForm((f) => ({ ...f, statut: e.target.value }))}
              />
              <Input
                label="Date début"
                type="date"
                value={opForm.dateDebut}
                onChange={(e) => setOpForm((f) => ({ ...f, dateDebut: e.target.value }))}
              />
              <Input
                label="Date fin"
                type="date"
                value={opForm.dateFin}
                onChange={(e) => setOpForm((f) => ({ ...f, dateFin: e.target.value }))}
              />
            </div>
            <Textarea
              label="Description"
              value={opForm.description}
              onChange={(e) => setOpForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="Description détaillée de la tâche"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { resetOpForm(); setShowAddOp(false); }}>Annuler</Button>
              <Button size="sm" onClick={handleAddOperation} disabled={!opForm.nom}>Ajouter</Button>
            </div>
          </div>
        )}

        {operations.length === 0 && !showAddOp ? (
          <p className="text-xs text-gray-400 text-center py-4">Aucune opération</p>
        ) : operations.length > 0 && (
          <>
            {/* Desktop table */}
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="pb-2 text-left text-xs font-medium text-gray-500">Operation</th>
                    <th className="pb-2 text-right text-xs font-medium text-gray-500">Qte</th>
                    <th className="pb-2 text-left text-xs font-medium text-gray-500">Assigne a</th>
                    <th className="pb-2 text-left text-xs font-medium text-gray-500">Fournisseur</th>
                    <th className="pb-2 text-center text-xs font-medium text-gray-500">Début</th>
                    <th className="pb-2 text-center text-xs font-medium text-gray-500">Fin</th>
                    <th className="pb-2 text-right text-xs font-medium text-gray-500">H. Prévues</th>
                    <th className="pb-2 text-right text-xs font-medium text-gray-500">H. Réelles</th>
                    <th className="pb-2 text-center text-xs font-medium text-gray-500">Statut</th>
                    <th className="pb-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {operations.map((op) => editingOpId === op.id ? (
                    <tr key={op.id} className="bg-blue-50/50 dark:bg-blue-900/10">
                      <td className="py-1.5">
                        <input value={editOpForm.nom} onChange={(e) => setEditOpForm({ ...editOpForm, nom: e.target.value })}
                          className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800" />
                      </td>
                      <td className="py-1.5">
                        <input type="number" value={editOpForm.quantite} onChange={(e) => setEditOpForm({ ...editOpForm, quantite: e.target.value })}
                          className="w-16 text-sm text-right border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800" />
                      </td>
                      <td className="py-1.5">
                        <select value={editOpForm.employeeId} onChange={(e) => setEditOpForm({ ...editOpForm, employeeId: e.target.value })}
                          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-800 max-w-[120px]">
                          <option value="">--</option>
                          {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.prenom} {emp.nom}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5">
                        <select
                          value={editOpForm.fournisseur || 'Interne'}
                          onChange={(e) => setEditOpForm({ ...editOpForm, fournisseur: e.target.value })}
                          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-800 max-w-[140px]"
                          title="Interne ou fournisseur du Magasin"
                        >
                          {buildSupplierOptions(editOpForm.fournisseur).map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5">
                        <input type="date" value={editOpForm.dateDebut} onChange={(e) => setEditOpForm({ ...editOpForm, dateDebut: e.target.value })}
                          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-800" />
                      </td>
                      <td className="py-1.5">
                        <input type="date" value={editOpForm.dateFin} onChange={(e) => setEditOpForm({ ...editOpForm, dateFin: e.target.value })}
                          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-800" />
                      </td>
                      <td className="py-1.5">
                        <input type="number" step="0.5" value={editOpForm.heuresPrevues} onChange={(e) => setEditOpForm({ ...editOpForm, heuresPrevues: e.target.value })}
                          className="w-16 text-sm text-right border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800" />
                      </td>
                      <td className="py-1.5">
                        <input type="number" step="0.5" value={editOpForm.heuresReelles} onChange={(e) => setEditOpForm({ ...editOpForm, heuresReelles: e.target.value })}
                          className="w-16 text-sm text-right border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800" />
                      </td>
                      <td className="py-1.5 text-center">
                        <select value={editOpForm.statut} onChange={(e) => setEditOpForm({ ...editOpForm, statut: e.target.value })}
                          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-800">
                          {OPERATION_STATUT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5">
                        <div className="flex items-center gap-1">
                          <button onClick={saveEditOp} disabled={editOpSaving}
                            className="p-1 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20" title="Enregistrer">
                            <Save size={14} />
                          </button>
                          <button onClick={() => setEditingOpId(null)}
                            className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" title="Annuler">
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={op.id}>
                      <td className="py-2">
                        <div className="font-medium text-gray-900 dark:text-white">{op.nom || '--'}</div>
                        {op.description && <div className="text-xs text-gray-400 truncate max-w-[200px]">{op.description}</div>}
                      </td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400">{op.quantite}</td>
                      <td className="py-2 text-gray-600 dark:text-gray-400 text-xs">{op.employeeNom || '--'}</td>
                      <td className="py-2 text-gray-500 dark:text-gray-400 text-xs">{op.fournisseur || 'Interne'}</td>
                      <td className="py-2 text-center text-gray-500 dark:text-gray-400 text-xs">{op.dateDebut ? formatDate(op.dateDebut) : '--'}</td>
                      <td className="py-2 text-center text-gray-500 dark:text-gray-400 text-xs">{op.dateFin ? formatDate(op.dateFin) : '--'}</td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400">{op.heuresPrevues?.toFixed(1) || '0.0'}</td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400">{op.heuresReelles?.toFixed(1) || '0.0'}</td>
                      <td className="py-2 text-center">
                        <select
                          value={op.statut}
                          onChange={(e) => {
                            // FIX P2 (round 5): catch silent pour eviter unhandled
                            // promise rejection (le store re-throw maintenant).
                            onUpdateOperation(op.id, { statut: e.target.value }).catch(() => {});
                          }}
                          className="text-xs border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-800"
                        >
                          {OPERATION_STATUT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-0.5">
                          <button onClick={() => startEditOp(op)}
                            className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20" title="Modifier">
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleRemoveOperation(op.id)}
                            className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                            title="Supprimer (avec confirmation)"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600">
                    <td colSpan={6} className="py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300">
                      Totaux
                    </td>
                    <td className="py-2 text-right font-bold text-gray-900 dark:text-white">{(opTotalPrevues ?? 0).toFixed(1)}h</td>
                    <td className="py-2 text-right font-bold text-gray-900 dark:text-white">{(opTotalReelles ?? 0).toFixed(1)}h</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {operations.map((op) => (
                <div key={op.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate mr-2">{op.nom || '--'}</span>
                    <div className="flex items-center gap-1.5">
                      <Badge color={OPERATION_STATUT_COLORS[op.statut] || 'gray'} size="sm">{op.statut}</Badge>
                      <button onClick={() => startEditOp(op)}
                        className="p-1 rounded text-gray-400 hover:text-blue-500" title="Modifier">
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleRemoveOperation(op.id)}
                        className="p-1 rounded text-gray-400 hover:text-red-500"
                        title="Supprimer (avec confirmation)"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>Qte: {op.quantite}</span>
                    {op.employeeNom && <span>{op.employeeNom}</span>}
                    <span className="flex items-center gap-1"><Clock size={10} /> {op.heuresPrevues?.toFixed(1) || '0'}h prév / {op.heuresReelles?.toFixed(1) || '0'}h réel</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700 text-xs">
                <span className="font-semibold text-gray-700 dark:text-gray-300">Totaux</span>
                <span className="font-bold text-gray-900 dark:text-white">{(opTotalPrevues ?? 0).toFixed(1)}h prévues / {(opTotalReelles ?? 0).toFixed(1)}h réelles</span>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Lines + Assignations side by side on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lines */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Lignes ({lines.length})
            </h4>
            <Button size="sm" variant="ghost" leftIcon={<Plus size={14} />} onClick={onShowAddLine}>
              Ajouter
            </Button>
          </div>
          {lines.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Aucune ligne</p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="overflow-x-auto hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="pb-2 text-left text-xs font-medium text-gray-500">Description</th>
                      <th className="pb-2 text-right text-xs font-medium text-gray-500">Qte</th>
                      <th className="pb-2 text-left text-xs font-medium text-gray-500">Unité</th>
                      <th className="pb-2 text-right text-xs font-medium text-gray-500">P.U.</th>
                      <th className="pb-2 text-right text-xs font-medium text-gray-500">Montant</th>
                      <th className="pb-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {lines.map((line) => editingLineId === line.id ? (
                      <tr key={line.id} className="bg-blue-50/50 dark:bg-blue-900/10">
                        <td className="py-1.5">
                          <input value={editLineForm.description} onChange={(e) => setEditLineForm({ ...editLineForm, description: e.target.value })}
                            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800" />
                        </td>
                        <td className="py-1.5">
                          <input type="number" value={editLineForm.quantite} onChange={(e) => setEditLineForm({ ...editLineForm, quantite: e.target.value })}
                            className="w-16 text-sm text-right border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800" />
                        </td>
                        <td className="py-1.5">
                          <input value={editLineForm.unite} onChange={(e) => setEditLineForm({ ...editLineForm, unite: e.target.value })}
                            className="w-16 text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800" placeholder="unite" />
                        </td>
                        <td className="py-1.5">
                          <input type="number" step="0.01" value={editLineForm.prixUnitaire} onChange={(e) => setEditLineForm({ ...editLineForm, prixUnitaire: e.target.value })}
                            className="w-20 text-sm text-right border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800" />
                        </td>
                        <td className="py-1.5 text-right text-sm font-medium text-gray-500">
                          {formatCurrency((parseFloat(editLineForm.quantite) || 0) * (parseFloat(editLineForm.prixUnitaire) || 0))}
                        </td>
                        <td className="py-1.5">
                          <div className="flex items-center gap-1">
                            <button onClick={saveEditLine} disabled={editLineSaving}
                              className="p-1 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20" title="Enregistrer">
                              <Save size={14} />
                            </button>
                            <button onClick={() => setEditingLineId(null)}
                              className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" title="Annuler">
                              <X size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={line.id}>
                        <td className="py-2 text-gray-900 dark:text-white">
                          {line.description}
                          {line.produitNom && <span className="ml-1.5 text-[10px] text-blue-500 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">Inventaire</span>}
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">{line.quantite}</td>
                        <td className="py-2 text-gray-500 dark:text-gray-400">{line.unite || '--'}</td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          {formatCurrency(line.prixUnitaire)}
                        </td>
                        <td className="py-2 text-right font-medium text-gray-900 dark:text-white">
                          {formatCurrency(line.montantLigne)}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-0.5">
                            <button onClick={() => startEditLine(line)}
                              className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20" title="Modifier">
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => onRemoveLine(line.id)}
                              className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 dark:border-gray-600">
                      <td colSpan={4} className="py-2 text-right font-semibold text-gray-700 dark:text-gray-300">
                        Total
                      </td>
                      <td className="py-2 text-right font-bold text-gray-900 dark:text-white">
                        {formatCurrency(linesTotalCalc)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {lines.map((line) => (
                  <div key={line.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate mr-2">
                        {line.description}
                        {line.produitNom && <span className="ml-1 text-[10px] text-blue-500 bg-blue-50 dark:bg-blue-900/30 px-1 py-0.5 rounded">Inv.</span>}
                      </span>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => startEditLine(line)}
                          className="p-1 rounded text-gray-400 hover:text-blue-500" title="Modifier">
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => onRemoveLine(line.id)}
                          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>{line.quantite} {line.unite || 'unite'}</span>
                      <span>P.U. {formatCurrency(line.prixUnitaire)}</span>
                      <span className="font-medium text-gray-700 dark:text-gray-300">{formatCurrency(line.montantLigne)}</span>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Total</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(linesTotalCalc)}</span>
                </div>
              </div>
            </>
          )}
        </Card>

        {/* Assignations */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Assignations ({assignations.length})
            </h4>
            <Button size="sm" variant="ghost" leftIcon={<UserPlus size={14} />} onClick={onShowAssign}>
              Assigner
            </Button>
          </div>
          {assignations.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Aucun employé assigné</p>
          ) : (
            <div className="space-y-2">
              {assignations.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-seaop-primary-100 dark:bg-seaop-primary-900/30 flex items-center justify-center text-xs font-bold text-seaop-primary-600">
                      {(a.employeeNom || '??').split(' ').map((n) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {a.employeeNom || `Employé #${a.employeeId}`}
                      </p>
                      {a.role && <p className="text-xs text-gray-500">{a.role}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">
                      {formatDate(a.dateAssignation)}
                    </span>
                    <button
                      onClick={() => onRemoveAssignation(a.id)}
                      className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Comments */}
      <Card>
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
          <MessageSquare size={16} /> Commentaires ({comments.length})
        </h4>

        {/* Comment timeline */}
        {comments.length > 0 && (
          <div className="space-y-3 mb-4 max-h-[400px] overflow-y-auto">
            {comments.map((c) => (
              <div key={c.id} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-600 dark:text-gray-400 flex-shrink-0">
                  {(c.userId || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {c.userId || 'Utilisateur'}
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatRelativeTime(c.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{c.commentText}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add comment */}
        <div className="flex gap-2">
          <div className="flex-1">
            <Textarea
              value={commentText}
              onChange={(e) => onCommentTextChange(e.target.value)}
              rows={2}
              placeholder="Ajouter un commentaire..."
            />
          </div>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Send size={14} />}
            onClick={onAddComment}
            disabled={!commentText.trim()}
            className="self-end"
          >
            Envoyer
          </Button>
        </div>
      </Card>

      {/* BT HTML Preview Modal */}
      <Modal
        isOpen={showBtHtmlPreview}
        onClose={() => { setShowBtHtmlPreview(false); setBtHtmlContent(''); }}
        title={`Aperçu du bon de travail ${selected?.numeroDocument || ''}`}
        size="xl"
      >
        <div className="space-y-4">
          {btHtmlContent ? (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden h-[calc(100vh-200px)] md:h-[70vh]">
              <iframe
                srcDoc={btHtmlContent}
                title="Aperçu bon de travail"
                className="w-full h-full bg-white"
                sandbox="allow-same-origin"
              />
            </div>
          ) : (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                const win = window.open('', '_blank');
                if (win) {
                  win.document.write(btHtmlContent);
                  win.document.close();
                }
              }}
              disabled={!btHtmlContent}
            >
              Ouvrir dans un nouvel onglet
            </Button>
            <Button variant="ghost" onClick={() => { setShowBtHtmlPreview(false); setBtHtmlContent(''); }}>
              Fermer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------- Operations Tab (Global View) ----------

function OperationsTab({
  allOperations, isLoading, onFetch, employees, supplierOptions,
}: {
  allOperations: Operation[];
  isLoading: boolean;
  onFetch: () => void;
  employees: Employee[];
  supplierOptions: { value: string; label: string }[];
}) {
  useEffect(() => { onFetch(); }, [onFetch]);

  const updateOperation = useProductionStore((s) => s.updateOperation);
  const removeOperation = useProductionStore((s) => s.removeOperation);

  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editForm, setEditForm] = React.useState<{
    nom: string;
    quantite: string;
    employeeId: string;
    fournisseur: string;
    heuresPrevues: string;
    heuresReelles: string;
    statut: string;
  }>({ nom: '', quantite: '', employeeId: '', fournisseur: '', heuresPrevues: '', heuresReelles: '', statut: '' });
  // Use a Set ref pattern to avoid stale closures while still triggering rerenders
  const [busy, setBusy] = React.useState<Set<number>>(new Set());

  const startEdit = (op: Operation) => {
    setEditingId(op.id);
    setEditForm({
      nom: op.nom || '',
      quantite: String(op.quantite ?? 1),
      employeeId: op.employeeId ? String(op.employeeId) : '',
      fournisseur: op.fournisseur || 'Interne',
      heuresPrevues: String(op.heuresPrevues ?? 0),
      heuresReelles: String(op.heuresReelles ?? 0),
      statut: op.statut || 'En attente',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const setBusyOn = (id: number, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const saveEdit = async (op: Operation) => {
    if (!op.formulaireBtId) return;
    // Required-field validation: nom must be present. The display elsewhere
    // (`op.nom || '--'`) tolerates empty, but allowing the user to silently
    // clear nom via empty input then seeing nothing change (because backend
    // gets `undefined` and skips the field) is misleading. Force the user
    // to be explicit.
    const nomTrim = editForm.nom.trim();
    if (!nomTrim) { alert("Le nom de l'opération est requis"); return; }
    setBusyOn(op.id, true);
    try {
      const qte = parseFloat(editForm.quantite);
      const hp = parseFloat(editForm.heuresPrevues);
      const hr = parseFloat(editForm.heuresReelles);
      // Defensive validation: backend already enforces non-negativity but UX
      // should prevent the round-trip when the value is obviously bad.
      if (Number.isNaN(qte) || qte < 0) { alert('Quantite invalide'); setBusyOn(op.id, false); return; }
      if (Number.isNaN(hp) || hp < 0) { alert('Heures prevues invalides'); setBusyOn(op.id, false); return; }
      if (Number.isNaN(hr) || hr < 0) { alert('Heures reelles invalides'); setBusyOn(op.id, false); return; }
      // Use `null` for unassign-employee instead of `undefined`. JSON serialization
      // drops `undefined`, so the field would be absent from the body and Pydantic's
      // `exclude_unset=True` would skip the UPDATE — leaving the old employee
      // assigned. `null` survives JSON serialization and Pydantic Optional[int]
      // accepts it, producing `SET employee_id = NULL`.
      await updateOperation(op.formulaireBtId, op.id, {
        nom: nomTrim,
        quantite: qte,
        employeeId: editForm.employeeId ? Number(editForm.employeeId) : null,
        fournisseur: editForm.fournisseur || 'Interne',
        heuresPrevues: hp,
        heuresReelles: hr,
        statut: editForm.statut,
      } as Partial<Operation>);
      setEditingId(null);
      onFetch();
    } catch {
      // Error surfaced via the store's global Alert; keep edit mode open so
      // the user can fix the input without losing their changes.
    } finally {
      setBusyOn(op.id, false);
    }
  };

  const handleDelete = async (op: Operation) => {
    if (!op.formulaireBtId) return;
    const label = op.nom || `Opération #${op.id}`;
    const btRef = op.btNumero ? ` du BT ${op.btNumero}` : '';
    if (!window.confirm(`Supprimer "${label}"${btRef} ?\n\nCette action est definitive.`)) return;
    setBusyOn(op.id, true);
    try {
      await removeOperation(op.formulaireBtId, op.id);
      onFetch();
    } catch {
      // Error surfaced via the store
    } finally {
      setBusyOn(op.id, false);
    }
  };

  const totalPrevues = allOperations.reduce((s, o) => s + (o.heuresPrevues || 0), 0);
  const totalReelles = allOperations.reduce((s, o) => s + (o.heuresReelles || 0), 0);

  if (isLoading) return <SkeletonPage />;

  // Build supplier dropdown including the row's current value (preserves
  // free-text legacy values like "(libre)") — same pattern used elsewhere.
  const supplierOptionsFor = (op: Operation): { value: string; label: string }[] => {
    const known = new Set(supplierOptions.map((o) => o.value));
    const base = [{ value: 'Interne', label: 'Interne' }, ...supplierOptions.filter((o) => o.value !== 'Interne')];
    if (op.fournisseur && !known.has(op.fournisseur) && op.fournisseur !== 'Interne') {
      return [...base, { value: op.fournisseur, label: `${op.fournisseur} (libre)` }];
    }
    return base;
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Vue d'ensemble de toutes les operations en cours sur les bons de travail.
      </p>

      {allOperations.length === 0 ? (
        <Card>
          <p className="text-center text-gray-400 py-8 text-sm">Aucune opération trouvée</p>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card padding="sm" className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">BT</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Operation</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Qte</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Assigne a</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Fournisseur</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">H. Prévues</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">H. Réelles</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Statut</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {allOperations.map((op) => {
                    const isEditing = editingId === op.id;
                    const isBusy = busy.has(op.id);
                    if (isEditing) {
                      return (
                        <tr key={op.id} className="bg-blue-50/40 dark:bg-blue-900/10">
                          <td className="px-3 py-2">
                            <span className="font-mono text-xs text-seaop-primary-600 dark:text-seaop-primary-400">
                              {op.btNumero || '--'}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={editForm.nom}
                              onChange={(e) => setEditForm((f) => ({ ...f, nom: e.target.value }))}
                              className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                              placeholder="Nom"
                              disabled={isBusy}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={editForm.quantite}
                              onChange={(e) => setEditForm((f) => ({ ...f, quantite: e.target.value }))}
                              className="w-20 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white text-right"
                              disabled={isBusy}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              value={editForm.employeeId}
                              onChange={(e) => setEditForm((f) => ({ ...f, employeeId: e.target.value }))}
                              className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                              disabled={isBusy}
                            >
                              <option value="">--</option>
                              {employees.map((emp) => (
                                <option key={emp.id} value={emp.id}>
                                  {emp.prenom} {emp.nom}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              value={editForm.fournisseur}
                              onChange={(e) => setEditForm((f) => ({ ...f, fournisseur: e.target.value }))}
                              className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                              disabled={isBusy}
                            >
                              {supplierOptionsFor(op).map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              value={editForm.heuresPrevues}
                              onChange={(e) => setEditForm((f) => ({ ...f, heuresPrevues: e.target.value }))}
                              className="w-20 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white text-right"
                              disabled={isBusy}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              value={editForm.heuresReelles}
                              onChange={(e) => setEditForm((f) => ({ ...f, heuresReelles: e.target.value }))}
                              className="w-20 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white text-right"
                              disabled={isBusy}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              value={editForm.statut}
                              onChange={(e) => setEditForm((f) => ({ ...f, statut: e.target.value }))}
                              className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                              disabled={isBusy}
                            >
                              {OPERATION_STATUTS_EDITABLE.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => saveEdit(op)}
                                disabled={isBusy}
                                title="Enregistrer"
                                className="p-1.5 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50"
                              >
                                <Save size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                disabled={isBusy}
                                title="Annuler"
                                className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={op.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs text-seaop-primary-600 dark:text-seaop-primary-400">
                            {op.btNumero || '--'}
                          </span>
                          {op.btNom && <div className="text-xs text-gray-400 truncate max-w-[120px]">{op.btNom}</div>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900 dark:text-white">{op.nom || '--'}</div>
                          {op.description && <div className="text-xs text-gray-400 truncate max-w-[200px]">{op.description}</div>}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{op.quantite}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400 text-xs">{op.employeeNom || '--'}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{op.fournisseur || 'Interne'}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{op.heuresPrevues?.toFixed(1) || '0.0'}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{op.heuresReelles?.toFixed(1) || '0.0'}</td>
                        <td className="px-3 py-2 text-center">
                          <Badge color={OPERATION_STATUT_COLORS[op.statut] || 'gray'} size="sm">{op.statut}</Badge>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => startEdit(op)}
                              disabled={isBusy || editingId !== null}
                              title="Modifier"
                              className="p-1.5 rounded text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(op)}
                              disabled={isBusy || editingId !== null}
                              title="Supprimer"
                              className="p-1.5 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600">
                    <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300">
                      Totaux ({allOperations.length} operations)
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-gray-900 dark:text-white">{(totalPrevues ?? 0).toFixed(1)}h</td>
                    <td className="px-3 py-2 text-right font-bold text-gray-900 dark:text-white">{(totalReelles ?? 0).toFixed(1)}h</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {allOperations.map((op) => {
              const isBusy = busy.has(op.id);
              const isEditing = editingId === op.id;
              if (isEditing) {
                // Mobile edit form — stacked layout in the card so users on
                // small screens can still modify fields. Without this, clicking
                // Modifier on mobile would set editingId but render no inputs,
                // trapping the user (Round 13 finding #3).
                return (
                  <Card key={op.id} padding="sm" className="border-2 border-blue-300 dark:border-blue-700 bg-blue-50/40 dark:bg-blue-900/10">
                    <div className="text-xs font-mono text-seaop-primary-600 mb-2">{op.btNumero || '--'}</div>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">Nom *</label>
                        <input
                          type="text"
                          value={editForm.nom}
                          onChange={(e) => setEditForm((f) => ({ ...f, nom: e.target.value }))}
                          className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                          disabled={isBusy}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">Quantite</label>
                          <input
                            type="number" step="0.01" min="0"
                            value={editForm.quantite}
                            onChange={(e) => setEditForm((f) => ({ ...f, quantite: e.target.value }))}
                            className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white text-right"
                            disabled={isBusy}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">Statut</label>
                          <select
                            value={editForm.statut}
                            onChange={(e) => setEditForm((f) => ({ ...f, statut: e.target.value }))}
                            className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                            disabled={isBusy}
                          >
                            {OPERATION_STATUTS_EDITABLE.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">Assigne a</label>
                        <select
                          value={editForm.employeeId}
                          onChange={(e) => setEditForm((f) => ({ ...f, employeeId: e.target.value }))}
                          className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                          disabled={isBusy}
                        >
                          <option value="">--</option>
                          {employees.map((emp) => (
                            <option key={emp.id} value={emp.id}>{emp.prenom} {emp.nom}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">Fournisseur</label>
                        <select
                          value={editForm.fournisseur}
                          onChange={(e) => setEditForm((f) => ({ ...f, fournisseur: e.target.value }))}
                          className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                          disabled={isBusy}
                        >
                          {supplierOptionsFor(op).map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">H. prévues</label>
                          <input
                            type="number" step="0.1" min="0"
                            value={editForm.heuresPrevues}
                            onChange={(e) => setEditForm((f) => ({ ...f, heuresPrevues: e.target.value }))}
                            className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white text-right"
                            disabled={isBusy}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">H. réelles</label>
                          <input
                            type="number" step="0.1" min="0"
                            value={editForm.heuresReelles}
                            onChange={(e) => setEditForm((f) => ({ ...f, heuresReelles: e.target.value }))}
                            className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white text-right"
                            disabled={isBusy}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 pt-2">
                        <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={isBusy}>
                          <X size={12} className="mr-1" /> Annuler
                        </Button>
                        <Button variant="primary" size="sm" onClick={() => saveEdit(op)} disabled={isBusy} isLoading={isBusy}>
                          <Save size={12} className="mr-1" /> Enregistrer
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              }
              return (
                <Card key={op.id} padding="sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate mr-2">{op.nom || '--'}</span>
                    <Badge color={OPERATION_STATUT_COLORS[op.statut] || 'gray'} size="sm">{op.statut}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 mb-2">
                    {op.btNumero && <span className="font-mono text-seaop-primary-600">{op.btNumero}</span>}
                    {op.employeeNom && <span>{op.employeeNom}</span>}
                    <span className="flex items-center gap-1"><Clock size={10} /> {op.heuresPrevues?.toFixed(1) || '0'}h / {op.heuresReelles?.toFixed(1) || '0'}h</span>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => startEdit(op)} disabled={isBusy || editingId !== null}>
                      <Pencil size={12} className="mr-1" /> Modifier
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => handleDelete(op)} disabled={isBusy || editingId !== null}>
                      <Trash2 size={12} className="mr-1" /> Supprimer
                    </Button>
                  </div>
                </Card>
              );
            })}
            <div className="flex items-center justify-between pt-2 text-xs">
              <span className="font-semibold text-gray-700 dark:text-gray-300">{allOperations.length} operations</span>
              <span className="font-bold text-gray-900 dark:text-white">{(totalPrevues ?? 0).toFixed(1)}h prévues / {(totalReelles ?? 0).toFixed(1)}h réelles</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
